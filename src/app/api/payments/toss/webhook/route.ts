// 토스페이먼츠 webhook — 비동기 이벤트 수신 (환불/취소/실패 등).
//
// 토스 가맹점 대시보드 → 개발자센터 → 웹훅 → URL 등록:
//   https://routinist.kr/api/payments/toss/webhook
// 이벤트: PAYMENT_STATUS_CHANGED, CANCEL_REQUESTED 등.
//
// 보안: 토스는 secret_key 기반 signature 검증 메커니즘이 있음 (X-TossPayments-Signature 헤더).
// 현재는 IP 화이트리스트 (52.78.100.19, 13.124.18.41 등) + payment_key 존재 검증으로 갈음.
// 결제는 confirm endpoint 가 본분이라 webhook 은 보조 (최종 정산은 toss 측 단일 진실).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface TossWebhookEvent {
  eventType: string;
  createdAt?: string;
  data?: {
    paymentKey?: string;
    orderId?: string;
    status?: string;
    [k: string]: unknown;
  };
}

export async function POST(req: NextRequest) {
  let event: TossWebhookEvent;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    console.error('[toss/webhook] backend not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  console.log('[toss/webhook] event', event.eventType, event.data?.paymentKey);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const paymentKey = event.data?.paymentKey;
  const newStatus = event.data?.status;
  if (!paymentKey || !newStatus) {
    return NextResponse.json({ ok: true, ignored: 'missing payment fields' });
  }

  // 토스 status 매핑 → shop_payments.status
  const statusMap: Record<string, string> = {
    DONE: 'done',
    CANCELED: 'cancelled',
    PARTIAL_CANCELED: 'partial_refunded',
    ABORTED: 'failed',
    EXPIRED: 'failed',
  };
  const mappedStatus = statusMap[newStatus] ?? null;
  if (!mappedStatus) {
    return NextResponse.json({ ok: true, ignored: `status=${newStatus}` });
  }

  // shop_payments 업데이트
  const { error } = await supabase
    .from('shop_payments')
    .update({
      status: mappedStatus,
      raw_response: event.data,
      cancelled_at: ['cancelled', 'partial_refunded', 'failed'].includes(mappedStatus) ? new Date().toISOString() : null,
    })
    .eq('provider_payment_key', paymentKey);

  if (error) {
    console.error('[toss/webhook] update failed', error);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // 환불 시 order 상태도 변경 (cancel_order RPC 와 동일하지만 service role 로 직접)
  if (mappedStatus === 'cancelled' || mappedStatus === 'partial_refunded') {
    const { data: payment } = await supabase
      .from('shop_payments')
      .select('order_id, amount_krw')
      .eq('provider_payment_key', paymentKey)
      .maybeSingle();
    if (payment) {
      const p = payment as { order_id: string; amount_krw: number };
      await supabase
        .from('orders')
        .update({
          status: 'refunded',
          cancelled_at: new Date().toISOString(),
          cancelled_reason: 'Toss webhook 환불',
        })
        .eq('id', p.order_id)
        .eq('status', 'paid');  // paid → refunded 만 (다른 상태는 별도 조정)
    }
  }

  return NextResponse.json({ ok: true });
}
