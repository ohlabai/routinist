-- 2026-05-06: 사용자 데이터 무결성 점검 RPC
-- "내가 5/2에 달렸는데 안 보여요" 같은 신고를 직접 검증할 수 있게 월별 카운트 + 최근 활동 노출.

CREATE OR REPLACE FUNCTION public.audit_user_data(p_months INT DEFAULT 6)
RETURNS TABLE (
  month TEXT,
  run_count INTEGER,
  total_km NUMERIC,
  source_breakdown JSONB,
  last_activity_date DATE,
  last_started_at TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY INVOKER AS $$
  WITH months AS (
    SELECT to_char(date_trunc('month', NOW()) - (n || ' months')::INTERVAL, 'YYYY-MM') AS month_str,
           date_trunc('month', NOW()) - (n || ' months')::INTERVAL AS month_start,
           date_trunc('month', NOW()) - ((n - 1) || ' months')::INTERVAL AS month_end
    FROM generate_series(0, GREATEST(p_months - 1, 0)) AS n
  ),
  per_month AS (
    SELECT
      m.month_str AS month,
      COUNT(a.id)::INTEGER AS run_count,
      ROUND(COALESCE(SUM(a.distance_km), 0)::NUMERIC, 2) AS total_km,
      jsonb_object_agg(COALESCE(a.source, 'unknown'), src_count) FILTER (WHERE a.id IS NOT NULL) AS source_breakdown,
      MAX(a.activity_date) AS last_activity_date,
      MAX(a.started_at) AS last_started_at
    FROM months m
    LEFT JOIN LATERAL (
      SELECT a2.*, COUNT(*) OVER (PARTITION BY a2.source) AS src_count
        FROM public.activities a2
       WHERE a2.user_id = auth.uid()
         AND a2.activity_date >= m.month_start::DATE
         AND a2.activity_date < m.month_end::DATE
    ) a ON TRUE
    GROUP BY m.month_str
  )
  SELECT month, run_count, total_km, source_breakdown, last_activity_date, last_started_at
    FROM per_month
   ORDER BY month DESC;
$$;

REVOKE ALL ON FUNCTION public.audit_user_data(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_user_data(INT) TO authenticated;
