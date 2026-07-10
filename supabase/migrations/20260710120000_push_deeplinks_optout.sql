-- build 297: 알림 종단 리뷰 후속 (2026-07-10)
--
-- ① 월드런 3함수 deep_link 오배송 fix — '/social/rankings?tab=world' 는 tab 파라미터를 안 읽는
--    지역 랭킹 페이지, 'routinist://world/course' 는 라우트 자체가 없음. 실제 월드런 위치는
--    '/ranking?tab=world'.
-- ② deep_link 없던 producer 전체에 kind 별 목적지 추가 — 탭해도 마지막 화면만 열리던 문제.
-- ③ opt-out 불가 카테고리 5종 (first_place_month / pb_distance / weekly_best_quote /
--    review_request / low_stock_wishlist) 에 should_send_push 체크 추가.
-- ④ weekly_recap 주 1회 dedup 이 failed 행도 발송 이력으로 집계 → 429 유실 주는 영구 미수신.
--    dedup 에서 failed 제외 (재큐 fix 와 페어).

-- ── ① 월드런 deep_link ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_course_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  v_progress NUMERIC;
  v_pct NUMERIC;
  v_done JSONB;
  v_milestone INT;
  v_remaining NUMERIC;
BEGIN
  FOR r IN
    SELECT ucp.course_id, ucp.started_at, ucp.notified_milestones,
           vc.name, vc.distance_km
      FROM public.user_course_progress ucp
      JOIN public.virtual_courses vc ON vc.id = ucp.course_id
     WHERE ucp.user_id = NEW.user_id
       AND ucp.completed_at IS NULL
  LOOP
    SELECT COALESCE(SUM(a.distance_km), 0) INTO v_progress
      FROM public.activities a
     WHERE a.user_id = NEW.user_id
       AND a.activity_date >= (r.started_at AT TIME ZONE 'Asia/Seoul')::DATE
       AND (a.activity_type IS NULL OR a.activity_type = 'running');

    IF r.distance_km IS NULL OR r.distance_km <= 0 THEN CONTINUE; END IF;
    v_pct := v_progress / r.distance_km * 100;
    v_done := r.notified_milestones;

    FOREACH v_milestone IN ARRAY ARRAY[50, 90]
    LOOP
      IF v_pct >= v_milestone AND v_pct < 100
         AND NOT (v_done @> to_jsonb(v_milestone)) THEN
        IF public.should_send_push(NEW.user_id, 'course_progress') THEN
          v_remaining := GREATEST(0, r.distance_km - v_progress);
          INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
          VALUES (
            NEW.user_id, 'course_progress',
            CASE WHEN v_milestone = 50
                 THEN public.push_text(NEW.user_id,
                        '🔥 ' || r.name || ' 절반 왔어요!',
                        '🔥 Halfway through ' || r.name || '!')
                 ELSE public.push_text(NEW.user_id,
                        '🏁 ' || r.name || ' 거의 다 왔어요!',
                        '🏁 Almost there — ' || r.name || '!') END,
            public.push_text(NEW.user_id,
              v_progress::numeric(10,2) || ' / ' || r.distance_km::numeric(10,2) || ' km · '
                || '남은 거리 ' || v_remaining::numeric(10,2) || ' km',
              v_progress::numeric(10,2) || ' / ' || r.distance_km::numeric(10,2) || ' km · '
                || v_remaining::numeric(10,2) || ' km to go'),
            jsonb_build_object(
              'course_id', r.course_id::text,
              'course_name', r.name,
              'progress_pct', v_milestone,
              'deep_link', '/ranking?tab=world'
            ),
            'pending'
          );
        END IF;
        v_done := v_done || to_jsonb(v_milestone);
      END IF;
    END LOOP;

    IF v_done <> r.notified_milestones THEN
      UPDATE public.user_course_progress
         SET notified_milestones = v_done
       WHERE user_id = NEW.user_id AND course_id = r.course_id;
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._complete_course(p_user_id uuid, p_course_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fee INTEGER;
  v_refund INTEGER;
  v_name TEXT;
  v_balance INTEGER;
  v_already_refunded BOOLEAN;
BEGIN
  -- 완주 표시 (이미 표시돼있으면 갱신 안 함)
  UPDATE public.user_course_progress
     SET completed_at = COALESCE(completed_at, now()),
         notified_at  = COALESCE(notified_at, now())
   WHERE user_id = p_user_id AND course_id = p_course_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT entry_fee_p, name INTO v_fee, v_name
  FROM public.virtual_courses WHERE id = p_course_id;
  v_refund := COALESCE(v_fee, 0) / 2;

  -- 이미 같은 course 에 대해 환급된 적 있는지 확인 (멱등성)
  SELECT EXISTS (
    SELECT 1 FROM public.mileage_transactions
    WHERE user_id = p_user_id
      AND event_type = 'course_complete_refund'
      AND reference_id = p_course_id
  ) INTO v_already_refunded;

  IF v_refund > 0 AND NOT v_already_refunded THEN
    UPDATE public.profiles
       SET mileage_balance = COALESCE(mileage_balance, 0) + v_refund
     WHERE id = p_user_id
     RETURNING mileage_balance INTO v_balance;

    INSERT INTO public.mileage_transactions
      (user_id, amount, balance_after, tx_type, event_type, reference_id, description, metadata)
    VALUES
      (p_user_id, v_refund, COALESCE(v_balance, v_refund), 'reward',
       'course_complete_refund', p_course_id,
       '월드런 완주 환급 50% — ' || COALESCE(v_name, '코스'),
       jsonb_build_object(
         'course_id', p_course_id,
         'course_name', v_name,
         'refund_amount', v_refund,
         'original_fee', v_fee
       ));
  END IF;

  -- push 큐 — 사용자 설정 (push_settings.course_complete) 존중
  IF public.should_send_push(p_user_id, 'course_complete') THEN
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      p_user_id,
      'course_complete',
      public.push_text(p_user_id,
        '🏆 ' || COALESCE(v_name, '월드런') || ' 완주!',
        '🏆 ' || COALESCE(v_name, 'World Run') || ' complete!'),
      CASE
        WHEN v_refund > 0 AND NOT v_already_refunded
          THEN public.push_text(p_user_id,
                 '메달이 도착했어요. 마일리지 ' || v_refund::text || 'P 환급 ✨',
                 'Your medal is here — ' || v_refund::text || 'P mileage refunded ✨')
        ELSE public.push_text(p_user_id,
               '메달이 도착했어요. 친구들에게 자랑해보세요 ✨',
               'Your medal is here. Show it off to your friends ✨')
      END,
      jsonb_build_object(
        'course_id', p_course_id::text,
        'course_name', v_name,
        'deep_link', '/ranking?tab=world'
      ),
      'pending'
    );
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.enqueue_world_chase_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enqueued INT := 0;
  v_rec RECORD;
  v_chaser_name TEXT;
  v_safe_name TEXT;
