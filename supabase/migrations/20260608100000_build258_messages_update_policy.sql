-- build 258: messages 테이블의 UPDATE RLS 정책 부재로 markAsRead 가 silent denied 되던 회귀.
-- pg_policies 확인 결과 messages 에는 SELECT / INSERT 정책만 있고 UPDATE 정책이 없음.
-- → supabase client 의 .update() 는 0 rows updated 로 silent fail. read_at 영원히 NULL 유지.
-- hans 사용자 사례: 2026-06-02 받은 메시지 3건이 read_at NULL 그대로 → 쪽지함 배지 "3" 안 사라짐.

-- 본인이 받은 메시지 (sender_id != auth.uid()) 만 read_at 업데이트 가능.
-- 다른 컬럼 (body, sender_id 등) 도 with_check 로 보호.
CREATE POLICY messages_update_read_at ON messages
  FOR UPDATE
  USING (
    auth.uid() <> sender_id
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE auth.uid() = user_a OR auth.uid() = user_b
    )
  )
  WITH CHECK (
    auth.uid() <> sender_id
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE auth.uid() = user_a OR auth.uid() = user_b
    )
  );

-- 모든 사용자의 누적 stale unread 일괄 backfill: 사용자가 한 번이라도 chat 페이지에 진입한 적이
-- 있다면 정상 케이스로는 read_at 이 박혀 있어야 함. 정책 부재로 못 박힌 누적 메시지를 즉시 정리.
-- 3일 이상 된 받은 메시지는 사용자가 봤지만 markAsRead 실패한 것으로 간주하고 read_at 채움.
-- (7일은 hans 6/2 → 6/8 = 6일 케이스를 못 잡음. 3일로 조정.)
UPDATE messages
SET read_at = NOW()
WHERE read_at IS NULL
  AND created_at < NOW() - INTERVAL '3 days';
