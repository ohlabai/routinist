-- 2026-08-17 리뷰: cancel_order 2인자 오버로드 제거.
--
-- 3인자 버전의 p_only_if_pending 에 DEFAULT 가 있어, 2인자로 호출하면 두 후보가 겹쳐
-- 항상 42725 "function cancel_order(uuid, unknown) is not unique" 가 난다.
-- 명시 캐스트를 줘도, 이름 지정 인자로 불러도 마찬가지 — 즉 **2인자 버전은 호출 자체가 불가능**하다.
-- 죽은 코드이면서, 2인자로 부른 호출자를 조용히 실패시키는 함정이었다.
--
-- 실제 피해: api/payments/toss/webhook 이 2인자로 부르고 있었다. 토스에서 환불/취소 webhook 이
-- 올 때마다 RPC 가 실패해 **재고 복구와 마일리지 환원이 안 됐다** (console.error 만 남기고 진행).
DROP FUNCTION IF EXISTS public.cancel_order(uuid, text);