BEGIN
  FOR v_rec IN
    WITH course_progress AS (
      SELECT ucp.user_id, ucp.course_id, c.name AS course_name,
             COALESCE((
               SELECT SUM(a.distance_km) FROM activities a
                WHERE a.user_id = ucp.user_id
                  AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
                  AND (a.activity_type IS NULL OR a.activity_type = 'running')
             ), 0)::NUMERIC AS progress_km
      FROM user_course_progress ucp
      JOIN virtual_courses c ON c.id = ucp.course_id
      WHERE ucp.completed_at IS NULL
    )
    SELECT a.user_id AS recipient_id, b.user_id AS chaser_id, a.course_id, a.course_name,
           a.progress_km AS recipient_km, b.progress_km AS chaser_km, (a.progress_km - b.progress_km) AS gap_km
    FROM course_progress a
    JOIN course_progress b ON b.course_id = a.course_id AND b.user_id <> a.user_id
    JOIN follows f ON f.follower_id = a.user_id AND f.following_id = b.user_id
    WHERE a.progress_km > b.progress_km AND (a.progress_km - b.progress_km) < 1.5 AND b.progress_km > 0
  LOOP
    IF EXISTS (SELECT 1 FROM push_send_log WHERE user_id = v_rec.recipient_id AND category = 'world_chase'
        AND (payload->>'course_id') = v_rec.course_id::text AND (payload->>'chaser_id') = v_rec.chaser_id::text
        AND created_at > NOW() - INTERVAL '24 hours') THEN CONTINUE; END IF;

    IF NOT public.should_send_push(v_rec.recipient_id, 'world_chase') THEN CONTINUE; END IF;

    SELECT display_name INTO v_chaser_name FROM profiles WHERE id = v_rec.chaser_id;
    IF v_chaser_name IS NULL THEN CONTINUE; END IF;
    -- build 236 #H1: push body 피싱 본문 주입 방지 — 제어문자 제거 + 24자 truncate.
    v_safe_name := regexp_replace(LEFT(v_chaser_name, 24), '[[:cntrl:]]', '', 'g');

    INSERT INTO push_send_log (user_id, category, title, body, payload, status)
    VALUES (v_rec.recipient_id, 'world_chase',
      public.push_text(v_rec.recipient_id,
        '🏃 ' || v_rec.course_name || ' 추격 중!',
        '🏃 Someone''s chasing you on ' || v_rec.course_name || '!'),
      public.push_text(v_rec.recipient_id,
        v_safe_name || '님이 ' || ROUND(v_rec.gap_km, 1)::text || 'km 뒤에서 따라오고 있어요!',
        v_safe_name || ' is just ' || ROUND(v_rec.gap_km, 1)::text || 'km behind you!'),
      jsonb_build_object('course_id', v_rec.course_id::text, 'chaser_id', v_rec.chaser_id::text,
        'recipient_km', v_rec.recipient_km, 'chaser_km', v_rec.chaser_km, 'gap_km', v_rec.gap_km,
        'deep_link', '/ranking?tab=world'), 'pending');
    v_enqueued := v_enqueued + 1;
  END LOOP;
  RETURN v_enqueued;
