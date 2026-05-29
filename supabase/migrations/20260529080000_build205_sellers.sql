-- build 205 #15: 셀러(판매자) 승인 시스템 MVP.
-- 사용자가 신청 → 어드민이 승인 → 셀러 본인이 상품 등록·관리. 정산 레코드는 추후 cron 으로 자동 생성.

------------------------------------------------------------
-- 1) seller_applications — 신청 (status: pending/approved/rejected)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seller_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  business_no TEXT NOT NULL,
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  payout_bank TEXT NOT NULL,
  payout_account TEXT NOT NULL,
  payout_holder TEXT NOT NULL,
  ship_zip TEXT NOT NULL,
  ship_address TEXT NOT NULL,
  ship_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_applications_user ON public.seller_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_applications_status ON public.seller_applications(status);

------------------------------------------------------------
-- 2) sellers — 승인된 셀러 (user_id UNIQUE; 1인 1셀러)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  business_no TEXT NOT NULL,
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  payout_bank TEXT NOT NULL,
  payout_account TEXT NOT NULL,
  payout_holder TEXT NOT NULL,
  ship_zip TEXT NOT NULL,
  ship_address TEXT NOT NULL,
  ship_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  -- 정산 수수료 (%) — 기본 10. 추후 셀러별 협상 가능.
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sellers_status ON public.sellers(status);

------------------------------------------------------------
-- 3) products.seller_id (NULL = 자사 상품)
------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_seller ON public.products(seller_id);

------------------------------------------------------------
-- 4) seller_payouts — 정산 레코드 (주차 단위, 추후 cron 으로 자동 생성)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seller_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_revenue_krw INT NOT NULL DEFAULT 0,
  commission_krw INT NOT NULL DEFAULT 0,
  payout_krw INT NOT NULL DEFAULT 0,
  order_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at TIMESTAMPTZ,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_seller ON public.seller_payouts(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_status ON public.seller_payouts(status);

------------------------------------------------------------
-- 5) updated_at trigger (sellers)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_sellers_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS sellers_updated_at ON public.sellers;
CREATE TRIGGER sellers_updated_at BEFORE UPDATE ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.tg_sellers_updated_at();

------------------------------------------------------------
-- 6) is_seller() — 본인이 active seller 인지
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_seller() RETURNS BOOLEAN
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.sellers
    WHERE user_id = auth.uid() AND status = 'active';
  RETURN v_count > 0;
END $$;
REVOKE ALL ON FUNCTION public.is_seller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_seller() TO authenticated;

------------------------------------------------------------
-- 7) RLS — seller_applications: 본인이 read/insert, 어드민 전체
------------------------------------------------------------
ALTER TABLE public.seller_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_apps_self_read ON public.seller_applications;
CREATE POLICY seller_apps_self_read ON public.seller_applications
  FOR SELECT USING (user_id = auth.uid() OR public.is_shop_admin());

DROP POLICY IF EXISTS seller_apps_self_insert ON public.seller_applications;
CREATE POLICY seller_apps_self_insert ON public.seller_applications
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS seller_apps_admin_update ON public.seller_applications;
CREATE POLICY seller_apps_admin_update ON public.seller_applications
  FOR UPDATE USING (public.is_shop_admin());

------------------------------------------------------------
-- 8) RLS — sellers: 본인이 read, 어드민 전체 update
------------------------------------------------------------
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sellers_self_read ON public.sellers;
CREATE POLICY sellers_self_read ON public.sellers
  FOR SELECT USING (user_id = auth.uid() OR public.is_shop_admin());

DROP POLICY IF EXISTS sellers_admin_insert ON public.sellers;
CREATE POLICY sellers_admin_insert ON public.sellers
  FOR INSERT WITH CHECK (public.is_shop_admin());

DROP POLICY IF EXISTS sellers_admin_update ON public.sellers;
CREATE POLICY sellers_admin_update ON public.sellers
  FOR UPDATE USING (public.is_shop_admin());

