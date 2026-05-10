-- 쇼핑 Phase 4 — 보강 + 인게이지먼트.
-- 1) 11개 SECURITY DEFINER 함수의 anon EXECUTE 명시 차단 (다중 방어)
-- 2) 구매 시 마일리지 1% 자동 적립 (mark_order_paid 안에 통합)
-- 3) mileage_reward_config 에 shop_purchase 이벤트 등록 (어드민 콘솔 표시용)
-- 4) 리뷰 작성 reminder cron RPC — delivered + 1~3일 사용자에게 푸시
-- 5) 재고 임박 cron RPC — 위시리스트 + stock ≤ 5 사용자에게 푸시

------------------------------------------------------------
-- (1) anon EXECUTE 명시 차단
------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_order_draft(JSONB, JSONB, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_order(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_product_review(UUID, INTEGER, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_product_review(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_device_token(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unregister_device_token(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_kpi_extended() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_mark_order_shipped(UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_mark_order_delivered(UUID) FROM anon;
-- is_shop_admin 은 anon 호출 시 false 반환 — 무해. 내부 일관성을 위해 그대로 둠.

------------------------------------------------------------
-- (2,3) 구매 시 마일리지 1% 자동 적립
------------------------------------------------------------
-- recurrence check 는 ('once','monthly','per_streak','per_milestone'). 'per_milestone' 사용.
-- amount 는 % 가 아니라 동적 계산 (mark_order_paid 안에서 paid_amount/100). amount=0 으로 표시.
INSERT INTO public.mileage_reward_config (event_type, amount, description, is_active, recurrence, cooldown_days, daily_cap)
VALUES ('shop_purchase', 0, '쇼핑 결제 1% 적립 (mark_order_paid 안 동적 계산)', true, 'per_milestone', 0, NULL)
ON CONFLICT (event_type) DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true,
  updated_at = NOW();

-- mark_order_paid 재정의 — 적립 + service_role 가드 유지
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
  v_earn_amount INTEGER;
  v_earn_active BOOLEAN;
BEGIN
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

  -- 마일리지 차감 (사용자가 사용한 마일리지)
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

  -- 구매 적립 — 실 결제액의 1% (반올림 floor). 마일리지 100% 결제는 위에서 0원 거부됨.
  -- mileage_reward_config.shop_purchase.is_active 가 false 면 적립 0.
  SELECT is_active INTO v_earn_active FROM public.mileage_reward_config WHERE event_type = 'shop_purchase';
  v_earn_amount := FLOOR(p_amount / 100);
  IF COALESCE(v_earn_active, false) AND v_earn_amount > 0 THEN
    UPDATE public.profiles
       SET mileage_balance = mileage_balance + v_earn_amount
     WHERE id = v_order.user_id
     RETURNING mileage_balance INTO v_balance_after;
    INSERT INTO public.mileage_transactions
      (user_id, amount, balance_after, tx_type, event_type, description, metadata)
    VALUES
      (v_order.user_id, v_earn_amount, v_balance_after, 'reward', 'shop_purchase',
       '쇼핑 결제 적립 (1%) — ' || v_order.order_no,
       jsonb_build_object('order_id', p_order_id, 'order_no', v_order.order_no, 'paid_amount', p_amount));
  END IF;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;

------------------------------------------------------------
-- (4) 리뷰 작성 reminder — delivered 24~72시간 사용자에게 1회 push
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_review_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  -- 배송 완료 24~72시간 + 사용자가 아직 어떤 리뷰도 안 쓴 주문
  FOR v_row IN
    SELECT DISTINCT o.id, o.user_id, o.order_no, oi.product_name
      FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      LEFT JOIN public.product_reviews pr
        ON pr.product_id = oi.product_id AND pr.user_id = o.user_id
     WHERE o.status = 'delivered'
       AND o.delivered_at BETWEEN NOW() - INTERVAL '72 hours' AND NOW() - INTERVAL '24 hours'
       AND pr.id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = o.user_id
            AND psl.category = 'review_request'
            AND (psl.payload->>'order_id')::UUID = o.id
       )
  LOOP
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'review_request',
       '리뷰 한 줄 부탁해요 ✍️',
       v_row.product_name || ' 어떠셨나요? 다른 러너들에게 공유해 주세요',
       jsonb_build_object('order_id', v_row.id, 'order_no', v_row.order_no, 'deep_link', '/shop/order?id=' || v_row.id),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_review_reminders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_review_reminders() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_review_reminders() TO service_role;

------------------------------------------------------------
-- (5) 재고 임박 — 위시리스트 + stock ≤ 5 사용자에게 1회 push
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_low_stock_wishlist()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT w.user_id, p.id AS product_id, p.name, p.stock
      FROM public.shop_wishlist w
      JOIN public.products p ON p.id = w.product_id
     WHERE p.stock > 0 AND p.stock <= 5
       AND p.status = 'published'
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = w.user_id
            AND psl.category = 'low_stock_wishlist'
            AND (psl.payload->>'product_id')::UUID = p.id
            AND psl.created_at > NOW() - INTERVAL '7 days'
       )
  LOOP
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'low_stock_wishlist',
       '🔥 찜한 상품 마지막 ' || v_row.stock || '개',
       v_row.name || ' 곧 품절될 것 같아요. 지금 확인해 보세요',
       jsonb_build_object('product_id', v_row.product_id, 'deep_link', '/shop/product?id=' || v_row.product_id),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_low_stock_wishlist() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_low_stock_wishlist() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_low_stock_wishlist() TO service_role;