END;
$function$;

-- ── ② kind 별 deep_link 추가 ──────────────────────────────────────────

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
    WHEN 'cheer' THEN COALESCE(NEW.preview, '🔥')
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
        WHEN 'cheer' THEN COALESCE('/activity?id=' || NEW.source_id::text, '/notifications')
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

CREATE OR REPLACE FUNCTION public.tg_message_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sender_name TEXT; v_preview TEXT; v_receiver_id UUID;
BEGIN
  SELECT CASE WHEN c.user_a = NEW.sender_id THEN c.user_b ELSE c.user_a END
  INTO v_receiver_id FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF v_receiver_id IS NULL OR v_receiver_id = NEW.sender_id THEN RETURN NEW; END IF;
  IF NOT public.should_send_push(v_receiver_id, 'chat_message') THEN RETURN NEW; END IF;
  SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  v_preview := LEFT(NEW.body, 50);
  IF length(NEW.body) > 50 THEN v_preview := v_preview || '…'; END IF;
  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_receiver_id, 'chat_message',
    '💬 ' || COALESCE(v_sender_name, '러너') || '님',
    v_preview,
    jsonb_build_object('message_id', NEW.id::text, 'sender_id', NEW.sender_id::text, 'conversation_id', NEW.conversation_id::text,
      'deep_link', '/messages/chat?user=' || NEW.sender_id::text),
    'pending'
  );
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.tg_activity_cheer_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner_id UUID; v_cheerer_name TEXT;
BEGIN
  SELECT user_id INTO v_owner_id FROM public.activities WHERE id = NEW.activity_id;
  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN RETURN NEW; END IF;
  IF NOT public.should_send_push(v_owner_id, 'likes') THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.push_send_log
    WHERE user_id = v_owner_id AND category = 'likes'
      AND (payload->>'activity_id') = NEW.activity_id::text
      AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN RETURN NEW; END IF;
  SELECT display_name INTO v_cheerer_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_owner_id, 'likes',
    '📣 응원이 도착했어요',
    COALESCE(v_cheerer_name, '러너') || '님이 내 활동을 응원해요',
    jsonb_build_object('activity_id', NEW.activity_id::text, 'cheerer_id', NEW.user_id::text,
      'deep_link', '/activity?id=' || NEW.activity_id::text),
    'pending'
  );
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.tg_photo_like_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner_id UUID; v_liker_name TEXT;
BEGIN
  SELECT user_id INTO v_owner_id FROM public.activity_photos WHERE id = NEW.photo_id;
  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN RETURN NEW; END IF;
  IF NOT public.should_send_push(v_owner_id, 'likes') THEN RETURN NEW; END IF;
  -- 같은 사진에 24시간 내 중복 알림 회피
  IF EXISTS (
    SELECT 1 FROM public.push_send_log
    WHERE user_id = v_owner_id AND category = 'likes'
      AND (payload->>'photo_id') = NEW.photo_id::text
      AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN RETURN NEW; END IF;
  SELECT display_name INTO v_liker_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_owner_id, 'likes',
    '❤️ 사진에 좋아요',
    COALESCE(v_liker_name, '누군가') || '님이 사진을 좋아해요',
    jsonb_build_object('photo_id', NEW.photo_id::text, 'liker_id', NEW.user_id::text,
      'deep_link', '/social?tab=photos'),
    'pending'
  );
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.tg_quote_like_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner_id UUID; v_liker_name TEXT;
BEGIN
  SELECT user_id INTO v_owner_id FROM public.quotes WHERE id = NEW.quote_id;
  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN RETURN NEW; END IF;
  IF NOT public.should_send_push(v_owner_id, 'likes') THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.push_send_log
    WHERE user_id = v_owner_id AND category = 'likes'
      AND (payload->>'quote_id') = NEW.quote_id::text
      AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN RETURN NEW; END IF;
  SELECT display_name INTO v_liker_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_owner_id, 'likes',
    '❤️ 한 줄에 좋아요',
    COALESCE(v_liker_name, '누군가') || '님이 내 한 줄을 좋아해요',
    jsonb_build_object('quote_id', NEW.quote_id::text, 'liker_id', NEW.user_id::text,
      'deep_link', '/quotes/mine'),
    'pending'
  );
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.tg_feedback_reply_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- admin_reply 가 NULL → NOT NULL 로 바뀐 경우만 (새 답글). 수정 시 재발송 안 함.
  IF OLD.admin_reply IS NOT NULL OR NEW.admin_reply IS NULL THEN RETURN NEW; END IF;
  IF NOT public.should_send_push(NEW.user_id, 'feedback_reply') THEN RETURN NEW; END IF;
  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    NEW.user_id, 'feedback_reply',
    '📣 제안에 답글이 달렸어요',
    '"' || LEFT(NEW.title, 30) || (CASE WHEN length(NEW.title) > 30 THEN '…' ELSE '' END) || '" 에 운영자가 답했어요',
    jsonb_build_object('feedback_id', NEW.id::text, 'deep_link', '/feedback'),
    'pending'
  );
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.notify_rival_on_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month text;
  v_rival_id uuid;
  v_actor_name text;
