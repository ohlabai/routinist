-- build 299: 보호권 추가 구매 (2026-07-11 hans 결정 — "무료 1개 + 추가 구매 100P")
--
-- 기존: 월 1개 lazy 충전, 최대 2개 보유, 사용 무료 (유지).
-- 추가: 마일리지 100P 로 1개 구매. 보유 상한 2개 그대로 (사재기 방지).

CREATE OR REPLACE FUNCTION public.buy_streak_freeze()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_price CONSTANT integer := 100;
  v_count smallint;
  v_balance integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- 잔액·보유 수 잠금 조회 (동시 구매 race 차단)
  SELECT streak_freezes, COALESCE(mileage_balance, 0)
    INTO v_count, v_balance
    FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF v_count IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;
  IF v_count >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_held', 'count', v_count);
  END IF;
  IF v_balance < v_price THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'balance', v_balance, 'price', v_price);
  END IF;

  UPDATE public.profiles
     SET mileage_balance = v_balance - v_price,
         streak_freezes = v_count + 1
   WHERE id = v_user_id;

  INSERT INTO public.mileage_transactions
    (user_id, amount, balance_after, tx_type, event_type, description, metadata)
  VALUES
    (v_user_id, -v_price, v_balance - v_price, 'purchase_spend', 'streak_freeze_purchase',
     '연속 기록 보호권 구매', jsonb_build_object('price', v_price));

  RETURN jsonb_build_object('ok', true, 'count', v_count + 1, 'balance', v_balance - v_price);
END;
$function$;

REVOKE ALL ON FUNCTION public.buy_streak_freeze() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_streak_freeze() TO authenticated;
