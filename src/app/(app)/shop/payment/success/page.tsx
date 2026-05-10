'use client';

// 토스 결제 success redirect — server confirm endpoint 호출 → 주문 상세로 이동.

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { clearCart } from '@/lib/shop-data';

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'confirming' | 'success' | 'fail'>('confirming');
  const [errorMsg, setErrorMsg] = useState('');
  const [orderUuid, setOrderUuid] = useState('');

  useEffect(() => {
    const paymentKey = searchParams.get('paymentKey');
    const orderId = searchParams.get('orderId');         // toss orderId = 우리 order_no
    const amount = Number(searchParams.get('amount'));
    const orderUuidParam = searchParams.get('orderUuid'); // 우리 orders.id

    if (!paymentKey || !orderId || !amount || !orderUuidParam) {
      setStatus('fail');
      setErrorMsg('결제 정보가 부족해요');
      return;
    }
    setOrderUuid(orderUuidParam);

    // server confirm 호출
    fetch('/api/payments/toss/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount, orderUuid: orderUuidParam }),
    })
      .then(async r => {
        const json = await r.json();
        if (!r.ok || !json.success) {
          throw new Error(json.message || json.error || '결제 확정 실패');
        }
        setStatus('success');
        // 장바구니 비우기 (cart 모드만 — buyNow 는 sessionStorage 정리)
        sessionStorage.removeItem('buyNowItem');
        clearCart().catch(() => {});
      })
      .catch(e => {
        console.warn('[payment/success] confirm fail', e);
        setStatus('fail');
        setErrorMsg(e instanceof Error ? e.message : '결제 확정 실패');
      });
  }, [searchParams]);

  if (status === 'confirming') {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div className="animate-spin w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full mx-auto mb-6" />
        <p className="text-base font-bold text-[var(--foreground)]">결제 확인 중...</p>
        <p className="text-xs text-[var(--muted)] mt-2">잠시만 기다려주세요</p>
      </div>
    );
  }

  if (status === 'fail') {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <AlertCircle size={64} className="mx-auto mb-4 text-red-500" />
        <h1 className="text-xl font-bold text-[var(--foreground)] mb-2">결제 확정 실패</h1>
        <p className="text-sm text-[var(--muted)] mb-6 max-w-xs mx-auto break-keep">{errorMsg}</p>
        <p className="text-xs text-[var(--muted)] mb-6">
          결제는 완료됐는데 주문 처리 중 문제가 생겼어요.<br />
          고객센터에 문의하시면 빠르게 도와드릴게요.
        </p>
        <div className="flex gap-2 justify-center">
          <Link href="/support" className="px-5 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm font-semibold">
            고객센터
          </Link>
          <Link href={`/shop/order?id=${orderUuid}`} className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold">
            주문 확인
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <CheckCircle size={72} className="mx-auto mb-5 text-emerald-500" />
      <h1 className="text-2xl font-bold text-[var(--foreground)] mb-2">결제 완료! 🎉</h1>
      <p className="text-sm text-[var(--muted)] mb-8">주문이 정상 접수됐어요</p>
      <div className="flex gap-2 justify-center">
        <Link href="/shop" className="px-5 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-sm font-semibold">
          쇼핑 계속하기
        </Link>
        <Link
          href={`/shop/order?id=${orderUuid}`}
          className="px-5 py-3 rounded-xl bg-emerald-500 text-white text-sm font-bold"
        >
          주문 상세 보기
        </Link>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <PaymentSuccessContent />
    </Suspense>
  );
}
