-- build 293: Supabase pg_cron 대체 스케줄러
--
-- 배경: Vercel cron 이 2026-06-07 부터 플랫폼 레벨에서 미발사 (마지막 push 발송 6/6.
-- trailingSlash 308 fix + vercel.json 경로 교정 + skipTrailingSlashRedirect 배포 후에도
-- 미발사 — Hobby 플랜 cron 제한 (2개/일 1회) 추정, 대시보드 확인 필요).
-- pg_cron + pg_net 으로 vercel.json 과 동일한 스케줄을 DB 가 직접 HTTP 호출한다.
-- Vercel cron 이 복구돼 이중 호출이 되어도 안전: push 발송기는 claim-lock (build 291),
-- 나머지 cron 은 각자 dedup 키/멱등 설계.
--
-- 인증: Authorization Bearer PUSH_CRON_SECRET (cron-auth 가 build 293 에서 전역 fallback 승격).
-- 스케줄은 전부 UTC (vercel.json 과 동일 표기).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 시크릿/베이스 URL 은 Vault 대신 상수 인라인 (이 값은 이미 서버 코드·메모리에 존재하는
-- 내부 시크릿. RLS 로 cron.job 테이블은 postgres 전용이라 노출면 동일).
DO $$
DECLARE
  v_base text := 'https://app.routinist.kr';
  v_auth jsonb := jsonb_build_object(
    'Authorization', 'Bearer dc5e63d32bedc744d686b369c2a834fa',
    'Content-Type', 'application/json'
  );
  v_job record;
BEGIN
  -- 재실행 멱등: 기존 routinist_ 잡 제거 후 재등록
  FOR v_job IN SELECT jobid, jobname FROM cron.job WHERE jobname LIKE 'routinist_%' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule('routinist_push_send', '* * * * *',
    format($f$SELECT net.http_post('%s/api/push/send', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 8000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_cleanup_stale_orders', '*/5 * * * *',
    format($f$SELECT net.http_post('%s/api/cron/cleanup-stale-orders', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 15000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_cafe24_import', '0 19 * * *',
    format($f$SELECT net.http_post('%s/api/cafe24/import', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 30000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_engagement', '0 11 * * *',
    format($f$SELECT net.http_post('%s/api/cron/engagement', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 30000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_world_chase', '0 */4 * * *',
    format($f$SELECT net.http_post('%s/api/cron/world-chase', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 30000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_assign_rivals', '30 15 28-31 * *',
    format($f$SELECT net.http_post('%s/api/cron/assign-rivals', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 30000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_rival_callouts', '0 9 * * *',
    format($f$SELECT net.http_post('%s/api/cron/rival-callouts', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 30000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_rival_monthly_winner', '55 14 * * *',
    format($f$SELECT net.http_post('%s/api/cron/rival-monthly-winner', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 30000)$f$, v_base, v_auth));
  PERFORM cron.schedule('routinist_push_health', '0 22 * * *',
    format($f$SELECT net.http_post('%s/api/cron/push-health', '{}'::jsonb, '{}'::jsonb, %L::jsonb, 30000)$f$, v_base, v_auth));
END $$;
