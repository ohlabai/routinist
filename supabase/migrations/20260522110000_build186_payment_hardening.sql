-- build 186 결제 hardening (출시 직전 5개 영역 풀 리뷰 critical 결과).
--
-- (1) cancel_order: 환불 시 적립된 1% 회수 (mileage fraud 차단)
--     기존: mileage_used (사용분) 만 환원.
--     문제: 결제→환불 무한 반복으로 1% 적립만 누적되는 farming 가능.
-- (2) spend_mileage / award_run_mileage: 음수·NULL amount 가드
--     build 179 가 gift_mileage 만 fix. legacy 함수 2개 동일 패턴 적용.
-- (3) cancel_order: paid 상태 보호용 옵션 추가
--     기존: paid 도 무조건 refunded 로 전환. fail 페이지에서 잘못 호출 시 orphan.
--     해결: p_only_if_pending = true 면 pending 외 상태는 skip (RETURN true).
-- (4) search_path 누락 함수 보강 (build 179 와 일관성).

-- =============================================================================
-- (1) + (3) cancel_order 재정의
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id UUID,
  p_reason TEXT DEFAULT '',
  p_only_if_pending BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order RECORD;
  v_item RECORD;
  v_balance_after INTEGER;
  v_is_admin BOOLEAN;
  v_earned INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '주문을 찾을 수 없습니다';
  END IF;

  -- service_role (webhook/cron) 또는 shop admin 또는 본인
  v_is_admin := public.is_shop_admin() OR auth.role() = 'service_role';
  IF v_user_id IS DISTINCT FROM v_order.user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF v_order.status IN ('cancelled', 'refunded') THEN
    RETURN true;
  END IF;

  -- build 186 #3: fail 페이지에서 호출 시 paid 상태를 잘못 환불하는 orphan 차단.
  -- p_only_if_pending=true 면 pending 외에는 no-op (이미 결제된 주문은 손대지 않음).
  IF p_only_if_pending AND v_order.status <> 'pending' THEN
    RETURN true;
  END IF;

  IF v_order.status = 'delivered' AND NOT v_is_admin THEN
    RAISE EXCEPTION '배송 완료된 주문은 반품 신청을 통해서만 처리됩니다';
  END IF;

  -- 결제 후라면 재고 복구 + 마일리지 환원
  IF v_order.status IN ('paid', 'shipped', 'delivered') THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE public.shop_product_variants
           SET stock = stock + v_item.quantity
         WHERE id = v_item.variant_id;
      ELSE
        UPDATE public.products
           SET stock = stock + v_item.quantity
         WHERE id = v_item.product_id;
      END IF;
    END LOOP;

    -- (a) 사용자가 사용한 마일리지 환원
    IF v_order.mileage_used > 0 THEN
      UPDATE public.profiles
         SET mileage_balance = mileage_balance + v_order.mileage_used
       WHERE id = v_order.user_id
       RETURNING mileage_balance INTO v_balance_after;
      INSERT INTO public.mileage_transactions
        (user_id, amount, balance_after, tx_type, event_type, description, metadata)
      VALUES
        (v_order.user_id, v_order.mileage_used, v_balance_after, 'refund', 'order_refund',
         '주문 취소 환원 — ' || v_order.order_no,
         jsonb_build_object('order_id', p_order_id, 'order_no', v_order.order_no));
    END IF;

    -- (b) build 186 #1: 결제 시 적립된 1% 회수 (fraud 차단).
    -- shop_purchase 적립 transaction 의 amount 합을 회수. 잔액 음수 되지 않게 GREATEST.
    SELECT COALESCE(SUM(amount), 0)::INTEGER INTO v_earned
      FROM public.mileage_transactions
     WHERE event_type = 'shop_purchase'
       AND tx_type = 'reward'
       AND (metadata->>'order_id')::UUID = p_order_id;
    IF v_earned > 0 THEN
      UPDATE public.profiles
         SET mileage_balance = GREATEST(0, mileage_balance - v_earned)
       WHERE id = v_order.user_id
       RETURNING mileage_balance INTO v_balance_after;
      INSERT INTO public.mileage_transactions
        (user_id, amount, balance_after, tx_type, event_type, description, metadata)
      VALUES
        (v_order.user_id, -v_earned, v_balance_after, 'reward_clawback', 'order_refund',
         '환불에 따른 적립 회수 — ' || v_order.order_no,
         jsonb_build_object('order_id', p_order_id, 'order_no', v_order.order_no, 'clawback', true));
    END IF;
  END IF;

  UPDATE public.orders
     SET status = CASE WHEN v_order.status = 'pending' THEN 'cancelled' ELSE 'refunded' END,
         cancelled_at = NOW(),
         cancelled_reason = p_reason
   WHERE id = p_order_id;

  UPDATE public.shop_payments
     SET status = 'refunded',
         refunded_amount_krw = amount_krw,
         cancelled_at = NOW()
   WHERE order_id = p_order_id AND status = 'done';

  RETURN true;
END;
$$;

-- 기존 시그니처 backward compat 유지 (2개 인자 호출도 가능)
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID, TEXT, BOOLEAN) TO authenticated, service_role;

-- =============================================================================
-- (2) spend_mileage / award_run_mileage 음수·NULL 가드
-- =============================================================================
CREATE OR REPLACE FUNCTION public.spend_mileage(
  p_user_id UUID,
  p_amount INTEGER,
  p_order_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '마일리지 사용 금액이 잘못됐어요 (amount: %)', p_amount;
  END IF;
  UPDATE public.profiles SET mileage_balance = mileage_balance - p_amount
   WHERE id = p_user_id AND mileage_balance >= p_amount
   RETURNING mileage_balance INTO v_new_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient mileage balance'; END IF;
  INSERT INTO public.mileage_transactions (user_id, amount, balance_after, tx_type, reference_id)
  VALUES (p_user_id, -p_amount, v_new_balance, 'purchase_spend', p_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.award_run_mileage(
  p_user_id UUID,
  p_activity_id UUID,
  p_distance_km NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_points INT;
  v_new_balance INT;
BEGIN
  IF p_distance_km IS NULL OR p_distance_km <= 0 THEN
    RETURN;
  END IF;
  v_points := FLOOR(p_distance_km * 10);
  IF v_points <= 0 THEN RETURN; END IF;
  UPDATE public.profiles SET mileage_balance = mileage_balance + v_points
   WHERE id = p_user_id
   RETURNING mileage_balance INTO v_new_balance;
  INSERT INTO public.mileage_transactions
    (user_id, amount, balance_after, tx_type, reference_id, description)
  VALUES (p_user_id, v_points, v_new_balance, 'run_earn', p_activity_id,
          p_distance_km || 'km 러닝 적립');
END;
$$;