BEGIN
  IF NEW.visibility <> 'public' OR NEW.distance_km < 0.5 THEN
    RETURN NEW;
  END IF;

  v_month := to_char((NEW.activity_date)::date, 'YYYY-MM');

  SELECT opponent_id INTO v_rival_id FROM monthly_rivals
  WHERE user_id = NEW.user_id AND month = v_month
  LIMIT 1;
  IF v_rival_id IS NULL THEN RETURN NEW; END IF;

  IF NOT should_send_push(v_rival_id, 'social_rival') THEN RETURN NEW; END IF;

  SELECT display_name INTO v_actor_name FROM profiles WHERE id = NEW.user_id;
  IF v_actor_name IS NULL THEN
    v_actor_name := public.push_text(v_rival_id, '페이스메이커', 'Your pacemaker');
  END IF;

  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_rival_id,
    'social_rival',
    public.push_text(v_rival_id,
      '⚔️ 페이스메이커가 뛰었어요',
      '⚔️ Your pacemaker just ran'),
    public.push_text(v_rival_id,
      v_actor_name || '님이 ' || ROUND(NEW.distance_km::numeric, 1) || 'km 뛰었어요. 따라잡아볼까요?',
      v_actor_name || ' ran ' || ROUND(NEW.distance_km::numeric, 1) || 'km. Time to catch up?'),
    jsonb_build_object('kind', 'rival_activity', 'rival_id', NEW.user_id, 'distance_km', NEW.distance_km,
      'deep_link', '/'),
    'pending'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_friend_overtake_pushes(my_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ #variable_conflict use_column
DECLARE
  my_name TEXT; my_km NUMERIC; friend_rec RECORD; enqueued INT := 0; week_start DATE;
  v_safe TEXT;
BEGIN
  week_start := (CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::INT + 6) % 7))::DATE;
  SELECT display_name INTO my_name FROM public.profiles WHERE id = my_user_id;
  -- build 236 #H1: 닉네임 피싱 방지
  v_safe := regexp_replace(LEFT(COALESCE(my_name, '러너'), 24), '[[:cntrl:]]', '', 'g');
  SELECT COALESCE(SUM(distance_km), 0) INTO my_km FROM public.activities WHERE user_id = my_user_id AND activity_date >= week_start;
  FOR friend_rec IN
    SELECT f.following_id AS friend_id, p.display_name AS friend_name,
           COALESCE((SELECT SUM(a.distance_km) FROM public.activities a WHERE a.user_id = f.following_id AND a.activity_date >= week_start), 0) AS friend_km
    FROM public.follows f JOIN public.profiles p ON p.id = f.following_id
    WHERE f.follower_id = my_user_id
  LOOP
    IF friend_rec.friend_km > 0 AND friend_rec.friend_km < my_km THEN
      IF NOT EXISTS (SELECT 1 FROM public.push_send_log WHERE user_id = friend_rec.friend_id AND category = 'friend_overtake'
          AND (payload->>'overtaker_id') = my_user_id::text AND created_at > NOW() - INTERVAL '24 hours') THEN
        INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
        VALUES (friend_rec.friend_id, 'friend_overtake', '⚡ 추월당했어요!',
          v_safe || '님이 이번 주 ' || ROUND(my_km, 1)::text || 'km로 앞섰어요',
          jsonb_build_object('overtaker_id', my_user_id::text, 'my_km', my_km, 'friend_km', friend_rec.friend_km,
            'deep_link', '/ranking'),
          'pending');
        enqueued := enqueued + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN enqueued;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_friend_pb_pushes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner_name TEXT;
  v_safe_name TEXT;
  v_dist_label TEXT;
  v_dist_label_en TEXT;
  v_time_label TEXT;
  v_friend RECORD;
  v_prev_seconds INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.best_seconds >= OLD.best_seconds THEN RETURN NEW; END IF;
    v_prev_seconds := OLD.best_seconds;
  ELSE
    v_prev_seconds := NULL;
  END IF;

  SELECT display_name INTO v_owner_name FROM public.profiles WHERE id = NEW.user_id;
  IF v_owner_name IS NULL THEN RETURN NEW; END IF;
  -- build 236 #H1: 닉네임 sanitize
  v_safe_name := regexp_replace(LEFT(v_owner_name, 24), '[[:cntrl:]]', '', 'g');

  v_dist_label := CASE
    WHEN NEW.distance_meters = 42195 THEN '풀'
    WHEN NEW.distance_meters = 21097 THEN '하프'
    WHEN NEW.distance_meters >= 1000 THEN (NEW.distance_meters / 1000) || 'km'
    ELSE NEW.distance_meters || 'm'
  END;
  v_dist_label_en := CASE
    WHEN NEW.distance_meters = 42195 THEN 'Full marathon'
    WHEN NEW.distance_meters = 21097 THEN 'Half marathon'
    WHEN NEW.distance_meters >= 1000 THEN (NEW.distance_meters / 1000) || 'km'
    ELSE NEW.distance_meters || 'm'
  END;
  v_time_label := CASE
    WHEN NEW.best_seconds >= 3600 THEN
      (NEW.best_seconds / 3600) || ':' || LPAD(((NEW.best_seconds % 3600) / 60)::TEXT, 2, '0') || ':' || LPAD((NEW.best_seconds % 60)::TEXT, 2, '0')
    ELSE
      (NEW.best_seconds / 60) || ':' || LPAD((NEW.best_seconds % 60)::TEXT, 2, '0')
  END;

  FOR v_friend IN SELECT f.follower_id AS friend_id FROM public.follows f WHERE f.following_id = NEW.user_id
  LOOP
    -- build 291 [P2]: friend_pb 도 사용자 push 설정 존중 (기존엔 유일하게 opt-out 미체크)
    IF public.should_send_push(v_friend.friend_id, 'friend_pb')
       AND NOT EXISTS (SELECT 1 FROM public.push_send_log WHERE user_id = v_friend.friend_id AND category = 'friend_pb'
        AND (payload->>'pb_user_id') = NEW.user_id::text AND (payload->>'distance_meters') = NEW.distance_meters::text
        AND created_at > NOW() - INTERVAL '24 hours') THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (v_friend.friend_id, 'friend_pb',
        public.push_text(v_friend.friend_id, '🎉 친구 PB 갱신!', '🎉 Your friend set a new PB!'),
        public.push_text(v_friend.friend_id,
          v_safe_name || '님이 ' || v_dist_label || ' ' || v_time_label || ' PB 달성',
          v_safe_name || ' set a ' || v_dist_label_en || ' PB — ' || v_time_label),
        jsonb_build_object('pb_user_id', NEW.user_id::text, 'distance_meters', NEW.distance_meters,
          'new_seconds', NEW.best_seconds, 'prev_seconds', v_prev_seconds, 'activity_id', NEW.activity_id,
          'deep_link', COALESCE('/activity?id=' || NEW.activity_id::text, '/social/user?id=' || NEW.user_id::text)),
        'pending');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.award_referral_inviter()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inviter uuid;
  v_milestone_id text;
  v_total_km numeric;
  v_awarded boolean := false;
  v_amount int := 0;
  v_invitee_name text;
