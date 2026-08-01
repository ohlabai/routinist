-- 2026-08-01 hans: "자기 기록을 깼어요" (friend_pb) 알림 폐기.
-- personal_bests INSERT/UPDATE 마다 팔로워 전원에게 발송되던 트리거 — 알림 다이어트 1탄.
-- 인박스 과거 행 (user_notifications.kind='friend_pb') 은 그대로 두고 렌더만 유지.
DROP TRIGGER IF EXISTS trg_friend_pb_push ON public.personal_bests;
DROP FUNCTION IF EXISTS public.enqueue_friend_pb_pushes();

-- 아직 안 나간 대기열은 취소 (in-flight 방지)
UPDATE public.push_send_log SET status = 'cancelled'
WHERE category = 'friend_pb' AND status = 'pending';
