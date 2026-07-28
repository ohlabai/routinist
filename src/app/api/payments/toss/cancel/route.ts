// 토스페이먼츠 사용자 결제 취소·환불 — build 327 (2026-07-28).
//
// 배경: 기존 취소는 클라 → cancel_order RPC 직행 (DB 상태만 변경). shop_phase2_rpc 의
// "외부 PG 환불 호출은 별도 (/api/payments/toss/cancel)" 주석만 있고 라우트가 없어
// 실제 토스 환불이 한 번도 일어나지 않았다. 이 라우트가 그 빠진 조각:
//
// 1. Bearer 토큰으로 사용자 검증 + 주문 소유 확인
// 2. paid 이상 주문이면 토스 cancel API 호출 (진짜 환불) — ALREADY_CANCELED 는 성공 취급
// 3. cancel_order RPC (service role) 로 DB 상태·재고·마일리지 정리
//
// 환경변수 필수: TOSS_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface CancelBody {
  orderId: string;   // orders.id (uuid)
  reason?: string;
}

export async function POST(req: NextRequest) {
  let body: CancelBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { orderId, reason } = body;
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

  // ── 사용자 인증 (admin/cafe24 sync 라우트와 동일 패턴) ──
  const accessToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!accessToken) return NextResponse.json({ error: '인증 토큰 필요' }, { status: 401 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tossSecret = process.env.TOSS_SECRET_KEY;
  if (!supaUrl || !anonKey || !serviceKey || !tossSecret) {
    console.error('[toss/cancel] env missing');
    return NextResponse.json({ error: 'Backend not configured' }, { status: 500 });
  }

  const userClient = createClient(supaUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });

  const admin = createClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 주문 조회 + 소유 확인 ──
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, user_id, status')
    .eq('id', orderId)
    .single();
  if (orderErr || !order) return NextResponse.json({ error: '주문을 찾을 수 없어요' }, { status: 404 });
  if (order.user_id !== user.id) return NextResponse.json({ error: '본인 주문만 취소할 수 있어요' }, { status: 403 });

  // 이미 취소/환불 완료 — 멱등 성공
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return NextResponse.json({ success: true, alreadyCancelled: true });
  }
  if (order.status === 'delivered') {
    return NextResponse.json({ error: '배송 완료된 주문은 반품 신청을 통해서만 환불할 수 있어요' }, { status: 400 });
  }

  // ── paid 이상이면 토스 환불 먼저 (돈 → DB 순서: PG 실패 시 DB 를 건드리지 않음) ──
  if (order.status !== 'pending') {
    const { data: payment } = await admin
      .from('shop_payments')
      .select('provider_payment_key')
      .eq('order_id', orderId)
      .eq('provider', 'toss')
      .not('provider_payment_key', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const paymentKey = payment?.provider_payment_key as string | undefined;
    if (!paymentKey) {
      console.error('[toss/cancel] paymentKey 없음', { orderId });
      return NextResponse.json({ error: '결제 정보를 찾을 수 없어요. 고객센터로 문의해주세요.' }, { status: 500 });
    }

    try {
      const auth = Buffer.from(`${tossSecret}:`).toString('base64');
      const r = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: reason || '사용자 요청' }),
      });
      if (!r.ok) {
        const json = await r.json().catch(() => ({})) as { code?: string; message?: string };
        // 이미 토스에서 취소된 결제 — DB 정리만 이어감 (멱등)
        if (json.code !== 'ALREADY_CANCELED_PAYMENT') {
          console.error('[toss/cancel] toss cancel failed', { orderId, code: json.code, message: json.message });
          return NextResponse.json({
            error: json.message || '결제사 환불 요청이 실패했어요. 잠시 후 다시 시도해주세요.',
            code: json.code ?? 'TOSS_CANCEL_FAILED',
          }, { status: 502 });
        }
      }
    } catch (e) {
      console.error('[toss/cancel] toss API exception', e);
      return NextResponse.json({ error: '결제사에 연결할 수 없어요. 잠시 후 다시 시도해주세요.' }, { status: 502 });
    }
  }

  // ── DB 정리 (재고 복원 + 마일리지 환불/적립 회수 + 상태 변경) ──
  const { error: rpcErr } = await admin.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason ?? '사용자 요청',
    p_only_if_pending: false,
  });
  if (rpcErr) {
    // 돈은 환불됐는데 DB 반영 실패 — 크리티컬. 어드민이 수동 정리할 수 있게 크게 남김.
    console.error('[toss/cancel] CRITICAL: PG 환불 후 cancel_order 실패 — 수동 정리 필요', {
      orderId, userId: user.id, message: rpcErr.message,
    });
    return NextResponse.json({
      error: '환불은 접수됐지만 주문 상태 갱신이 지연되고 있어요. 잠시 후 자동 반영됩니다.',
      refunded: true,
    }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
