-- 외부 OAuth 토큰 저장 — Cafe24 access/refresh, 향후 다른 제공자 (네이버 페이 등) 도 같은 테이블 활용.
-- Vercel serverless 는 read-only 라 .env.local 갱신 불가 → DB 에 저장하고 API route 가 가져옴.
-- service_role 만 read/write, 클라 접근 차단.

CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,           -- 'cafe24'
  account_id TEXT NOT NULL,         -- mall_id (cafe24 의 경우)
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS oauth_tokens_provider_account_uniq
  ON public.oauth_tokens(provider, account_id);

-- RLS — service role 만 가능. 일반 사용자 차단.
ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;
-- 정책 없음 → authenticated/anon 은 모든 접근 차단됨. service_role 은 RLS 우회.

DROP TRIGGER IF EXISTS oauth_tokens_updated_at ON public.oauth_tokens;
CREATE TRIGGER oauth_tokens_updated_at BEFORE UPDATE ON public.oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();
