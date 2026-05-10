-- 2026-05-06: 마일리지 보상 시스템
-- 1) mileage_reward_config — 보상 amount/recurrence/active 를 운영 중에도 변경 가능
-- 2) award_mileage RPC — config 조회 + 중복 검사 + 안전망 (cooldown, daily_cap, fraud) 후 지급
-- 3) 트리거 — signup, friendship, activity insert 시 자동 호출
-- 4) audit log — config 변경 이력 추적

-- ============================================================================
-- 1. mileage_reward_config
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mileage_reward_config (
  event_type TEXT PRIMARY KEY,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- 'once' | 'monthly' | 'per_streak' | 'per_milestone'
  recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'monthly', 'per_streak', 'per_milestone')),
  -- abuse 방지
  cooldown_days INTEGER DEFAULT 0,        -- 같은 event 재지급 최소 간격
  daily_cap INTEGER,                      -- 같은 user 의 하루 최대 지급 횟수 (NULL = 무제한)
  -- 이벤트성 부스트 (관리자가 일시적으로 amount × multiplier)
  boost_multiplier NUMERIC(4,2) DEFAULT 1.0 CHECK (boost_multiplier >= 0),
  boost_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.mileage_reward_config ENABLE ROW LEVEL SECURITY;

-- 누구나 조회 (UI 가 표시)
DROP POLICY IF EXISTS "config_select" ON public.mileage_reward_config;
CREATE POLICY "config_select" ON public.mileage_reward_config FOR SELECT USING (true);

-- 관리자 (hans@openhan.kr) 만 INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "config_admin_all" ON public.mileage_reward_config;
CREATE POLICY "config_admin_all" ON public.mileage_reward_config FOR ALL
  USING ((auth.jwt() ->> 'email') = 'hans@openhan.kr')
  WITH CHECK ((auth.jwt() ->> 'email') = 'hans@openhan.kr');

