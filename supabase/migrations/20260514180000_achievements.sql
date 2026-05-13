-- 2026-05-14 build 129 — Achievement 배지 시스템

------------------------------------------------------------
-- (A) user_achievements 테이블
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_achievements (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  PRIMARY KEY (user_id, code)
);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx ON public.user_achievements(user_id, achieved_at DESC);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ua_select_public ON public.user_achievements;
CREATE POLICY ua_select_public ON public.user_achievements FOR SELECT USING (true);  -- 친구 프로필에서도 보임

------------------------------------------------------------
-- (B) check_and_award_achievements — 조건 체크 + 자동 INSERT
-- 본인 호출. 코스 완주 / 누적 km / 시리즈 완주 조건 평가.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_award_achievements()
RETURNS TABLE (code TEXT, newly_awarded BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_total_km NUMERIC;
  v_completed INTEGER;
  v_total_runs INTEGER;
  v_series_majors_done INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  -- 누적 km
  SELECT COALESCE(SUM(distance_km), 0) INTO v_total_km
  FROM public.activities WHERE user_id = v_user_id;

  -- 누적 활동 수
  SELECT COUNT(*) INTO v_total_runs FROM public.activities WHERE user_id = v_user_id;

  -- 코스 완주 수
  SELECT COUNT(*) INTO v_completed
  FROM public.user_course_progress WHERE user_id = v_user_id AND completed_at IS NOT NULL;

  -- World Marathon Majors 완주
  SELECT COUNT(*) INTO v_series_majors_done
  FROM public.user_course_progress ucp
  JOIN public.virtual_courses vc ON vc.id = ucp.course_id
  JOIN public.course_series cs ON cs.id = vc.series_id
  WHERE ucp.user_id = v_user_id AND ucp.completed_at IS NOT NULL AND cs.slug = 'world_majors';

  -- 정의된 조건 평가 + INSERT
  -- first_run: 첫 활동
  IF v_total_runs >= 1 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'first_run') ON CONFLICT DO NOTHING; END IF;
  IF v_total_runs >= 10 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'runs_10') ON CONFLICT DO NOTHING; END IF;
  IF v_total_runs >= 100 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'runs_100') ON CONFLICT DO NOTHING; END IF;
  IF v_total_runs >= 500 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'runs_500') ON CONFLICT DO NOTHING; END IF;

  IF v_total_km >= 100 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'km_100') ON CONFLICT DO NOTHING; END IF;
  IF v_total_km >= 500 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'km_500') ON CONFLICT DO NOTHING; END IF;
  IF v_total_km >= 1000 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'km_1000') ON CONFLICT DO NOTHING; END IF;
  IF v_total_km >= 5000 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'km_5000') ON CONFLICT DO NOTHING; END IF;

  IF v_completed >= 1 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'first_course') ON CONFLICT DO NOTHING; END IF;
  IF v_completed >= 3 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'courses_3') ON CONFLICT DO NOTHING; END IF;
  IF v_completed >= 10 THEN INSERT INTO public.user_achievements (user_id, code) VALUES (v_user_id, 'courses_10') ON CONFLICT DO NOTHING; END IF;

  -- Six Stars (WMM 전체 = 6개)
  IF v_series_majors_done >= 6 THEN INSERT INTO public.user_achievements (user_id, code, metadata) VALUES (v_user_id, 'six_stars', jsonb_build_object('done', v_series_majors_done)) ON CONFLICT DO NOTHING; END IF;

  RETURN QUERY SELECT ua.code, true FROM public.user_achievements ua WHERE ua.user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_award_achievements() TO authenticated;

------------------------------------------------------------
-- (C) fetch_user_achievements — 친구 프로필 카드에서 표시
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_user_achievements(p_user_id UUID)
RETURNS TABLE (code TEXT, achieved_at TIMESTAMPTZ, metadata JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  SELECT ua.code, ua.achieved_at, ua.metadata
  FROM public.user_achievements ua
  WHERE ua.user_id = p_user_id
  ORDER BY ua.achieved_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_user_achievements(UUID) TO authenticated, anon;
