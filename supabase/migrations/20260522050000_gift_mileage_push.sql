-- build 173.1 #4: 마일리지 선물 받은 사람에게 푸시 알림.
-- "OOO님이 NP 를 선물했어요" — gift_mileage RPC 안에서 push_send_log INSERT.
-- enqueue_friend_overtake_pushes 패턴 차용 (status='pending', 서버 cron 이 발송).

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

  -- build 173.1 #4: 푸시 큐잉. 발신자 자기 자신 선물은 push 안 함 (관리자 백필 등).
  IF p_sender_id <> p_receiver_id THEN
    SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = p_sender_id;
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      p_receiver_id,
      'mileage_gift',
      '🎁 마일리지 선물이 도착했어요',
      COALESCE(v_sender_name, '러너') || '님이 ' || p_amount::text || 'P 를 선물했어요',
      jsonb_build_object('sender_id', p_sender_id::text, 'amount', p_amount, 'tx_id', v_send_tx_id::text),
      'pending'
    );
  END IF;
END;
$function$;
