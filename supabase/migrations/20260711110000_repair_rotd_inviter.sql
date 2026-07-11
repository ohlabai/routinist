-- build 298: 2026-07-11 전체 리뷰 A-수리 (DB 고장 2건)
--
-- ① pick_run_of_the_day — 존재하지 않는 profiles.region_display/region_district 컬럼을
--    SELECT 해 매일 예외로 죽었음 (run_of_the_day 영구 0행 = 홈 카드가 출시 이래 미표시).
--    실제 컬럼은 region_si/gu/dong.
-- ② award_activity_milestones — friend_invite_inviter 보상이 존재하지 않는 friend_links
--    테이블을 조회해 영구 불발. build 293 의 award_referral_inviter 트리거 (invited_by 기반,
--    5km 마일스톤) 가 올바른 구현이므로 이 레거시 분기는 제거.
--    (follows 100P 오지급 트리거는 build 293 에서 이미 제거됨 — 42건은 이전 이력.)

CREATE OR REPLACE FUNCTION public.pick_run_of_the_day()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_date DATE;
  v_inserted INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  -- 어제 KST.
  v_target_date := ((NOW() AT TIME ZONE 'Asia/Seoul')::DATE - 1);

  -- 이미 선정됐으면 skip
  IF EXISTS (SELECT 1 FROM public.run_of_the_day WHERE pick_date = v_target_date) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.run_of_the_day
    (pick_date, activity_id, user_id, display_name, avatar_url, distance_km, pace_avg_sec_per_km, region_label, score)
  SELECT v_target_date,
         a.id,
         a.user_id,
         p.display_name,
         p.avatar_url,
         a.distance_km,
         a.pace_avg_sec_per_km,
         -- build 298: region_display/region_district 는 존재하지 않는 컬럼이었음 (매일 예외)
         COALESCE(NULLIF(TRIM(COALESCE(p.region_si, '') || ' ' || COALESCE(p.region_gu, '')), ''), ''),
         (a.distance_km * 0.5 + (1000.0 / NULLIF(a.pace_avg_sec_per_km, 0)) * 0.5) AS score
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
   WHERE a.activity_date = v_target_date
     AND a.distance_km >= 3.0
     AND a.pace_avg_sec_per_km IS NOT NULL
     AND a.pace_avg_sec_per_km > 0
     AND COALESCE(a.visibility, 'public') IN ('public', 'club')
     AND COALESCE(p.is_public, true) = true
   ORDER BY score DESC NULLS LAST, a.distance_km DESC
   LIMIT 1;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END $function$;

CREATE OR REPLACE FUNCTION public.award_activity_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dist NUMERIC;
  v_streak INTEGER;
  v_streak_id TEXT;
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

    -- streak (KST 기준 연속일) — 7일/30일 단발 보너스
    WITH consecutive AS (
      SELECT activity_date,
             ROW_NUMBER() OVER (ORDER BY activity_date DESC) AS rn,
             activity_date + ((ROW_NUMBER() OVER (ORDER BY activity_date DESC) - 1)::INT) AS group_key
        FROM (SELECT DISTINCT activity_date FROM public.activities WHERE user_id = NEW.user_id) a
       WHERE activity_date <= v_kst_date
    )
    SELECT COUNT(*) INTO v_streak FROM consecutive WHERE group_key = v_kst_date;

    IF v_streak >= 7 THEN
      v_streak_id := 's7_' || (v_kst_date - v_streak + 1)::text;
      PERFORM public.award_mileage(NEW.user_id, 'streak_7', jsonb_build_object('streak_id', v_streak_id, 'days', v_streak));
    END IF;
    IF v_streak >= 30 THEN
      v_streak_id := 's30_' || (v_kst_date - v_streak + 1)::text;
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

    -- build 298: friend_invite_inviter 레거시 분기 제거 — 존재하지 않는 friend_links 조회로
    -- 영구 불발이었음. 올바른 지급은 award_referral_inviter 트리거 (build 293, invited_by 기반).
  EXCEPTION WHEN OTHERS THEN
    -- 보상 실패해도 activity insert 자체는 통과.
    NULL;
  END;
  RETURN NEW;
END;
$function$;
