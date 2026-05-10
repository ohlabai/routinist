'use client';

// 결제 성공 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, AlertCircle, Sparkles, ChevronRight, Home, ShoppingBag } from 'lucide-react';
import { clearCart } from '@/lib/shop-data';

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'confirming' | 'success' | 'fail'>('confirming');
  const [errorMsg, setErrorMsg] = useState('');
  const [orderUuid, setOrderUuid] = useState('');

  useEffect(() => {
    const paymentKey = searchParams.get('paymentKey');
    const orderId = searchParams.get('orderId');
    const amount = Number(searchParams.get('amount'));
    const orderUuidParam = searchParams.get('orderUuid');

    if (!paymentKey || !orderId || !amount || !orderUuidParam) {
      setStatus('fail');
      setErrorMsg('결제 정보가 부족해요');
      return;
    }
    setOrderUuid(orderUuidParam);

    // buyNow 모드인지 결제 직전에 저장된 sessionStorage 로 판별
    const wasBuyNow = !!sessionStorage.getItem('buyNowItem');

    fetch('/api/payments/toss/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount, orderUuid: orderUuidParam }),
    })
      .then(async r => {
        const json = await r.json();
        if (!r.ok || !json.success) throw new Error(json.message || json.error || '결제 확정 실패');
        setStatus('success');
        sessionStorage.removeItem('buyNowItem');
        // 카트 결제 시에만 카트 비움 (buyNow 는 카트의 다른 상품 보존)
        if (!wasBuyNow) {
          clearCart().catch(() => {});
        }
      })
      .catch(e => {
        console.warn('[payment/success] confirm fail', e);
        setStatus('fail');
        setErrorMsg(e instanceof Error ? e.message : '결제 확정 실패');
      });
  }, [searchParams]);

  if (status === 'confirming') {
    return (
      <div className="max-w-lg mx-auto px-6 py-32 text-center bg-[var(--background)] min-h-screen">
        <div className="w-20 h-20 mx-auto mb-6 relative">
          <div className="absolute inset-0 rounded-full bg-emerald-100 dark:bg-emerald-950/30 animate-pulse" />
          <div className="absolute inset-3 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
        </div>
        <p className="text-base font-extrabold text-[var(--foreground)] mb-1">결제 확인 중...</p>
        <p className="text-sm text-[var(--muted)]">잠시만 기다려주세요</p>
      </div>
    );
  }

  if (status === 'fail') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center bg-[var(--background)] min-h-screen">
        <div className="w-24 h-24 rounded-full bg-red-50 dark:bg-red-950/20 mx-auto mb-5 flex items-center justify-center">
          <AlertCircle size={44} className="text-red-500" />
        </div>
        <h1 className="text-xl font-extrabold mb-2">결제 확정 실패</h1>
        <p className="text-sm text-[var(--muted)] mb-2 max-w-xs mx-auto break-keep">{errorMsg}</p>
        <p className="text-xs text-[var(--muted)] mb-7 max-w-xs mx-auto break-keep">
          결제는 완료됐는데 주문 처리 중 문제가 생겼어요.<br />
          고객센터에 문의하시면 빠르게 도와드릴게요.
        </p>
        <div className="flex gap-2 justify-center">
          <Link href="/support" className="px-5 py-3 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-sm font-bold active:scale-95">
            고객센터
          </Link>
          <Link href={`/shop/order?id=${orderUuid}`} className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-sm font-extrabold active:scale-95">
            주문 확인
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-16 bg-[var(--background)] min-h-screen">
      {/* Hero */}
      <div className="text-center pt-8">
        <div className="relative w-28 h-28 mx-auto mb-6">
          {/* Pulse ring */}
          <div className="absolute inset-0 rounded-full bg-emerald-200/40 dark:bg-emerald-900/30 animate-ping" />
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/40">
            <CheckCircle size={56} className="text-white" strokeWidth={2.5} />
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mb-3">
          <Sparkles size={12} className="text-emerald-500" />
          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 tracking-wider uppercase">Order Complete</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] mb-2 leading-tight">
          결제 완료!<br />
          <span className="text-emerald-600">주문이 접수됐어요</span>
        </h1>
        <p className="text-sm text-[var(--muted)] mt-2">
          빠른 시일 내에 발송 처리해 드릴게요
        </p>
      </div>

      {/* CTA buttons */}
      <div className="mt-12 space-y-2.5">
        <Link
          href={`/shop/order?id=${orderUuid}`}
          className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base active:scale-[0.98] shadow-md shadow-emerald-500/30 inline-flex items-center justify-center gap-2"
        >
          <ShoppingBag size={18} />
          주문 상세 보기
          <ChevronRight size={18} />
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

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    }>
      <PaymentSuccessContent />
    </Suspense>
  );
}
