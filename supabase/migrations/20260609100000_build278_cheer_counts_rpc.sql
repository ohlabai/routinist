-- build 278: 받은 응원 카운트 RPC.
-- 프로필 페이지에 "받은 응원 N · 이번 주 N" chip 표시용.
-- RLS 우회 SECURITY DEFINER — 다른 사용자의 응원 합계 조회 가능 (개수만, 누가 보냈는지는 X).

CREATE OR REPLACE FUNCTION get_received_cheer_counts(p_user_id uuid)
RETURNS TABLE (
  total integer,
  this_week integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- week_of 는 cheer 보낸 주의 월요일 date. 이번 주 = 오늘 KST 기준 ISO week 월요일.
  WITH this_week_start AS (
    SELECT date_trunc('week', (NOW() AT TIME ZONE 'Asia/Seoul')::date)::date AS d
  )
  SELECT
    (SELECT COUNT(*)::int FROM user_cheers WHERE to_user = p_user_id) AS total,
    (SELECT COUNT(*)::int FROM user_cheers, this_week_start
       WHERE to_user = p_user_id AND week_of >= this_week_start.d) AS this_week;
$$;

GRANT EXECUTE ON FUNCTION get_received_cheer_counts(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_received_cheer_counts(uuid) FROM PUBLIC, anon;
