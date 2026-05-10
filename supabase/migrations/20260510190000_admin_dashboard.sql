-- 어드민 대시보드 통계 RPC.
-- /admin 메인에서 카드 형식으로 표시할 핵심 KPI.

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_today DATE;
  v_week_start DATE;
  v_month_start DATE;
  v_result JSONB;
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '관리자만 조회 가능';
  END IF;

  v_today := (NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
  v_week_start := v_today - EXTRACT(DOW FROM v_today)::INT;
  v_month_start := date_trunc('month', v_today)::DATE;

  WITH revenue AS (
    SELECT
      COALESCE(SUM(CASE WHEN paid_at::DATE = v_today THEN total_krw END), 0) AS today_krw,
      COALESCE(SUM(CASE WHEN paid_at::DATE >= v_week_start THEN total_krw END), 0) AS week_krw,
      COALESCE(SUM(CASE WHEN paid_at::DATE >= v_month_start THEN total_krw END), 0) AS month_krw,
      COALESCE(SUM(total_krw), 0) AS all_time_krw
    FROM public.orders
    WHERE status IN ('paid', 'shipped', 'delivered') AND paid_at IS NOT NULL
  ),
  order_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE created_at::DATE = v_today) AS today,
      COUNT(*) FILTER (WHERE created_at::DATE >= v_week_start) AS week,
      COUNT(*) FILTER (WHERE created_at::DATE >= v_month_start) AS month,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'paid') AS paid_unfulfilled,
      COUNT(*) FILTER (WHERE status = 'shipped') AS shipped_unfulfilled
    FROM public.orders
  ),
  users AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE created_at::DATE = v_today) AS new_today,
      COUNT(*) FILTER (WHERE created_at::DATE >= v_week_start) AS new_week
    FROM auth.users
  ),
  products_kpi AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'published') AS published,
      COUNT(*) FILTER (WHERE status = 'draft') AS draft,
      COUNT(*) FILTER (WHERE stock <= 0 AND status = 'published') AS out_of_stock,
      COUNT(*) FILTER (WHERE stock > 0 AND stock <= 5 AND status = 'published') AS low_stock
    FROM public.products
  ),
  daily_revenue AS (
    SELECT json_agg(d ORDER BY day) AS series
    FROM (
      SELECT
        gs::DATE AS day,
        COALESCE(SUM(o.total_krw), 0) AS krw
      FROM generate_series(v_today - INTERVAL '13 days', v_today, '1 day') gs
      LEFT JOIN public.orders o
        ON o.paid_at::DATE = gs::DATE AND o.status IN ('paid', 'shipped', 'delivered')
      GROUP BY gs::DATE
    ) d
  )
  SELECT jsonb_build_object(
    'revenue', jsonb_build_object(
      'today', revenue.today_krw,
      'week', revenue.week_krw,
      'month', revenue.month_krw,
      'all_time', revenue.all_time_krw
    ),
    'orders', jsonb_build_object(
      'today', order_counts.today,
      'week', order_counts.week,
      'month', order_counts.month,
      'pending', order_counts.pending,
      'paid_unfulfilled', order_counts.paid_unfulfilled,
      'shipped_unfulfilled', order_counts.shipped_unfulfilled
    ),
    'users', jsonb_build_object(
      'total', users.total,
      'new_today', users.new_today,
      'new_week', users.new_week
    ),
    'products', jsonb_build_object(
      'published', products_kpi.published,
      'draft', products_kpi.draft,
      'out_of_stock', products_kpi.out_of_stock,
      'low_stock', products_kpi.low_stock
    ),
    'daily_revenue_14d', daily_revenue.series
  ) INTO v_result
  FROM revenue, order_counts, users, products_kpi, daily_revenue;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
