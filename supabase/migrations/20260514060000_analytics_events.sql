-- 2026-05-14 build 115 — Analytics Events (Phase B)
-- 클라이언트 페이지뷰 + 사용자 액션 추적. 어드민 분석 페이지에 통계 노출.

------------------------------------------------------------
-- (A) analytics_events 테이블
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- 비로그인도 추적 가능
  session_id TEXT,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  path TEXT,             -- pathname
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_user_idx ON public.analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_idx ON public.analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_path_idx ON public.analytics_events(path, created_at DESC) WHERE path IS NOT NULL;
CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON public.analytics_events(created_at DESC);

------------------------------------------------------------
-- (B) RLS — INSERT 누구나 (본인 user_id 또는 null), SELECT 어드민만
------------------------------------------------------------
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ae_insert ON public.analytics_events;
CREATE POLICY ae_insert ON public.analytics_events
  FOR INSERT WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS ae_select_admin ON public.analytics_events;
CREATE POLICY ae_select_admin ON public.analytics_events
  FOR SELECT USING (public.is_shop_admin());

------------------------------------------------------------
-- (C) track_events RPC — 배치 INSERT
-- 클라이언트가 누적 이벤트 5~10개씩 묶어서 한 번에 호출.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_events(p_events JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER := 0;
  v_event JSONB;
BEGIN
  -- jsonb 배열을 unnest
  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    INSERT INTO public.analytics_events
      (user_id, session_id, event_name, properties, path, created_at)
    VALUES (
      v_user_id,  -- 클라이언트가 보낸 user_id 무시, RPC caller 의 auth.uid() 만 사용 (스푸핑 차단)
      v_event->>'session_id',
      COALESCE(v_event->>'event_name', 'unknown'),
      COALESCE(v_event->'properties', '{}'::jsonb),
      v_event->>'path',
      COALESCE((v_event->>'created_at')::TIMESTAMPTZ, now())
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.track_events(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_events(JSONB) TO authenticated, anon;

------------------------------------------------------------
-- (D) 어드민 분석 — 이벤트 통계
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_events_summary(p_days INTEGER DEFAULT 7)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  SELECT json_build_object(
    'total_events', (
      SELECT COUNT(*) FROM public.analytics_events
      WHERE created_at >= now() - (p_days || ' days')::INTERVAL
    ),
    'unique_users', (
      SELECT COUNT(DISTINCT user_id) FROM public.analytics_events
      WHERE created_at >= now() - (p_days || ' days')::INTERVAL AND user_id IS NOT NULL
    ),
    'top_events', (
      SELECT json_agg(t) FROM (
        SELECT event_name, COUNT(*) AS n
        FROM public.analytics_events
        WHERE created_at >= now() - (p_days || ' days')::INTERVAL
        GROUP BY event_name
        ORDER BY n DESC
        LIMIT 15
      ) t
    ),
    'top_paths', (
      SELECT json_agg(t) FROM (
        SELECT path, COUNT(*) AS views, COUNT(DISTINCT user_id) AS unique_users
        FROM public.analytics_events
        WHERE created_at >= now() - (p_days || ' days')::INTERVAL
          AND event_name = 'page_view'
          AND path IS NOT NULL
        GROUP BY path
        ORDER BY views DESC
        LIMIT 15
      ) t
    )
  ) INTO v;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_analytics_events_summary(INTEGER) TO authenticated;

------------------------------------------------------------
-- (E) Funnel — 가입 → 첫 활동 → 첫 공유 → 첫 친구 → 첫 메달 신청
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_funnel()
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  SELECT json_build_object(
    'signup', (SELECT COUNT(*) FROM public.profiles),
    'first_run', (SELECT COUNT(DISTINCT user_id) FROM public.activities),
    'first_photo', (SELECT COUNT(DISTINCT user_id) FROM public.activity_photos),
    'first_friend', (SELECT COUNT(DISTINCT follower_id) FROM public.follows),
    'first_world_start', (SELECT COUNT(DISTINCT user_id) FROM public.user_course_progress),
    'first_world_complete', (SELECT COUNT(DISTINCT user_id) FROM public.user_course_progress WHERE completed_at IS NOT NULL),
    'first_medal_request', (SELECT COUNT(DISTINCT user_id) FROM public.course_medals WHERE requested_at IS NOT NULL)
  ) INTO v;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_analytics_funnel() TO authenticated;

------------------------------------------------------------
-- (F) 자동 청소 — 90일 이상 이벤트 삭제 (수동 호출, 또는 cron 으로 등록 가능)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_analytics_events()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  WITH del AS (
    DELETE FROM public.analytics_events WHERE created_at < now() - INTERVAL '90 days' RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM del;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_old_analytics_events() TO authenticated;
