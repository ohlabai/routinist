-- build 156: profile 에 이달 km/횟수 캐시 컬럼 + activity 변경 시 자동 갱신 trigger.
-- 사용자: "홈 진입 시 이달 km 가 3초 후 뜬다" → activities 페이지네이션 fetch 기다림.
-- 해결: profile.this_month_distance_km / this_month_runs 즉시 표시.
-- 매월 1일 reset 은 trigger 가 SUM 시점에 이번 달만 집계 → 5월 활동을 6월에 import 해도 cache=0.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS this_month_distance_km NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS this_month_runs INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS this_month_updated_at TIMESTAMPTZ;

-- 재계산 헬퍼: 특정 user 의 profile this_month_* 를 activities SUM 으로 갱신.
CREATE OR REPLACE FUNCTION public._recompute_profile_this_month(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km NUMERIC;
  v_runs INTEGER;
BEGIN
  SELECT COALESCE(SUM(distance_km), 0)::numeric, COUNT(*)::int
  INTO v_km, v_runs
  FROM public.activities
  WHERE user_id = p_user_id
    AND activity_date >= DATE_TRUNC('month', CURRENT_DATE)::date
    AND activity_date <= CURRENT_DATE;

  UPDATE public.profiles
  SET this_month_distance_km = v_km,
      this_month_runs = v_runs,
      this_month_updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- trigger: activity INSERT/UPDATE/DELETE → 해당 user 재계산.
-- ROW-LEVEL — Apple Health 일괄 import (90건) 시 90회 SUM 호출되지만 SUM 자체는 빠름.
CREATE OR REPLACE FUNCTION public._activities_update_profile_this_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM public._recompute_profile_this_month(NEW.user_id);
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM public._recompute_profile_this_month(NEW.user_id);
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      PERFORM public._recompute_profile_this_month(OLD.user_id);
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM public._recompute_profile_this_month(OLD.user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_profile_this_month ON public.activities;
CREATE TRIGGER trg_activities_profile_this_month
AFTER INSERT OR UPDATE OR DELETE ON public.activities
FOR EACH ROW
EXECUTE FUNCTION public._activities_update_profile_this_month();

-- 백필 — 이번 달 활동 있는 모든 사용자.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id FROM public.activities
    WHERE activity_date >= DATE_TRUNC('month', CURRENT_DATE)::date
      AND activity_date <= CURRENT_DATE
  LOOP
    PERFORM public._recompute_profile_this_month(r.user_id);
  END LOOP;
END $$;
