-- 2026-04-29 일회성 정리 — 중복 가입된 Apple 계정 삭제
-- 본인 Google(hans@openhan.kr) 와 데이터가 동일(58 activities ⊂ 282).
-- A안 — Google 메인, Apple 계정 폐기.
--
-- 사전 조건: migrations/20260429120000_login_cleanup.sql 적용 완료
--           (admin_cascade_delete_user 함수 존재).
-- 실행: service_role 권한으로 1회만.
SELECT public.admin_cascade_delete_user('1350f5a4-89da-4656-8ccb-753a200c5da0'::uuid);