BEGIN
  -- ① 걷기 제외 (null = 러닝으로 간주, 레거시 데이터 호환)
  IF COALESCE(NEW.activity_type, 'running') = 'walking' THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- ② 초대받은 유저만 (PK 단건 조회 — 비초대 유저는 여기서 끝)
    SELECT invited_by INTO v_inviter FROM public.profiles WHERE id = NEW.user_id;
    IF v_inviter IS NULL THEN
      RETURN NEW;
    END IF;

    -- ③ 이미 지급됐으면 SUM 없이 종료
    v_milestone_id := 'referral_' || NEW.user_id::text;
    IF EXISTS (
      SELECT 1 FROM public.mileage_transactions
       WHERE user_id = v_inviter
         AND event_type = 'friend_invite_inviter'
         AND metadata->>'milestone_id' = v_milestone_id
    ) THEN
      RETURN NEW;
    END IF;

    -- ④ 누적 러닝 (걷기 제외, AFTER 트리거이므로 NEW 행 포함)
    SELECT COALESCE(SUM(distance_km), 0) INTO v_total_km
      FROM public.activities
     WHERE user_id = NEW.user_id
       AND COALESCE(activity_type, 'running') <> 'walking';
    IF v_total_km < 5 THEN
      RETURN NEW;
    END IF;

    SELECT t.awarded, t.amount INTO v_awarded, v_amount
      FROM public.award_mileage(
        v_inviter,
        'friend_invite_inviter',
        jsonb_build_object('milestone_id', v_milestone_id, 'invitee_id', NEW.user_id)
      ) t;

    IF v_awarded AND public.should_send_push(v_inviter, 'referral') THEN
      SELECT display_name INTO v_invitee_name FROM public.profiles WHERE id = NEW.user_id;
      v_invitee_name := COALESCE(NULLIF(trim(v_invitee_name), ''),
                                 public.push_text(v_inviter, '초대한 친구', 'Your invitee'));

      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (
        v_inviter,
        'referral',
        public.push_text(v_inviter, '🎉 초대 보상 도착', '🎉 Invite reward earned'),
        public.push_text(v_inviter,
          '초대한 ' || v_invitee_name || '님이 5km를 달성했어요! ' || v_amount || 'P 적립 🎉',
          v_invitee_name || ', your invitee, just passed 5km! You earned ' || v_amount || 'P 🎉'),
        jsonb_build_object('kind', 'referral_milestone', 'invitee_id', NEW.user_id, 'amount', v_amount,
          'deep_link', '/social/user?id=' || NEW.user_id::text),
        'pending'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- 보상/알림 실패가 activity 저장을 막으면 안 됨
    RAISE WARNING 'award_referral_inviter failed for activity=% user=%: % (SQLSTATE %)',
      NEW.id, NEW.user_id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.claim_referral_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(trim(COALESCE(p_code, '')));
  v_inviter uuid;
  v_my_invited_by uuid;
  v_signup_at timestamptz;
  v_awarded boolean := false;
  v_amount int := 0;
  v_my_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- 코드 → 초대자
  SELECT id INTO v_inviter FROM public.profiles WHERE referral_code = v_code;
  IF v_inviter IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  IF v_inviter = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self');
  END IF;

  SELECT invited_by INTO v_my_invited_by FROM public.profiles WHERE id = v_uid;
  IF v_my_invited_by IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END IF;

  -- 가입 14일 초과 방지 (SECURITY DEFINER 라 auth.users 조회 가능)
  SELECT created_at INTO v_signup_at FROM auth.users WHERE id = v_uid;
  IF v_signup_at IS NULL OR v_signup_at < NOW() - INTERVAL '14 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_old');
  END IF;

  -- invited_by 세팅 — 조건부 UPDATE 로 동시 claim race 차단
  UPDATE public.profiles
     SET invited_by = v_inviter
   WHERE id = v_uid AND invited_by IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END IF;

  -- invitee 100P 즉시 지급 (reference: 초대자 uuid 를 metadata 에 기록)
  BEGIN
    SELECT t.awarded, t.amount INTO v_awarded, v_amount
      FROM public.award_mileage(
        v_uid,
        'friend_invite_invitee',
        jsonb_build_object('inviter_id', v_inviter, 'referral_code', v_code)
      ) t;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'claim_referral_code: invitee award failed for %: % (SQLSTATE %)',
      v_uid, SQLERRM, SQLSTATE;
  END;

  -- 초대자 알림 (인박스 + push) — 실패해도 claim 은 성공 처리
  BEGIN
    SELECT display_name INTO v_my_name FROM public.profiles WHERE id = v_uid;
    v_my_name := COALESCE(NULLIF(trim(v_my_name), ''),
                          public.push_text(v_inviter, '새 러닝메이트', 'A new running mate'));

    INSERT INTO public.user_notifications (user_id, kind, actor_id, preview)
    VALUES (v_inviter, 'referral_joined', v_uid, v_my_name);

    IF public.should_send_push(v_inviter, 'referral') THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (
        v_inviter,
        'referral',
        public.push_text(v_inviter, '🎉 새 러닝메이트', '🎉 New running mate'),
        public.push_text(v_inviter,
          v_my_name || '님이 초대 코드로 가입했어요 🎉',
          v_my_name || ' joined with your invite code 🎉'),
        jsonb_build_object('kind', 'referral_joined', 'invitee_id', v_uid,
          'deep_link', '/social/user?id=' || v_uid::text),
        'pending'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'claim_referral_code: inviter notify failed for %: % (SQLSTATE %)',
      v_inviter, SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object('ok', true, 'awarded', v_awarded, 'amount', v_amount);
END $function$;

-- ── ③ opt-out 미체크 5종 + 기록 알림 deep_link ────────────────────────

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
          AND created_at > NOW() - INTERVAL '7 days') THEN
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

