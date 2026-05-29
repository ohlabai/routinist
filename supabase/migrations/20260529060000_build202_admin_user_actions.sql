-- build 202: Phase B — 회원 상세 + 민감 액션 (admin).
-- audit log 통한 추적성. is_shop_admin() 권한.

-- ─── audit log 테이블 (admin 액션 추적) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  actor_email TEXT NOT NULL,
  target_user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,        -- 'send_push' / 'grant_mileage' / 'set_public' / 'delete_user' / 'block_user'
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aal_target_idx ON public.admin_action_log (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aal_actor_idx ON public.admin_action_log (actor_id, created_at DESC);

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aal_admin_read ON public.admin_action_log;
CREATE POLICY aal_admin_read ON public.admin_action_log FOR SELECT
  USING (public.is_shop_admin());

-- ─── 1) get_admin_user_detail — 한 사용자의 전체 정보 + 최근 활동/주문/마일리지 history ─
CREATE OR REPLACE FUNCTION public.get_admin_user_detail(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_actor_email TEXT;
  v_result JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;

  SELECT json_build_object(
    'profile', (SELECT row_to_json(p) FROM public.profiles p WHERE p.id = p_user_id),
    'auth_user', (SELECT json_build_object(
        'email', u.email, 'email_confirmed_at', u.email_confirmed_at,
        'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'provider', u.raw_app_meta_data->>'provider'
      ) FROM auth.users u WHERE u.id = p_user_id),
    'recent_activities', COALESCE((
      SELECT json_agg(json_build_object(
        'id', a.id, 'activity_date', a.activity_date,
        'distance_km', a.distance_km, 'duration_seconds', a.duration_seconds,
        'source', a.source, 'activity_type', a.activity_type, 'visibility', a.visibility
      ) ORDER BY a.activity_date DESC)
      FROM (SELECT * FROM public.activities WHERE user_id = p_user_id ORDER BY activity_date DESC LIMIT 30) a
    ), '[]'::json),
    'recent_orders', COALESCE((
      SELECT json_agg(json_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status,
        'total_krw', o.total_krw, 'created_at', o.created_at, 'paid_at', o.paid_at
      ) ORDER BY o.created_at DESC)
      FROM (SELECT * FROM public.orders WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 20) o
    ), '[]'::json),
    'mileage_history', COALESCE((
      SELECT json_agg(json_build_object(
        'id', mt.id, 'amount', mt.amount, 'tx_type', mt.tx_type,
        'event_type', mt.event_type, 'reason', mt.reason,
        'created_at', mt.created_at
      ) ORDER BY mt.created_at DESC)
      FROM (SELECT * FROM public.mileage_transactions WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 30) mt
    ), '[]'::json),
    'push_history', COALESCE((
      SELECT json_agg(json_build_object(
        'id', psl.id, 'category', psl.category, 'title', psl.title, 'body', psl.body,
        'status', psl.status, 'created_at', psl.created_at, 'sent_at', psl.sent_at
      ) ORDER BY psl.created_at DESC)
      FROM (SELECT * FROM public.push_send_log WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 30) psl
    ), '[]'::json),
    'admin_action_log', COALESCE((
      SELECT json_agg(json_build_object(
        'id', l.id, 'actor_email', l.actor_email, 'action', l.action,
        'reason', l.reason, 'payload', l.payload, 'created_at', l.created_at
      ) ORDER BY l.created_at DESC)
      FROM (SELECT * FROM public.admin_action_log WHERE target_user_id = p_user_id ORDER BY created_at DESC LIMIT 30) l
    ), '[]'::json),
    'personal_bests', COALESCE((
      SELECT json_agg(json_build_object(
        'distance_meters', pb.distance_meters, 'best_seconds', pb.best_seconds,
        'achieved_at', pb.achieved_at
      ) ORDER BY pb.distance_meters)
      FROM public.personal_bests pb WHERE pb.user_id = p_user_id
    ), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_admin_user_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_user_detail(UUID) TO authenticated;

-- ─── 2) admin_send_push — 특정 사용자에게 직접 푸시 발송 ────────────────
-- push_send_log 에 row INSERT — 기존 cron 또는 즉시 발송 worker 가 처리.
CREATE OR REPLACE FUNCTION public.admin_send_push(
  p_user_id UUID,
  p_title TEXT,
  p_body TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_actor UUID;
  v_actor_email TEXT;
  v_push_id UUID;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  v_actor := auth.uid();
  SELECT email::TEXT INTO v_actor_email FROM auth.users WHERE id = v_actor;

  IF length(trim(p_title)) = 0 OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'title / body 필수';
  END IF;

  INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
  VALUES (p_user_id, 'admin_manual', p_title, p_body,
          jsonb_build_object('sent_by_admin', v_actor_email),
          'pending')
  RETURNING id INTO v_push_id;

  INSERT INTO public.admin_action_log (actor_id, actor_email, target_user_id, action, reason, payload)
  VALUES (v_actor, v_actor_email, p_user_id, 'send_push', p_reason,
          jsonb_build_object('push_id', v_push_id, 'title', p_title, 'body', p_body));

  RETURN v_push_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.admin_send_push(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_push(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ─── 3) admin_grant_mileage — 마일리지 수동 지급 (양수=지급, 음수=차감) ───
CREATE OR REPLACE FUNCTION public.admin_grant_mileage(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_actor UUID;
  v_actor_email TEXT;
  v_new_balance INTEGER;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF p_amount = 0 THEN RAISE EXCEPTION 'amount 가 0이에요'; END IF;
  IF length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'reason 필수'; END IF;

  v_actor := auth.uid();
  SELECT email::TEXT INTO v_actor_email FROM auth.users WHERE id = v_actor;

  -- 잔액 갱신 (음수도 허용, 단 잔액 < 0 안 됨)
  UPDATE public.profiles
     SET mileage_balance = GREATEST(0, mileage_balance + p_amount),
         updated_at = NOW()
   WHERE id = p_user_id
   RETURNING mileage_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN RAISE EXCEPTION '대상 사용자가 없어요'; END IF;

  -- mileage_transactions row
  INSERT INTO public.mileage_transactions (user_id, amount, tx_type, event_type, reason, metadata)
  VALUES (p_user_id, p_amount,
          CASE WHEN p_amount > 0 THEN 'reward' ELSE 'spend' END,
          'admin_manual', p_reason,
          jsonb_build_object('granted_by_admin', v_actor_email));

  INSERT INTO public.admin_action_log (actor_id, actor_email, target_user_id, action, reason, payload)
  VALUES (v_actor, v_actor_email, p_user_id, 'grant_mileage', p_reason,
          jsonb_build_object('amount', p_amount, 'new_balance', v_new_balance));

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.admin_grant_mileage(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_mileage(UUID, INTEGER, TEXT) TO authenticated;

-- ─── 4) admin_block_user — 차단 (is_public=false + reason 기록) ─────────
-- 영구 삭제는 admin_delete_user 가 이미 존재 (기존).
CREATE OR REPLACE FUNCTION public.admin_block_user(
  p_user_id UUID,
  p_reason TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_actor UUID;
  v_actor_email TEXT;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF length(trim(p_reason)) = 0 THEN RAISE EXCEPTION '차단 사유 필수'; END IF;

  v_actor := auth.uid();
  SELECT email::TEXT INTO v_actor_email FROM auth.users WHERE id = v_actor;

  UPDATE public.profiles SET is_public = false, updated_at = NOW() WHERE id = p_user_id;

  INSERT INTO public.admin_action_log (actor_id, actor_email, target_user_id, action, reason)
  VALUES (v_actor, v_actor_email, p_user_id, 'block_user', p_reason);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.admin_block_user(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_block_user(UUID, TEXT) TO authenticated;

COMMENT ON TABLE public.admin_action_log IS 'build 202 — admin 민감 액션 audit log. 푸시·마일리지·차단·삭제 모두 기록.';
