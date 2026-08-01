-- 심박존 Zone1~5 (회원 요청, 2026-08-01): 활동별 존 체류 시간 캐시.
-- 형식: {"z":[z1s,z2s,z3s,z4s,z5s],"max_hr":190,"src":"hk","computed_at":"ISO"}
-- 계산 주체 = 클라이언트 (iOS HealthKit 심박 샘플, 본인 활동 열람 시 1회) — 서버 작업 없음.
-- 존 경계는 워치 WorkoutManager.currentZone 과 동일: %maxHR <60/70/80/90/이상.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS hr_zones jsonb;
