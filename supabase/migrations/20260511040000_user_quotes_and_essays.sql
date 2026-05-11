-- 2026-05-11 사용자 작성 명언 + 포토 에세이 통합.
--
-- (8) 나의 명언: quotes 테이블 확장 (user_id, status) + create/delete/top_ranking RPC
-- (10) 포토에세이: activity_photos.essay_body 컬럼 + public_gallery_feed view 갱신

------------------------------------------------------------
-- (A) quotes 테이블 확장
------------------------------------------------------------
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0;

-- status check 강제
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('approved', 'pending', 'hidden'));

CREATE INDEX IF NOT EXISTS quotes_user_id_idx
  ON public.quotes(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quotes_status_approved_idx
  ON public.quotes(status) WHERE status = 'approved';

-- RLS 추가 — approved 만 누구나 read. 본인은 자기 quote 모두 read.
-- 이전엔 quotes 가 RLS 없었거나 모두 read 였음. 보강.
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotes_select_approved_or_own ON public.quotes;
CREATE POLICY quotes_select_approved_or_own ON public.quotes
  FOR SELECT USING (
    status = 'approved'
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
  );

------------------------------------------------------------
-- (B) create_user_quote RPC
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_user_quote(p_text TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
  v_author TEXT;
  v_text TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  v_text := trim(coalesce(p_text, ''));
  IF length(v_text) < 3 THEN RAISE EXCEPTION '명언이 너무 짧아요 (3자 이상)'; END IF;
  IF length(v_text) > 300 THEN RAISE EXCEPTION '명언은 300자 이내로 작성해주세요'; END IF;

  -- 닉네임 가져오기 (없으면 '러너' fallback)
  SELECT display_name INTO v_author FROM public.profiles WHERE id = v_user_id;
  IF v_author IS NULL OR length(trim(v_author)) = 0 THEN v_author := '러너'; END IF;

  INSERT INTO public.quotes (lang, text, author, user_id, status, category)
  VALUES ('ko_self', v_text, v_author, v_user_id, 'approved', 'user')
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_user_quote(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_user_quote(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_user_quote(TEXT) TO authenticated;

------------------------------------------------------------
-- (C) delete_my_quote RPC — 본인 quote 삭제
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_quote(p_quote_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  DELETE FROM public.quotes WHERE id = p_quote_id AND user_id = v_user_id;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.delete_my_quote(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_quote(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_quote(UUID) TO authenticated;

------------------------------------------------------------
-- (D) top_quotes_ranking — 좋아요 순 (사용자/공식 통합). is_user_quote 로 구분.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.top_quotes_ranking(p_limit INT DEFAULT 30, p_offset INT DEFAULT 0)
RETURNS TABLE (
  id UUID,
  text TEXT,
  author TEXT,
  lang TEXT,
  category TEXT,
  like_count INT,
  liked_by_me BOOLEAN,
  is_user_quote BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT q.id, q.text, q.author, q.lang, q.category,
    COALESCE((SELECT count(*)::INT FROM public.quote_likes WHERE quote_id = q.id), 0) AS like_count,
    EXISTS(SELECT 1 FROM public.quote_likes WHERE quote_id = q.id AND user_id = auth.uid()) AS liked_by_me,
    q.user_id IS NOT NULL AS is_user_quote,
    q.created_at
  FROM public.quotes q
  WHERE q.status = 'approved'
  ORDER BY
    COALESCE((SELECT count(*) FROM public.quote_likes WHERE quote_id = q.id), 0) DESC,
    q.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;
REVOKE ALL ON FUNCTION public.top_quotes_ranking(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.top_quotes_ranking(INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.top_quotes_ranking(INT, INT) TO authenticated;

------------------------------------------------------------
-- (E) my_quotes — 내가 작성한 quote 들
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_quotes()
RETURNS TABLE (
  id UUID,
  text TEXT,
  author TEXT,
  like_count INT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT q.id, q.text, q.author,
    COALESCE((SELECT count(*)::INT FROM public.quote_likes WHERE quote_id = q.id), 0) AS like_count,
    q.status, q.created_at
  FROM public.quotes q
  WHERE q.user_id = auth.uid()
  ORDER BY q.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.my_quotes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_quotes() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_quotes() TO authenticated;

------------------------------------------------------------
-- (F) activity_photos.essay_body — 포토 에세이 본문 컬럼
------------------------------------------------------------
ALTER TABLE public.activity_photos
  ADD COLUMN IF NOT EXISTS essay_body TEXT;

------------------------------------------------------------
-- (G) public_gallery_feed view 갱신 — essay_body + like_count 노출
-- CREATE OR REPLACE 가 컬럼 순서 변경 불가라 DROP 후 재생성.
------------------------------------------------------------
DROP VIEW IF EXISTS public.public_gallery_feed;
CREATE VIEW public.public_gallery_feed AS
  SELECT ph.id AS photo_id,
    ph.activity_id,
    ph.user_id,
    ph.photo_url,
    ph.caption,
    ph.essay_body,
    ph.like_count,
    ph.created_at,
    p.display_name,
    p.avatar_url,
    p.region_gu,
    a.distance_km,
    a.activity_date
   FROM public.activity_photos ph
     JOIN public.profiles p ON p.id = ph.user_id
     JOIN public.activities a ON a.id = ph.activity_id
  WHERE ph.share_in_gallery = true AND p.is_public = true AND a.visibility = 'public'::text
  ORDER BY ph.created_at DESC;

------------------------------------------------------------
-- (H) update_photo_essay — 본인 사진의 에세이 추가/수정
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_photo_essay(p_photo_id UUID, p_essay TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_essay IS NOT NULL AND length(p_essay) > 2000 THEN
    RAISE EXCEPTION '에세이는 2000자 이내로 작성해주세요';
  END IF;
  UPDATE public.activity_photos
     SET essay_body = NULLIF(trim(coalesce(p_essay, '')), '')
   WHERE id = p_photo_id AND user_id = v_user_id;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.update_photo_essay(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_photo_essay(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_photo_essay(UUID, TEXT) TO authenticated;
