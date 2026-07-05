-- build 293: 습관 형성 팩 (주간 목표 · 스트릭 보호권 · 초보 배지 + 축하 버그 fix · 페이스메이커 visibility 통일)
--
-- 배경 (2026-07-07 prod 조회 기준):
--   · profiles 에 weekly/streak/freeze 관련 컬럼 없음 — 신규 추가.
--   · 스트릭 마일리지(streak_7/streak_30, recurrence='per_streak')는 activities INSERT 트리거
--     award_activity_milestones 가 서버에서 DISTINCT activity_date 로 계산 → freeze 와 이중지급
--     충돌 없음 (award_mileage 가 streak_id 로 dedup). 단, 마일리지 스트릭은 freeze 날을
--     달린 날로 세지 않음 — 의도된 분리 (freeze 는 "표시/배지 스트릭 유지" 장치).
--   · check_and_award_achievements: 배지 정의는 함수 내 하드코딩 (별도 카탈로그 테이블 없음,
--     클라 카탈로그는 src/lib/achievements-data.ts). 알려진 P1 버그 — 마지막 RETURN QUERY 가
--     보유 배지 전체를 newly_awarded=true 로 반환해 신규 획득 감지 불가. 본 마이그레이션에서
--     "이번 호출에서 실제 INSERT 된 것만 true" 로 fix (반환 shape (code, newly_awarded) 유지,
--     보유 전체를 반환하는 superset 동작도 유지 → 기존 클라 하위호환).
--   · fetch_my_monthly_rival 은 상대 km 만 visibility='public' 필터, 내 km / finalize 정산은
--     전체 합산 → 모순. 양쪽 모두 "양측 public 활동만" 으로 통일 (비공개 러닝 = 대결 비참여).
--
-- 구성:
--   1. 주간 빈도 목표 — profiles.weekly_run_goal (1~7, null=미설정)
--   2. 스트릭 보호권 — profiles.streak_freezes / freeze_refilled_month +
--      streak_freeze_uses 테이블 + use_streak_freeze(p_date) + get_my_streak_freezes()
--   3. 배지 — check_and_award_achievements fix + 초보 배지 5종
--      (first_week_3runs / first_5km / streak_3 / first_photo / first_cheer_sent)
--   4. 페이스메이커 visibility 통일 — fetch_my_monthly_rival / finalize_monthly_rival_winner
--   5. 권한 — 신규 RPC authenticated 전용 (reference_supabase_function_privilege 관례)
--
-- 클라이언트 계약:
--   · use_streak_freeze(p_date date) → jsonb
--       성공: {"ok": true, "remaining": n}
--       실패: {"ok": false, "error": "invalid_date" | "already_covered" | "no_freezes"}
--     p_date 는 클라이언트 로컬 날짜 (어제 또는 오늘). 서버는 KST 가 아닌 UTC 기준
--     ±허용 창(utc_today-2 ~ utc_today+1)으로만 검증 — 전 세계 타임존의 "어제/오늘" 을 커버.
--   · get_my_streak_freezes() → jsonb {"count": n, "uses": ["YYYY-MM-DD", ...]}  (최근 60일)
--     호출 시 이번 달(UTC 월) 미충전이면 +1 (최대 2) lazy 충전. VOLATILE — 조회여도 POST rpc.
--   · check_and_award_achievements() → TABLE(code text, newly_awarded boolean)
--     보유 배지 전체 반환, 이번 호출에서 새로 획득한 것만 newly_awarded=true.
--
-- ⚠️ 검토 포인트:
--   · 배지 first_5km 는 마일리지 event_type 'first_5km' (mileage_reward_config) 와 코드 문자열이
--     같지만 저장소가 달라 (user_achievements vs mileage_transactions) 충돌 없음.
--   · streak_3 / first_week_3runs 판정은 걷기(activity_type='walking') 제외. streak_3 는
--     freeze 사용일(used_on)도 달린 날로 인정 (제품 정의: "달린 것으로 간주할 날짜").
--   · 기존 배지 (first_run/runs_10/km_100 등) 판정 스코프는 무변경 (걷기 포함 그대로) —
--     회귀 방지를 위해 이번엔 건드리지 않음.
--   · 클라 카탈로그 src/lib/achievements-data.ts 에 신규 5종 항목 추가 필요 (별도 커밋).

