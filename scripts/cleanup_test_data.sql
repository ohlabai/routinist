-- 2026-05-13 build 106 — 테스트 데이터 정리
-- 보존: hans@openhan.kr + demo@routinist.kr 두 계정만.
-- 외 모든 사용자 + 외부 import 클럽 멤버 삭제.
--
-- 실행 전 반드시 백업 권장:
--   supabase 대시보드 > Backups > 점심 시점 snapshot 확인
--
-- 실행 흐름:
--   (1) PREVIEW — DELETE 없는 카운트만
--   (2) 사용자 확인 후
--   (3) DELETE 실행
--   (4) 잔여 확인

-- ─────────────────────────────────────────────
-- (1) PREVIEW — 삭제 영향 카운트
-- ─────────────────────────────────────────────
WITH keep AS (
  SELECT id FROM auth.users WHERE email IN ('hans@openhan.kr', 'demo@routinist.kr')
)
SELECT
  (SELECT COUNT(*) FROM auth.users) AS total_users,
  (SELECT COUNT(*) FROM auth.users WHERE id IN (SELECT id FROM keep)) AS keep_users,
  (SELECT COUNT(*) FROM auth.users WHERE id NOT IN (SELECT id FROM keep)) AS delete_users,
  (SELECT COUNT(*) FROM public.activities WHERE user_id NOT IN (SELECT id FROM keep)) AS delete_activities,
  (SELECT COUNT(*) FROM public.activity_photos WHERE user_id NOT IN (SELECT id FROM keep)) AS delete_photos,
  (SELECT COUNT(*) FROM public.quotes WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM keep)) AS delete_user_quotes,
  (SELECT COUNT(*) FROM public.club_members WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM keep)) AS delete_club_members_with_user,
  (SELECT COUNT(*) FROM public.club_members WHERE user_id IS NULL) AS delete_external_club_members
;

-- ─────────────────────────────────────────────
-- (2) 실제 삭제 — auth.users CASCADE 가 대부분 처리
-- ─────────────────────────────────────────────
-- 안전 — 명시적 keep 이메일 외 모든 auth.users 삭제. CASCADE 가 다음 테이블에 적용됨:
--   profiles, activities, activity_photos, photo_likes, photo_comments,
--   quotes (user_id), friends/follows, messages, orders, addresses,
--   mileage_*, notifications, calendar_photos, audit_logs, etc.
DELETE FROM auth.users
 WHERE email NOT IN ('hans@openhan.kr', 'demo@routinist.kr');

-- 외부 import (user_id IS NULL) 인 클럽 멤버 row 정리 — CASCADE 안 걸림.
DELETE FROM public.club_members WHERE user_id IS NULL;

-- ─────────────────────────────────────────────
-- (3) 잔여 확인
-- ─────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM auth.users) AS total_users_after,
  (SELECT email FROM auth.users ORDER BY created_at LIMIT 1) AS first_user_email,
  (SELECT COUNT(*) FROM public.activities) AS activities_after,
  (SELECT COUNT(*) FROM public.activity_photos) AS photos_after,
  (SELECT COUNT(*) FROM public.quotes WHERE user_id IS NOT NULL) AS user_quotes_after,
  (SELECT COUNT(*) FROM public.club_members) AS club_members_after,
  (SELECT COUNT(*) FROM public.quotes WHERE user_id IS NULL) AS official_quotes_after  -- 보존돼야 함
;
