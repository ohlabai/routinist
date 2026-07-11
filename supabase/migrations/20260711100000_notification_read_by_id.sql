-- build 298: 알림 개별 읽음 처리 (2026-07-11 사용자 피드백)
--
-- 기존엔 /social 진입만으로 mark_notifications_read(SOCIAL_KINDS) 가 전체 발사돼,
-- 사용자가 알림 내용을 보기도 전에 배지가 사라짐 ("어디에서 알림이 떴는지 표시가 안 됨").
-- 개별 알림을 탭했을 때 그 건만 읽음 처리하는 RPC 를 추가하고,
-- 클라이언트의 진입-시-전체-읽음 자동 발사는 제거 (탭 = 확인 = 삭제).

CREATE OR REPLACE FUNCTION public.mark_notification_read_by_id(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE user_notifications
  SET read_at = NOW()
  WHERE id = p_id
    AND user_id = auth.uid()
    AND read_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

-- 권한 함정 방어 (reference_supabase_function_privilege): anon 명시 차단
REVOKE ALL ON FUNCTION public.mark_notification_read_by_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read_by_id(uuid) TO authenticated;
