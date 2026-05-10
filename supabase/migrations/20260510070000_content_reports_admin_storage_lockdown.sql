-- 1. content_reports — 관리자(hans@openhan.kr) SELECT/UPDATE 정책 추가
--    (terms 페이지의 "24시간 안에 검토" 약속 이행 — 관리자 콘솔에서 신고 검토 가능하도록)
-- 2. storage 의 club-logos / products INSERT 정책 lockdown
--    (현재 클라이언트 코드는 업로드하지 않으나 정책이 bucket-only 로 path 가드 없어서
--     누구나 임의 파일 업로드 + 덮어쓰기 가능. service_role 운영 전용 버킷이므로 client INSERT 자체 차단.)

-- ============================================================================
-- 1. content_reports — 관리자 정책
-- ============================================================================
DROP POLICY IF EXISTS "content_reports_admin_select" ON public.content_reports;
CREATE POLICY "content_reports_admin_select" ON public.content_reports
  FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'hans@openhan.kr');

-- 관리자가 status 를 'reviewed' / 'removed' 로 변경 가능
DROP POLICY IF EXISTS "content_reports_admin_update" ON public.content_reports;
CREATE POLICY "content_reports_admin_update" ON public.content_reports
  FOR UPDATE
  USING ((auth.jwt() ->> 'email') = 'hans@openhan.kr')
  WITH CHECK ((auth.jwt() ->> 'email') = 'hans@openhan.kr');

-- ============================================================================
-- 2. storage.objects — club-logos / products INSERT 잠금
--    기존 정책: bucket_id 만 검사 → 누구나 임의 path 로 업로드/덮어쓰기 가능.
--    제거하면 RLS 가 default deny 라 client 는 INSERT 못 함. service_role 은 RLS bypass.
-- ============================================================================
DROP POLICY IF EXISTS club_logos_upload ON storage.objects;
DROP POLICY IF EXISTS products_upload ON storage.objects;

-- SELECT 정책은 그대로 유지 (public read 가 의도).
