-- 어드민 회원 상세 (get_admin_user_detail) 무한로딩 버그 fix.
--
-- 증상: /admin/users → 회원(아이디) 탭 → 상세 페이지 무한 스피너.
-- 원인: RPC 가 mileage_transactions.reason 컬럼을 참조하는데 실제 컬럼명은 description.
--       42703 (column does not exist) 로 RPC 가 EXCEPTION → 프론트 catch → data=null 유지 →
--       `loading || !data` 스피너가 영원히 남음 (토스트만 2.5초 반짝).
-- fix: mt.reason → mt.description (프론트 인터페이스의 reason 키는 그대로 유지).

CREATE OR REPLACE FUNCTION public.get_admin_user_detail(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
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
        'event_type', mt.event_type, 'reason', mt.description,
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
