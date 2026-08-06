-- 2026-08-06 보안 긴급 (전체 리뷰 P0 4건): anon/authenticated 로 노출된 파괴적 SECURITY DEFINER 함수 차단.
--
-- 근본 원인: Supabase 는 public 스키마 함수에 anon/authenticated EXECUTE 를 기본 부여한다.
-- 과거 마이그들이 `REVOKE ALL ... FROM PUBLIC` 만 해서 무력했음 (reference_supabase_function_privilege 룰의 재발).
-- 라이브 실측 (has_function_privilege) 로 anon_exec=true 확인된 것만 나열.
--
-- 실제 위험:
--   admin_cascade_delete_user  — 공개 anon key 로 임의 회원 계정+데이터 전삭제 (가드 전무)
--   award_run_mileage / spend_mileage / award_mileage / award_distance_mileage — 마일리지 무제한 발행·타인 잔액 차감
--                                (mileage 는 자체 쇼핑몰 실결제에 사용 → 금전 피해)
--   purge_old_client_error_logs(0) — 공격 흔적 인멸
--   settle_prediction_round / create_prediction_round — 라이벌 정산 임의 실행

-- 1. 파괴적 함수 전면 차단 (service_role 만 — cron/서버가 service_role 로 호출)
REVOKE ALL ON FUNCTION public.admin_cascade_delete_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_run_mileage(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spend_mileage(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_mileage(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_distance_mileage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_client_error_logs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_prediction_round(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_prediction_round(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._recompute_profile_this_month(uuid) FROM PUBLIC, anon, authenticated;

-- 2. 심층 방어: admin_cascade_delete_user 본체에 호출자 가드.
--    (권한 회수만으로 끝내지 않는다 — 향후 GRANT 실수 재발 대비. 본체는 무변경, 가드만 추가)
CREATE OR REPLACE FUNCTION public.admin_cascade_delete_user(target_uid uuid)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  deleted_tables text[] := ARRAY[]::text[];
  rows_count bigint;
  total_rows bigint := 0;
BEGIN
  -- 2026-08-06: service_role (서버/cron) 또는 shop admin 만. 그 외 롤은 즉시 거절.
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT COALESCE(public.is_shop_admin(), false) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  FOR r IN
    SELECT
      ns.nspname  AS schema_name,
      cl.relname  AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cl  ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_attribute att ON att.attrelid = cl.oid
                          AND att.attnum = ANY(con.conkey)
    JOIN pg_class refcl ON refcl.oid = con.confrelid
    JOIN pg_namespace refns ON refns.oid = refcl.relnamespace
    WHERE con.contype = 'f'
      AND refns.nspname = 'auth'
      AND refcl.relname = 'users'
      AND ns.nspname IN ('public')
  LOOP
    EXECUTE format('DELETE FROM %I.%I WHERE %I = $1',
                   r.schema_name, r.table_name, r.column_name)
            USING target_uid;
    GET DIAGNOSTICS rows_count = ROW_COUNT;
    IF rows_count > 0 THEN
      deleted_tables := array_append(deleted_tables,
        format('%s.%s(%s)=%s', r.schema_name, r.table_name, r.column_name, rows_count));
      total_rows := total_rows + rows_count;
    END IF;
  END LOOP;

  DELETE FROM auth.users WHERE id = target_uid;
  GET DIAGNOSTICS rows_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'auth_user_deleted', rows_count,
    'rows_cleaned', total_rows,
    'tables', to_jsonb(deleted_tables)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

REVOKE ALL ON FUNCTION public.admin_cascade_delete_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cascade_delete_user(uuid) TO service_role;

-- 3. 푸시 트리거 RPC: 파라미터 신뢰 제거 — 임의 유저 대상 푸시 유발 차단.
--    시그니처는 클라 호출부 호환 위해 유지하되, 로그인 호출자면 auth.uid() 로 강제 치환.
--    (본문은 prod 정의 그대로. 상단 가드 블록만 추가)
CREATE OR REPLACE FUNCTION public.enqueue_friend_overtake_pushes(my_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ #variable_conflict use_column
DECLARE
  my_name TEXT; my_km NUMERIC; friend_rec RECORD; enqueued INT := 0; week_start DATE;
  v_safe TEXT; v_last_km NUMERIC;
  v_caller uuid := auth.uid();
BEGIN
  -- 2026-08-06 보안: 전달된 uuid 무시 — 로그인 사용자는 본인 것만. 익명 호출은 거절.
  IF v_caller IS NOT NULL THEN
    my_user_id := v_caller;
  ELSIF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN 0;
  END IF;

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

CREATE OR REPLACE FUNCTION public.enqueue_my_milestone_pushes(my_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ #variable_conflict use_column
DECLARE
  enqueued INT := 0; v_rank INT; v_label TEXT; v_best NUMERIC;
  v_caller uuid := auth.uid();
BEGIN
  -- 2026-08-06 보안: 위와 동일 — 남의 uuid 로 푸시 유발 차단.
  IF v_caller IS NOT NULL THEN
    my_user_id := v_caller;
  ELSIF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN 0;
  END IF;

  BEGIN
    SELECT rank_position, scope_label INTO v_rank, v_label
      FROM public.find_hero_rank(my_user_id, 'month') LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_rank := NULL;
  END;
  IF v_rank = 1 AND v_label IS NOT NULL
     AND public.should_send_push(my_user_id, 'first_place_month') THEN
    IF NOT EXISTS (SELECT 1 FROM public.push_send_log
        WHERE user_id = my_user_id AND category = 'first_place_month'
          AND (payload->>'scope_label') = v_label
          AND created_at >= (date_trunc('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::timestamp
                             AT TIME ZONE 'Asia/Seoul')) THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (my_user_id, 'first_place_month', '👑 ' || v_label || ' 1위!',
        '이번 달 ' || v_label || '에서 1위에 올랐어요',
        jsonb_build_object('scope_label', v_label, 'deep_link', '/ranking'), 'pending');
      enqueued := enqueued + 1;
    END IF;
  END IF;

  SELECT MAX(distance_km) INTO v_best FROM public.activities WHERE user_id = my_user_id;
  IF v_best IS NOT NULL AND v_best >= 10
     AND public.should_send_push(my_user_id, 'pb_distance') THEN
    IF NOT EXISTS (SELECT 1 FROM public.push_send_log
        WHERE user_id = my_user_id AND category = 'pb_distance'
          AND ((payload->>'distance_km')::NUMERIC) >= v_best) THEN
      INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
      VALUES (my_user_id, 'pb_distance', '🎉 새로운 최장 거리!',
        ROUND(v_best, 1)::text || 'km — 신기록 달성!',
        jsonb_build_object('distance_km', v_best, 'deep_link', '/awards'), 'pending');
      enqueued := enqueued + 1;
    END IF;
  END IF;
  RETURN enqueued;
END;
$function$;