CREATE OR REPLACE FUNCTION public.enqueue_weekly_best_quote()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    WITH ranked AS (
      SELECT q.id, q.user_id, q.text,
        COALESCE(COUNT(ql.user_id), 0) AS wk_likes
      FROM public.quotes q
      LEFT JOIN public.quote_likes ql
        ON ql.quote_id = q.id AND ql.created_at > NOW() - INTERVAL '7 days'
      WHERE q.status = 'approved' AND q.user_id IS NOT NULL
      GROUP BY q.id, q.user_id, q.text
      HAVING COUNT(ql.user_id) >= 10
    )
    SELECT * FROM ranked ORDER BY wk_likes DESC LIMIT 5
  LOOP
    -- 이미 같은 quote 의 weekly_best 푸시 발송 이력 있으면 skip
    IF EXISTS(
      SELECT 1 FROM public.push_send_log
       WHERE category = 'weekly_best_quote'
         AND (payload->>'quote_id')::UUID = v_row.id
    ) THEN CONTINUE; END IF;

    -- build 297: opt-out 존중
    IF NOT public.should_send_push(v_row.user_id, 'weekly_best_quote') THEN CONTINUE; END IF;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'weekly_best_quote',
       '🏆 이번 주 최고의 명언!',
       '러너들이 ' || v_row.wk_likes || '번 좋아요를 눌렀어요. 명언 사전에서 확인해보세요',
       jsonb_build_object('quote_id', v_row.id, 'deep_link', '/quotes/ranking'),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

