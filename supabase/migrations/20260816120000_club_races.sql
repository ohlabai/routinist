-- 2026-08-16: 클럽 대회 (2인 1조 합산 레이스)
--
-- 배경: BIT Runners 1주년 트레일런 (8/21) — 12명이 2인 1조 6개 조로 달리고
--       "조 기록 = 두 사람 시간의 합계, 합계가 가장 짧은 조가 우승".
--       행사 페이지가 이미 "계측은 루티니스트 앱 «클럽 대회»" 로 공지돼 있다.
--
-- 설계 판단 3가지:
--
-- 1) 기록 = **실경과 시간** (ended_at - started_at), 이동 시간(duration_seconds) 이 아니다.
--    duration_seconds 는 자동정지가 빠진 값이다 (실측: 8/13 러닝이 521초 짧음).
--    오르막에서 걷는 트레일런에 이동 시간을 쓰면 **많이 걸은 사람이 유리해진다** —
--    걸은 시간이 기록에서 사라지므로. "도착 시각이 곧 개인 기록" 이라는 룰과도 어긋난다.
--
-- 2) **앱 없는 참가자(guest)** 를 1급으로 지원한다.
--    실측: 참가자 12명 중 클럽 앱 계정은 10명, 최근 30일 러닝 기록이 있는 사람은 7명뿐.
--    조 기록이 합계라 짝 중 한 명만 비어도 그 조는 순위가 안 나온다 → 대회가 깨진다.
--    그래서 운영자가 이름만으로 참가자를 넣고 도착 시각을 직접 입력할 수 있어야 한다.
--
-- 3) 자동 매칭은 **운영자가 누르는 동기화**다 (트리거 아님).
--    러닝 저장 시각이 제각각이고, 잘못 잡힌 활동을 되돌릴 수 있어야 한다.
--    source='manual' 로 손을 댄 기록은 재동기화가 덮어쓰지 않는다.