------------------------------------------------------------
-- 9) RLS — seller_payouts: 본인이 read, 어드민 전체
------------------------------------------------------------
ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payouts_self_read ON public.seller_payouts;
CREATE POLICY payouts_self_read ON public.seller_payouts
  FOR SELECT USING (
    public.is_shop_admin() OR
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_payouts.seller_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS payouts_admin_write ON public.seller_payouts;
CREATE POLICY payouts_admin_write ON public.seller_payouts
  FOR ALL USING (public.is_shop_admin());

------------------------------------------------------------
-- 10) products: 셀러는 본인 seller_id 인 상품만 INSERT/UPDATE/DELETE
--     (기존 어드민 정책 유지 + 셀러용 정책 추가)
------------------------------------------------------------
DROP POLICY IF EXISTS products_seller_insert ON public.products;
CREATE POLICY products_seller_insert ON public.products
  FOR INSERT WITH CHECK (
    seller_id IS NOT NULL AND
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = products.seller_id AND s.user_id = auth.uid() AND s.status = 'active')
  );

DROP POLICY IF EXISTS products_seller_update ON public.products;
CREATE POLICY products_seller_update ON public.products
  FOR UPDATE USING (
    seller_id IS NOT NULL AND
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = products.seller_id AND s.user_id = auth.uid() AND s.status = 'active')
  );

DROP POLICY IF EXISTS products_seller_delete ON public.products;
CREATE POLICY products_seller_delete ON public.products
  FOR DELETE USING (
    seller_id IS NOT NULL AND
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = products.seller_id AND s.user_id = auth.uid() AND s.status = 'active')
  );

-- 셀러도 본인 상품은 status 무관 SELECT 가능 (draft 도 보기)
DROP POLICY IF EXISTS products_seller_select ON public.products;
CREATE POLICY products_seller_select ON public.products
  FOR SELECT USING (
    seller_id IS NOT NULL AND
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = products.seller_id AND s.user_id = auth.uid() AND s.status = 'active')
  );

------------------------------------------------------------
-- 11) approve_seller_application RPC — 어드민이 호출. application 승인 + sellers row 생성.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_seller_application(p_application_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_app RECORD;
  v_seller_id UUID;
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  SELECT * INTO v_app FROM public.seller_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION '신청을 찾을 수 없어요'; END IF;
  IF v_app.status <> 'pending' THEN RAISE EXCEPTION '이미 처리된 신청입니다 (%)', v_app.status; END IF;

  -- sellers 에 INSERT (user_id UNIQUE 위반 시 update)
  INSERT INTO public.sellers (
    user_id, brand_name, business_no, business_name, owner_name,
    contact_phone, contact_email, payout_bank, payout_account, payout_holder,
    ship_zip, ship_address, ship_phone, status
  ) VALUES (
    v_app.user_id, v_app.brand_name, v_app.business_no, v_app.business_name, v_app.owner_name,
    v_app.contact_phone, v_app.contact_email, v_app.payout_bank, v_app.payout_account, v_app.payout_holder,
    v_app.ship_zip, v_app.ship_address, v_app.ship_phone, 'active'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    brand_name = EXCLUDED.brand_name,
    business_no = EXCLUDED.business_no,
    business_name = EXCLUDED.business_name,
    owner_name = EXCLUDED.owner_name,
    contact_phone = EXCLUDED.contact_phone,
    contact_email = EXCLUDED.contact_email,
    payout_bank = EXCLUDED.payout_bank,
    payout_account = EXCLUDED.payout_account,
    payout_holder = EXCLUDED.payout_holder,
    ship_zip = EXCLUDED.ship_zip,
    ship_address = EXCLUDED.ship_address,
    ship_phone = EXCLUDED.ship_phone,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_seller_id;

  UPDATE public.seller_applications
    SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = p_application_id;

  RETURN v_seller_id;
END $$;
REVOKE ALL ON FUNCTION public.approve_seller_application(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_seller_application(UUID) TO authenticated;

------------------------------------------------------------
-- 12) reject_seller_application RPC
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_seller_application(p_application_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  UPDATE public.seller_applications
    SET status = 'rejected', rejection_reason = p_reason, reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = p_application_id AND status = 'pending';
END $$;
REVOKE ALL ON FUNCTION public.reject_seller_application(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_seller_application(UUID, TEXT) TO authenticated;
