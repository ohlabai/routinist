-- build 162 #1a: start_course 가 already_started 여부와 차감액을 JSON 으로 반환.
-- 호출부 (WorldTab) 가 "마일리지 X 차감됨" vs "이미 참가중" 토스트를 분기하도록.
-- 기존 return type 이 boolean → jsonb 로 바뀌므로 DROP 후 재생성.
DROP FUNCTION IF EXISTS public.start_course(uuid);

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
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  SELECT entry_fee_p, name INTO v_fee, v_name FROM public.virtual_courses WHERE id = p_course_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION '비활성 코스이거나 존재하지 않아요'; END IF;

  IF EXISTS (SELECT 1 FROM public.user_course_progress WHERE user_id = v_user_id AND course_id = p_course_id) THEN
    SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'already_started', true,
      'fee_charged', 0,
      'balance', COALESCE(v_balance, 0)
    );
  END IF;

  SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_fee THEN
    RAISE EXCEPTION '마일리지가 부족해요 (참가비 % / 잔액 %)', v_fee, COALESCE(v_balance, 0);
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