CREATE OR REPLACE FUNCTION public.enqueue_review_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  -- 배송 완료 24~72시간 + 사용자가 아직 어떤 리뷰도 안 쓴 주문
  FOR v_row IN
    SELECT DISTINCT o.id, o.user_id, o.order_no, oi.product_name
      FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      LEFT JOIN public.product_reviews pr
        ON pr.product_id = oi.product_id AND pr.user_id = o.user_id
     WHERE o.status = 'delivered'
       AND o.delivered_at BETWEEN NOW() - INTERVAL '72 hours' AND NOW() - INTERVAL '24 hours'
       AND pr.id IS NULL
       AND public.should_send_push(o.user_id, 'review_request')
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = o.user_id
            AND psl.category = 'review_request'
            AND (psl.payload->>'order_id')::UUID = o.id
       )
  LOOP
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'review_request',
       '리뷰 한 줄 부탁해요 ✍️',
       v_row.product_name || ' 어떠셨나요? 다른 러너들에게 공유해 주세요',
       jsonb_build_object('order_id', v_row.id, 'order_no', v_row.order_no, 'deep_link', '/shop/order?id=' || v_row.id),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

CREATE OR REPLACE FUNCTION public.enqueue_low_stock_wishlist()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT w.user_id, p.id AS product_id, p.name, p.stock
      FROM public.shop_wishlist w
      JOIN public.products p ON p.id = w.product_id
     WHERE p.stock > 0 AND p.stock <= 5
       AND p.status = 'published'
       -- build 297: 마케팅 성격 → marketing opt-in (기본 OFF) 존중
       AND public.should_send_push(w.user_id, 'low_stock_wishlist')
       AND public.should_send_push(w.user_id, 'marketing')
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = w.user_id
            AND psl.category = 'low_stock_wishlist'
            AND (psl.payload->>'product_id')::UUID = p.id
            AND psl.created_at > NOW() - INTERVAL '7 days'
       )
  LOOP
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'low_stock_wishlist',
       '🔥 찜한 상품 마지막 ' || v_row.stock || '개',
       v_row.name || ' 곧 품절될 것 같아요. 지금 확인해 보세요',
       jsonb_build_object('product_id', v_row.product_id, 'deep_link', '/shop/product?id=' || v_row.product_id),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