-- ============================================================
-- 1. 주간 빈도 목표
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weekly_run_goal smallint;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_weekly_run_goal_check
    CHECK (weekly_run_goal IS NULL OR weekly_run_goal BETWEEN 1 AND 7);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.profiles.weekly_run_goal IS
  '주간 러닝 횟수 목표 (1~7). null = 미설정. build 293';

-- ============================================================
-- 2. 스트릭 보호권 (freeze)
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS streak_freezes smallint NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_streak_freezes_check
    CHECK (streak_freezes BETWEEN 0 AND 2);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- lazy 월 충전 기록. 볼러타일 DEFAULT → 기존 행은 마이그레이션 시점 월('2026-07')로 채워져
-- 이번 달엔 추가 충전 없음 (ADD COLUMN 의 DEFAULT 1 이 이번 달 지급분).
-- 신규 가입자도 가입 월이 기록돼 가입 즉시 +1 되는 일 없음.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS freeze_refilled_month text
    DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');

COMMENT ON COLUMN public.profiles.streak_freezes IS
  '스트릭 보호권 보유 개수 (0~2). 매월 1개 lazy 충전. build 293';

CREATE TABLE IF NOT EXISTS public.streak_freeze_uses (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  used_on    date NOT NULL,             -- "달린 것으로 간주할 날짜" (클라이언트 로컬 날짜)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, used_on)
);

COMMENT ON TABLE public.streak_freeze_uses IS
  '스트릭 보호권 사용 기록. used_on 은 달린 것으로 간주할 로컬 날짜. build 293';

ALTER TABLE public.streak_freeze_uses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY streak_freeze_uses_select_own ON public.streak_freeze_uses
    FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- INSERT/UPDATE/DELETE 정책 없음 — 쓰기는 use_streak_freeze() (SECURITY DEFINER) 전용.

