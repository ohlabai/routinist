-- 2026-05-07: client_error_logs anon spam 차단
-- 기존 정책 WITH CHECK (user_id IS NULL OR auth.uid() = user_id) → anon key 로 무제한 insert 가능
-- → authenticated 사용자로만 제한 + user_id 는 자기 자신과 일치해야

DROP POLICY IF EXISTS "client_error_logs_insert" ON public.client_error_logs;

CREATE POLICY "client_error_logs_insert" ON public.client_error_logs FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (user_id IS NULL OR auth.uid() = user_id)
  );
