-- 백필 timestamp 분산 — 어제 backfill 한 마일리지 트랜잭션이 모두 동일 created_at 이라
-- UI 에서 같은 시각에 동일 보상이 여러 건 → "중복으로 적립된 거 같다" 사용자 신고 (build 76 회고).
-- 실제 중복은 없음 (activity_id 검증 → 1:1). 시각적 혼동만 해결.
--
-- 처치: metadata.activity_id 가 있는 row 의 created_at 을 해당 활동의 started_at (없으면 activity_date 정오) 로 갱신.
-- streak/monthly_goal/signup/friend_invite 등 활동 비종속 이벤트는 그대로.

UPDATE public.mileage_transactions mt
   SET created_at = COALESCE(a.started_at, (a.activity_date || ' 12:00:00')::timestamptz)
  FROM public.activities a
 WHERE mt.created_at = '2026-05-10 07:02:36.504836+00'
   AND mt.metadata IS NOT NULL
   AND (mt.metadata->>'activity_id') IS NOT NULL
   AND (mt.metadata->>'activity_id')::uuid = a.id;
