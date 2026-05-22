-- build 179: 출시 직전 security hardening
--
-- 1. gift_mileage 음수 amount 차단 (자금 인플레이션 fraud 방지)
--    기존 코드: mileage_balance >= p_amount 가 p_amount=-100 일 때 항상 true
--    → sender 잔액 +100, receiver +100, 무한 mileage 생성 가능했음.
-- 2. SECURITY DEFINER 함수들의 search_path 명시 (search_path hijacking 방어).

-- 1) gift_mileage — 음수/0 거부 + search_path
CREATE OR REPLACE FUNCTION public.gift_mileage(p_sender_id uuid, p_receiver_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender_balance INT;
  v_receiver_balance INT;
  v_send_tx_id UUID;
  v_sender_name TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '선물 금액은 1 이상이어야 합니다 (입력값: %)', p_amount;
  END IF;

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

-- 2) SECURITY DEFINER 함수들에 search_path 명시 (ALTER FUNCTION 으로 메타데이터만 변경)
ALTER FUNCTION public.award_mileage(uuid, text, jsonb) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.award_signup_bonus() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.award_friend_invite() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.award_activity_milestones() SET search_path TO 'public', 'pg_temp';
