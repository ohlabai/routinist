-- build 290 P1: activities 중복 방지를 DB 레벨로 격상
--
-- 배경: health-sync 의 중복 방지가 100% 클라이언트 휴리스틱이라 "타임아웃 = 실패로 간주 후 재시도"
-- 하는 모든 경로 (chunk insert 15s 타임아웃 후 row-by-row 재삽입 / mutex 35s 해제 후 재시도 /
-- 다중 기기 동시 sync) 가 각각 중복 삽입 벡터였음 (build 222/245/255 dedup 패치 반복의 근본 원인).
--
-- (user_id, source, started_at) 전체 unique index.
-- - started_at IS NULL 행 (수동 기록, 일별 합산 폴백) 은 NULLS DISTINCT 기본 동작으로 충돌 없음
-- - 클라이언트는 insert → upsert(onConflict, ignoreDuplicates) 로 전환 (같은 커밋)
-- - partial index (WHERE started_at IS NOT NULL) 를 안 쓰는 이유: PostgREST on_conflict 는
--   partial index 의 arbiter WHERE 절을 지정할 수 없어 ON CONFLICT 추론이 실패함
--
-- 적용 시점 prod 중복 검사: (user_id, source, started_at) 그룹 count>1 = 0건 확인 (2026-07-06)

CREATE UNIQUE INDEX IF NOT EXISTS activities_user_source_started_uniq
  ON public.activities (user_id, source, started_at);
