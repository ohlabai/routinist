// Cafe24 OAuth callback — 동의 후 code 받아 access/refresh 토큰으로 교환 + DB 저장.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_token_expires_at: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  issued_at: string;
  shop_no: string;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');

  if (errorParam) {
    return new NextResponse(`<h1>OAuth 거부됨</h1><p>${errorParam}</p>`, {
      status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  if (!code) {
    return new NextResponse('<h1>code 누락</h1>', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const mallId = process.env.CAFE24_MALL_ID ?? 'routinist';
  const clientId = process.env.CAFE24_CLIENT_ID;
  const clientSecret = process.env.CAFE24_CLIENT_SECRET;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!clientId || !clientSecret || !supaUrl || !serviceKey) {
    return new NextResponse('<h1>환경변수 미설정</h1>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // code → token 교환
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/cafe24/callback`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  let token: TokenResponse;
  try {
    const r = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const text = await r.text();
      return new NextResponse(`<h1>토큰 교환 실패</h1><pre>${text}</pre>`, {
        status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    token = await r.json() as TokenResponse;
  } catch (e) {
    return new NextResponse(`<h1>토큰 교환 예외</h1><pre>${(e as Error).message}</pre>`, {
      status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // DB upsert
  const supabase = createClient(supaUrl, serviceKey);
  const { error } = await supabase.from('oauth_tokens').upsert({
    provider: 'cafe24',
    account_id: mallId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    scope: (token.scopes ?? []).join(','),
    expires_at: token.expires_at,
    refresh_expires_at: token.refresh_token_expires_at,
    metadata: {
      shop_no: token.shop_no,
      user_id: token.user_id,
      installed_at: new Date().toISOString(),
      state,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,account_id' });
  if (error) {
    return new NextResponse(`<h1>DB 저장 실패</h1><pre>${error.message}</pre>`, {
      status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return new NextResponse(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>Cafe24 연동 완료</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5fdf8;color:#1a2e2a;padding:48px 24px;text-align:center;line-height:1.6}
h1{color:#10b981;font-size:28px} pre{background:#fff;padding:14px;border-radius:12px;text-align:left;font-size:11px;overflow:auto}</style>
</head><body>
<h1>✅ Cafe24 연동 완료!</h1>
<p>이제 상품 자동 동기화가 작동합니다.</p>
<p>새 access_token / refresh_token 이 DB(<code>oauth_tokens</code>) 에 저장됐어요.</p>
<p>shop_no: ${token.shop_no} · scopes: ${(token.scopes ?? []).join(', ')}</p>
<p>이 창은 닫으셔도 됩니다.</p>
</body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
