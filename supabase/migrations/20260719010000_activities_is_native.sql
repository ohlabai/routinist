-- 2026-07-19: 네이티브 RunSession 엔진 측정 기록 표시 컬럼.
-- 배경 (성차민 신고): 나이키 런 클럽과 동시 실행 시 나이키가 HealthKit 에 쓴 워크아웃이
-- ±60초 매칭으로 루티니스트 네이티브 기록에 붙어 gps→health_kit "upgrade" 가 거리/페이스를
-- 덮어씀 (6.5km → 5km). 거리 소스 우선순위 룰 (4d8ca1f: 네이티브 엔진 = 진실) 을
-- health-sync 경로에서도 지키려면 네이티브/레거시 gps 를 DB 에서 구분할 수 있어야 함.
-- 기존 행은 구분 불가 → default false (레거시 취급). 소스 allowlist 가드가 2차 방어.
alter table public.activities
  add column if not exists is_native boolean not null default false;

comment on column public.activities.is_native is
  '네이티브 RunSession 엔진 측정 여부. true 면 HealthKit/Health Connect 후행 보정(gps→hk upgrade, route distance fix) 대상에서 제외.';
