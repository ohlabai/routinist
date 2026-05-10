-- random_quote RPC — 공유카드 명언 다양성 위해 진짜 random pick.
-- 이전: 클라이언트가 select limit(50) 후 JS random — PostgREST 가 같은 50개만 반환.
-- 신규: server-side ORDER BY random() LIMIT 1. 1095개 풀에서 균일 확률.

CREATE OR REPLACE FUNCTION public.random_quote(
  p_lang TEXT DEFAULT 'ko',
  p_exclude_id UUID DEFAULT NULL
)
RETURNS TABLE (id UUID, lang TEXT, category TEXT, "text" TEXT, author TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.id, q.lang::TEXT, q.category, q."text", q.author
  FROM public.quotes q
  WHERE q.lang::TEXT = p_lang
    AND (p_exclude_id IS NULL OR q.id <> p_exclude_id)
  ORDER BY random()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.random_quote(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.random_quote(TEXT, UUID) TO authenticated;

-- HIGH 추가 fix: is_club_admin / is_club_member 가 PUBLIC EXECUTE 라 anon 도 호출 가능
-- → 멤버십 추론 가능. authenticated 만 GRANT 로 좁힘.
REVOKE EXECUTE ON FUNCTION public.is_club_admin(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_club_member(UUID, UUID) FROM PUBLIC;
-- (이미 GRANT TO authenticated 됨)
