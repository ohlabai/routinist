-- 2026-05-06: activity_date 타임존 버그 수정
-- 버그: workout.startDate (UTC ISO) 를 split('T')[0] 로 자르면 한국 새벽 러닝이 전날로 들어감.
-- 예: KST 5/2 07:10 = UTC 5/1 22:10 → activity_date 가 5/1 로 잘못 저장 → 캘린더에 5/2 가 빈 칸.
--
-- 해결: started_at AT TIME ZONE 'Asia/Seoul' 로 KST 날짜 재계산.
-- health_kit / gps 소스만 영향. 수동 입력 (manual) 은 사용자가 직접 입력한 날짜라 건드리지 않음.

-- 영향 받은 행 수 사전 확인용 (실행 전 dry-run):
-- SELECT user_id, COUNT(*)
--   FROM public.activities
--  WHERE source IN ('health_kit', 'gps')
--    AND started_at IS NOT NULL
--    AND activity_date != (started_at AT TIME ZONE 'Asia/Seoul')::DATE
--  GROUP BY user_id;

UPDATE public.activities
   SET activity_date = (started_at AT TIME ZONE 'Asia/Seoul')::DATE
 WHERE source IN ('health_kit', 'gps')
   AND started_at IS NOT NULL
   AND activity_date != (started_at AT TIME ZONE 'Asia/Seoul')::DATE;

-- 통계 — 얼마나 옮겨졌는지
DO $$
DECLARE
  affected INT;
BEGIN
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'activity_date 재정렬 완료: % 건', affected;
END $$;

-- 프로필 통산 집계도 함께 갱신 — total_distance_km 는 영향 없으나 trigger 가 재계산할 수 있게
-- (활동 row 자체는 그대로, 단지 활동 날짜만 이동했으므로 통산값 변동 없음. 캘린더 표시만 바뀜.)
