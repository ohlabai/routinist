-- 2026-07-12 CCSS: 홈 지역 코호트 구→시/도 완화 + Run of the Day 라이브 계산
--
-- ① region_sido_norm — profiles.region_si 가 자유 입력이라 표기가 제각각
--    ('서울특별시'/'서울', '경기'/'경기도'/'경기도 수원시'). prefix 매칭으로 짧은 표준
--    라벨('서울','경기'…)에 수렴. 미매칭(해외 등)은 TRIM 원문 그대로.
--
-- ② today_region_top — 오늘 동네 기록을 구 단위 → 시/도 단위로 (회원 수 적어 구 단위는
--    거의 항상 빈 카드). CURRENT_DATE(UTC) 가 00~09시 KST 에 어제를 가리키던 버그도
--    KST 명시로 fix. 기존 today_local_top 은 다른 호출자 없음 — 남겨두되 클라이언트는
--    today_region_top 으로 전환.
--
-- ③ weekly_rank_neighbors — 홈 "이번 주 내 주변 러너" 코호트도 구 → 시/도(정규화).
--    week_start 도 KST 기준으로 fix.
--
-- ④ latest_run_of_the_day — 기존엔 run_of_the_day 테이블(cron 20:00 KST 가 "어제" 선정)
--    을 읽어 낮 동안 항상 이틀 전 pick 이 보였음. 테이블 의존을 버리고 최근 7일 내
--    가장 최근 날짜의 최고 스코어 활동을 라이브 계산 — 오늘 달린 사람이 있으면 오늘,
--    없으면 어제 순으로 매일 갱신. visibility 는 public 만 (club 활동은 비멤버가 상세
--    진입 시 RLS 에 걸려 "활동을 찾을 수 없습니다" → 제외). cron pick 은 이력용으로 유지.

