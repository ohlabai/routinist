-- build 291: push 다국어(ko/en) + 타임존 인프라
--
-- 1. 스키마 — profiles.locale/timezone, push_send_log.send_after (+발송기 partial index)
-- 2. 헬퍼 — push_text(유저 locale 분기), local_evening(유저 timezone 기준 "오늘 18:00 로컬")
-- 3. push 카피 ko/en 이중화 — 사용자 노출 title/body 만 push_text() 로 치환.
--    쿼리 조건·dedup·권한 체크 로직은 prod 정의 그대로 (한 글자도 변경 없음).
--    idle_reminder / month_end_recap 은 send_after = local_evening() 지정 (LA 유저 새벽 push 방지).
-- 4. push_pipeline_health() — 데드맨 알람 집계 RPC (service_role 전용)
--
-- ⚠️ 발송기(cron/edge) 주의: send_after 도입 후 발송기 조회에
--    AND (send_after IS NULL OR send_after <= NOW()) 조건을 추가해야 예약이 동작한다.
--    (조건 추가 전까지는 send_after 가 무시되고 즉시 발송 — 회귀는 아님)

-- ============================================================
-- 1. 스키마
-- ============================================================

-- profiles.locale 은 prod 에 이미 존재 (2026-07-07 조회 기준) — IF NOT EXISTS 로 멱등.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale text;    -- 'ko' | 'en' (null = ko)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone text;  -- IANA (예: 'America/Los_Angeles', null = 'Asia/Seoul')

-- send_after: null = 즉시 발송, 값이 있으면 그 시각 이후에만 발송기가 집는다.
ALTER TABLE public.push_send_log ADD COLUMN IF NOT EXISTS send_after timestamptz;

-- 발송기 조회용 partial index (pending 잔량은 항상 작게 유지되는 큐 패턴)
CREATE INDEX IF NOT EXISTS push_send_log_pending_send_after_idx
  ON public.push_send_log (status, send_after)
  WHERE status = 'pending';

-- ============================================================
-- 2. 헬퍼
-- ============================================================

-- 유저 locale 이 'en' 이면 영어 카피, 그 외(null 포함)는 한국어 카피.
-- SECURITY INVOKER — SECURITY DEFINER push 함수들 내부에서만 호출되므로 definer 불필요.
CREATE OR REPLACE FUNCTION public.push_text(p_user_id uuid, p_ko text, p_en text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN (SELECT locale FROM public.profiles WHERE id = p_user_id) = 'en' THEN p_en
    ELSE p_ko
  END;
$function$;

-- 사용자 timezone (null/invalid 이면 'Asia/Seoul') 기준 발송 예약 시각.
-- 규칙:
--   · 로컬 시각이 아직 18:00 이전 → "오늘 로컬 18:00" 을 반환 (그때까지 대기)
--   · 이미 로컬 18:00 을 지났음   → NOW() 반환 (즉시 발송)
-- 즉 "다음 18:00 로컬, 단 오늘 저녁이 이미 지났으면 내일로 미루지 않고 즉시".
CREATE OR REPLACE FUNCTION public.local_evening(p_user_id uuid)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz TEXT;
  v_local_now TIMESTAMP;   -- 유저 로컬 벽시계 (tz 없는 timestamp)
  v_target TIMESTAMP;      -- 오늘 로컬 18:00
BEGIN
  SELECT COALESCE(timezone, 'Asia/Seoul') INTO v_tz
  FROM public.profiles WHERE id = p_user_id;
  IF v_tz IS NULL THEN v_tz := 'Asia/Seoul'; END IF;  -- 유저 row 자체가 없는 경우

  -- 잘못된 IANA 문자열 방어 (클라이언트가 이상값 저장해도 push 파이프라인이 죽지 않게)
  BEGIN
    v_local_now := NOW() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'Asia/Seoul';
    v_local_now := NOW() AT TIME ZONE v_tz;
  END;

  v_target := date_trunc('day', v_local_now) + INTERVAL '18 hours';
  IF v_local_now >= v_target THEN
    RETURN NOW();  -- 이미 저녁 — 즉시
  END IF;
  RETURN v_target AT TIME ZONE v_tz;  -- 로컬 18:00 → timestamptz
END $function$;

-- ============================================================
-- 3. push 카피 ko/en 이중화
-- ============================================================

-- 3-1. enqueue_idle_reminders
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · title/body 를 push_text() 로 ko/en 이중화 (en 배열 추가, 같은 index 로 랜덤 픽)
--   · INSERT 에 send_after = local_evening(user_id) 추가 (해외 유저 새벽 push 방지)
--   · 대상 쿼리/dedup(7일)/HAVING(3일)/LIMIT/권한 체크 로직 변경 없음
CREATE OR REPLACE FUNCTION public.enqueue_idle_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_idx INT;
  v_msgs TEXT[] := ARRAY[
    '오늘도 신발 끈만 묶어볼까요?',
    '딱 1km만 달려도 기분이 달라져요 ✨',
    '루틴은 천천히, 그러나 꾸준히. 한 발만 떼봐요',
    '오랜만이에요! 어제의 나를 이겨봐요 🏃'
  ];
  v_msgs_en TEXT[] := ARRAY[
    'How about just lacing up your shoes today?',
    'Even a single kilometer can change your whole mood ✨',
    'Routines grow slowly but surely. Just take one step',
    'It''s been a while! Let''s beat yesterday''s you 🏃'
  ];
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT DISTINCT pd.user_id,
           COALESCE(MAX(a.created_at), 'epoch'::timestamptz) AS last_act
      FROM public.push_device_tokens pd
      LEFT JOIN public.activities a ON a.user_id = pd.user_id
     WHERE pd.enabled = true
       AND public.should_send_push(pd.user_id, 'idle_reminder')
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = pd.user_id
            AND psl.category = 'idle_reminder'
            AND psl.created_at > NOW() - INTERVAL '7 days'
       )
     GROUP BY pd.user_id
     HAVING COALESCE(MAX(a.created_at), 'epoch'::timestamptz) < NOW() - INTERVAL '3 days'
     LIMIT 200
  LOOP
    v_idx := 1 + floor(random() * array_length(v_msgs, 1))::int;
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'idle_reminder',
       public.push_text(v_row.user_id, '🏃 오늘 한 번 달려볼까요?', '🏃 How about a run today?'),
       public.push_text(v_row.user_id, v_msgs[v_idx], v_msgs_en[v_idx]),
       jsonb_build_object('deep_link', '/'),
       'pending',
       public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

