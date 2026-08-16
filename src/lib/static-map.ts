// 공유 카드 지도 배경 (2026-08-16 hans: "배경 컬러 대신 지도를 깔면 더 좋지 않을까").
//
// 카드는 캔버스로 그려 이미지/영상으로 내보낸다. 외부 이미지를 캔버스에 직접 그리면
// canvas 가 tainted 돼 toBlob() 이 막히므로, 반드시 CORS 헤더가 붙는 우리 프록시를 거친다.
// (같은 함정: reference_wkwebview_marker_image — 워치 마커가 외부 이미지로 깨졌던 건)

/** Google encoded polyline — 좌표를 URL 에 그대로 넣으면 Static Maps 의 8192자 제한을 넘는다. */
export function encodePolyline(points: Array<[number, number]>): string {
  let out = '';
  let prevLat = 0, prevLng = 0;
  const chunk = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = '';
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    r += String.fromCharCode(s + 63);
    return r;
  };
  for (const [lng, lat] of points) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += chunk(la - prevLat) + chunk(ln - prevLng);
    prevLat = la; prevLng = ln;
  }
  return out;
}

/**
 * 경로 점을 균등 간격으로 솎아낸다. Static Maps 는 URL 길이 제한이 있고, 배경용이라
 * 수백 점의 정밀도가 필요 없다. 시작·끝은 항상 보존 (경로 모양이 잘리면 안 된다).
 */
export function decimate(points: Array<[number, number]>, max = 120): Array<[number, number]> {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Static Maps 는 가로·세로 각각 640 이 상한. scale=2 로 720×1280 을 받아 카드(1080×1920)에 업스케일. */
export const MAP_W = 360;
export const MAP_H = 640;

/**
 * 프록시 URL. 네이티브 앱은 정적 export 라 API 라우트가 번들에 없으므로 절대경로로 호출한다
 * (shop-data.ts 의 결제 취소와 같은 규약).
 */
/**
 * 지도 스타일 버전. 프록시 응답은 immutable 로 영구 캐시되므로, 스타일을 바꾸면
 * 이 값을 올려야 CDN·클라이언트 캐시가 깨진다.
 * (2026-08-16 실측: 다크 스타일로 바꿨는데 캐시된 밝은 지도가 계속 떴다)
 */
export const MAP_STYLE_VERSION = 3;

export function staticMapUrl(
  points: Array<[number, number]>,
  opts: { isNative: boolean; routeColor?: string; lang?: string },
): string | null {
  const pts = decimate(points.filter(p => Array.isArray(p) && p.length >= 2));
  if (pts.length < 2) return null;
  const base = opts.isNative ? 'https://app.routinist.kr' : '';
  const q = new URLSearchParams({
    enc: encodePolyline(pts),
    c: (opts.routeColor ?? '#34d399').replace('#', ''),
    v: String(MAP_STYLE_VERSION),
    lang: opts.lang === 'en' ? 'en' : 'ko',
  });
  return `${base}/api/map-static?${q.toString()}`;
}

/** 프록시에서 이미지를 받아 캔버스에 그릴 수 있는 형태로. 실패하면 null (호출측이 테마 배경으로 폴백). */
export function loadStaticMap(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // 프록시가 Access-Control-Allow-Origin 을 주므로 캔버스가 오염되지 않는다.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
