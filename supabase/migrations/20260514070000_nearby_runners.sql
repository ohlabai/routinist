-- 2026-05-14 build 116 — A 패키지
-- (1) 동네 러너 검색 — region 기반 매칭
-- (2) 성별 표시 토글 (show_gender)
-- (3) 친선런 공개 모집 (meetup_*)

------------------------------------------------------------
-- (A) profiles.show_gender — 본인 성별 노출 여부 (기본 true)
------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_gender BOOLEAN NOT NULL DEFAULT true;

------------------------------------------------------------
-- (B) daily_contests 확장 — 공개 모집
-- is_public: false=친구초대만, true=같은 지역 누구나 참가
------------------------------------------------------------
ALTER TABLE public.daily_contests
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meetup_location TEXT,
  ADD COLUMN IF NOT EXISTS meetup_time TEXT,  -- 'HH:MM' 형식, 단순 문자열
  ADD COLUMN IF NOT EXISTS host_region_gu TEXT,
  ADD COLUMN IF NOT EXISTS max_participants INTEGER;

CREATE INDEX IF NOT EXISTS daily_contests_public_idx ON public.daily_contests(is_public, contest_date DESC) WHERE is_public = true;

-- RLS 확장 — 공개 대회는 누구나 SELECT 가능
DROP POLICY IF EXISTS dc_select ON public.daily_contests;
CREATE POLICY dc_select ON public.daily_contests
  FOR SELECT USING (
    is_public = true
    OR host_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.daily_contest_participants p
      WHERE p.contest_id = id AND p.user_id = auth.uid()
    )
  );

-- 공개 대회는 누구나 join (insert participants)
-- 기존 dcp_select 도 공개 대회 참가자 보이게
DROP POLICY IF EXISTS dcp_select ON public.daily_contest_participants;
CREATE POLICY dcp_select ON public.daily_contest_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.daily_contest_participants p2
      WHERE p2.contest_id = contest_id AND p2.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.daily_contests c
      WHERE c.id = contest_id AND (c.host_user_id = auth.uid() OR c.is_public = true)
    )
  );

DROP POLICY IF EXISTS dcp_insert_self ON public.daily_contest_participants;
CREATE POLICY dcp_insert_self ON public.daily_contest_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.daily_contests c
      WHERE c.id = contest_id AND (c.is_public = true OR c.host_user_id = auth.uid())
    )
  );

