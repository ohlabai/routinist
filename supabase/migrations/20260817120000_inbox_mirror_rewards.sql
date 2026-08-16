-- 2026-08-17 리뷰: 성취·보상 알림이 인박스에 안 남던 것.
--
-- tg_push_log_to_inbox 는 "소셜 뉴스만" 미러하도록 5종 화이트리스트였다.
-- 주석의 의도는 "리마인더류(idle/streak) 제외" 인데, 분류가 소셜/리마인더 둘뿐이라
-- **성취·보상**(예측 적중 50P, 개인 신기록, 추천 보상, 클럽 코스 완주) 이 같이 빠졌다.
-- prediction_result 는 이 트리거가 만들어진 뒤에 생긴 기능이라 애초에 낄 기회가 없었다.
--
-- 결과: 푸시를 놓치면 (폰 꺼둠·알림 스와이프) 50P 를 받은 사실을 영영 알 수 없었다.
-- 실측: prediction_result 2건 발송 / 인박스 0건.
--
-- idle_reminder·streak_risk 는 그대로 제외 — 지나가면 의미 없는 넛지라 인박스 노이즈가 맞다.

CREATE OR REPLACE FUNCTION public.tg_push_log_to_inbox()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor  UUID;
  v_source UUID;
BEGIN
  -- 미러 대상 = 소셜 뉴스 + 성취/보상.
  -- 제외 = 리마인더류(idle_reminder·streak_risk·welcome), 관리자(admin_report), 쪽지(chat_message).
  IF NEW.category NOT IN (
    -- 소셜 뉴스
    'friend_pb', 'friend_live_run', 'friend_overtake', 'social_rival', 'first_place_month',
    -- 성취·보상 (2026-08-17 추가) — 지나고 나서도 확인할 가치가 있는 것
    'prediction_result', 'pb_distance', 'referral', 'club_course_complete'
  ) THEN
    RETURN NEW;
  END IF;

  v_actor := COALESCE(
    (NEW.payload->>'pb_user_id')::uuid,      -- friend_pb
    (NEW.payload->>'runner_id')::uuid,       -- friend_live_run
    (NEW.payload->>'rival_id')::uuid,        -- social_rival
    (NEW.payload->>'overtaker_id')::uuid,    -- friend_overtake
    (NEW.payload->>'actor_id')::uuid
  );
  -- 본인 소식 (payload 에 상대가 없음) 은 본인을 actor 로 — 프론트 "알 수 없음" 방지.
  IF v_actor IS NULL THEN
    v_actor := NEW.user_id;
  END IF;
  v_source := (NEW.payload->>'activity_id')::uuid;

  INSERT INTO public.user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (NEW.user_id, NEW.category, v_source, v_actor, LEFT(NEW.body, 200));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 인박스 미러 실패가 푸시 발송을 막으면 안 된다. 다만 **조용히** 지나가면 안 된다 —
  -- 같은 패턴(EXCEPTION 삼킴)으로 마일리지가 3주 동안 조용히 죽은 전례가 있다.
  RAISE WARNING '[inbox-mirror] % 미러 실패 (user=%): %', NEW.category, NEW.user_id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- ⚠️ 화이트리스트만 늘리면 아무 일도 안 일어난다 — user_notifications.kind 의 CHECK 가
-- 새 kind 를 거부하고, 트리거의 EXCEPTION 이 그 실패를 삼킨다.
-- (마일리지가 3주 조용히 죽었던 것과 **정확히 같은 구조**: CHECK 미허용 + EXCEPTION 삼킴)
-- 실측으로 확인: 트리거만 고치고 테스트하니 인박스 0행.
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_kind_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_kind_check CHECK (
  kind = ANY (ARRAY[
    -- 기존
    'cheer', 'photo_comment', 'activity_comment', 'follow', 'friend_request',
    'friend_accepted', 'referral_joined', 'friend_pb', 'friend_live_run',
    'friend_overtake', 'social_rival', 'first_place_month',
    -- 2026-08-17 추가 (성취·보상)
    'prediction_result', 'pb_distance', 'referral', 'club_course_complete'
  ])
);
