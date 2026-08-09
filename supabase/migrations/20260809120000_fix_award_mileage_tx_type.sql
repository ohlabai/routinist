-- 2026-08-09 긴급: 마일리지 적립이 2026-07-15 부터 전면 실패 중이던 것 복구.
--
-- 원인: award_mileage 가 tx_type='earn' 으로 INSERT 하는데 mileage_transactions_tx_type_check
-- 허용 목록에 'earn' 이 없다 (run_earn/purchase_spend/gift_send/gift_receive/admin_adjust/
-- refund/reward/reward_clawback). 7/15 리팩터에서 'reward' → 'earn' 으로 바뀐 뒤 되돌린 적 없음.
-- 호출 트리거 award_signup_bonus 가 EXCEPTION WHEN OTHERS → RAISE WARNING 으로 삼켜서
-- 에러가 어디에도 안 남았다 (조용한 실패).
--
-- 실측 피해 (프로덕션): 가입 보너스 마지막 지급 2026-07-15, 이후 가입 12명 전원 미지급.
-- 리퍼럴(친구초대) 7/6, 월간목표 7/1, 라이벌 1위 7/11 이후 전부 정지.
-- 거리·스트릭 적립은 별도 함수(award_distance_mileage 등)라 정상 동작 중이었음 — 그래서
-- 원장에 'reward' 행이 계속 쌓여 겉보기엔 멀쩡해 보였다.
--
-- 조치: tx_type 을 스키마가 허용하는 'reward' 로 환원 (기존 698행과 동일 값). 백필은 별도 실행.

CREATE OR REPLACE FUNCTION public.award_mileage(p_user_id uuid, p_event_type text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(awarded boolean, amount integer, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_config public.mileage_reward_config%ROWTYPE;
  v_amount INTEGER;
  v_already_count INTEGER;
  v_today_count INTEGER;
  v_milestone_id TEXT;
  v_month_key TEXT;
  v_streak_id TEXT;
  v_new_balance INTEGER;
BEGIN
  -- config 조회
  SELECT * INTO v_config FROM public.mileage_reward_config WHERE event_type = p_event_type;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 'event_type not configured';
    RETURN;
  END IF;

  IF NOT v_config.is_active THEN
    RETURN QUERY SELECT false, 0, 'event inactive';
    RETURN;
  END IF;

  -- amount 계산 (boost 반영)
  v_amount := v_config.amount;
  IF v_config.boost_until IS NOT NULL AND v_config.boost_until > NOW() AND v_config.boost_multiplier > 1 THEN
    v_amount := ROUND(v_amount * v_config.boost_multiplier)::INTEGER;
  END IF;

  -- recurrence 별 중복 검사
  IF v_config.recurrence = 'once' THEN
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id AND event_type = p_event_type;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'already awarded (once)';
      RETURN;
    END IF;

  ELSIF v_config.recurrence = 'monthly' THEN
    -- 2026-07-15: 호출자가 month 를 지정하면 그 달 기준 dedup (소급 정산).
    -- 미지정이면 기존처럼 현재 KST 월.
    v_month_key := COALESCE(NULLIF(p_metadata->>'month', ''), to_char(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM'));
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND (metadata->>'month') = v_month_key;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'already awarded this month';
      RETURN;
    END IF;
    p_metadata := jsonb_set(p_metadata, '{month}', to_jsonb(v_month_key));

  ELSIF v_config.recurrence = 'per_milestone' THEN
    v_milestone_id := COALESCE(p_metadata->>'milestone_id', '');
    IF v_milestone_id = '' THEN
      RETURN QUERY SELECT false, 0, 'milestone_id required';
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND (metadata->>'milestone_id') = v_milestone_id;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'milestone already awarded';
      RETURN;
    END IF;

  ELSIF v_config.recurrence = 'per_streak' THEN
    v_streak_id := COALESCE(p_metadata->>'streak_id', '');
    IF v_streak_id = '' THEN
      RETURN QUERY SELECT false, 0, 'streak_id required';
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND (metadata->>'streak_id') = v_streak_id;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'streak already awarded';
      RETURN;
    END IF;

  ELSIF v_config.recurrence = 'daily' THEN
    SELECT COUNT(*) INTO v_today_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND created_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul';
    IF v_today_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'already awarded today';
      RETURN;
    END IF;
  END IF;
  -- recurrence = 'unlimited' 는 중복 검사 없음

  -- 잔액 갱신 + 트랜잭션 기록
  UPDATE public.profiles
     SET mileage_balance = COALESCE(mileage_balance, 0) + v_amount
   WHERE id = p_user_id
   RETURNING mileage_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN QUERY SELECT false, 0, 'user not found';
    RETURN;
  END IF;

  INSERT INTO public.mileage_transactions (user_id, amount, balance_after, tx_type, description, event_type, metadata)
  VALUES (p_user_id, v_amount, v_new_balance, 'reward', v_config.description, p_event_type, p_metadata);

  RETURN QUERY SELECT true, v_amount, 'awarded';
END $function$;
