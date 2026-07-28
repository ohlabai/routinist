-- build 327 (2026-07-28, hans): 추월 푸시 = "진짜 역전 순간"에만.
--
-- 기존: 주간(월요일 시작, KST) 누적 비교는 맞았지만, 발송 조건이 "내가 뛴 뒤 친구보다
-- 앞서 있으면" 이라 이미 앞선 상태에서 매일 뛰어도 24h 디바운스마다 재발송 —
-- 사용자에겐 일간 알림 폭탄으로 체감 (hans 신고).
--
-- 변경: "이번 러닝으로 순위가 뒤집힌 경우"만 발송 (crossing detection).
--   crossing = (내 주간누적 - 방금 러닝 거리) <= 친구 주간누적 < 내 주간누적
--   즉 이 러닝 전엔 뒤(또는 동률)였는데 이 러닝으로 앞선 순간.
--   역전의 역전도 각각 진짜 crossing 이므로 그대로 발송 — 주간 엎치락뒤치락 재미 유지.
CREATE OR REPLACE FUNCTION public.enqueue_friend_overtake_pushes(my_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$ #variable_conflict use_column
DECLARE
  my_name TEXT; my_km NUMERIC; friend_rec RECORD; enqueued INT := 0; week_start DATE;
  v_safe TEXT; v_last_km NUMERIC;
BEGIN
  -- KST 주 시작 (월요일) — 2026-07-15 fix 유지
  week_start := DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Seoul')::DATE)::DATE;
  SELECT display_name INTO my_name FROM public.profiles WHERE id = my_user_id;
  v_safe := regexp_replace(LEFT(COALESCE(my_name, '러너'), 24), '[[:cntrl:]]', '', 'g');
  SELECT COALESCE(SUM(distance_km), 0) INTO my_km FROM public.activities
   WHERE user_id = my_user_id AND activity_date >= week_start
     AND COALESCE(activity_type, 'running') = 'running';

  -- 방금 저장된 러닝 (이 함수는 저장 직후 fire-and-forget 호출됨) — crossing 판정 기준
  SELECT COALESCE(distance_km, 0) INTO v_last_km FROM public.activities
   WHERE user_id = my_user_id AND activity_date >= week_start
     AND COALESCE(activity_type, 'running') = 'running'
   ORDER BY created_at DESC LIMIT 1;
  IF v_last_km IS NULL OR v_last_km <= 0 THEN RETURN 0; END IF;

  FOR friend_rec IN
    SELECT f.following_id AS friend_id, p.display_name AS friend_name,
           COALESCE((SELECT SUM(a.distance_km) FROM public.activities a
                      WHERE a.user_id = f.following_id AND a.activity_date >= week_start
                        AND COALESCE(a.activity_type, 'running') = 'running'), 0) AS friend_km
    FROM public.follows f JOIN public.profiles p ON p.id = f.following_id
    WHERE f.follower_id = my_user_id
  LOOP
    -- crossing 조건: 이 러닝 전엔 친구가 앞(동률 포함)이었고, 지금은 내가 앞
    IF friend_rec.friend_km > 0
       AND friend_rec.friend_km < my_km
       AND friend_rec.friend_km >= my_km - v_last_km THEN
      IF NOT public.should_send_push(friend_rec.friend_id, 'friend_overtake') THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.push_send_log WHERE user_id = friend_rec.friend_id AND category = 'friend_overtake'
          AND (payload->>'overtaker_id') = my_user_id::text AND created_at > NOW() - INTERVAL '24 hours') THEN
        INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
        VALUES (friend_rec.friend_id, 'friend_overtake',
          public.push_text(friend_rec.friend_id, '⚡ 추월당했어요!', '⚡ You got passed!'),
          public.push_text(friend_rec.friend_id,
            v_safe || '님이 이번 주 ' || ROUND(my_km, 1)::text || 'km로 앞섰어요',
            v_safe || ' pulled ahead with ' || ROUND(my_km, 1)::text || 'km this week'),
          jsonb_build_object('overtaker_id', my_user_id::text, 'my_km', my_km, 'friend_km', friend_rec.friend_km,
            'deep_link', '/ranking'),
          'pending');
        enqueued := enqueued + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN enqueued;
END;
$function$;
