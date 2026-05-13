-- 2026-05-14 build 119 — push enqueue + 페이스 그룹 + 위클리 리포트

------------------------------------------------------------
-- (A) enqueue_contest_finish_pushes
-- 친선런 finish 시 참가자에게 "함께한 사진 업로드 ❤️" 알림.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_contest_finish_pushes(p_contest_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_title TEXT;
  v_date DATE;
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  SELECT title, contest_date INTO v_title, v_date
  FROM public.daily_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR r IN
    SELECT dt.user_id, dt.id AS device_token_id
    FROM public.daily_contest_participants p
    JOIN public.push_device_tokens dt ON dt.user_id = p.user_id
    WHERE p.contest_id = p_contest_id
  LOOP
    INSERT INTO public.push_send_log (user_id, device_token_id, category, title, body, payload, status)
    VALUES (
      r.user_id, r.device_token_id, 'contest_finish',
      '친선런 마감! 📸 함께한 사진을 남겨보세요',
      v_title || ' · ' || v_date,
      jsonb_build_object('contest_id', p_contest_id, 'route', '/ranking?tab=contest'),
      'queued'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_contest_finish_pushes(UUID) TO authenticated;

-- finish_contest 가 자동으로 호출하게 — 함수 재정의
CREATE OR REPLACE FUNCTION public.finish_contest(p_contest_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  UPDATE public.daily_contests SET status = 'finished'
   WHERE id = p_contest_id AND host_user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '호스트만 마감할 수 있어요'; END IF;
  PERFORM public.enqueue_contest_finish_pushes(p_contest_id);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.finish_contest(UUID) TO authenticated;

------------------------------------------------------------
-- (B) enqueue_club_course_pushes — 클럽 코스 시작 / 완주 알림
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_club_course_pushes(
  p_club_id UUID,
  p_course_id UUID,
  p_event TEXT   -- 'start' | 'complete'
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_club_name TEXT;
  v_course_name TEXT;
  v_count INTEGER := 0;
  v_title TEXT;
  v_body TEXT;
  r RECORD;
BEGIN
  SELECT name INTO v_club_name FROM public.clubs WHERE id = p_club_id;
  SELECT name INTO v_course_name FROM public.virtual_courses WHERE id = p_course_id;
  IF v_club_name IS NULL OR v_course_name IS NULL THEN RETURN 0; END IF;

  IF p_event = 'start' THEN
    v_title := '🏁 클럽 도전 시작!';
    v_body := v_club_name || ' · ' || v_course_name || ' 함께 달려봐요';
  ELSIF p_event = 'complete' THEN
    v_title := '🏆 클럽 코스 완주!';
    v_body := v_club_name || ' · ' || v_course_name || ' 모두 함께 해낸 결과';
  ELSE
    RETURN 0;
  END IF;

  FOR r IN
    SELECT dt.user_id, dt.id AS device_token_id
    FROM public.club_members cm
    JOIN public.push_device_tokens dt ON dt.user_id = cm.user_id
    WHERE cm.club_id = p_club_id AND cm.user_id IS NOT NULL
  LOOP
    INSERT INTO public.push_send_log (user_id, device_token_id, category, title, body, payload, status)
    VALUES (
      r.user_id, r.device_token_id, 'club_course_' || p_event,
      v_title, v_body,
      jsonb_build_object('club_id', p_club_id, 'course_id', p_course_id, 'route', '/social/clubs/detail?id=' || p_club_id::text),
      'queued'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_club_course_pushes(UUID, UUID, TEXT) TO authenticated;

-- start_club_course 자동 호출
CREATE OR REPLACE FUNCTION public.start_club_course(p_club_id UUID, p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid(); v_role TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  SELECT role INTO v_role FROM public.club_members WHERE club_id = p_club_id AND user_id = v_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION '클럽 멤버가 아닙니다'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION '클럽 운영자만 시작할 수 있어요'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.virtual_courses WHERE id = p_course_id AND is_active) THEN
    RAISE EXCEPTION '비활성 코스이거나 존재하지 않아요';
  END IF;

  INSERT INTO public.club_course_progress (club_id, course_id, started_by)
  VALUES (p_club_id, p_course_id, v_user_id)
  ON CONFLICT (club_id, course_id) DO NOTHING;

  -- 신규 시작이면 push
  IF FOUND THEN
    PERFORM public.enqueue_club_course_pushes(p_club_id, p_course_id, 'start');
  END IF;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_club_course(UUID, UUID) TO authenticated;

------------------------------------------------------------
-- (C) 페이스 그룹 — 5단계 페이스대 가상 클럽
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pace_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  min_pace_sec INTEGER NOT NULL,
  max_pace_sec INTEGER NOT NULL,
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pace_group_members (
  group_id UUID NOT NULL REFERENCES public.pace_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS pgm_user_idx ON public.pace_group_members(user_id);

ALTER TABLE public.pace_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pace_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pg_select_all ON public.pace_groups;
CREATE POLICY pg_select_all ON public.pace_groups FOR SELECT USING (true);

DROP POLICY IF EXISTS pgm_select_all ON public.pace_group_members;
CREATE POLICY pgm_select_all ON public.pace_group_members FOR SELECT USING (true);

DROP POLICY IF EXISTS pgm_self_write ON public.pace_group_members;
CREATE POLICY pgm_self_write ON public.pace_group_members FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- seed 6개 페이스대
INSERT INTO public.pace_groups (slug, label, description, min_pace_sec, max_pace_sec, emoji, sort_order) VALUES
  ('fast', '엘리트 (4분~)', '4''00"~4''30" 페이스. 진지하게 빠른 러너', 240, 270, '🔥', 1),
  ('subelite', '준엘리트 (4분 후반)', '4''30"~5''00". 대회 입상 노리는 페이스', 270, 300, '⚡', 2),
  ('threshold', '템포 (5분대)', '5''00"~6''00". 안정적인 빠른 페이스', 300, 360, '💨', 3),
  ('easy', '편안 (6분대)', '6''00"~7''00". 부담 없이 꾸준한 페이스', 360, 420, '🌿', 4),
  ('jog', '조깅 (7분대~)', '7''00"~8''00". 워킹런 / 회복 페이스', 420, 480, '🚶', 5),
  ('starter', '시작 러너 (8분 이상)', '걷기·뛰기 섞으며 시작', 480, 1200, '🌱', 6)
ON CONFLICT (slug) DO NOTHING;

------------------------------------------------------------
-- (D) join_pace_group / leave_pace_group
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_pace_group(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  -- 한 사용자 = 한 그룹. 기존 가입 제거 후 새로 가입.
  DELETE FROM public.pace_group_members WHERE user_id = v_user_id;
  INSERT INTO public.pace_group_members (group_id, user_id) VALUES (p_group_id, v_user_id);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_pace_group(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_pace_group()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  DELETE FROM public.pace_group_members WHERE user_id = v_user_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.leave_pace_group() TO authenticated;

------------------------------------------------------------
-- (E) fetch_pace_groups — 모든 그룹 + 멤버 수 + 내 추천 그룹 + 내 가입 여부
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_pace_groups()
RETURNS TABLE (
  group_id UUID,
  slug TEXT,
  label TEXT,
  description TEXT,
  emoji TEXT,
  min_pace_sec INTEGER,
  max_pace_sec INTEGER,
  member_count INTEGER,
  is_recommended BOOLEAN,
  is_joined BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_my_pace NUMERIC;
BEGIN
  IF v_user_id IS NOT NULL THEN
    SELECT AVG(pace_avg_sec_per_km)::NUMERIC INTO v_my_pace
      FROM public.activities
     WHERE user_id = v_user_id
       AND created_at >= now() - INTERVAL '30 days'
       AND pace_avg_sec_per_km BETWEEN 240 AND 1200;
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.slug,
    g.label,
    g.description,
    g.emoji,
    g.min_pace_sec,
    g.max_pace_sec,
    (SELECT COUNT(*)::INTEGER FROM public.pace_group_members m WHERE m.group_id = g.id),
    (v_my_pace IS NOT NULL AND v_my_pace BETWEEN g.min_pace_sec AND g.max_pace_sec),
    EXISTS (SELECT 1 FROM public.pace_group_members m WHERE m.group_id = g.id AND m.user_id = v_user_id)
  FROM public.pace_groups g
  ORDER BY g.sort_order;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_pace_groups() TO authenticated, anon;

------------------------------------------------------------
-- (F) fetch_pace_group_members
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_pace_group_members(p_group_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  region_gu TEXT,
  gender TEXT,
  show_gender BOOLEAN,
  km_30d NUMERIC,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    p.region_gu,
    p.gender,
    p.show_gender,
    COALESCE((SELECT SUM(a.distance_km)::NUMERIC(10,1) FROM public.activities a WHERE a.user_id = m.user_id AND a.created_at >= now() - INTERVAL '30 days'), 0)::NUMERIC,
    m.joined_at
  FROM public.pace_group_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE p.is_public = true
  ORDER BY (SELECT SUM(a.distance_km) FROM public.activities a WHERE a.user_id = m.user_id AND a.created_at >= now() - INTERVAL '30 days') DESC NULLS LAST
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_pace_group_members(UUID, INTEGER) TO authenticated;

------------------------------------------------------------
-- (G) admin_weekly_report — 이번주 vs 지난주 변화
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_weekly_report()
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  WITH wk AS (
    SELECT
      now() - INTERVAL '7 days' AS this_start,
      now() AS this_end,
      now() - INTERVAL '14 days' AS prev_start,
      now() - INTERVAL '7 days' AS prev_end
  )
  SELECT json_build_object(
    'new_users', json_build_object(
      'this', (SELECT COUNT(*) FROM public.profiles, wk WHERE created_at BETWEEN wk.this_start AND wk.this_end),
      'prev', (SELECT COUNT(*) FROM public.profiles, wk WHERE created_at BETWEEN wk.prev_start AND wk.prev_end)
    ),
    'active_users', json_build_object(
      'this', (SELECT COUNT(DISTINCT user_id) FROM public.activities, wk WHERE created_at BETWEEN wk.this_start AND wk.this_end),
      'prev', (SELECT COUNT(DISTINCT user_id) FROM public.activities, wk WHERE created_at BETWEEN wk.prev_start AND wk.prev_end)
    ),
    'runs', json_build_object(
      'this', (SELECT COUNT(*) FROM public.activities, wk WHERE created_at BETWEEN wk.this_start AND wk.this_end),
      'prev', (SELECT COUNT(*) FROM public.activities, wk WHERE created_at BETWEEN wk.prev_start AND wk.prev_end)
    ),
    'km', json_build_object(
      'this', (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1) FROM public.activities, wk WHERE created_at BETWEEN wk.this_start AND wk.this_end),
      'prev', (SELECT COALESCE(SUM(distance_km), 0)::NUMERIC(10,1) FROM public.activities, wk WHERE created_at BETWEEN wk.prev_start AND wk.prev_end)
    ),
    'photos', json_build_object(
      'this', (SELECT COUNT(*) FROM public.activity_photos, wk WHERE created_at BETWEEN wk.this_start AND wk.this_end),
      'prev', (SELECT COUNT(*) FROM public.activity_photos, wk WHERE created_at BETWEEN wk.prev_start AND wk.prev_end)
    ),
    'feedback', json_build_object(
      'this', (SELECT COUNT(*) FROM public.feedback_posts, wk WHERE created_at BETWEEN wk.this_start AND wk.this_end),
      'prev', (SELECT COUNT(*) FROM public.feedback_posts, wk WHERE created_at BETWEEN wk.prev_start AND wk.prev_end)
    ),
    'contests', json_build_object(
      'this', (SELECT COUNT(*) FROM public.daily_contests, wk WHERE created_at BETWEEN wk.this_start AND wk.this_end),
      'prev', (SELECT COUNT(*) FROM public.daily_contests, wk WHERE created_at BETWEEN wk.prev_start AND wk.prev_end)
    )
  ) INTO v;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_weekly_report() TO authenticated;