-- ── ④ weekly_recap dedup — failed 는 발송 이력으로 안 침 ──────────────

CREATE OR REPLACE FUNCTION public.enqueue_weekly_recap_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_today DATE;
  v_week_start DATE;   -- 지난주 월요일
  v_week_end DATE;     -- 지난주 일요일
  v_km NUMERIC;
  v_runs INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT pd.user_id
      FROM public.push_device_tokens pd
     WHERE pd.enabled = true
       AND public.should_send_push(pd.user_id, 'weekly_recap')
       -- 성능 필터: 최근 8일 내 활동이 있는 유저만 후보
       AND EXISTS (
         SELECT 1 FROM public.activities a
          WHERE a.user_id = pd.user_id
            AND a.activity_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 8
       )
     GROUP BY pd.user_id
     LIMIT 500
  LOOP
    v_today := public.local_today(v_row.user_id);
    -- 로컬 오늘이 월요일인 유저만 (ISODOW: 월=1)
    IF EXTRACT(ISODOW FROM v_today) <> 1 THEN
      CONTINUE;
    END IF;
    v_week_start := v_today - 7;
    v_week_end := v_today - 1;

    -- 주 1회 dedup (payload week_start). build 297: failed 는 이력으로 안 침 —
    -- 429 등으로 전멸한 주에 cron 다음 사이클이 재큐할 수 있게.
    IF EXISTS (
      SELECT 1 FROM public.push_send_log psl
       WHERE psl.user_id = v_row.user_id
         AND psl.category = 'weekly_recap'
         AND psl.payload ->> 'week_start' = v_week_start::text
         AND psl.status <> 'failed'
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(a.distance_km), 0), COUNT(*)
      INTO v_km, v_runs
      FROM public.activities a
     WHERE a.user_id = v_row.user_id
       AND a.activity_date BETWEEN v_week_start AND v_week_end
       AND COALESCE(a.activity_type, 'running') = 'running';

    IF v_runs = 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'weekly_recap',
       public.push_text(v_row.user_id, '📊 지난주 러닝 리포트', '📊 Your weekly running recap'),
       public.push_text(v_row.user_id,
         format('지난주 %skm · %s회 달렸어요 — 이번 주도 가볍게 시작!', round(v_km, 1), v_runs),
         format('You ran %s km across %s runs last week — start this week easy!', round(v_km, 1), v_runs)),
       jsonb_build_object('week_start', v_week_start::text,
                          'km', round(v_km, 1), 'runs', v_runs,
                          'deep_link', '/'),
       'pending',
       public.local_morning(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;
