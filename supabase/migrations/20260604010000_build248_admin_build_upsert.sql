-- build 248: 어드민이 Build Dashboard 에 빌드/체크리스트 항목을 직접 추가·수정·삭제.
-- 자동화(npm run track-build) 가 누락하거나 사후 보정해야 할 때 사용.

-- 1) 빌드 자체 upsert
CREATE OR REPLACE FUNCTION public.admin_upsert_build(
  p_build_number INTEGER,
  p_title TEXT,
  p_released_at DATE,
  p_marketing_version TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_commit_sha TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF p_build_number IS NULL OR p_build_number <= 0 THEN RAISE EXCEPTION 'invalid build_number'; END IF;
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN RAISE EXCEPTION 'title is required'; END IF;
  IF p_released_at IS NULL THEN RAISE EXCEPTION 'released_at is required'; END IF;

  INSERT INTO public.build_releases (build_number, marketing_version, title, summary, commit_sha, released_at)
  VALUES (p_build_number, p_marketing_version, trim(p_title), p_summary, p_commit_sha, p_released_at)
  ON CONFLICT (build_number) DO UPDATE
    SET marketing_version = EXCLUDED.marketing_version,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        commit_sha = EXCLUDED.commit_sha,
        released_at = EXCLUDED.released_at;
  RETURN p_build_number;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_build FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_build TO authenticated;

-- 2) 빌드 삭제 (체크리스트도 cascade)
CREATE OR REPLACE FUNCTION public.admin_delete_build(p_build_number INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  DELETE FROM public.build_test_results
    WHERE checklist_id IN (SELECT id FROM public.build_test_checklist WHERE build_number = p_build_number);
  DELETE FROM public.build_test_checklist WHERE build_number = p_build_number;
  DELETE FROM public.build_releases WHERE build_number = p_build_number;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_build FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_build TO authenticated;

-- 3) 체크리스트 항목 upsert. p_id NULL 이면 INSERT, 있으면 UPDATE.
CREATE OR REPLACE FUNCTION public.admin_upsert_checklist_item(
  p_build_number INTEGER,
  p_category TEXT,
  p_title TEXT,
  p_id UUID DEFAULT NULL,
  p_ord INTEGER DEFAULT NULL,
  p_detail TEXT DEFAULT NULL,
  p_expected TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id UUID;
  v_ord INTEGER;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF p_build_number IS NULL THEN RAISE EXCEPTION 'build_number is required'; END IF;
  IF p_category IS NULL OR length(trim(p_category)) = 0 THEN RAISE EXCEPTION 'category is required'; END IF;
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN RAISE EXCEPTION 'title is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.build_releases WHERE build_number = p_build_number) THEN
    RAISE EXCEPTION '빌드 %가 존재하지 않아요 (먼저 빌드를 추가해주세요)', p_build_number;
  END IF;

  IF p_ord IS NULL THEN
    SELECT COALESCE(MAX(ord), 0) + 1 INTO v_ord
      FROM public.build_test_checklist
      WHERE build_number = p_build_number AND category = trim(p_category);
  ELSE
    v_ord := p_ord;
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.build_test_checklist
      SET category = trim(p_category),
          title = trim(p_title),
          detail = p_detail,
          expected = p_expected,
          ord = v_ord
      WHERE id = p_id AND build_number = p_build_number;
    IF NOT FOUND THEN RAISE EXCEPTION '항목을 찾을 수 없어요'; END IF;
    v_id := p_id;
  ELSE
    INSERT INTO public.build_test_checklist (build_number, category, ord, title, detail, expected)
      VALUES (p_build_number, trim(p_category), v_ord, trim(p_title), p_detail, p_expected)
      RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_checklist_item FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_checklist_item TO authenticated;

-- 4) 체크리스트 항목 삭제 (test_result 도 cascade)
CREATE OR REPLACE FUNCTION public.admin_delete_checklist_item(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  DELETE FROM public.build_test_results WHERE checklist_id = p_id;
  DELETE FROM public.build_test_checklist WHERE id = p_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_checklist_item FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_checklist_item TO authenticated;
