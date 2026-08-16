// 토스페이먼츠 webhook — 비동기 이벤트 수신 (환불/취소/실패 등).
//
// 토스 가맹점 대시보드 → 개발자센터 → 웹훅 → URL 등록:
//   https://app.routinist.kr/api/payments/toss/webhook?token=$PUSH_CRON_SECRET
// (토스 webhook 은 표준 HMAC 시그니처 미제공이라 query token + body verify_signature 헤더 검증 병행)
//
// 흐름:
// 1. 토스가 status 변경 이벤트 POST
// 2. token 검증 → 기록 갱신 + 필요 시 cancel_order RPC 호출 (재고/마일리지 환원 통합)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

function verifyToken(req: NextRequest, rawBody: string): boolean {
  const cronSecret = process.env.PUSH_CRON_SECRET;
  if (!cronSecret) return false;

  // 1) URL query token (등록 시 ?token=XXX 포함)
  const queryToken = req.nextUrl.searchParams.get('token');
  if (queryToken && queryToken === cronSecret) return true;

  // 2) Toss 공식 X-TossPayments-Signature (HMAC SHA256, secret_key)
  const sig = req.headers.get('x-tosspayments-signature');
  const tossSecret = process.env.TOSS_SECRET_KEY;
  if (sig && tossSecret) {
    const expected = crypto.createHmac('sha256', tossSecret).update(rawBody).digest('base64');
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {}
  }
  return false;
}

export async function POST(req: NextRequest) {
  // body 를 raw 로 읽어 시그니처 검증
  const rawBody = await req.text();
  if (!verifyToken(req, rawBody)) {
    console.warn('[toss/webhook] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: TossWebhookEvent;
  try {
    event = JSON.parse(rawBody) as TossWebhookEvent;
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
  const statusMap: Record<string, 'done' | 'cancelled' | 'partial_refunded' | 'failed'> = {
    DONE: 'done',
    CANCELED: 'cancelled',
    PARTIAL_CANCELED: 'partial_refunded',
    ABORTED: 'failed',
    EXPIRED: 'failed',
  };
  const mappedStatus = statusMap[newStatus];
  if (!mappedStatus) {
    return NextResponse.json({ ok: true, ignored: `status=${newStatus}` });
  }

  // 부분 환불 — balanceAmount / cancels 배열에서 amount 합산
  let refundedAmount: number | null = null;
  if (mappedStatus === 'partial_refunded' || mappedStatus === 'cancelled') {
    const cancels = (event.data?.cancels as Array<{ cancelAmount?: number }> | undefined) ?? [];
    refundedAmount = cancels.reduce((s, c) => s + (c.cancelAmount ?? 0), 0) || null;
  }

  const { error: updErr } = await supabase
    .from('shop_payments')
    .update({
      status: mappedStatus,
      raw_response: event.data,
      cancelled_at: ['cancelled', 'partial_refunded', 'failed'].includes(mappedStatus)
        ? new Date().toISOString()
        : null,
      ...(refundedAmount !== null ? { refunded_amount_krw: refundedAmount } : {}),
    })
    .eq('provider_payment_key', paymentKey);

  if (updErr) {
    console.error('[toss/webhook] payment update fail', updErr);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // 환불/취소 시 cancel_order RPC 로 재고 + 마일리지 환원 통합
  if (mappedStatus === 'cancelled') {
    const { data: payment } = await supabase
      .from('shop_payments')
      .select('order_id')
      .eq('provider_payment_key', paymentKey)
      .maybeSingle();
    const orderId = (payment as { order_id: string } | null)?.order_id;
    if (orderId) {
      // 2026-08-17 리뷰: p_only_if_pending 을 빼고 부르면 2인자/3인자 오버로드가 겹쳐
      // 42725 "function is not unique" 로 **매번 실패**했다 (재고·마일리지가 복구되지 않음).
      // 죽은 2인자 오버로드는 제거했고, 여기서도 3인자를 명시한다.
      const { error: cancelErr } = await supabase.rpc('cancel_order', {
        p_order_id: orderId,
        p_reason: '토스 webhook 환불 처리',
        p_only_if_pending: false,
      });
      if (cancelErr) {
        console.error('[toss/webhook] cancel_order RPC fail', cancelErr);
        return NextResponse.json({ error: 'Cancel RPC failed', message: cancelErr.message }, { status: 500 });
      }
    }
  } else if (mappedStatus === 'partial_refunded') {
    // 부분 환불: 재고/마일리지 환원은 자동화 어려움 (어떤 항목 환불인지 모름).
    // 운영자가 어드민 콘솔에서 수동 보정. 주문은 'paid' 유지.
    console.warn('[toss/webhook] partial_refunded — manual reconciliation needed', { paymentKey, refundedAmount });
  }

  return NextResponse.json({ ok: true, mapped: mappedStatus });
}
