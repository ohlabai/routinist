-- build 251: 월드런 완주 알림 + 마일리지 50% 환급
--
-- 배경
--  hans 가 도쿄·보스턴 마라톤 완주했는데 알림이 없어 본인도 모르고 지나갔다는 피드백 (2026-06-05).
--  완주 자체의 가시성과 보상감을 끌어올리는 1차 작업.
--
-- 변경
--  1. user_course_progress 에 notified_at / acknowledged_at 컬럼 추가
--  2. 완주 처리를 _complete_course(p_user_id, p_course_id) 함수로 분리:
--     - completed_at 설정
--     - 결제 entry_fee_p 의 50% 자동 마일리지 환급 (이미 환급된 적 있으면 skip)
--     - push_send_log 에 category='course_complete' 큐잉 (사용자 설정 존중)
--  3. fetch_my_courses() 의 자동 완주 처리를 _complete_course 호출로 변경
--  4. fetch_unack_completions() — 메인 진입 모달에서 한 번 표시할 완주
--  5. ack_course_completion(course_id) — 모달 닫기 표시
--  6. 백필: 기존 completed_at IS NOT NULL 이지만 환급 안 된 row 에 환급 + acknowledged_at NULL 로 두어 첫 진입 시 모달 표시

------------------------------------------------------------
-- (A) 컬럼 추가
------------------------------------------------------------
ALTER TABLE public.user_course_progress
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ucp_unack_idx
  ON public.user_course_progress(user_id)
  WHERE completed_at IS NOT NULL AND acknowledged_at IS NULL;

