-- 다중 어드민 지원 + 어드민 SELECT 정책 보강.
--
-- 배경:
-- - `20260510140000_shop_admin_policies.sql` 의 is_shop_admin() 가 hans@openhan.kr 1명만 인정
--   → 헤더에 "다중 운영자 시 확장" 이라 명시되어 있었던 의도 반영
-- - 같은 마이그가 products / shop_product_variants 에 INSERT/UPDATE/DELETE admin 정책만 만들고
--   SELECT 어드민 정책을 누락 → 어드민이 status='draft' 상품을 못 봄 (phase1 의 기본 SELECT 정책이
--   is_active = true 만 통과시키는데 draft 는 is_active=false 라 막힘)
--
-- 변경:
-- 1) is_shop_admin() 을 src/lib/admin-emails.ts 의 4명 (hans/claire/dylan/jane) 으로 확장
-- 2) products 에 admin SELECT 정책 추가
-- 3) shop_product_variants 에 admin SELECT 정책 추가

------------------------------------------------------------
-- 1) 다중 어드민 함수
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_shop_admin() RETURNS BOOLEAN
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  RETURN v_email IN (
    'hans@openhan.kr',
    'claire@openhan.kr',
    'dylan@openhan.kr',
    'jane@openhan.kr'
  );
END $$;

REVOKE ALL ON FUNCTION public.is_shop_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_shop_admin() TO authenticated;

------------------------------------------------------------
-- 2) products: 어드민은 모든 status (draft / published / archived) SELECT 가능
------------------------------------------------------------
DROP POLICY IF EXISTS products_admin_select ON public.products;
CREATE POLICY products_admin_select ON public.products
  FOR SELECT USING (public.is_shop_admin());

------------------------------------------------------------
-- 3) shop_product_variants: 어드민은 모든 상품의 옵션 SELECT 가능
--    (기존 정책은 본 상품이 published 인 경우만 허용 → draft 의 옵션이 안 보였음)
------------------------------------------------------------
DROP POLICY IF EXISTS variants_admin_select ON public.shop_product_variants;
CREATE POLICY variants_admin_select ON public.shop_product_variants
  FOR SELECT USING (public.is_shop_admin());
