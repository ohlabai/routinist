-- 2026-04-29: 로그인 안정화 후속 작업
-- 1) display_name trigger 강제 재정의 — 이메일 절대 사용 안 함, 미지정 시 '러너'
-- 2) auth.users 의 user 한 명을 안전하게 cascade 삭제하는 RPC — Apple/Google 중복 가입 정리용

-- ───────────────── 1. handle_new_user trigger 재정의 ─────────────────
-- 어떤 provider 든 raw_user_meta_data / user_metadata 에서 사람 이름 후보를 우선 사용,
-- email/이메일성 문자열은 닉네임으로 사용하지 않음. 깨끗한 default '러너'.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  candidate text;
BEGIN
  candidate := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_app_meta_data->>'name'
  );
  -- 이메일성 문자열(@ 포함)은 닉네임으로 부적합 → 무시
  IF candidate IS NULL OR candidate = '' OR candidate LIKE '%@%' THEN
    candidate := '러너';
  END IF;

  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, candidate)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ───────────────── 2. cascade delete user RPC ─────────────────
-- service_role 만 호출 가능. 모든 직접 FK 참조 row 삭제 후 auth.users 삭제.
CREATE OR REPLACE FUNCTION public.admin_cascade_delete_user(target_uid uuid)
RETURNS jsonb AS $$
DECLARE
  r RECORD;
  deleted_tables text[] := ARRAY[]::text[];
  rows_count bigint;
  total_rows bigint := 0;
BEGIN
  -- 1단계: auth.users.id 를 직접 참조하는 모든 FK 자동 추적 후 삭제
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

  -- 2단계: auth.users 삭제 (이제 FK 충돌 없음)
  DELETE FROM auth.users WHERE id = target_uid;
  GET DIAGNOSTICS rows_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'auth_user_deleted', rows_count,
    'rows_cleaned', total_rows,
    'tables', to_jsonb(deleted_tables)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

REVOKE ALL ON FUNCTION public.admin_cascade_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cascade_delete_user(uuid) TO service_role;

-- 1회성 데이터 정리(중복 Apple 계정 삭제)는 마이그레이션에서 분리 →
-- supabase/scripts/20260429_cleanup_apple_duplicate.sql
