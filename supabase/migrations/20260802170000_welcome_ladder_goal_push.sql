-- 알림 신설 2건 (2026-08-02 hans 승인 — 보류 해제)
-- ① 환영 래더 D3·D7: 가입 후 아직 러닝 0건인 유저에게 단계별 첫 러닝 유도.
--    D1 과 동일 구조 (저녁 발송·1회성·welcome_d1 설정 게이트 공유). 러닝 시작하면 래더 중단.
-- ② goal_achieved: 월간 목표 100% "교차 순간" 1회 축하 (활동 INSERT 트리거).

-- ① 환영 래더
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
     LIMIT 500
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
     LIMIT 500
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
     LIMIT 500
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
END $function$;

-- ② 월간 목표 달성 축하 — 교차 순간 1회 (달·유저당)
CREATE OR REPLACE FUNCTION public.enqueue_goal_achieved_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_goal NUMERIC;
  v_after NUMERIC;
  v_before NUMERIC;
  v_month_start DATE;
BEGIN
  IF COALESCE(NEW.activity_type, 'running') <> 'running' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.distance_km, 0) <= 0 THEN RETURN NEW; END IF;
  v_month_start := date_trunc('month', NEW.activity_date)::date;
  -- 현재 (KST) 달의 활동만 축하 — 과거달 bulk import 소급 축하 방지
  IF v_month_start <> date_trunc('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::date THEN
    RETURN NEW;
  END IF;

  SELECT goal_km INTO v_goal FROM public.monthly_goals
   WHERE user_id = NEW.user_id
     AND year = EXTRACT(YEAR FROM v_month_start)::int
     AND month = EXTRACT(MONTH FROM v_month_start)::int;
  IF v_goal IS NULL OR v_goal <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(distance_km), 0) INTO v_after FROM public.activities
   WHERE user_id = NEW.user_id
     AND activity_date >= v_month_start
     AND activity_date < (v_month_start + INTERVAL '1 month')::date
     AND COALESCE(activity_type, 'running') = 'running';
  v_before := v_after - NEW.distance_km;
  -- "이 러닝으로 목표를 넘은 순간"만
  IF v_before >= v_goal OR v_after < v_goal THEN RETURN NEW; END IF;

  IF NOT public.should_send_push(NEW.user_id, 'goal_achieved') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.push_send_log
              WHERE user_id = NEW.user_id AND category = 'goal_achieved'
                AND (payload->>'month') = to_char(v_month_start, 'YYYY-MM')) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (NEW.user_id, 'goal_achieved',
    public.push_text(NEW.user_id, '🎉 이달 목표 달성!', '🎉 Monthly goal achieved!'),
    public.push_text(NEW.user_id,
      to_char(v_month_start, 'FMMM') || '월 목표 ' || v_goal || 'km 를 해냈어요. 정말 대단해요!',
      'You crushed your ' || v_goal || 'km goal this month. Amazing!'),
    jsonb_build_object('month', to_char(v_month_start, 'YYYY-MM'), 'goal_km', v_goal, 'deep_link', '/goals'),
    'pending');
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_goal_achieved_push ON public.activities;
CREATE TRIGGER trg_goal_achieved_push
  AFTER INSERT ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_goal_achieved_push();
