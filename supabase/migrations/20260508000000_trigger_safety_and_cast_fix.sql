-- 2026-05-08: award_activity_milestones trigger 안전화 + SQL 버그 fix
--
-- 배경:
-- build 53 에 도입된 mileage_reward_system trigger 가 새 활동 INSERT 를 모두 차단함.
-- 증상: client_error_logs 에 "operator does not exist: date - bigint" 36건 발생.
-- 영향: hans@openhan.kr (개발자) 의 5/6~5/8 새 활동 0건 INSERT. 다른 사용자는 build 53 미배포라 영향 없음.
--
-- 두 가지 수정:
-- (1) ROW_NUMBER() 결과는 bigint. PostgreSQL 은 date - bigint 직접 미지원 → ::INT cast 추가.
-- (2) 더 근본적: 보상 로직 (streak/milestone/monthly_goal) 이 어떤 이유로든 실패하면
--     활동 INSERT 자체를 막는 건 잘못된 결합. 보상은 부수효과여야 함.
--     → 전체 본문을 BEGIN/EXCEPTION 으로 감싸 어떤 예외가 나도 NEW 를 정상 RETURN.
--     실패는 RAISE WARNING 으로 로그 남겨 supabase logs 에서 추적 가능.

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
  -- 보상 로직 전체를 보호: 어떤 예외가 나도 NEW 는 정상 RETURN 해서 활동 INSERT 는 통과.
  BEGIN
    v_dist := NEW.distance_km;

    -- 거리 milestone
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

    -- streak (KST 기준 연속일)
    v_kst_date := (COALESCE(NEW.started_at, (NEW.activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE;

    -- ::INT cast 가 핵심 fix. ROW_NUMBER() 는 bigint 라 date - bigint 가 PostgreSQL 에서 안 됨.
    WITH consecutive AS (
      SELECT activity_date,
             ROW_NUMBER() OVER (ORDER BY activity_date DESC) AS rn,
             activity_date - ((ROW_NUMBER() OVER (ORDER BY activity_date DESC) - 1)::INT) AS group_key
        FROM (SELECT DISTINCT activity_date FROM public.activities WHERE user_id = NEW.user_id) a
       WHERE activity_date <= v_kst_date
    )
    SELECT COUNT(*) INTO v_streak
      FROM consecutive
     WHERE group_key = v_kst_date;

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
    -- 보상 로직 실패는 활동 INSERT 를 막지 않음. supabase logs 에서 SQLERRM 으로 추적.
    RAISE WARNING 'award_activity_milestones failed for user_id=% activity_id=%: % (SQLSTATE %)',
      NEW.user_id, NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END $$;

-- 같은 보호를 award_signup_bonus 에도 적용 — 가입 트리거가 죽으면 회원가입 자체가 막힘.
CREATE OR REPLACE FUNCTION public.award_signup_bonus()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM public.award_mileage(NEW.id, 'signup', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'award_signup_bonus failed for user_id=%: % (SQLSTATE %)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END $$;

-- award_friend_invite 도 동일
CREATE OR REPLACE FUNCTION public.award_friend_invite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM public.award_mileage(
      NEW.following_id,
      'friend_invite_invitee',
      jsonb_build_object('milestone_id', 'fi_' || NEW.follower_id::text || '_' || NEW.following_id::text, 'inviter_id', NEW.follower_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'award_friend_invite failed for follower=% following=%: % (SQLSTATE %)',
      NEW.follower_id, NEW.following_id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END $$;
