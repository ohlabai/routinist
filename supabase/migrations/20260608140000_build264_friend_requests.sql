-- build 264: 친구 신청 모델 (Phase 3 후속).
-- 기존 follows 는 즉시 수락 (단방향). friend_requests 는 신청 → 수락/거절 흐름을 별도로 제공.
-- 수락 시 follows 양방향 (sender ↔ receiver) insert. 알림은 user_notifications 로 자동 발사.

CREATE TABLE IF NOT EXISTS friend_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',
  message     text,  -- 신청 시 짧은 인사말 (선택)
  created_at  timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (sender_id <> receiver_id),
  CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled'))
);

-- 같은 방향으로 pending 중복 차단. 거절 후 재신청 가능 (다른 status 면 새 row).
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_unique
  ON friend_requests (sender_id, receiver_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS friend_requests_receiver_pending_idx
  ON friend_requests (receiver_id, status)
  WHERE status = 'pending';

ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

-- sender / receiver 둘 다 본인 신청 SELECT 가능.
CREATE POLICY friend_requests_select ON friend_requests
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- 신청 INSERT 는 sender 가 본인 명의로만.
CREATE POLICY friend_requests_insert ON friend_requests
  FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- UPDATE 는 receiver 가 status 변경 (accept/reject) + sender 가 cancel 가능.
CREATE POLICY friend_requests_update ON friend_requests
  FOR UPDATE
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- ============================================================================
-- 알림 kind 확장: 'friend_request' (신청 받음), 'friend_accepted' (내 신청이 수락됨)
-- ============================================================================
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_kind_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_kind_check
  CHECK (kind IN ('cheer', 'photo_comment', 'activity_comment', 'follow', 'friend_request', 'friend_accepted'));

-- ============================================================================
-- 트리거: friend_requests INSERT → receiver 에게 'friend_request' 알림
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_on_friend_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (NEW.receiver_id, 'friend_request', NEW.id, NEW.sender_id, NEW.message);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_requests_notify_insert ON friend_requests;
CREATE TRIGGER friend_requests_notify_insert
  AFTER INSERT ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION notify_on_friend_request();

-- ============================================================================
-- 트리거: status pending → accepted 전환 시 sender 에게 'friend_accepted' + follows 양방향 insert.
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_on_friend_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    -- 양방향 follow insert. ON CONFLICT 으로 이미 follow 중인 경우 skip.
    INSERT INTO follows (follower_id, following_id)
    VALUES (NEW.sender_id, NEW.receiver_id)
    ON CONFLICT DO NOTHING;
    INSERT INTO follows (follower_id, following_id)
    VALUES (NEW.receiver_id, NEW.sender_id)
    ON CONFLICT DO NOTHING;
    -- sender 에게 수락 알림
    INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
    VALUES (NEW.sender_id, 'friend_accepted', NEW.id, NEW.receiver_id, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_requests_notify_accepted ON friend_requests;
CREATE TRIGGER friend_requests_notify_accepted
  AFTER UPDATE ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION notify_on_friend_accepted();

-- ============================================================================
-- RPC: send_friend_request
-- 받는 사람 id + 인사말 (옵션). 이미 friend (양방향 follow) 면 에러. 이미 pending 이면 에러.
-- ============================================================================
CREATE OR REPLACE FUNCTION send_friend_request(
  p_receiver_id uuid,
  p_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender uuid := auth.uid();
  v_request_id uuid;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF v_sender = p_receiver_id THEN
    RAISE EXCEPTION '자기 자신에게 친구 신청은 보낼 수 없어요';
  END IF;
  -- 이미 양방향 follow 면 친구 상태 — 신청 의미 없음
  IF EXISTS (
    SELECT 1 FROM follows f1
    JOIN follows f2 ON f2.follower_id = f1.following_id AND f2.following_id = f1.follower_id
    WHERE f1.follower_id = v_sender AND f1.following_id = p_receiver_id
  ) THEN
    RAISE EXCEPTION '이미 친구예요';
  END IF;
  INSERT INTO friend_requests (sender_id, receiver_id, message)
  VALUES (v_sender, p_receiver_id, p_message)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;

-- ============================================================================
-- RPC: respond_friend_request
-- receiver 가 수락 (true) / 거절 (false). pending 만 처리.
-- ============================================================================
CREATE OR REPLACE FUNCTION respond_friend_request(
  p_request_id uuid,
  p_accept boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request friend_requests%ROWTYPE;
  v_new_status text;
BEGIN
  SELECT * INTO v_request FROM friend_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '신청을 찾을 수 없어요';
  END IF;
  IF v_request.receiver_id <> auth.uid() THEN
    RAISE EXCEPTION '본인에게 온 신청만 응답할 수 있어요';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION '이미 응답한 신청이에요';
  END IF;
  v_new_status := CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END;
  UPDATE friend_requests
  SET status = v_new_status, responded_at = NOW()
  WHERE id = p_request_id;
  RETURN v_new_status;
END;
$$;

GRANT EXECUTE ON FUNCTION send_friend_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION respond_friend_request(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION send_friend_request(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION respond_friend_request(uuid, boolean) FROM PUBLIC, anon;
