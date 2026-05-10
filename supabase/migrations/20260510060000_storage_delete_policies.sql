-- storage.objects 에 DELETE 정책이 0개라 클라이언트의 storage.remove() 가 모두 거부됨.
-- 영향: PhotoCard 본인 사진 삭제 / ShareCard cleanup / delete_my_account 가 storage 객체 못 지움.
-- App Store 5.1.1(v) — "사용자 데이터 완전 삭제" 의무 부분 위반.
--
-- 해결: 본인 폴더 (path 첫 segment = auth.uid()) 만 본인이 지울 수 있도록 정책 추가.
-- service_role 은 RLS bypass 라 admin 운영은 영향 없음.

-- ============================================================================
-- DELETE 정책 — 본인 폴더만 삭제 가능 (모든 본인-소유 버킷)
-- ============================================================================
DROP POLICY IF EXISTS activity_photos_delete_own ON storage.objects;
CREATE POLICY activity_photos_delete_own ON storage.objects
  FOR DELETE
  USING (bucket_id = 'activity-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_delete_own ON storage.objects;
CREATE POLICY avatars_delete_own ON storage.objects
  FOR DELETE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS routes_delete_own ON storage.objects;
CREATE POLICY routes_delete_own ON storage.objects
  FOR DELETE
  USING (bucket_id = 'route-snapshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- UPDATE 정책 — 본인 폴더만 (avatar 교체 등 시 같은 path 로 upsert 시 필요)
-- ============================================================================
DROP POLICY IF EXISTS activity_photos_update_own ON storage.objects;
CREATE POLICY activity_photos_update_own ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'activity-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'activity-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
CREATE POLICY avatars_update_own ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS routes_update_own ON storage.objects;
CREATE POLICY routes_update_own ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'route-snapshots' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'route-snapshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- club-logos / products 는 운영 콘솔에서 service_role 로만 처리 (운영자 전용 버킷).
-- 클라이언트가 직접 DELETE 할 일 없으므로 정책 추가 안 함 → 모든 DELETE 거부 (안전).
