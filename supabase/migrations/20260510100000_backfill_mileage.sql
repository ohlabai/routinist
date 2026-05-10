-- 마일리지 백필 — 5/9 trigger 배포 전에 만들어진 activity 들이 distance_km 마일리지 누락.
-- 모든 활동 시간순 순회하며 award_distance_mileage 호출. 중복은 milestone_id (distance_<activity_id>) 로 차단.
-- 거리 milestone (first_5km/10/half/marathon) 도 함께 백필. recurrence='once' 라 1번만 award.
--
-- 안전성:
-- - award_mileage 가 recurrence/dup 검사로 멱등.
-- - award_distance_mileage 가 milestone_id 검사로 멱등.
-- - 시간순 (activity_date asc) 정렬: first_5km 가 첫 5km 활동에 귀속되도록 보장.

DO $$
DECLARE
  r RECORD;
  v_dist NUMERIC;
BEGIN
  FOR r IN
    SELECT id, user_id, distance_km, started_at, activity_date
      FROM public.activities
     WHERE distance_km >= 1
     ORDER BY activity_date ASC, created_at ASC
  LOOP
    v_dist := r.distance_km;

    -- 거리 milestone (사용자별 once)
    IF v_dist >= 5 THEN
      PERFORM public.award_mileage(r.user_id, 'first_5km', jsonb_build_object('activity_id', r.id));
    END IF;
    IF v_dist >= 10 THEN
      PERFORM public.award_mileage(r.user_id, 'first_10km', jsonb_build_object('activity_id', r.id));
    END IF;
    IF v_dist >= 21.0975 THEN
      PERFORM public.award_mileage(r.user_id, 'first_half', jsonb_build_object('activity_id', r.id));
    END IF;
    IF v_dist >= 42.195 THEN
      PERFORM public.award_mileage(r.user_id, 'first_marathon', jsonb_build_object('activity_id', r.id));
    END IF;

    -- 거리 마일리지 (km당 1P, 어제 활동 있으면 ×2). milestone_id 로 idempotent.
    PERFORM public.award_distance_mileage(r.id);
  END LOOP;
END $$;
