-- product_reviews 확장 — cafe24 외부 리뷰 import 지원.
-- user_id NULLABLE + source / external_author 컬럼.

ALTER TABLE public.product_reviews ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.product_reviews
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_author TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- 기존 unique 인덱스 (product_id, user_id) 는 user_id NULL 시 multiple row 허용
-- → external_id 기준 unique 추가 (source='cafe24' 일 때만)
CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_external_uniq
  ON public.product_reviews(source, external_id)
  WHERE external_id IS NOT NULL;

-- RLS: 누구나 read 정책은 그대로 (is_hidden 외)
-- INSERT/UPDATE/DELETE 는 service_role 또는 admin 만 (외부 리뷰)
-- 본인 리뷰 RPC (upsert_product_review) 는 기존대로 작동.

CREATE OR REPLACE FUNCTION public.admin_import_cafe24_review(
  p_product_id UUID,
  p_rating INT,
  p_body TEXT,
  p_external_author TEXT,
  p_external_id TEXT,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '관리자만';
  END IF;
  IF p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION '별점 1-5'; END IF;

  INSERT INTO public.product_reviews
    (product_id, user_id, rating, body, source, external_author, external_id, created_at)
  VALUES
    (p_product_id, NULL, p_rating, p_body, 'cafe24', p_external_author, p_external_id, p_created_at)
  ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    rating = EXCLUDED.rating,
    body = EXCLUDED.body,
    external_author = EXCLUDED.external_author
  RETURNING id INTO v_id;

  -- 캐시 갱신
  UPDATE public.products SET
    rating_count = (SELECT COUNT(*) FROM public.product_reviews WHERE product_id = p_product_id AND NOT is_hidden),
    rating_avg = COALESCE((SELECT AVG(rating)::NUMERIC(3,2) FROM public.product_reviews WHERE product_id = p_product_id AND NOT is_hidden), 0)
   WHERE id = p_product_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_import_cafe24_review(UUID, INT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_import_cafe24_review(UUID, INT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_import_cafe24_review(UUID, INT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
