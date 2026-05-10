-- product-images 버킷 정책 — 어드민만 업로드, 누구나 read.
-- bucket 자체는 storage.buckets 에 별도 SQL 로 insert (위 마이그레이션 시점에 INSERT INTO ... ON CONFLICT 적용됨).

-- 누구나 읽기 (public 상품 이미지)
DROP POLICY IF EXISTS product_images_read ON storage.objects;
CREATE POLICY product_images_read ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

-- 어드민만 INSERT/UPDATE/DELETE (auth.uid() 가 hans@openhan.kr)
DROP POLICY IF EXISTS product_images_admin_insert ON storage.objects;
CREATE POLICY product_images_admin_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_shop_admin()
  );

DROP POLICY IF EXISTS product_images_admin_update ON storage.objects;
CREATE POLICY product_images_admin_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'product-images'
    AND public.is_shop_admin()
  );

DROP POLICY IF EXISTS product_images_admin_delete ON storage.objects;
CREATE POLICY product_images_admin_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'product-images'
    AND public.is_shop_admin()
  );
