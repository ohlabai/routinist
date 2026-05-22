-- build 182: photo_comments 테이블 누락 fix.
-- 코드 (PhotoCommentsSheet, lib/photo-comments.ts) 는 build 100 후속에 추가됐는데
-- 마이그레이션이 git 에서 빠져 있어 production 에 테이블이 없었음.
-- → 댓글 등록 시 PostgrestError ("relation does not exist") 발생 → 토스트 "등록 실패 — 실패"
-- (PostgrestError 가 Error instanceof false 라 fallback 문구가 그대로 노출됐음)

CREATE TABLE IF NOT EXISTS public.photo_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES public.activity_photos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_comments_photo_idx ON public.photo_comments(photo_id, created_at);
CREATE INDEX IF NOT EXISTS photo_comments_user_idx ON public.photo_comments(user_id);

ALTER TABLE public.photo_comments ENABLE ROW LEVEL SECURITY;

-- SELECT: public — 갤러리에 공유된 사진(share_in_gallery=true) 의 댓글은 누구나 조회.
DROP POLICY IF EXISTS photo_comments_select ON public.photo_comments;
CREATE POLICY photo_comments_select ON public.photo_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.activity_photos ap
      WHERE ap.id = photo_id AND ap.share_in_gallery = true
    )
    OR user_id = auth.uid()
  );

-- INSERT: 로그인 사용자만 + user_id = self
DROP POLICY IF EXISTS photo_comments_insert ON public.photo_comments;
CREATE POLICY photo_comments_insert ON public.photo_comments
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.activity_photos ap
      WHERE ap.id = photo_id AND ap.share_in_gallery = true
    )
  );

-- DELETE: 본인 댓글 또는 admin
DROP POLICY IF EXISTS photo_comments_delete ON public.photo_comments;
CREATE POLICY photo_comments_delete ON public.photo_comments
  FOR DELETE
  USING (
    auth.uid() = user_id
    OR public.is_shop_admin()
  );

-- 욕설/스팸 필터 trigger
CREATE OR REPLACE FUNCTION public.photo_comments_clean_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_clean_text(NEW.body) THEN
    RAISE EXCEPTION '부적절한 표현이 포함돼 있어요. 다시 작성해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS photo_comments_clean_trigger ON public.photo_comments;
CREATE TRIGGER photo_comments_clean_trigger
  BEFORE INSERT OR UPDATE ON public.photo_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.photo_comments_clean_check();

GRANT SELECT, INSERT, DELETE ON public.photo_comments TO authenticated;
GRANT SELECT ON public.photo_comments TO anon;