------------------------------------------------------------
-- (B) _complete_course — 완주 처리 (마일리지 환급 + push 큐잉)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._complete_course(p_user_id UUID, p_course_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_fee INTEGER;
  v_refund INTEGER;
  v_name TEXT;
  v_balance INTEGER;
  v_already_refunded BOOLEAN;
BEGIN
  -- 완주 표시 (이미 표시돼있으면 갱신 안 함)
  UPDATE public.user_course_progress
     SET completed_at = COALESCE(completed_at, now()),
         notified_at  = COALESCE(notified_at, now())
   WHERE user_id = p_user_id AND course_id = p_course_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT entry_fee_p, name INTO v_fee, v_name
  FROM public.virtual_courses WHERE id = p_course_id;
  v_refund := COALESCE(v_fee, 0) / 2;

  -- 이미 같은 course 에 대해 환급된 적 있는지 확인 (멱등성)
  SELECT EXISTS (
    SELECT 1 FROM public.mileage_transactions
    WHERE user_id = p_user_id
      AND event_type = 'course_complete_refund'
      AND reference_id = p_course_id
  ) INTO v_already_refunded;

  IF v_refund > 0 AND NOT v_already_refunded THEN
    UPDATE public.profiles
       SET mileage_balance = COALESCE(mileage_balance, 0) + v_refund
     WHERE id = p_user_id
     RETURNING mileage_balance INTO v_balance;

    INSERT INTO public.mileage_transactions
      (user_id, amount, balance_after, tx_type, event_type, reference_id, description, metadata)
    VALUES
      (p_user_id, v_refund, COALESCE(v_balance, v_refund), 'reward',
       'course_complete_refund', p_course_id,
       '월드런 완주 환급 50% — ' || COALESCE(v_name, '코스'),
       jsonb_build_object(
         'course_id', p_course_id,
         'course_name', v_name,
         'refund_amount', v_refund,
         'original_fee', v_fee
       ));
  END IF;

  -- push 큐 — 사용자 설정 (push_settings.course_complete) 존중
  IF public.should_send_push(p_user_id, 'course_complete') THEN
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      p_user_id,
      'course_complete',
      '🏆 ' || COALESCE(v_name, '월드런') || ' 완주!',
      CASE
        WHEN v_refund > 0 AND NOT v_already_refunded
          THEN '메달이 도착했어요. 마일리지 ' || v_refund::text || 'P 환급 ✨'
        ELSE '메달이 도착했어요. 친구들에게 자랑해보세요 ✨'
      END,
      jsonb_build_object(
        'course_id', p_course_id::text,
        'course_name', v_name,
        'deep_link', '/social/rankings?tab=world'
      ),
      'pending'
    );
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._complete_course(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._complete_course(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public._complete_course(UUID, UUID) FROM authenticated;

------------------------------------------------------------
-- (C) fetch_my_courses — _complete_course 호출로 교체
--   기존 완주 자동 처리는 단순 UPDATE 였음. 알림/환급 함께 발사.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_my_courses()
RETURNS TABLE (
  course_id UUID,
  name TEXT,
  country TEXT,
  description TEXT,
  hero_image_url TEXT,
  distance_km NUMERIC,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  progress_km NUMERIC,
  has_medal BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  r RECORD;
  v_progress NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT
      c.id, c.name, c.country, c.description, c.hero_image_url, c.distance_km,
      ucp.started_at, ucp.completed_at
    FROM public.user_course_progress ucp
    JOIN public.virtual_courses c ON c.id = ucp.course_id
    WHERE ucp.user_id = v_user_id
    ORDER BY ucp.started_at DESC
  LOOP
    SELECT COALESCE(SUM(a.distance_km), 0) INTO v_progress
    FROM public.activities a
    WHERE a.user_id = v_user_id AND a.created_at >= r.started_at;

    -- 완주 자동 처리 — 누적 ≥ 코스 거리. _complete_course 가 환급+push 까지.
    IF r.completed_at IS NULL AND v_progress >= r.distance_km THEN
      PERFORM public._complete_course(v_user_id, r.id);
      r.completed_at := now();
    END IF;

    course_id := r.id;
    name := r.name;
    country := r.country;
    description := r.description;
    hero_image_url := r.hero_image_url;
    distance_km := r.distance_km;
    started_at := r.started_at;
    completed_at := r.completed_at;
    progress_km := v_progress;
    has_medal := EXISTS (SELECT 1 FROM public.course_medals WHERE user_id = v_user_id AND course_id = r.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_courses() TO authenticated;

------------------------------------------------------------
-- (D) fetch_unack_completions — 메인 진입 시 한 번 표시할 완주
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_unack_completions()
RETURNS TABLE (
  course_id UUID,
  name TEXT,
  country TEXT,
  hero_image_url TEXT,
  distance_km NUMERIC,
  completed_at TIMESTAMPTZ,
  refund_amount INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    vc.id,
    vc.name,
    vc.country,
    vc.hero_image_url,
    vc.distance_km,
    ucp.completed_at,
    COALESCE((vc.entry_fee_p / 2), 0)::integer AS refund_amount
  FROM public.user_course_progress ucp
  JOIN public.virtual_courses vc ON vc.id = ucp.course_id
  WHERE ucp.user_id = v_user_id
    AND ucp.completed_at IS NOT NULL
    AND ucp.acknowledged_at IS NULL
  ORDER BY ucp.completed_at ASC;
END $$;

REVOKE ALL ON FUNCTION public.fetch_unack_completions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_unack_completions() FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_unack_completions() TO authenticated;

------------------------------------------------------------
-- (E) ack_course_completion — 모달 닫기
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ack_course_completion(p_course_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  UPDATE public.user_course_progress
     SET acknowledged_at = now()
   WHERE user_id = v_user_id
     AND course_id = p_course_id
     AND completed_at IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.ack_course_completion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ack_course_completion(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.ack_course_completion(UUID) TO authenticated;

------------------------------------------------------------
-- (F) 백필 — 이미 완주됐는데 환급 안 된 row 에 환급 적용
--   acknowledged_at 은 NULL 로 두어 사용자 첫 진입 시 축하 모달 1회 표시.
--   push 는 백필 대상은 생략 (시끄러우므로). 모달로만 알림.
------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_refund INTEGER;
  v_balance INTEGER;
  v_already BOOLEAN;
BEGIN
  FOR r IN
    SELECT ucp.user_id, ucp.course_id, vc.name, vc.entry_fee_p
    FROM public.user_course_progress ucp
    JOIN public.virtual_courses vc ON vc.id = ucp.course_id
    WHERE ucp.completed_at IS NOT NULL
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.mileage_transactions
      WHERE user_id = r.user_id AND event_type = 'course_complete_refund' AND reference_id = r.course_id
    ) INTO v_already;
    IF v_already THEN CONTINUE; END IF;
    v_refund := COALESCE(r.entry_fee_p, 0) / 2;
    IF v_refund <= 0 THEN CONTINUE; END IF;
    UPDATE public.profiles
       SET mileage_balance = COALESCE(mileage_balance, 0) + v_refund
     WHERE id = r.user_id
     RETURNING mileage_balance INTO v_balance;
    INSERT INTO public.mileage_transactions
      (user_id, amount, balance_after, tx_type, event_type, reference_id, description, metadata)
    VALUES
      (r.user_id, v_refund, COALESCE(v_balance, v_refund), 'reward',
       'course_complete_refund', r.course_id,
       '월드런 완주 환급 50% (백필) — ' || COALESCE(r.name, '코스'),
       jsonb_build_object('course_id', r.course_id, 'course_name', r.name, 'refund_amount', v_refund, 'original_fee', r.entry_fee_p, 'backfill', true));
  END LOOP;
END $$;

------------------------------------------------------------
-- (G) mileage_reward_config 에 course_complete_refund 등록 (어드민 콘솔 표시용)
--   amount 는 동적 (entry_fee_p × 0.5) 라서 0 으로 두고 description 만.
------------------------------------------------------------
INSERT INTO public.mileage_reward_config (event_type, amount, description, is_active, recurrence)
VALUES ('course_complete_refund', 0, '월드런 완주 환급 50% (참가비 × 0.5, 동적 계산)', true, 'per_milestone')
ON CONFLICT (event_type) DO UPDATE SET description = EXCLUDED.description;