-- ---------- use_streak_freeze(p_date) ----------
CREATE OR REPLACE FUNCTION public.use_streak_freeze(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_utc_today date := (now() AT TIME ZONE 'utc')::date;
  v_remaining smallint;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- 날짜 검증: 클라이언트가 자기 로컬 "어제/오늘" 을 보내는 계약 (KST 강제 아님).
  -- 로컬 오늘 ∈ [utc_today-1, utc_today+1], 로컬 어제 ∈ [utc_today-2, utc_today]
  -- → 합집합 [utc_today-2, utc_today+1] 만 허용. 그 밖(과거 backfill 등)은 거절.
  IF p_date < v_utc_today - 2 OR p_date > v_utc_today + 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_date');
  END IF;

  -- 이미 커버된 날짜: 그 날 러닝 활동이 있거나(걷기는 스트릭 미산입 → 커버로 안 침),
  -- 이미 freeze 를 쓴 날짜.
  IF EXISTS (
       SELECT 1 FROM public.activities
        WHERE user_id = v_user_id AND activity_date = p_date
          AND activity_type <> 'walking'
     )
     OR EXISTS (
       SELECT 1 FROM public.streak_freeze_uses
        WHERE user_id = v_user_id AND used_on = p_date
     )
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_covered');
  END IF;

  -- 원자적 차감 (보유 0 이면 매치 실패)
  UPDATE public.profiles
     SET streak_freezes = streak_freezes - 1
   WHERE id = v_user_id AND streak_freezes > 0
  RETURNING streak_freezes INTO v_remaining;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_freezes');
  END IF;

  INSERT INTO public.streak_freeze_uses (user_id, used_on)
  VALUES (v_user_id, p_date)
  ON CONFLICT (user_id, used_on) DO NOTHING;

  IF NOT FOUND THEN
    -- 동시 호출 레이스: 이미 삽입돼 있었음 → 차감 환불 후 already_covered.
    UPDATE public.profiles
       SET streak_freezes = LEAST(streak_freezes + 1, 2)
     WHERE id = v_user_id;
    RETURN jsonb_build_object('ok', false, 'error', 'already_covered');
  END IF;

  RETURN jsonb_build_object('ok', true, 'remaining', v_remaining);
END;
$function$;

-- ---------- get_my_streak_freezes() ----------
-- 이번 달(UTC 월, 사용자 위치 무관 단순화) 미충전이면 +1 (최대 2) lazy 충전 후 현황 반환.
CREATE OR REPLACE FUNCTION public.get_my_streak_freezes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_month text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
  v_count smallint;
  v_uses jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('count', 0, 'uses', '[]'::jsonb);
  END IF;

  -- lazy 월 충전 (충전됐든 안 됐든 최종 보유 수를 v_count 로)
  UPDATE public.profiles
     SET streak_freezes = CASE
           WHEN freeze_refilled_month IS DISTINCT FROM v_month
             THEN LEAST(streak_freezes + 1, 2)
           ELSE streak_freezes
         END,
         freeze_refilled_month = v_month
   WHERE id = v_user_id
  RETURNING streak_freezes INTO v_count;

  IF v_count IS NULL THEN v_count := 0; END IF;

  SELECT COALESCE(jsonb_agg(to_char(used_on, 'YYYY-MM-DD') ORDER BY used_on DESC), '[]'::jsonb)
    INTO v_uses
    FROM public.streak_freeze_uses
   WHERE user_id = v_user_id
     AND used_on >= (now() AT TIME ZONE 'utc')::date - 60;

  RETURN jsonb_build_object('count', v_count, 'uses', v_uses);
END;
$function$;

-- ============================================================
-- 3. 배지 — 축하 버그 fix + 초보 배지 5종
-- ============================================================
-- prod 원본(2026-07-07 조회)에서 변경점:
--   (a) 마지막 RETURN QUERY 가 전체를 newly_awarded=true 로 반환하던 버그 fix —
--       후보 코드를 배열로 모아 단일 INSERT ... ON CONFLICT DO NOTHING RETURNING 으로
--       "이번 호출에 실제 INSERT 된 코드" 만 v_new 에 수집, 그것만 true.
--   (b) 초보 배지 5종 판정 추가 (러닝만 — activity_type='walking' 제외):
--       first_week_3runs (한 주에 3일 러닝) / first_5km (단일 활동 5km+) /
--       streak_3 (3일 연속, freeze 사용일 포함) / first_photo / first_cheer_sent
--   (c) 기존 배지 조건·집계 스코프는 원본 그대로 유지.

CREATE OR REPLACE FUNCTION public.check_and_award_achievements()
RETURNS TABLE(code text, newly_awarded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_total_km NUMERIC;
  v_completed INTEGER;
  v_total_runs INTEGER;
  v_series_majors_done INTEGER;
  v_candidates TEXT[] := '{}';
  v_new TEXT[] := '{}';
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  -- 누적 km (원본 유지 — 스코프 무변경)
  SELECT COALESCE(SUM(distance_km), 0) INTO v_total_km
  FROM public.activities WHERE user_id = v_user_id;

  -- 누적 활동 수
  SELECT COUNT(*) INTO v_total_runs FROM public.activities WHERE user_id = v_user_id;

  -- 코스 완주 수
  SELECT COUNT(*) INTO v_completed
  FROM public.user_course_progress WHERE user_id = v_user_id AND completed_at IS NOT NULL;

  -- World Marathon Majors 완주
  SELECT COUNT(*) INTO v_series_majors_done
  FROM public.user_course_progress ucp
  JOIN public.virtual_courses vc ON vc.id = ucp.course_id
  JOIN public.course_series cs ON cs.id = vc.series_id
  WHERE ucp.user_id = v_user_id AND ucp.completed_at IS NOT NULL AND cs.slug = 'world_majors';

  -- ---------- 기존 배지 (조건 원본 그대로) ----------
  IF v_total_runs >= 1   THEN v_candidates := array_append(v_candidates, 'first_run'); END IF;
  IF v_total_runs >= 10  THEN v_candidates := array_append(v_candidates, 'runs_10'); END IF;
  IF v_total_runs >= 100 THEN v_candidates := array_append(v_candidates, 'runs_100'); END IF;
  IF v_total_runs >= 500 THEN v_candidates := array_append(v_candidates, 'runs_500'); END IF;

  IF v_total_km >= 100  THEN v_candidates := array_append(v_candidates, 'km_100'); END IF;
  IF v_total_km >= 500  THEN v_candidates := array_append(v_candidates, 'km_500'); END IF;
  IF v_total_km >= 1000 THEN v_candidates := array_append(v_candidates, 'km_1000'); END IF;
  IF v_total_km >= 5000 THEN v_candidates := array_append(v_candidates, 'km_5000'); END IF;

  IF v_completed >= 1  THEN v_candidates := array_append(v_candidates, 'first_course'); END IF;
  IF v_completed >= 3  THEN v_candidates := array_append(v_candidates, 'courses_3'); END IF;
  IF v_completed >= 10 THEN v_candidates := array_append(v_candidates, 'courses_10'); END IF;

  IF v_series_majors_done >= 6 THEN v_candidates := array_append(v_candidates, 'six_stars'); END IF;

  -- ---------- 초보 배지 (build 293, 러닝만) ----------
  -- first_week_3runs: 아무 주(월요일 시작)에나 러닝한 날이 3일 이상
  IF EXISTS (
    SELECT 1
      FROM (SELECT DISTINCT activity_date FROM public.activities
             WHERE user_id = v_user_id AND activity_type <> 'walking') d
     GROUP BY date_trunc('week', d.activity_date)
    HAVING COUNT(*) >= 3
  ) THEN v_candidates := array_append(v_candidates, 'first_week_3runs'); END IF;

  -- first_5km: 단일 러닝 5km 이상
  IF EXISTS (
    SELECT 1 FROM public.activities
     WHERE user_id = v_user_id AND activity_type <> 'walking' AND distance_km >= 5
  ) THEN v_candidates := array_append(v_candidates, 'first_5km'); END IF;

  -- streak_3: 3일 연속 (러닝일 ∪ freeze 사용일)
  IF EXISTS (
    SELECT 1
      FROM (
        SELECT dd.d, dd.d - (ROW_NUMBER() OVER (ORDER BY dd.d))::int AS grp
          FROM (
            SELECT DISTINCT activity_date AS d FROM public.activities
             WHERE user_id = v_user_id AND activity_type <> 'walking'
            UNION
            SELECT used_on FROM public.streak_freeze_uses WHERE user_id = v_user_id
          ) dd
      ) g
     GROUP BY g.grp
    HAVING COUNT(*) >= 3
  ) THEN v_candidates := array_append(v_candidates, 'streak_3'); END IF;

  -- first_photo: 러닝 사진 첫 업로드
  IF EXISTS (
    SELECT 1 FROM public.activity_photos WHERE user_id = v_user_id
  ) THEN v_candidates := array_append(v_candidates, 'first_photo'); END IF;

  -- first_cheer_sent: 응원 첫 발신
  IF EXISTS (
    SELECT 1 FROM public.user_cheers WHERE from_user = v_user_id
  ) THEN v_candidates := array_append(v_candidates, 'first_cheer_sent'); END IF;

  -- ---------- 일괄 INSERT + 실제 신규만 수집 ----------
  WITH ins AS (
    INSERT INTO public.user_achievements (user_id, code, metadata)
    SELECT v_user_id, c.c,
           CASE WHEN c.c = 'six_stars'
                THEN jsonb_build_object('done', v_series_majors_done)
                ELSE NULL END
      FROM unnest(v_candidates) AS c(c)
    ON CONFLICT DO NOTHING
    RETURNING user_achievements.code
  )
  SELECT COALESCE(array_agg(ins.code), '{}') INTO v_new FROM ins;

  -- 보유 전체 반환(기존 superset 동작 유지) + 이번 호출 신규만 true
  RETURN QUERY
  SELECT ua.code, (ua.code = ANY(v_new)) AS newly_awarded
  FROM public.user_achievements ua
  WHERE ua.user_id = v_user_id;
END;
$function$;

-- ============================================================
-- 4. 페이스메이커 visibility 통일 — 양측 public 활동만
-- ============================================================
-- 원본과의 차이: my_km / 정산 양쪽 합산에 visibility='public' 추가. 그 외 무변경.
-- (notify_rival_on_activity 는 원래 public 활동만 push — 이미 일관, 무변경.)

CREATE OR REPLACE FUNCTION public.fetch_my_monthly_rival()
RETURNS TABLE(rival_user_id uuid, rival_display_name text, rival_avatar_url text, my_km numeric, rival_km numeric, month text, days_left integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month text := to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM');
  v_month_start date := (v_month || '-01')::date;
  v_month_end date := (v_month_start + INTERVAL '1 month')::date;
BEGIN
  RETURN QUERY
  SELECT
    mr.opponent_id AS rival_user_id,
    p.display_name AS rival_display_name,
    p.avatar_url AS rival_avatar_url,
    COALESCE((
      SELECT SUM(distance_km) FROM activities
      WHERE user_id = auth.uid()
        AND activity_date >= v_month_start
        AND activity_date < v_month_end
        AND visibility = 'public'   -- build 293: 내 km 도 public 만 (정산과 동일 기준)
    ), 0) AS my_km,
    COALESCE((
      SELECT SUM(distance_km) FROM activities
      WHERE user_id = mr.opponent_id
        AND activity_date >= v_month_start
        AND activity_date < v_month_end
        AND visibility = 'public'
    ), 0) AS rival_km,
    v_month AS month,
    GREATEST(0, (v_month_end - (NOW() AT TIME ZONE 'Asia/Seoul')::date))::integer AS days_left
  FROM monthly_rivals mr
  LEFT JOIN profiles p ON p.id = mr.opponent_id
  WHERE mr.user_id = auth.uid()
    AND mr.month = v_month
  LIMIT 1;
END;
$function$;

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
    BEGIN
      PERFORM award_mileage(v_winner, 'monthly_rival_win', jsonb_build_object(
        'month', v_month, 'winner_km', v_winner_km, 'loser_km', v_loser_km
      ));

      INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
      VALUES (
        v_winner, 'cheer', NULL, v_loser,
        public.push_text(v_winner,
          '🏆 페이스메이커 승리! +500P · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km',
          '🏆 You outran your pacemaker! +500P · ' || ROUND(v_winner_km, 1) || 'km vs ' || ROUND(v_loser_km, 1) || 'km')
      );
      v_awarded := v_awarded + 1;
    END;
  END LOOP;

  RETURN v_awarded;
END;
$function$;

-- ============================================================
-- 5. 권한 (신규 객체만 — CREATE OR REPLACE 된 기존 함수는 ACL 유지됨)
-- ============================================================

REVOKE ALL ON TABLE public.streak_freeze_uses FROM PUBLIC;
REVOKE ALL ON TABLE public.streak_freeze_uses FROM anon;
GRANT SELECT ON TABLE public.streak_freeze_uses TO authenticated;

REVOKE ALL ON FUNCTION public.use_streak_freeze(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.use_streak_freeze(date) FROM anon;
REVOKE ALL ON FUNCTION public.use_streak_freeze(date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.use_streak_freeze(date) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_streak_freezes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_streak_freezes() FROM anon;
REVOKE ALL ON FUNCTION public.get_my_streak_freezes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_streak_freezes() TO authenticated;
