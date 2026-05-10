-- 후속 검증에서 발견된 추가 이슈 fix.
--
-- 1. delete_my_account 가 prediction_rounds.winner_user_id 의 FK (NO ACTION) 를 처리 안 함
--    → 본인이 winner 로 정산된 라운드 있으면 profiles 삭제 시 FK 위반으로 차단.
--    App Store 5.1.1(v) 위반 위험.
--
-- 2. settle_prediction_round / create_prediction_round 가 PUBLIC EXECUTE default 권한 때문에
--    REVOKE FROM authenticated 만으로는 차단 안 됨. 임의 사용자가 라운드 미리 정산 트리거 가능.
--
-- 3. mileage_reward_config_audit 의 RLS 비활성 → 누구나 INSERT 가능 (audit log poisoning).

-- ============================================================================
-- 1. delete_my_account — winner_user_id 정리 추가
-- ============================================================================
CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '로그인되지 않은 사용자';
  END IF;

  -- prediction_rounds.winner_user_id 의 FK (NO ACTION) 처리 — NULL 로 설정.
  -- 라운드는 보존하되 winner 만 익명화. 명시적 SET DEFAULT 없으니 직접 update.
  BEGIN
    UPDATE public.prediction_rounds SET winner_user_id = NULL WHERE winner_user_id = uid;
  EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'prediction_rounds: skipped'; END;

  BEGIN DELETE FROM public.activity_photos WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'activity_photos: skipped'; END;
  BEGIN DELETE FROM public.calendar_photos WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'calendar_photos: skipped'; END;
  BEGIN DELETE FROM public.photo_likes WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'photo_likes: skipped'; END;
  BEGIN DELETE FROM public.activity_cheers WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'activity_cheers: skipped'; END;
  BEGIN DELETE FROM public.user_cheers WHERE from_user = uid OR to_user = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'user_cheers: skipped'; END;
  BEGIN DELETE FROM public.prediction_picks WHERE user_id = uid OR picked_user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'prediction_picks: skipped'; END;
  BEGIN DELETE FROM public.user_blocks WHERE blocker_id = uid OR blocked_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'user_blocks: skipped'; END;
  BEGIN DELETE FROM public.content_reports WHERE reporter_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'content_reports: skipped'; END;
  BEGIN DELETE FROM public.messages WHERE sender_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'messages: skipped'; END;
  BEGIN DELETE FROM public.conversations WHERE user_a = uid OR user_b = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'conversations: skipped'; END;
  BEGIN DELETE FROM public.follows WHERE follower_id = uid OR following_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'follows: skipped'; END;
  BEGIN DELETE FROM public.club_members WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'club_members: skipped'; END;
  BEGIN DELETE FROM public.activities WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'activities: skipped'; END;
  BEGIN DELETE FROM public.monthly_goals WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'monthly_goals: skipped'; END;
  BEGIN DELETE FROM public.mileage_transactions WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'mileage_transactions: skipped'; END;
  BEGIN DELETE FROM public.quote_likes WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'quote_likes: skipped'; END;
  BEGIN DELETE FROM public.client_error_logs WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN RAISE NOTICE 'client_error_logs: skipped'; END;

  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

-- ============================================================================
-- 2. PUBLIC default 권한 revoke — settle / create / purge / award_*
--    PostgreSQL 함수의 default 권한은 PUBLIC EXECUTE. authenticated 만 revoke 했지만
--    authenticated 는 PUBLIC 멤버라 여전히 호출 가능. PUBLIC 까지 revoke 해야 진짜 차단.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.settle_prediction_round(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_prediction_round(TEXT, TEXT) FROM PUBLIC;

-- ============================================================================
-- 3. mileage_reward_config_audit RLS 활성화 + 관리자 read-only 정책
--    트리거(SECURITY DEFINER) 가 INSERT 하므로 일반 사용자는 SELECT 도 차단.
-- ============================================================================
ALTER TABLE public.mileage_reward_config_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_admin_read ON public.mileage_reward_config_audit;
CREATE POLICY audit_admin_read ON public.mileage_reward_config_audit
  FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'hans@openhan.kr');

-- INSERT/UPDATE/DELETE 는 정책 없음 → SECURITY DEFINER 트리거만 허용 (RLS bypass).
