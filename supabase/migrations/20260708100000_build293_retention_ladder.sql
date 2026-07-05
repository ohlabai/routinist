-- ============================================================
-- build 293 — 리텐션 push 래더
--
-- 기존 enqueue_idle_reminders() 단일 단계 (3일+ 무활동, 7일 반복) 를
-- 생애주기 4단계 래더로 재편:
--   1. enqueue_welcome_pushes()      — D1 웰컴 (가입 24~48h, 활동 0건)
--   2. enqueue_streak_risk_pushes()  — 스트릭 위기 (연속 3일+, 오늘 아직 0건)
--   3. enqueue_idle_reminders()      — 이탈 리마인더 3단계 (3~6d / 7~29d / 30d+)
--   4. enqueue_weekly_recap_pushes() — 주간 회고 (로컬 월요일 오전)
--
-- 공통 관례 (build 291 인프라):
--   * 카피는 public.push_text(user_id, ko, en) 로 로케일 분기
--   * 예약은 public.local_evening(user_id) — 유저 로컬 18:00 (지났으면 즉시)
--   * 큐 = public.push_send_log (status 'pending', send_after)
--   * 카테고리 토글 = public.should_send_push(uid, category) — 미설정 기본 TRUE
--   * 전부 service_role 전용
-- ============================================================

