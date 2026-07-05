-- build 291: push 발송기 claim-lock 지원
--
-- 발송기가 pending 을 SELECT 만 하고 발송하던 구조에서 UPDATE(status='sending') 원자 선점으로 전환
-- (동시 invocation 중복 발송 차단 — 리뷰 P2). claimed_at 은 죽은 배치 회수용:
-- 'sending' 인데 claimed_at 이 10분 이상 지난 행은 다음 invocation 이 pending 으로 되돌린다.

ALTER TABLE public.push_send_log ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
