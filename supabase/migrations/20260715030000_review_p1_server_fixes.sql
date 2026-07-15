-- 2026-07-15 전체 리뷰 서버측 fix 4건.
--
-- ① [P0] notify_friends_run_started — 존재하지 않는 push_devices 참조 (42P01) 로 기능 전체
--    무음 사망. 올바른 테이블은 push_device_tokens (build 290 에서 enqueue_idle_reminders 의
--    같은 버그를 고쳤는데 재발). 클라이언트가 fire-and-forget 이라 에러가 안 보였음.
-- ② [P1] today_region_top / weekly_rank_neighbors — 걷기 미제외 (build 296 "랭킹=러닝만"
--    계약 위반). 걷기 opt-in 유저의 산책이 동네 TOP·주변 러너 km 에 잡혀 hero 랭킹과 모순.
-- ③ [P1] notify_rival_on_activity — dedup 없음: Apple Health 일괄 import N건 → 페이스메이커에게
--    N발 폭탄. KST 하루 1회 dedup + 걷기 제외 추가.
-- ④ [P1] enqueue_friend_overtake_pushes — should_send_push 미체크 (설정 꺼도 발송되는 유일한
--    producer) + 한국어 전용 문구 + week_start UTC. 3개 모두 fix, 거리 집계도 러닝만.

-- ① push_device_tokens 로 교정
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

  -- 러너당 하루 1회 (KST)
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
       -- 2026-07-15 P0 fix: push_devices (존재하지 않음, 42P01) → push_device_tokens
       AND EXISTS (SELECT 1 FROM public.push_device_tokens pd WHERE pd.user_id = f.follower_id AND pd.enabled = true)
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

-- ② 동네 TOP — 러닝만
CREATE OR REPLACE FUNCTION public.today_region_top(target_si TEXT, top_n INT DEFAULT 10)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  today_km NUMERIC,
  rank_position INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH today AS (
    SELECT a.user_id, SUM(a.distance_km) AS km
    FROM activities a
    JOIN profiles p ON p.id = a.user_id
    WHERE region_sido_norm(p.region_si) = region_sido_norm(target_si)
      AND region_sido_norm(target_si) IS NOT NULL
      AND p.is_public = true
      AND a.visibility = 'public'
      AND COALESCE(a.activity_type, 'running') = 'running'  -- build 296 계약: 랭킹=러닝만
      AND a.activity_date = (NOW() AT TIME ZONE 'Asia/Seoul')::DATE
    GROUP BY a.user_id
  )
  SELECT
    t.user_id,
    p.display_name,
    p.avatar_url,
    t.km,
    RANK() OVER (ORDER BY t.km DESC)::INT
  FROM today t
  JOIN profiles p ON p.id = t.user_id
  ORDER BY t.km DESC
  LIMIT top_n;
$$;

-- ② 주변 러너 — 러닝만
CREATE OR REPLACE FUNCTION public.weekly_rank_neighbors(target_user_id uuid, neighbor_count integer DEFAULT 3)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, region_gu text, weekly_km numeric, rank_position integer, is_me boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  u_si_norm TEXT;
  week_start DATE := DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Seoul')::DATE)::DATE;
BEGIN
  SELECT region_sido_norm(region_si) INTO u_si_norm FROM profiles WHERE id = target_user_id;

  RETURN QUERY
  WITH scope_users AS (
    SELECT p.id, p.display_name, p.avatar_url, p.region_gu
    FROM profiles p
    WHERE p.is_public = true
      AND (
        (u_si_norm IS NOT NULL AND region_sido_norm(p.region_si) = u_si_norm)
        OR (u_si_norm IS NULL)
      )
  ),
  weekly AS (
    SELECT s.id, s.display_name, s.avatar_url, s.region_gu,
           COALESCE(SUM(a.distance_km), 0) AS km
    FROM scope_users s
    LEFT JOIN activities a ON a.user_id = s.id AND a.visibility = 'public'
      AND COALESCE(a.activity_type, 'running') = 'running'  -- build 296 계약: 랭킹=러닝만
      AND a.activity_date >= week_start
    GROUP BY s.id, s.display_name, s.avatar_url, s.region_gu
  ),
  ranked AS (
    SELECT w.*, RANK() OVER (ORDER BY km DESC, id) AS r
    FROM weekly w
  ),
  my_row AS (
    SELECT r FROM ranked WHERE id = target_user_id LIMIT 1
  )
  SELECT
    ranked.id,
    ranked.display_name,
    ranked.avatar_url,
    ranked.region_gu,
    ranked.km,
    ranked.r::INT,
    (ranked.id = target_user_id)
  FROM ranked, my_row
  WHERE ranked.r BETWEEN GREATEST(my_row.r - neighbor_count, 1) AND my_row.r + neighbor_count
  ORDER BY ranked.r;
