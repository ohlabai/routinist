-- build 172.1 #5C: 제안 게시판 게시글에 이미지 첨부 (1장).
-- 사용자 신고: 캡쳐 이미지로 화면 첨부할 수 있게 해주세요.
-- - feedback_posts.image_url TEXT 컬럼 추가
-- - feedback_feed view 재생성 (image_url 포함)
-- - create_feedback RPC 에 p_image_url 파라미터 추가 (기본 NULL → 기존 호출 호환)

ALTER TABLE public.feedback_posts ADD COLUMN IF NOT EXISTS image_url TEXT;

-- VIEW 컬럼 추가는 CREATE OR REPLACE 가 거부 (컬럼 이름 변경 인식). DROP 후 재생성.
DROP VIEW IF EXISTS public.feedback_feed;
CREATE VIEW public.feedback_feed AS
SELECT f.id,
       f.category,
       f.title,
       f.body,
       f.image_url,
       f.is_public,
       f.status,
       f.admin_reply,
       f.admin_replied_at,
       f.upvote_count,
       f.created_at,
       f.user_id,
       COALESCE(p.display_name, '익명'::text) AS author_name,
       p.avatar_url AS author_avatar
  FROM public.feedback_posts f
  LEFT JOIN public.profiles p ON p.id = f.user_id;

CREATE OR REPLACE FUNCTION public.create_feedback(
  p_category text,
  p_title text,
  p_body text,
  p_is_public boolean DEFAULT true,
  p_image_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_user_id UUID := auth.uid(); v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_category NOT IN ('bug','feature','ui','other') THEN
    RAISE EXCEPTION '잘못된 카테고리';
  END IF;
  INSERT INTO public.feedback_posts (user_id, category, title, body, is_public, image_url)
  VALUES (v_user_id, p_category, trim(p_title), trim(p_body), COALESCE(p_is_public, true), p_image_url)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
