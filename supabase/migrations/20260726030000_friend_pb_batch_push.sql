-- 친구 PB 푸시 묶음 발송 (2026-07-26 hans 승인).
--
-- 증상: 한 러닝에서 1km·3km·5km PB 를 동시에 깨면 친구에게 푸시가 거리별로 따로 날아감
--   (실측 7/23: 홍성조 PB 2건 → 수신자당 푸시 2발). 인박스 미러도 2행.
-- fix: 같은 (수신자, 러너, activity) 의 **pending** friend_pb 푸시가 있으면 INSERT 대신
--   그 행의 body 에 거리를 이어붙임 ("1km 6:05 · 3km 20:14 PB 달성").
--   payload.pb_list / pb_list_en 에 목록 누적 (첫 insert 부터 심어 merge 시 재구성 불요).
--   인박스 미러 (tg_push_log_to_inbox) 는 INSERT 에만 반응 → merge 시 preview 도 함께 UPDATE.
--   이미 발송된 (sent) 건은 merge 안 함 — 24h 같은-거리 dedupe 는 기존 그대로.

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
  v_pending RECORD;
  v_list TEXT;
  v_list_en TEXT;
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
    -- build 291 [P2]: friend_pb 도 사용자 push 설정 존중
    IF NOT public.should_send_push(v_friend.friend_id, 'friend_pb') THEN CONTINUE; END IF;
    -- 24h 같은-거리 dedupe (기존 유지)
    IF EXISTS (SELECT 1 FROM public.push_send_log WHERE user_id = v_friend.friend_id AND category = 'friend_pb'
      AND (payload->>'pb_user_id') = NEW.user_id::text AND (payload->>'distance_meters') = NEW.distance_meters::text
      AND created_at > NOW() - INTERVAL '24 hours') THEN CONTINUE; END IF;

    -- build 317: 같은 활동의 pending 푸시가 있으면 merge (한 발로 묶음)
    SELECT id, payload INTO v_pending FROM public.push_send_log
     WHERE user_id = v_friend.friend_id AND category = 'friend_pb' AND status = 'pending'
       AND (payload->>'pb_user_id') = NEW.user_id::text
       AND (payload->>'activity_id') = NEW.activity_id::text
     LIMIT 1;

    IF FOUND THEN
      v_list := COALESCE(v_pending.payload->>'pb_list', '') || ' · ' || v_dist_label || ' ' || v_time_label;
      v_list_en := COALESCE(v_pending.payload->>'pb_list_en', '') || ' · ' || v_dist_label_en || ' ' || v_time_label;
      v_list := ltrim(v_list, ' ·');
      v_list_en := ltrim(v_list_en, ' ·');
      UPDATE public.push_send_log SET
        body = public.push_text(v_friend.friend_id,
          v_safe_name || '님이 ' || v_list || ' PB 달성',
          v_safe_name || ' set new PBs — ' || v_list_en),
        payload = v_pending.payload
          || jsonb_build_object('pb_list', v_list, 'pb_list_en', v_list_en)
      WHERE id = v_pending.id;
      -- 인박스 미러 preview 도 동기화 (미러 트리거는 INSERT 에만 반응)
      UPDATE public.user_notifications SET
        preview = LEFT(public.push_text(v_friend.friend_id,
          v_safe_name || '님이 ' || v_list || ' PB 달성',
          v_safe_name || ' set new PBs — ' || v_list_en), 200)
      WHERE user_id = v_friend.friend_id AND kind = 'friend_pb'
        AND actor_id = NEW.user_id AND source_id = NEW.activity_id
        AND created_at > NOW() - INTERVAL '30 minutes';
      CONTINUE;
    END IF;

    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (v_friend.friend_id, 'friend_pb',
      public.push_text(v_friend.friend_id, '🎉 친구 PB 갱신!', '🎉 Your friend set a new PB!'),
      public.push_text(v_friend.friend_id,
        v_safe_name || '님이 ' || v_dist_label || ' ' || v_time_label || ' PB 달성',
        v_safe_name || ' set a ' || v_dist_label_en || ' PB — ' || v_time_label),
      jsonb_build_object('pb_user_id', NEW.user_id::text, 'distance_meters', NEW.distance_meters,
        'new_seconds', NEW.best_seconds, 'prev_seconds', v_prev_seconds, 'activity_id', NEW.activity_id,
        'pb_list', v_dist_label || ' ' || v_time_label,
        'pb_list_en', v_dist_label_en || ' ' || v_time_label,
        'deep_link', COALESCE('/activity?id=' || NEW.activity_id::text, '/social/user?id=' || NEW.user_id::text)),
      'pending');
  END LOOP;
  RETURN NEW;
END;
$function$;
