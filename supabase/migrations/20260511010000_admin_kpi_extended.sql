-- 어드민 KPI 확장 — 카테고리별 매출, 환불률, AOV(평균 주문금액).
-- /admin 메인 페이지 하단에 추가 카드로 표시.

CREATE OR REPLACE FUNCTION public.admin_kpi_extended()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_today DATE;
  v_month_start DATE;
  v_30d_start DATE;
  v_result JSONB;
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '관리자만 조회 가능';
  END IF;

  v_today := (NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
  v_month_start := date_trunc('month', v_today)::DATE;
  v_30d_start := v_today - INTERVAL '30 days';

  WITH paid_orders AS (
    SELECT id, total_krw, status, created_at::DATE AS d
    FROM public.orders
    WHERE status IN ('paid', 'shipped', 'delivered', 'refunded')
      AND created_at >= v_30d_start
  ),
  refund_rate AS (
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE status = 'refunded')::FLOAT
        / NULLIF(COUNT(*), 0), 0) AS rate_30d,
      COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_count_30d,
      COUNT(*) AS paid_count_30d
    FROM paid_orders
  ),
  aov AS (
    SELECT
      COALESCE(AVG(total_krw) FILTER (WHERE status <> 'refunded'), 0)::INT AS avg_order_30d,
      COALESCE(MAX(total_krw) FILTER (WHERE status <> 'refunded'), 0) AS max_order_30d
    FROM paid_orders
  ),
  category_sales AS (
    SELECT json_agg(c ORDER BY krw DESC) AS series
    FROM (
      SELECT
        COALESCE(p.category, '미분류') AS category,
        COALESCE(SUM(oi.subtotal_krw), 0) AS krw,
        COUNT(DISTINCT oi.order_id) AS orders
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.status IN ('paid', 'shipped', 'delivered')
        AND o.created_at >= v_30d_start
      GROUP BY p.category
      ORDER BY krw DESC
      LIMIT 10
    ) c
  ),
  top_products AS (
    SELECT json_agg(t ORDER BY units DESC) AS series
    FROM (
      SELECT
        oi.product_name,
        SUM(oi.quantity) AS units,
        SUM(oi.subtotal_krw) AS krw
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.status IN ('paid', 'shipped', 'delivered')
        AND o.created_at >= v_30d_start
      GROUP BY oi.product_name
      ORDER BY units DESC
      LIMIT 5
    ) t
  ),
  cart_health AS (
    SELECT
      COUNT(DISTINCT user_id) AS users_with_cart,
      COUNT(*) AS total_items
    FROM public.shop_cart_items
  )
  SELECT jsonb_build_object(
    'refund', jsonb_build_object(
      'rate_30d', refund_rate.rate_30d,
      'refunded_count_30d', refund_rate.refunded_count_30d,
      'paid_count_30d', refund_rate.paid_count_30d
    ),
    'aov', jsonb_build_object(
      'avg_order_30d', aov.avg_order_30d,
      'max_order_30d', aov.max_order_30d
    ),
    'categories_30d', COALESCE(category_sales.series, '[]'::jsonb),
    'top_products_30d', COALESCE(top_products.series, '[]'::jsonb),
    'cart', jsonb_build_object(
      'users_with_cart', cart_health.users_with_cart,
      'total_items', cart_health.total_items
    )
  ) INTO v_result
  FROM refund_rate, aov, category_sales, top_products, cart_health;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_kpi_extended() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_kpi_extended() TO authenticated;
