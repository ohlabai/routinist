-- build 167 #5: 월드마라톤 동시 진행 1개 제한.
-- 사용자가 진행 중인 다른 코스가 있으면 새 코스 시작 차단.
-- "한번 달릴 때 2군데 가상 마라톤 동시 진행 불가" — 사용자 정책 (2026-05-22).

CREATE OR REPLACE FUNCTION public.start_course(p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_fee INTEGER;
  v_balance INTEGER;
  v_new_balance INTEGER;
  v_name TEXT;
  v_short INTEGER;
  v_active_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요해요. 다시 로그인 후 시도해주세요'; END IF;

  SELECT entry_fee_p, name INTO v_fee, v_name FROM public.virtual_courses WHERE id = p_course_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '앗! 지금은 도전할 수 없는 코스예요. 다른 코스를 골라봐요';
  END IF;

  -- 같은 코스 이미 참가중 → 그대로 진입
  IF EXISTS (SELECT 1 FROM public.user_course_progress WHERE user_id = v_user_id AND course_id = p_course_id) THEN
    SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'already_started', true,
      'fee_charged', 0,
      'balance', COALESCE(v_balance, 0)
    );
  END IF;

  -- build 167 #5: 진행 중인 다른 코스가 있으면 차단.
  -- completed_at IS NULL = 아직 완주 안 한 코스.
  SELECT vc.name INTO v_active_name
  FROM public.user_course_progress ucp
  JOIN public.virtual_courses vc ON vc.id = ucp.course_id
  WHERE ucp.user_id = v_user_id
    AND ucp.completed_at IS NULL
    AND ucp.course_id <> p_course_id
  LIMIT 1;
  IF v_active_name IS NOT NULL THEN
    RAISE EXCEPTION '지금 「%」 코스를 달리고 있어요 🏃 완주한 후에 새로운 도전을 시작할 수 있어요!', v_active_name;
  END IF;

  SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_fee THEN
    v_short := v_fee - COALESCE(v_balance, 0);
    RAISE EXCEPTION '앗! 마일리지가 % 모자라요 (참가비 % / 잔액 %). 좀 더 달리고 다시 도전해봐요 🏃',
      v_short, v_fee, COALESCE(v_balance, 0);
  END IF;

  v_new_balance := v_balance - v_fee;
  UPDATE public.profiles SET mileage_balance = v_new_balance WHERE id = v_user_id;

  INSERT INTO public.mileage_transactions (
    user_id, amount, balance_after, tx_type, event_type, reference_id, description, metadata
  ) VALUES (
    v_user_id, -v_fee, v_new_balance, 'purchase_spend', 'course_entry', p_course_id,
    '월드런 참가 — ' || v_name,
    jsonb_build_object('course_id', p_course_id, 'course_name', v_name)
  );

  INSERT INTO public.user_course_progress (user_id, course_id)
  VALUES (v_user_id, p_course_id)
  ON CONFLICT (user_id, course_id) DO NOTHING;

  RETURN jsonb_build_object(
    'already_started', false,
    'fee_charged', v_fee,
    'balance', v_new_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.start_course(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_course(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_course(uuid) TO authenticated;
