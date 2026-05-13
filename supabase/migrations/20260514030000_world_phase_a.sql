-- 2026-05-14 build 112 — 월드런 Phase A
-- (1) 참가비 1000P 차감 (virtual_courses.entry_fee_p)
-- (2) 라이브 트래커 (fetch_course_runners RPC)
-- (3) 메달 신청 흐름 (course_medals 확장 + request_course_medal RPC)
-- 디지털 인증서 PDF 는 클라이언트 canvas 로 생성.

------------------------------------------------------------
-- (A) virtual_courses.entry_fee_p
------------------------------------------------------------
ALTER TABLE public.virtual_courses
  ADD COLUMN IF NOT EXISTS entry_fee_p INTEGER NOT NULL DEFAULT 1000;

-- seed: 거리 차등 (사용자 제안 + 보강)
UPDATE public.virtual_courses SET entry_fee_p = 500 WHERE distance_km < 20;
UPDATE public.virtual_courses SET entry_fee_p = 1000 WHERE distance_km >= 20 AND distance_km < 41;
UPDATE public.virtual_courses SET entry_fee_p = 1500 WHERE distance_km >= 41;

------------------------------------------------------------
-- (B) course_medals 확장 — 신청 폼 + 결제 상태
------------------------------------------------------------
ALTER TABLE public.course_medals
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipping_name TEXT,
  ADD COLUMN IF NOT EXISTS shipping_phone TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_zipcode TEXT,
  ADD COLUMN IF NOT EXISTS payment_amount INTEGER,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS request_status TEXT NOT NULL DEFAULT 'none'
    CHECK (request_status IN ('none','requested','paid','shipped','delivered','cancelled'));

-- 사용자 본인이 자기 medal request 조회 / 본인이 신청 (INSERT 는 RPC 만)
-- 기존 cm_select_own_or_admin 정책에 INSERT 추가
DROP POLICY IF EXISTS cm_insert_own ON public.course_medals;
CREATE POLICY cm_insert_own ON public.course_medals
  FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_shop_admin());

------------------------------------------------------------
-- (C) start_course — 참가비 차감 후 INSERT
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_course(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_fee INTEGER;
  v_balance INTEGER;
  v_new_balance INTEGER;
  v_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  -- 코스 + 참가비
  SELECT entry_fee_p, name INTO v_fee, v_name
  FROM public.virtual_courses
  WHERE id = p_course_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '비활성 코스이거나 존재하지 않아요'; END IF;

  -- 이미 시작한 코스면 무료 idempotent (참가비 중복 차감 방지)
  IF EXISTS (SELECT 1 FROM public.user_course_progress WHERE user_id = v_user_id AND course_id = p_course_id) THEN
    RETURN true;
  END IF;

  -- 잔액 확인 + 차감 (atomic)
  SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_fee THEN
    RAISE EXCEPTION '마일리지가 부족해요 (참가비 %P / 잔액 %P)', v_fee, COALESCE(v_balance, 0);
  END IF;

  v_new_balance := v_balance - v_fee;
  UPDATE public.profiles SET mileage_balance = v_new_balance WHERE id = v_user_id;

  INSERT INTO public.mileage_transactions
    (user_id, amount, balance_after, tx_type, event_type, reference_id, description, metadata)
  VALUES
    (v_user_id, -v_fee, v_new_balance, 'spend', 'course_entry', p_course_id,
     '월드런 참가 — ' || v_name,
     jsonb_build_object('course_id', p_course_id, 'course_name', v_name));

  INSERT INTO public.user_course_progress (user_id, course_id)
  VALUES (v_user_id, p_course_id)
  ON CONFLICT (user_id, course_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.start_course(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_course(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_course(UUID) TO authenticated;

------------------------------------------------------------
-- (D) fetch_course_runners — 라이브 트래커
-- 코스 시작한 모든 참가자의 진행률 + 프로필. 본인·친구·기타 분기는 클라이언트.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_course_runners(p_course_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  region_gu TEXT,
  progress_km NUMERIC,
  ratio NUMERIC,           -- 0.0~1.0
  completed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_distance NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT distance_km INTO v_distance FROM public.virtual_courses WHERE id = p_course_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    ucp.user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    p.region_gu,
    COALESCE((
      SELECT SUM(a.distance_km) FROM public.activities a
       WHERE a.user_id = ucp.user_id AND a.created_at >= ucp.started_at
    ), 0)::NUMERIC AS progress_km,
    LEAST(1.0, GREATEST(0.0,
      COALESCE((
        SELECT SUM(a.distance_km) FROM public.activities a
         WHERE a.user_id = ucp.user_id AND a.created_at >= ucp.started_at
      ), 0) / NULLIF(v_distance, 0)
    ))::NUMERIC AS ratio,
    ucp.completed_at,
    ucp.started_at
  FROM public.user_course_progress ucp
  JOIN public.profiles p ON p.id = ucp.user_id
  WHERE ucp.course_id = p_course_id
    AND p.is_public = true
  ORDER BY ratio DESC NULLS LAST, ucp.started_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_course_runners(UUID) TO authenticated;

------------------------------------------------------------
-- (E) request_course_medal — 완주자만 신청 가능
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_course_medal(
  p_course_id UUID,
  p_shipping_name TEXT,
  p_shipping_phone TEXT,
  p_shipping_address TEXT,
  p_shipping_zipcode TEXT,
  p_payment_amount INTEGER DEFAULT 30000
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  -- 완주자만
  IF NOT EXISTS (
    SELECT 1 FROM public.user_course_progress
    WHERE user_id = v_user_id AND course_id = p_course_id AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '완주해야 메달 신청이 가능해요';
  END IF;

  -- 이미 신청한 경우 update, 새로 신청은 insert
  INSERT INTO public.course_medals
    (user_id, course_id, awarded_at, requested_at,
     shipping_name, shipping_phone, shipping_address, shipping_zipcode,
     payment_amount, request_status)
  VALUES
    (v_user_id, p_course_id, now(), now(),
     p_shipping_name, p_shipping_phone, p_shipping_address, p_shipping_zipcode,
     COALESCE(p_payment_amount, 30000), 'requested')
  ON CONFLICT (user_id, course_id) DO UPDATE
    SET requested_at = now(),
        shipping_name = p_shipping_name,
        shipping_phone = p_shipping_phone,
        shipping_address = p_shipping_address,
        shipping_zipcode = p_shipping_zipcode,
        payment_amount = COALESCE(p_payment_amount, 30000),
        request_status = CASE WHEN public.course_medals.request_status IN ('paid','shipped','delivered')
                              THEN public.course_medals.request_status
                              ELSE 'requested' END;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.request_course_medal(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_course_medal(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_course_medal(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

------------------------------------------------------------
-- (F) fetch_my_medal_status — 본인 메달 상태 조회
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_my_medal_status(p_course_id UUID)
RETURNS TABLE (
  course_id UUID,
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
  SELECT cm.course_id, cm.awarded_at, cm.requested_at, cm.request_status,
         cm.shipping_name, cm.shipping_address, cm.payment_amount
  FROM public.course_medals cm
  WHERE cm.user_id = v_user_id AND cm.course_id = p_course_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_medal_status(UUID) TO authenticated;
