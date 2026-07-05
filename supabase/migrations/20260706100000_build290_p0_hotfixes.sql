-- build 290: 전체 리뷰(2026-07-05) P0 핫픽스 일괄
--
-- 1. gift_mileage — sender 위조 차단 (p_sender_id = auth.uid() 검증 부재로 타인 마일리지 이체 가능했음)
-- 2. assign_monthly_rivals / finalize_monthly_rival_winner — authenticated REVOKE (월중 임의 호출로 500P 선점 가능했음)
-- 3. get_my_fitness_trend — STABLE 함수 내 CREATE TEMP TABLE 로 항상 에러 → RETURN NEXT 루프로 재작성 (코치 전면 복구)
-- 4. enqueue_idle_reminders / enqueue_month_end_recaps — 미존재 테이블 push_devices 참조로 출시 후 0건 발송
--    → push_device_tokens 로 교정 + opt-out(should_send_push) + 가짜 사용자 카피 제거
-- 5. enqueue_club_course_pushes / enqueue_contest_finish_pushes — status 'queued' 는 발송기(pending만 조회)가
--    영원히 안 집음 → 'pending' + enabled/opt-out 필터
-- 6. 월드런/클럽코스 진행률 — created_at >= started_at 합산은 Apple Health bulk import 시 부정 완주+환급 구멍
--    (build 236 #H3 에서 _auto_mark_course_complete 만 고치고 이후 함수들이 옛 패턴으로 재유입).
--    9개 함수 모두 activity_date (KST) 비교 + 러닝만 합산으로 통일.
--    activity_type 은 'running' 또는 NULL(구버전 러닝 기록)만 존재 — 걷기는 'walking' 으로 저장됨 (build 289 계약).

-- ============================================================
-- 1. gift_mileage: sender 본인 검증
-- ============================================================
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
      '🎁 마일리지 선물이 도착했어요',
      COALESCE(v_sender_name, '러너') || '님이 ' || p_amount::text || 'P 를 선물했어요',
      jsonb_build_object('sender_id', p_sender_id::text, 'amount', p_amount, 'tx_id', v_send_tx_id::text),
      'pending'
    );
  END IF;
END;
$function$;

