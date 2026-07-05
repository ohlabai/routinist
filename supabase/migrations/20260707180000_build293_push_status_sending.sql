-- build 293 hotfix: push_send_log.status CHECK 에 'sending' 추가
--
-- build 291 의 발송기 claim-lock 이 status='sending' 으로 선점하는데 CHECK 제약이
-- ('pending','sent','failed','skipped') 뿐이라 발송기 전체가 500 (배포 후 회귀 —
-- pg_net 응답 로그로 검출). 'expired' 도 함께 추가 (stale 만료 처리용 예약).

ALTER TABLE public.push_send_log DROP CONSTRAINT push_send_log_status_check;
ALTER TABLE public.push_send_log ADD CONSTRAINT push_send_log_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text, 'expired'::text]));
