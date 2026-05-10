-- 상품 리뷰 — 구매 인증 사용자만 작성, 평균/카운트는 products 에 캐시.
-- 1상품 1사용자 1리뷰 (중복 방지). 별점 1-5.

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,    -- 구매 인증
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  helpful_count INT NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT false,                          -- 신고 시 숨김
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1상품 1사용자 1리뷰
CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_uniq
  ON public.product_reviews(product_id, user_id);
CREATE INDEX IF NOT EXISTS product_reviews_product_idx
  ON public.product_reviews(product_id, created_at DESC) WHERE is_hidden = false;

-- products 에 평균/카운트 캐시 (계산 RPC 호출 회피)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

-- 누구나 read (숨김 제외)
DROP POLICY IF EXISTS reviews_public_read ON public.product_reviews;
CREATE POLICY reviews_public_read ON public.product_reviews
  FOR SELECT USING (NOT is_hidden OR auth.uid() = user_id OR public.is_shop_admin());

-- 본인만 insert (구매 인증은 RPC 에서 검증)
DROP POLICY IF EXISTS reviews_insert_own ON public.product_reviews;
CREATE POLICY reviews_insert_own ON public.product_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 본인 + 어드민 update
DROP POLICY IF EXISTS reviews_update_own_or_admin ON public.product_reviews;
CREATE POLICY reviews_update_own_or_admin ON public.product_reviews
  FOR UPDATE USING (auth.uid() = user_id OR public.is_shop_admin());

-- 본인 + 어드민 delete
DROP POLICY IF EXISTS reviews_delete_own_or_admin ON public.product_reviews;
CREATE POLICY reviews_delete_own_or_admin ON public.product_reviews
  FOR DELETE USING (auth.uid() = user_id OR public.is_shop_admin());

------------------------------------------------------------
-- RPC: 리뷰 작성/수정 (구매 인증)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_product_review(
  p_product_id UUID,
  p_rating INT,
  p_body TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order_id UUID;
  v_review_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION '별점은 1-5 입니다';
  END IF;

  -- 구매 인증 — 해당 상품을 paid/shipped/delivered 상태로 주문한 적 있어야
  SELECT o.id INTO v_order_id
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
   WHERE o.user_id = v_user_id
     AND oi.product_id = p_product_id
     AND o.status IN ('paid', 'shipped', 'delivered')
   LIMIT 1;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION '구매한 상품만 리뷰할 수 있어요';
  END IF;

  INSERT INTO public.product_reviews
    (product_id, user_id, order_id, rating, body)
  VALUES (p_product_id, v_user_id, v_order_id, p_rating, NULLIF(trim(p_body), ''))
  ON CONFLICT (product_id, user_id) DO UPDATE
    SET rating = EXCLUDED.rating,
        body = EXCLUDED.body,
        updated_at = NOW()
  RETURNING id INTO v_review_id;

  -- 평균 / 카운트 갱신
  UPDATE public.products SET
    rating_count = (SELECT COUNT(*) FROM public.product_reviews WHERE product_id = p_product_id AND NOT is_hidden),
    rating_avg = COALESCE((SELECT AVG(rating)::NUMERIC(3,2) FROM public.product_reviews WHERE product_id = p_product_id AND NOT is_hidden), 0)
   WHERE id = p_product_id;

  RETURN v_review_id;
END $$;
REVOKE ALL ON FUNCTION public.upsert_product_review(UUID, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_product_review(UUID, INT, TEXT) TO authenticated;

------------------------------------------------------------
-- RPC: 리뷰 삭제 (본인) + products 캐시 갱신
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_product_review(p_review_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_product_id UUID;
BEGIN
  SELECT product_id INTO v_product_id FROM public.product_reviews
   WHERE id = p_review_id AND (user_id = v_user_id OR public.is_shop_admin());
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION '권한이 없거나 리뷰를 찾을 수 없어요';
  END IF;
  DELETE FROM public.product_reviews WHERE id = p_review_id;
  -- 캐시 갱신
  UPDATE public.products SET
    rating_count = (SELECT COUNT(*) FROM public.product_reviews WHERE product_id = v_product_id AND NOT is_hidden),
    rating_avg = COALESCE((SELECT AVG(rating)::NUMERIC(3,2) FROM public.product_reviews WHERE product_id = v_product_id AND NOT is_hidden), 0)
   WHERE id = v_product_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.delete_product_review(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_product_review(UUID) TO authenticated;
