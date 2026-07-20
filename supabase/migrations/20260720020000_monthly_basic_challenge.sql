-- 월드런 "기본 챌린지" — 매달 42.195km (풀코스 거리) / 참가비 100P.
-- (2026-07-20 hans: "100원 정도로 아주 저렴한 기본 챌린지로 매달 42.195km 달리게 계속 자극")
--
-- 설계: 기존 월드투어(virtual_courses/user_course_progress) 시스템과 완전 분리한 독립 서브시스템.
--   이유 — 월드투어는 동시 1개 제한 + 완주 환급/메달/마일스톤 push 로 얽혀 있어, 매달 리셋되는
--   반복 챌린지를 그 안에 끼우면 리스크가 큼. 기본 챌린지는 "베이스라인 목표"로 월드투어와 병행 가능.
--
-- 규칙:
--   • 대상 거리 42.195km, 참가비 100P (상수).
--   • 진행률 = 그 달(KST 달력월)의 러닝 활동 누적 km — 매월 1일 자동 리셋.
--   • 매달 1회 참가 (user_id + period_ym unique). 완주해도 다음 달 다시 100P 로 도전.
--   • 완주 = 그 달 러닝 누적 ≥ 42.195km → completed_at 자동 기록.

-- ─── 1) 참가 기록 테이블 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.monthly_challenge_entries (
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_ym      TEXT NOT NULL,                    -- 'YYYY-MM' (KST 기준)
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  entry_fee_paid INTEGER NOT NULL DEFAULT 0,
  target_km      NUMERIC NOT NULL DEFAULT 42.195,
  PRIMARY KEY (user_id, period_ym)
);

ALTER TABLE public.monthly_challenge_entries ENABLE ROW LEVEL SECURITY;

-- 본인 행만 읽기 (쓰기는 SECURITY DEFINER RPC 로만).
DROP POLICY IF EXISTS "mce_select_own" ON public.monthly_challenge_entries;
CREATE POLICY "mce_select_own" ON public.monthly_challenge_entries
  FOR SELECT USING (auth.uid() = user_id);

-- ─── 2) fetch_monthly_challenge — 이번 달 현황 (참가 여부 + 진행률 + 완주 자동처리) ─
CREATE OR REPLACE FUNCTION public.fetch_monthly_challenge()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_target       NUMERIC := 42.195;
  v_fee          INTEGER := 100;
  v_now_kst      DATE := (now() AT TIME ZONE 'Asia/Seoul')::DATE;
  v_month_start  DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))::DATE;
  v_next_month   DATE := (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) + interval '1 month')::DATE;
  v_period       TEXT := to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM');
  v_progress     NUMERIC;
  v_entry        RECORD;
  v_completed_at TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- 이번 달(KST 달력월) 러닝 누적
  SELECT COALESCE(SUM(a.distance_km), 0) INTO v_progress
  FROM public.activities a
  WHERE a.user_id = v_uid
    AND a.activity_date >= v_month_start
    AND a.activity_date <  v_next_month
    AND (a.activity_type IS NULL OR a.activity_type = 'running');

  SELECT * INTO v_entry
  FROM public.monthly_challenge_entries
  WHERE user_id = v_uid AND period_ym = v_period;

  v_completed_at := v_entry.completed_at;

  -- 참가 상태에서 목표 달성했는데 아직 완주 기록 없으면 자동 완주 처리
  IF FOUND AND v_completed_at IS NULL AND v_progress >= v_target THEN
    UPDATE public.monthly_challenge_entries
       SET completed_at = now()
     WHERE user_id = v_uid AND period_ym = v_period;
    v_completed_at := now();
  END IF;

  RETURN json_build_object(
    'period_ym',    v_period,
    'joined',       FOUND,
    'entry_fee',    v_fee,
    'target_km',    v_target,
    'progress_km',  v_progress,
    'completed_at', v_completed_at,
    'days_left',    GREATEST(0, (v_next_month - v_now_kst))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fetch_monthly_challenge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_monthly_challenge() TO authenticated;

-- ─── 3) join_monthly_challenge — 이번 달 참가 (100P 차감) ──────────────
CREATE OR REPLACE FUNCTION public.join_monthly_challenge()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         UUID := auth.uid();
  v_fee         INTEGER := 100;
  v_target      NUMERIC := 42.195;
  v_period      TEXT := to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM');
  v_balance     INTEGER;
  v_new_balance INTEGER;
  v_short       INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요. 다시 로그인 후 시도해주세요'; END IF;

  -- 이미 이번 달 참가함 → 그대로 통과
  IF EXISTS (SELECT 1 FROM public.monthly_challenge_entries WHERE user_id = v_uid AND period_ym = v_period) THEN
    SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_uid;
    RETURN json_build_object('already_joined', true, 'fee_charged', 0, 'balance', COALESCE(v_balance, 0));
  END IF;

  SELECT mileage_balance INTO v_balance FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_fee THEN
    v_short := v_fee - COALESCE(v_balance, 0);
    RAISE EXCEPTION '앗! 마일리지가 % 모자라요 (참가비 % / 잔액 %). 좀 더 달리고 다시 도전해봐요 🏃',
      v_short, v_fee, COALESCE(v_balance, 0);
  END IF;

  v_new_balance := v_balance - v_fee;
  UPDATE public.profiles SET mileage_balance = v_new_balance WHERE id = v_uid;

  INSERT INTO public.mileage_transactions (
    user_id, amount, balance_after, tx_type, event_type, description, metadata
  ) VALUES (
    v_uid, -v_fee, v_new_balance, 'purchase_spend', 'monthly_challenge_entry',
    '이달의 기본 챌린지 참가 (' || v_period || ')',
    jsonb_build_object('period_ym', v_period)
  );

  INSERT INTO public.monthly_challenge_entries (user_id, period_ym, entry_fee_paid, target_km)
  VALUES (v_uid, v_period, v_fee, v_target)
  ON CONFLICT (user_id, period_ym) DO NOTHING;

  RETURN json_build_object('already_joined', false, 'fee_charged', v_fee, 'balance', v_new_balance);
END;
$function$;

REVOKE ALL ON FUNCTION public.join_monthly_challenge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_monthly_challenge() TO authenticated;