-- ───────────────── 1. 대회 ─────────────────
CREATE TABLE IF NOT EXISTS public.club_races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  -- KST 날짜 (표시·필터용). 타임존 규약은 activity_date 와 동일 — reference_timezone_handling
  race_date DATE NOT NULL,
  -- 자동 매칭 창. 이 사이에 시작된 러닝만 대회 기록 후보가 된다.
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ NOT NULL,
  distance_km NUMERIC(6,2),                  -- 코스 거리 (참고 표시용)
  team_size SMALLINT NOT NULL DEFAULT 2 CHECK (team_size BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT club_races_window CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_club_races_club_date ON public.club_races(club_id, race_date DESC);

-- ───────────────── 2. 참가자 ─────────────────
CREATE TABLE IF NOT EXISTS public.club_race_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES public.club_races(id) ON DELETE CASCADE,
  -- 앱 회원이면 user_id, 앱 없는 참가자면 guest_name. 둘 중 하나는 반드시 있다.
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_name TEXT,
  team_no SMALLINT CHECK (team_no > 0),      -- NULL = 아직 조 미편성
  seconds INTEGER CHECK (seconds > 0),       -- 확정 기록 (실경과 초)
  distance_km NUMERIC(6,2),
  activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'pending' CHECK (source IN ('pending','auto','manual','dnf')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT club_race_entries_who CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
);
-- 같은 대회에 같은 사람이 두 번 들어가지 않게 (guest 는 이름 기준)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cre_user  ON public.club_race_entries(race_id, user_id)    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cre_guest ON public.club_race_entries(race_id, guest_name) WHERE guest_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cre_race_team ON public.club_race_entries(race_id, team_no);

-- ───────────────── RLS ─────────────────
ALTER TABLE public.club_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_race_entries ENABLE ROW LEVEL SECURITY;

-- 읽기: 공개 클럽이거나 내가 속한 클럽
DROP POLICY IF EXISTS "cr_select" ON public.club_races;
CREATE POLICY "cr_select" ON public.club_races FOR SELECT USING (
  club_id IN (SELECT id FROM public.clubs WHERE is_public = true)
  OR club_id IN (SELECT club_id FROM public.club_members WHERE user_id = (SELECT auth.uid()))
);

-- 쓰기: 클럽 owner/admin 만
DROP POLICY IF EXISTS "cr_admin_write" ON public.club_races;
CREATE POLICY "cr_admin_write" ON public.club_races FOR ALL USING (
  club_id IN (
    SELECT club_id FROM public.club_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);

DROP POLICY IF EXISTS "cre_select" ON public.club_race_entries;
CREATE POLICY "cre_select" ON public.club_race_entries FOR SELECT USING (
  race_id IN (
    SELECT r.id FROM public.club_races r
    WHERE r.club_id IN (SELECT id FROM public.clubs WHERE is_public = true)
       OR r.club_id IN (SELECT club_id FROM public.club_members WHERE user_id = (SELECT auth.uid()))
  )
);

-- 운영자는 전권 (조 편성·수동 기록·guest 추가)
DROP POLICY IF EXISTS "cre_admin_write" ON public.club_race_entries;
CREATE POLICY "cre_admin_write" ON public.club_race_entries FOR ALL USING (
  race_id IN (
    SELECT r.id FROM public.club_races r
    JOIN public.club_members m ON m.club_id = r.club_id
    WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner','admin')
  )
);

-- 본인 참가/취소 (기록 필드는 아래 RPC 로만 — 자기 기록 위조 방지)
DROP POLICY IF EXISTS "cre_self_join" ON public.club_race_entries;
CREATE POLICY "cre_self_join" ON public.club_race_entries FOR INSERT WITH CHECK (
  user_id = (SELECT auth.uid())
  AND seconds IS NULL AND source = 'pending' AND team_no IS NULL
  AND race_id IN (
    SELECT r.id FROM public.club_races r
    JOIN public.club_members m ON m.club_id = r.club_id
    WHERE m.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "cre_self_leave" ON public.club_race_entries;
CREATE POLICY "cre_self_leave" ON public.club_race_entries FOR DELETE USING (
  user_id = (SELECT auth.uid()) AND seconds IS NULL
);

-- ───────────────── 3. 자동 매칭 ─────────────────
-- 창 안에 시작된 러닝 중 **가장 멀리 뛴 것** 하나를 각 참가자의 기록으로 잡는다.
-- 기록 = 실경과(ended_at - started_at). ended_at 이 없으면 duration_seconds 로 폴백.
-- source='manual'/'dnf' 인 항목은 건드리지 않는다 (운영자가 손댄 것이 우선).
CREATE OR REPLACE FUNCTION public.sync_club_race_times(p_race_id UUID)
RETURNS TABLE (matched INTEGER, missing INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_race public.club_races%ROWTYPE;
  v_matched INTEGER := 0;
  v_missing INTEGER := 0;
BEGIN
  SELECT * INTO v_race FROM public.club_races WHERE id = p_race_id;
  IF v_race.id IS NULL THEN
    RAISE EXCEPTION '대회를 찾을 수 없습니다';
  END IF;

  -- 운영자만 (SECURITY DEFINER 라 RLS 를 우회하므로 여기서 직접 확인)
  IF NOT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = v_race.club_id AND user_id = auth.uid() AND role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION '클럽 운영자만 기록을 동기화할 수 있습니다';
  END IF;

  UPDATE public.club_race_entries e
  SET seconds     = m.elapsed_s,
      distance_km = m.distance_km,
      activity_id = m.id,
      source      = 'auto',
      updated_at  = NOW()
  FROM LATERAL (
    SELECT a.id, a.distance_km,
           COALESCE(
             NULLIF(EXTRACT(EPOCH FROM (a.ended_at - a.started_at))::INTEGER, 0),
             a.duration_seconds
           ) AS elapsed_s
    FROM public.activities a
    WHERE a.user_id = e.user_id
      AND a.started_at >= v_race.starts_at
      AND a.started_at <  v_race.ends_at
    ORDER BY a.distance_km DESC
    LIMIT 1
  ) m
  WHERE e.race_id = p_race_id
    AND e.user_id IS NOT NULL
    AND e.source IN ('pending','auto')     -- 수동 입력·DNF 는 보존
    AND m.elapsed_s > 0;
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  SELECT COUNT(*) INTO v_missing
  FROM public.club_race_entries
  WHERE race_id = p_race_id AND seconds IS NULL AND source <> 'dnf';

  RETURN QUERY SELECT v_matched, v_missing;
END;
$$;

-- ───────────────── 4. 리더보드 ─────────────────
-- 조별 합산. 조원 중 한 명이라도 기록이 없으면 순위에서 빼고 '집계 중' 으로 표시한다
-- (합계가 성립하지 않으므로 — 임의로 0 을 넣으면 그 조가 1등이 되어버린다).
CREATE OR REPLACE FUNCTION public.get_club_race_board(p_race_id UUID)
RETURNS TABLE (
  team_no SMALLINT,
  member_count INTEGER,
  finished_count INTEGER,
  total_seconds BIGINT,
  total_distance_km NUMERIC,
  is_complete BOOLEAN,
  rank INTEGER,
  members JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH visible AS (
    SELECT r.id FROM public.club_races r
    WHERE r.id = p_race_id
      AND (r.club_id IN (SELECT id FROM public.clubs WHERE is_public = true)
        OR r.club_id IN (SELECT club_id FROM public.club_members WHERE user_id = auth.uid()))
  ),
  teams AS (
    SELECT
      e.team_no,
      COUNT(*)::INTEGER AS member_count,
      COUNT(e.seconds)::INTEGER AS finished_count,
      SUM(e.seconds)::BIGINT AS total_seconds,
      SUM(e.distance_km) AS total_distance_km,
      (COUNT(*) = COUNT(e.seconds)) AS is_complete,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'entry_id', e.id,
          'user_id', e.user_id,
          'name', COALESCE(p.display_name, e.guest_name),
          'avatar_url', p.avatar_url,
          'seconds', e.seconds,
          'distance_km', e.distance_km,
          'source', e.source,
          'is_guest', e.user_id IS NULL
        ) ORDER BY e.seconds NULLS LAST
      ) AS members
    FROM public.club_race_entries e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    WHERE e.race_id IN (SELECT id FROM visible)
      AND e.team_no IS NOT NULL
    GROUP BY e.team_no
  )
  SELECT t.team_no, t.member_count, t.finished_count, t.total_seconds, t.total_distance_km,
         t.is_complete,
         CASE WHEN t.is_complete
              THEN RANK() OVER (PARTITION BY t.is_complete ORDER BY t.total_seconds)::INTEGER
              ELSE NULL END AS rank,
         t.members
  FROM teams t
  ORDER BY t.is_complete DESC, t.total_seconds NULLS LAST, t.team_no;
$$;

-- SECURITY DEFINER 함수는 anon 에서 막는다 — reference_supabase_function_privilege
REVOKE ALL ON FUNCTION public.sync_club_race_times(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_club_race_board(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_club_race_times(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_race_board(UUID) TO authenticated;
