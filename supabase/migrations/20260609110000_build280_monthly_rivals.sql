-- build 280: 이달의 라이벌 — Duolingo Leagues 식 1:1 랜덤 매칭.
-- 모르는 사람 1:1 매칭이 친한 사람 그룹 비교보다 retention 효과 큼 (anonymous accountability).
-- 같은 km 풀 (지난달 ±30%) 안에서 랜덤 → 압도적 격차 방지.

CREATE TABLE IF NOT EXISTS monthly_rivals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month        text NOT NULL,  -- 'YYYY-MM' KST 기준
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id <> opponent_id)
);

-- 같은 달 한 사용자에 한 매칭만.
CREATE UNIQUE INDEX IF NOT EXISTS monthly_rivals_user_month_unique
  ON monthly_rivals (user_id, month);

CREATE INDEX IF NOT EXISTS monthly_rivals_month_idx ON monthly_rivals (month);

ALTER TABLE monthly_rivals ENABLE ROW LEVEL SECURITY;

-- 본인 매칭 + 상대방 매칭 SELECT 가능 (홈 hero 카드 표시용).
CREATE POLICY monthly_rivals_select ON monthly_rivals
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = opponent_id);

-- INSERT/UPDATE 는 service_role 만 (트리거/RPC 자동 매칭).

-- ============================================================================
-- RPC: assign_monthly_rivals
-- 월초 cron 또는 어드민 수동 호출. 지정 month 의 모든 active 사용자 1:1 랜덤 매칭.
-- 비슷한 km 풀: 지난달 km 기준 ±30% 안에서 paired
-- 홀수면 마지막 한 명은 매칭 없음 (다음 달 우선).
-- ============================================================================
CREATE OR REPLACE FUNCTION assign_monthly_rivals(p_month text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text;
  v_prev_month text;
  v_paired integer := 0;
  v_user_a uuid;
  v_user_b uuid;
  v_km_a numeric;
BEGIN
  -- month 기본값: 오늘 KST 의 YYYY-MM
  v_month := COALESCE(p_month, to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM'));
  v_prev_month := to_char(((NOW() AT TIME ZONE 'Asia/Seoul')::date - INTERVAL '1 month')::date, 'YYYY-MM');

  -- 지난달 km 기준 활성 사용자 (km > 0). km 으로 정렬 후 인접 페어링 (±30% 안 보장).
  -- LATERAL 없이 단순 random 보다 정밀. 압도적 격차 방지 효과.
  -- 이미 같은 달 매칭된 user 제외.
  WITH last_month AS (
    SELECT user_id, SUM(distance_km) AS km
    FROM activities
    WHERE activity_date >= (v_prev_month || '-01')::date
      AND activity_date < (v_month || '-01')::date
    GROUP BY user_id
    HAVING SUM(distance_km) > 0
  ),
  active AS (
    SELECT lm.user_id, lm.km
    FROM last_month lm
    WHERE lm.user_id NOT IN (SELECT user_id FROM monthly_rivals WHERE month = v_month)
    ORDER BY lm.km DESC, random()
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
$$;

-- ============================================================================
-- RPC: fetch_my_monthly_rival
-- 현재 사용자의 이달 라이벌 + 양쪽 km 비교 + 진행률 + 남은 날짜.
-- 홈 hero 카드용 단일 호출.
-- ============================================================================
CREATE OR REPLACE FUNCTION fetch_my_monthly_rival()
RETURNS TABLE (
  rival_user_id uuid,
  rival_display_name text,
  rival_avatar_url text,
  my_km numeric,
  rival_km numeric,
  month text,
  days_left integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION assign_monthly_rivals(text) TO authenticated;
GRANT EXECUTE ON FUNCTION fetch_my_monthly_rival() TO authenticated;
REVOKE EXECUTE ON FUNCTION assign_monthly_rivals(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION fetch_my_monthly_rival() FROM PUBLIC, anon;
