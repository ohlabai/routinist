-- 쇼핑 RLS / RPC 회귀 테스트 (스모크).
-- supabase Management SQL endpoint 또는 psql 로 직접 실행해 회귀 검증.
-- 모든 ASSERT 가 통과하면 OK. 실패 시 RAISE EXCEPTION 으로 멈춤.
--
-- 실행:
--   psql ... -f supabase/tests/rls_shop_smoke.sql
-- 또는
--   curl -X POST $SQL_API/v1/projects/<ref>/database/query --data @rls_shop_smoke.sql
--
-- 트랜잭션 안에서 실행해 영향 격리. 실 데이터 변경 안 함.

BEGIN;

-- 1) is_shop_admin() — anon 호출 시 false
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF public.is_shop_admin() <> false THEN
    RAISE EXCEPTION 'is_shop_admin() should return false for anon';
  END IF;
END $$;
RESET ROLE;

-- 2) products 테이블 status='draft' 는 anon 이 read 못 해야 함
DO $$
DECLARE v_count INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.products WHERE status = 'draft';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon can read draft products (RLS hole)';
  END IF;
END $$;
RESET ROLE;

-- 3) shop_payments 는 anon SELECT 0건이어야 함 (RLS 정책에 anon 없음)
DO $$
DECLARE v_count INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.shop_payments;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon can read shop_payments (RLS hole)';
  END IF;
END $$;
RESET ROLE;

-- 4) oauth_tokens 는 anon SELECT 막혀야 함
DO $$
DECLARE v_count INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_count FROM public.oauth_tokens;
  EXCEPTION WHEN OTHERS THEN v_count := -1;
  END;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon can read oauth_tokens (security leak)';
  END IF;
END $$;
RESET ROLE;

-- 5) shop_wishlist 는 anon insert 막혀야 함
DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO public.shop_wishlist (user_id, product_id)
    VALUES (gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'anon could insert into shop_wishlist (RLS hole)';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      NULL;  -- 정상
  END;
END $$;
RESET ROLE;

-- 6) cleanup_stale_pending_orders — anon 호출 막혀야 함
DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.cleanup_stale_pending_orders();
    RAISE EXCEPTION 'anon could call cleanup_stale_pending_orders (security leak)';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 7) mark_order_paid — authenticated 호출 막혀야 함 (service_role 만)
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.mark_order_paid(gen_random_uuid(), 'fake', 1000);
    RAISE EXCEPTION 'authenticated could call mark_order_paid (security leak)';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN
      -- 다른 에러 (예: 주문 없음) 가 나오면 함수가 실행됐다는 뜻 — 보안 hole
      RAISE EXCEPTION 'mark_order_paid executed for authenticated: %', SQLERRM;
  END;
END $$;
RESET ROLE;

-- 8) products is_active 가 status 와 항상 동기화
DO $$
DECLARE v_diff INTEGER;
BEGIN
  SELECT count(*) INTO v_diff
   FROM public.products
   WHERE is_active <> (status = 'published');
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'is_active out of sync with status (% rows)', v_diff;
  END IF;
END $$;

-- 9) push_send_log RLS — 본인 + 어드민만
DO $$
DECLARE v_count INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.push_send_log;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon can read push_send_log';
  END IF;
END $$;
RESET ROLE;

-- 10) order_no 유니크 인덱스 살아있는지
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
   FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'orders' AND indexname = 'orders_order_no_uniq';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'orders_order_no_uniq index missing';
  END IF;
END $$;

ROLLBACK;

-- 모든 ASSERT 통과 시 여기까지 도달
SELECT 'rls_shop_smoke: PASS' AS result;
