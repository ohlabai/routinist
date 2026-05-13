-- 2026-05-14 build 120 — 자동 친선런 + 클럽 완주 push + admin 설정

------------------------------------------------------------
-- (A) create_pace_group_contest — 페이스 그룹 친선런 자동 생성
-- 그룹 멤버 모두를 자동 초대. 본인은 그룹 가입자만 호출 가능.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pace_group_contest(
  p_group_id UUID,
  p_title TEXT,
  p_contest_date DATE,
  p_event_type TEXT DEFAULT 'distance',
  p_meetup_location TEXT DEFAULT NULL,
  p_meetup_time TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_contest_id UUID;
  v_region TEXT;
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_event_type NOT IN ('distance','duration','pace') THEN
    RAISE EXCEPTION '잘못된 종목';
  END IF;
  -- 그룹 가입자만 호출 가능
  IF NOT EXISTS (SELECT 1 FROM public.pace_group_members WHERE group_id = p_group_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION '페이스 그룹 가입자만 친선런을 만들 수 있어요';
  END IF;

  SELECT region_gu INTO v_region FROM public.profiles WHERE id = v_user_id;

  INSERT INTO public.daily_contests (host_user_id, title, contest_date, event_type, is_public, meetup_location, meetup_time, host_region_gu)
  VALUES (v_user_id, trim(p_title), p_contest_date, p_event_type, true, p_meetup_location, p_meetup_time, v_region)
  RETURNING id INTO v_contest_id;

  -- 그룹 멤버 모두 자동 참가
  FOR r IN SELECT user_id FROM public.pace_group_members WHERE group_id = p_group_id LOOP
    INSERT INTO public.daily_contest_participants (contest_id, user_id)
    VALUES (v_contest_id, r.user_id)
    ON CONFLICT (contest_id, user_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_contest_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_pace_group_contest(UUID, TEXT, DATE, TEXT, TEXT, TEXT) TO authenticated;

------------------------------------------------------------
-- (B) fetch_club_courses 갱신 — 자동 완주 시 push 발사 (volatile 로 변경)
-- 기존 fetch_club_courses 는 STABLE 이라 INSERT 못 함. 자동 완주 처리 분리.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_club_courses(p_club_id UUID)
RETURNS TABLE (
  course_id UUID,
  name TEXT,
  country TEXT,
  description TEXT,
  distance_km NUMERIC,
  preview_path JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_km NUMERIC,
  contributors INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER  -- 기본 VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  r RECORD;
  v_total NUMERIC;
  v_contrib INTEGER;
  v_newly_completed BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = v_user_id) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT ccp.course_id, c.name, c.country, c.description, c.distance_km, c.preview_path,
           ccp.started_at, ccp.completed_at
    FROM public.club_course_progress ccp
    JOIN public.virtual_courses c ON c.id = ccp.course_id
    WHERE ccp.club_id = p_club_id
    ORDER BY ccp.started_at DESC
  LOOP
    SELECT COALESCE(SUM(a.distance_km), 0), COUNT(DISTINCT a.user_id)
      INTO v_total, v_contrib
      FROM public.activities a
      JOIN public.club_members cm ON cm.user_id = a.user_id AND cm.club_id = p_club_id
     WHERE a.created_at >= r.started_at;

    v_newly_completed := false;
    IF r.completed_at IS NULL AND v_total >= r.distance_km THEN
      UPDATE public.club_course_progress
         SET completed_at = now()
       WHERE club_id = p_club_id AND course_id = r.course_id;
      r.completed_at := now();
      v_newly_completed := true;
    END IF;

    -- 신규 완주면 모든 클럽 멤버에게 push
    IF v_newly_completed THEN
      PERFORM public.enqueue_club_course_pushes(p_club_id, r.course_id, 'complete');
    END IF;

    course_id := r.course_id;
    name := r.name;
    country := r.country;
    description := r.description;
    distance_km := r.distance_km;
    preview_path := r.preview_path;
    started_at := r.started_at;
    completed_at := r.completed_at;
    total_km := v_total;
    contributors := v_contrib;
    RETURN NEXT;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_club_courses(UUID) TO authenticated;

------------------------------------------------------------
-- (C) admin_settings — key-value 설정 저장
-- 슬랙 webhook URL, 알림 활성화 등 어드민 전용 설정.
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS as_admin_only ON public.admin_settings;
CREATE POLICY as_admin_only ON public.admin_settings
  FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

CREATE OR REPLACE FUNCTION public.admin_get_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v TEXT;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  SELECT value INTO v FROM public.admin_settings WHERE key = p_key;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_setting(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_setting(p_key TEXT, p_value TEXT, p_description TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  INSERT INTO public.admin_settings (key, value, description, updated_by)
  VALUES (p_key, NULLIF(trim(COALESCE(p_value, '')), ''), p_description, auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        description = COALESCE(EXCLUDED.description, public.admin_settings.description),
        updated_at = now(),
        updated_by = auth.uid();
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_setting(TEXT, TEXT, TEXT) TO authenticated;

------------------------------------------------------------
-- (D) admin_weekly_report_text — 슬랙 메시지 포맷 텍스트
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_weekly_report_text()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_report JSON := public.admin_weekly_report();
  v_text TEXT;
  v_this INT; v_prev INT; v_diff INT;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  v_text := '📊 *Routinist 위클리 리포트* — ' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || E'\n\n';

  v_this := (v_report->'new_users'->>'this')::INT; v_prev := (v_report->'new_users'->>'prev')::INT;
  v_text := v_text || '• 신규 가입: *' || v_this || '* (지난주 ' || v_prev || ')' || E'\n';
  v_this := (v_report->'active_users'->>'this')::INT; v_prev := (v_report->'active_users'->>'prev')::INT;
  v_text := v_text || '• 활성 유저: *' || v_this || '* (지난주 ' || v_prev || ')' || E'\n';
  v_this := (v_report->'runs'->>'this')::INT; v_prev := (v_report->'runs'->>'prev')::INT;
  v_text := v_text || '• 활동 수: *' || v_this || '* (지난주 ' || v_prev || ')' || E'\n';
  v_text := v_text || '• 총 km: *' || (v_report->'km'->>'this') || '* (지난주 ' || (v_report->'km'->>'prev') || ')' || E'\n';
  v_this := (v_report->'photos'->>'this')::INT;
  v_text := v_text || '• 포토: *' || v_this || '*' || E'\n';
  v_this := (v_report->'feedback'->>'this')::INT;
  IF v_this > 0 THEN v_text := v_text || '• 제안 신규 글: *' || v_this || '*' || E'\n'; END IF;
  v_this := (v_report->'contests'->>'this')::INT;
  v_text := v_text || '• 친선런 신규: *' || v_this || '*' || E'\n';

  RETURN v_text;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_weekly_report_text() TO authenticated;
