-- 2026-05-14 build 118 — 클럽 마라톤 + 페이스 매칭

------------------------------------------------------------
-- (A) club_course_progress — 클럽 단체 코스 챌린지
-- 클럽 owner/admin 이 시작, 모든 클럽 멤버의 활동 km 합산.
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_course_progress (
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.virtual_courses(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  started_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (club_id, course_id)
);
CREATE INDEX IF NOT EXISTS ccp_club_idx ON public.club_course_progress(club_id);

ALTER TABLE public.club_course_progress ENABLE ROW LEVEL SECURITY;

-- 클럽 멤버는 자기 클럽의 챌린지 SELECT
DROP POLICY IF EXISTS ccp_select_members ON public.club_course_progress;
CREATE POLICY ccp_select_members ON public.club_course_progress
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.club_id = club_course_progress.club_id AND cm.user_id = auth.uid())
  );

-- INSERT/DELETE 는 RPC 만 (security definer)

------------------------------------------------------------
-- (B) start_club_course — 클럽 owner/admin 만 시작
------------------------------------------------------------
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

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_club_course(UUID, UUID) TO authenticated;

------------------------------------------------------------
-- (C) fetch_club_courses — 클럽 진행 중·완주 코스 + 합산 km + 멤버별 기여
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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  r RECORD;
  v_total NUMERIC;
  v_contrib INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  -- 클럽 멤버만
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
    -- 클럽 멤버 전체의 started_at 이후 km 합산
    SELECT COALESCE(SUM(a.distance_km), 0), COUNT(DISTINCT a.user_id)
      INTO v_total, v_contrib
      FROM public.activities a
      JOIN public.club_members cm ON cm.user_id = a.user_id AND cm.club_id = p_club_id
     WHERE a.created_at >= r.started_at;

    -- 자동 완주 마킹
    IF r.completed_at IS NULL AND v_total >= r.distance_km THEN
      UPDATE public.club_course_progress
         SET completed_at = now()
       WHERE club_id = p_club_id AND course_id = r.course_id;
      r.completed_at := now();
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
-- (D) fetch_club_course_leaderboard — 멤버별 기여 km 랭킹
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_club_course_leaderboard(p_club_id UUID, p_course_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  contributed_km NUMERIC,
  rank INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid(); v_started TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = v_user_id) THEN
    RETURN;
  END IF;

  SELECT started_at INTO v_started FROM public.club_course_progress
    WHERE club_id = p_club_id AND course_id = p_course_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT a.user_id, COALESCE(SUM(a.distance_km), 0) AS km
      FROM public.activities a
      JOIN public.club_members cm ON cm.user_id = a.user_id AND cm.club_id = p_club_id
     WHERE a.created_at >= v_started
     GROUP BY a.user_id
  )
  SELECT agg.user_id,
         COALESCE(p.display_name, '익명'),
         p.avatar_url,
         agg.km::NUMERIC(10,1),
         (RANK() OVER (ORDER BY agg.km DESC))::INTEGER
  FROM agg
  LEFT JOIN public.profiles p ON p.id = agg.user_id
  WHERE agg.km > 0
  ORDER BY agg.km DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_club_course_leaderboard(UUID, UUID) TO authenticated;

------------------------------------------------------------
-- (E) fetch_pace_matched_runners — 30일 평균 페이스 ±range 매칭
-- 비슷한 페이스의 러너 추천. 본인 페이스 데이터 없으면 빈 결과.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_pace_matched_runners(p_range_sec INTEGER DEFAULT 15)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  region_gu TEXT,
  gender TEXT,
  show_gender BOOLEAN,
  avg_pace_sec NUMERIC,
  pace_diff_sec NUMERIC,
  runs_30d INTEGER,
  km_30d NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_my_pace NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  SELECT AVG(pace_avg_sec_per_km)::NUMERIC INTO v_my_pace
    FROM public.activities
   WHERE user_id = v_user_id
     AND created_at >= now() - INTERVAL '30 days'
     AND pace_avg_sec_per_km IS NOT NULL
     AND pace_avg_sec_per_km BETWEEN 240 AND 900;  -- 4'00"~15'00" 합리 범위
  IF v_my_pace IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH others AS (
    SELECT a.user_id,
           AVG(a.pace_avg_sec_per_km)::NUMERIC AS avg_pace,
           COUNT(*)::INTEGER AS runs,
           SUM(a.distance_km)::NUMERIC(10,1) AS km
      FROM public.activities a
      JOIN public.profiles p ON p.id = a.user_id
     WHERE a.user_id <> v_user_id
       AND p.is_public = true
       AND a.created_at >= now() - INTERVAL '30 days'
       AND a.pace_avg_sec_per_km IS NOT NULL
       AND a.pace_avg_sec_per_km BETWEEN 240 AND 900
     GROUP BY a.user_id
    HAVING AVG(a.pace_avg_sec_per_km) BETWEEN v_my_pace - p_range_sec AND v_my_pace + p_range_sec
  )
  SELECT
    o.user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    p.region_gu,
    p.gender,
    p.show_gender,
    o.avg_pace::NUMERIC(10,1),
    ABS(o.avg_pace - v_my_pace)::NUMERIC(10,1),
    o.runs,
    o.km
  FROM others o
  LEFT JOIN public.profiles p ON p.id = o.user_id
  ORDER BY ABS(o.avg_pace - v_my_pace) ASC
  LIMIT 30;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_pace_matched_runners(INTEGER) TO authenticated;
