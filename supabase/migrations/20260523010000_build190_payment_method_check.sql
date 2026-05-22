-- build 190: orders.payment_method CHECK 제약 확장.
-- 기존: ('card', 'transfer', 'mileage', 'mixed') 만 허용 → 토스 응답 매핑값 ('easypay', 'vbank', 'mobile' 등)
-- 들어오면 CHECK 위반으로 결제 confirm 실패 + 토스 자동 환불 → 사용자 결제 끊김.
-- confirm route 의 mapTossMethodToDb 가 매핑하는 모든 값 + 추가 안전망.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method IN (
      'card',      -- 신용·체크카드
      'transfer',  -- 계좌이체
      'vbank',     -- 가상계좌
      'mobile',    -- 휴대폰결제
      'easypay',   -- 카카오페이/네이버페이/페이코/삼성페이/엘페이/SSGPay/토스페이
      'voucher',   -- 문화상품권/도서문화상품권/게임문화상품권
      'mileage',   -- 마일리지 전액
      'mixed'      -- 혼합 결제
    )
  );
