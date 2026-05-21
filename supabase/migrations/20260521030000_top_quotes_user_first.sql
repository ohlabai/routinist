-- build 160 #2: 러너한줄 '전체' 탭에 내가 쓴 글이 안 보이던 원인.
-- 기존 ORDER BY: like_count DESC, created_at DESC → 고전 명언 1097개 중 새 글은 항상 끝 (limit 50 미만).
-- 변경: 유저 작성 글이 먼저, 그 다음 시간순, 동률은 좋아요 순. 사회적 피드 톤.
CREATE OR REPLACE FUNCTION public.top_quotes_ranking(p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, text text, author text, lang text, category text,
  like_count integer, liked_by_me boolean, is_user_quote boolean,
  created_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT q.id, q.text, q.author, q.lang, q.category,
    COALESCE((SELECT count(*)::INT FROM public.quote_likes WHERE quote_id = q.id), 0) AS like_count,
    EXISTS(SELECT 1 FROM public.quote_likes WHERE quote_id = q.id AND user_id = auth.uid()) AS liked_by_me,
    q.user_id IS NOT NULL AS is_user_quote,
    q.created_at
  FROM public.quotes q
  WHERE q.status = 'approved'
  ORDER BY
    (q.user_id IS NOT NULL) DESC,
    q.created_at DESC,
    COALESCE((SELECT count(*) FROM public.quote_likes WHERE quote_id = q.id), 0) DESC
  LIMIT p_limit OFFSET p_offset;
$function$;
