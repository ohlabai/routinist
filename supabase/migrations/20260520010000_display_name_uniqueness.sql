-- build 147: 닉네임 중복 체크 RPC
-- 가입/Onboarding/프로필 편집에서 닉네임 사용 가능 여부 사전 검증.
-- profiles.display_name 에는 UNIQUE 제약을 걸지 않음 (기존 '러너' 기본값 행이 다수 존재).
-- 클라이언트에서 이 함수로 사전 검증하고, 본인 row 는 p_exclude_user 로 제외.

CREATE OR REPLACE FUNCTION public.is_display_name_available(
  p_name TEXT,
  p_exclude_user UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized TEXT;
  v_existing INT;
BEGIN
  IF p_name IS NULL THEN
    RETURN FALSE;
  END IF;

  v_normalized := lower(trim(p_name));

  -- 공백 제거 길이 2~20
  IF length(v_normalized) < 2 OR length(v_normalized) > 20 THEN
    RETURN FALSE;
  END IF;

  -- reserved 단어 (운영/시스템 사칭 방지 + 기본값 '러너')
  IF v_normalized = ANY(ARRAY[
    'admin','administrator','root','system','routinist',
    'support','help','official','staff','test','null','undefined',
    '관리자','운영자','시스템','루티니스트','러너','테스트'
  ]) THEN
    RETURN FALSE;
  END IF;

  -- 다른 사용자 중복 체크 (case-insensitive)
  SELECT COUNT(*) INTO v_existing
  FROM public.profiles
  WHERE lower(trim(display_name)) = v_normalized
    AND (p_exclude_user IS NULL OR id <> p_exclude_user);

  RETURN v_existing = 0;
END;
$$;

REVOKE ALL ON FUNCTION public.is_display_name_available(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_display_name_available(TEXT, UUID) TO anon, authenticated;

-- 빠른 case-insensitive 조회용 인덱스 (UNIQUE 가 아니라 일반 인덱스 — 기존 중복 데이터 영향 없음)
CREATE INDEX IF NOT EXISTS idx_profiles_display_name_lower
  ON public.profiles (lower(trim(display_name)));