-- 변경 이력 audit log
CREATE TABLE IF NOT EXISTS public.mileage_reward_config_audit (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  old_amount INTEGER,
  new_amount INTEGER,
  old_active BOOLEAN,
  new_active BOOLEAN,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.log_mileage_config_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.amount != NEW.amount OR OLD.is_active != NEW.is_active) THEN
    INSERT INTO public.mileage_reward_config_audit
      (event_type, old_amount, new_amount, old_active, new_active, changed_by)
    VALUES
      (NEW.event_type, OLD.amount, NEW.amount, OLD.is_active, NEW.is_active, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mileage_config_audit ON public.mileage_reward_config;
CREATE TRIGGER trg_mileage_config_audit
  AFTER UPDATE ON public.mileage_reward_config
  FOR EACH ROW EXECUTE FUNCTION public.log_mileage_config_change();

-- ============================================================================
-- 2. mileage_transactions 확장 — event_type 컬럼 추가 (보상 출처 추적)
-- ============================================================================
ALTER TABLE public.mileage_transactions
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_mt_user_event ON public.mileage_transactions(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_mt_user_created ON public.mileage_transactions(user_id, created_at DESC);

-- tx_type constraint 에 'reward' 추가
ALTER TABLE public.mileage_transactions DROP CONSTRAINT IF EXISTS mileage_transactions_tx_type_check;
ALTER TABLE public.mileage_transactions ADD CONSTRAINT mileage_transactions_tx_type_check
  CHECK (tx_type = ANY (ARRAY['run_earn', 'purchase_spend', 'gift_send', 'gift_receive', 'admin_adjust', 'refund', 'reward']));

-- ============================================================================
-- 3. award_mileage RPC — 핵심 함수
-- ============================================================================
CREATE OR REPLACE FUNCTION public.award_mileage(
  p_user_id UUID,
  p_event_type TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (awarded BOOLEAN, amount INTEGER, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_config public.mileage_reward_config%ROWTYPE;
  v_amount INTEGER;
  v_already_count INTEGER;
  v_today_count INTEGER;
  v_milestone_id TEXT;
  v_month_key TEXT;
  v_streak_id TEXT;
  v_new_balance INTEGER;
BEGIN
  -- config 조회
  SELECT * INTO v_config FROM public.mileage_reward_config WHERE event_type = p_event_type;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 'event_type not configured';
    RETURN;
  END IF;

  IF NOT v_config.is_active THEN
    RETURN QUERY SELECT false, 0, 'event inactive';
    RETURN;
  END IF;

  -- amount 계산 (boost 반영)
  v_amount := v_config.amount;
  IF v_config.boost_until IS NOT NULL AND v_config.boost_until > NOW() AND v_config.boost_multiplier > 1 THEN
    v_amount := ROUND(v_amount * v_config.boost_multiplier)::INTEGER;
  END IF;

  -- recurrence 별 중복 검사
  IF v_config.recurrence = 'once' THEN
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id AND event_type = p_event_type;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'already awarded (once)';
      RETURN;
    END IF;

  ELSIF v_config.recurrence = 'monthly' THEN
    v_month_key := to_char(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM');
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND (metadata->>'month') = v_month_key;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'already awarded this month';
      RETURN;
    END IF;
    p_metadata := jsonb_set(p_metadata, '{month}', to_jsonb(v_month_key));

  ELSIF v_config.recurrence = 'per_milestone' THEN
    v_milestone_id := COALESCE(p_metadata->>'milestone_id', '');
    IF v_milestone_id = '' THEN
      RETURN QUERY SELECT false, 0, 'milestone_id required';
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND (metadata->>'milestone_id') = v_milestone_id;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'milestone already awarded';
      RETURN;
    END IF;

  ELSIF v_config.recurrence = 'per_streak' THEN
    v_streak_id := COALESCE(p_metadata->>'streak_id', '');
    IF v_streak_id = '' THEN
      RETURN QUERY SELECT false, 0, 'streak_id required';
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND (metadata->>'streak_id') = v_streak_id;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'streak already awarded';
      RETURN;
    END IF;
  END IF;

  -- cooldown 검사
  IF v_config.cooldown_days > 0 THEN
    SELECT COUNT(*) INTO v_already_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND created_at > NOW() - (v_config.cooldown_days || ' days')::INTERVAL;
    IF v_already_count > 0 THEN
      RETURN QUERY SELECT false, 0, 'cooldown active';
      RETURN;
    END IF;
  END IF;

  -- daily_cap 검사
  IF v_config.daily_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_today_count
      FROM public.mileage_transactions
     WHERE user_id = p_user_id
       AND event_type = p_event_type
       AND created_at > NOW() - INTERVAL '24 hours';
    IF v_today_count >= v_config.daily_cap THEN
      RETURN QUERY SELECT false, 0, 'daily cap reached';
      RETURN;
    END IF;
  END IF;

  -- 글로벌 일일 캡 (모든 event 합산) — abuse 방지
  SELECT COALESCE(SUM(mt.amount), 0) INTO v_today_count
    FROM public.mileage_transactions mt
   WHERE mt.user_id = p_user_id
     AND mt.amount > 0
     AND mt.created_at > NOW() - INTERVAL '24 hours';
  IF v_today_count + v_amount > 5000 THEN
    RETURN QUERY SELECT false, 0, 'global daily cap (5000P) reached';
    RETURN;
  END IF;

  -- 지급 — profiles.mileage_balance 업데이트 + transaction 기록
  UPDATE public.profiles
     SET mileage_balance = COALESCE(mileage_balance, 0) + v_amount
   WHERE id = p_user_id
   RETURNING mileage_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN QUERY SELECT false, 0, 'user profile not found';
    RETURN;
  END IF;

  INSERT INTO public.mileage_transactions
    (user_id, amount, balance_after, tx_type, event_type, description, metadata)
  VALUES
    (p_user_id, v_amount, v_new_balance, 'reward', p_event_type, v_config.description, p_metadata);

  RETURN QUERY SELECT true, v_amount, 'awarded';
END $$;

REVOKE ALL ON FUNCTION public.award_mileage(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_mileage(UUID, TEXT, JSONB) TO authenticated;

-- ============================================================================
-- 4. 트리거 — 자동 지급
-- ============================================================================

-- (1) 회원가입 보너스 — handle_new_user 또는 profiles insert 시
CREATE OR REPLACE FUNCTION public.award_signup_bonus()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.award_mileage(NEW.id, 'signup', '{}'::jsonb);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_signup_bonus ON public.profiles;
CREATE TRIGGER trg_award_signup_bonus
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.award_signup_bonus();

-- (2) 친구 초대 — friendships 생성 시 invitee 에게 즉시 + inviter 는 invitee 첫 활동 시 (per_milestone)
CREATE OR REPLACE FUNCTION public.award_friend_invite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 양쪽 다 고유한 milestone_id 사용 (friendship pair)
  -- follows 의 PK 가 (follower_id, following_id) 라 별도 id 없음 → 두 UUID 조합으로 milestone_id
  PERFORM public.award_mileage(
    NEW.following_id,
    'friend_invite_invitee',
    jsonb_build_object('milestone_id', 'fi_' || NEW.follower_id::text || '_' || NEW.following_id::text, 'inviter_id', NEW.follower_id)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_friend_invite ON public.follows;
CREATE TRIGGER trg_award_friend_invite
  AFTER INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.award_friend_invite();

-- (3) 활동 milestone — first_5km / first_10km / first_half / first_marathon + streak + monthly_goal
CREATE OR REPLACE FUNCTION public.award_activity_milestones()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_dist NUMERIC;
  v_streak INTEGER;
  v_streak_id TEXT;
  v_monthly_total NUMERIC;
  v_goal NUMERIC;
  v_month_int INT;
  v_year_int INT;
  v_kst_date DATE;
BEGIN
  v_dist := NEW.distance_km;

  -- 거리 milestone
  IF v_dist >= 5 THEN
    PERFORM public.award_mileage(NEW.user_id, 'first_5km', jsonb_build_object('activity_id', NEW.id));
  END IF;
  IF v_dist >= 10 THEN
    PERFORM public.award_mileage(NEW.user_id, 'first_10km', jsonb_build_object('activity_id', NEW.id));
  END IF;
  IF v_dist >= 21.0975 THEN
    PERFORM public.award_mileage(NEW.user_id, 'first_half', jsonb_build_object('activity_id', NEW.id));
  END IF;
  IF v_dist >= 42.195 THEN
    PERFORM public.award_mileage(NEW.user_id, 'first_marathon', jsonb_build_object('activity_id', NEW.id));
  END IF;

  -- streak (KST 기준 연속일)
  v_kst_date := (COALESCE(NEW.started_at, (NEW.activity_date || ' 12:00:00')::TIMESTAMPTZ) AT TIME ZONE 'Asia/Seoul')::DATE;
  WITH consecutive AS (
    SELECT activity_date,
           ROW_NUMBER() OVER (ORDER BY activity_date DESC) AS rn,
           activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date DESC) - 1) AS group_key
      FROM (SELECT DISTINCT activity_date FROM public.activities WHERE user_id = NEW.user_id) a
     WHERE activity_date <= v_kst_date
  )
  SELECT COUNT(*) INTO v_streak
    FROM consecutive
   WHERE group_key = v_kst_date;

  IF v_streak >= 7 THEN
    -- streak_id = 7일 streak 시작일 (이번 streak 의 첫째 날)
    v_streak_id := 's7_' || (v_kst_date - 6)::text;
    PERFORM public.award_mileage(NEW.user_id, 'streak_7', jsonb_build_object('streak_id', v_streak_id, 'days', v_streak));
  END IF;
  IF v_streak >= 30 THEN
    v_streak_id := 's30_' || (v_kst_date - 29)::text;
    PERFORM public.award_mileage(NEW.user_id, 'streak_30', jsonb_build_object('streak_id', v_streak_id, 'days', v_streak));
  END IF;

  -- 월 목표 달성 — monthly_goals 의 goal_km 비교
  v_year_int := EXTRACT(YEAR FROM v_kst_date)::INT;
  v_month_int := EXTRACT(MONTH FROM v_kst_date)::INT;
  SELECT goal_km INTO v_goal
    FROM public.monthly_goals
   WHERE user_id = NEW.user_id AND year = v_year_int AND month = v_month_int;
  IF v_goal IS NOT NULL AND v_goal > 0 THEN
    SELECT COALESCE(SUM(distance_km), 0) INTO v_monthly_total
      FROM public.activities
     WHERE user_id = NEW.user_id
       AND EXTRACT(YEAR FROM activity_date)::INT = v_year_int
       AND EXTRACT(MONTH FROM activity_date)::INT = v_month_int;
    IF v_monthly_total >= v_goal THEN
      PERFORM public.award_mileage(NEW.user_id, 'monthly_goal_complete', '{}'::jsonb);
    END IF;
  END IF;

  -- inviter 보상 — invitee 의 첫 5km 달성 시
  IF v_dist >= 5 THEN
    PERFORM public.award_mileage(
      f.follower_id,
      'friend_invite_inviter',
      jsonb_build_object('milestone_id', 'fi_' || f.follower_id::text || '_' || f.following_id::text, 'invitee_id', NEW.user_id)
    )
    FROM public.follows f
    WHERE f.following_id = NEW.user_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_activity_milestones ON public.activities;
CREATE TRIGGER trg_award_activity_milestones
  AFTER INSERT ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.award_activity_milestones();

-- ============================================================================
-- 5. seed — 초기 보상 값
-- ============================================================================
INSERT INTO public.mileage_reward_config (event_type, amount, description, recurrence, daily_cap) VALUES
  ('signup', 300, '회원가입 환영', 'once', NULL),
  ('friend_invite_inviter', 200, '친구 초대 (가입자가 첫 5km 완료)', 'per_milestone', 10),
  ('friend_invite_invitee', 200, '친구 초대로 가입', 'once', NULL),
  ('streak_7', 200, '연속 7일 러닝', 'per_streak', NULL),
  ('streak_30', 1000, '연속 30일 러닝', 'per_streak', NULL),
  ('monthly_goal_complete', 500, '월 목표 100% 달성', 'monthly', NULL),
  ('first_5km', 200, '첫 5km 완주', 'once', NULL),
  ('first_10km', 300, '첫 10km 완주', 'once', NULL),
  ('first_half', 500, '첫 하프코스 (21.0975km) 완주', 'once', NULL),
  ('first_marathon', 1000, '첫 풀코스 (42.195km) 완주', 'once', NULL)
ON CONFLICT (event_type) DO NOTHING;

-- ============================================================================
-- 6. 관리자용: 기존 사용자 백필 — signup 보상 한 번 지급
-- ============================================================================
-- (안전: ON CONFLICT 자동 검사 — recurrence=once 라 중복 안 됨)
DO $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN SELECT id FROM public.profiles LOOP
    PERFORM public.award_mileage(u.id, 'signup', '{}'::jsonb);
  END LOOP;
END $$;