-- ============================================================
-- 2. 페이스메이커 매칭/정산 RPC — service_role 전용
--    (REVOKE FROM PUBLIC 만으론 부족 — anon/authenticated 명시 필요)
-- ============================================================
REVOKE ALL ON FUNCTION public.assign_monthly_rivals(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_monthly_rivals(text) FROM anon;
REVOKE ALL ON FUNCTION public.assign_monthly_rivals(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_monthly_rivals(text) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_monthly_rival_winner(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_monthly_rival_winner(text) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_monthly_rival_winner(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_monthly_rival_winner(text) TO service_role;

-- ============================================================
-- 3. 러닝 코치: temp table 제거 (STABLE 유지, RETURN NEXT 누적)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_fitness_trend(p_days integer DEFAULT 90)
 RETURNS TABLE(date date, stress_score numeric, ctl numeric, atl numeric, tsb numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID;
  v_start DATE;
  v_end DATE;
  v_buffer_start DATE;
  v_ctl NUMERIC := 0;
  v_atl NUMERIC := 0;
  v_ctl_decay CONSTANT NUMERIC := 1.0 / 42.0;
  v_atl_decay CONSTANT NUMERIC := 1.0 / 7.0;
  r RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  v_end := CURRENT_DATE;
  v_start := v_end - (p_days || ' days')::INTERVAL;
  v_buffer_start := v_start - INTERVAL '60 days';  -- EWMA 안정화 buffer

  FOR r IN
    SELECT
      d::DATE AS dt,
      COALESCE((
        SELECT SUM(
          (a.distance_km::NUMERIC * 10)
          + (a.duration_seconds::NUMERIC / 60.0 * 0.5)
        )
        FROM public.activities a
        WHERE a.user_id = v_uid
          AND a.activity_date = d::DATE
          AND (a.activity_type IS NULL OR a.activity_type IN ('running', 'walking'))
      ), 0) AS stress
    FROM generate_series(v_buffer_start, v_end, '1 day'::INTERVAL) d
    ORDER BY d
  LOOP
    -- EWMA: new = prev + (stress - prev) × decay
    v_ctl := v_ctl + (r.stress - v_ctl) * v_ctl_decay;
    v_atl := v_atl + (r.stress - v_atl) * v_atl_decay;
    IF r.dt >= v_start THEN
      date := r.dt;
      stress_score := r.stress;
      ctl := ROUND(v_ctl, 2);
      atl := ROUND(v_atl, 2);
      tsb := ROUND(v_ctl - v_atl, 2);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- ============================================================
-- 4. 이탈 리마인더 / 월말 정산 push — 테이블명 교정 + opt-out
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_idle_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_msgs TEXT[] := ARRAY[
    '오늘도 신발 끈만 묶어볼까요?',
    '딱 1km만 달려도 기분이 달라져요 ✨',
    '루틴은 천천히, 그러나 꾸준히. 한 발만 떼봐요',
    '오랜만이에요! 어제의 나를 이겨봐요 🏃'
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
    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'idle_reminder',
       '🏃 오늘 한 번 달려볼까요?',
       v_msgs[1 + floor(random() * array_length(v_msgs, 1))::int],
       jsonb_build_object('deep_link', '/'),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  -- KST 기준 이번 달의 시작/끝
  v_month_start := date_trunc('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::DATE;
  v_month_end := (v_month_start + INTERVAL '1 month - 1 day')::DATE;
  v_month_label := to_char(v_month_start, 'MM') || '월';

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
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'month_end_recap',
       '🎉 ' || v_month_label || ' 정산이 도착했어요!',
       v_row.total_km::numeric(10,1)::text || 'km / ' || v_row.run_days || '일 달림 — 카드 보러 가기',
       jsonb_build_object(
         'deep_link', '/awards',
         'month_start', v_month_start,
         'total_km', v_row.total_km,
         'run_days', v_row.run_days,
         'run_count', v_row.run_count,
         'best_pace', v_row.best_pace
       ),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

-- ============================================================
-- 5. 클럽 코스 / 친선런 push — 'queued' → 'pending' + enabled/opt-out
-- ============================================================
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
  v_title TEXT;
  v_body TEXT;
  r RECORD;
BEGIN
  SELECT name INTO v_club_name FROM public.clubs WHERE id = p_club_id;
  SELECT name INTO v_course_name FROM public.virtual_courses WHERE id = p_course_id;
  IF v_club_name IS NULL OR v_course_name IS NULL THEN RETURN 0; END IF;

  IF p_event = 'start' THEN
    v_title := '🏁 클럽 도전 시작!';
    v_body := v_club_name || ' · ' || v_course_name || ' 함께 달려봐요';
  ELSIF p_event = 'complete' THEN
    v_title := '🏆 클럽 코스 완주!';
    v_body := v_club_name || ' · ' || v_course_name || ' 모두 함께 해낸 결과';
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
      v_title, v_body,
      jsonb_build_object('club_id', p_club_id, 'course_id', p_course_id, 'route', '/social/clubs/detail?id=' || p_club_id::text),
      'pending'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

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
      '친선런 마감! 📸 함께한 사진을 남겨보세요',
      v_title || ' · ' || v_date,
      jsonb_build_object('contest_id', p_contest_id, 'route', '/ranking?tab=contest'),
      'pending'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- ============================================================
-- 6. 코스 진행률 통일: activity_date (KST) + 러닝만
-- ============================================================

-- 6-1. fetch_my_courses (완주 자동 처리 경로 — 부정 완주+환급의 본체)
CREATE OR REPLACE FUNCTION public.fetch_my_courses()
 RETURNS TABLE(course_id uuid, name text, country text, description text, hero_image_url text, distance_km numeric, started_at timestamp with time zone, completed_at timestamp with time zone, progress_km numeric, has_medal boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  r RECORD;
  v_progress NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT
      c.id, c.name, c.country, c.description, c.hero_image_url, c.distance_km,
      ucp.started_at, ucp.completed_at
    FROM public.user_course_progress ucp
    JOIN public.virtual_courses c ON c.id = ucp.course_id
    WHERE ucp.user_id = v_user_id
    ORDER BY ucp.started_at DESC
  LOOP
    SELECT COALESCE(SUM(a.distance_km), 0) INTO v_progress
    FROM public.activities a
    WHERE a.user_id = v_user_id
      AND a.activity_date >= (r.started_at AT TIME ZONE 'Asia/Seoul')::DATE
      AND (a.activity_type IS NULL OR a.activity_type = 'running');

    -- 완주 자동 처리 — 누적 ≥ 코스 거리. _complete_course 가 환급+push 까지.
    IF r.completed_at IS NULL AND v_progress >= r.distance_km THEN
      PERFORM public._complete_course(v_user_id, r.id);
      r.completed_at := now();
    END IF;

    course_id := r.id;
    name := r.name;
    country := r.country;
    description := r.description;
    hero_image_url := r.hero_image_url;
    distance_km := r.distance_km;
    started_at := r.started_at;
    completed_at := r.completed_at;
    progress_km := v_progress;
    -- 42702 방지: course_medals 컬럼이 OUT 파라미터(user_id/course_id)와 충돌 — 반드시 alias 로 한정
    has_medal := EXISTS (SELECT 1 FROM public.course_medals md WHERE md.user_id = v_user_id AND md.course_id = r.id);
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- 6-2. notify_course_progress (50%/90% push 트리거)
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
                 THEN '🔥 ' || r.name || ' 절반 왔어요!'
                 ELSE '🏁 ' || r.name || ' 거의 다 왔어요!' END,
            v_progress::numeric(10,2) || ' / ' || r.distance_km::numeric(10,2) || ' km · '
              || '남은 거리 ' || v_remaining::numeric(10,2) || ' km',
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

-- 6-3. fetch_course_friends
CREATE OR REPLACE FUNCTION public.fetch_course_friends(p_course_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, progress_km numeric, ratio numeric, completed_at timestamp with time zone, started_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me UUID := auth.uid();
  v_course_km NUMERIC;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT distance_km INTO v_course_km FROM public.virtual_courses WHERE id = p_course_id;
  IF v_course_km IS NULL OR v_course_km <= 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH my_friends AS (
    SELECT f.following_id AS uid
      FROM public.follows f
     WHERE f.follower_id = v_me
  ),
  joined AS (
    SELECT ucp.user_id, ucp.started_at, ucp.completed_at
      FROM public.user_course_progress ucp
      JOIN my_friends mf ON mf.uid = ucp.user_id
     WHERE ucp.course_id = p_course_id
  ),
  progress AS (
    SELECT j.user_id,
           j.started_at,
           j.completed_at,
           COALESCE((
             SELECT SUM(a.distance_km)
               FROM public.activities a
              WHERE a.user_id = j.user_id
                AND a.activity_date >= (j.started_at AT TIME ZONE 'Asia/Seoul')::DATE
                AND (a.activity_type IS NULL OR a.activity_type = 'running')
           ), 0)::numeric AS progress_km
      FROM joined j
  )
  SELECT
    p.user_id,
    pr.display_name,
    pr.avatar_url,
    p.progress_km,
    LEAST(1, p.progress_km / v_course_km)::numeric AS ratio,
    p.completed_at,
    p.started_at
  FROM progress p
  JOIN public.profiles pr ON pr.id = p.user_id
  ORDER BY p.completed_at IS NULL, p.progress_km DESC
  LIMIT 10;
END $function$;

-- 6-4. fetch_course_runners
CREATE OR REPLACE FUNCTION public.fetch_course_runners(p_course_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, region_gu text, progress_km numeric, ratio numeric, completed_at timestamp with time zone, started_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE v_distance NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT distance_km INTO v_distance FROM public.virtual_courses WHERE id = p_course_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    ucp.user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    p.region_gu,
    COALESCE((
      SELECT SUM(a.distance_km) FROM public.activities a
       WHERE a.user_id = ucp.user_id
         AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
         AND (a.activity_type IS NULL OR a.activity_type = 'running')
    ), 0)::NUMERIC AS progress_km,
    LEAST(1.0, GREATEST(0.0,
      COALESCE((
        SELECT SUM(a.distance_km) FROM public.activities a
         WHERE a.user_id = ucp.user_id
           AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
           AND (a.activity_type IS NULL OR a.activity_type = 'running')
      ), 0) / NULLIF(v_distance, 0)
    ))::NUMERIC AS ratio,
    ucp.completed_at,
    ucp.started_at
  FROM public.user_course_progress ucp
  JOIN public.profiles p ON p.id = ucp.user_id
  WHERE ucp.course_id = p_course_id
    AND p.is_public = true
  ORDER BY ratio DESC NULLS LAST, ucp.started_at ASC;
END;
$function$;

-- 6-5. fetch_series_courses
CREATE OR REPLACE FUNCTION public.fetch_series_courses(p_slug text)
 RETURNS TABLE(course_id uuid, name text, country text, description text, distance_km numeric, preview_path jsonb, entry_fee_p integer, series_name text, series_emoji text, series_description text, my_started_at timestamp with time zone, my_completed_at timestamp with time zone, my_progress_km numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    vc.id,
    vc.name,
    vc.country,
    vc.description,
    vc.distance_km,
    vc.preview_path,
    vc.entry_fee_p,
    s.name,
    s.emoji,
    s.description,
    ucp.started_at,
    ucp.completed_at,
    COALESCE((
      SELECT SUM(a.distance_km)::NUMERIC(10,1) FROM public.activities a
       WHERE a.user_id = v_user_id
         AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
         AND (a.activity_type IS NULL OR a.activity_type = 'running')
    ), 0)::NUMERIC
  FROM public.virtual_courses vc
  JOIN public.course_series s ON s.id = vc.series_id
  LEFT JOIN public.user_course_progress ucp ON ucp.course_id = vc.id AND ucp.user_id = v_user_id
  WHERE s.slug = p_slug AND vc.is_active
  ORDER BY vc.sort_order;
END;
$function$;

-- 6-6. enqueue_world_chase_pushes
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
      '🏃 ' || v_rec.course_name || ' 추격 중!',
      v_safe_name || '님이 ' || ROUND(v_rec.gap_km, 1)::text || 'km 뒤에서 따라오고 있어요!',
      jsonb_build_object('course_id', v_rec.course_id::text, 'chaser_id', v_rec.chaser_id::text,
        'recipient_km', v_rec.recipient_km, 'chaser_km', v_rec.chaser_km, 'gap_km', v_rec.gap_km,
        'deep_link', 'routinist://world/course?id=' || v_rec.course_id::text), 'pending');
    v_enqueued := v_enqueued + 1;
  END LOOP;
  RETURN v_enqueued;
END;
$function$;

-- 6-7. fetch_club_courses (pooled: 클럽 합산 / individual: 멤버별 합산)
CREATE OR REPLACE FUNCTION public.fetch_club_courses(p_club_id uuid)
 RETURNS TABLE(course_id uuid, name text, country text, description text, distance_km numeric, preview_path jsonb, started_at timestamp with time zone, completed_at timestamp with time zone, total_km numeric, contributors integer, mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_user_id UUID := auth.uid();
  r RECORD;
  v_total NUMERIC;
  v_contrib INTEGER;
  v_just_completed_at TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = v_user_id) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT ccp.course_id, c.name, c.country, c.description, c.distance_km, c.preview_path,
           ccp.started_at, ccp.completed_at, ccp.mode
    FROM public.club_course_progress ccp
    JOIN public.virtual_courses c ON c.id = ccp.course_id
    WHERE ccp.club_id = p_club_id
    ORDER BY ccp.started_at DESC
  LOOP
    IF r.mode = 'pooled' THEN
      SELECT COALESCE(SUM(a.distance_km), 0), COUNT(DISTINCT a.user_id)
        INTO v_total, v_contrib
        FROM public.activities a
        JOIN public.club_members cm ON cm.user_id = a.user_id AND cm.club_id = p_club_id
       WHERE a.activity_date >= (r.started_at AT TIME ZONE 'Asia/Seoul')::DATE
         AND (a.activity_type IS NULL OR a.activity_type = 'running');

      -- build 237: race 차단 — WHERE completed_at IS NULL 가드 + RETURNING 으로 단일화.
      -- 동시 진입한 멤버 N 명 중 한 명만 UPDATE 성공 (NULL→NOW). 나머지는 RETURNING 빈값.
      v_just_completed_at := NULL;
      IF r.completed_at IS NULL AND v_total >= r.distance_km THEN
        UPDATE public.club_course_progress
           SET completed_at = NOW()
         WHERE club_id = p_club_id AND course_id = r.course_id AND completed_at IS NULL
         RETURNING completed_at INTO v_just_completed_at;
        IF v_just_completed_at IS NOT NULL THEN
          r.completed_at := v_just_completed_at;
          PERFORM public.enqueue_club_course_pushes(p_club_id, r.course_id, 'complete');
        END IF;
      END IF;
    ELSE
      SELECT
        COALESCE(SUM(
          COALESCE((
            SELECT SUM(a.distance_km) FROM public.activities a
             WHERE a.user_id = ucp.user_id
               AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
               AND (a.activity_type IS NULL OR a.activity_type = 'running')
          ), 0)
        ), 0),
        COUNT(*)
        INTO v_total, v_contrib
      FROM public.user_course_progress ucp
      JOIN public.club_members cm ON cm.user_id = ucp.user_id AND cm.club_id = p_club_id
      WHERE ucp.course_id = r.course_id;
    END IF;

    course_id := r.course_id; name := r.name; country := r.country;
    description := r.description; distance_km := r.distance_km;
    preview_path := r.preview_path; started_at := r.started_at;
    completed_at := r.completed_at; total_km := v_total;
    contributors := v_contrib; mode := r.mode;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- 6-8. fetch_club_course_individual_leaderboard
CREATE OR REPLACE FUNCTION public.fetch_club_course_individual_leaderboard(p_club_id uuid, p_course_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, progress_km numeric, ratio numeric, completed_at timestamp with time zone, started_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE v_user_id UUID := auth.uid(); v_distance NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = v_user_id) THEN
    RETURN;
  END IF;
  SELECT vc.distance_km INTO v_distance FROM public.virtual_courses vc WHERE vc.id = p_course_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    ucp.user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    COALESCE((
      SELECT SUM(a.distance_km) FROM public.activities a
       WHERE a.user_id = ucp.user_id
         AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
         AND (a.activity_type IS NULL OR a.activity_type = 'running')
    ), 0)::NUMERIC AS progress_km,
    LEAST(1.0, GREATEST(0.0,
      COALESCE((
        SELECT SUM(a.distance_km) FROM public.activities a
         WHERE a.user_id = ucp.user_id
           AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
           AND (a.activity_type IS NULL OR a.activity_type = 'running')
      ), 0) / NULLIF(v_distance, 0)
    ))::NUMERIC AS ratio,
    ucp.completed_at,
    ucp.started_at
  FROM public.user_course_progress ucp
  JOIN public.club_members cm ON cm.user_id = ucp.user_id AND cm.club_id = p_club_id
  LEFT JOIN public.profiles p ON p.id = ucp.user_id
  WHERE ucp.course_id = p_course_id
  ORDER BY ratio DESC NULLS LAST, ucp.started_at ASC
  LIMIT 50;
END;
$function$;

-- 6-9. _auto_mark_course_complete — 날짜 비교는 build 236 에서 이미 교정. 러닝 필터만 추가.
CREATE OR REPLACE FUNCTION public._auto_mark_course_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- build 236 #H3: a.created_at >= ucp.started_at 였으나 Apple Health bulk import 시 created_at = NOW 라
  -- 코스 시작 직후 import 하면 옛 활동까지 합산되어 부정 자동 완주. activity_date (KST) 로 비교.
  UPDATE user_course_progress ucp
  SET completed_at = NOW()
  FROM virtual_courses vc
  WHERE ucp.user_id = NEW.user_id
    AND ucp.completed_at IS NULL
    AND vc.id = ucp.course_id
    AND COALESCE((
      SELECT SUM(a.distance_km) FROM activities a
       WHERE a.user_id = NEW.user_id
         AND a.activity_date >= (ucp.started_at AT TIME ZONE 'Asia/Seoul')::DATE
         AND (a.activity_type IS NULL OR a.activity_type = 'running')
    ), 0) >= vc.distance_km;
  RETURN NEW;
END;
$function$;
