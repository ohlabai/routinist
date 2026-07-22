-- 푸시 전용 카테고리 → 알림 인박스 편입 (2026-07-23 hans: "응 인박스에도 남겨줘").
--
-- 배경: friend_pb / friend_live_run 등은 푸시 배너로만 오고 user_notifications 에 안 남아
--   놓치면 확인 불가 + (배지 fix 이전엔) "배지만 있고 화면 비어있음" 혼란의 원인이었음.
-- 설계: push_send_log INSERT 트리거로 소셜 뉴스 5종을 인박스에 미러.
--   • 루프 없음 — tg_user_notification_push 는 kind 6종 (cheer/comment/follow/friend_*) 외 RETURN.
--   • 재시도 requeue 는 UPDATE 라 트리거 재발화 없음 (log 1행 = 유저 1명 = 인박스 1행).
--   • 알림 끈 유저는 enqueue 자체가 skip → 인박스도 안 쌓임 (동일 opt-out 존중).
--   • preview = push body (push_text 로 이미 수신자 locale 적용됨).
--
-- 프론트 kind 매핑 (아이콘·문구·딥링크) 은 다음 Archive 부터. 그 전 구버전 앱은
-- default fallback ("님의 새 알림" + /social?tab=friends) 으로 안전 (build 294 가드).

-- ─── 1) kind CHECK 확장 ──────────────────────────────────────────────
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_kind_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_kind_check
  CHECK (kind = ANY (ARRAY[
    'cheer', 'photo_comment', 'activity_comment', 'follow',
    'friend_request', 'friend_accepted', 'referral_joined',
    -- 푸시 미러 kinds (= push_send_log.category)
    'friend_pb', 'friend_live_run', 'friend_overtake', 'social_rival', 'first_place_month'
  ]::text[]));

-- ─── 2) 미러 트리거 ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_push_log_to_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor  UUID;
  v_source UUID;
BEGIN
  -- 소셜 뉴스만 미러. 리마인더류 (idle/streak/weekly_recap/welcome) 는 인박스 노이즈라 제외.
  IF NEW.category NOT IN ('friend_pb', 'friend_live_run', 'friend_overtake', 'social_rival', 'first_place_month') THEN
    RETURN NEW;
  END IF;

  v_actor := COALESCE(
    (NEW.payload->>'pb_user_id')::uuid,      -- friend_pb
    (NEW.payload->>'runner_id')::uuid,       -- friend_live_run
    (NEW.payload->>'rival_id')::uuid,        -- social_rival
    (NEW.payload->>'overtaker_id')::uuid,    -- friend_overtake
    (NEW.payload->>'actor_id')::uuid
  );
  -- first_place_month 는 본인 소식 (payload 에 actor 없음) — 본인을 actor 로 (프론트 "알 수 없음" 방지)
  IF v_actor IS NULL AND NEW.category = 'first_place_month' THEN
    v_actor := NEW.user_id;
  END IF;
  v_source := (NEW.payload->>'activity_id')::uuid;

  INSERT INTO public.user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (NEW.user_id, NEW.category, v_source, v_actor, LEFT(NEW.body, 200));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 인박스 미러 실패 (uuid 캐스트 등) 가 푸시 발송을 막으면 안 됨 — 조용히 통과.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_push_log_to_inbox ON public.push_send_log;
CREATE TRIGGER trg_push_log_to_inbox
  AFTER INSERT ON public.push_send_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_log_to_inbox();
