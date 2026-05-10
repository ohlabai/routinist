-- 2026-05-09: 마일리지 정책 변경 — km 당 1마일 + 어제 달렸으면 ×2
-- 기존 milestone (first_5km/10km/half/marathon) + streak (7일/30일) 도 그대로 유지.
-- 이건 추가 보상 계층.
--
-- 정책:
--   * 활동 INSERT 시 distance_km 만큼 마일리지 적립 (1km = 1P)
--   * 어제도 달렸다면 ×2 (양일 모두 KST 기준 1회 이상 활동)
--   * 동일 활동 (activity_id) 에 대한 중복 지급 방지
--   * 일별/월별 상한 없음 (사용자 결정)
--
-- 회원가입 시점부터 시작 — 기존 마일리지 내역 reset (별도 운영자 SQL 로 처리, 이 마이그레이션엔 포함 안 함).

-- ============================================================================
-- 1. 보상 config 추가 — 'distance_km' event_type
-- ============================================================================
INSERT INTO public.mileage_reward_config (event_type, amount, description, recurrence, daily_cap)
VALUES ('distance_km', 1, '러닝 거리 1km 당 1마일', 'per_milestone', NULL)
ON CONFLICT (event_type) DO UPDATE
  SET amount = EXCLUDED.amount,
      description = EXCLUDED.description,
      recurrence = 'per_milestone';

-- ============================================================================
-- 2. award_distance_mileage RPC — km 보상 + streak 보너스
-- ============================================================================
CREATE OR REPLACE FUNCTION public.award_distance_mileage(p_activity_id UUID)
RETURNS TABLE (awarded BOOLEAN, amount INTEGER, multiplier INTEGER, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_activity public.activities%ROWTYPE;
  v_kst_date DATE;
  v_yesterday DATE;
  v_distance_km INTEGER;       -- 정수로 round (1.5km → 2P 가 아닌 1P. 보수적: floor)
  v_multiplier INTEGER := 1;
  v_total INTEGER;
  v_already_count INTEGER;
  v_milestone_id TEXT;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 1, 'activity not found';
    RETURN;
  END IF;

  -- KST 기준 활동 날짜 / 어제
  v_kst_date := (COALESCE(v_activity.started_at, (v_activity.activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE;
  v_yesterday := v_kst_date - 1;

  -- 거리: floor (1.5km → 1P 보상). 0km 이면 보상 없음.
  v_distance_km := FLOOR(v_activity.distance_km)::INTEGER;
  IF v_distance_km < 1 THEN
    RETURN QUERY SELECT false, 0, 1, 'distance < 1km';
    RETURN;
  END IF;

  -- 동일 activity 에 대해 이미 지급했는지 검사 (per_milestone, milestone_id = activity_id)
  v_milestone_id := 'distance_' || p_activity_id::text;
  SELECT COUNT(*) INTO v_already_count
    FROM public.mileage_transactions
   WHERE user_id = v_activity.user_id
     AND event_type = 'distance_km'
     AND (metadata->>'milestone_id') = v_milestone_id;
  IF v_already_count > 0 THEN
    RETURN QUERY SELECT false, 0, 1, 'already awarded for this activity';
    RETURN;
  END IF;

  -- 어제 활동 있으면 ×2
  SELECT COUNT(*) INTO v_already_count
    FROM public.activities
   WHERE user_id = v_activity.user_id
     AND id != p_activity_id  -- 본인 활동 제외
     AND ((COALESCE(started_at, (activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE = v_yesterday);
  IF v_already_count > 0 THEN
    v_multiplier := 2;
  END IF;

  v_total := v_distance_km * v_multiplier;

  -- 지급 — profiles.mileage_balance 업데이트 + transaction 기록
  UPDATE public.profiles
     SET mileage_balance = COALESCE(mileage_balance, 0) + v_total
   WHERE id = v_activity.user_id
   RETURNING mileage_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN QUERY SELECT false, 0, v_multiplier, 'profile not found';
    RETURN;
  END IF;

  INSERT INTO public.mileage_transactions
    (user_id, amount, balance_after, tx_type, event_type, description, metadata)
  VALUES
    (v_activity.user_id, v_total, v_new_balance, 'reward', 'distance_km',
     v_distance_km || 'km × ' || v_multiplier || ' 보상',
     jsonb_build_object('milestone_id', v_milestone_id, 'distance_km', v_distance_km, 'multiplier', v_multiplier, 'activity_id', p_activity_id));

  RETURN QUERY SELECT true, v_total, v_multiplier, 'awarded';
END $$;

REVOKE ALL ON FUNCTION public.award_distance_mileage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_distance_mileage(UUID) TO authenticated;

-- ============================================================================
-- 3. trigger 통합 — 기존 award_activity_milestones 의 EXCEPTION 블록 안에서 호출
-- ============================================================================
CREATE OR REPLACE FUNCTION public.award_activity_milestones()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_dist NUMERIC;
  v_streak INTEGER;
  v_streak_id TEXT;
  v_monthly_total NUMERIC;
  v_goal NUMERIC;
  v_month_int INT;
  v_year_int INT;
  v_kst_date DATE;
BEGIN
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

    -- streak (KST 기준 연속일) — 7일/30일 단발 보너스
    v_kst_date := (COALESCE(NEW.started_at, (NEW.activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE;

    WITH consecutive AS (
      SELECT activity_date,
             ROW_NUMBER() OVER (ORDER BY activity_date DESC) AS rn,
             activity_date - ((ROW_NUMBER() OVER (ORDER BY activity_date DESC) - 1)::INT) AS group_key
        FROM (SELECT DISTINCT activity_date FROM public.activities WHERE user_id = NEW.user_id) a
       WHERE activity_date <= v_kst_date
    )
    SELECT COUNT(*) INTO v_streak FROM consecutive WHERE group_key = v_kst_date;

    IF v_streak >= 7 THEN
      v_streak_id := 's7_' || (v_kst_date - 6)::text;
      PERFORM public.award_mileage(NEW.user_id, 'streak_7', jsonb_build_object('streak_id', v_streak_id, 'days', v_streak));
    END IF;
    IF v_streak >= 30 THEN
      v_streak_id := 's30_' || (v_kst_date - 29)::text;
      PERFORM public.award_mileage(NEW.user_id, 'streak_30', jsonb_build_object('streak_id', v_streak_id, 'days', v_streak));
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

    -- inviter 보상
    IF v_dist >= 5 THEN
      PERFORM public.award_mileage(
        f.follower_id,
        'friend_invite_inviter',
        jsonb_build_object('milestone_id', 'fi_' || f.follower_id::text || '_' || f.following_id::text, 'invitee_id', NEW.user_id)
      )
      FROM public.follows f
      WHERE f.following_id = NEW.user_id;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'award_activity_milestones failed for user_id=% activity_id=%: % (SQLSTATE %)',
      NEW.user_id, NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END $$;
