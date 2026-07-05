-- build 294: 최종 리뷰 운영 하드닝 2건
--
-- 1. enqueue_club_course_pushes / enqueue_contest_finish_pushes — SECURITY DEFINER 인데
--    authenticated/anon EXECUTE 가 열려 있고 본문 호출자 검증이 없어, 임의 club/contest id 로
--    참가자 전원 push 삽입 가능한 스팸 벡터 (gift_mileage 사고와 동일 계열).
--    정상 호출 경로는 SECURITY DEFINER 함수 내부 (fetch_club_courses 의 PERFORM 등 —
--    owner 실행이라 EXECUTE 권한 불필요) 와 service_role 뿐.
-- 2. pg_cron 이중 발화 정리 — Vercel cron 생존 확인됨 (skipTrailingSlashRedirect fix 후
--    19:28 sent 실증). pg_cron 9잡이 동일 스케줄 중복이라 push/send 매분 2회 호출 →
--    APNs JWT churn (429 TooManyProviderTokenUpdates) 가중 + 래더 check-then-insert dedup 의
--    동시 실행 race. pg_cron 잡 전부 unschedule (마이그레이션 20260707170000 은 재활성용 보존.
--    Vercel cron 재장애 시 그 파일 재실행으로 즉시 복구).

REVOKE ALL ON FUNCTION public.enqueue_club_course_pushes(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_club_course_pushes(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_club_course_pushes(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_club_course_pushes(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_contest_finish_pushes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_contest_finish_pushes(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_contest_finish_pushes(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_contest_finish_pushes(uuid) TO service_role;

-- gift_mileage 는 본문 가드가 있으나 위생상 anon 회수
REVOKE ALL ON FUNCTION public.gift_mileage(uuid, uuid, integer) FROM anon;

DO $$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname LIKE 'routinist_%' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END $$;
