-- 친구 신청 중복 방지 (2026-07-26 hans: "친구추가를 여러번 누를 수 있나?")
--
-- 기존 send_friend_request 는 자기자신·이미친구 체크만 있고 pending 중복 가드가 없었음
-- → 화면 두 개 / 기기 두 대 / 레이스에서 같은 쌍의 pending 이 여러 개 쌓일 수 있는 구조
--   (수신자 알림함에 신청 카드가 중복으로 뜸). 현재 데이터엔 중복 없음 (검증 완료).
--
-- fix:
--   1) (sender, receiver) pending 부분 유니크 인덱스 — DB 레벨 차단.
--   2) RPC 멱등화 — 같은 방향 pending 있으면 그 id 반환 (에러 아님. 재탭 안전).
--   3) 역방향 pending 있으면 친근 안내 — "상대가 이미 보냈어요, 수락해보세요".

CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_unique
  ON public.friend_requests (sender_id, receiver_id)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.send_friend_request(p_receiver_id uuid, p_message text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sender uuid := auth.uid();
  v_request_id uuid;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF v_sender = p_receiver_id THEN
    RAISE EXCEPTION '자기 자신에게 친구 신청은 보낼 수 없어요';
  END IF;
  -- 이미 양방향 follow 면 친구 상태 — 신청 의미 없음
  IF EXISTS (
    SELECT 1 FROM follows f1
    JOIN follows f2 ON f2.follower_id = f1.following_id AND f2.following_id = f1.follower_id
    WHERE f1.follower_id = v_sender AND f1.following_id = p_receiver_id
  ) THEN
    RAISE EXCEPTION '이미 친구예요';
  END IF;
  -- 같은 방향 pending 이미 있으면 그 id 반환 (멱등 — 중복 탭/이중 화면 안전, 알림 재발송 없음)
  SELECT id INTO v_request_id FROM friend_requests
   WHERE sender_id = v_sender AND receiver_id = p_receiver_id AND status = 'pending';
  IF FOUND THEN RETURN v_request_id; END IF;
  -- 역방향 pending 있으면 수락 유도 (내가 또 보내는 것보다 훨씬 빠른 길)
  IF EXISTS (
    SELECT 1 FROM friend_requests
     WHERE sender_id = p_receiver_id AND receiver_id = v_sender AND status = 'pending'
  ) THEN
    RAISE EXCEPTION '상대가 이미 친구 신청을 보냈어요! 알림함에서 수락해보세요 💌';
  END IF;
  INSERT INTO friend_requests (sender_id, receiver_id, message)
  VALUES (v_sender, p_receiver_id, p_message)
  ON CONFLICT (sender_id, receiver_id) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_request_id;
  -- 동시성 레이스로 INSERT 가 스킵됐으면 기존 pending 반환
  IF v_request_id IS NULL THEN
    SELECT id INTO v_request_id FROM friend_requests
     WHERE sender_id = v_sender AND receiver_id = p_receiver_id AND status = 'pending';
  END IF;
  RETURN v_request_id;
END;
$function$;
