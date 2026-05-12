-- 2026-05-13 build 106 — 하루 대회 (Daily Contest)
-- 친구끼리 모여 같은 날 달리고 결과 비교 랭킹.
-- 흐름: 호스트 생성 → 친구 초대 → 각자 활동 등록 → 활동 연결 → 랭킹.

------------------------------------------------------------
-- (A) daily_contests 테이블
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 80),
  contest_date DATE NOT NULL,  -- KST 기준
  event_type TEXT NOT NULL CHECK (event_type IN ('distance','duration','pace')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','running','finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_contests_host_idx ON public.daily_contests(host_user_id);
CREATE INDEX IF NOT EXISTS daily_contests_date_idx ON public.daily_contests(contest_date DESC);

------------------------------------------------------------
-- (B) daily_contest_participants
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_contest_participants (
  contest_id UUID NOT NULL REFERENCES public.daily_contests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  result_value NUMERIC,  -- distance_km, duration_seconds, pace_sec_per_km 중 하나
  PRIMARY KEY (contest_id, user_id)
);
CREATE INDEX IF NOT EXISTS dcp_user_idx ON public.daily_contest_participants(user_id);

------------------------------------------------------------
-- (C) RLS
------------------------------------------------------------
ALTER TABLE public.daily_contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_contest_participants ENABLE ROW LEVEL SECURITY;

-- 대회: 호스트 또는 참가자 본인은 SELECT
DROP POLICY IF EXISTS dc_select ON public.daily_contests;
CREATE POLICY dc_select ON public.daily_contests
  FOR SELECT USING (
    host_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.daily_contest_participants p
      WHERE p.contest_id = id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS dc_insert ON public.daily_contests;
CREATE POLICY dc_insert ON public.daily_contests
  FOR INSERT WITH CHECK (host_user_id = auth.uid());

DROP POLICY IF EXISTS dc_update ON public.daily_contests;
CREATE POLICY dc_update ON public.daily_contests
  FOR UPDATE USING (host_user_id = auth.uid());

DROP POLICY IF EXISTS dc_delete ON public.daily_contests;
CREATE POLICY dc_delete ON public.daily_contests
  FOR DELETE USING (host_user_id = auth.uid());

-- 참가자: 본인 + 같은 대회 참가자 SELECT
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
      WHERE c.id = contest_id AND c.host_user_id = auth.uid()
    )
  );

-- 본인 row 만 update / delete
DROP POLICY IF EXISTS dcp_update_own ON public.daily_contest_participants;
CREATE POLICY dcp_update_own ON public.daily_contest_participants
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS dcp_delete_own ON public.daily_contest_participants;
CREATE POLICY dcp_delete_own ON public.daily_contest_participants
  FOR DELETE USING (user_id = auth.uid());

