-- 2026-08-02 정정: 댓글 푸시는 원래부터 tg_user_notification_push (인박스→푸시 미러) 가
-- 담당하고 있었음 (activity_comment·photo_comment → social_comment, 토글 존중).
-- 20260802160000 에서 comment 트리거에 직접 추가한 푸시 INSERT 는 중복 —
-- (미러가 항상 먼저 적재돼 1h dedup 에 막히는 死코드) 원복해 단일 경로로.
CREATE OR REPLACE FUNCTION public.notify_on_activity_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_photo_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
