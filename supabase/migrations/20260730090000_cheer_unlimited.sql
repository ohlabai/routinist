-- 응원 무제한 (2026-07-30 hans): "여러번 보내면 서로 좋지"
-- 1) 주 1회 unique 제약 제거 — 같은 사람에게 같은 이모지 몇 번이든 OK
ALTER TABLE public.user_cheers
  DROP CONSTRAINT IF EXISTS user_cheers_from_user_to_user_week_of_emoji_key;

-- 2) 알림 스팸 방지 — 같은 사람의 연속 응원은 시간당 1건만 인박스에 적재
--    (응원 자체는 전부 기록되고 카운트에 반영됨)
CREATE OR REPLACE FUNCTION public.notify_on_cheer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.from_user = NEW.to_user THEN
    RETURN NEW;
  END IF;
  -- 1시간 내 같은 응원자의 cheer 알림이 이미 있으면 새 알림 생략 (무제한 응원 스팸 가드)
  IF EXISTS (
    SELECT 1 FROM user_notifications
    WHERE user_id = NEW.to_user
      AND actor_id = NEW.from_user
      AND kind = 'cheer'
      AND created_at > now() - interval '1 hour'
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (NEW.to_user, 'cheer', NEW.id, NEW.from_user, NEW.emoji);
  RETURN NEW;
END;
$function$;