-- ① 시/도 정규화
CREATE OR REPLACE FUNCTION public.region_sido_norm(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw IS NULL OR TRIM(raw) = '' THEN NULL
    WHEN TRIM(raw) LIKE '서울%' THEN '서울'
    WHEN TRIM(raw) LIKE '부산%' THEN '부산'
    WHEN TRIM(raw) LIKE '대구%' THEN '대구'
    WHEN TRIM(raw) LIKE '인천%' THEN '인천'
    WHEN TRIM(raw) LIKE '광주%' THEN '광주'
    WHEN TRIM(raw) LIKE '대전%' THEN '대전'
    WHEN TRIM(raw) LIKE '울산%' THEN '울산'
    WHEN TRIM(raw) LIKE '세종%' THEN '세종'
    WHEN TRIM(raw) LIKE '경기%' THEN '경기'
    WHEN TRIM(raw) LIKE '강원%' THEN '강원'
    WHEN TRIM(raw) LIKE '충청북%' OR TRIM(raw) LIKE '충북%' THEN '충북'
    WHEN TRIM(raw) LIKE '충청남%' OR TRIM(raw) LIKE '충남%' THEN '충남'
    WHEN TRIM(raw) LIKE '전라북%' OR TRIM(raw) LIKE '전북%' THEN '전북'
    WHEN TRIM(raw) LIKE '전라남%' OR TRIM(raw) LIKE '전남%' THEN '전남'
    WHEN TRIM(raw) LIKE '경상북%' OR TRIM(raw) LIKE '경북%' THEN '경북'
    WHEN TRIM(raw) LIKE '경상남%' OR TRIM(raw) LIKE '경남%' THEN '경남'
    WHEN TRIM(raw) LIKE '제주%' THEN '제주'
    ELSE TRIM(raw)
  END;
$$;

REVOKE ALL ON FUNCTION public.region_sido_norm(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.region_sido_norm(TEXT) TO anon, authenticated, service_role;

-- ② 오늘 시/도 TOP N
CREATE OR REPLACE FUNCTION public.today_region_top(target_si TEXT, top_n INT DEFAULT 10)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  today_km NUMERIC,
  rank_position INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH today AS (
    SELECT a.user_id, SUM(a.distance_km) AS km
    FROM activities a
    JOIN profiles p ON p.id = a.user_id
    WHERE region_sido_norm(p.region_si) = region_sido_norm(target_si)
      AND region_sido_norm(target_si) IS NOT NULL
      AND p.is_public = true
      AND a.visibility = 'public'
      AND a.activity_date = (NOW() AT TIME ZONE 'Asia/Seoul')::DATE
    GROUP BY a.user_id
  )
  SELECT
    t.user_id,
    p.display_name,
    p.avatar_url,
    t.km,
    RANK() OVER (ORDER BY t.km DESC)::INT
  FROM today t
  JOIN profiles p ON p.id = t.user_id
  ORDER BY t.km DESC
  LIMIT top_n;
$$;

REVOKE ALL ON FUNCTION public.today_region_top(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.today_region_top(TEXT, INT) TO authenticated, service_role;

-- ③ 주간 랭킹 이웃 — 시/도 코호트
CREATE OR REPLACE FUNCTION public.weekly_rank_neighbors(target_user_id uuid, neighbor_count integer DEFAULT 3)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, region_gu text, weekly_km numeric, rank_position integer, is_me boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  u_si_norm TEXT;
  -- 월요일 기준, KST (CURRENT_DATE=UTC 는 00~09시 KST 에 어제로 밀렸음)
  week_start DATE := DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Seoul')::DATE)::DATE;
BEGIN
  SELECT region_sido_norm(region_si) INTO u_si_norm FROM profiles WHERE id = target_user_id;

  -- 코호트: 내 시/도(정규화) > 전국 폴백 (구 단위는 회원 수 적어 코호트가 항상 비었음)
  RETURN QUERY
  WITH scope_users AS (
    SELECT p.id, p.display_name, p.avatar_url, p.region_gu
    FROM profiles p
    WHERE p.is_public = true
      AND (
        (u_si_norm IS NOT NULL AND region_sido_norm(p.region_si) = u_si_norm)
        OR (u_si_norm IS NULL)
      )
  ),
  weekly AS (
    SELECT s.id, s.display_name, s.avatar_url, s.region_gu,
           COALESCE(SUM(a.distance_km), 0) AS km
    FROM scope_users s
    LEFT JOIN activities a ON a.user_id = s.id AND a.visibility = 'public'
      AND a.activity_date >= week_start
    GROUP BY s.id, s.display_name, s.avatar_url, s.region_gu
  ),
  ranked AS (
    SELECT w.*, RANK() OVER (ORDER BY km DESC, id) AS r
    FROM weekly w
  ),
  my_row AS (
    SELECT r FROM ranked WHERE id = target_user_id LIMIT 1
  )
  SELECT
    ranked.id,
    ranked.display_name,
    ranked.avatar_url,
    ranked.region_gu,
    ranked.km,
    ranked.r::INT,
    (ranked.id = target_user_id)
  FROM ranked, my_row
  WHERE ranked.r BETWEEN GREATEST(my_row.r - neighbor_count, 1) AND my_row.r + neighbor_count
  ORDER BY ranked.r;
END;
$function$;

-- ④ Run of the Day 라이브 계산 (cron 의존 제거)
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
  SELECT a.activity_date,
         a.id,
         a.user_id,
         p.display_name,
         p.avatar_url,
         a.distance_km,
         a.pace_avg_sec_per_km,
         COALESCE(NULLIF(TRIM(COALESCE(p.region_si, '') || ' ' || COALESCE(p.region_gu, '')), ''), '')
    FROM public.activities a
    JOIN public.profiles p ON p.id = a.user_id
   WHERE a.activity_date BETWEEN (NOW() AT TIME ZONE 'Asia/Seoul')::DATE - 6
                             AND (NOW() AT TIME ZONE 'Asia/Seoul')::DATE
     AND a.distance_km >= 3.0
     AND a.pace_avg_sec_per_km IS NOT NULL
     AND a.pace_avg_sec_per_km > 0
     AND COALESCE(a.activity_type, 'running') = 'running'
     AND a.visibility = 'public'
     AND COALESCE(p.is_public, true) = true
   ORDER BY a.activity_date DESC,
            (a.distance_km * 0.5 + (1000.0 / NULLIF(a.pace_avg_sec_per_km, 0)) * 0.5) DESC NULLS LAST,
            a.distance_km DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.latest_run_of_the_day() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.latest_run_of_the_day() TO anon, authenticated, service_role;
