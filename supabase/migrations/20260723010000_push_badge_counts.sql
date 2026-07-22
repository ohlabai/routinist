-- 푸시 배지 카운트 RPC — APNs badge 를 "실제 앱 내 미읽음" 과 통일.
--
-- 증상 (hans 2026-07-23 아침): 앱 아이콘 배지 2 인데 알림 화면엔 새 항목 없음.
-- 원인: /api/push/send 의 badge = count_in_batch (그 배치에서 그 유저에게 나간 push 개수, build 224).
--   friend_pb ×2 가 한 배치로 나가며 badge=2. 그런데 friend_pb/friend_live_run/weekly_recap 등은
--   푸시 전용 카테고리 — user_notifications 인박스 행을 만들지 않아 알림 화면은 비어 있음.
--   배지 산식(배치 개수)과 인박스(미읽음 수)가 서로 다른 세계를 세는 구조적 불일치.
-- fix: badge = user_notifications 미읽음(30일, fetch_unread_notification_summary 와 동일 창)
--   + 쪽지 미읽음 (conversations/messages) — 앱 내 layout.refreshBadges 산식과 동일.
--
-- service_role (푸시 cron) 전용 — 임의 유저의 미읽음 수 노출이므로 authenticated 도 차단.
-- (reference_supabase_function_privilege: PUBLIC 만 REVOKE 하면 anon/authenticated 에 남음)

CREATE OR REPLACE FUNCTION public.push_badge_counts(p_user_ids UUID[])
RETURNS TABLE(user_id UUID, badge INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    u.uid AS user_id,
    (
      COALESCE((
        SELECT COUNT(*) FROM user_notifications n
        WHERE n.user_id = u.uid
          AND n.read_at IS NULL
          AND n.created_at > NOW() - INTERVAL '30 days'
      ), 0)
      +
      COALESCE((
        SELECT COUNT(*) FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE (c.user_a = u.uid OR c.user_b = u.uid)
          AND m.sender_id <> u.uid
          AND m.read_at IS NULL
      ), 0)
    )::INTEGER AS badge
  FROM unnest(p_user_ids) AS u(uid);
$function$;

REVOKE ALL ON FUNCTION public.push_badge_counts(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_badge_counts(UUID[]) TO service_role;
