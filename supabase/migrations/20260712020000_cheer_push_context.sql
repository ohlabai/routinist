-- 2026-07-12: 응원 푸시 문구 context-aware + cheer deep_link 버그 fix
--
-- ① kind='cheer' 일 때 user_cheers.context 를 조인해 Run of the Day 응원이면
--    "오늘의 러너로 선정된 기록에 ❤️ 응원이 도착했어요" 로 맥락 있는 body.
-- ② 기존 버그: cheer deep_link 가 '/activity?id={user_cheers.id}' — source_id 는
--    응원 row id 라 활동 상세가 "활동을 찾을 수 없습니다" 로 떨어졌음 → '/notifications'.

CREATE OR REPLACE FUNCTION public.tg_user_notification_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_name text;
  push_category text;
  push_title text;
  push_body text;
  cheer_context text;
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
    actor_name := public.push_text(NEW.user_id, '러너', 'A runner');
  END IF;

  -- 응원 출처 (run_of_the_day / profile / feed …) — source_id = user_cheers.id
  IF NEW.kind = 'cheer' THEN
    SELECT context INTO cheer_context FROM user_cheers WHERE id = NEW.source_id;
  END IF;

  -- title / body
  push_title := CASE NEW.kind
    WHEN 'cheer' THEN public.push_text(NEW.user_id,
      actor_name || '님의 응원', actor_name || ' cheered you on')
    WHEN 'photo_comment' THEN public.push_text(NEW.user_id,
      actor_name || '님의 댓글', actor_name || ' left a comment')
    WHEN 'activity_comment' THEN public.push_text(NEW.user_id,
      actor_name || '님의 댓글', actor_name || ' left a comment')
    WHEN 'follow' THEN public.push_text(NEW.user_id,
      actor_name || '님이 친구로 추가했어요', actor_name || ' added you as a friend')
    WHEN 'friend_request' THEN public.push_text(NEW.user_id,
      actor_name || '님의 친구 신청', actor_name || ' sent you a friend request')
    WHEN 'friend_accepted' THEN public.push_text(NEW.user_id,
      actor_name || '님이 친구 신청을 수락했어요', actor_name || ' accepted your friend request')
  END;

  push_body := CASE NEW.kind
    WHEN 'cheer' THEN
      CASE cheer_context
        WHEN 'run_of_the_day' THEN public.push_text(NEW.user_id,
          '오늘의 러너로 선정된 기록에 ' || COALESCE(NEW.preview, '❤️') || ' 응원이 도착했어요',
          'Your best run of the day got a ' || COALESCE(NEW.preview, '❤️'))
        ELSE COALESCE(NEW.preview, '🔥')
      END
    WHEN 'photo_comment' THEN COALESCE(NEW.preview, '')
    WHEN 'activity_comment' THEN COALESCE(NEW.preview, '')
    WHEN 'follow' THEN public.push_text(NEW.user_id,
      '프로필을 확인해보세요', 'Check out their profile')
    WHEN 'friend_request' THEN COALESCE(NEW.preview,
      public.push_text(NEW.user_id, '수락 또는 거절을 선택해주세요', 'Accept or decline the request'))
    WHEN 'friend_accepted' THEN public.push_text(NEW.user_id,
      '이제 함께 운동을 응원할 수 있어요', 'Now you can cheer each other''s runs')
  END;

  -- enqueue. 실제 발송은 별도 cron / edge function 에서 status='pending' row 처리.
  -- build 297: deep_link — 인앱 알림함 getHref 와 동일 목적지 (photo 는 단건 라우트가 없어 탭 폴백).
  -- 2026-07-12: cheer 는 source_id 가 활동이 아니라 user_cheers.id 라 활동 딥링크가 404 였음 → 알림함.
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
      'actor_id', NEW.actor_id,
      'deep_link', CASE NEW.kind
        WHEN 'cheer' THEN '/notifications'
        WHEN 'activity_comment' THEN COALESCE('/activity?id=' || NEW.source_id::text, '/notifications')
        WHEN 'photo_comment' THEN '/social?tab=photos'
        WHEN 'follow' THEN COALESCE('/social/user?id=' || NEW.actor_id::text, '/social?tab=friends')
        ELSE '/social?tab=friends'
      END
    ),
    'pending'
  );
  RETURN NEW;
END;
$function$;
