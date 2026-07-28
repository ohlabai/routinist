-- build 327 (2026-07-28): 결제 취소 실패 근본 fix
--
-- 증상: 주문 상세 "결제 취소·환불" → 항상 "취소 실패" 토스트.
-- 원인: build186 cancel_order 가 paid 주문 취소 시 구매적립 회수를
--   tx_type='reward_clawback' 으로 INSERT 하는데, mileage_transactions 의
--   tx_type CHECK 에 'reward_clawback' 이 없어 CHECK 위반 → 전체 롤백.
--   (적립이 1원이라도 있으면 100% 재현 — 사실상 모든 paid 취소가 실패)
ALTER TABLE public.mileage_transactions DROP CONSTRAINT IF EXISTS mileage_transactions_tx_type_check;
ALTER TABLE public.mileage_transactions ADD CONSTRAINT mileage_transactions_tx_type_check
  CHECK (tx_type = ANY (ARRAY['run_earn', 'purchase_spend', 'gift_send', 'gift_receive', 'admin_adjust', 'refund', 'reward', 'reward_clawback']));
