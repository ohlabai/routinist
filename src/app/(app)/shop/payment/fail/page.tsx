'use client';

// 토스 결제 fail redirect — 주문 자동 취소 + 안내.

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { XCircle } from 'lucide-react';
import { cancelOrder } from '@/lib/shop-data';

function PaymentFailContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') ?? '';
  const message = searchParams.get('message') ?? '결제가 취소되었거나 실패했어요';
  const orderUuid = searchParams.get('orderUuid') ?? '';

  useEffect(() => {
    // 주문이 pending 상태로 남아있으면 cancel — 재고 복구 + 마일리지 환원
    if (orderUuid) {
      cancelOrder(orderUuid, `결제 실패: ${code} ${message}`).catch(() => {});
    }
  }, [orderUuid, code, message]);

  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <XCircle size={72} className="mx-auto mb-5 text-red-500" />
      <h1 className="text-2xl font-bold text-[var(--foreground)] mb-2">결제 실패</h1>
      <p className="text-sm text-[var(--muted)] mb-1 max-w-xs mx-auto break-keep">{message}</p>
      {code && <p className="text-xs text-[var(--muted)]/60 mb-6">[{code}]</p>}
      <p className="text-xs text-[var(--muted)] mb-8 max-w-xs mx-auto break-keep">
        다시 시도하시거나, 다른 결제 수단으로 진행해주세요
      </p>
      <div className="flex gap-2 justify-center">
        <Link href="/shop/cart" className="px-5 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm font-semibold">
          장바구니
        </Link>
        <Link href="/shop" className="px-5 py-3 rounded-xl bg-emerald-500 text-white text-sm font-bold">
          쇼핑 계속하기
        </Link>
      </div>
    </div>
  );
}

export default function PaymentFailPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <PaymentFailContent />
    </Suspense>
  );
}
