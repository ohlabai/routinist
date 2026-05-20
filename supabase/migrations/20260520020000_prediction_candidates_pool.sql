-- build 152: 우승자 맞히기 후보 풀 확대
-- 회귀: 이번 주 활동자만 후보로 잡아서 주 초반에는 후보가 1~2명. 사용자: "30명이 보여야 함"
-- 해결: 후보 풀을 지난 4주(28일)~이번주 활동자로 확대. 정렬은 이번 주 km 우선, 동률 시 최근 4주 km.

CREATE OR REPLACE FUNCTION public.get_prediction_candidates(
  p_round_id uuid,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_url text,
  region_gu text,
  recent_km numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH this_week AS (
    SELECT week_of FROM public.prediction_rounds WHERE id = p_round_id
  ),
  pool AS (
    -- 후보 풀: 지난 4주 ~ 이번 주 활동자 모두
    SELECT a.user_id, SUM(a.distance_km) AS km4w
      FROM public.activities a, this_week tw
     WHERE a.activity_date BETWEEN tw.week_of - 28 AND tw.week_of + 6
     GROUP BY a.user_id
  ),
  week_only AS (
    -- 이번 주 실적 (표시용 + 1차 정렬키)
    SELECT a.user_id, SUM(a.distance_km) AS km
      FROM public.activities a, this_week tw
     WHERE a.activity_date BETWEEN tw.week_of AND tw.week_of + 6
     GROUP BY a.user_id
  )
  SELECT
    p.id,
    p.display_name,
    p.avatar_url,
    p.region_gu,
    ROUND(COALESCE(w.km, 0), 1) AS recent_km
  FROM pool po
  JOIN public.profiles p ON p.id = po.user_id
  LEFT JOIN week_only w ON w.user_id = po.user_id
  WHERE p.is_public = true OR p.id = auth.uid()
  ORDER BY COALESCE(w.km, 0) DESC, po.km4w DESC
  LIMIT p_limit;
$$;
