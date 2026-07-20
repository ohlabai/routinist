-- 알림 목록에 friend_request 의 현재 상태(request_status)를 노출.
--
-- 증상: 이미 수락/거절한 친구 신청 알림에 [수락]/[거절] 버튼이 계속 남아 있음.
--   재탭하면 respond_friend_request 가 '이미 응답한 신청이에요' EXCEPTION →
--   Supabase PostgrestError(plain object) → 프론트 `String(e)` → '[object Object]' 다이얼로그.
-- fix: fetch_notifications_list 가 friend_requests 를 조인해 상태를 함께 반환.
--   프론트는 status='pending' 일 때만 버튼을 그린다 (근본 해결).
--
-- source_id = friend_requests.id 임을 실데이터로 검증함 (build 264 규약).
-- 반환 컬럼이 바뀌므로 CREATE OR REPLACE 불가 → DROP 후 재생성.

DROP FUNCTION IF EXISTS public.fetch_notifications_list(integer, integer);

CREATE FUNCTION public.fetch_notifications_list(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid,
  kind text,
  source_id uuid,
  actor_id uuid,
  actor_display_name text,
  actor_avatar_url text,
  preview text,
  created_at timestamptz,
  read_at timestamptz,
  request_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    n.id,
    n.kind,
    n.source_id,
    n.actor_id,
    p.display_name AS actor_display_name,
    p.avatar_url AS actor_avatar_url,
    n.preview,
    n.created_at,
    n.read_at,
    -- friend_request 만 상태 노출. 그 외 kind 는 NULL.
    CASE WHEN n.kind = 'friend_request' THEN fr.status ELSE NULL END AS request_status
  FROM user_notifications n
  LEFT JOIN profiles p ON p.id = n.actor_id
  LEFT JOIN friend_requests fr ON n.kind = 'friend_request' AND fr.id = n.source_id
  WHERE n.user_id = auth.uid()
    AND n.created_at > NOW() - INTERVAL '30 days'
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$function$;

REVOKE ALL ON FUNCTION public.fetch_notifications_list(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_notifications_list(integer, integer) TO authenticated, service_role;

-- PostgREST 스키마 캐시 갱신 (반환 컬럼 변경 반영)
NOTIFY pgrst, 'reload schema';
