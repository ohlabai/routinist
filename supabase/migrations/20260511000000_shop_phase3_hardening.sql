-- 쇼핑 시스템 출시 직전 보강 — race / retry / cleanup / 위시리스트 / 검색 인덱스.
--
-- 변경:
-- (a) tg_update_timestamp search_path 일관성
-- (b) products.is_active 를 status 기반 GENERATED 컬럼으로 (이중 표기 제거)
-- (c) create_order_draft — 주문번호 collision retry loop + 0원/음수 결제 명시 거부
-- (d) cancel_order — admin 검사 is_shop_admin() 통일
-- (e) shop_wishlist 테이블 (찜)
-- (f) cleanup_stale_pending_orders RPC — 15분 이상 pending 자동 cancel (재고 락 풀어줌)
-- (g) products name/description trigram 인덱스 (한글 부분 검색 향상)

------------------------------------------------------------
-- (a) tg_update_timestamp search_path
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_update_timestamp() RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

------------------------------------------------------------
-- (b) products.is_active → GENERATED column
-- 의존 정책 (products_select) 가 is_active 참조 — drop 전 정책도 같이 갱신.
-- cafe24/import 도 INSERT 시 is_active 명시 안 하도록 동시 변경됨 (GENERATED 는 set 불가).
------------------------------------------------------------
DROP POLICY IF EXISTS products_select ON public.products;

ALTER TABLE public.products DROP COLUMN IF EXISTS is_active;
ALTER TABLE public.products
  ADD COLUMN is_active BOOLEAN
  GENERATED ALWAYS AS (status = 'published') STORED;

-- published 상품은 누구나 read (이전 정책 재생성, status 기반)
CREATE POLICY products_select ON public.products
  FOR SELECT USING (status = 'published');

------------------------------------------------------------
-- (c) create_order_draft 재정의 — retry loop + 0원 거부
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_draft(
  p_items JSONB,
  p_address JSONB,
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
  v_shipping INTEGER := 3000;
  v_total INTEGER;
  v_balance INTEGER;
  v_item JSONB;
  v_product RECORD;
  v_variant RECORD;
  v_unit_price INTEGER;
  v_qty INTEGER;
  v_attempt INTEGER := 0;
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

  IF p_mileage_use > 0 THEN
    SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    IF COALESCE(v_balance, 0) < p_mileage_use THEN
      RAISE EXCEPTION '마일리지가 부족합니다 (보유 %P, 사용 %P)', v_balance, p_mileage_use;
    END IF;
  END IF;

  -- 1차 패스: 가격 계산 + 재고 검증 (FOR UPDATE)
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

  IF v_subtotal >= 50000 THEN v_shipping := 0; END IF;
  v_total := v_subtotal + v_shipping - p_mileage_use;
  IF v_total <= 0 THEN
    RAISE EXCEPTION '결제 금액이 0원 이하입니다 (마일리지 100%% 결제는 준비 중이에요)';
  END IF;

  -- 주문번호 생성 — 충돌 시 최대 5회 retry
  LOOP
    v_attempt := v_attempt + 1;
    v_order_no := 'R' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') || '-' ||
                  lpad((floor(random() * 1000000))::TEXT, 6, '0');
    BEGIN
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
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION '주문번호 생성 실패 (재시도 한도 초과)';
      END IF;
    END;
  END LOOP;

  -- 2차 패스: order_items insert
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
-- (d) cancel_order 재정의 — is_shop_admin() 통일
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

  -- service_role (webhook/cron) 또는 shop admin 또는 본인
  v_is_admin := public.is_shop_admin() OR auth.role() = 'service_role';
  IF v_user_id IS DISTINCT FROM v_order.user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF v_order.status IN ('cancelled', 'refunded') THEN
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
END $$;

REVOKE ALL ON FUNCTION public.cancel_order(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID, TEXT) TO service_role;

------------------------------------------------------------
-- (e) shop_wishlist 테이블 (찜)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_wishlist (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS shop_wishlist_user_idx
  ON public.shop_wishlist(user_id, added_at DESC);
CREATE INDEX IF NOT EXISTS shop_wishlist_product_idx
  ON public.shop_wishlist(product_id);

ALTER TABLE public.shop_wishlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_wishlist_select_own ON public.shop_wishlist;
CREATE POLICY shop_wishlist_select_own ON public.shop_wishlist
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_wishlist_insert_own ON public.shop_wishlist;
CREATE POLICY shop_wishlist_insert_own ON public.shop_wishlist
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_wishlist_delete_own ON public.shop_wishlist;
CREATE POLICY shop_wishlist_delete_own ON public.shop_wishlist
  FOR DELETE USING (auth.uid() = user_id);

------------------------------------------------------------
-- (f) cleanup_stale_pending_orders — 15분 이상 pending → cancelled
-- Vercel Cron 5분 간격으로 호출. service_role 만 실행.
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
GRANT EXECUTE ON FUNCTION public.cleanup_stale_pending_orders() TO service_role;

------------------------------------------------------------
-- (g) products name/description trigram 인덱스 — 한글 부분 검색
------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_description_trgm_idx
  ON public.products USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;

------------------------------------------------------------
-- 푸시 트리거 정책 명시 (#16)
-- trg_order_push 는 status DISTINCT FROM OLD.status 에만 발동.
-- 어드민이 수동 status 변경 시도 같은 결제 푸시가 나가는 것이 의도 (사용자 안내 일관성).
-- "발송 안 됨" 분기 추가 필요 시 NEW.metadata->>'silent' 체크 권장.
------------------------------------------------------------
COMMENT ON FUNCTION public.tg_order_push_queue() IS
  'orders status 전이 시 push_send_log 큐잉. 어드민 수동 status 변경에도 동작 — 의도적.';

------------------------------------------------------------
-- 신규 함수/테이블 owner 정합성
------------------------------------------------------------
-- (Supabase 환경에선 postgres 가 자동 owner. 별도 설정 불필요)
