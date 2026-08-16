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

  // size 는 각 변 640 이 상한 — 9:16 로 최대치를 뽑고 scale=2 로 720×1280.
  const gs = new URL('https://maps.googleapis.com/maps/api/staticmap');
  gs.searchParams.set('size', '360x640');
  gs.searchParams.set('scale', '2');
  gs.searchParams.set('maptype', 'roadmap');
  gs.searchParams.set('language', lang);
  gs.searchParams.set('region', lang === 'ko' ? 'KR' : 'US');
  // 다크 스타일 — 밝은 기본 지도 위에서는 흰 텍스트 대비가 약했다 (실측 확인).
  // 지오메트리를 어둡게·탈채도화하고 POI 라벨을 줄여 카드 텍스트가 주인공이 되게 한다.
  // 에메랄드 경로선이 어두운 바탕에서 훨씬 또렷하게 뜨는 부수 효과도 있다.
  for (const st of [
    'feature:all|element:geometry|saturation:-65|lightness:-50',
    // 라벨은 밝게 — 여기가 "어디를 뛰었나" 를 말하는 유일한 요소다.
    // 지오메트리만 어둡게 두면 카드의 흰 숫자와도 안 부딪힌다.
    'feature:all|element:labels.text.fill|color:0xd6e2ea',
    'feature:all|element:labels.text.stroke|color:0x0a1014|weight:3',
    'feature:administrative|element:labels.text.fill|color:0xffffff',
    'feature:all|element:labels.icon|visibility:off',
    'feature:poi|element:labels|visibility:off',
    'feature:transit|visibility:off',
    'feature:water|element:geometry|color:0x0d2430',
    'feature:landscape|element:geometry|color:0x141a1f',
    // 공원 녹지가 밝으면 에메랄드 경로선과 색이 경쟁한다 — 경로만 초록이도록 눌러둔다.
    'feature:poi.park|element:geometry|color:0x17231c',
    'feature:landscape.natural|element:geometry|color:0x161d19',
    'feature:road|element:geometry|color:0x232b31',
  ]) gs.searchParams.append('style', st);
  // path 만 주고 center/zoom 을 비우면 Google 이 경로에 맞춰 자동 프레이밍한다.
  gs.searchParams.set('path', `color:0x${color}ff|weight:6|enc:${enc}`);
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
