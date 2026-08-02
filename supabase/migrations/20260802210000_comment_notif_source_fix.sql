-- 댓글 알림 클릭 → "활동을 찾을 수 없습니다" fix (2026-08-02 hans 실기기)
-- 원인: source_id 에 댓글 id 를 저장 — 알림함/푸시 deep_link 는 활동 id 를 기대.
-- fix: source_id = activity_id / photo_id + 기존 행 보정.
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
  VALUES (owner_id, 'activity_comment', NEW.activity_id, NEW.user_id, LEFT(NEW.body, 60));
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
  VALUES (owner_id, 'photo_comment', NEW.photo_id, NEW.user_id, LEFT(NEW.body, 60));
  RETURN NEW;
END;
$function$;

-- 기존 잘못 저장된 행 보정 (댓글 id → 활동/사진 id)
UPDATE public.user_notifications n
   SET source_id = c.activity_id
  FROM public.activity_comments c
 WHERE n.kind = 'activity_comment' AND n.source_id = c.id;

UPDATE public.user_notifications n
   SET source_id = c.photo_id
  FROM public.photo_comments c
 WHERE n.kind = 'photo_comment' AND n.source_id = c.id;
