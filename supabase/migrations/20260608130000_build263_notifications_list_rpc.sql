-- build 263: 알림 리스트 RPC — user_notifications + profiles (actor) JOIN.
-- /notifications 페이지에서 호출. 최근 100건, 30일 안.

CREATE OR REPLACE FUNCTION fetch_notifications_list(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  kind text,
  source_id uuid,
  actor_id uuid,
  actor_display_name text,
  actor_avatar_url text,
  preview text,
  created_at timestamptz,
  read_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    n.id,
    n.kind,
    n.source_id,
    n.actor_id,
    p.display_name AS actor_display_name,
    p.avatar_url AS actor_avatar_url,
    n.preview,
    n.created_at,
    n.read_at
  FROM user_notifications n
  LEFT JOIN profiles p ON p.id = n.actor_id
  WHERE n.user_id = auth.uid()
    AND n.created_at > NOW() - INTERVAL '30 days'
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION fetch_notifications_list(integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION fetch_notifications_list(integer, integer) FROM PUBLIC, anon;
