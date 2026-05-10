-- 보안 핫픽스 — supabase 가 schema 의 모든 함수에 default privilege 로
-- anon/authenticated 에 EXECUTE 부여한다. REVOKE FROM PUBLIC 만으론 부족.
-- 명시적으로 anon/authenticated 권한 제거 (service_role 만 호출 가능).
--
-- 영향 함수:
--   - mark_order_paid (service_role 만 호출해야 — anon 이 호출하면 임의 주문 paid 처리 가능)
--   - cleanup_stale_pending_orders (cron 만 호출)
--
-- 다중 방어로 함수 안에서도 auth.role() 체크 추가.

REVOKE EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_pending_orders() FROM anon, authenticated;

------------------------------------------------------------
-- mark_order_paid 안에 service_role 검증 추가 (다중 방어)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_order_paid(
  p_order_id UUID,
  p_payment_key TEXT,
  p_amount INTEGER,
  p_provider TEXT DEFAULT 'toss',
  p_method TEXT DEFAULT NULL,
  p_raw_response JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_balance_after INTEGER;
BEGIN
  -- service_role 만 (Vercel API route 가 service key 로 호출).
  -- 일반 사용자가 함수 권한을 우회 호출할 경우에 대비.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '주문을 찾을 수 없습니다';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shop_payments
     WHERE provider_payment_key = p_payment_key AND provider = p_provider AND status = 'done'
  ) THEN
    RETURN true;
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION '결제 가능 상태가 아닙니다 (현재: %)', v_order.status;
  END IF;
  IF p_amount <> v_order.total_krw THEN
    RAISE EXCEPTION '결제 금액 불일치 (주문: %원, 결제: %원)', v_order.total_krw, p_amount;
  END IF;

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
  LOOP
    IF v_item.variant_id IS NOT NULL THEN
      UPDATE public.shop_product_variants
         SET stock = stock - v_item.quantity
       WHERE id = v_item.variant_id AND stock >= v_item.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION '재고 부족 — % 옵션', v_item.product_name;
      END IF;
    ELSE
      UPDATE public.products
         SET stock = stock - v_item.quantity
       WHERE id = v_item.product_id AND stock >= v_item.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION '재고 부족 — %', v_item.product_name;
      END IF;
    END IF;
  END LOOP;

  IF v_order.mileage_used > 0 THEN
    UPDATE public.profiles
       SET mileage_balance = mileage_balance - v_order.mileage_used
     WHERE id = v_order.user_id AND mileage_balance >= v_order.mileage_used
     RETURNING mileage_balance INTO v_balance_after;
    IF NOT FOUND THEN
      RAISE EXCEPTION '마일리지 잔액 부족 (결제 시점)';
    END IF;
    INSERT INTO public.mileage_transactions
      (user_id, amount, balance_after, tx_type, event_type, description, metadata)
    VALUES
      (v_order.user_id, -v_order.mileage_used, v_balance_after, 'purchase_spend', 'order_payment',
       '주문 결제 — ' || v_order.order_no,
       jsonb_build_object('order_id', p_order_id, 'order_no', v_order.order_no));
  END IF;

  UPDATE public.orders
     SET status = 'paid', paid_at = NOW(), payment_method = p_method, payment_id = p_payment_key
   WHERE id = p_order_id;

  INSERT INTO public.shop_payments
    (order_id, provider, provider_payment_key, provider_order_id, method,
     amount_krw, status, raw_response, approved_at)
  VALUES
    (p_order_id, p_provider, p_payment_key, v_order.order_no, p_method,
     p_amount, 'done', p_raw_response, NOW());

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;

------------------------------------------------------------
-- cleanup_stale_pending_orders 도 service_role 검증 추가
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_stale_pending_orders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;
  WITH cancelled AS (
    UPDATE public.orders
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancelled_reason = '15분 결제 미완료 자동 취소'
     WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '15 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM cancelled;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.cleanup_stale_pending_orders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_pending_orders() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_pending_orders() TO service_role;
