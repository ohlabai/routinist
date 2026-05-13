-- 2026-05-13 build 107 — 제안/버그 게시판 (Feedback Posts)
-- 출시 후 유저가 직접 버그/기능 요청을 남기고, 어드민이 상태 변경 + 답글 다는 공개 게시판.

------------------------------------------------------------
-- (A) 테이블
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bug','feature','ui','other')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 120),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 5 AND 4000),
  is_public BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','done','wont_fix')),
  admin_reply TEXT,
  admin_replied_at TIMESTAMPTZ,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_posts_status_idx ON public.feedback_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_posts_user_idx ON public.feedback_posts(user_id);

CREATE TABLE IF NOT EXISTS public.feedback_upvotes (
  feedback_id UUID NOT NULL REFERENCES public.feedback_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_id, user_id)
);
CREATE INDEX IF NOT EXISTS feedback_upvotes_user_idx ON public.feedback_upvotes(user_id);

------------------------------------------------------------
-- (B) RLS
------------------------------------------------------------
ALTER TABLE public.feedback_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_upvotes ENABLE ROW LEVEL SECURITY;

-- 게시글: 공개 글 + 본인 글 + 어드민 SELECT
DROP POLICY IF EXISTS fp_select ON public.feedback_posts;
CREATE POLICY fp_select ON public.feedback_posts
  FOR SELECT USING (
    is_public = true
    OR user_id = auth.uid()
    OR public.is_shop_admin()
  );

-- 본인만 INSERT
DROP POLICY IF EXISTS fp_insert ON public.feedback_posts;
CREATE POLICY fp_insert ON public.feedback_posts
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 본인은 title/body/is_public/category 수정. status/admin_reply 는 RPC 로 어드민만.
DROP POLICY IF EXISTS fp_update_own ON public.feedback_posts;
CREATE POLICY fp_update_own ON public.feedback_posts
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 어드민 전체 권한
DROP POLICY IF EXISTS fp_admin_all ON public.feedback_posts;
CREATE POLICY fp_admin_all ON public.feedback_posts
  FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

-- 본인 글 삭제
DROP POLICY IF EXISTS fp_delete_own ON public.feedback_posts;
CREATE POLICY fp_delete_own ON public.feedback_posts
  FOR DELETE USING (user_id = auth.uid());

-- upvotes: 본인 row 만 ALL
DROP POLICY IF EXISTS fu_select ON public.feedback_upvotes;
CREATE POLICY fu_select ON public.feedback_upvotes FOR SELECT USING (true);  -- 카운트/내가 눌렀나 모두 read

DROP POLICY IF EXISTS fu_insert ON public.feedback_upvotes;
CREATE POLICY fu_insert ON public.feedback_upvotes
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS fu_delete ON public.feedback_upvotes;
CREATE POLICY fu_delete ON public.feedback_upvotes
  FOR DELETE USING (user_id = auth.uid());

------------------------------------------------------------
-- (C) upvote_count 자동 유지 트리거
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.feedback_upvote_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feedback_posts SET upvote_count = upvote_count + 1 WHERE id = NEW.feedback_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.feedback_posts SET upvote_count = GREATEST(0, upvote_count - 1) WHERE id = OLD.feedback_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS feedback_upvote_count_trg ON public.feedback_upvotes;
CREATE TRIGGER feedback_upvote_count_trg
  AFTER INSERT OR DELETE ON public.feedback_upvotes
  FOR EACH ROW EXECUTE FUNCTION public.feedback_upvote_count_sync();

------------------------------------------------------------
-- (D) RPC — create_feedback
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_feedback(
  p_category TEXT,
  p_title TEXT,
  p_body TEXT,
  p_is_public BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid(); v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_category NOT IN ('bug','feature','ui','other') THEN
    RAISE EXCEPTION '잘못된 카테고리';
  END IF;
  INSERT INTO public.feedback_posts (user_id, category, title, body, is_public)
  VALUES (v_user_id, p_category, trim(p_title), trim(p_body), COALESCE(p_is_public, true))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_feedback(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

------------------------------------------------------------
-- (E) RPC — toggle_feedback_upvote
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_feedback_upvote(p_feedback_id UUID)
RETURNS BOOLEAN  -- true = liked after toggle, false = unliked
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid(); v_existed BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  DELETE FROM public.feedback_upvotes
   WHERE feedback_id = p_feedback_id AND user_id = v_user_id;
  GET DIAGNOSTICS v_existed = ROW_COUNT;
  IF v_existed > 0 THEN RETURN false; END IF;
  INSERT INTO public.feedback_upvotes (feedback_id, user_id)
  VALUES (p_feedback_id, v_user_id);
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_feedback_upvote(UUID) TO authenticated;

------------------------------------------------------------
-- (F) RPC — admin_update_feedback (status + reply)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_feedback(
  p_feedback_id UUID,
  p_status TEXT,
  p_admin_reply TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF p_status NOT IN ('open','reviewing','done','wont_fix') THEN
    RAISE EXCEPTION '잘못된 상태';
  END IF;
  UPDATE public.feedback_posts
     SET status = p_status,
         admin_reply = NULLIF(trim(COALESCE(p_admin_reply, '')), ''),
         admin_replied_at = CASE WHEN p_admin_reply IS NOT NULL AND length(trim(p_admin_reply)) > 0 THEN now() ELSE admin_replied_at END
   WHERE id = p_feedback_id;
  IF NOT FOUND THEN RAISE EXCEPTION '게시글을 찾을 수 없어요'; END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_feedback(UUID, TEXT, TEXT) TO authenticated;

------------------------------------------------------------
-- (G) View — feedback_feed (작성자 정보 join + liked_by_me 는 클라이언트에서 채움)
------------------------------------------------------------
DROP VIEW IF EXISTS public.feedback_feed;
CREATE VIEW public.feedback_feed AS
SELECT
  f.id,
  f.category,
  f.title,
  f.body,
  f.is_public,
  f.status,
  f.admin_reply,
  f.admin_replied_at,
  f.upvote_count,
  f.created_at,
  f.user_id,
  COALESCE(p.display_name, '익명') AS author_name,
  p.avatar_url AS author_avatar
FROM public.feedback_posts f
LEFT JOIN public.profiles p ON p.id = f.user_id;

GRANT SELECT ON public.feedback_feed TO anon, authenticated;
