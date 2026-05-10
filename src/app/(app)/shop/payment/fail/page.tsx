'use client';

// 결제 실패 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { XCircle, ShoppingBag, Home } from 'lucide-react';
import { cancelOrder } from '@/lib/shop-data';

function PaymentFailContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') ?? '';
  const message = searchParams.get('message') ?? '결제가 취소되었거나 실패했어요';
  const orderUuid = searchParams.get('orderUuid') ?? '';

  useEffect(() => {
    if (orderUuid) {
      cancelOrder(orderUuid, `결제 실패: ${code} ${message}`).catch(() => {});
    }
    // buyNow stale 데이터 정리 — 다음 결제 시 영향 차단
    try { sessionStorage.removeItem('buyNowItem'); } catch {}
  }, [orderUuid, code, message]);

  return (
    <div className="max-w-lg mx-auto px-6 py-16 bg-[var(--background)] min-h-screen">
      <div className="text-center pt-8">
        <div className="relative w-28 h-28 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full bg-red-100 dark:bg-red-950/30" />
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-red-400 to-red-500 flex items-center justify-center shadow-md">
            <XCircle size={56} className="text-white" strokeWidth={2} />
          </div>
        </div>
        <h1 className="text-2xl font-extrabold text-[var(--foreground)] mb-2">결제 실패</h1>
        <p className="text-sm text-[var(--foreground)] max-w-xs mx-auto break-keep mb-1">{message}</p>
        {code && <p className="text-[10px] text-[var(--muted)]/70 font-mono mb-5">[{code}]</p>}
        <p className="text-xs text-[var(--muted)] mb-8 max-w-xs mx-auto break-keep">
          다시 시도하시거나, 다른 결제 수단으로 진행해주세요
        </p>
      </div>

      <div className="space-y-2.5">
        <Link
          href="/shop/cart"
          className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-2"
        >
          <ShoppingBag size={18} />
          장바구니로 돌아가기
        </Link>
        <Link
          href="/shop"
          className="w-full py-3.5 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-[var(--foreground)] font-bold text-sm active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
        >
          <Home size={15} />
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
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <PaymentFailContent />
    </Suspense>
  );
}
