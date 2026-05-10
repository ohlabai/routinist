-- 2026-05-06: 클라이언트 에러 로그 (Sentry 대안 — Supabase 자체 호스팅)
-- 사용자 폰에서 발생하는 sync 실패, RPC 타임아웃, 권한 거부 등을 서버에 모음.
-- 향후 admin SQL 로 패턴 분석 가능.

CREATE TABLE IF NOT EXISTS public.client_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL,           -- 'health-sync' | 'auth' | 'ranking-rpc' | 'map' 등
  level TEXT NOT NULL DEFAULT 'error',  -- 'error' | 'warn' | 'info'
  message TEXT NOT NULL,
  details JSONB,                 -- 자유형 컨텍스트 (workout count, error stack 등)
  platform TEXT,                 -- 'ios' | 'android' | 'web'
  app_version TEXT,              -- build 번호 등
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cel_user_time ON public.client_error_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cel_scope_time ON public.client_error_logs(scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cel_level_time ON public.client_error_logs(level, created_at DESC) WHERE level = 'error';

ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;

-- 누구나 자기 user_id 로 INSERT 가능 (anon key 로 가능하게 user_id 가 NULL 도 허용)
DROP POLICY IF EXISTS "client_error_logs_insert" ON public.client_error_logs;
CREATE POLICY "client_error_logs_insert" ON public.client_error_logs FOR INSERT
  WITH CHECK (
    user_id IS NULL OR auth.uid() = user_id
  );

-- 본인 로그만 자기가 조회 가능 + 앱 관리자(hans@openhan.kr) 는 모두 조회
DROP POLICY IF EXISTS "client_error_logs_select" ON public.client_error_logs;
CREATE POLICY "client_error_logs_select" ON public.client_error_logs FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'hans@openhan.kr'
  );

-- 자동 정리 (30일 보관) — pg_cron 미사용 환경 대비, 그냥 RPC 로 수동 실행 가능하게 두기
CREATE OR REPLACE FUNCTION public.purge_old_client_error_logs(p_days INT DEFAULT 30)
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM public.client_error_logs
   WHERE created_at < NOW() - (p_days || ' days')::INTERVAL
  RETURNING 1 INTO deleted_count;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.purge_old_client_error_logs(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_client_error_logs(INT) TO authenticated;