------------------------------------------------------------
-- (D) RPC — create_daily_contest
-- 호스트가 대회 생성 + 본인 + 초대받은 사람들 추가 (1 tx).
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_daily_contest(
  p_title TEXT,
  p_contest_date DATE,
  p_event_type TEXT,
  p_invitee_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
  v_invitee UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_event_type NOT IN ('distance','duration','pace') THEN
    RAISE EXCEPTION '잘못된 종목 (%): distance/duration/pace 만 가능', p_event_type;
  END IF;

  INSERT INTO public.daily_contests (host_user_id, title, contest_date, event_type)
  VALUES (v_user_id, trim(p_title), p_contest_date, p_event_type)
  RETURNING id INTO v_id;

  -- 호스트 본인은 자동 참가
  INSERT INTO public.daily_contest_participants (contest_id, user_id)
  VALUES (v_id, v_user_id);

  -- 초대받은 사람들 (중복 무시)
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

GRANT EXECUTE ON FUNCTION public.create_daily_contest(TEXT, DATE, TEXT, UUID[]) TO authenticated;

------------------------------------------------------------
-- (E) RPC — submit_contest_result
-- 본인 활동 id 를 대회에 연결. event_type 별 result_value 자동 산출.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_contest_result(
  p_contest_id UUID,
  p_activity_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_event TEXT;
  v_value NUMERIC;
  v_distance NUMERIC;
  v_dur INTEGER;
  v_pace NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  -- 활동 소유자 + 정보
  SELECT a.distance_km, a.duration_seconds, a.pace_avg_sec_per_km
    INTO v_distance, v_dur, v_pace
  FROM public.activities a
  WHERE a.id = p_activity_id AND a.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '본인 활동이 아닙니다'; END IF;

  -- 대회 종목
  SELECT event_type INTO v_event
  FROM public.daily_contests
  WHERE id = p_contest_id;
  IF NOT FOUND THEN RAISE EXCEPTION '대회를 찾을 수 없어요'; END IF;

  v_value := CASE v_event
    WHEN 'distance' THEN v_distance
    WHEN 'duration' THEN v_dur::NUMERIC
    WHEN 'pace' THEN v_pace
  END;

  UPDATE public.daily_contest_participants
     SET activity_id = p_activity_id, result_value = v_value
   WHERE contest_id = p_contest_id AND user_id = v_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION '참가자가 아닙니다'; END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_contest_result(UUID, UUID) TO authenticated;

------------------------------------------------------------
-- (F) RPC — fetch_my_contests
-- 내가 호스트하거나 참가 중인 모든 대회 + 참가자 수 + 내 제출 여부.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_my_contests()
RETURNS TABLE (
  contest_id UUID,
  title TEXT,
  contest_date DATE,
  event_type TEXT,
  status TEXT,
  host_user_id UUID,
  host_name TEXT,
  participant_count INTEGER,
  submitted_count INTEGER,
  my_submitted BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    c.id,
    c.title,
    c.contest_date,
    c.event_type,
    c.status,
    c.host_user_id,
    COALESCE(p_host.display_name, '익명'),
    (SELECT COUNT(*)::INTEGER FROM public.daily_contest_participants p WHERE p.contest_id = c.id),
    (SELECT COUNT(*)::INTEGER FROM public.daily_contest_participants p WHERE p.contest_id = c.id AND p.activity_id IS NOT NULL),
    EXISTS (
      SELECT 1 FROM public.daily_contest_participants p
      WHERE p.contest_id = c.id AND p.user_id = v_user_id AND p.activity_id IS NOT NULL
    ),
    c.created_at
  FROM public.daily_contests c
  LEFT JOIN public.profiles p_host ON p_host.id = c.host_user_id
  WHERE c.host_user_id = v_user_id
     OR EXISTS (
       SELECT 1 FROM public.daily_contest_participants p
       WHERE p.contest_id = c.id AND p.user_id = v_user_id
     )
  ORDER BY c.contest_date DESC, c.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_contests() TO authenticated;

------------------------------------------------------------
-- (G) RPC — fetch_contest_leaderboard
-- 특정 대회의 참가자 결과 정렬 (distance/pace 별 정렬 방향 다름).
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_contest_leaderboard(p_contest_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  activity_id UUID,
  result_value NUMERIC,
  rank INTEGER,
  is_host BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_event TEXT;
  v_host UUID;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  SELECT event_type, host_user_id INTO v_event, v_host
  FROM public.daily_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- 본인이 참가자/호스트인지 확인 (RLS 와 별개로 RPC 안전망)
  IF v_host <> v_user_id AND NOT EXISTS (
    SELECT 1 FROM public.daily_contest_participants
    WHERE contest_id = p_contest_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION '대회 결과를 볼 권한이 없어요';
  END IF;

  RETURN QUERY
  SELECT
    dcp.user_id,
    COALESCE(pr.display_name, '익명'),
    pr.avatar_url,
    dcp.activity_id,
    dcp.result_value,
    -- distance/duration 은 큰 값이 1위, pace 는 작은 값이 1위
    (RANK() OVER (
      ORDER BY
        CASE WHEN dcp.result_value IS NULL THEN 1 ELSE 0 END,
        CASE WHEN v_event = 'pace' THEN dcp.result_value END ASC NULLS LAST,
        CASE WHEN v_event <> 'pace' THEN dcp.result_value END DESC NULLS LAST
    ))::INTEGER,
    (dcp.user_id = v_host)
  FROM public.daily_contest_participants dcp
  LEFT JOIN public.profiles pr ON pr.id = dcp.user_id
  WHERE dcp.contest_id = p_contest_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_contest_leaderboard(UUID) TO authenticated;

------------------------------------------------------------
-- (H) RPC — finish_contest (호스트만)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_contest(p_contest_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  UPDATE public.daily_contests
     SET status = 'finished'
   WHERE id = p_contest_id AND host_user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '호스트만 마감할 수 있어요'; END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finish_contest(UUID) TO authenticated;
