-- 2026-05-06: profile 통산 집계를 SQL 측으로 이전
-- 기존: 클라이언트가 activities 전체를 fetch → JS 에서 sum → profiles update (행이 많아질수록 비용 증가)
-- 신규: 단일 RPC 호출. SQL aggregation 으로 round-trip 1회.

CREATE OR REPLACE FUNCTION public.update_profile_totals(p_user_id UUID)
RETURNS TABLE (total_runs INTEGER, total_distance_km NUMERIC) AS $$
DECLARE
  v_total_runs INTEGER;
  v_total_distance NUMERIC;
BEGIN
  SELECT COUNT(*)::INTEGER, COALESCE(SUM(distance_km), 0)
    INTO v_total_runs, v_total_distance
  FROM public.activities
  WHERE user_id = p_user_id;

  UPDATE public.profiles
     SET total_runs = v_total_runs,
         total_distance_km = ROUND(v_total_distance::NUMERIC, 2),
         updated_at = NOW()
   WHERE id = p_user_id;

  RETURN QUERY SELECT v_total_runs, ROUND(v_total_distance::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 본인의 통계만 갱신 가능 (auth.uid() 가 p_user_id 와 일치할 때만)
REVOKE ALL ON FUNCTION public.update_profile_totals(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_profile_totals(UUID) TO authenticated;