-- 3-2. enqueue_month_end_recaps
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · title/body 를 push_text() 로 ko/en 이중화 (en 월 라벨은 'July' 형식)
--   · INSERT 에 send_after = local_evening(user_id) 추가
--   · KST 월 범위 계산 / 대상 쿼리 / month_start dedup / LIMIT / 권한 체크 로직 변경 없음
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
     LIMIT 500
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
END $function$;

-- 3-3. notify_course_progress (50%/90% 진행률 push 트리거)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · title/body 를 push_text() 로 ko/en 이중화
--   · 진행률 계산 / milestone 판정 / notified_milestones 갱신 / opt-out 체크 로직 변경 없음
--   · 실시간 이벤트라 send_after 없음 (즉시)
CREATE OR REPLACE FUNCTION public.notify_course_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  v_progress NUMERIC;
  v_pct NUMERIC;
  v_done JSONB;
  v_milestone INT;
  v_remaining NUMERIC;
BEGIN
  FOR r IN
    SELECT ucp.course_id, ucp.started_at, ucp.notified_milestones,
           vc.name, vc.distance_km
      FROM public.user_course_progress ucp
      JOIN public.virtual_courses vc ON vc.id = ucp.course_id
     WHERE ucp.user_id = NEW.user_id
       AND ucp.completed_at IS NULL
  LOOP
    SELECT COALESCE(SUM(a.distance_km), 0) INTO v_progress
      FROM public.activities a
     WHERE a.user_id = NEW.user_id
       AND a.activity_date >= (r.started_at AT TIME ZONE 'Asia/Seoul')::DATE
       AND (a.activity_type IS NULL OR a.activity_type = 'running');

    IF r.distance_km IS NULL OR r.distance_km <= 0 THEN CONTINUE; END IF;
    v_pct := v_progress / r.distance_km * 100;
    v_done := r.notified_milestones;

    FOREACH v_milestone IN ARRAY ARRAY[50, 90]
    LOOP
      IF v_pct >= v_milestone AND v_pct < 100
         AND NOT (v_done @> to_jsonb(v_milestone)) THEN
        IF public.should_send_push(NEW.user_id, 'course_progress') THEN
          v_remaining := GREATEST(0, r.distance_km - v_progress);
          INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
          VALUES (
            NEW.user_id, 'course_progress',
            CASE WHEN v_milestone = 50
                 THEN public.push_text(NEW.user_id,
                        '🔥 ' || r.name || ' 절반 왔어요!',
                        '🔥 Halfway through ' || r.name || '!')
                 ELSE public.push_text(NEW.user_id,
                        '🏁 ' || r.name || ' 거의 다 왔어요!',
                        '🏁 Almost there — ' || r.name || '!') END,
            public.push_text(NEW.user_id,
              v_progress::numeric(10,2) || ' / ' || r.distance_km::numeric(10,2) || ' km · '
                || '남은 거리 ' || v_remaining::numeric(10,2) || ' km',
              v_progress::numeric(10,2) || ' / ' || r.distance_km::numeric(10,2) || ' km · '
                || v_remaining::numeric(10,2) || ' km to go'),
            jsonb_build_object(
              'course_id', r.course_id::text,
              'course_name', r.name,
              'progress_pct', v_milestone,
              'deep_link', '/social/rankings?tab=world'
            ),
            'pending'
          );
        END IF;
        v_done := v_done || to_jsonb(v_milestone);
      END IF;
    END LOOP;

    IF v_done <> r.notified_milestones THEN
      UPDATE public.user_course_progress
         SET notified_milestones = v_done
       WHERE user_id = NEW.user_id AND course_id = r.course_id;
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