-- ------------------------------------------------------------
-- 0-a. 헬퍼: local_today(user) — 유저 로컬 기준 오늘 날짜
--      (local_evening 과 동일한 방어 패턴: 잘못된 IANA 문자열이어도 죽지 않음)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.local_today(p_user_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tz TEXT;
  v_local_now TIMESTAMP;
BEGIN
  SELECT COALESCE(timezone, 'Asia/Seoul') INTO v_tz
  FROM public.profiles WHERE id = p_user_id;
  IF v_tz IS NULL THEN v_tz := 'Asia/Seoul'; END IF;

  BEGIN
    v_local_now := NOW() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_local_now := NOW() AT TIME ZONE 'Asia/Seoul';
  END;

  RETURN v_local_now::date;
END $$;

-- ------------------------------------------------------------
-- 0-b. 헬퍼: local_morning(user) — 유저 로컬 오늘 08:00 (지났으면 즉시)
--      local_evening 의 08:00 버전. 주간 회고 예약용.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.local_morning(p_user_id uuid)
RETURNS timestamp with time zone
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tz TEXT;
  v_local_now TIMESTAMP;
  v_target TIMESTAMP;
BEGIN
  SELECT COALESCE(timezone, 'Asia/Seoul') INTO v_tz
  FROM public.profiles WHERE id = p_user_id;
  IF v_tz IS NULL THEN v_tz := 'Asia/Seoul'; END IF;

  BEGIN
    v_local_now := NOW() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'Asia/Seoul';
    v_local_now := NOW() AT TIME ZONE v_tz;
  END;

  v_target := date_trunc('day', v_local_now) + INTERVAL '8 hours';
  IF v_local_now >= v_target THEN
    RETURN NOW();  -- 이미 아침 지남 — 즉시
  END IF;
  RETURN v_target AT TIME ZONE v_tz;
END $$;

-- ------------------------------------------------------------
-- 1. enqueue_welcome_pushes() — D1 웰컴
--    가입 24~48h && activities 0건 && 웰컴 미발송 → 로컬 저녁 예약.
--    cron 이 매일 1회라 24h 창은 유저당 정확히 한 번만 걸린다.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_welcome_pushes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT DISTINCT pd.user_id
      FROM public.push_device_tokens pd
      JOIN auth.users u ON u.id = pd.user_id
     WHERE pd.enabled = true
       AND u.created_at BETWEEN NOW() - INTERVAL '48 hours'
                            AND NOW() - INTERVAL '24 hours'
       AND public.should_send_push(pd.user_id, 'welcome_d1')
       AND NOT EXISTS (
         SELECT 1 FROM public.activities a WHERE a.user_id = pd.user_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = pd.user_id
            AND psl.category = 'welcome_d1'
            AND psl.payload ->> 'kind' = 'welcome_d1'
       )
     LIMIT 500
  LOOP
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'welcome_d1',
       public.push_text(v_row.user_id,
         'Routinist 에 오신 걸 환영해요! 🎉',
         'Welcome to Routinist! 🎉'),
       public.push_text(v_row.user_id,
         '첫 러닝, 가볍게 1km 어때요? 👟 Apple Health 연동하면 자동으로 기록돼요',
         'How about an easy 1km for your first run? 👟 Connect Apple Health and it logs itself'),
       jsonb_build_object('kind', 'welcome_d1', 'deep_link', '/'),
       'pending',
       public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- ------------------------------------------------------------
-- 2. enqueue_streak_risk_pushes() — 스트릭 위기
--    연속 3일+ 이고 마지막 "달린/보호된 날" 이 유저 로컬 어제,
--    로컬 오늘은 아직 0건 → 로컬 저녁에 넛지.
--
--    연속일 계산: award_activity_milestones 의 row_number 그룹 패턴을
--    "어제 종료" 앵커로 사용. DISTINCT activity_date 에
--    streak_freeze_uses.used_on 을 UNION (보호권 사용일도 달린 날 취급).
--    성능: 최근 2일 내 활동(또는 보호권 사용) 이 있는 유저만 후보.
-- ------------------------------------------------------------
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
  v_yesterday DATE;      -- 유저 로컬 어제
  v_streak INTEGER;
  v_freezes SMALLINT;
  v_title TEXT;
  v_body TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT pd.user_id
      FROM public.push_device_tokens pd
     WHERE pd.enabled = true
       AND public.should_send_push(pd.user_id, 'streak_risk')
       -- 성능 필터: 최근 2일 내 활동/보호권 사용이 있는 유저만 후보
       AND EXISTS (
         SELECT 1 FROM public.activities a
          WHERE a.user_id = pd.user_id
            AND a.activity_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 2
         UNION ALL
         SELECT 1 FROM public.streak_freeze_uses sf
          WHERE sf.user_id = pd.user_id
            AND sf.used_on >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 2
       )
     GROUP BY pd.user_id
     LIMIT 500
  LOOP
    v_today := public.local_today(v_row.user_id);
    v_yesterday := v_today - 1;

    -- 로컬 오늘 이미 달렸거나 보호권을 썼으면 위기 아님
    IF EXISTS (
      SELECT 1 FROM public.activities a
       WHERE a.user_id = v_row.user_id AND a.activity_date = v_today
      UNION ALL
      SELECT 1 FROM public.streak_freeze_uses sf
       WHERE sf.user_id = v_row.user_id AND sf.used_on = v_today
    ) THEN
      CONTINUE;
    END IF;

    -- 일 1회 dedup (payload date)
    IF EXISTS (
      SELECT 1 FROM public.push_send_log psl
       WHERE psl.user_id = v_row.user_id
         AND psl.category = 'streak_risk'
         AND psl.payload ->> 'date' = v_today::text
    ) THEN
      CONTINUE;
    END IF;

    -- 어제에 앵커된 연속일 (활동일 ∪ 보호권 사용일, DISTINCT 역방향 카운트)
    WITH days AS (
      SELECT DISTINCT d FROM (
        SELECT a.activity_date AS d FROM public.activities a
         WHERE a.user_id = v_row.user_id AND a.activity_date <= v_yesterday
        UNION
        SELECT sf.used_on AS d FROM public.streak_freeze_uses sf
         WHERE sf.user_id = v_row.user_id AND sf.used_on <= v_yesterday
      ) t
    ),
    numbered AS (
      SELECT d,
             (d + (ROW_NUMBER() OVER (ORDER BY d DESC) - 1)::int) AS anchor
        FROM days
    )
    SELECT COUNT(*) INTO v_streak FROM numbered WHERE anchor = v_yesterday;

    IF v_streak < 3 THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(p.streak_freezes, 0) INTO v_freezes
      FROM public.profiles p WHERE p.id = v_row.user_id;

    v_title := public.push_text(v_row.user_id,
      '🔥 연속 기록을 지켜요',
      '🔥 Keep your streak alive');
    IF COALESCE(v_freezes, 0) > 0 THEN
      v_body := public.push_text(v_row.user_id,
        format('🛡️ %s일 연속이에요 — 보호권이 있지만, 오늘 가볍게 뛰면 아껴둘 수 있어요', v_streak),
        format('🛡️ %s days in a row — you have a streak freeze, but an easy run today lets you save it', v_streak));
    ELSE
      v_body := public.push_text(v_row.user_id,
        format('🔥 %s일 연속이 오늘 끊겨요 — 1km 면 충분해요', v_streak),
        format('🔥 Your %s-day streak ends today — 1km is all it takes', v_streak));
    END IF;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'streak_risk', v_title, v_body,
       jsonb_build_object('date', v_today::text, 'streak', v_streak, 'deep_link', '/'),
       'pending',
       public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- ------------------------------------------------------------
-- 3. enqueue_idle_reminders() — 단계별 재작성 (기존 단일 단계 대체)
--    마지막 활동일 (MAX(activity_date), 없으면 가입일) 경과 기준:
--      * 3~6일  → stage 'idle_3d'  : 부드러운 리마인드, 에피소드당 1회
--      * 7~29일 → stage 'idle_7d'  : 7일 dedup + 에피소드당 최대 2회
--      * 30일+  → stage 'idle_30d' : 30일 dedup (월 1회 무기한)
--    category 는 기존 'idle_reminder' 유지 (push-settings 토글 호환),
--    단계 dedup 은 payload.stage 로. 전 단계 공통 7일 최소 간격 유지
--    (기존 함수와 동일한 발송 밀도 상한).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_idle_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Seoul')::date;
  v_days INTEGER;
  v_stage TEXT;
  v_title TEXT;
  v_body TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT pd.user_id,
           COALESCE(MAX(a.activity_date), MAX(p.created_at::date)) AS last_act
      FROM public.push_device_tokens pd
      JOIN public.profiles p ON p.id = pd.user_id
      LEFT JOIN public.activities a ON a.user_id = pd.user_id
     WHERE pd.enabled = true
       AND public.should_send_push(pd.user_id, 'idle_reminder')
       -- 전 단계 공통 최소 간격: 최근 7일 내 idle_reminder 발송 이력 없음
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = pd.user_id
            AND psl.category = 'idle_reminder'
            AND psl.created_at > NOW() - INTERVAL '7 days'
       )
     GROUP BY pd.user_id
     HAVING COALESCE(MAX(a.activity_date), MAX(p.created_at::date))
            <= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 3
     LIMIT 500
  LOOP
    v_days := v_today - v_row.last_act;

    IF v_days BETWEEN 3 AND 6 THEN
      v_stage := 'idle_3d';
      -- 해당 에피소드 (마지막 활동 이후) 에 이미 보냈으면 skip → 단계 1회만
      IF EXISTS (
        SELECT 1 FROM public.push_send_log psl
         WHERE psl.user_id = v_row.user_id
           AND psl.category = 'idle_reminder'
           AND psl.payload ->> 'stage' = 'idle_3d'
           AND psl.created_at >= v_row.last_act::timestamptz
      ) THEN
        CONTINUE;
      END IF;
      v_title := public.push_text(v_row.user_id,
        '🏃 오늘 한 번 달려볼까요?',
        '🏃 How about a run today?');
      v_body := public.push_text(v_row.user_id,
        '잠깐 쉬어가는 것도 루틴이에요 — 오늘은 가볍게 한 바퀴 어때요? ✨',
        'Rest is part of the routine too — how about one easy lap today? ✨');

    ELSIF v_days BETWEEN 7 AND 29 THEN
      v_stage := 'idle_7d';
      -- 에피소드당 최대 2회 (7일 간격은 공통 가드가 보장)
      IF (
        SELECT COUNT(*) FROM public.push_send_log psl
         WHERE psl.user_id = v_row.user_id
           AND psl.category = 'idle_reminder'
           AND psl.payload ->> 'stage' = 'idle_7d'
           AND psl.created_at >= v_row.last_act::timestamptz
      ) >= 2 THEN
        CONTINUE;
      END IF;
      v_title := public.push_text(v_row.user_id,
        '🏃 다시 달려볼까요?',
        '🏃 Ready to run again?');
      v_body := public.push_text(v_row.user_id,
        '다시 시작하는 게 제일 어렵죠 — 오늘 1km 만 가볍게 어때요?',
        'Getting started again is the hardest part — just an easy 1km today?');

    ELSE
      v_stage := 'idle_30d';
      -- 30일 dedup
      IF EXISTS (
        SELECT 1 FROM public.push_send_log psl
         WHERE psl.user_id = v_row.user_id
           AND psl.category = 'idle_reminder'
           AND psl.payload ->> 'stage' = 'idle_30d'
           AND psl.created_at > NOW() - INTERVAL '30 days'
      ) THEN
        CONTINUE;
      END IF;
      v_title := public.push_text(v_row.user_id,
        '보고 싶어요! 🏃',
        'We miss you! 🏃');
      v_body := public.push_text(v_row.user_id,
        '그동안 랭킹·월드런에 새 소식이 많아요 — 돌아와서 가볍게 1km 어때요?',
        'A lot has happened in Rankings & World Run — come back for an easy 1km?');
    END IF;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'idle_reminder', v_title, v_body,
       jsonb_build_object('stage', v_stage, 'deep_link', '/'),
       'pending',
       public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- ------------------------------------------------------------
