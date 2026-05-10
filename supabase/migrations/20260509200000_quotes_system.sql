-- 2026-05-09: 명언 시스템
-- 1) quotes — 한/영/자기관리 카테고리, 1년치 1095개 목표
-- 2) quote_likes — 사용자 좋아요
-- 3) daily_quote(date) — 매일 1/3 카테고리 랜덤 + dayOfYear deterministic
-- 4) toggle_quote_like(quote_id) — 좋아요 토글

-- ============================================================================
-- 1. quotes 테이블
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lang TEXT NOT NULL CHECK (lang IN ('ko', 'en', 'ko_self')),
  category TEXT,
  text TEXT NOT NULL,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_lang ON public.quotes(lang);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotes_read" ON public.quotes;
CREATE POLICY "quotes_read" ON public.quotes FOR SELECT USING (true);  -- 모두 조회 가능

-- ============================================================================
-- 2. quote_likes 테이블
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quote_likes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, quote_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_likes_quote ON public.quote_likes(quote_id);

ALTER TABLE public.quote_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ql_read_own" ON public.quote_likes;
CREATE POLICY "ql_read_own" ON public.quote_likes FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ql_insert_own" ON public.quote_likes;
CREATE POLICY "ql_insert_own" ON public.quote_likes FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ql_delete_own" ON public.quote_likes;
CREATE POLICY "ql_delete_own" ON public.quote_likes FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 3. daily_quote(date) — 매일 deterministic 1/3 카테고리 랜덤
-- ============================================================================
CREATE OR REPLACE FUNCTION public.daily_quote(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (id UUID, lang TEXT, category TEXT, text TEXT, author TEXT, like_count BIGINT, liked_by_me BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_doy INT;
  v_year INT;
  v_lang_idx INT;
  v_lang TEXT;
  v_count INT;
  v_idx INT;
  v_quote_id UUID;
BEGIN
  v_doy := EXTRACT(DOY FROM p_date)::INT;
  v_year := EXTRACT(YEAR FROM p_date)::INT;
  v_lang_idx := MOD(v_doy + v_year, 3);  -- 0/1/2
  v_lang := CASE v_lang_idx WHEN 0 THEN 'ko' WHEN 1 THEN 'en' ELSE 'ko_self' END;

  SELECT COUNT(*) INTO v_count FROM public.quotes q WHERE q.lang = v_lang;
  IF v_count = 0 THEN
    -- 카테고리 비어있으면 다른 카테고리 fallback
    SELECT COUNT(*) INTO v_count FROM public.quotes;
    IF v_count = 0 THEN RETURN; END IF;
    SELECT q.id INTO v_quote_id FROM public.quotes q ORDER BY q.id OFFSET MOD(v_doy + v_year * 100, v_count) LIMIT 1;
  ELSE
    v_idx := MOD(v_doy + v_year * 100, v_count);
    SELECT q.id INTO v_quote_id FROM public.quotes q WHERE q.lang = v_lang ORDER BY q.id OFFSET v_idx LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    q.id, q.lang, q.category, q.text, q.author,
    (SELECT COUNT(*) FROM public.quote_likes ql WHERE ql.quote_id = q.id) AS like_count,
    EXISTS (SELECT 1 FROM public.quote_likes ql WHERE ql.quote_id = q.id AND ql.user_id = auth.uid()) AS liked_by_me
  FROM public.quotes q
  WHERE q.id = v_quote_id;
END $$;

GRANT EXECUTE ON FUNCTION public.daily_quote(DATE) TO authenticated, anon;

-- ============================================================================
-- 4. toggle_quote_like(quote_id) — 좋아요 토글
-- SECURITY DEFINER 인 이유: like_count COUNT(*) 가 quote_likes RLS 우회 후 글로벌 카운트
-- 가 되도록. 함수 안에서 auth.uid() NULL 체크 + 본인 row 만 쓰므로 보안 우회 없음.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.toggle_quote_like(p_quote_id UUID)
RETURNS TABLE (liked BOOLEAN, like_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.quote_likes WHERE user_id = v_user_id AND quote_id = p_quote_id
  ) INTO v_existing;

  IF v_existing THEN
    DELETE FROM public.quote_likes WHERE user_id = v_user_id AND quote_id = p_quote_id;
  ELSE
    INSERT INTO public.quote_likes (user_id, quote_id) VALUES (v_user_id, p_quote_id);
  END IF;

  RETURN QUERY
  SELECT NOT v_existing, (SELECT COUNT(*) FROM public.quote_likes WHERE quote_id = p_quote_id);
END $$;

GRANT EXECUTE ON FUNCTION public.toggle_quote_like(UUID) TO authenticated;
