-- build 174.1: 핵심 알림 4종 활성화
--   - chat_message: 메시지 수신
--   - likes: 사진/한 줄/응원 좋아요 (통합 카테고리)
--   - feedback_reply: 운영자 답글 (UI 토글 이미 있음, 트리거 신설)
--   - mileage_gift: 선물 받음 (build 174 RPC 에 push 있음, 설정 체크만 추가)
--
-- profiles.push_settings jsonb 기준으로 각 카테고리 toggle. 기본값: 채팅/선물/답글/좋아요 ON.
-- should_send_push(user_id, category) 헬퍼 함수로 깔끔하게 분기.

-- 1. 헬퍼 함수
CREATE OR REPLACE FUNCTION public.should_send_push(p_user_id uuid, p_category text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE((push_settings ->> p_category)::boolean, TRUE)
  FROM public.profiles WHERE id = p_user_id;
$$;

-- 2. gift_mileage 에 should_send_push 체크 추가 (build 174 의 push 큐잉에 가드)
CREATE OR REPLACE FUNCTION public.gift_mileage(p_sender_id uuid, p_receiver_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sender_balance INT;
  v_receiver_balance INT;
  v_send_tx_id UUID;
  v_sender_name TEXT;
BEGIN
  UPDATE profiles SET mileage_balance = mileage_balance - p_amount
  WHERE id = p_sender_id AND mileage_balance >= p_amount
  RETURNING mileage_balance INTO v_sender_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient mileage balance'; END IF;
  v_send_tx_id := gen_random_uuid();
  INSERT INTO mileage_transactions (id, user_id, amount, balance_after, tx_type, reference_id)
  VALUES (v_send_tx_id, p_sender_id, -p_amount, v_sender_balance, 'gift_send', p_receiver_id);
  UPDATE profiles SET mileage_balance = mileage_balance + p_amount WHERE id = p_receiver_id
    RETURNING mileage_balance INTO v_receiver_balance;
  INSERT INTO mileage_transactions (user_id, amount, balance_after, tx_type, reference_id)
  VALUES (p_receiver_id, p_amount, v_receiver_balance, 'gift_receive', v_send_tx_id);

  IF p_sender_id <> p_receiver_id AND public.should_send_push(p_receiver_id, 'mileage_gift') THEN
    SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = p_sender_id;
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      p_receiver_id, 'mileage_gift',
      '🎁 마일리지 선물이 도착했어요',
      COALESCE(v_sender_name, '러너') || '님이 ' || p_amount::text || 'P 를 선물했어요',
      jsonb_build_object('sender_id', p_sender_id::text, 'amount', p_amount, 'tx_id', v_send_tx_id::text),
      'pending'
    );
  END IF;
END;
$function$;

-- 3. 메시지 INSERT 트리거 — 채팅 알림
-- conversations.user_a/user_b 중 sender 가 아닌 쪽이 수신자.
CREATE OR REPLACE FUNCTION public.tg_message_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
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
    jsonb_build_object('message_id', NEW.id::text, 'sender_id', NEW.sender_id::text, 'conversation_id', NEW.conversation_id::text),
    'pending'
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS message_push_trigger ON public.messages;
CREATE TRIGGER message_push_trigger AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.tg_message_push();

-- 4. 사진 좋아요 트리거 (likes 카테고리)
CREATE OR REPLACE FUNCTION public.tg_photo_like_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
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
    jsonb_build_object('photo_id', NEW.photo_id::text, 'liker_id', NEW.user_id::text),
    'pending'
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS photo_like_push_trigger ON public.photo_likes;
CREATE TRIGGER photo_like_push_trigger AFTER INSERT ON public.photo_likes
FOR EACH ROW EXECUTE FUNCTION public.tg_photo_like_push();

-- 5. 한 줄(quote) 좋아요 트리거
CREATE OR REPLACE FUNCTION public.tg_quote_like_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
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
    jsonb_build_object('quote_id', NEW.quote_id::text, 'liker_id', NEW.user_id::text),
    'pending'
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS quote_like_push_trigger ON public.quote_likes;
CREATE TRIGGER quote_like_push_trigger AFTER INSERT ON public.quote_likes
FOR EACH ROW EXECUTE FUNCTION public.tg_quote_like_push();

-- 6. 응원(cheer) 트리거
CREATE OR REPLACE FUNCTION public.tg_activity_cheer_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
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
    jsonb_build_object('activity_id', NEW.activity_id::text, 'cheerer_id', NEW.user_id::text),
    'pending'
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS activity_cheer_push_trigger ON public.activity_cheers;
CREATE TRIGGER activity_cheer_push_trigger AFTER INSERT ON public.activity_cheers
FOR EACH ROW EXECUTE FUNCTION public.tg_activity_cheer_push();

-- 7. 운영자 답글 트리거 (feedback_posts.admin_reply 신설/변경 시)
CREATE OR REPLACE FUNCTION public.tg_feedback_reply_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  -- admin_reply 가 NULL → NOT NULL 로 바뀐 경우만 (새 답글). 수정 시 재발송 안 함.
  IF OLD.admin_reply IS NOT NULL OR NEW.admin_reply IS NULL THEN RETURN NEW; END IF;
  IF NOT public.should_send_push(NEW.user_id, 'feedback_reply') THEN RETURN NEW; END IF;
  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    NEW.user_id, 'feedback_reply',
    '📣 제안에 답글이 달렸어요',
    '"' || LEFT(NEW.title, 30) || (CASE WHEN length(NEW.title) > 30 THEN '…' ELSE '' END) || '" 에 운영자가 답했어요',
    jsonb_build_object('feedback_id', NEW.id::text),
    'pending'
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS feedback_reply_push_trigger ON public.feedback_posts;
CREATE TRIGGER feedback_reply_push_trigger AFTER UPDATE OF admin_reply ON public.feedback_posts
FOR EACH ROW EXECUTE FUNCTION public.tg_feedback_reply_push();
