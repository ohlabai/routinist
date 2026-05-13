-- 2026-05-14 build 113 — 어드민 메달 관리
-- 신청 리스트 + 상태 변경 RPC + 송장 번호 컬럼.

------------------------------------------------------------
-- (A) course_medals 에 송장/메모 컬럼
------------------------------------------------------------
ALTER TABLE public.course_medals
  ADD COLUMN IF NOT EXISTS tracking_carrier TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS admin_note TEXT;

------------------------------------------------------------
-- (B) admin_list_medal_requests — 모든 신청 + 사용자/코스 정보 join
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_medal_requests(
  p_status TEXT DEFAULT NULL,    -- 'requested' | 'paid' | 'shipped' | 'delivered' | NULL(all)
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  user_id UUID,
  course_id UUID,
  user_email TEXT,
  user_name TEXT,
  user_avatar TEXT,
  course_name TEXT,
  course_distance_km NUMERIC,
  course_country TEXT,
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
    cm.user_id,
    cm.course_id,
    u.email::TEXT,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    c.name,
    c.distance_km,
    c.country,
    cm.awarded_at,
    cm.requested_at,
    cm.request_status,
    cm.shipping_name,
    cm.shipping_phone,
    cm.shipping_address,
    cm.shipping_zipcode,
    cm.payment_amount,
    cm.tracking_carrier,
    cm.tracking_number,
    cm.admin_note
  FROM public.course_medals cm
  JOIN public.virtual_courses c ON c.id = cm.course_id
  JOIN public.profiles p ON p.id = cm.user_id
  JOIN auth.users u ON u.id = cm.user_id
  WHERE cm.requested_at IS NOT NULL
    AND (p_status IS NULL OR cm.request_status = p_status)
  ORDER BY
    -- 우선순위: requested(처리해야 함) → paid → shipped → delivered
    CASE cm.request_status
      WHEN 'requested' THEN 1
      WHEN 'paid' THEN 2
      WHEN 'shipped' THEN 3
      WHEN 'delivered' THEN 4
      ELSE 5
    END,
    cm.requested_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_medal_requests(TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_medal_requests(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_medal_requests(TEXT, INTEGER) TO authenticated;

------------------------------------------------------------
-- (C) admin_update_medal — 상태 + 송장 + 메모 일괄 변경
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_medal(
  p_user_id UUID,
  p_course_id UUID,
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
  IF p_status NOT IN ('requested','paid','shipped','delivered','cancelled') THEN
    RAISE EXCEPTION '잘못된 상태';
  END IF;

  UPDATE public.course_medals
     SET request_status = p_status,
         tracking_carrier = COALESCE(p_tracking_carrier, tracking_carrier),
         tracking_number = COALESCE(p_tracking_number, tracking_number),
         admin_note = COALESCE(p_admin_note, admin_note)
   WHERE user_id = p_user_id AND course_id = p_course_id;
  IF NOT FOUND THEN RAISE EXCEPTION '신청 내역을 찾을 수 없어요'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_medal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_medal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_medal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
