-- build 299: 마일리지 리밸런스 (2026-07-11 사용자 결정)
--
-- ① 이달 목표 달성·페이스메이커 승리 500P → 100P (마일리지를 현금성 구매 수단으로 쓸
--    계획이라 대형 보상 축소).
-- ② 연속 보상을 주간 스트릭 기준으로 교체 — 기존 streak_7(70P)/streak_30(300P) 은
--    "매일 연속" 이라 주 2~4회 러너 (유저 전원) 에게 도달 불가 (역대 지급 0회).
--    → weekly_streak_3 (3주 연속, 70P) / weekly_streak_8 (8주 연속, 200P).
--    주간 달성 정의 = build 299 주간 스트릭과 동일 (월~일 KST, 러닝 일수 >= max(1, weekly_run_goal)).

-- ── ① 금액 조정 ──────────────────────────────────────────────
UPDATE public.mileage_reward_config SET amount = 100, updated_at = NOW()
 WHERE event_type IN ('monthly_goal_complete', 'monthly_rival_win');

-- ── ② 연속 보상 교체 ─────────────────────────────────────────
UPDATE public.mileage_reward_config SET is_active = false, updated_at = NOW()
 WHERE event_type IN ('streak_7', 'streak_30');

INSERT INTO public.mileage_reward_config (event_type, amount, description, is_active, recurrence, cooldown_days)
VALUES
  ('weekly_streak_3', 70, '3주 연속 주간 목표 달성', true, 'per_streak', 0),
  ('weekly_streak_8', 200, '8주 연속 주간 목표 달성', true, 'per_streak', 0)
ON CONFLICT (event_type) DO NOTHING;

-- ── 트리거: 일 스트릭 보상 → 주간 스트릭 보상 ─────────────────
CREATE OR REPLACE FUNCTION public.award_activity_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dist NUMERIC;
  v_weekly_streak INTEGER;
  v_streak_id TEXT;
  v_this_week DATE;
  v_monthly_total NUMERIC;
  v_goal NUMERIC;
  v_month_int INT;
  v_year_int INT;
  v_kst_date DATE;
  v_signup_date DATE;
BEGIN
  -- 가입일 검사 — 가입 전 활동은 어떤 보상도 안 함 (build 156)
  SELECT created_at::date INTO v_signup_date FROM public.profiles WHERE id = NEW.user_id;
  v_kst_date := (COALESCE(NEW.started_at, (NEW.activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE;
  IF v_signup_date IS NOT NULL AND v_kst_date < v_signup_date THEN
    RETURN NEW;
  END IF;

  -- 보상 로직 전체를 보호: 어떤 예외가 나도 NEW 는 정상 RETURN.
  BEGIN
    v_dist := NEW.distance_km;

    -- 거리 milestone (단발 보너스, 정책 그대로 유지)
    IF v_dist >= 5 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_5km', jsonb_build_object('activity_id', NEW.id));
    END IF;
    IF v_dist >= 10 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_10km', jsonb_build_object('activity_id', NEW.id));
    END IF;
    IF v_dist >= 21.0975 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_half', jsonb_build_object('activity_id', NEW.id));
    END IF;
    IF v_dist >= 42.195 THEN
      PERFORM public.award_mileage(NEW.user_id, 'first_marathon', jsonb_build_object('activity_id', NEW.id));
    END IF;

    -- 신규 (build 62): km 당 1마일 + 어제 달렸으면 ×2
    PERFORM public.award_distance_mileage(NEW.id);

    -- build 299: 주간 스트릭 보상 (기존 일 단위 streak_7/30 대체 — 유저 전원 주 2~4회
    -- 러너라 도달 불가였음). 이번 주 포함 연속 달성 주 수. 걷기 제외.
    v_this_week := date_trunc('week', v_kst_date)::date;
    WITH goal AS (
      SELECT GREATEST(1, COALESCE(weekly_run_goal, 1)) AS g
      FROM public.profiles WHERE id = NEW.user_id
    ),
    weeks AS (
      SELECT date_trunc('week', a.activity_date)::date AS wk,
             COUNT(DISTINCT a.activity_date) AS run_days
      FROM public.activities a
      WHERE a.user_id = NEW.user_id
        AND (a.activity_type IS NULL OR a.activity_type <> 'walking')
        AND a.activity_date <= v_kst_date
      GROUP BY 1
    ),
    achieved AS (
      SELECT w.wk, ROW_NUMBER() OVER (ORDER BY w.wk DESC) AS rn
      FROM weeks w, goal
      WHERE w.run_days >= goal.g AND w.wk <= v_this_week
    )
    SELECT COUNT(*) INTO v_weekly_streak
    FROM achieved
    WHERE wk = v_this_week - ((rn - 1) * 7)::int;  -- rn 은 bigint — 캐스팅 없으면 date-bigint 연산 에러

    IF COALESCE(v_weekly_streak, 0) >= 3 THEN
      v_streak_id := 'w3_' || (v_this_week - (v_weekly_streak - 1) * 7)::text;
      PERFORM public.award_mileage(NEW.user_id, 'weekly_streak_3',
        jsonb_build_object('streak_id', v_streak_id, 'weeks', v_weekly_streak));
    END IF;
    IF COALESCE(v_weekly_streak, 0) >= 8 THEN
      v_streak_id := 'w8_' || (v_this_week - (v_weekly_streak - 1) * 7)::text;
      PERFORM public.award_mileage(NEW.user_id, 'weekly_streak_8',
        jsonb_build_object('streak_id', v_streak_id, 'weeks', v_weekly_streak));
    END IF;

    -- 월 목표 달성
    v_year_int := EXTRACT(YEAR FROM v_kst_date)::INT;
    v_month_int := EXTRACT(MONTH FROM v_kst_date)::INT;
    SELECT goal_km INTO v_goal
      FROM public.monthly_goals
     WHERE user_id = NEW.user_id AND year = v_year_int AND month = v_month_int;
    IF v_goal IS NOT NULL AND v_goal > 0 THEN
      SELECT COALESCE(SUM(distance_km), 0) INTO v_monthly_total
        FROM public.activities
       WHERE user_id = NEW.user_id
         AND EXTRACT(YEAR FROM activity_date)::INT = v_year_int
         AND EXTRACT(MONTH FROM activity_date)::INT = v_month_int;
      IF v_monthly_total >= v_goal THEN
        PERFORM public.award_mileage(NEW.user_id, 'monthly_goal_complete', '{}'::jsonb);
      END IF;
    END IF;

    -- friend_invite_inviter 는 award_referral_inviter 트리거 (build 293) 담당.
  EXCEPTION WHEN OTHERS THEN
    -- 보상 실패해도 activity insert 자체는 통과.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

-- ── 승리 알림 문구: 하드코딩 +500P → 실지급액 ─────────────────
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

      INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
      VALUES (
        v_winner, 'cheer', NULL, v_loser,
        public.push_text(v_winner,
          '🏆 페이스메이커 승리!' || CASE WHEN v_win_awarded THEN ' +' || v_win_amount || 'P' ELSE '' END
            || ' · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km',
          '🏆 You outran your pacemaker!' || CASE WHEN v_win_awarded THEN ' +' || v_win_amount || 'P' ELSE '' END
            || ' · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km')
      );
      v_awarded := v_awarded + 1;
    END;
  END LOOP;

  RETURN v_awarded;
END;
$function$;
