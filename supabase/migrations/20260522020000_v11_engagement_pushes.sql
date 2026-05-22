-- build 167 (v1.1) — 인게이지먼트 강화 3종 (이탈 리마인더 / 월말 정산 / Run of the Day).
-- enqueue_* 패턴: push_send_log 에 pending row 넣고 별도 worker 가 APN 발송.
-- pick_run_of_the_day: 매일 1회 어제 활동 상위 5% 1건 선정 → run_of_the_day 테이블 upsert.

-- ============================================================
-- 1) 이탈 리마인더 — 마지막 활동 3일 경과 + 해당월 활동 0건 사용자에게 1회 친근 푸시
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_idle_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_msgs TEXT[] := ARRAY[
    '오늘도 신발 끈만 묶어볼까요?',
    '강남구의 김러너가 당신을 제쳤어요! 따라잡으러 갈까요?',
    '딱 1km만 달려도 기분이 달라져요 ✨',
    '루틴은 천천히, 그러나 꾸준히. 한 발만 떼봐요',
    '오랜만이에요! 어제의 나를 이겨봐요 🏃'
  ];
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  -- 푸시 등록된 사용자 중:
  --  - 가장 최근 activity 가 3일 이상 전 (또는 activity 자체 없음)
  --  - 최근 7일 안에 idle_reminder 푸시 받은 적 없음
  --  - 푸시 enabled = true
  FOR v_row IN
    SELECT DISTINCT pd.user_id,
           COALESCE(MAX(a.created_at), 'epoch'::timestamptz) AS last_act
      FROM public.push_devices pd
      LEFT JOIN public.activities a ON a.user_id = pd.user_id
     WHERE pd.enabled = true
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
END $$;
REVOKE ALL ON FUNCTION public.enqueue_idle_reminders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_idle_reminders() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_idle_reminders() TO service_role;

-- ============================================================
-- 2) 월말 정산 — 매월 마지막날 KST 발송. 이달 km > 0 인 사용자에게.
--    body: "5월 정산 — 127.9km / 14일 / 베스트 4'52" / 신기록 1건!"
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_month_end_recaps()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
      JOIN public.push_devices pd ON pd.user_id = a.user_id AND pd.enabled = true
     WHERE a.activity_date >= v_month_start
       AND a.activity_date <= v_month_end
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
END $$;
REVOKE ALL ON FUNCTION public.enqueue_month_end_recaps() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_month_end_recaps() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_month_end_recaps() TO service_role;

-- ============================================================
-- 3) Run of the Day — 매일 1회 어제 활동 중 상위 1건 선정.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.run_of_the_day (
  pick_date DATE PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  distance_km NUMERIC(10,2) NOT NULL,
  pace_avg_sec_per_km INTEGER,
  region_label TEXT,
  score NUMERIC(10,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_of_the_day_user ON public.run_of_the_day(user_id);

ALTER TABLE public.run_of_the_day ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_of_the_day_read_all ON public.run_of_the_day;
CREATE POLICY run_of_the_day_read_all ON public.run_of_the_day
  FOR SELECT USING (true);

-- 어제(KST) 활동 중 종합 점수 상위 1건 선정.
-- 점수: distance_km * 0.5 + (1000 / pace_avg_sec_per_km) * 0.5
--   → 거리와 페이스(낮을수록 좋음) 의 균형. 둘 다 가중치 50%.
CREATE OR REPLACE FUNCTION public.pick_run_of_the_day()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
         COALESCE(p.region_display, p.region_district, ''),
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
END $$;
REVOKE ALL ON FUNCTION public.pick_run_of_the_day() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_run_of_the_day() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_run_of_the_day() TO service_role;

-- 홈에서 최신 Run of the Day 1건 가져오기 (오늘 또는 어제까지).
CREATE OR REPLACE FUNCTION public.latest_run_of_the_day()
RETURNS TABLE (
  pick_date DATE,
  activity_id UUID,
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  distance_km NUMERIC,
  pace_avg_sec_per_km INTEGER,
  region_label TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
  SELECT pick_date, activity_id, user_id, display_name, avatar_url,
         distance_km, pace_avg_sec_per_km, region_label
    FROM public.run_of_the_day
   ORDER BY pick_date DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.latest_run_of_the_day() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.latest_run_of_the_day() TO anon, authenticated, service_role;
