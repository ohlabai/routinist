-- build 200: Phase 4 — 친구 PB 알림 + 클럽 챌린지 leaderboard.
-- 랭킹 위협 (enqueue_friend_overtake_pushes) 은 이미 존재 — 재활용.

-- ─── 1) 친구 PB 갱신 시 푸시 enqueue trigger ────────────────────────────
-- personal_bests INSERT/UPDATE 시 자동 호출.
-- follows.follower_id = friend (자신을 팔로우하는 사람들에게 알림).
CREATE OR REPLACE FUNCTION public.enqueue_friend_pb_pushes() RETURNS TRIGGER AS $$
DECLARE
  v_owner_name TEXT;
  v_dist_label TEXT;
  v_time_label TEXT;
  v_friend RECORD;
  v_prev_seconds INTEGER;
BEGIN
  -- INSERT 면 첫 기록 (이전 없음) → 알림 보냄
  -- UPDATE 면 best_seconds 감소했을 때만 (PB 갱신) 알림
  IF TG_OP = 'UPDATE' THEN
    IF NEW.best_seconds >= OLD.best_seconds THEN RETURN NEW; END IF;
    v_prev_seconds := OLD.best_seconds;
  ELSE
    v_prev_seconds := NULL;
  END IF;

  SELECT display_name INTO v_owner_name FROM public.profiles WHERE id = NEW.user_id;
  IF v_owner_name IS NULL THEN RETURN NEW; END IF;

  v_dist_label := CASE
    WHEN NEW.distance_meters = 42195 THEN '풀'
    WHEN NEW.distance_meters = 21097 THEN '하프'
    WHEN NEW.distance_meters >= 1000 THEN (NEW.distance_meters / 1000) || 'km'
    ELSE NEW.distance_meters || 'm'
  END;

  -- 시간 라벨 (h:mm:ss 또는 m:ss)
  v_time_label := CASE
    WHEN NEW.best_seconds >= 3600 THEN
      (NEW.best_seconds / 3600) || ':' ||
      LPAD(((NEW.best_seconds % 3600) / 60)::TEXT, 2, '0') || ':' ||
      LPAD((NEW.best_seconds % 60)::TEXT, 2, '0')
    ELSE
      (NEW.best_seconds / 60) || ':' || LPAD((NEW.best_seconds % 60)::TEXT, 2, '0')
  END;

  -- 사용자 본인을 팔로우하는 사람 (= 친구 / 팔로워) 들에게 enqueue.
  FOR v_friend IN
    SELECT f.follower_id AS friend_id
    FROM public.follows f
    WHERE f.following_id = NEW.user_id
  LOOP
    -- 24h 중복 방지
    IF NOT EXISTS (
      SELECT 1 FROM public.push_send_log
       WHERE user_id = v_friend.friend_id
         AND category = 'friend_pb'
         AND (payload->>'pb_user_id') = NEW.user_id::text
         AND (payload->>'distance_meters') = NEW.distance_meters::text
         AND created_at > NOW() - INTERVAL '24 hours'
    ) THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (
        v_friend.friend_id, 'friend_pb',
        '🎉 친구 PB 갱신!',
        v_owner_name || '님이 ' || v_dist_label || ' ' || v_time_label || ' PB 달성',
        jsonb_build_object(
          'pb_user_id', NEW.user_id::text,
          'distance_meters', NEW.distance_meters,
          'new_seconds', NEW.best_seconds,
          'prev_seconds', v_prev_seconds,
          'activity_id', NEW.activity_id
        ),
        'pending'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_friend_pb_push ON public.personal_bests;
CREATE TRIGGER trg_friend_pb_push
  AFTER INSERT OR UPDATE ON public.personal_bests
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_friend_pb_pushes();

COMMENT ON FUNCTION public.enqueue_friend_pb_pushes() IS '친구 PB 갱신 시 follower 에게 푸시 enqueue. 24h 중복 차단.';

-- ─── 2) 클럽 챌린지 leaderboard RPC ─────────────────────────────────────
-- 현재 활성 챌린지 (now 가 start_date~end_date 안) 의 멤버별 km 합산 + 순위.
CREATE OR REPLACE FUNCTION public.get_club_challenge_leaderboard(p_challenge_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  total_km NUMERIC,
  total_runs INTEGER,
  rank_position INTEGER
) AS $$
DECLARE
  v_uid UUID;
  v_club_id UUID;
  v_start DATE;
  v_end DATE;
  v_is_member BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT cc.club_id, cc.start_date, cc.end_date INTO v_club_id, v_start, v_end
  FROM public.club_challenges cc WHERE cc.id = p_challenge_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'challenge not found'; END IF;

  -- 호출자가 해당 클럽 멤버여야 leaderboard 열람 가능
  SELECT EXISTS (
    SELECT 1 FROM public.club_members cm WHERE cm.club_id = v_club_id AND cm.user_id = v_uid
  ) INTO v_is_member;
  IF NOT v_is_member THEN RAISE EXCEPTION 'not a member of this club'; END IF;

  RETURN QUERY
  WITH member_stats AS (
    SELECT
      cm.user_id,
      p.display_name,
      p.avatar_url,
      COALESCE(SUM(a.distance_km), 0)::NUMERIC AS total_km,
      COUNT(a.id)::INTEGER AS total_runs
    FROM public.club_members cm
    JOIN public.profiles p ON p.id = cm.user_id
    LEFT JOIN public.activities a
      ON a.user_id = cm.user_id
     AND a.activity_date >= v_start
     AND a.activity_date <= v_end
     AND (a.activity_type IS NULL OR a.activity_type IN ('running'))
    WHERE cm.club_id = v_club_id
    GROUP BY cm.user_id, p.display_name, p.avatar_url
  )
  SELECT ms.user_id, ms.display_name, ms.avatar_url,
         ROUND(ms.total_km, 1), ms.total_runs,
         RANK() OVER (ORDER BY ms.total_km DESC)::INTEGER AS rank_position
    FROM member_stats ms
   ORDER BY ms.total_km DESC, ms.display_name ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_club_challenge_leaderboard(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_challenge_leaderboard(UUID) TO authenticated;

-- ─── 3) 현재 클럽의 활성 챌린지 fetch ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_club_challenges(p_club_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  target_km NUMERIC,
  target_run_count INTEGER,
  start_date DATE,
  end_date DATE,
  days_left INTEGER
) AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  RETURN QUERY
  SELECT cc.id, cc.title, cc.description, cc.target_km, cc.target_run_count,
         cc.start_date, cc.end_date, (cc.end_date - CURRENT_DATE)::INTEGER
    FROM public.club_challenges cc
   WHERE cc.club_id = p_club_id
     AND cc.end_date >= CURRENT_DATE
   ORDER BY cc.end_date ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_active_club_challenges(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_club_challenges(UUID) TO authenticated;
