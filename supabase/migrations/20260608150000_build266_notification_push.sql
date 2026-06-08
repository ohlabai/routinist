-- build 266: user_notifications INSERT 시 push 자동 큐잉.
-- build 261 의 통합 알림 인박스에 push 까지 연결 → 앱 닫힌 상태에서도 알림 도착 + iOS 자동 배지 +1.
-- 이미 push 트리거 있는 테이블 (activity_cheers, photo_likes, quote_likes, messages) 은
-- user_notifications 가 안 잡으므로 중복 발사 위험 없음.

CREATE OR REPLACE FUNCTION tg_user_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_name text;
  push_category text;
  push_title text;
  push_body text;
BEGIN
  -- 카테고리 결정 — should_send_push 가 profiles.push_settings 의 boolean 체크
  push_category := CASE NEW.kind
    WHEN 'cheer' THEN 'social_cheer'
    WHEN 'photo_comment' THEN 'social_comment'
    WHEN 'activity_comment' THEN 'social_comment'
    WHEN 'follow' THEN 'social_follow'
    WHEN 'friend_request' THEN 'social_friend'
    WHEN 'friend_accepted' THEN 'social_friend'
    ELSE NULL
  END;
  IF push_category IS NULL THEN RETURN NEW; END IF;

  -- 사용자 push 설정 체크 (false 면 큐잉 skip). 기본 TRUE.
  IF NOT should_send_push(NEW.user_id, push_category) THEN
    RETURN NEW;
  END IF;

  -- actor 이름 (NULL 가능)
  IF NEW.actor_id IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM profiles WHERE id = NEW.actor_id;
  END IF;
  IF actor_name IS NULL OR length(actor_name) = 0 THEN
    actor_name := '러너';
  END IF;

  -- title / body
  push_title := CASE NEW.kind
    WHEN 'cheer' THEN actor_name || '님의 응원'
    WHEN 'photo_comment' THEN actor_name || '님의 댓글'
    WHEN 'activity_comment' THEN actor_name || '님의 댓글'
    WHEN 'follow' THEN actor_name || '님이 친구로 추가했어요'
    WHEN 'friend_request' THEN actor_name || '님의 친구 신청'
    WHEN 'friend_accepted' THEN actor_name || '님이 친구 신청을 수락했어요'
  END;

  push_body := CASE NEW.kind
    WHEN 'cheer' THEN COALESCE(NEW.preview, '🔥')
    WHEN 'photo_comment' THEN COALESCE(NEW.preview, '')
    WHEN 'activity_comment' THEN COALESCE(NEW.preview, '')
    WHEN 'follow' THEN '프로필을 확인해보세요'
    WHEN 'friend_request' THEN COALESCE(NEW.preview, '수락 또는 거절을 선택해주세요')
    WHEN 'friend_accepted' THEN '이제 함께 운동을 응원할 수 있어요'
  END;

  -- enqueue. 실제 발송은 별도 cron / edge function 에서 status='pending' row 처리.
  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    NEW.user_id,
    push_category,
    push_title,
    push_body,
    jsonb_build_object(
      'kind', NEW.kind,
      'notification_id', NEW.id,
      'source_id', NEW.source_id,
      'actor_id', NEW.actor_id
    ),
    'pending'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notifications_push ON user_notifications;
CREATE TRIGGER user_notifications_push
  AFTER INSERT ON user_notifications
  FOR EACH ROW EXECUTE FUNCTION tg_user_notification_push();
