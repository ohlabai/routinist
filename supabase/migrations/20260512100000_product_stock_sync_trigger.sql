-- products.stock 을 shop_product_variants.stock 합계로 자동 동기화.
-- 원인: build 99 SOLD OUT 분기 (PAYMENT_LIVE && p.stock <= 0) 가 parent products.stock 만 보는데,
-- variant 기반 상품은 products.stock 이 0 → Toss 키 활성화 후 모든 상품이 SOLD OUT 표시됨.
-- 해결: variant insert/update/delete 시 products.stock = SUM(variants.stock) 자동 반영.

CREATE OR REPLACE FUNCTION public.sync_product_stock_from_variants()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  UPDATE public.products
    SET stock = COALESCE(
      (SELECT SUM(stock) FROM public.shop_product_variants
        WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)),
      0
    )
   WHERE id = COALESCE(NEW.product_id, OLD.product_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS variants_sync_parent_stock ON public.shop_product_variants;
CREATE TRIGGER variants_sync_parent_stock
  AFTER INSERT OR UPDATE OF stock OR DELETE
  ON public.shop_product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_stock_from_variants();

-- 일회성 backfill (이미 Management API 로 적용함 — 멱등)
UPDATE public.products p
   SET stock = COALESCE(
     (SELECT SUM(v.stock) FROM public.shop_product_variants v WHERE v.product_id = p.id),
     p.stock
   )
 WHERE EXISTS (SELECT 1 FROM public.shop_product_variants v WHERE v.product_id = p.id);