------------------------------------------------------------
-- (C) create_daily_contest 확장 — 공개 모집 파라미터
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_daily_contest(
  p_title TEXT,
  p_contest_date DATE,
  p_event_type TEXT,
  p_invitee_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_is_public BOOLEAN DEFAULT false,
  p_meetup_location TEXT DEFAULT NULL,
  p_meetup_time TEXT DEFAULT NULL,
  p_max_participants INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
  v_invitee UUID;
  v_region_gu TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_event_type NOT IN ('distance','duration','pace') THEN
    RAISE EXCEPTION '잘못된 종목 (%): distance/duration/pace 만 가능', p_event_type;
  END IF;

  SELECT region_gu INTO v_region_gu FROM public.profiles WHERE id = v_user_id;

  INSERT INTO public.daily_contests
    (host_user_id, title, contest_date, event_type, is_public, meetup_location, meetup_time, max_participants, host_region_gu)
  VALUES
    (v_user_id, trim(p_title), p_contest_date, p_event_type,
     COALESCE(p_is_public, false), p_meetup_location, p_meetup_time, p_max_participants, v_region_gu)
  RETURNING id INTO v_id;

  INSERT INTO public.daily_contest_participants (contest_id, user_id)
  VALUES (v_id, v_user_id);

  IF p_invitee_ids IS NOT NULL THEN
    FOREACH v_invitee IN ARRAY p_invitee_ids LOOP
      IF v_invitee IS NOT NULL AND v_invitee <> v_user_id THEN
        INSERT INTO public.daily_contest_participants (contest_id, user_id)
        VALUES (v_id, v_invitee)
        ON CONFLICT (contest_id, user_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_daily_contest(TEXT, DATE, TEXT, UUID[], BOOLEAN, TEXT, TEXT, INTEGER) TO authenticated;

------------------------------------------------------------
-- (D) fetch_public_contests — 공개 모집 친선런 (지역/날짜 필터)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_public_contests(
  p_region_gu TEXT DEFAULT NULL,
  p_only_upcoming BOOLEAN DEFAULT true,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  contest_id UUID,
  title TEXT,
  contest_date DATE,
  event_type TEXT,
  meetup_location TEXT,
  meetup_time TEXT,
  host_region_gu TEXT,
  max_participants INTEGER,
  status TEXT,
  host_user_id UUID,
  host_name TEXT,
  host_avatar TEXT,
  participant_count INTEGER,
  my_joined BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.title,
    c.contest_date,
    c.event_type,
    c.meetup_location,
    c.meetup_time,
    c.host_region_gu,
    c.max_participants,
    c.status,
    c.host_user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    (SELECT COUNT(*)::INTEGER FROM public.daily_contest_participants dcp WHERE dcp.contest_id = c.id),
    EXISTS (
      SELECT 1 FROM public.daily_contest_participants dcp
      WHERE dcp.contest_id = c.id AND dcp.user_id = v_user_id
    ),
    c.created_at
  FROM public.daily_contests c
  LEFT JOIN public.profiles p ON p.id = c.host_user_id
  WHERE c.is_public = true
    AND (p_region_gu IS NULL OR c.host_region_gu = p_region_gu)
    AND (NOT p_only_upcoming OR c.contest_date >= CURRENT_DATE)
    AND c.status <> 'finished'
  ORDER BY c.contest_date ASC, c.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_public_contests(TEXT, BOOLEAN, INTEGER) TO authenticated;

------------------------------------------------------------
-- (E) join_public_contest — 공개 친선런 참가 신청
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_public_contest(p_contest_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_max INTEGER;
  v_current INTEGER;
  v_is_public BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  SELECT is_public, max_participants
    INTO v_is_public, v_max
  FROM public.daily_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN RAISE EXCEPTION '대회를 찾을 수 없어요'; END IF;
  IF NOT v_is_public THEN RAISE EXCEPTION '공개 모집 대회가 아니에요'; END IF;

  IF v_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current
    FROM public.daily_contest_participants WHERE contest_id = p_contest_id;
    IF v_current >= v_max THEN RAISE EXCEPTION '인원이 마감됐어요 (%/%)', v_current, v_max; END IF;
  END IF;

  INSERT INTO public.daily_contest_participants (contest_id, user_id)
  VALUES (p_contest_id, v_user_id)
  ON CONFLICT (contest_id, user_id) DO NOTHING;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_public_contest(UUID) TO authenticated;

------------------------------------------------------------
-- (F) fetch_nearby_runners — 같은 지역 러너 (region 매칭)
-- scope: 'dong' | 'gu' | 'si' | 'national'
-- 본인 + 비공개 프로필 제외, 최근 30일 활동자 우선
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_nearby_runners(
  p_scope TEXT DEFAULT 'gu',
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  region_si TEXT,
  region_gu TEXT,
  region_dong TEXT,
  bio TEXT,
  birth_year INTEGER,
  gender TEXT,
  show_gender BOOLEAN,
  total_runs INTEGER,
  total_distance_km NUMERIC,
  runs_30d INTEGER,
  km_30d NUMERIC,
  last_active TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_si TEXT;
  v_gu TEXT;
  v_dong TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  SELECT p.region_si, p.region_gu, p.region_dong
    INTO v_si, v_gu, v_dong
  FROM public.profiles p WHERE p.id = v_user_id;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    p.region_si,
    p.region_gu,
    p.region_dong,
    p.bio,
    p.birth_year,
    p.gender,
    p.show_gender,
    p.total_runs,
    p.total_distance_km,
    COALESCE((SELECT COUNT(*)::INTEGER FROM public.activities a WHERE a.user_id = p.id AND a.created_at >= now() - INTERVAL '30 days'), 0),
    COALESCE((SELECT SUM(a.distance_km)::NUMERIC(10,1) FROM public.activities a WHERE a.user_id = p.id AND a.created_at >= now() - INTERVAL '30 days'), 0)::NUMERIC,
    (SELECT MAX(a.created_at) FROM public.activities a WHERE a.user_id = p.id)
  FROM public.profiles p
  WHERE p.id <> v_user_id
    AND p.is_public = true
    AND (
      (p_scope = 'dong'     AND v_dong IS NOT NULL AND p.region_dong = v_dong AND p.region_gu = v_gu) OR
      (p_scope = 'gu'       AND v_gu IS NOT NULL   AND p.region_gu = v_gu) OR
      (p_scope = 'si'       AND v_si IS NOT NULL   AND p.region_si = v_si) OR
      (p_scope = 'national' AND true)
    )
  ORDER BY
    -- 최근 30일 km 많이 달린 순
    COALESCE((SELECT SUM(a.distance_km) FROM public.activities a WHERE a.user_id = p.id AND a.created_at >= now() - INTERVAL '30 days'), 0) DESC,
    p.total_distance_km DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_nearby_runners(TEXT, INTEGER) TO authenticated;

------------------------------------------------------------
-- (G) toggle_show_gender — 본인 토글
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_show_gender(p_show BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  UPDATE public.profiles SET show_gender = COALESCE(p_show, true) WHERE id = v_user_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_show_gender(BOOLEAN) TO authenticated;
