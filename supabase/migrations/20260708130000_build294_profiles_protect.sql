-- build 294 긴급: profiles 민감 컬럼 직접 UPDATE 차단
--
-- 최종 리뷰 발견 (상): profiles_update_own RLS 가 컬럼 무제한이라 authenticated 가
-- PATCH /rest/v1/profiles 로 mileage_balance(실화폐)·invited_by(리퍼럴 귀속)·
-- referral_code·streak_freezes 등을 직접 위조 가능.
--
-- 판별자는 current_user (실행 중인 PG 롤):
--   · PostgREST 직접 DML → SET ROLE authenticated/anon → 차단 대상
--   · SECURITY DEFINER RPC (award_mileage/gift_mileage/claim_referral_code/use_streak_freeze
--     /update_profile_stats 등) → owner(postgres) 로 실행 → 통과
--   · service_role 서버 호출 → current_user = service_role → 통과
-- (auth.role() 은 DEFINER 함수 안에서도 JWT 기준 'authenticated' 라 판별자로 부적합)

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.mileage_balance IS DISTINCT FROM OLD.mileage_balance
       OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
       OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
       OR NEW.streak_freezes IS DISTINCT FROM OLD.streak_freezes
       OR NEW.freeze_refilled_month IS DISTINCT FROM OLD.freeze_refilled_month
       OR NEW.total_distance_km IS DISTINCT FROM OLD.total_distance_km
       OR NEW.total_runs IS DISTINCT FROM OLD.total_runs THEN
      RAISE EXCEPTION 'protected profile column cannot be updated directly';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();
