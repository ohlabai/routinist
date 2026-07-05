-- build 292: 리퍼럴 (친구 초대) 시스템
--
-- 배경:
--   · mileage_reward_config 에 friend_invite_invitee (100P, once) /
--     friend_invite_inviter (100P, per_milestone, daily_cap 10) 가 이미 active 상태로 존재.
--   · 그런데 지금까지는 "초대" 개념이 없어서 follows INSERT 트리거(trg_award_friend_invite)가
--     팔로우 당한 사람에게 invitee 보상을 지급하고 있었음 (prod 42건 지급됨, 2026-07-07 조회).
--     → 진짜 리퍼럴 시스템으로 대체하고 해당 트리거/함수는 제거.
--
-- 구성:
--   1. 스키마 — profiles.referral_code (unique) + profiles.invited_by + 인덱스
--   2. 레거시 정리 — follows 트리거 trg_award_friend_invite 제거 (이벤트명 충돌 방지)
--   3. get_my_referral_code() — 내 초대 코드 조회/생성 (대문자+숫자 6자, 0/O/1/I 제외)
--   4. claim_referral_code(p_code) — 코드 입력 → invited_by 세팅 + invitee 100P 즉시 지급
--      + 초대자에게 인박스/push 알림. 초대자 보상은 여기서 지급하지 않음 (5km 트리거가 담당)
--   5. 초대자 보상 트리거 — activities INSERT 시 가입자의 누적 러닝(걷기 제외)이
--      5km 를 처음 넘는 순간 초대자에게 friend_invite_inviter 지급 + push
--   6. 권한 — RPC 2종 authenticated 전용 (reference_supabase_function_privilege 관례)
--
-- award_mileage dedup 계약 (prod 정의 기준):
--   · once          → (user_id, event_type) 전체에서 1회. metadata 무관.
--   · per_milestone → metadata->>'milestone_id' 필수, (user_id, event_type, milestone_id) 로 dedup.
--   → inviter 보상은 milestone_id = 'referral_' || 가입자 uuid 로 가입자당 1회 보장.
--
-- ⚠️ 알려진 제약 (검토 포인트):
--   · 과거 follows 트리거로 friend_invite_invitee 를 이미 받은 42명은 recurrence='once' dedup 에
--     걸려 리퍼럴 가입 100P 를 다시 받지 못함 (이미 100P 받았으므로 이중지급 방지 관점에선 정상).
--     claim 자체(invited_by 세팅)는 성공하고, 응답의 awarded=false 로 구분 가능.
--   · user_notifications.kind CHECK 에 'referral_joined' 추가 — 클라이언트 알림 목록 렌더러에
--     새 kind 처리 필요.

-- ============================================================
-- 1. 스키마
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 코드는 nullable — 값이 있는 행끼리만 unique
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON public.profiles (referral_code)
  WHERE referral_code IS NOT NULL;

-- "내가 초대한 사람" 조회 + FK 역참조용
CREATE INDEX IF NOT EXISTS profiles_invited_by_idx
  ON public.profiles (invited_by)
  WHERE invited_by IS NOT NULL;

-- 초대자 알림 kind 추가 (기존 6종 + referral_joined)
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_kind_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_kind_check
  CHECK (kind = ANY (ARRAY[
    'cheer'::text, 'photo_comment'::text, 'activity_comment'::text,
    'follow'::text, 'friend_request'::text, 'friend_accepted'::text,
    'referral_joined'::text
  ]));

-- ============================================================
-- 2. 레거시 정리 — follows 기반 friend_invite 지급 제거
-- ============================================================
-- 팔로우 != 초대. 리퍼럴 시스템이 friend_invite_* 이벤트를 넘겨받으므로
-- 같은 이벤트를 쓰는 기존 트리거를 제거해 이중 지급/dedup 선점 충돌을 막는다.

DROP TRIGGER IF EXISTS trg_award_friend_invite ON public.follows;
DROP FUNCTION IF EXISTS public.award_friend_invite();

-- ============================================================
-- 3. get_my_referral_code() — 내 코드 조회/생성
-- ============================================================
-- 알파벳: 대문자+숫자에서 혼동 문자 0/O/1/I 제외 → 32자, 6자리 = 32^6 ≈ 10.7억 조합.
-- 동시 호출/충돌은 unique index 가 최종 방어 — unique_violation 시 재시도.

