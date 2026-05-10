-- 네이티브 쇼핑 Phase 2 — 기존 products/orders/order_items 컬럼 확장 + 신규 테이블 추가.
-- Cafe24 의존을 끊고 자체 PG (토스페이먼츠) 통합 위한 기반.
--
-- 설계 원칙:
-- - 기존 12개 products row 보존. ALTER 로 컬럼 추가, image_url → thumbnail_url 보존
-- - 가격은 항상 INT (원). 클라이언트 사이드 부동소수점 회귀 차단
-- - 모든 신규 테이블 RLS 기본 ON
-- - external_id 는 Cafe24 (또는 다른 외부) 상품 sync 용. (source, external_id) 유니크
-- - 결제는 별도 테이블 (다중 시도 / 환불 추적)
-- - 주소 정규화 (재사용 가능한 주소록)
-- - 옵션 (사이즈/색상) variants 별도 테이블 → 재고/가격 옵션별 관리

------------------------------------------------------------
-- products 확장
------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS compare_price_krw INTEGER,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 기존 image_url → thumbnail_url 백필
UPDATE public.products SET thumbnail_url = image_url
 WHERE thumbnail_url IS NULL AND image_url IS NOT NULL;

-- is_active → status 일괄 마이그
UPDATE public.products
   SET status = CASE WHEN COALESCE(is_active, true) THEN 'published' ELSE 'archived' END
 WHERE status IS NULL OR status = 'published';  -- default 적용된 row 재정렬

-- status check
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_status_check
  CHECK (status IN ('draft', 'published', 'archived'));

