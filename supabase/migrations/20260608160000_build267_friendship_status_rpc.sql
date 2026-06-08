-- build 267: 친구 관계 상태 단일 조회 RPC.
-- UserProfilePage 가 mount 시 호출 → 'none' | 'request_sent' | 'request_received' | 'friend' 한 번에 받음.
-- 신청 보낸 상태가 페이지 새로고침 후에도 정확히 표시되도록.

CREATE OR REPLACE FUNCTION get_friendship_status(p_other_user_id uuid)
RETURNS TABLE (
  status text,         -- 'none' | 'request_sent' | 'request_received' | 'friend'
  request_id uuid      -- request_sent / request_received 일 때 그 friend_requests.id
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  is_friend boolean;
  v_request_id uuid;
BEGIN
  IF me IS NULL OR me = p_other_user_id THEN
    RETURN QUERY SELECT 'none'::text, NULL::uuid;
    RETURN;
  END IF;

  -- 양방향 follow 면 친구
  SELECT EXISTS (
    SELECT 1 FROM follows f1
    JOIN follows f2 ON f2.follower_id = f1.following_id AND f2.following_id = f1.follower_id
    WHERE f1.follower_id = me AND f1.following_id = p_other_user_id
  ) INTO is_friend;

  IF is_friend THEN
    RETURN QUERY SELECT 'friend'::text, NULL::uuid;
    RETURN;
  END IF;

  -- pending 신청 있는지 — 내가 sender
  SELECT id INTO v_request_id FROM friend_requests
  WHERE sender_id = me AND receiver_id = p_other_user_id AND status = 'pending'
  LIMIT 1;
  IF v_request_id IS NOT NULL THEN
    RETURN QUERY SELECT 'request_sent'::text, v_request_id;
    RETURN;
  END IF;

  -- pending 신청 있는지 — 내가 receiver
  SELECT id INTO v_request_id FROM friend_requests
  WHERE sender_id = p_other_user_id AND receiver_id = me AND status = 'pending'
  LIMIT 1;
  IF v_request_id IS NOT NULL THEN
    RETURN QUERY SELECT 'request_received'::text, v_request_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'none'::text, NULL::uuid;
END;
$$;

-- 신청 취소 RPC — sender 가 pending 신청을 'canceled' 로
CREATE OR REPLACE FUNCTION cancel_friend_request(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request friend_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM friend_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '신청을 찾을 수 없어요';
  END IF;
  IF v_request.sender_id <> auth.uid() THEN
    RAISE EXCEPTION '본인이 보낸 신청만 취소할 수 있어요';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION '이미 응답된 신청은 취소할 수 없어요';
  END IF;
  UPDATE friend_requests
  SET status = 'canceled', responded_at = NOW()
  WHERE id = p_request_id;
  -- 동시에 receiver 의 friend_request 알림도 read 처리 (선택). 알림은 그대로 두되 결과는 stale.
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION get_friendship_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_friend_request(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_friendship_status(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION cancel_friend_request(uuid) FROM PUBLIC, anon;