-- 4. enqueue_weekly_recap_pushes() — 주간 회고
--    유저 로컬 기준 오늘이 월요일인 유저만 대상 (매일 호출해도 각자
--    자기 월요일에만 1회). 지난주 (로컬 월~일) 러닝 1회+ 면
--    "지난주 N km · M회" 요약을 로컬 오전 8시에 예약.
--    dedup = payload.week_start (주 1회).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_weekly_recap_pushes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_today DATE;
  v_week_start DATE;   -- 지난주 월요일
  v_week_end DATE;     -- 지난주 일요일
  v_km NUMERIC;
  v_runs INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT pd.user_id
      FROM public.push_device_tokens pd
     WHERE pd.enabled = true
       AND public.should_send_push(pd.user_id, 'weekly_recap')
       -- 성능 필터: 최근 8일 내 활동이 있는 유저만 후보
       AND EXISTS (
         SELECT 1 FROM public.activities a
          WHERE a.user_id = pd.user_id
            AND a.activity_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 8
       )
     GROUP BY pd.user_id
     LIMIT 500
  LOOP
    v_today := public.local_today(v_row.user_id);
    -- 로컬 오늘이 월요일인 유저만 (ISODOW: 월=1)
    IF EXTRACT(ISODOW FROM v_today) <> 1 THEN
      CONTINUE;
    END IF;
    v_week_start := v_today - 7;
    v_week_end := v_today - 1;

    -- 주 1회 dedup (payload week_start)
    IF EXISTS (
      SELECT 1 FROM public.push_send_log psl
       WHERE psl.user_id = v_row.user_id
         AND psl.category = 'weekly_recap'
         AND psl.payload ->> 'week_start' = v_week_start::text
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(a.distance_km), 0), COUNT(*)
      INTO v_km, v_runs
      FROM public.activities a
     WHERE a.user_id = v_row.user_id
       AND a.activity_date BETWEEN v_week_start AND v_week_end
       AND COALESCE(a.activity_type, 'running') = 'running';

    IF v_runs = 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'weekly_recap',
       public.push_text(v_row.user_id, '📊 지난주 러닝 리포트', '📊 Your weekly running recap'),
       public.push_text(v_row.user_id,
         format('지난주 %skm · %s회 달렸어요 — 이번 주도 가볍게 시작!', round(v_km, 1), v_runs),
         format('You ran %s km across %s runs last week — start this week easy!', round(v_km, 1), v_runs)),
       jsonb_build_object('week_start', v_week_start::text,
                          'km', round(v_km, 1), 'runs', v_runs,
                          'deep_link', '/'),
       'pending',
       public.local_morning(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- ------------------------------------------------------------
-- 5. 권한 — 전부 service_role 전용 (기존 enqueue 함수 관례)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enqueue_welcome_pushes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_welcome_pushes() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_welcome_pushes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_welcome_pushes() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_streak_risk_pushes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_streak_risk_pushes() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_streak_risk_pushes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_streak_risk_pushes() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_idle_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_idle_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_idle_reminders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_idle_reminders() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_weekly_recap_pushes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_weekly_recap_pushes() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_weekly_recap_pushes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_weekly_recap_pushes() TO service_role;
