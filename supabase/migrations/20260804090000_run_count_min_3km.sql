-- 2026-08-04: "달린 횟수" = 3km 이상 러닝만 1회 (hans 확정)
--
-- 공유 카드 (ShareCard monthRunCount) 는 클라에서 이미 적용. 서버 캐시 계열을 동일 룰로:
--   횟수 (total_runs / this_month_runs) = 러닝 (walking 제외, NULL=러닝) AND distance_km >= 3
--   거리·시간 (total_distance_km / total_duration_seconds / this_month_distance_km) = 기존 유지 (러닝 전체, 거리 하한 없음)
-- 겸사 수리: update_profile_totals (health-sync bulk import 후 호출되는 레거시 RPC) 가
-- build 296 걷기 제외조차 미반영 상태로 트리거 값을 덮어쓰던 드리프트 원천 — 같은 룰로 통일.

-- 1. 통산 트리거 — 전체 재계산 방식 유지 (build 296 hotfix 구조), 횟수만 3km 하한 추가
CREATE OR REPLACE FUNCTION public.update_profile_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  UPDATE profiles p SET
    total_distance_km = s.km,
    total_runs = s.runs,
    total_duration_seconds = s.dur,
    updated_at = NOW()
  FROM (
    SELECT COALESCE(SUM(a.distance_km), 0) AS km,
           COUNT(*) FILTER (WHERE a.distance_km >= 3) AS runs,
           COALESCE(SUM(COALESCE(a.duration_seconds, 0)), 0) AS dur
    FROM public.activities a
    WHERE a.user_id = v_user
      AND (a.activity_type IS NULL OR a.activity_type <> 'walking')
  ) s
  WHERE p.id = v_user;

  -- user_id 가 바뀌는 UPDATE (실사용 없음, 방어) — 이전 소유자도 재계산
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    UPDATE profiles p SET
      total_distance_km = s.km, total_runs = s.runs, total_duration_seconds = s.dur, updated_at = NOW()
    FROM (
      SELECT COALESCE(SUM(a.distance_km), 0) AS km,
             COUNT(*) FILTER (WHERE a.distance_km >= 3) AS runs,
             COALESCE(SUM(COALESCE(a.duration_seconds, 0)), 0) AS dur
      FROM public.activities a
      WHERE a.user_id = OLD.user_id
        AND (a.activity_type IS NULL OR a.activity_type <> 'walking')
    ) s
    WHERE p.id = OLD.user_id;
  END IF;

  RETURN NULL;
END;
$function$;

-- 2. 이달 캐시 — 횟수만 3km 하한, 거리는 기존 유지
CREATE OR REPLACE FUNCTION public._recompute_profile_this_month(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_km NUMERIC;
  v_runs INTEGER;
  v_today_kst DATE;
BEGIN
  v_today_kst := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT COALESCE(SUM(distance_km), 0)::numeric,
         (COUNT(*) FILTER (WHERE distance_km >= 3))::int
  INTO v_km, v_runs
  FROM public.activities
  WHERE user_id = p_user_id
    AND activity_date >= DATE_TRUNC('month', v_today_kst)::date
    AND activity_date <= v_today_kst
    AND (activity_type IS NULL OR activity_type <> 'walking');

  UPDATE public.profiles
  SET this_month_distance_km = v_km,
      this_month_runs = v_runs,
      this_month_updated_at = now()
  WHERE id = p_user_id;
END;
$function$;

-- 3. 레거시 RPC (health-sync bulk import 후 호출) — 트리거와 동일 룰로 통일.
--    기존 정의는 걷기 포함 전체 COUNT/SUM 이라 트리거 값을 오염시켰음.
CREATE OR REPLACE FUNCTION public.update_profile_totals(p_user_id UUID)
RETURNS TABLE (total_runs INTEGER, total_distance_km NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_runs INTEGER;
  v_total_distance NUMERIC;
  v_total_duration BIGINT;
BEGIN
  -- 본인의 totals 만 갱신 가능 (트리거가 호출하지 않으므로 authenticated 만 검사).
  IF auth.role() = 'authenticated' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden: cannot update other user totals';
  END IF;

  SELECT (COUNT(*) FILTER (WHERE distance_km >= 3))::INTEGER,
         COALESCE(SUM(distance_km), 0),
         COALESCE(SUM(COALESCE(duration_seconds, 0)), 0)::BIGINT
    INTO v_total_runs, v_total_distance, v_total_duration
  FROM public.activities
  WHERE user_id = p_user_id
    AND (activity_type IS NULL OR activity_type <> 'walking');

  UPDATE public.profiles
     SET total_runs = v_total_runs,
         total_distance_km = ROUND(v_total_distance::NUMERIC, 2),
         total_duration_seconds = v_total_duration,
         updated_at = NOW()
   WHERE id = p_user_id;

  RETURN QUERY SELECT v_total_runs, ROUND(v_total_distance::NUMERIC, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_totals(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_profile_totals(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_profile_totals(UUID) TO authenticated;

-- 4. 전 유저 백필 — 통산 횟수 재계산 (거리·시간도 같은 스캔에서 정합 재고정)
UPDATE public.profiles p SET
  total_distance_km = COALESCE(s.km, 0),
  total_runs = COALESCE(s.runs, 0),
  total_duration_seconds = COALESCE(s.dur, 0),
  updated_at = NOW()
FROM (
  SELECT pr.id,
         SUM(a.distance_km) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS km,
         COUNT(a.id) FILTER (WHERE (a.activity_type IS NULL OR a.activity_type <> 'walking') AND a.distance_km >= 3) AS runs,
         SUM(COALESCE(a.duration_seconds, 0)) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS dur
  FROM public.profiles pr
  LEFT JOIN public.activities a ON a.user_id = pr.id
  GROUP BY pr.id
) s
WHERE s.id = p.id;

-- 5. 이달 캐시 백필
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public._recompute_profile_this_month(r.id);
  END LOOP;
END $$;
