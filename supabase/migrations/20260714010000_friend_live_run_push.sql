-- 2026-07-14: 친구 라이브 러닝 push — GPS '지금 달리기' 시작 시 친구들에게 알림.
-- (사용자 결정: 완료 시점이 아니라 시작 시점만. "hans님이 지금 달리는 중 🏃 응원 보내볼까요?")
--
-- 노이즈 가드 3중:
--   ① 러너당 하루 1회 (KST) — push_send_log 의 오늘 friend_live_run 존재 여부로 dedup
--   ② 수신자 push 설정 존중 — should_send_push(uid, 'friend_live_run') (기본 ON, 설정에서 OFF 가능)
--   ③ 비공개 프로필 러너는 발송 안 함
-- 대상 = 나를 친구로 추가한 사람 (follows.following_id = 러너). push 기기 등록자만.
-- 인앱 알림함에는 안 남김 — "지금 달리는 중" 은 지나가면 의미 없는 라이브 신호.

CREATE OR REPLACE FUNCTION public.notify_friends_run_started()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_runner UUID := auth.uid();
  v_name TEXT;
  v_is_public BOOLEAN;
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  IF v_runner IS NULL THEN RETURN 0; END IF;

  SELECT display_name, COALESCE(is_public, true) INTO v_name, v_is_public
    FROM public.profiles WHERE id = v_runner;
  IF NOT FOUND OR NOT v_is_public THEN RETURN 0; END IF;
  IF v_name IS NULL OR length(v_name) = 0 THEN v_name := '러너'; END IF;

  -- ① 러너당 하루 1회 (KST)
  IF EXISTS (
    SELECT 1 FROM public.push_send_log
     WHERE category = 'friend_live_run'
       AND payload ->> 'runner_id' = v_runner::text
       AND created_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul'
  ) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT DISTINCT f.follower_id AS uid
      FROM public.follows f
     WHERE f.following_id = v_runner
       AND f.follower_id <> v_runner
       AND EXISTS (SELECT 1 FROM public.push_devices pd WHERE pd.user_id = f.follower_id AND pd.enabled = true)
  LOOP
    IF NOT public.should_send_push(r.uid, 'friend_live_run') THEN CONTINUE; END IF;
    INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
    VALUES (
      r.uid,
      'friend_live_run',
      public.push_text(r.uid, v_name || '님이 지금 달리는 중 🏃', v_name || ' is running right now 🏃'),
      public.push_text(r.uid, '응원 한 번 보내볼까요?', 'Send them a cheer!'),
      jsonb_build_object(
        'kind', 'friend_live_run',
        'runner_id', v_runner::text,
        'deep_link', '/social/user?id=' || v_runner::text
      ),
      'pending'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.notify_friends_run_started() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_friends_run_started() FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_friends_run_started() TO authenticated, service_role;
