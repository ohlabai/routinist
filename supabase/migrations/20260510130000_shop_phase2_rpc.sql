-- 쇼핑 RPC — 주문 생성 / 결제 확정 / 취소.
--
-- 토스페이먼츠 결제 흐름:
-- 1. client → create_order_draft(items, address, mileage_use)
--    → orders.status='pending', subtotal/total 계산 + 재고 검증 (락). order_id + total 반환
-- 2. client → 토스 SDK 띄우기 (orderId=order.order_no, amount=total)
-- 3. 토스 결제 성공 → success url → server side `/api/payments/toss/confirm`
--    → server: 토스 API verify → mark_order_paid RPC (재고 차감 + 마일리지 차감 + 주문 paid)
-- 4. 실패 / 취소: cancel_order RPC
--
-- Idempotency: payment_key 유니크 인덱스 + status check 으로 중복 방지.

------------------------------------------------------------
-- create_order_draft — 주문서 생성 (pending 상태)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_draft(
  p_items JSONB,            -- [{product_id, variant_id?, quantity}]
  p_address JSONB,          -- {recipient, phone, postal_code, address_line1, address_line2?, memo?}
  p_mileage_use INTEGER DEFAULT 0
)
RETURNS TABLE(
  order_id UUID,
  order_no TEXT,
  subtotal_krw INTEGER,
  shipping_fee_krw INTEGER,
  total_krw INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order_id UUID;
  v_order_no TEXT;
  v_subtotal INTEGER := 0;
  v_shipping INTEGER := 3000;       -- 기본 배송비 (5만원 이상 무료)
  v_total INTEGER;
  v_balance INTEGER;
  v_item JSONB;
  v_product RECORD;
  v_variant RECORD;
  v_unit_price INTEGER;
  v_qty INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '주문할 상품이 없습니다';
  END IF;

  IF p_address IS NULL OR p_address->>'recipient' IS NULL OR p_address->>'phone' IS NULL OR p_address->>'address_line1' IS NULL THEN
    RAISE EXCEPTION '배송지 정보가 부족합니다';
  END IF;

  -- 마일리지 잔액 검증
  IF p_mileage_use > 0 THEN
    SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    IF COALESCE(v_balance, 0) < p_mileage_use THEN
      RAISE EXCEPTION '마일리지가 부족합니다 (보유 %P, 사용 %P)', v_balance, p_mileage_use;
    END IF;
  END IF;

  -- 1차 패스: 가격 계산 + 재고 검증 (FOR UPDATE 로 락)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::INTEGER;
    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION '잘못된 수량';
    END IF;

    SELECT * INTO v_product FROM public.products
     WHERE id = (v_item->>'product_id')::UUID AND status = 'published'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '판매 중이 아닌 상품입니다';
    END IF;

    IF (v_item ? 'variant_id') AND (v_item->>'variant_id') IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.shop_product_variants
       WHERE id = (v_item->>'variant_id')::UUID AND product_id = v_product.id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION '상품 옵션을 찾을 수 없습니다';
      END IF;
      IF v_variant.stock < v_qty THEN
        RAISE EXCEPTION '재고가 부족합니다 — % %: 보유 %, 요청 %', v_product.name, v_variant.option_value, v_variant.stock, v_qty;
      END IF;
      v_unit_price := v_product.price_krw + v_variant.price_delta_krw;
    ELSE
      IF v_product.stock < v_qty THEN
        RAISE EXCEPTION '재고가 부족합니다 — %: 보유 %, 요청 %', v_product.name, v_product.stock, v_qty;
      END IF;
      v_unit_price := v_product.price_krw;
    END IF;

    v_subtotal := v_subtotal + v_unit_price * v_qty;
  END LOOP;

  -- 배송비 (5만원 이상 무료) - 정책 상수. 변경 시 mileage_reward_config 같은 별도 테이블로 확장 가능
  IF v_subtotal >= 50000 THEN v_shipping := 0; END IF;
  v_total := v_subtotal + v_shipping - p_mileage_use;
  IF v_total < 0 THEN
    RAISE EXCEPTION '결제 금액이 0원 미만입니다';
  END IF;

  -- 주문번호 생성 — R + YYYYMMDD + 6자리 random (충돌 시 unique 인덱스가 막음. 재시도 logic 은 client)
  v_order_no := 'R' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') || '-' ||
                lpad((floor(random() * 1000000))::TEXT, 6, '0');

  -- 주문 생성
  INSERT INTO public.orders (
    user_id, status, order_no,
    subtotal_krw, shipping_fee_krw, mileage_used, total_krw,
    shipping_name, shipping_phone, shipping_postal_code,
    shipping_address, shipping_address_line2, shipping_memo
  ) VALUES (
    v_user_id, 'pending', v_order_no,
    v_subtotal, v_shipping, p_mileage_use, v_total,
    p_address->>'recipient', p_address->>'phone', p_address->>'postal_code',
    p_address->>'address_line1', p_address->>'address_line2', p_address->>'memo'
  ) RETURNING id INTO v_order_id;

  -- 2차 패스: order_items insert (가격은 1차 패스 시점 스냅샷)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::INTEGER;
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::UUID;

    IF (v_item ? 'variant_id') AND (v_item->>'variant_id') IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.shop_product_variants WHERE id = (v_item->>'variant_id')::UUID;
      v_unit_price := v_product.price_krw + v_variant.price_delta_krw;
      INSERT INTO public.order_items (order_id, product_id, variant_id, product_name, variant_label, unit_price_krw, quantity, subtotal_krw, thumbnail_url)
      VALUES (v_order_id, v_product.id, v_variant.id, v_product.name, v_variant.option_value, v_unit_price, v_qty, v_unit_price * v_qty, v_product.thumbnail_url);
    ELSE
      v_unit_price := v_product.price_krw;
      INSERT INTO public.order_items (order_id, product_id, product_name, unit_price_krw, quantity, subtotal_krw, thumbnail_url)
      VALUES (v_order_id, v_product.id, v_product.name, v_unit_price, v_qty, v_unit_price * v_qty, v_product.thumbnail_url);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_order_id, v_order_no, v_subtotal, v_shipping, v_total;
END $$;

REVOKE ALL ON FUNCTION public.create_order_draft(JSONB, JSONB, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_draft(JSONB, JSONB, INTEGER) TO authenticated;

------------------------------------------------------------
-- mark_order_paid — 결제 PG verify 이후 호출 (server side only)
-- 재고 차감 + 마일리지 차감 + 주문 status 'paid' 원자적 처리
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
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '주문을 찾을 수 없습니다';
  END IF;

  -- Idempotency — 같은 payment_key 로 이미 처리된 경우 OK 반환
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

  -- 재고 차감 (variant 가 있으면 variant 만, 없으면 products)
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

  -- 마일리지 차감 (직접 update + transaction record. spend_mileage RPC 가 있지만 RLS/시그니처 의존 회피)
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

  -- 주문 paid
  UPDATE public.orders
     SET status = 'paid', paid_at = NOW(), payment_method = p_method, payment_id = p_payment_key
   WHERE id = p_order_id;

  -- 결제 기록
  INSERT INTO public.shop_payments
    (order_id, provider, provider_payment_key, provider_order_id, method,
     amount_krw, status, raw_response, approved_at)
  VALUES
    (p_order_id, p_provider, p_payment_key, v_order.order_no, p_method,
     p_amount, 'done', p_raw_response, NOW());

  RETURN true;
END $$;

-- mark_order_paid 는 service_role 만 (Vercel API route 가 service key 로 호출)
REVOKE ALL ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;

------------------------------------------------------------
-- cancel_order — 결제 전/후 취소
-- 결제 후라면 재고 복구 + 마일리지 환원
-- 외부 PG 환불 호출은 별도 (server side, /api/payments/toss/cancel)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id UUID,
  p_reason TEXT DEFAULT NULL
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
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '주문을 찾을 수 없습니다';
  END IF;

  -- 본인 또는 admin
  v_is_admin := EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id AND email = 'hans@openhan.kr');
  IF v_user_id <> v_order.user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  -- 이미 취소/환불 → idempotent
  IF v_order.status IN ('cancelled', 'refunded') THEN
    RETURN true;
  END IF;

  IF v_order.status = 'delivered' THEN
    RAISE EXCEPTION '배송 완료된 주문은 반품 절차로 처리해야 합니다';
  END IF;

  -- 결제 후라면 재고 복구 + 마일리지 환원
  IF v_order.status IN ('paid', 'shipped') THEN
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
  END IF;

  -- 주문 status update (결제 전 = cancelled, 결제 후 = refunded)
  UPDATE public.orders
     SET status = CASE WHEN v_order.status = 'pending' THEN 'cancelled' ELSE 'refunded' END,
         cancelled_at = NOW(),
         cancelled_reason = p_reason
   WHERE id = p_order_id;

  -- 결제 기록 환불 표시
  UPDATE public.shop_payments
     SET status = 'refunded',
         refunded_amount_krw = amount_krw,
         cancelled_at = NOW()
   WHERE order_id = p_order_id AND status = 'done';

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.cancel_order(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID, TEXT) TO authenticated;
