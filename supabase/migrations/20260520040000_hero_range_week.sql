-- build 154: 랭킹 시간축에 'week' 추가
-- 사용자: 오늘/이달/올해 3개 → 오늘/이번주/이달/올해 4개로 구분.
-- _hero_date_range 가 RPC 양쪽(find_my_rankings_breakdown, find_my_combined_ranking) 공통.

CREATE OR REPLACE FUNCTION public._hero_date_range(time_axis text)
RETURNS TABLE(start_d date, end_d date)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF time_axis = 'today' THEN
    RETURN QUERY SELECT CURRENT_DATE, CURRENT_DATE;
  ELSIF time_axis = 'week' THEN
    -- 월요일 시작 ISO week. KST 기준.
    RETURN QUERY SELECT
      (CURRENT_DATE - ((EXTRACT(ISODOW FROM CURRENT_DATE)::int - 1)))::date,
      CURRENT_DATE;
  ELSIF time_axis = 'year' THEN
    RETURN QUERY SELECT DATE_TRUNC('year', CURRENT_DATE)::date, CURRENT_DATE;
  ELSE  -- 'month' (기본)
    RETURN QUERY SELECT DATE_TRUNC('month', CURRENT_DATE)::date, CURRENT_DATE;
  END IF;
END;
$$;
