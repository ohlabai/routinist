-- ============================================================
-- 습관 코어 C1 (2026-07-11) — enqueue_streak_risk_pushes() 주간 버전 재작성
--
-- 배경: 유저 전원이 주 2~4회 러너 — 일 단위 스트릭 보유자 62명 중 2명뿐이라
-- 기존 "연속 3일+ 오늘 미달림" push 는 사실상 발사 0. 주 단위 스트릭으로 전환.
--
-- 주간 스트릭 정의 (클라이언트 src/lib/routinist-data.ts getWeeklyStreak 과 반드시 동일):
--   * 주 = 유저 로컬 (KST 기본) 월요일~일요일. 주 키 = 그 주 월요일.
--   * 달성 주 = 그 주의 러닝 일수 (DISTINCT activity_date, 걷기 제외,
--     COALESCE(activity_type,'running') <> 'walking') ≥ GREATEST(1, COALESCE(weekly_run_goal, 1)).
--   * 보호권 사용일 (streak_freeze_uses.used_on) 이 포함된 주는 목표 무관 달성 취급.
--   * 스트릭 = 이번 주 또는 지난주에 끝나는 연속 달성 주 수 —
--     이번 주 미달성이어도 지난주까지 이어져 있으면 유지 (주가 끝나기 전엔 안 끊김).
--
-- 발사 조건:
--   * 오늘이 유저 로컬 토/일 (ISODOW 6·7) — 남은 날 ≤ 2일 (클라 경고 카드와 동일 게이트)
--   * 이번 주 미달성 (러닝 일수 < goal, 이번 주 보호권 사용도 없음)
--   * 지난주 앵커 주간 스트릭 ≥ 1 (끊길 게 있어야 위협)
--   * should_send_push(uid, 'streak_risk') 존중 (기존 카테고리·토글 호환)
--   * 주 1회 dedup — payload.week_start, status <> 'failed' (실패 건은 재시도 허용)
--
-- 공통 관례 (build 291 인프라): push_text ko/en · local_evening 예약 · service_role 전용.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enqueue_streak_risk_pushes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_today DATE;          -- 유저 로컬 오늘
  v_week_start DATE;     -- 이번 주 월요일 (유저 로컬)
  v_goal INTEGER;
  v_this_week_days INTEGER;
  v_streak INTEGER;
  v_runs_left INTEGER;
  v_title TEXT;
  v_body TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT pd.user_id,
           GREATEST(1, COALESCE(MAX(p.weekly_run_goal), 1)) AS goal
      FROM public.push_device_tokens pd
      JOIN public.profiles p ON p.id = pd.user_id
     WHERE pd.enabled = true
       AND public.should_send_push(pd.user_id, 'streak_risk')
       -- 성능 필터: 스트릭 ≥1 이려면 지난주가 달성이어야 함 → 최근 15일 내
       -- 활동 또는 보호권 사용이 있는 유저만 후보 (timezone 여유 ±1일 포함)
       AND EXISTS (
         SELECT 1 FROM public.activities a
          WHERE a.user_id = pd.user_id
            AND a.activity_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 15
         UNION ALL
         SELECT 1 FROM public.streak_freeze_uses sf
          WHERE sf.user_id = pd.user_id
            AND sf.used_on >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 15
       )
     GROUP BY pd.user_id
     LIMIT 500
  LOOP
    v_today := public.local_today(v_row.user_id);

    -- 주말 게이트: 유저 로컬 토(6)/일(7) 에만 — 남은 날 ≤ 2일
    IF EXTRACT(ISODOW FROM v_today) NOT IN (6, 7) THEN
      CONTINUE;
    END IF;

    v_week_start := v_today - (EXTRACT(ISODOW FROM v_today)::int - 1);
    v_goal := v_row.goal;

    -- 이번 주 러닝 일수 (걷기 제외, DISTINCT 날짜 — 하루 2회 러닝 = 1회)
    SELECT COUNT(DISTINCT a.activity_date) INTO v_this_week_days
      FROM public.activities a
     WHERE a.user_id = v_row.user_id
       AND a.activity_date >= v_week_start
       AND a.activity_date <= v_today
       AND COALESCE(a.activity_type, 'running') <> 'walking';

    -- 이번 주 이미 달성 (러닝 or 보호권) → 위기 아님
    IF v_this_week_days >= v_goal OR EXISTS (
      SELECT 1 FROM public.streak_freeze_uses sf
       WHERE sf.user_id = v_row.user_id
         AND sf.used_on >= v_week_start AND sf.used_on <= v_today
    ) THEN
      CONTINUE;
    END IF;

    -- 주 1회 dedup (payload week_start). status='failed' 는 재시도 허용.
    IF EXISTS (
      SELECT 1 FROM public.push_send_log psl
       WHERE psl.user_id = v_row.user_id
         AND psl.category = 'streak_risk'
         AND psl.payload ->> 'week_start' = v_week_start::text
         AND psl.status <> 'failed'
    ) THEN
      CONTINUE;
    END IF;

    -- 지난주에 앵커된 주간 스트릭:
    -- 달성 주 (러닝 일수 ≥ goal ∪ 보호권 사용 주) 를 주 키 (월요일) 로 모아
    -- ROW_NUMBER 7일-간격 트릭으로 "지난주 월요일" 에 닿는 연속 주 수 카운트.
    WITH run_weeks AS (
      SELECT (a.activity_date
              - (EXTRACT(ISODOW FROM a.activity_date)::int - 1)) AS wk,
             COUNT(DISTINCT a.activity_date) AS run_days
        FROM public.activities a
       WHERE a.user_id = v_row.user_id
         AND a.activity_date < v_week_start
         AND COALESCE(a.activity_type, 'running') <> 'walking'
       GROUP BY 1
    ),
    freeze_weeks AS (
      SELECT DISTINCT (sf.used_on
              - (EXTRACT(ISODOW FROM sf.used_on)::int - 1)) AS wk
        FROM public.streak_freeze_uses sf
       WHERE sf.user_id = v_row.user_id
         AND sf.used_on < v_week_start
    ),
    achieved AS (
      SELECT wk FROM run_weeks WHERE run_days >= v_goal
      UNION
      SELECT wk FROM freeze_weeks
    ),
    numbered AS (
      SELECT wk,
             (wk + ((ROW_NUMBER() OVER (ORDER BY wk DESC) - 1) * 7)::int) AS anchor
        FROM achieved
    )
    SELECT COUNT(*) INTO v_streak
      FROM numbered
     WHERE anchor = v_week_start - 7;

    IF COALESCE(v_streak, 0) < 1 THEN
      CONTINUE;
    END IF;

    v_runs_left := GREATEST(1, v_goal - v_this_week_days);

    v_title := public.push_text(v_row.user_id,
      '🔥 연속 기록을 지켜요',
      '🔥 Keep your streak alive');
    v_body := public.push_text(v_row.user_id,
      format('이번 주 %s번만 더 달리면 %s주 연속이 이어져요 🔥', v_runs_left, v_streak),
      CASE WHEN v_runs_left = 1
        THEN format('Just 1 more run this week keeps your %s-week streak going 🔥', v_streak)
        ELSE format('Just %s more runs this week keep your %s-week streak going 🔥', v_runs_left, v_streak)
      END);

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'streak_risk', v_title, v_body,
       jsonb_build_object(
         'week_start', v_week_start::text,
         'streak', v_streak,
         'runs_left', v_runs_left,
         'deep_link', '/'),
       'pending',
       public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- 권한 — 기존 관례 유지 (service_role 전용). CREATE OR REPLACE 는 기존 GRANT 를
-- 보존하지만, reference_supabase_function_privilege.md 룰대로 명시 재적용.
REVOKE ALL ON FUNCTION public.enqueue_streak_risk_pushes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_streak_risk_pushes() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_streak_risk_pushes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_streak_risk_pushes() TO service_role;
