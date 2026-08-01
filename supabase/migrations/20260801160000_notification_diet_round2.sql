-- 알림 다이어트 2탄 (2026-08-01 hans 결정)
-- ① weekly_recap (주간 리포트) 폐기  ② world_chase (월드런 추격, 크론 미등록 死코드) 폐기
-- ③ 댓글 푸시 신설 (social_comment) — 활동·사진 댓글 모두, 기존 인박스 직접 INSERT 는 유지
--    (tg_push_log_to_inbox 미러 목록에 없어 인박스 중복 없음)
-- ④ first_place_month: 7일 재발송 → "등극 순간만" (같은 범위 월 1회)

-- ① 주간 리포트
DROP FUNCTION IF EXISTS public.enqueue_weekly_recap_pushes();
UPDATE public.push_send_log SET status = 'cancelled'
WHERE category = 'weekly_recap' AND status = 'pending';

-- ② 월드런 추격
DROP FUNCTION IF EXISTS public.enqueue_world_chase_pushes();

-- ③-a 활동 댓글 → 푸시 추가
CREATE OR REPLACE FUNCTION public.notify_on_activity_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  owner_id uuid;
  v_safe text;
  v_preview text;
BEGIN
  SELECT user_id INTO owner_id FROM activities WHERE id = NEW.activity_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (owner_id, 'activity_comment', NEW.id, NEW.user_id, LEFT(NEW.body, 60));

  -- 2026-08-01 hans: 댓글도 푸시 (응원과 동일 정책 — 수신자당 시간당 1건)
  IF public.should_send_push(owner_id, 'social_comment')
     AND NOT EXISTS (
       SELECT 1 FROM public.push_send_log
       WHERE user_id = owner_id AND category = 'social_comment'
         AND created_at > NOW() - INTERVAL '1 hour'
     ) THEN
    SELECT regexp_replace(LEFT(display_name, 24), '[[:cntrl:]]', '', 'g')
      INTO v_safe FROM public.profiles WHERE id = NEW.user_id;
    v_preview := regexp_replace(LEFT(NEW.body, 40), '[[:cntrl:]]', '', 'g');
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      owner_id, 'social_comment',
      public.push_text(owner_id, '💬 새 댓글', '💬 New comment'),
      public.push_text(owner_id,
        COALESCE(v_safe, '러너') || '님: ' || v_preview,
        COALESCE(v_safe, 'A runner') || ': ' || v_preview),
      jsonb_build_object('actor_id', NEW.user_id, 'activity_id', NEW.activity_id,
                         'deep_link', '/activity?id=' || NEW.activity_id),
      'pending'
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ③-b 사진 댓글 → 푸시 추가
CREATE OR REPLACE FUNCTION public.notify_on_photo_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  owner_id uuid;
  v_safe text;
  v_preview text;
BEGIN
  SELECT user_id INTO owner_id FROM activity_photos WHERE id = NEW.photo_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (owner_id, 'photo_comment', NEW.id, NEW.user_id, LEFT(NEW.body, 60));

  IF public.should_send_push(owner_id, 'social_comment')
     AND NOT EXISTS (
       SELECT 1 FROM public.push_send_log
       WHERE user_id = owner_id AND category = 'social_comment'
         AND created_at > NOW() - INTERVAL '1 hour'
     ) THEN
    SELECT regexp_replace(LEFT(display_name, 24), '[[:cntrl:]]', '', 'g')
      INTO v_safe FROM public.profiles WHERE id = NEW.user_id;
    v_preview := regexp_replace(LEFT(NEW.body, 40), '[[:cntrl:]]', '', 'g');
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      owner_id, 'social_comment',
      public.push_text(owner_id, '💬 새 댓글', '💬 New comment'),
      public.push_text(owner_id,
        COALESCE(v_safe, '러너') || '님: ' || v_preview,
        COALESCE(v_safe, 'A runner') || ': ' || v_preview),
      jsonb_build_object('actor_id', NEW.user_id, 'photo_id', NEW.photo_id,
                         'deep_link', '/social?tab=photos'),
      'pending'
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ④ 월간 1위: 등극 순간만 — dedup 을 7일 → "같은 범위 + 같은 달 (KST) 1회" 로.
--    랭킹이 월 단위 리셋이라 달이 바뀌면 새 등극으로 취급. 유지 중 재발송 없음.
CREATE OR REPLACE FUNCTION public.enqueue_my_milestone_pushes(my_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$ #variable_conflict use_column
DECLARE
  enqueued INT := 0; v_rank INT; v_label TEXT; v_best NUMERIC;
BEGIN
  BEGIN
    SELECT rank_position, scope_label INTO v_rank, v_label
      FROM public.find_hero_rank(my_user_id, 'month') LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_rank := NULL;
  END;
  IF v_rank = 1 AND v_label IS NOT NULL
     AND public.should_send_push(my_user_id, 'first_place_month') THEN
    IF NOT EXISTS (SELECT 1 FROM public.push_send_log
        WHERE user_id = my_user_id AND category = 'first_place_month'
          AND (payload->>'scope_label') = v_label
          AND created_at >= (date_trunc('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::timestamp
                             AT TIME ZONE 'Asia/Seoul')) THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (my_user_id, 'first_place_month', '👑 ' || v_label || ' 1위!',
        '이번 달 ' || v_label || '에서 1위에 올랐어요',
        jsonb_build_object('scope_label', v_label, 'deep_link', '/ranking'), 'pending');
      enqueued := enqueued + 1;
    END IF;
  END IF;

  SELECT MAX(distance_km) INTO v_best FROM public.activities WHERE user_id = my_user_id;
  IF v_best IS NOT NULL AND v_best >= 10
     AND public.should_send_push(my_user_id, 'pb_distance') THEN
    IF NOT EXISTS (SELECT 1 FROM public.push_send_log
        WHERE user_id = my_user_id AND category = 'pb_distance'
          AND ((payload->>'distance_km')::NUMERIC) >= v_best) THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (my_user_id, 'pb_distance', '🎉 새로운 최장 거리!',
        ROUND(v_best, 1)::text || 'km — 신기록 달성!',
        jsonb_build_object('distance_km', v_best, 'deep_link', '/awards'), 'pending');
      enqueued := enqueued + 1;
    END IF;
  END IF;
  RETURN enqueued;
END;
$function$;