END;
$function$;

-- ③ 페이스메이커 활동 push — KST 하루 1회 dedup + 걷기 제외
CREATE OR REPLACE FUNCTION public.notify_rival_on_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month text;
  v_rival_id uuid;
  v_actor_name text;
BEGIN
  IF NEW.visibility <> 'public' OR NEW.distance_km < 0.5 THEN
    RETURN NEW;
  END IF;
  -- 걷기는 경쟁 신호 아님 (build 296 계약)
  IF COALESCE(NEW.activity_type, 'running') <> 'running' THEN
    RETURN NEW;
  END IF;

  v_month := to_char((NEW.activity_date)::date, 'YYYY-MM');

  SELECT opponent_id INTO v_rival_id FROM monthly_rivals
  WHERE user_id = NEW.user_id AND month = v_month
  LIMIT 1;
  IF v_rival_id IS NULL THEN RETURN NEW; END IF;

  IF NOT should_send_push(v_rival_id, 'social_rival') THEN RETURN NEW; END IF;

  -- 2026-07-15: 같은 페이스메이커에 대해 KST 하루 1회만 — Apple Health 일괄 import
  -- (N건 연속 INSERT) 시 N발 폭탄 방지.
  IF EXISTS (
    SELECT 1 FROM push_send_log
     WHERE user_id = v_rival_id
       AND category = 'social_rival'
       AND payload ->> 'kind' = 'rival_activity'
       AND payload ->> 'rival_id' = NEW.user_id::text
       AND created_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_actor_name FROM profiles WHERE id = NEW.user_id;
  IF v_actor_name IS NULL THEN
    v_actor_name := public.push_text(v_rival_id, '페이스메이커', 'Your pacemaker');
  END IF;

  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  VALUES (
    v_rival_id,
    'social_rival',
    public.push_text(v_rival_id,
      '⚔️ 페이스메이커가 뛰었어요',
      '⚔️ Your pacemaker just ran'),
    public.push_text(v_rival_id,
      v_actor_name || '님이 ' || ROUND(NEW.distance_km::numeric, 1) || 'km 뛰었어요. 따라잡아볼까요?',
      v_actor_name || ' ran ' || ROUND(NEW.distance_km::numeric, 1) || 'km. Time to catch up?'),
    jsonb_build_object('kind', 'rival_activity', 'rival_id', NEW.user_id, 'distance_km', NEW.distance_km,
      'deep_link', '/'),
    'pending'
  );
  RETURN NEW;
END;
$function$;

-- ④ 친구 추월 push — 설정 존중 + 이중 언어 + KST 주 시작 + 러닝만
CREATE OR REPLACE FUNCTION public.enqueue_friend_overtake_pushes(my_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$ #variable_conflict use_column
DECLARE
  my_name TEXT; my_km NUMERIC; friend_rec RECORD; enqueued INT := 0; week_start DATE;
  v_safe TEXT;
BEGIN
  -- 2026-07-15: CURRENT_DATE(UTC) → KST (00~09시 KST 에 주 경계 밀림 방지)
  week_start := DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Seoul')::DATE)::DATE;
  SELECT display_name INTO my_name FROM public.profiles WHERE id = my_user_id;
  -- build 236 #H1: 닉네임 피싱 방지
  v_safe := regexp_replace(LEFT(COALESCE(my_name, '러너'), 24), '[[:cntrl:]]', '', 'g');
  SELECT COALESCE(SUM(distance_km), 0) INTO my_km FROM public.activities
   WHERE user_id = my_user_id AND activity_date >= week_start
     AND COALESCE(activity_type, 'running') = 'running';
  FOR friend_rec IN
    SELECT f.following_id AS friend_id, p.display_name AS friend_name,
           COALESCE((SELECT SUM(a.distance_km) FROM public.activities a
                      WHERE a.user_id = f.following_id AND a.activity_date >= week_start
                        AND COALESCE(a.activity_type, 'running') = 'running'), 0) AS friend_km
    FROM public.follows f JOIN public.profiles p ON p.id = f.following_id
    WHERE f.follower_id = my_user_id
  LOOP
    IF friend_rec.friend_km > 0 AND friend_rec.friend_km < my_km THEN
      -- 2026-07-15: 유일하게 should_send_push 미체크였던 producer — 설정 존중
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