-- 3-4. _complete_course (완주 처리 + 환급 + push)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · push title/body 만 push_text() 로 ko/en 이중화
--   · 완주 표시 / 환급 멱등성 / 마일리지 트랜잭션 / opt-out 체크 로직 변경 없음
--     (mileage_transactions.description 은 내부 원장 문구라 ko 유지)
CREATE OR REPLACE FUNCTION public._complete_course(p_user_id uuid, p_course_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fee INTEGER;
  v_refund INTEGER;
  v_name TEXT;
  v_balance INTEGER;
  v_already_refunded BOOLEAN;
BEGIN
  -- 완주 표시 (이미 표시돼있으면 갱신 안 함)
  UPDATE public.user_course_progress
     SET completed_at = COALESCE(completed_at, now()),
         notified_at  = COALESCE(notified_at, now())
   WHERE user_id = p_user_id AND course_id = p_course_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT entry_fee_p, name INTO v_fee, v_name
  FROM public.virtual_courses WHERE id = p_course_id;
  v_refund := COALESCE(v_fee, 0) / 2;

  -- 이미 같은 course 에 대해 환급된 적 있는지 확인 (멱등성)
  SELECT EXISTS (
    SELECT 1 FROM public.mileage_transactions
    WHERE user_id = p_user_id
      AND event_type = 'course_complete_refund'
      AND reference_id = p_course_id
  ) INTO v_already_refunded;

  IF v_refund > 0 AND NOT v_already_refunded THEN
    UPDATE public.profiles
       SET mileage_balance = COALESCE(mileage_balance, 0) + v_refund
     WHERE id = p_user_id
     RETURNING mileage_balance INTO v_balance;

    INSERT INTO public.mileage_transactions
      (user_id, amount, balance_after, tx_type, event_type, reference_id, description, metadata)
    VALUES
      (p_user_id, v_refund, COALESCE(v_balance, v_refund), 'reward',
       'course_complete_refund', p_course_id,
       '월드런 완주 환급 50% — ' || COALESCE(v_name, '코스'),
       jsonb_build_object(
         'course_id', p_course_id,
         'course_name', v_name,
         'refund_amount', v_refund,
         'original_fee', v_fee
       ));
  END IF;

  -- push 큐 — 사용자 설정 (push_settings.course_complete) 존중
  IF public.should_send_push(p_user_id, 'course_complete') THEN
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      p_user_id,
      'course_complete',
      public.push_text(p_user_id,
        '🏆 ' || COALESCE(v_name, '월드런') || ' 완주!',
        '🏆 ' || COALESCE(v_name, 'World Run') || ' complete!'),
      CASE
        WHEN v_refund > 0 AND NOT v_already_refunded
          THEN public.push_text(p_user_id,
                 '메달이 도착했어요. 마일리지 ' || v_refund::text || 'P 환급 ✨',
                 'Your medal is here — ' || v_refund::text || 'P mileage refunded ✨')
        ELSE public.push_text(p_user_id,
               '메달이 도착했어요. 친구들에게 자랑해보세요 ✨',
               'Your medal is here. Show it off to your friends ✨')
      END,
      jsonb_build_object(
        'course_id', p_course_id::text,
        'course_name', v_name,
        'deep_link', '/social/rankings?tab=world'
      ),
      'pending'
    );
  END IF;
END $function$;

