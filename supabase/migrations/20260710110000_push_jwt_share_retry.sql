-- push 발송 안정화 (2026-07 알림 종단 리뷰 Critical fix)
--
-- 1) push_runtime_config — APNs JWT 인스턴스 간 공유 캐시.
--    원인: 발송기의 cachedJwt 가 모듈 스코프라 Vercel 인스턴스 교체/cold start 마다
--    새 ES256 JWT 를 서명 → Apple 의 키당 20분 1회 제한 초과 → 429 TooManyProviderTokenUpdates
--    (최근 7일 sent 19 / failed 41, failed 전원 429). DB 단일행에 JWT 를 공유해
--    서명 빈도를 키당 40분 1회로 낮춘다.
--
-- 2) push_send_log.attempts — 일시 오류 (429/5xx) 재큐 횟수. 발송기가 재큐할 때 +1,
--    3 초과 시 failed 확정 (무한 재큐 방어).
--
-- ⚠️ 이 파일은 작성만 — 적용은 코디네이터가 수행.

-- 1) APNs JWT 공유 캐시 (단일행 테이블)
CREATE TABLE IF NOT EXISTS public.push_runtime_config (
  id smallint PRIMARY KEY CHECK (id = 1),
  apns_jwt text,
  apns_jwt_iat timestamptz
);

COMMENT ON TABLE public.push_runtime_config IS
  'push 발송기 런타임 상태 단일행 (id=1 고정). apns_jwt 는 인스턴스 간 공유 JWT 캐시 — 서명 빈도를 키당 40분 1회로 제한 (Apple 429 방지).';

-- RLS enable + 정책 없음: service_role (RLS bypass) 만 접근.
ALTER TABLE public.push_runtime_config ENABLE ROW LEVEL SECURITY;

-- 권한 함정 방어 (reference_supabase_function_privilege 교훈): default GRANT 가 있어도
-- RLS 무정책이 차단하지만, 명시 REVOKE 로 이중 잠금.
REVOKE ALL ON public.push_runtime_config FROM PUBLIC, anon, authenticated;

-- 시드 행 (발송기는 UPDATE 만 함 — 행이 반드시 존재해야 함)
INSERT INTO public.push_runtime_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2) 재큐 횟수 카운터
ALTER TABLE public.push_send_log ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.push_send_log.attempts IS
  '일시 오류 (APNs 429·5xx / FCM 429·5xx) 재큐 횟수. 발송기가 pending 복귀시킬 때 +1, 3 초과 시 failed 확정.';
