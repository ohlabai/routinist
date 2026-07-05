-- build 290 P1: N+1 정리 (DB 쪽)
--
-- 1. public_gallery_feed 에 comment_count 추가 — PhotoCard 가 카드마다 count 쿼리를 쏘던
--    N+1 (탭당 50건) 을 view 1쿼리로 흡수. 기존 컬럼 순서 유지 + 끝에 추가 (OR REPLACE 제약).
-- 2. fetch_last_messages — 쪽지 목록이 모든 대화의 전체 메시지를 limit 없이 받아
--    첫 행만 쓰던 것을 DISTINCT ON 으로 대화당 1행만 반환. SECURITY INVOKER (RLS 적용).

CREATE OR REPLACE VIEW public.public_gallery_feed AS
 SELECT ph.id AS photo_id,
    ph.activity_id,
    ph.user_id,
    ph.photo_url,
    ph.caption,
    ph.essay_body,
    ph.quote_id,
    ph.contest_id,
    q.text AS quote_text,
    q.author AS quote_author,
    ph.like_count,
    ph.created_at,
    p.display_name,
    p.avatar_url,
    p.region_gu,
    p.gender,
    p.show_gender,
    a.distance_km,
    a.activity_date,
    (SELECT count(*)::int FROM public.photo_comments pc WHERE pc.photo_id = ph.id) AS comment_count
   FROM activity_photos ph
     JOIN profiles p ON p.id = ph.user_id
     JOIN activities a ON a.id = ph.activity_id
     LEFT JOIN quotes q ON q.id = ph.quote_id AND q.status = 'approved'::text
  WHERE ph.share_in_gallery = true AND p.is_public = true AND a.visibility = 'public'::text
  ORDER BY ph.created_at DESC;

CREATE OR REPLACE FUNCTION public.fetch_last_messages(p_conversation_ids uuid[])
 RETURNS SETOF public.messages
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (m.conversation_id) m.*
  FROM public.messages m
  WHERE m.conversation_id = ANY(p_conversation_ids)
  ORDER BY m.conversation_id, m.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.fetch_last_messages(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_last_messages(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_last_messages(uuid[]) TO authenticated;
