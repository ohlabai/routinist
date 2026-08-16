// 공유 카드 지도 배경 프록시 (2026-08-16).
//
// 왜 프록시인가:
//  1) CORS — Google Static Maps 응답에는 Access-Control-Allow-Origin 이 없다. 그대로
//     캔버스에 그리면 tainted 돼 toBlob() 이 막혀 공유 이미지가 아예 안 만들어진다.
//  2) 키 은닉 — 서버 키로 호출해 클라이언트에 노출하지 않는다.
//  3) 캐시 — 같은 경로는 같은 URL 이라 Vercel CDN 이 그대로 재사용한다 (호출 비용 절감).
//
// ⚠️ Google ToS: 반환 이미지의 Google 로고·저작권 표기를 크롭하지 말 것.
//    카드는 이미지를 cover 로 깔되 하단을 잘라내지 않는다.

const KEY = process.env.GOOGLE_MAPS_STATIC_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const enc = url.searchParams.get('enc');
  const color = (url.searchParams.get('c') || '34d399').replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
  // 2026-08-16 (hans "지도 어디인지 식별이 안 돼"): 라벨이 영문으로 나와 동네 이름이 안 읽혔다.
  // 앱의 지도 탭과 같은 한글 라벨로 맞춘다.
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ko';
  if (!enc) return new Response('missing enc', { status: 400 });
  if (!KEY) return new Response('map key not configured', { status: 503 });

  // 2026-08-16 v7: 경로 박스(1.75:1) → **카드 상단 전체**(1080×1060 ≈ 1.019:1) 로.
  // 박스가 작아 동네 이름이 안 읽혔다 (hans). 640×628 @scale2 = 1280×1256.
  // (각 변 640 이 Static Maps 상한)
  const gs = new URL('https://maps.googleapis.com/maps/api/staticmap');
  gs.searchParams.set('size', '640x628');
  gs.searchParams.set('scale', '2');
  gs.searchParams.set('maptype', 'roadmap');
  gs.searchParams.set('language', lang);
  gs.searchParams.set('region', lang === 'ko' ? 'KR' : 'US');
  // 2026-08-16 v4 (hans "지금은 지도 파악이 안 되네"): 다크 스타일을 폐기하고 **밝은 지도** 로.
  // 어둡게 덮으면 동네가 안 읽혀 배경을 지도로 바꾼 의미가 사라진다. 카드 글씨를 어두운
  // 잉크로 바꿔서(ShareCard '지도' 테마) 밝은 지도 위에서도 대비가 나온다.
  // 앱의 지도 탭과 같은 톤 — 다만 POI/대중교통 라벨은 꺼서 경로와 동네 이름만 남긴다.
  for (const st of [
    'feature:all|element:geometry|saturation:-18|lightness:6',
    'feature:poi|element:labels|visibility:off',
    'feature:transit|visibility:off',
    // v7: 영역이 카드 상단 전체로 커져 라벨이 빽빽하지 않다 → 간선도로 라벨 복구
    // (어디를 달렸는지 짚는 단서가 동네 이름만으론 부족했다). 이면도로 라벨만 계속 off.
    'feature:road.local|element:labels|visibility:off',
  ]) gs.searchParams.append('style', st);
  // path 만 주고 center/zoom 을 비우면 Google 이 경로에 맞춰 자동 프레이밍한다.
  // ⚠️ 이 줄이 빠지면 경로도 프레이밍도 사라져 **세계지도**가 돌아온다 (2026-08-16 실측).
  // 밝은 지도에선 선이 굵고 진해야 눈에 든다 → weight 8.
  gs.searchParams.set('path', `color:0x${color}ff|weight:8|enc:${enc}`);
  gs.searchParams.set('key', KEY);

  try {
    const res = await fetch(gs.toString(), { cache: 'force-cache' });
    if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502 });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/png',
        // 같은 경로 = 같은 이미지. 영구 캐시로 재호출(과금) 을 없앤다.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(`fetch failed: ${e instanceof Error ? e.message : String(e)}`, { status: 502 });
  }
}
