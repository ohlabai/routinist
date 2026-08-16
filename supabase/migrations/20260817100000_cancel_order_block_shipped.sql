-- 2026-08-17 리뷰: cancel_order 가 shipped(배송 중) 를 안 막고 있었다.
-- orders.status CHECK 에는 shipped 가 있는데 delivered 만 차단해, 출고된 주문을 본인이
-- 취소 → (라우트를 타면) 전액 환불 + 물건 수령 이 가능했다. 지금은 shipped 주문이 0건이라
-- 실피해 없음 — 첫 출고 전에 막는다. 라우트(api/payments/toss/cancel)도 같이 수정.

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_order RECORD;
  v_item RECORD;
  v_balance_after INTEGER;
  v_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '주문을 찾을 수 없습니다';
  END IF;

  -- service_role (webhook/cron) 또는 shop admin 또는 본인
  v_is_admin := public.is_shop_admin() OR auth.role() = 'service_role';
  IF v_user_id IS DISTINCT FROM v_order.user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF v_order.status IN ('cancelled', 'refunded') THEN
    RETURN true;
  END IF;

  IF v_order.status IN ('shipped','delivered') AND NOT v_is_admin THEN
    RAISE EXCEPTION '%', CASE WHEN v_order.status = 'shipped' THEN '이미 출고된 주문이에요. 반품 신청으로 진행해주세요.' ELSE '배송 완료된 주문은 반품 신청을 통해서만 처리됩니다' END;
  END IF;

  -- 결제 후라면 재고 복구 + 마일리지 환원
  IF v_order.status IN ('paid', 'shipped', 'delivered') THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE public.shop_product_variants
           SET stock = stock + v_item.quantity
         WHERE id = v_item.variant_id;
      ELSE
        UPDATE public.products
           SET stock = stock + v_item.quantity
         WHERE id = v_item.product_id;
      END IF;
    END LOOP;

    IF v_order.mileage_used > 0 THEN
      UPDATE public.profiles
         SET mileage_balance = mileage_balance + v_order.mileage_used
       WHERE id = v_order.user_id
       RETURNING mileage_balance INTO v_balance_after;
      INSERT INTO public.mileage_transactions
        (user_id, amount, balance_after, tx_type, event_type, description, metadata)
      VALUES
        (v_order.user_id, v_order.mileage_used, v_balance_after, 'refund', 'order_refund',
         '주문 취소 환원 — ' || v_order.order_no,
         jsonb_build_object('order_id', p_order_id, 'order_no', v_order.order_no));
    END IF;
  END IF;

  UPDATE public.orders
     SET status = CASE WHEN v_order.status = 'pending' THEN 'cancelled' ELSE 'refunded' END,
         cancelled_at = NOW(),
         cancelled_reason = p_reason
   WHERE id = p_order_id;

  UPDATE public.shop_payments
     SET status = 'refunded',
         refunded_amount_krw = amount_krw,
         cancelled_at = NOW()
   WHERE order_id = p_order_id AND status = 'done';

  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text DEFAULT ''::text, p_only_if_pending boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_order RECORD;
  v_item RECORD;
  v_balance_after INTEGER;
  v_is_admin BOOLEAN;
  v_earned INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '주문을 찾을 수 없습니다';
  END IF;

  -- service_role (webhook/cron) 또는 shop admin 또는 본인
  v_is_admin := public.is_shop_admin() OR auth.role() = 'service_role';
  IF v_user_id IS DISTINCT FROM v_order.user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF v_order.status IN ('cancelled', 'refunded') THEN
    RETURN true;
  END IF;

  -- build 186 #3: fail 페이지에서 호출 시 paid 상태를 잘못 환불하는 orphan 차단.
  -- p_only_if_pending=true 면 pending 외에는 no-op (이미 결제된 주문은 손대지 않음).
  IF p_only_if_pending AND v_order.status <> 'pending' THEN
    RETURN true;
  END IF;

  IF v_order.status IN ('shipped','delivered') AND NOT v_is_admin THEN
    RAISE EXCEPTION '%', CASE WHEN v_order.status = 'shipped' THEN '이미 출고된 주문이에요. 반품 신청으로 진행해주세요.' ELSE '배송 완료된 주문은 반품 신청을 통해서만 처리됩니다' END;
  END IF;

  -- 결제 후라면 재고 복구 + 마일리지 환원
  IF v_order.status IN ('paid', 'shipped', 'delivered') THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE public.shop_product_variants
           SET stock = stock + v_item.quantity
         WHERE id = v_item.variant_id;
      ELSE
        UPDATE public.products
           SET stock = stock + v_item.quantity
         WHERE id = v_item.product_id;
      END IF;
    END LOOP;

    -- (a) 사용자가 사용한 마일리지 환원
    IF v_order.mileage_used > 0 THEN
      UPDATE public.profiles
         SET mileage_balance = mileage_balance + v_order.mileage_used
       WHERE id = v_order.user_id
       RETURNING mileage_balance INTO v_balance_after;
      INSERT INTO public.mileage_transactions
        (user_id, amount, balance_after, tx_type, event_type, description, metadata)
      VALUES
        (v_order.user_id, v_order.mileage_used, v_balance_after, 'refund', 'order_refund',
         '주문 취소 환원 — ' || v_order.order_no,
         jsonb_build_object('order_id', p_order_id, 'order_no', v_order.order_no));
    END IF;

    -- (b) build 186 #1: 결제 시 적립된 1% 회수 (fraud 차단).
    -- shop_purchase 적립 transaction 의 amount 합을 회수. 잔액 음수 되지 않게 GREATEST.
    SELECT COALESCE(SUM(amount), 0)::INTEGER INTO v_earned
      FROM public.mileage_transactions
     WHERE event_type = 'shop_purchase'
       AND tx_type = 'reward'
       AND (metadata->>'order_id')::UUID = p_order_id;
    IF v_earned > 0 THEN
      UPDATE public.profiles
         SET mileage_balance = GREATEST(0, mileage_balance - v_earned)
       WHERE id = v_order.user_id
       RETURNING mileage_balance INTO v_balance_after;
      INSERT INTO public.mileage_transactions
        (user_id, amount, balance_after, tx_type, event_type, description, metadata)
      VALUES
        (v_order.user_id, -v_earned, v_balance_after, 'reward_clawback', 'order_refund',
         '환불에 따른 적립 회수 — ' || v_order.order_no,
         jsonb_build_object('order_id', p_order_id, 'order_no', v_order.order_no, 'clawback', true));
    END IF;
  END IF;

  UPDATE public.orders
     SET status = CASE WHEN v_order.status = 'pending' THEN 'cancelled' ELSE 'refunded' END,
         cancelled_at = NOW(),
         cancelled_reason = p_reason
   WHERE id = p_order_id;

  UPDATE public.shop_payments
     SET status = 'refunded',
         refunded_amount_krw = amount_krw,
         cancelled_at = NOW()
   WHERE order_id = p_order_id AND status = 'done';

  RETURN true;
END;
$function$
;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_order(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text, boolean) TO authenticated, service_role;
