-- build 261: 통합 알림 인박스 (Notion 식 배지 시스템 인프라).
-- 응원·댓글·팔로우 등 사용자에게 의미 있는 이벤트를 단일 테이블에 누적 → 탭바·앱 아이콘 배지에
-- 활용. 메시지는 기존 messages.read_at 시스템 유지 (별도 트랙). 향후 확장: 친구 신청, 클럽 초대,
-- 월드런 push, 리뷰 응답 등도 같은 테이블에 추가 가능.

CREATE TABLE IF NOT EXISTS user_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL, -- 'cheer' | 'photo_comment' | 'activity_comment' | 'follow' | ...
  source_id   uuid,          -- 원본 row 의 id (예: user_cheers.id)
  actor_id    uuid,          -- 이벤트 일으킨 사용자 (예: 응원 보낸 사람)
  preview     text,          -- 짧은 미리보기 (댓글 body 30자 등). 알림 리스트 UI 용
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,
  CHECK (kind IN ('cheer', 'photo_comment', 'activity_comment', 'follow'))
);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON user_notifications (user_id, read_at)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications (user_id, created_at DESC);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- 본인 알림만 읽기.
CREATE POLICY user_notifications_select ON user_notifications
  FOR SELECT USING (auth.uid() = user_id);

-- 본인 알림 read_at 만 갱신 가능. body/kind 등 변경 차단.
CREATE POLICY user_notifications_update ON user_notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- INSERT 는 트리거 (SECURITY DEFINER) 에서만 발사. 사용자 직접 INSERT 차단.

-- ============================================================================
-- 트리거: user_cheers → user_notifications
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_on_cheer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 본인이 본인에게 응원하는 경우는 알림 생성 안 함 (예외)
  IF NEW.from_user = NEW.to_user THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (NEW.to_user, 'cheer', NEW.id, NEW.from_user, NEW.emoji);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_cheers_notify ON user_cheers;
CREATE TRIGGER user_cheers_notify
  AFTER INSERT ON user_cheers
  FOR EACH ROW EXECUTE FUNCTION notify_on_cheer();

-- ============================================================================
-- 트리거: photo_comments → user_notifications (photo owner 에게)
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_on_photo_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM activity_photos WHERE id = NEW.photo_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (owner_id, 'photo_comment', NEW.id, NEW.user_id, LEFT(NEW.body, 60));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS photo_comments_notify ON photo_comments;
CREATE TRIGGER photo_comments_notify
  AFTER INSERT ON photo_comments
  FOR EACH ROW EXECUTE FUNCTION notify_on_photo_comment();

-- ============================================================================
-- 트리거: activity_comments → user_notifications (activity owner 에게)
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_on_activity_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM activities WHERE id = NEW.activity_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (owner_id, 'activity_comment', NEW.id, NEW.user_id, LEFT(NEW.body, 60));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activity_comments_notify ON activity_comments;
CREATE TRIGGER activity_comments_notify
  AFTER INSERT ON activity_comments
  FOR EACH ROW EXECUTE FUNCTION notify_on_activity_comment();

-- ============================================================================
-- 트리거: follows → user_notifications (팔로우 받은 사람에게)
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_on_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.follower_id = NEW.following_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (NEW.following_id, 'follow', NEW.follower_id, NEW.follower_id, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follows_notify ON follows;
CREATE TRIGGER follows_notify
  AFTER INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION notify_on_follow();

-- ============================================================================
-- RPC: fetch_unread_notification_summary
-- 현재 사용자의 unread 알림을 kind 별로 집계. 탭바 배지 + 알림 리스트 hero 용.
-- 30일 이상된 unread 는 stale 로 간주하고 카운트 제외 (사용자가 못 봤거나 무시한 것).
-- ============================================================================
CREATE OR REPLACE FUNCTION fetch_unread_notification_summary()
RETURNS TABLE (
  total_unread integer,
  cheer_unread integer,
  comment_unread integer,
  follow_unread integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (
    SELECT kind FROM user_notifications
    WHERE user_id = auth.uid()
      AND read_at IS NULL
      AND created_at > NOW() - INTERVAL '30 days'
  )
  SELECT
    (SELECT COUNT(*)::int FROM n) AS total_unread,
    (SELECT COUNT(*)::int FROM n WHERE kind = 'cheer') AS cheer_unread,
    (SELECT COUNT(*)::int FROM n WHERE kind IN ('photo_comment', 'activity_comment')) AS comment_unread,
    (SELECT COUNT(*)::int FROM n WHERE kind = 'follow') AS follow_unread;
$$;

-- ============================================================================
-- RPC: mark_notifications_read
-- 지정한 kind 들의 unread 알림을 모두 읽음 처리. 소셜 탭 진입 시 cheer/comment/follow 한 번에.
-- 옵션: p_kinds 가 NULL 이면 전체 read.
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_notifications_read(
  p_kinds text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE user_notifications
  SET read_at = NOW()
  WHERE user_id = auth.uid()
    AND read_at IS NULL
    AND (p_kinds IS NULL OR kind = ANY(p_kinds));
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION fetch_unread_notification_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notifications_read(text[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION fetch_unread_notification_summary() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION mark_notifications_read(text[]) FROM PUBLIC, anon;

-- ============================================================================
-- Backfill: 기존 cheers/comments/follows 의 일부를 알림으로 변환
-- 최근 7일 데이터만 backfill (오래된 건 사용자가 이미 봤다고 가정).
-- read_at 채워서 unread 로 잡히지 않게 — 백로그가 폭주하면 모든 탭에 빨간 숫자 폭탄.
-- 실제 새 이벤트부터 unread 로 잡힘.
-- ============================================================================
INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview, created_at, read_at)
SELECT to_user, 'cheer', id, from_user, emoji, created_at, NOW()
FROM user_cheers
WHERE created_at > NOW() - INTERVAL '7 days' AND from_user <> to_user;

INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview, created_at, read_at)
SELECT ap.user_id, 'photo_comment', pc.id, pc.user_id, LEFT(pc.body, 60), pc.created_at, NOW()
FROM photo_comments pc
JOIN activity_photos ap ON ap.id = pc.photo_id
WHERE pc.created_at > NOW() - INTERVAL '7 days' AND ap.user_id <> pc.user_id;

INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview, created_at, read_at)
SELECT a.user_id, 'activity_comment', ac.id, ac.user_id, LEFT(ac.body, 60), ac.created_at, NOW()
FROM activity_comments ac
JOIN activities a ON a.id = ac.activity_id
WHERE ac.created_at > NOW() - INTERVAL '7 days' AND a.user_id <> ac.user_id;

INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview, created_at, read_at)
SELECT following_id, 'follow', follower_id, follower_id, NULL, created_at, NOW()
FROM follows
WHERE created_at > NOW() - INTERVAL '7 days' AND follower_id <> following_id;
