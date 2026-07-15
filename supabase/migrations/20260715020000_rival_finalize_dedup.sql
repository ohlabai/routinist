-- 2026-07-15: 페이스메이커 승리 알림 매일 중복 (48건) 근본 fix.
--
-- 사고 사슬:
--   ① award_mileage 의 recurrence='monthly' dedup 이 호출 시점의 현재 KST 월을 강제 사용 —
--      7/11 에 6월분 소급 정산 (finalize p_month='2026-06') 을 돌렸는데 지급 이력이
--      metadata.month='2026-07' 로 기록됨 (6월 kms 인데 7월 라벨).
--   ② rival-monthly-winner cron 의 self-heal 이 "지난달(2026-06) 지급 이력 0건" 으로 판단 →
--      매일 23:55 KST 재정산. 돈은 award_mileage dedup 이 막았지만 (awarded=false)
--   ③ finalize 의 승리 알림 INSERT 가 무조건 실행 → 매일 12명 × 중복 알림.
--   부작용: '2026-07' dedup 슬롯이 6월분에 소모돼 7/31 실제 7월 정산이 전원 지급 불발 예정이었음.
--
-- fix:
--   (A) award_mileage monthly: p_metadata 에 month 가 오면 그 달로 dedup (소급 정산 지원).
--       month 없는 기존 호출자는 현재 월 그대로 — 하위 호환.
--   (B) finalize: 알림도 v_win_awarded (첫 지급) 일 때만 INSERT — 재실행 멱등.
--   (데이터 수리는 마이그레이션 아닌 1회성 SQL 로 별도 실행: 6월분 재라벨 + 중복 알림 삭제)

-- (A) award_mileage — monthly 분기만 변경 (전체 재정의)
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
  VALUES (p_user_id, v_amount, v_new_balance, 'earn', v_config.description, p_event_type, p_metadata);

  RETURN QUERY SELECT true, v_amount, 'awarded';
END $function$;

-- (B) finalize — 알림을 첫 지급과 묶어 멱등화
CREATE OR REPLACE FUNCTION public.finalize_monthly_rival_winner(p_month text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month text;
  v_month_start date;
  v_month_end date;
  v_awarded integer := 0;
  v_rec record;
  v_my_km numeric;
  v_rival_km numeric;
BEGIN
  v_month := COALESCE(p_month, to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM'));
  v_month_start := (v_month || '-01')::date;
  v_month_end := (v_month_start + INTERVAL '1 month')::date;

  FOR v_rec IN
    SELECT user_id, opponent_id FROM monthly_rivals
    WHERE month = v_month AND user_id < opponent_id
  LOOP
    -- build 293: 표시(fetch_my_monthly_rival)와 동일하게 public 활동만 정산
    SELECT COALESCE(SUM(distance_km), 0) INTO v_my_km FROM activities
      WHERE user_id = v_rec.user_id AND activity_date >= v_month_start AND activity_date < v_month_end
        AND visibility = 'public';
    SELECT COALESCE(SUM(distance_km), 0) INTO v_rival_km FROM activities
      WHERE user_id = v_rec.opponent_id AND activity_date >= v_month_start AND activity_date < v_month_end
        AND visibility = 'public';

    IF ABS(v_my_km - v_rival_km) < 0.5 THEN CONTINUE; END IF;

    DECLARE
      v_winner uuid := CASE WHEN v_my_km > v_rival_km THEN v_rec.user_id ELSE v_rec.opponent_id END;
      v_loser uuid := CASE WHEN v_my_km > v_rival_km THEN v_rec.opponent_id ELSE v_rec.user_id END;
      v_winner_km numeric := GREATEST(v_my_km, v_rival_km);
      v_loser_km numeric := LEAST(v_my_km, v_rival_km);
      v_win_awarded boolean := false;
      v_win_amount int := 0;
    BEGIN
      SELECT t.awarded, t.amount INTO v_win_awarded, v_win_amount
        FROM award_mileage(v_winner, 'monthly_rival_win', jsonb_build_object(
          'month', v_month, 'winner_km', v_winner_km, 'loser_km', v_loser_km
        )) t;

      -- 2026-07-15: 알림은 첫 지급 (awarded=true) 일 때만 — 재실행 (self-heal 등) 멱등.
      -- 이전엔 무조건 INSERT 라 self-heal 이 돌 때마다 중복 알림 (하루 12건 × 4일 = 48건 사고).
      IF v_win_awarded THEN
        INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
        VALUES (
          v_winner, 'cheer', NULL, v_loser,
          public.push_text(v_winner,
            '🏆 페이스메이커 승리! +' || v_win_amount || 'P'
              || ' · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km',
            '🏆 You outran your pacemaker! +' || v_win_amount || 'P'
              || ' · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km')
        );
        v_awarded := v_awarded + 1;
      END IF;
    END;
  END LOOP;

  RETURN v_awarded;
END;
$function$;
