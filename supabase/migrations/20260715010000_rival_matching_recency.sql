-- 2026-07-15: 이달의 페이스메이커 매칭에 최근성 필터.
--
-- 기존: 전월 달력 누적 km > 0 이면 풀에 포함 — Apple Health 일괄 import 후 떠난 유저,
-- 지난달까지만 달린 유저가 매칭돼 "0.0km 유령 페이스메이커" 가 속출 (2026-07: 10쌍 중 8쌍).
-- 유령 상대는 동기부여 0 + 월말 500P 무혈 지급 문제까지.
--
-- 변경: 풀 = 최근 28일 (KST rolling) km > 0 **AND** 최근 14일 내 활동 1회 이상.
-- 거리 유사 매칭 (km 정렬 후 인접 페어링) 은 그대로 — 기준 거리만 "요즘 달리는 양" 으로.

CREATE OR REPLACE FUNCTION public.assign_monthly_rivals(p_month text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month text;
  v_today date := (NOW() AT TIME ZONE 'Asia/Seoul')::date;
  v_paired integer := 0;
BEGIN
  -- month 기본값: 오늘 KST 의 YYYY-MM
  v_month := COALESCE(p_month, to_char(v_today, 'YYYY-MM'));

  -- 풀: 최근 28일 러닝량 (rolling) + 최근 14일 내 활동 (유령 차단).
  -- km 정렬 후 인접 페어링 → 비슷한 거리끼리 매칭. 이미 같은 달 매칭된 user 제외.
  WITH recent AS (
    SELECT user_id, SUM(distance_km) AS km
    FROM activities
    WHERE activity_date >= v_today - 27
      AND COALESCE(activity_type, 'running') = 'running'
    GROUP BY user_id
    HAVING SUM(distance_km) > 0
       AND MAX(activity_date) >= v_today - 13
  ),
  active AS (
    SELECT r.user_id, r.km
    FROM recent r
    WHERE r.user_id NOT IN (SELECT user_id FROM monthly_rivals WHERE month = v_month)
    ORDER BY r.km DESC, random()
  ),
  ordered AS (
    SELECT user_id, km, ROW_NUMBER() OVER () AS rn FROM active
  )
  INSERT INTO monthly_rivals (user_id, opponent_id, month)
  SELECT
    a.user_id, b.user_id, v_month
  FROM ordered a
  JOIN ordered b ON b.rn = a.rn + 1
  WHERE a.rn % 2 = 1  -- 홀수 행만 (1-2, 3-4, 5-6 페어)
  ON CONFLICT (user_id, month) DO NOTHING;

  GET DIAGNOSTICS v_paired = ROW_COUNT;

  -- 양방향 row 추가 (A→B 이미 INSERT, B→A 도 INSERT 해서 둘 다 SELECT 시 본인 row 잡힘).
  INSERT INTO monthly_rivals (user_id, opponent_id, month)
  SELECT opponent_id, user_id, month
  FROM monthly_rivals
  WHERE month = v_month
    AND NOT EXISTS (
      SELECT 1 FROM monthly_rivals m2
      WHERE m2.month = v_month
        AND m2.user_id = monthly_rivals.opponent_id
        AND m2.opponent_id = monthly_rivals.user_id
    )
  ON CONFLICT (user_id, month) DO NOTHING;

  RETURN v_paired;
END;
$function$;
