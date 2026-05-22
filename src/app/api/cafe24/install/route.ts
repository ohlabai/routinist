// Cafe24 OAuth install — 사용자가 한 번 방문하면 동의 페이지로 리다이렉트.
// 동의 후 /api/cafe24/callback 로 돌아와서 code → access/refresh 교환 + DB 저장.

import { NextRequest, NextResponse } from 'next/server';

const SCOPE = 'mall.read_product,mall.read_category,mall.read_design,mall.read_personal';

export async function GET(req: NextRequest) {
  const mallId = process.env.CAFE24_MALL_ID ?? 'routinist';
  const clientId = process.env.CAFE24_CLIENT_ID;
  if (!clientId) {
    return new NextResponse('CAFE24_CLIENT_ID 미설정', { status: 500 });
  }

  // redirect_uri 는 현재 호스트 기준 callback. Cafe24 콘솔에 이 URL 을 등록해두어야 함.
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/cafe24/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    state: 'routinist',
    redirect_uri: redirectUri,
    scope: SCOPE,
  });
  const authorizeUrl = `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?${params.toString()}`;
  return NextResponse.redirect(authorizeUrl);
}
