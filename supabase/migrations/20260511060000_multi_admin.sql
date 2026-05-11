-- 2026-05-11 다중 admin 지원.
-- 기존: is_shop_admin() = email == 'hans@openhan.kr' (단일)
-- 변경: 4명 (hans, claire, dylan, jane) 모두 admin.

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

-- cancel_order 안에 직접 email 비교 남아있을지 점검 (이미 build 87 에서 is_shop_admin() 으로 통합)
-- → 위 RPC 갱신만으로 모든 admin 정책 자동 반영 (orders, products, variants, quotes 모더레이션 등)
