-- 2026-05-14 build 132 — 시리즈 메달 + 어드민 시리즈 편집

------------------------------------------------------------
-- (A) series_medals 테이블 — 시리즈 완주 메달 (실물 + 디지털)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.series_medals (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  series_id UUID NOT NULL REFERENCES public.course_series(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_at TIMESTAMPTZ,
  shipping_name TEXT,
  shipping_phone TEXT,
  shipping_address TEXT,
  shipping_zipcode TEXT,
  payment_amount INTEGER DEFAULT 50000,  -- 시리즈 메달 5만원 (실물 + 케이스)
  tracking_carrier TEXT,
  tracking_number TEXT,
  admin_note TEXT,
  request_status TEXT NOT NULL DEFAULT 'none' CHECK (request_status IN ('none','requested','paid','shipped','delivered','cancelled')),
  PRIMARY KEY (user_id, series_id)
);

ALTER TABLE public.series_medals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sm_select_own_or_admin ON public.series_medals;
CREATE POLICY sm_select_own_or_admin ON public.series_medals
  FOR SELECT USING (user_id = auth.uid() OR public.is_shop_admin());

DROP POLICY IF EXISTS sm_insert_own ON public.series_medals;
CREATE POLICY sm_insert_own ON public.series_medals
  FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_shop_admin());

DROP POLICY IF EXISTS sm_admin_write ON public.series_medals;
CREATE POLICY sm_admin_write ON public.series_medals
  FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

------------------------------------------------------------
-- (B) request_series_medal — 시리즈 완주자만 신청 가능
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_series_medal(
  p_series_id UUID,
  p_shipping_name TEXT,
  p_shipping_phone TEXT,
  p_shipping_address TEXT,
  p_shipping_zipcode TEXT,
  p_payment_amount INTEGER DEFAULT 50000
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_total INTEGER;
  v_completed INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  -- 시리즈 안 모든 코스 완주 확인
  SELECT COUNT(*) INTO v_total FROM public.virtual_courses WHERE series_id = p_series_id AND is_active;
  SELECT COUNT(*) INTO v_completed
    FROM public.user_course_progress ucp
    JOIN public.virtual_courses vc ON vc.id = ucp.course_id
    WHERE ucp.user_id = v_user_id AND ucp.completed_at IS NOT NULL AND vc.series_id = p_series_id;

  IF v_completed < v_total OR v_total = 0 THEN
    RAISE EXCEPTION '시리즈 모든 코스를 완주해야 메달 신청 가능 (%/% 완주)', v_completed, v_total;
  END IF;

  INSERT INTO public.series_medals
    (user_id, series_id, awarded_at, requested_at, shipping_name, shipping_phone, shipping_address, shipping_zipcode, payment_amount, request_status)
  VALUES
    (v_user_id, p_series_id, now(), now(), p_shipping_name, p_shipping_phone, p_shipping_address, p_shipping_zipcode, COALESCE(p_payment_amount, 50000), 'requested')
  ON CONFLICT (user_id, series_id) DO UPDATE
    SET requested_at = now(),
        shipping_name = p_shipping_name,
        shipping_phone = p_shipping_phone,
        shipping_address = p_shipping_address,
        shipping_zipcode = p_shipping_zipcode,
        payment_amount = COALESCE(p_payment_amount, 50000),
        request_status = CASE WHEN public.series_medals.request_status IN ('paid','shipped','delivered') THEN public.series_medals.request_status ELSE 'requested' END;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_series_medal(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

------------------------------------------------------------
-- (C) fetch_my_series_medal_status
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_my_series_medal_status(p_series_id UUID)
RETURNS TABLE (
  series_id UUID,
  awarded_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ,
  request_status TEXT,
  shipping_name TEXT,
  shipping_address TEXT,
  payment_amount INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT sm.series_id, sm.awarded_at, sm.requested_at, sm.request_status,
         sm.shipping_name, sm.shipping_address, sm.payment_amount
  FROM public.series_medals sm
  WHERE sm.user_id = v_user_id AND sm.series_id = p_series_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_my_series_medal_status(UUID) TO authenticated;

------------------------------------------------------------
-- (D) admin_list_series_medal_requests — 어드민 list (course medal 과 동일 패턴)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_series_medal_requests(
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  user_id UUID,
  series_id UUID,
  user_email TEXT,
  user_name TEXT,
  user_avatar TEXT,
  series_name TEXT,
  series_emoji TEXT,
  awarded_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ,
  request_status TEXT,
  shipping_name TEXT,
  shipping_phone TEXT,
  shipping_address TEXT,
  shipping_zipcode TEXT,
  payment_amount INTEGER,
  tracking_carrier TEXT,
  tracking_number TEXT,
  admin_note TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  RETURN QUERY
  SELECT
    sm.user_id, sm.series_id, u.email::TEXT, COALESCE(p.display_name, '익명'), p.avatar_url,
    cs.name, cs.emoji, sm.awarded_at, sm.requested_at, sm.request_status,
    sm.shipping_name, sm.shipping_phone, sm.shipping_address, sm.shipping_zipcode,
    sm.payment_amount, sm.tracking_carrier, sm.tracking_number, sm.admin_note
  FROM public.series_medals sm
  JOIN public.course_series cs ON cs.id = sm.series_id
  JOIN public.profiles p ON p.id = sm.user_id
  JOIN auth.users u ON u.id = sm.user_id
  WHERE sm.requested_at IS NOT NULL
    AND (p_status IS NULL OR sm.request_status = p_status)
  ORDER BY CASE sm.request_status WHEN 'requested' THEN 1 WHEN 'paid' THEN 2 WHEN 'shipped' THEN 3 WHEN 'delivered' THEN 4 ELSE 5 END, sm.requested_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_series_medal_requests(TEXT, INTEGER) TO authenticated;

------------------------------------------------------------
-- (E) admin_update_series_medal
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_series_medal(
  p_user_id UUID,
  p_series_id UUID,
  p_status TEXT,
  p_tracking_carrier TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF p_status NOT IN ('requested','paid','shipped','delivered','cancelled') THEN RAISE EXCEPTION '잘못된 상태'; END IF;
  UPDATE public.series_medals
     SET request_status = p_status,
         tracking_carrier = COALESCE(p_tracking_carrier, tracking_carrier),
         tracking_number = COALESCE(p_tracking_number, tracking_number),
         admin_note = COALESCE(p_admin_note, admin_note)
   WHERE user_id = p_user_id AND series_id = p_series_id;
  IF NOT FOUND THEN RAISE EXCEPTION '신청 내역을 찾을 수 없어요'; END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_series_medal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
