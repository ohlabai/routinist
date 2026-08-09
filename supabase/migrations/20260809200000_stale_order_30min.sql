-- 2026-08-09 리뷰 P0: stale pending 주문 자동취소 15분 → 30분.
--
-- 카드사 ARS·외부 앱 인증·전화 수신으로 15분을 넘긴 유저가 결제를 마치면, 그 사이 주문이
-- 취소돼 mark_order_paid 가 '결제 가능 상태 아님' 으로 RAISE → (confirm 라우트 수정 전엔)
-- "돈은 빠졌는데 주문·환불 없음" 이 됐다. confirm 라우트는 이제 자동 환불하지만, 애초에
-- 취소가 덜 일어나게 창을 넉넉히 준다. pending 주문은 재고를 홀드하지 않아 부작용 없음.
CREATE OR REPLACE FUNCTION public.cleanup_stale_pending_orders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;
  WITH cancelled AS (
    UPDATE public.orders
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancelled_reason = '15분 결제 미완료 자동 취소'
     WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '30 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM cancelled;
  RETURN v_count;
END $function$
;
