-- 푸시 알림 인프라 — APN/FCM 디바이스 토큰 저장 + 발송 로그.
--
-- 발송 흐름:
-- 1. iOS 앱 부팅 → @capacitor/push-notifications 권한 요청 → 토큰 받음
-- 2. 클라가 register_device_token RPC 호출 → push_device_tokens insert
-- 3. 주문 상태 변경 (paid/shipped 등) → trigger 또는 server function 이 send_push 호출
-- 4. send_push 가 APN HTTPS API 로 발송 + push_send_log 에 기록
--
-- 발송 자체는 Supabase Edge Function 또는 Vercel API route 에서 .p8 키로 ES256 JWT 서명.
-- 이 마이그레이션은 데이터 모델만 다룸.

CREATE TABLE IF NOT EXISTS public.push_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token TEXT NOT NULL,
  bundle_id TEXT,
  device_name TEXT,
  app_build TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 같은 (user, platform, token) 중복 방지 — 같은 디바이스 재등록 시 last_seen_at 만 갱신
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_uniq
  ON public.push_device_tokens(user_id, platform, token);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx
  ON public.push_device_tokens(user_id) WHERE enabled = true;

ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_tokens_select_own ON public.push_device_tokens;
CREATE POLICY push_tokens_select_own ON public.push_device_tokens
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS push_tokens_insert_own ON public.push_device_tokens;
CREATE POLICY push_tokens_insert_own ON public.push_device_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS push_tokens_update_own ON public.push_device_tokens;
CREATE POLICY push_tokens_update_own ON public.push_device_tokens
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS push_tokens_delete_own ON public.push_device_tokens;
CREATE POLICY push_tokens_delete_own ON public.push_device_tokens
  FOR DELETE USING (auth.uid() = user_id);

------------------------------------------------------------
-- 발송 로그 (운영 추적용)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  device_token_id UUID REFERENCES public.push_device_tokens(id) ON DELETE SET NULL,
  category TEXT NOT NULL,           -- 'order_paid' | 'order_shipped' | 'order_delivered' | 'mileage_award' | ...
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,    -- click action, deep link 등
  status TEXT NOT NULL DEFAULT 'pending'         -- 'pending' | 'sent' | 'failed' | 'skipped'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_send_log_user_idx
  ON public.push_send_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS push_send_log_category_idx
  ON public.push_send_log(category, created_at DESC);

ALTER TABLE public.push_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_log_select_own ON public.push_send_log;
CREATE POLICY push_log_select_own ON public.push_send_log
  FOR SELECT USING (auth.uid() = user_id OR public.is_shop_admin());

------------------------------------------------------------
-- RPC: 디바이스 토큰 등록 / 갱신 (멱등)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_device_token(
  p_platform TEXT,
  p_token TEXT,
  p_bundle_id TEXT DEFAULT NULL,
  p_device_name TEXT DEFAULT NULL,
  p_app_build TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF p_platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION '지원하지 않는 플랫폼: %', p_platform;
  END IF;
  IF p_token IS NULL OR length(p_token) < 10 THEN
    RAISE EXCEPTION '잘못된 토큰';
  END IF;

  INSERT INTO public.push_device_tokens
    (user_id, platform, token, bundle_id, device_name, app_build, enabled, last_seen_at)
  VALUES
    (v_user_id, p_platform, p_token, p_bundle_id, p_device_name, p_app_build, true, NOW())
  ON CONFLICT (user_id, platform, token) DO UPDATE
     SET enabled = true,
         last_seen_at = NOW(),
         bundle_id = COALESCE(EXCLUDED.bundle_id, public.push_device_tokens.bundle_id),
         device_name = COALESCE(EXCLUDED.device_name, public.push_device_tokens.device_name),
         app_build = COALESCE(EXCLUDED.app_build, public.push_device_tokens.app_build),
         updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.register_device_token(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_device_token(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

------------------------------------------------------------
-- RPC: 토큰 비활성화 (로그아웃 시)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unregister_device_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN false; END IF;
  UPDATE public.push_device_tokens
     SET enabled = false, updated_at = NOW()
   WHERE user_id = v_user_id AND token = p_token;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.unregister_device_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unregister_device_token(TEXT) TO authenticated;

------------------------------------------------------------
-- 트리거: 주문 상태 변경 → push_send_log 큐잉
-- (실제 발송은 Edge Function 또는 cron 이 큐 polling)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_order_push_queue() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_category TEXT;
BEGIN
  -- 상태 변경된 경우만
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'paid' THEN
      v_category := 'order_paid';
      v_title := '주문 결제 완료';
      v_body := COALESCE(NEW.order_no, '주문') || ' 결제가 완료됐어요. 곧 발송됩니다 🚚';
    ELSIF NEW.status = 'shipped' THEN
      v_category := 'order_shipped';
      v_title := '발송 완료';
      v_body := COALESCE(NEW.order_no, '주문') || ' 발송됐어요! ' ||
                COALESCE(NEW.tracking_carrier, '') || ' ' || COALESCE(NEW.tracking_no, '');
    ELSIF NEW.status = 'delivered' THEN
      v_category := 'order_delivered';
      v_title := '배송 완료';
      v_body := COALESCE(NEW.order_no, '주문') || ' 배송이 완료됐어요. 잘 받으셨나요? 📦';
    ELSIF NEW.status = 'cancelled' OR NEW.status = 'refunded' THEN
      v_category := 'order_cancelled';
      v_title := '주문 ' || CASE NEW.status WHEN 'refunded' THEN '환불' ELSE '취소' END;
      v_body := COALESCE(NEW.order_no, '주문') || ' 처리가 완료됐어요';
    ELSE
      RETURN NEW;
    END IF;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (NEW.user_id, v_category, v_title, v_body,
       jsonb_build_object('order_id', NEW.id, 'order_no', NEW.order_no, 'deep_link', '/shop/order?id=' || NEW.id),
       'pending');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_push ON public.orders;
CREATE TRIGGER trg_order_push
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_order_push_queue();
