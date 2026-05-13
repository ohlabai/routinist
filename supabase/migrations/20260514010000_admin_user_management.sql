-- 2026-05-14 build 110 — 어드민 회원 관리 (감추기 / 삭제)
-- 데모 러너처럼 노출되면 안 되는 계정을 어드민이 직접 처리.

------------------------------------------------------------
-- (A) admin_list_users — 모든 사용자 + 활동/사진 카운트 + email (auth.users)
-- 어드민만 접근, 검색어 + 페이지네이션.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  region_gu TEXT,
  is_public BOOLEAN,
  total_runs INTEGER,
  total_distance_km NUMERIC,
  created_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;

  RETURN QUERY
  SELECT
    p.id,
    u.email::TEXT,
    p.display_name,
    p.avatar_url,
    p.region_gu,
    p.is_public,
    p.total_runs,
    p.total_distance_km,
    p.created_at,
    (SELECT MAX(a.activity_date) FROM public.activities a WHERE a.user_id = p.id)::TIMESTAMPTZ
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE
    p_search IS NULL
    OR length(trim(p_search)) = 0
    OR p.display_name ILIKE '%' || p_search || '%'
    OR u.email ILIKE '%' || p_search || '%'
  ORDER BY p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users(TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, INTEGER, INTEGER) TO authenticated;

------------------------------------------------------------
-- (B) admin_set_user_public — 사용자 감추기/노출 토글
-- profiles.is_public 변경. is_public=false 면 갤러리/소셜/랭킹 노출 안 됨.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_public(
  p_user_id UUID,
  p_is_public BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  UPDATE public.profiles SET is_public = p_is_public WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '사용자를 찾을 수 없어요'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_public(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_public(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_public(UUID, BOOLEAN) TO authenticated;

------------------------------------------------------------
-- (C) admin_delete_user — 영구 삭제 (CASCADE)
-- auth.users 삭제 → profiles/activities/photos/quotes/feedback 등 모두 cascade.
-- 다른 어드민 (hans/claire) 은 삭제 못 함. 본인 삭제도 안 됨 (실수 방지).
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_target_email TEXT;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF v_caller = p_user_id THEN RAISE EXCEPTION '본인 계정은 어드민에서 삭제할 수 없어요'; END IF;

  SELECT email::TEXT INTO v_target_email FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '사용자를 찾을 수 없어요'; END IF;

  -- 다른 어드민 보호 — admin_emails 리스트 의 hans/claire 등은 삭제 차단.
  -- (현재 is_shop_admin 은 email 기반. 동일 함수로 체크.)
  IF v_target_email IN ('hans@openhan.kr', 'claire@openhan.kr') THEN
    RAISE EXCEPTION '다른 관리자 계정은 삭제할 수 없어요';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
