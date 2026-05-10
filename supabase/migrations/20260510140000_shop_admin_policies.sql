-- 쇼핑 어드민 정책 — hans@openhan.kr 이 모든 주문/결제 조회 + 운송장 입력.
-- 별도 admin 역할 테이블 만들 수도 있지만 현재 단일 운영자라 email 직접 검사.
-- 다중 운영자 시 profiles.role='admin' 필드 또는 admin_users 테이블로 확장.

CREATE OR REPLACE FUNCTION public.is_shop_admin() RETURNS BOOLEAN
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  RETURN v_email = 'hans@openhan.kr';
END $$;

REVOKE ALL ON FUNCTION public.is_shop_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_shop_admin() TO authenticated;

-- orders: 어드민은 모든 주문 SELECT + UPDATE
DROP POLICY IF EXISTS orders_admin_select ON public.orders;
CREATE POLICY orders_admin_select ON public.orders
  FOR SELECT USING (public.is_shop_admin());

DROP POLICY IF EXISTS orders_admin_update ON public.orders;
CREATE POLICY orders_admin_update ON public.orders
  FOR UPDATE USING (public.is_shop_admin());

-- order_items: 어드민이 어드민 콘솔에서 주문 상세 조회용
DROP POLICY IF EXISTS order_items_admin_select ON public.order_items;
CREATE POLICY order_items_admin_select ON public.order_items
  FOR SELECT USING (public.is_shop_admin());

-- shop_payments: 어드민이 결제 기록 열람
DROP POLICY IF EXISTS shop_payments_admin_select ON public.shop_payments;
CREATE POLICY shop_payments_admin_select ON public.shop_payments
  FOR SELECT USING (public.is_shop_admin());

-- products: 어드민이 INSERT/UPDATE/DELETE (직접 등록한 상품 관리)
DROP POLICY IF EXISTS products_admin_insert ON public.products;
CREATE POLICY products_admin_insert ON public.products
  FOR INSERT WITH CHECK (public.is_shop_admin());

DROP POLICY IF EXISTS products_admin_update ON public.products;
CREATE POLICY products_admin_update ON public.products
  FOR UPDATE USING (public.is_shop_admin());

DROP POLICY IF EXISTS products_admin_delete ON public.products;
CREATE POLICY products_admin_delete ON public.products
  FOR DELETE USING (public.is_shop_admin());

-- shop_product_variants: 어드민이 옵션 관리
DROP POLICY IF EXISTS variants_admin_insert ON public.shop_product_variants;
CREATE POLICY variants_admin_insert ON public.shop_product_variants
  FOR INSERT WITH CHECK (public.is_shop_admin());

DROP POLICY IF EXISTS variants_admin_update ON public.shop_product_variants;
CREATE POLICY variants_admin_update ON public.shop_product_variants
  FOR UPDATE USING (public.is_shop_admin());

DROP POLICY IF EXISTS variants_admin_delete ON public.shop_product_variants;
CREATE POLICY variants_admin_delete ON public.shop_product_variants
  FOR DELETE USING (public.is_shop_admin());

------------------------------------------------------------
-- 운송장 입력 RPC — paid → shipped 전환 (admin 전용)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mark_order_shipped(
  p_order_id UUID,
  p_carrier TEXT,
  p_tracking_no TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다';
  END IF;
  UPDATE public.orders
     SET status = 'shipped',
         shipped_at = NOW(),
         tracking_carrier = p_carrier,
         tracking_no = p_tracking_no
   WHERE id = p_order_id AND status = 'paid';
  IF NOT FOUND THEN
    RAISE EXCEPTION '결제 완료 상태가 아닌 주문입니다';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_mark_order_shipped(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_shipped(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_order_delivered(
  p_order_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다';
  END IF;
  UPDATE public.orders
     SET status = 'delivered',
         delivered_at = NOW()
   WHERE id = p_order_id AND status IN ('paid', 'shipped');
  IF NOT FOUND THEN
    RAISE EXCEPTION '배송 가능 상태가 아닌 주문입니다';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_mark_order_delivered(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_delivered(UUID) TO authenticated;