CREATE OR REPLACE FUNCTION public.get_my_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32자 (0/O/1/I 제외)
  v_attempts int := 0;
  i int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT referral_code INTO v_code FROM public.profiles WHERE id = v_uid;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 20 THEN
      RAISE EXCEPTION 'referral code generation failed after 20 attempts';
    END IF;

    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::int, 1);
    END LOOP;

    BEGIN
      UPDATE public.profiles
         SET referral_code = v_code
       WHERE id = v_uid AND referral_code IS NULL;

      IF NOT FOUND THEN
        -- 동시 호출이 먼저 세팅함 — 그 값을 반환
        SELECT referral_code INTO v_code FROM public.profiles WHERE id = v_uid;
        IF v_code IS NULL THEN
          RAISE EXCEPTION 'profile not found for %', v_uid;
        END IF;
      END IF;

      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- 다른 유저와 코드 충돌 — 재시도
    END;
  END LOOP;
END $$;

-- ============================================================
-- 4. claim_referral_code(p_code) — 코드 입력 (가입자 측)
-- ============================================================
-- 반환: {ok: bool, reason?: text, awarded?: bool, amount?: int}
--   reason: not_authenticated | invalid_code | self | already_claimed | too_old
-- 성공 시:
--   · invited_by 세팅 (원자적 — invited_by IS NULL 조건부 UPDATE 로 race 방지)
--   · invitee 100P 즉시 지급 (once dedup — 과거 follows 지급자는 awarded=false)
--   · 초대자에게 user_notifications(referral_joined) + push (category 'referral')
-- 초대자 100P 는 여기서 지급하지 않음 — 가입자 첫 5km 트리거(섹션 5)가 담당.

