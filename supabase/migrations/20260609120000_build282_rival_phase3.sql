-- build 282: 라이벌 Phase 3 — 실시간 활동 push + 월말 승자 마일리지.

-- ============================================================================
-- mileage event_type 추가: monthly_rival_win (500P)
-- ============================================================================
INSERT INTO mileage_reward_config (event_type, amount, description, is_active, recurrence)
VALUES ('monthly_rival_win', 500, '이달의 라이벌 승리', TRUE, 'monthly')
ON CONFLICT (event_type) DO UPDATE SET
  amount = 500,
  description = '이달의 라이벌 승리',
  is_active = TRUE;

-- ============================================================================
-- 트리거: activities INSERT → 매칭된 rival 에게 실시간 push
-- visibility='public' 만, 500m+ 만 (noisy 방지).
-- 같은 운동의 update 는 발사 안 함 (AFTER INSERT 만).
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

  -- 매칭된 rival 찾기
  SELECT opponent_id INTO v_rival_id FROM monthly_rivals
  WHERE user_id = NEW.user_id AND month = v_month
  LIMIT 1;
  IF v_rival_id IS NULL THEN RETURN NEW; END IF;

  -- rival 의 push_settings 체크
  IF NOT should_send_push(v_rival_id, 'social_rival') THEN RETURN NEW; END IF;

  -- actor 이름
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = NEW.user_id;
  IF v_actor_name IS NULL THEN v_actor_name := '라이벌'; END IF;

  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_rival_id,
    'social_rival',
    '⚔️ 라이벌이 뛰었어요',
    v_actor_name || '님이 ' || ROUND(NEW.distance_km::numeric, 1) || 'km 뛰었어요. 따라잡아볼까요?',
    jsonb_build_object('kind', 'rival_activity', 'rival_id', NEW.user_id, 'distance_km', NEW.distance_km),
    'pending'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activities_notify_rival ON activities;
CREATE TRIGGER activities_notify_rival
  AFTER INSERT ON activities
  FOR EACH ROW EXECUTE FUNCTION notify_rival_on_activity();

-- ============================================================================
-- RPC: finalize_monthly_rival_winner
-- 매월 말일 23:55 KST cron 호출. month 매칭 모두 순회.
-- 승자 (km 더 많은 쪽) +500P 마일리지 + user_notifications 'rival_won' 알림.
-- 동률 (km 차이 0.5km 미만) 은 양쪽 모두 안 줌.
-- 이미 처리한 month 는 mileage_transactions 의 metadata.month 로 중복 방지.
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
    -- 한 매칭당 한 번만 — A→B row 만 (A < B uuid 순)
    SELECT user_id, opponent_id FROM monthly_rivals
    WHERE month = v_month AND user_id < opponent_id
  LOOP
    SELECT COALESCE(SUM(distance_km), 0) INTO v_my_km FROM activities
      WHERE user_id = v_rec.user_id AND activity_date >= v_month_start AND activity_date < v_month_end;
    SELECT COALESCE(SUM(distance_km), 0) INTO v_rival_km FROM activities
      WHERE user_id = v_rec.opponent_id AND activity_date >= v_month_start AND activity_date < v_month_end;

    -- 동률 (0.5km 미만 차이) 은 skip
    IF ABS(v_my_km - v_rival_km) < 0.5 THEN CONTINUE; END IF;

    DECLARE
      v_winner uuid := CASE WHEN v_my_km > v_rival_km THEN v_rec.user_id ELSE v_rec.opponent_id END;
      v_loser uuid := CASE WHEN v_my_km > v_rival_km THEN v_rec.opponent_id ELSE v_rec.user_id END;
      v_winner_km numeric := GREATEST(v_my_km, v_rival_km);
      v_loser_km numeric := LEAST(v_my_km, v_rival_km);
    BEGIN
      -- 마일리지 award (recurrence='monthly' + metadata.month 로 중복 방지)
      PERFORM award_mileage(v_winner, 'monthly_rival_win', jsonb_build_object(
        'month', v_month, 'winner_km', v_winner_km, 'loser_km', v_loser_km
      ));

      -- 승자 알림 (user_notifications — push 자동 큐잉, build 266 트리거)
      INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
      VALUES (
        v_winner, 'cheer', NULL, v_loser,
        '🏆 ' || v_month || ' 라이벌 승리! +500P · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km'
      );
      v_awarded := v_awarded + 1;
    END;
  END LOOP;

  RETURN v_awarded;
END;
$$;

GRANT EXECUTE ON FUNCTION finalize_monthly_rival_winner(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION finalize_monthly_rival_winner(text) FROM PUBLIC, anon;