-- 3-5. enqueue_world_chase_pushes (월드런 추격 push)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · title/body 를 push_text() 로 ko/en 이중화
--   · 진행률 CTE / gap 조건 / 24h dedup / opt-out / 닉네임 sanitize(build 236 #H1) 로직 변경 없음
CREATE OR REPLACE FUNCTION public.enqueue_world_chase_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enqueued INT := 0;
  v_rec RECORD;
  v_chaser_name TEXT;
  v_safe_name TEXT;
BEGIN
  FOR v_rec IN
    WITH course_progress AS (
      SELECT ucp.user_id, ucp.course_id, c.name AS course_name,
             COALESCE((
               SELECT SUM(a.distance_km) FROM activities a
                WHERE a.user_id = ucp.user_id
                  AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
                  AND (a.activity_type IS NULL OR a.activity_type = 'running')
             ), 0)::NUMERIC AS progress_km
      FROM user_course_progress ucp
      JOIN virtual_courses c ON c.id = ucp.course_id
      WHERE ucp.completed_at IS NULL
    )
    SELECT a.user_id AS recipient_id, b.user_id AS chaser_id, a.course_id, a.course_name,
           a.progress_km AS recipient_km, b.progress_km AS chaser_km, (a.progress_km - b.progress_km) AS gap_km
    FROM course_progress a
    JOIN course_progress b ON b.course_id = a.course_id AND b.user_id <> a.user_id
    JOIN follows f ON f.follower_id = a.user_id AND f.following_id = b.user_id
    WHERE a.progress_km > b.progress_km AND (a.progress_km - b.progress_km) < 1.5 AND b.progress_km > 0
  LOOP
    IF EXISTS (SELECT 1 FROM push_send_log WHERE user_id = v_rec.recipient_id AND category = 'world_chase'
        AND (payload->>'course_id') = v_rec.course_id::text AND (payload->>'chaser_id') = v_rec.chaser_id::text
        AND created_at > NOW() - INTERVAL '24 hours') THEN CONTINUE; END IF;

    IF NOT public.should_send_push(v_rec.recipient_id, 'world_chase') THEN CONTINUE; END IF;

    SELECT display_name INTO v_chaser_name FROM profiles WHERE id = v_rec.chaser_id;
    IF v_chaser_name IS NULL THEN CONTINUE; END IF;
    -- build 236 #H1: push body 피싱 본문 주입 방지 — 제어문자 제거 + 24자 truncate.
    v_safe_name := regexp_replace(LEFT(v_chaser_name, 24), '[[:cntrl:]]', '', 'g');

    INSERT INTO push_send_log (user_id, category, title, body, payload, status)
    VALUES (v_rec.recipient_id, 'world_chase',
      public.push_text(v_rec.recipient_id,
        '🏃 ' || v_rec.course_name || ' 추격 중!',
        '🏃 Someone''s chasing you on ' || v_rec.course_name || '!'),
      public.push_text(v_rec.recipient_id,
        v_safe_name || '님이 ' || ROUND(v_rec.gap_km, 1)::text || 'km 뒤에서 따라오고 있어요!',
        v_safe_name || ' is just ' || ROUND(v_rec.gap_km, 1)::text || 'km behind you!'),
      jsonb_build_object('course_id', v_rec.course_id::text, 'chaser_id', v_rec.chaser_id::text,
        'recipient_km', v_rec.recipient_km, 'chaser_km', v_rec.chaser_km, 'gap_km', v_rec.gap_km,
        'deep_link', 'routinist://world/course?id=' || v_rec.course_id::text), 'pending');
    v_enqueued := v_enqueued + 1;
  END LOOP;
  RETURN v_enqueued;
END;
$function$;

-- 3-6. enqueue_club_course_pushes (클럽 코스 시작/완주 push)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · 단일 v_title/v_body 를 ko/en 쌍으로 분리하고 INSERT 에서 push_text() 로 수신자별 분기
--   · 이벤트 분기 / 멤버 대상 쿼리 / enabled·opt-out 필터 로직 변경 없음
CREATE OR REPLACE FUNCTION public.enqueue_club_course_pushes(p_club_id uuid, p_course_id uuid, p_event text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_name TEXT;
  v_course_name TEXT;
  v_count INTEGER := 0;
  v_title_ko TEXT;
  v_body_ko TEXT;
  v_title_en TEXT;
  v_body_en TEXT;
  r RECORD;
BEGIN
  SELECT name INTO v_club_name FROM public.clubs WHERE id = p_club_id;
  SELECT name INTO v_course_name FROM public.virtual_courses WHERE id = p_course_id;
  IF v_club_name IS NULL OR v_course_name IS NULL THEN RETURN 0; END IF;

  IF p_event = 'start' THEN
    v_title_ko := '🏁 클럽 도전 시작!';
    v_body_ko := v_club_name || ' · ' || v_course_name || ' 함께 달려봐요';
    v_title_en := '🏁 Club challenge started!';
    v_body_en := v_club_name || ' · ' || v_course_name || ' — let''s run it together';
  ELSIF p_event = 'complete' THEN
    v_title_ko := '🏆 클럽 코스 완주!';
    v_body_ko := v_club_name || ' · ' || v_course_name || ' 모두 함께 해낸 결과';
    v_title_en := '🏆 Club course complete!';
    v_body_en := v_club_name || ' · ' || v_course_name || ' — you did it together';
  ELSE
    RETURN 0;
  END IF;

  FOR r IN
    SELECT dt.user_id, dt.id AS device_token_id
    FROM public.club_members cm
    JOIN public.push_device_tokens dt ON dt.user_id = cm.user_id
    WHERE cm.club_id = p_club_id AND cm.user_id IS NOT NULL
      AND dt.enabled = true
      AND public.should_send_push(cm.user_id, 'club_course_' || p_event)
  LOOP
    INSERT INTO public.push_send_log (user_id, device_token_id, category, title, body, payload, status)
    VALUES (
      r.user_id, r.device_token_id, 'club_course_' || p_event,
      public.push_text(r.user_id, v_title_ko, v_title_en),
      public.push_text(r.user_id, v_body_ko, v_body_en),
      jsonb_build_object('club_id', p_club_id, 'course_id', p_course_id, 'route', '/social/clubs/detail?id=' || p_club_id::text),
      'pending'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- 3-7. enqueue_contest_finish_pushes (친선런 마감 push)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · title 을 push_text() 로 ko/en 이중화 (body 는 대회명+날짜 데이터라 그대로)
--   · 참가자 대상 쿼리 / enabled·opt-out 필터 로직 변경 없음
CREATE OR REPLACE FUNCTION public.enqueue_contest_finish_pushes(p_contest_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_title TEXT;
  v_date DATE;
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  SELECT title, contest_date INTO v_title, v_date
  FROM public.daily_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR r IN
    SELECT dt.user_id, dt.id AS device_token_id
    FROM public.daily_contest_participants p
    JOIN public.push_device_tokens dt ON dt.user_id = p.user_id
    WHERE p.contest_id = p_contest_id
      AND dt.enabled = true
      AND public.should_send_push(p.user_id, 'contest_finish')
  LOOP
    INSERT INTO public.push_send_log (user_id, device_token_id, category, title, body, payload, status)
    VALUES (
      r.user_id, r.device_token_id, 'contest_finish',
      public.push_text(r.user_id,
        '친선런 마감! 📸 함께한 사진을 남겨보세요',
        'Friendly run finished! 📸 Share a photo from today'),
      v_title || ' · ' || v_date,
      jsonb_build_object('contest_id', p_contest_id, 'route', '/ranking?tab=contest'),
      'pending'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- 3-8. gift_mileage (마일리지 선물 — push 부분만)
-- prod 정의 기준 (2026-07-07 조회, build 290 sender 가드 포함 최신본), 변경점:
--   · push title/body 만 push_text() 로 ko/en 이중화
--   · sender 위조 차단 / 잔액 검증 / 트랜잭션 기록 / opt-out 체크 로직 변경 없음
--     (RAISE EXCEPTION 문구는 개발자용 에러라 ko 유지)
CREATE OR REPLACE FUNCTION public.gift_mileage(p_sender_id uuid, p_receiver_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender_balance INT;
  v_receiver_balance INT;
  v_send_tx_id UUID;
  v_sender_name TEXT;
BEGIN
  -- build 290: sender 위조 차단. 클라이언트는 본인 uid 만 sender 로 쓸 수 있다.
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR p_sender_id <> auth.uid()) THEN
    RAISE EXCEPTION '본인 계정에서만 선물할 수 있습니다';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '선물 금액은 1 이상이어야 합니다 (입력값: %)', p_amount;
  END IF;

  UPDATE profiles SET mileage_balance = mileage_balance - p_amount
  WHERE id = p_sender_id AND mileage_balance >= p_amount
  RETURNING mileage_balance INTO v_sender_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient mileage balance'; END IF;
  v_send_tx_id := gen_random_uuid();
  INSERT INTO mileage_transactions (id, user_id, amount, balance_after, tx_type, reference_id)
  VALUES (v_send_tx_id, p_sender_id, -p_amount, v_sender_balance, 'gift_send', p_receiver_id);
  UPDATE profiles SET mileage_balance = mileage_balance + p_amount WHERE id = p_receiver_id
    RETURNING mileage_balance INTO v_receiver_balance;
  INSERT INTO mileage_transactions (user_id, amount, balance_after, tx_type, reference_id)
  VALUES (p_receiver_id, p_amount, v_receiver_balance, 'gift_receive', v_send_tx_id);

  IF p_sender_id <> p_receiver_id AND public.should_send_push(p_receiver_id, 'mileage_gift') THEN
    SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = p_sender_id;
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      p_receiver_id, 'mileage_gift',
      public.push_text(p_receiver_id,
        '🎁 마일리지 선물이 도착했어요',
        '🎁 A mileage gift has arrived'),
      public.push_text(p_receiver_id,
        COALESCE(v_sender_name, '러너') || '님이 ' || p_amount::text || 'P 를 선물했어요',
        COALESCE(v_sender_name, 'A runner') || ' sent you ' || p_amount::text || 'P as a gift'),
      jsonb_build_object('sender_id', p_sender_id::text, 'amount', p_amount, 'tx_id', v_send_tx_id::text),
      'pending'
    );
  END IF;
END;
$function$;

-- 3-9. notify_rival_on_activity (페이스메이커 활동 push 트리거)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · title/body/이름 fallback 을 push_text() 로 ko/en 이중화
--   · visibility·0.5km 게이트 / 월 매칭 조회 / opt-out 체크 로직 변경 없음
--   · 주의: prod 원문은 search_path 가 'public' 단독 (pg_temp 없음) — 그대로 유지
CREATE OR REPLACE FUNCTION public.notify_rival_on_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month text;
  v_rival_id uuid;
  v_actor_name text;
BEGIN
  IF NEW.visibility <> 'public' OR NEW.distance_km < 0.5 THEN
    RETURN NEW;
  END IF;

  v_month := to_char((NEW.activity_date)::date, 'YYYY-MM');

  SELECT opponent_id INTO v_rival_id FROM monthly_rivals
  WHERE user_id = NEW.user_id AND month = v_month
  LIMIT 1;
  IF v_rival_id IS NULL THEN RETURN NEW; END IF;

  IF NOT should_send_push(v_rival_id, 'social_rival') THEN RETURN NEW; END IF;

  SELECT display_name INTO v_actor_name FROM profiles WHERE id = NEW.user_id;
  IF v_actor_name IS NULL THEN
    v_actor_name := public.push_text(v_rival_id, '페이스메이커', 'Your pacemaker');
  END IF;

  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_rival_id,
    'social_rival',
    public.push_text(v_rival_id,
      '⚔️ 페이스메이커가 뛰었어요',
      '⚔️ Your pacemaker just ran'),
    public.push_text(v_rival_id,
      v_actor_name || '님이 ' || ROUND(NEW.distance_km::numeric, 1) || 'km 뛰었어요. 따라잡아볼까요?',
      v_actor_name || ' ran ' || ROUND(NEW.distance_km::numeric, 1) || 'km. Time to catch up?'),
    jsonb_build_object('kind', 'rival_activity', 'rival_id', NEW.user_id, 'distance_km', NEW.distance_km),
    'pending'
  );
  RETURN NEW;
END;
$function$;

-- 3-10. finalize_monthly_rival_winner (월말 승자 정산 — user_notifications preview 가 push body 로 흘러감)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · 승리 알림 preview 를 push_text() 로 ko/en 이중화
--     (kind='cheer' 알림은 tg_user_notification_push 가 preview 를 push body 로 그대로 사용)
--   · 페어 조회 / 0.5km 무승부 / award_mileage 정산 로직 변경 없음
--   · 주의: prod 원문은 search_path 가 'public' 단독 — 그대로 유지. ACL 은 service_role 전용 (build 290) — CREATE OR REPLACE 는 ACL 보존
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
    SELECT COALESCE(SUM(distance_km), 0) INTO v_my_km FROM activities
      WHERE user_id = v_rec.user_id AND activity_date >= v_month_start AND activity_date < v_month_end;
    SELECT COALESCE(SUM(distance_km), 0) INTO v_rival_km FROM activities
      WHERE user_id = v_rec.opponent_id AND activity_date >= v_month_start AND activity_date < v_month_end;

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

-- 3-11. tg_user_notification_push (소셜 알림 → push 큐잉 — 응원/댓글/친구신청 최대 볼륨 경로)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · title/body/actor fallback 을 push_text() 로 ko/en 이중화
--     (cheer/comment body 의 preview 는 사용자 생성 콘텐츠라 그대로, fallback 문구만 이중화)
--   · 카테고리 매핑 / opt-out 체크 / payload 로직 변경 없음
--   · 주의: prod 원문은 search_path 가 'public' 단독 — 그대로 유지
CREATE OR REPLACE FUNCTION public.tg_user_notification_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_name text;
  push_category text;
  push_title text;
  push_body text;
BEGIN
  -- 카테고리 결정 — should_send_push 가 profiles.push_settings 의 boolean 체크
  push_category := CASE NEW.kind
    WHEN 'cheer' THEN 'social_cheer'
    WHEN 'photo_comment' THEN 'social_comment'
    WHEN 'activity_comment' THEN 'social_comment'
    WHEN 'follow' THEN 'social_follow'
    WHEN 'friend_request' THEN 'social_friend'
    WHEN 'friend_accepted' THEN 'social_friend'
    ELSE NULL
  END;
  IF push_category IS NULL THEN RETURN NEW; END IF;

  -- 사용자 push 설정 체크 (false 면 큐잉 skip). 기본 TRUE.
  IF NOT should_send_push(NEW.user_id, push_category) THEN
    RETURN NEW;
  END IF;

  -- actor 이름 (NULL 가능)
  IF NEW.actor_id IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM profiles WHERE id = NEW.actor_id;
  END IF;
  IF actor_name IS NULL OR length(actor_name) = 0 THEN
    actor_name := public.push_text(NEW.user_id, '러너', 'A runner');
  END IF;

  -- title / body
  push_title := CASE NEW.kind
    WHEN 'cheer' THEN public.push_text(NEW.user_id,
      actor_name || '님의 응원', actor_name || ' cheered you on')
    WHEN 'photo_comment' THEN public.push_text(NEW.user_id,
      actor_name || '님의 댓글', actor_name || ' left a comment')
    WHEN 'activity_comment' THEN public.push_text(NEW.user_id,
      actor_name || '님의 댓글', actor_name || ' left a comment')
    WHEN 'follow' THEN public.push_text(NEW.user_id,
      actor_name || '님이 친구로 추가했어요', actor_name || ' added you as a friend')
    WHEN 'friend_request' THEN public.push_text(NEW.user_id,
      actor_name || '님의 친구 신청', actor_name || ' sent you a friend request')
    WHEN 'friend_accepted' THEN public.push_text(NEW.user_id,
      actor_name || '님이 친구 신청을 수락했어요', actor_name || ' accepted your friend request')
  END;

  push_body := CASE NEW.kind
    WHEN 'cheer' THEN COALESCE(NEW.preview, '🔥')
    WHEN 'photo_comment' THEN COALESCE(NEW.preview, '')
    WHEN 'activity_comment' THEN COALESCE(NEW.preview, '')
    WHEN 'follow' THEN public.push_text(NEW.user_id,
      '프로필을 확인해보세요', 'Check out their profile')
    WHEN 'friend_request' THEN COALESCE(NEW.preview,
      public.push_text(NEW.user_id, '수락 또는 거절을 선택해주세요', 'Accept or decline the request'))
    WHEN 'friend_accepted' THEN public.push_text(NEW.user_id,
      '이제 함께 운동을 응원할 수 있어요', 'Now you can cheer each other''s runs')
  END;

  -- enqueue. 실제 발송은 별도 cron / edge function 에서 status='pending' row 처리.
  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    NEW.user_id,
    push_category,
    push_title,
    push_body,
    jsonb_build_object(
      'kind', NEW.kind,
      'notification_id', NEW.id,
      'source_id', NEW.source_id,
      'actor_id', NEW.actor_id
    ),
    'pending'
  );
  RETURN NEW;
END;
$function$;

-- (참고) notify_on_cheer / notify_on_friend_request / notify_on_friend_accepted /
-- notify_on_activity_comment / notify_on_photo_comment 는 user_notifications 에
-- kind + preview(사용자 콘텐츠/이모지/NULL)만 저장하고 한국어 카피가 없음 — 변경 불필요.
-- 사용자 노출 카피는 전부 tg_user_notification_push (3-11) 에서 생성됨.

-- 3-12. enqueue_friend_pb_pushes (친구 PB push 트리거)
-- prod 정의 기준 (2026-07-07 조회), 변경점:
--   · [P2] should_send_push(friend_id, 'friend_pb') 체크 추가 — 유일하게 opt-out 미체크였던 push 생성부
--   · title/body 를 push_text() 로 ko/en 이중화 (거리 라벨 풀/하프 → Full/Half en 변형 추가)
--   · PB 판정 / 닉네임 sanitize / 24h dedup 로직 변경 없음
CREATE OR REPLACE FUNCTION public.enqueue_friend_pb_pushes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner_name TEXT;
  v_safe_name TEXT;
  v_dist_label TEXT;
  v_dist_label_en TEXT;
  v_time_label TEXT;
  v_friend RECORD;
  v_prev_seconds INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.best_seconds >= OLD.best_seconds THEN RETURN NEW; END IF;
    v_prev_seconds := OLD.best_seconds;
  ELSE
    v_prev_seconds := NULL;
  END IF;

  SELECT display_name INTO v_owner_name FROM public.profiles WHERE id = NEW.user_id;
  IF v_owner_name IS NULL THEN RETURN NEW; END IF;
  -- build 236 #H1: 닉네임 sanitize
  v_safe_name := regexp_replace(LEFT(v_owner_name, 24), '[[:cntrl:]]', '', 'g');

  v_dist_label := CASE
    WHEN NEW.distance_meters = 42195 THEN '풀'
    WHEN NEW.distance_meters = 21097 THEN '하프'
    WHEN NEW.distance_meters >= 1000 THEN (NEW.distance_meters / 1000) || 'km'
    ELSE NEW.distance_meters || 'm'
  END;
  v_dist_label_en := CASE
    WHEN NEW.distance_meters = 42195 THEN 'Full marathon'
    WHEN NEW.distance_meters = 21097 THEN 'Half marathon'
    WHEN NEW.distance_meters >= 1000 THEN (NEW.distance_meters / 1000) || 'km'
    ELSE NEW.distance_meters || 'm'
  END;
  v_time_label := CASE
    WHEN NEW.best_seconds >= 3600 THEN
      (NEW.best_seconds / 3600) || ':' || LPAD(((NEW.best_seconds % 3600) / 60)::TEXT, 2, '0') || ':' || LPAD((NEW.best_seconds % 60)::TEXT, 2, '0')
    ELSE
      (NEW.best_seconds / 60) || ':' || LPAD((NEW.best_seconds % 60)::TEXT, 2, '0')
  END;

  FOR v_friend IN SELECT f.follower_id AS friend_id FROM public.follows f WHERE f.following_id = NEW.user_id
  LOOP
    -- build 291 [P2]: friend_pb 도 사용자 push 설정 존중 (기존엔 유일하게 opt-out 미체크)
    IF public.should_send_push(v_friend.friend_id, 'friend_pb')
       AND NOT EXISTS (SELECT 1 FROM public.push_send_log WHERE user_id = v_friend.friend_id AND category = 'friend_pb'
        AND (payload->>'pb_user_id') = NEW.user_id::text AND (payload->>'distance_meters') = NEW.distance_meters::text
        AND created_at > NOW() - INTERVAL '24 hours') THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (v_friend.friend_id, 'friend_pb',
        public.push_text(v_friend.friend_id, '🎉 친구 PB 갱신!', '🎉 Your friend set a new PB!'),
        public.push_text(v_friend.friend_id,
          v_safe_name || '님이 ' || v_dist_label || ' ' || v_time_label || ' PB 달성',
          v_safe_name || ' set a ' || v_dist_label_en || ' PB — ' || v_time_label),
        jsonb_build_object('pb_user_id', NEW.user_id::text, 'distance_meters', NEW.distance_meters,
          'new_seconds', NEW.best_seconds, 'prev_seconds', v_prev_seconds, 'activity_id', NEW.activity_id),
        'pending');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- 4. 데드맨 알람 RPC — push 파이프라인 헬스 집계
-- ============================================================
-- 발사 실패가 조용히 지속되는 회귀 (build 270 "14일 0건" 재발) 를 조기 감지.
-- alarm = 최근 24h 신규 생성 > 0 인데 sent 0건 → 발송기 죽음 의심.
-- 호출은 메인 세션이 cron route 로 연결 (service_role 전용).
CREATE OR REPLACE FUNCTION public.push_pipeline_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sent_24h BIGINT;
  v_failed_24h BIGINT;
  v_created_24h BIGINT;
  v_pending_total BIGINT;
  v_pending_due BIGINT;
  v_oldest_due_wait_min NUMERIC;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  SELECT COUNT(*) INTO v_sent_24h
    FROM public.push_send_log
   WHERE status = 'sent' AND COALESCE(sent_at, created_at) > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_failed_24h
    FROM public.push_send_log
   WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_created_24h
    FROM public.push_send_log
   WHERE created_at > NOW() - INTERVAL '24 hours';

  -- pending 잔량: due = 지금 당장 발송돼야 하는 것 (send_after null 또는 지남)
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE send_after IS NULL OR send_after <= NOW())
    INTO v_pending_total, v_pending_due
    FROM public.push_send_log
   WHERE status = 'pending';

  -- due pending 중 가장 오래 기다린 건의 대기시간 (분). 예약건은 due 시점부터 계산.
  SELECT ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - GREATEST(created_at, COALESCE(send_after, created_at))))) / 60, 1)
    INTO v_oldest_due_wait_min
    FROM public.push_send_log
   WHERE status = 'pending'
     AND (send_after IS NULL OR send_after <= NOW());

  RETURN jsonb_build_object(
    'sent_24h', v_sent_24h,
    'failed_24h', v_failed_24h,
    'created_24h', v_created_24h,
    'pending_total', v_pending_total,
    'pending_due', v_pending_due,
    'oldest_due_wait_minutes', COALESCE(v_oldest_due_wait_min, 0),
    'alarm', (v_sent_24h = 0 AND v_created_24h > 0),
    'checked_at', NOW()
  );
END $function$;

REVOKE ALL ON FUNCTION public.push_pipeline_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_pipeline_health() FROM anon;
REVOKE ALL ON FUNCTION public.push_pipeline_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_pipeline_health() TO service_role;

-- ============================================================
-- ACL 메모 (2026-07-07 prod 조회 기준 — CREATE OR REPLACE 는 기존 ACL 을 보존하므로 재선언 불필요)
--   service_role 전용: enqueue_idle_reminders, enqueue_month_end_recaps,
--                      enqueue_world_chase_pushes, _complete_course,
--                      assign_monthly_rivals, finalize_monthly_rival_winner
--   PUBLIC execute (기본): notify_course_progress, notify_rival_on_activity,
--                      tg_user_notification_push, enqueue_friend_pb_pushes (트리거),
--                      enqueue_club_course_pushes, enqueue_contest_finish_pushes,
--                      gift_mileage, should_send_push
--   신규 push_text / local_evening 은 기본 grant (PUBLIC execute) — INVOKER 라 RLS 적용,
--   내부 호출 경로 (SECURITY DEFINER 함수) 에서는 owner 권한으로 profiles 조회.
-- ============================================================