CREATE OR REPLACE FUNCTION public.claim_referral_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(trim(COALESCE(p_code, '')));
  v_inviter uuid;
  v_my_invited_by uuid;
  v_signup_at timestamptz;
  v_awarded boolean := false;
  v_amount int := 0;
  v_my_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- 코드 → 초대자
  SELECT id INTO v_inviter FROM public.profiles WHERE referral_code = v_code;
  IF v_inviter IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  IF v_inviter = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self');
  END IF;

  SELECT invited_by INTO v_my_invited_by FROM public.profiles WHERE id = v_uid;
  IF v_my_invited_by IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END IF;

  -- 가입 14일 초과 방지 (SECURITY DEFINER 라 auth.users 조회 가능)
  SELECT created_at INTO v_signup_at FROM auth.users WHERE id = v_uid;
  IF v_signup_at IS NULL OR v_signup_at < NOW() - INTERVAL '14 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_old');
  END IF;

  -- invited_by 세팅 — 조건부 UPDATE 로 동시 claim race 차단
  UPDATE public.profiles
     SET invited_by = v_inviter
   WHERE id = v_uid AND invited_by IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END IF;

  -- invitee 100P 즉시 지급 (reference: 초대자 uuid 를 metadata 에 기록)
  BEGIN
    SELECT t.awarded, t.amount INTO v_awarded, v_amount
      FROM public.award_mileage(
        v_uid,
        'friend_invite_invitee',
        jsonb_build_object('inviter_id', v_inviter, 'referral_code', v_code)
      ) t;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'claim_referral_code: invitee award failed for %: % (SQLSTATE %)',
      v_uid, SQLERRM, SQLSTATE;
  END;

  -- 초대자 알림 (인박스 + push) — 실패해도 claim 은 성공 처리
  BEGIN
    SELECT display_name INTO v_my_name FROM public.profiles WHERE id = v_uid;
    v_my_name := COALESCE(NULLIF(trim(v_my_name), ''),
                          public.push_text(v_inviter, '새 러닝메이트', 'A new running mate'));

    INSERT INTO public.user_notifications (user_id, kind, actor_id, preview)
    VALUES (v_inviter, 'referral_joined', v_uid, v_my_name);

    IF public.should_send_push(v_inviter, 'referral') THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (
        v_inviter,
        'referral',
        public.push_text(v_inviter, '🎉 새 러닝메이트', '🎉 New running mate'),
        public.push_text(v_inviter,
          v_my_name || '님이 초대 코드로 가입했어요 🎉',
          v_my_name || ' joined with your invite code 🎉'),
        jsonb_build_object('kind', 'referral_joined', 'invitee_id', v_uid),
        'pending'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'claim_referral_code: inviter notify failed for %: % (SQLSTATE %)',
      v_inviter, SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object('ok', true, 'awarded', v_awarded, 'amount', v_amount);
END $$;

-- ============================================================
-- 5. 초대자 보상 트리거 — 가입자 첫 5km 달성 시
-- ============================================================
-- 가드 순서 (성능 — 기존 activities AFTER 트리거 6개와 공존):
--   ① walking 제외 → ② invited_by 없으면 즉시 종료 (대부분 여기서 끝, PK 단건 조회)
--   → ③ 이미 지급됐으면 종료 (SUM 생략) → ④ 누적 러닝 SUM ≥ 5km 검사
-- "처음 넘는 순간 1회" 는 award_mileage per_milestone dedup
-- (milestone_id = 'referral_' || 가입자 uuid) 가 최종 보장.
-- daily_cap(10) 에 걸려 awarded=false 인 경우 다음 activity INSERT 때 자연 재시도.

CREATE OR REPLACE FUNCTION public.award_referral_inviter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_inviter uuid;
  v_milestone_id text;
  v_total_km numeric;
  v_awarded boolean := false;
  v_amount int := 0;
  v_invitee_name text;
BEGIN
  -- ① 걷기 제외 (null = 러닝으로 간주, 레거시 데이터 호환)
  IF COALESCE(NEW.activity_type, 'running') = 'walking' THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- ② 초대받은 유저만 (PK 단건 조회 — 비초대 유저는 여기서 끝)
    SELECT invited_by INTO v_inviter FROM public.profiles WHERE id = NEW.user_id;
    IF v_inviter IS NULL THEN
      RETURN NEW;
    END IF;

    -- ③ 이미 지급됐으면 SUM 없이 종료
    v_milestone_id := 'referral_' || NEW.user_id::text;
    IF EXISTS (
      SELECT 1 FROM public.mileage_transactions
       WHERE user_id = v_inviter
         AND event_type = 'friend_invite_inviter'
         AND metadata->>'milestone_id' = v_milestone_id
    ) THEN
      RETURN NEW;
    END IF;

    -- ④ 누적 러닝 (걷기 제외, AFTER 트리거이므로 NEW 행 포함)
    SELECT COALESCE(SUM(distance_km), 0) INTO v_total_km
      FROM public.activities
     WHERE user_id = NEW.user_id
       AND COALESCE(activity_type, 'running') <> 'walking';
    IF v_total_km < 5 THEN
      RETURN NEW;
    END IF;

    SELECT t.awarded, t.amount INTO v_awarded, v_amount
      FROM public.award_mileage(
        v_inviter,
        'friend_invite_inviter',
        jsonb_build_object('milestone_id', v_milestone_id, 'invitee_id', NEW.user_id)
      ) t;

    IF v_awarded AND public.should_send_push(v_inviter, 'referral') THEN
      SELECT display_name INTO v_invitee_name FROM public.profiles WHERE id = NEW.user_id;
      v_invitee_name := COALESCE(NULLIF(trim(v_invitee_name), ''),
                                 public.push_text(v_inviter, '초대한 친구', 'Your invitee'));

      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (
        v_inviter,
        'referral',
        public.push_text(v_inviter, '🎉 초대 보상 도착', '🎉 Invite reward earned'),
        public.push_text(v_inviter,
          '초대한 ' || v_invitee_name || '님이 5km를 달성했어요! ' || v_amount || 'P 적립 🎉',
          v_invitee_name || ', your invitee, just passed 5km! You earned ' || v_amount || 'P 🎉'),
        jsonb_build_object('kind', 'referral_milestone', 'invitee_id', NEW.user_id, 'amount', v_amount),
        'pending'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- 보상/알림 실패가 activity 저장을 막으면 안 됨
    RAISE WARNING 'award_referral_inviter failed for activity=% user=%: % (SQLSTATE %)',
      NEW.id, NEW.user_id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_referral_inviter ON public.activities;
CREATE TRIGGER trg_award_referral_inviter
  AFTER INSERT ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.award_referral_inviter();

-- ============================================================
-- 6. 권한 (reference_supabase_function_privilege 관례)
-- ============================================================

GRANT EXECUTE ON FUNCTION public.get_my_referral_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral_code(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_referral_code() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_referral_code(text) FROM PUBLIC, anon;

-- 트리거 함수는 직접 호출 불가해야 함
REVOKE EXECUTE ON FUNCTION public.award_referral_inviter() FROM PUBLIC, anon, authenticated;
