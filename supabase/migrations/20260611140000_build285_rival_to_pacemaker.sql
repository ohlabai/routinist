-- build 285: '라이벌' → '페이스메이커' 어감 부드럽게 — 사용자 노출 문자열 일괄 교체.
-- 기능 동일, naming 만 변경. DB 컬럼·테이블·함수명 (monthly_rivals 등) 은 그대로 둔다 (코드 호환).

-- ============================================================================
-- mileage_reward_config description 업데이트
-- ============================================================================
UPDATE mileage_reward_config
SET description = '이달의 페이스메이커 승리'
WHERE event_type = 'monthly_rival_win';

-- ============================================================================
-- notify_rival_on_activity — 알림 title + fallback name 페이스메이커로
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_rival_on_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF v_actor_name IS NULL THEN v_actor_name := '페이스메이커'; END IF;

  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_rival_id,
    'social_rival',
    '⚔️ 페이스메이커가 뛰었어요',
    v_actor_name || '님이 ' || ROUND(NEW.distance_km::numeric, 1) || 'km 뛰었어요. 따라잡아볼까요?',
    jsonb_build_object('kind', 'rival_activity', 'rival_id', NEW.user_id, 'distance_km', NEW.distance_km),
    'pending'
  );
  RETURN NEW;
END;
$$;

-- ============================================================================
-- finalize_monthly_rival_winner — 승자 알림 preview 페이스메이커로
-- ============================================================================
CREATE OR REPLACE FUNCTION finalize_monthly_rival_winner(p_month text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT COALESCE(SUM(distance_km), 0) INTO v_my_km FROM activities
      WHERE user_id = v_rec.user_id AND activity_date >= v_month_start AND activity_date < v_month_end;
    SELECT COALESCE(SUM(distance_km), 0) INTO v_rival_km FROM activities
      WHERE user_id = v_rec.opponent_id AND activity_date >= v_month_start AND activity_date < v_month_end;

    IF ABS(v_my_km - v_rival_km) < 0.5 THEN CONTINUE; END IF;

    DECLARE
      v_winner uuid := CASE WHEN v_my_km > v_rival_km THEN v_rec.user_id ELSE v_rec.opponent_id END;
      v_loser uuid := CASE WHEN v_my_km > v_rival_km THEN v_rec.opponent_id ELSE v_rec.user_id END;
      v_winner_km numeric := GREATEST(v_my_km, v_rival_km);
      v_loser_km numeric := LEAST(v_my_km, v_rival_km);
    BEGIN
      PERFORM award_mileage(v_winner, 'monthly_rival_win', jsonb_build_object(
        'month', v_month, 'winner_km', v_winner_km, 'loser_km', v_loser_km
      ));

      INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
      VALUES (
        v_winner, 'cheer', NULL, v_loser,
        '🏆 페이스메이커 승리! +500P · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km'
      );
      v_awarded := v_awarded + 1;
    END;
  END LOOP;

  RETURN v_awarded;
END;
$$;

GRANT EXECUTE ON FUNCTION finalize_monthly_rival_winner(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION finalize_monthly_rival_winner(text) FROM PUBLIC, anon;