-- 인덱스
CREATE INDEX IF NOT EXISTS products_status_published_idx
  ON public.products(status) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS products_featured_idx
  ON public.products(is_featured) WHERE is_featured = true AND status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS products_source_external_uniq
  ON public.products(source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_uniq
  ON public.products(slug) WHERE slug IS NOT NULL;

------------------------------------------------------------
-- orders 확장
------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_no TEXT,
  ADD COLUMN IF NOT EXISTS subtotal_krw INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_fee_krw INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_carrier TEXT,
  ADD COLUMN IF NOT EXISTS tracking_no TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- order_no 유니크 (NULL 허용)
CREATE UNIQUE INDEX IF NOT EXISTS orders_order_no_uniq
  ON public.orders(order_no) WHERE order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders(status);

-- status check 강화
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'));

------------------------------------------------------------
-- order_items 확장
------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  ADD COLUMN IF NOT EXISTS subtotal_krw INTEGER,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

------------------------------------------------------------
-- 신규: 상품 옵션 (variants)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  external_id TEXT,
  sku TEXT,
  option_name TEXT,    -- '사이즈', '색상' 등
  option_value TEXT,   -- 'M', '블랙' 등
  price_delta_krw INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_default BOOLEAN DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,  -- 표시 순서
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_variants_product_idx
  ON public.shop_product_variants(product_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS shop_variants_sku_uniq
  ON public.shop_product_variants(sku) WHERE sku IS NOT NULL;

-- order_items.variant_id → variants.id FK 추가 (variants 생성 후)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'order_items_variant_fk'
       AND table_name = 'order_items'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_variant_fk
      FOREIGN KEY (variant_id) REFERENCES public.shop_product_variants(id) ON DELETE RESTRICT;
  END IF;
END $$;

------------------------------------------------------------
-- 신규: 배송 주소 (재사용 가능한 주소록)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_shipping_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_addresses_user_idx
  ON public.shop_shipping_addresses(user_id);
-- 사용자별 default 1개만 (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS shop_addresses_default_uniq
  ON public.shop_shipping_addresses(user_id) WHERE is_default = true;

------------------------------------------------------------
-- 신규: 결제 (다중 시도 + 환불 추적)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'toss',     -- 'toss' | 'inicis' | 'mileage_only'
  provider_payment_key TEXT,
  provider_order_id TEXT,
  method TEXT,                                -- 'card' | 'kakaopay' | 'naverpay' | 'mileage'
  amount_krw INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed', 'cancelled', 'refunded', 'partial_refunded')),
  raw_response JSONB,                         -- PG 원본 응답 (감사용)
  failure_code TEXT,
  failure_reason TEXT,
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  refunded_amount_krw INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_payments_order_idx ON public.shop_payments(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS shop_payments_provider_key_uniq
  ON public.shop_payments(provider, provider_payment_key)
  WHERE provider_payment_key IS NOT NULL;

------------------------------------------------------------
-- 신규: 장바구니 (다기기 동기화)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.shop_product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_cart_user_idx ON public.shop_cart_items(user_id);
-- 같은 product+variant 조합 중복 방지 (variant null 도 동등 비교)
CREATE UNIQUE INDEX IF NOT EXISTS shop_cart_uniq
  ON public.shop_cart_items(user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

------------------------------------------------------------
-- RLS 활성화
------------------------------------------------------------
ALTER TABLE public.shop_product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_shipping_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_cart_items ENABLE ROW LEVEL SECURITY;

------------------------------------------------------------
-- RLS 정책
------------------------------------------------------------
-- variants: 본 상품이 published 면 누구나 select
DROP POLICY IF EXISTS shop_variants_select_published ON public.shop_product_variants;
CREATE POLICY shop_variants_select_published ON public.shop_product_variants
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.status = 'published')
  );

-- addresses: 본인만
DROP POLICY IF EXISTS shop_addresses_select_own ON public.shop_shipping_addresses;
CREATE POLICY shop_addresses_select_own ON public.shop_shipping_addresses
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_addresses_insert_own ON public.shop_shipping_addresses;
CREATE POLICY shop_addresses_insert_own ON public.shop_shipping_addresses
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_addresses_update_own ON public.shop_shipping_addresses;
CREATE POLICY shop_addresses_update_own ON public.shop_shipping_addresses
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_addresses_delete_own ON public.shop_shipping_addresses;
CREATE POLICY shop_addresses_delete_own ON public.shop_shipping_addresses
  FOR DELETE USING (auth.uid() = user_id);

-- payments: 본인 주문에 속한 것만 read. write 는 service_role / RPC 만.
DROP POLICY IF EXISTS shop_payments_select_own ON public.shop_payments;
CREATE POLICY shop_payments_select_own ON public.shop_payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid())
  );

-- cart: 본인만
DROP POLICY IF EXISTS shop_cart_select_own ON public.shop_cart_items;
CREATE POLICY shop_cart_select_own ON public.shop_cart_items
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_cart_insert_own ON public.shop_cart_items;
CREATE POLICY shop_cart_insert_own ON public.shop_cart_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_cart_update_own ON public.shop_cart_items;
CREATE POLICY shop_cart_update_own ON public.shop_cart_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS shop_cart_delete_own ON public.shop_cart_items;
CREATE POLICY shop_cart_delete_own ON public.shop_cart_items
  FOR DELETE USING (auth.uid() = user_id);

------------------------------------------------------------
-- updated_at 자동 갱신 트리거
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_update_timestamp() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS shop_variants_updated_at ON public.shop_product_variants;
CREATE TRIGGER shop_variants_updated_at BEFORE UPDATE ON public.shop_product_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();

DROP TRIGGER IF EXISTS shop_addresses_updated_at ON public.shop_shipping_addresses;
CREATE TRIGGER shop_addresses_updated_at BEFORE UPDATE ON public.shop_shipping_addresses
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();

DROP TRIGGER IF EXISTS shop_payments_updated_at ON public.shop_payments;
CREATE TRIGGER shop_payments_updated_at BEFORE UPDATE ON public.shop_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();

DROP TRIGGER IF EXISTS shop_cart_updated_at ON public.shop_cart_items;
CREATE TRIGGER shop_cart_updated_at BEFORE UPDATE ON public.shop_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();
