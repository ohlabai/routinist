-- 2026-08-09: 라이프사이클 푸시 LIMIT 500 → 50000 (전면 리뷰 성능 파트).
--
-- welcome D1/D3/D7 · idle · streak_risk · month_end 가 자격 필터 뒤에 LIMIT 500 을 걸어,
-- 광고로 하루 수천 명 유입 시 회원 500명 초과분이 에러도 로그도 없이 리텐션 푸시를 못 받았다.
-- enqueue 는 pending 행을 만들 뿐이고 하루 1~2회 크론이라 한 번에 수천 행 INSERT 는 무해.
-- (5만 초과 시엔 커서 배치가 필요하지만 그 규모 전까지 이 한도로 충분.)
-- 함수 본문은 프로덕션 정의 그대로, LIMIT 값만 상향.

CREATE OR REPLACE FUNCTION public.enqueue_idle_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     LIMIT 50000
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
END $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_month_end_recaps()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_month_start DATE;
  v_month_end DATE;
  v_month_label TEXT;
  v_month_label_en TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  -- KST 기준 이번 달의 시작/끝
  v_month_start := date_trunc('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::DATE;
  v_month_end := (v_month_start + INTERVAL '1 month - 1 day')::DATE;
  v_month_label := to_char(v_month_start, 'MM') || '월';
  v_month_label_en := to_char(v_month_start, 'FMMonth');

  FOR v_row IN
    SELECT a.user_id,
           SUM(a.distance_km) AS total_km,
           COUNT(DISTINCT a.activity_date) AS run_days,
           COUNT(*) AS run_count,
           MIN(NULLIF(a.pace_avg_sec_per_km, 0)) AS best_pace
      FROM public.activities a
      JOIN public.push_device_tokens pd ON pd.user_id = a.user_id AND pd.enabled = true
     WHERE a.activity_date >= v_month_start
       AND a.activity_date <= v_month_end
       AND public.should_send_push(a.user_id, 'month_end_recap')
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = a.user_id
            AND psl.category = 'month_end_recap'
            AND (psl.payload->>'month_start')::DATE = v_month_start
       )
     GROUP BY a.user_id
     HAVING SUM(a.distance_km) > 0
     LIMIT 50000
  LOOP
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'month_end_recap',
       public.push_text(v_row.user_id,
         '🎉 ' || v_month_label || ' 정산이 도착했어요!',
         '🎉 Your ' || v_month_label_en || ' recap is here!'),
       public.push_text(v_row.user_id,
         v_row.total_km::numeric(10,1)::text || 'km / ' || v_row.run_days || '일 달림 — 카드 보러 가기',
         v_row.total_km::numeric(10,1)::text || 'km across ' || v_row.run_days || ' days — see your recap card'),
       jsonb_build_object(
         'deep_link', '/awards',
         'month_start', v_month_start,
         'total_km', v_row.total_km,
         'run_days', v_row.run_days,
         'run_count', v_row.run_count,
         'best_pace', v_row.best_pace
       ),
       'pending',
       public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_streak_risk_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     LIMIT 50000
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
END $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_welcome_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_has_activity BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  -- D1: 가입 24~96h (기존 유지)
  FOR v_row IN
    SELECT DISTINCT pd.user_id
      FROM public.push_device_tokens pd
      JOIN auth.users u ON u.id = pd.user_id
     WHERE pd.enabled = true
       AND u.created_at BETWEEN NOW() - INTERVAL '96 hours' AND NOW() - INTERVAL '24 hours'
       AND public.should_send_push(pd.user_id, 'welcome_d1')
       AND NOT EXISTS (SELECT 1 FROM public.push_send_log psl
                        WHERE psl.user_id = pd.user_id AND psl.category = 'welcome_d1')
     LIMIT 50000
  LOOP
    SELECT EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = v_row.user_id)
      INTO v_has_activity;
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status, send_after)
    VALUES (v_row.user_id, 'welcome_d1',
      public.push_text(v_row.user_id, 'Routinist 에 오신 걸 환영해요! 🎉', 'Welcome to Routinist! 🎉'),
      CASE WHEN v_has_activity THEN
        public.push_text(v_row.user_id,
          '기록이 잘 들어왔어요 👟 이번 주 첫 러닝, 가볍게 시작해볼까요?',
          'Your runs are all in 👟 How about an easy first run this week?')
      ELSE
        public.push_text(v_row.user_id,
          '첫 러닝, 가볍게 1km 어때요? 👟 Apple Health 연동하면 자동으로 기록돼요',
          'How about an easy 1km for your first run? 👟 Connect Apple Health and it logs itself')
      END,
      jsonb_build_object('kind', 'welcome_d1', 'deep_link', '/'),
      'pending', public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;

  -- D3: 가입 72h~8일 + 아직 러닝 0건 (2026-08-02 래더 확장)
  FOR v_row IN
    SELECT DISTINCT pd.user_id
      FROM public.push_device_tokens pd
      JOIN auth.users u ON u.id = pd.user_id
     WHERE pd.enabled = true
       AND u.created_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '72 hours'
       AND public.should_send_push(pd.user_id, 'welcome_d1')
       AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = pd.user_id)
       AND NOT EXISTS (SELECT 1 FROM public.push_send_log psl
                        WHERE psl.user_id = pd.user_id AND psl.category = 'welcome_d3')
     LIMIT 50000
  LOOP
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status, send_after)
    VALUES (v_row.user_id, 'welcome_d3',
      public.push_text(v_row.user_id, '오늘 딱 1km 어때요? 🌱', 'Just 1km today? 🌱'),
      public.push_text(v_row.user_id,
        '시작이 절반이에요 — 걷다 뛰어도 충분해요. 완주하면 달력에 잔디가 자라나요!',
        'Starting is half the battle — walk-run counts too. Finish one and your calendar grows grass!'),
      jsonb_build_object('kind', 'welcome_d3', 'deep_link', '/track'),
      'pending', public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;

  -- D7: 가입 7~14일 + 아직 러닝 0건 — 래더 마지막 (이후 idle_reminder 가 이어받음)
  FOR v_row IN
    SELECT DISTINCT pd.user_id
      FROM public.push_device_tokens pd
      JOIN auth.users u ON u.id = pd.user_id
     WHERE pd.enabled = true
       AND u.created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '168 hours'
       AND public.should_send_push(pd.user_id, 'welcome_d1')
       AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.user_id = pd.user_id)
       AND NOT EXISTS (SELECT 1 FROM public.push_send_log psl
                        WHERE psl.user_id = pd.user_id AND psl.category = 'welcome_d7')
     LIMIT 50000
  LOOP
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status, send_after)
    VALUES (v_row.user_id, 'welcome_d7',
      public.push_text(v_row.user_id, '이번 주말, 첫 러닝 함께해요 🏃', 'First run this weekend? 🏃'),
      public.push_text(v_row.user_id,
        '5분만 뛰어도 기록이 남아요. 동네 러너들이 랭킹에서 기다리고 있어요!',
        'Even 5 minutes counts. Runners near you are waiting on the leaderboard!'),
      jsonb_build_object('kind', 'welcome_d7', 'deep_link', '/track'),
      'pending', public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $function$
;

