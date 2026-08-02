-- 권장 주간 km 355.7 버그 fix (2026-08-02 hans 스크린샷)
-- 원인: CTL(부하점수) × 5.5 를 km 로 오용 — hans CTL 67.9 → 373 → taper 감쇠 후 355.7km.
-- fix: 실제 최근 4주 주간 평균 거리 기반 + 점진 원칙(×1.1) + 거리별 하한·상한 클램프.
CREATE OR REPLACE FUNCTION public.get_next_target_race()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID;
  v_race RECORD;
  v_days_left INTEGER;
  v_weeks_left INTEGER;
  v_recommended_weekly_km NUMERIC;
  v_recent_weekly NUMERIC;
  v_floor NUMERIC;
  v_cap NUMERIC;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'auth required'); END IF;

  SELECT * INTO v_race
  FROM public.target_races
  WHERE user_id = v_uid
    AND is_completed = false
    AND race_date >= CURRENT_DATE
  ORDER BY race_date ASC
  LIMIT 1;

  IF v_race IS NULL THEN RETURN json_build_object('race', NULL); END IF;

  v_days_left := v_race.race_date - CURRENT_DATE;
  v_weeks_left := GREATEST(0, CEIL(v_days_left / 7.0)::INTEGER);

  -- 최근 28일 실제 주간 평균 거리 (러닝만)
  SELECT COALESCE(SUM(distance_km), 0) / 4.0 INTO v_recent_weekly
    FROM public.activities
   WHERE user_id = v_uid
     AND activity_date >= CURRENT_DATE - 28
     AND COALESCE(activity_type, 'running') = 'running';

  -- 거리별 하한(최소 준비량)·상한(캐주얼 러너 안전 상한)
  IF v_race.distance_meters >= 42000 THEN v_floor := 30; v_cap := 80;
  ELSIF v_race.distance_meters >= 21000 THEN v_floor := 20; v_cap := 60;
  ELSIF v_race.distance_meters >= 10000 THEN v_floor := 15; v_cap := 45;
  ELSE v_floor := 10; v_cap := 35;
  END IF;

  -- 점진 원칙: 지금 뛰는 양의 +10% 를 권장, 하한·상한 클램프
  v_recommended_weekly_km := ROUND(LEAST(v_cap, GREATEST(v_floor, v_recent_weekly * 1.1)), 1);

  -- Taper (마지막 2주는 80% / 60%)
  IF v_weeks_left <= 1 THEN v_recommended_weekly_km := ROUND(v_recommended_weekly_km * 0.6, 1);
  ELSIF v_weeks_left = 2 THEN v_recommended_weekly_km := ROUND(v_recommended_weekly_km * 0.8, 1);
  END IF;

  RETURN json_build_object(
    'race', json_build_object(
      'id', v_race.id,
      'name', v_race.name,
      'race_date', v_race.race_date,
      'distance_meters', v_race.distance_meters,
      'target_seconds', v_race.target_seconds,
      'notes', v_race.notes
    ),
    'days_left', v_days_left,
    'weeks_left', v_weeks_left,
    'recommended_weekly_km', v_recommended_weekly_km,
    'is_taper', v_weeks_left <= 2
  );
END;
$function$;
