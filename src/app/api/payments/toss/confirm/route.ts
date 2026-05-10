// 토스페이먼츠 결제 confirm — 클라이언트 결제 success 후 server side 검증.
//
// 흐름:
// 1. 토스 결제 success → success url → 클라가 이 endpoint POST
// 2. server: TOSS API confirm 호출 (검증) → mark_order_paid RPC
// 3. mark_order_paid 실패 시: 토스에 자동 cancel 호출 (사용자 돈 묶임 방지)
//
// 환경변수 필수: TOSS_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface ConfirmBody {
  paymentKey: string;
  orderId: string;
  amount: number;
  orderUuid: string;
}

interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  totalAmount: number;
  status: string;
  method?: string;
  approvedAt?: string;
  receipt?: { url?: string };
  [k: string]: unknown;
}

async function tossCancel(secret: string, paymentKey: string, reason: string): Promise<boolean> {
  try {
    const auth = Buffer.from(`${secret}:`).toString('base64');
    const r = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason: reason }),
    });
    if (!r.ok) {
      console.error('[toss/confirm] auto-cancel fail', await r.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[toss/confirm] auto-cancel exception', e);
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: ConfirmBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { paymentKey, orderId, amount, orderUuid } = body;
  if (!paymentKey || !orderId || !amount || !orderUuid) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const tossSecret = process.env.TOSS_SECRET_KEY;
  if (!tossSecret) {
    console.error('[toss/confirm] TOSS_SECRET_KEY not set');
    return NextResponse.json({ error: 'Payment provider not configured' }, { status: 500 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    console.error('[toss/confirm] Supabase service config missing');
    return NextResponse.json({ error: 'Backend not configured' }, { status: 500 });
  }

  // Step 1: Toss API confirm
  const tossAuth = Buffer.from(`${tossSecret}:`).toString('base64');
  let tossRes: TossPaymentResponse;
  try {
    const r = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${tossAuth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    const json = (await r.json()) as TossPaymentResponse & { code?: string; message?: string };
    if (!r.ok) {
      console.error('[toss/confirm] toss verify failed', json);
      return NextResponse.json({
        error: 'Payment verification failed',
        code: json.code ?? 'UNKNOWN',
        message: json.message ?? 'Toss API error',
      }, { status: 400 });
    }
    tossRes = json;
  } catch (e) {
    console.error('[toss/confirm] toss API exception', e);
    return NextResponse.json({ error: 'Payment provider unreachable' }, { status: 502 });
  }

  // Step 2: amount 검증
  if (tossRes.totalAmount !== amount) {
    console.error('[toss/confirm] amount mismatch', { expected: amount, got: tossRes.totalAmount });
    // 위변조 의심 — 즉시 토스 자동 cancel
    await tossCancel(tossSecret, paymentKey, 'amount mismatch');
    return NextResponse.json({
      error: 'Amount mismatch',
      expected: amount,
      got: tossRes.totalAmount,
    }, { status: 400 });
  }

  // Step 3: mark_order_paid RPC
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.rpc('mark_order_paid', {
    p_order_id: orderUuid,
    p_payment_key: paymentKey,
    p_amount: amount,
    p_provider: 'toss',
    p_method: tossRes.method ?? null,
    p_raw_response: tossRes,
  });

  if (error) {
    console.error('[toss/confirm] mark_order_paid failed — auto-cancelling toss payment', error);
    // 결제는 됐는데 DB 반영 fail — 사용자 돈 묶임 차단.
    // 토스 자동 cancel 호출. 성공/실패 와 무관하게 클라엔 명확히 안내.
    const cancelled = await tossCancel(tossSecret, paymentKey, error.message ?? 'order finalization failed');
    return NextResponse.json({
      error: 'Order finalization failed',
      message: error.message,
      paymentKey,
      autoCancelled: cancelled,
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    paymentKey,
    orderId,
    method: tossRes.method ?? null,
    approvedAt: tossRes.approvedAt ?? null,
    receiptUrl: tossRes.receipt?.url ?? null,
  });
}
