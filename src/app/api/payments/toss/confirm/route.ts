// 토스페이먼츠 결제 confirm — 클라이언트 결제 success 후 server side 검증.
//
// 흐름:
// 1. 클라이언트가 토스 결제 SDK 띄움 (orderId=order_no, amount=total_krw)
// 2. 결제 완료 후 토스가 success url 로 redirect → ?paymentKey=xxx&orderId=yyy&amount=zzz
// 3. 클라이언트가 이 endpoint POST: { paymentKey, orderId, amount, orderUuid }
//    (orderUuid 는 우리 DB orders.id, orderId 는 토스 노출용 order_no)
// 4. server: TOSS API confirm 호출 → 검증 OK → mark_order_paid RPC
// 5. 응답: { success: true, order: {...} } → 클라이언트가 주문 상세 페이지로 이동
//
// 환경변수 필수:
// - TOSS_SECRET_KEY (토스 가맹점 대시보드 → API 키)
// - SUPABASE_SERVICE_ROLE_KEY (이미 .env.local 에 있음)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface ConfirmBody {
  paymentKey: string;
  orderId: string;       // toss orderId (우리 order_no)
  amount: number;
  orderUuid: string;     // 우리 orders.id
}

interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  totalAmount: number;
  status: string;
  method?: string;
  approvedAt?: string;
  [k: string]: unknown;
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

  // Step 1: Toss API confirm — Basic auth (secret_key + ":")
  const tossAuth = Buffer.from(`${tossSecret}:`).toString('base64');
  let tossRes: TossPaymentResponse;
  try {
    const r = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${tossAuth}`,
        'Content-Type': 'application/json',
      },
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

  // Step 2: amount 일치 검증
  if (tossRes.totalAmount !== amount) {
    console.error('[toss/confirm] amount mismatch', { expected: amount, got: tossRes.totalAmount });
    return NextResponse.json({
      error: 'Amount mismatch',
      expected: amount,
      got: tossRes.totalAmount,
    }, { status: 400 });
  }

  // Step 3: mark_order_paid RPC (service role)
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
    console.error('[toss/confirm] mark_order_paid failed', error);
    // 결제는 됐는데 우리 DB 에 못 반영된 상태 — 운영 alert 필요. 현재는 로그만.
    return NextResponse.json({
      error: 'Order finalization failed',
      message: error.message,
      paymentKey,  // 운영자가 수동 보정 시 참조
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    paymentKey,
    orderId,
    method: tossRes.method ?? null,
    approvedAt: tossRes.approvedAt ?? null,
  });
}
