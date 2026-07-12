// 월드런 코스 히어로 이미지 생성 — 2026-07-12 CCSS #3 A안.
//
// 코스별로 OSM 타일을 1회 합성해 실제 지도 배경 이미지 (1000×600, 5:3) 를 만들고
// Supabase Storage(course-assets, public) 에 업로드 → virtual_courses.hero_image_url.
// 경로 라인은 이미지에 굽지 않는다 — preview_path 를 이미지 crop 과 동일한 좌표계
// (x 0~100, y 0~60) 로 재투영해 저장하고, 클라이언트 CoursePreview SVG 가 그 위에
// 라인/진행 마커를 그린다 (정렬 보장 + 진행률 애니메이션 유지).
//
// real_path 없는 코스는 아래 WAYPOINTS (도시 단위 근사 경유지) 로 채운다.
// 런타임 지도 API 호출 없음 — 비용 0. 재실행 안전 (upsert).
//
// 실행: node scripts/generate-course-heroes.mjs [코스명 부분일치 필터]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const SERVICE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
const SUPA = 'https://linkabdqhnzanmbmwyzp.supabase.co';
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not found in .env.local');

const OUT_W = 1000, OUT_H = 600; // 5:3 — CoursePreview viewBox 100×60 과 동일 비율
const TILE = 256;
const MAX_ZOOM = 15;
const PAD_RATIO = 0.14; // bbox 패딩

// ── real_path 없는 12개 코스 경유지 (도시 단위 근사 — 카드 줌 레벨에선 충분) ──
const WAYPOINTS = {
  '런던 마라톤': [
    { lat: 51.466, lng: 0.009 }, { lat: 51.487, lng: 0.030 }, { lat: 51.4826, lng: -0.0096 },
    { lat: 51.493, lng: -0.047 }, { lat: 51.5055, lng: -0.0754 }, { lat: 51.505, lng: -0.020 },
    { lat: 51.490, lng: -0.013 }, { lat: 51.5033, lng: -0.0195 }, { lat: 51.510, lng: -0.055 },
    { lat: 51.508, lng: -0.117 }, { lat: 51.5007, lng: -0.1246 }, { lat: 51.5014, lng: -0.1350 },
  ],
  '파리 마라톤': [
    { lat: 48.8738, lng: 2.2950 }, { lat: 48.8656, lng: 2.3212 }, { lat: 48.8532, lng: 2.3692 },
    { lat: 48.834, lng: 2.439 }, { lat: 48.827, lng: 2.461 }, { lat: 48.839, lng: 2.432 },
    { lat: 48.846, lng: 2.372 }, { lat: 48.853, lng: 2.345 }, { lat: 48.858, lng: 2.312 },
    { lat: 48.858, lng: 2.292 }, { lat: 48.862, lng: 2.259 }, { lat: 48.8721, lng: 2.2823 },
  ],
  '암스테르담 마라톤': [
    { lat: 52.3430, lng: 4.8540 }, { lat: 52.358, lng: 4.868 }, { lat: 52.366, lng: 4.884 },
    { lat: 52.340, lng: 4.905 }, { lat: 52.318, lng: 4.913 }, { lat: 52.295, lng: 4.905 },
    { lat: 52.320, lng: 4.900 }, { lat: 52.345, lng: 4.895 }, { lat: 52.3430, lng: 4.8540 },
  ],
  '뉴욕 마라톤': [
    { lat: 40.6066, lng: -74.0447 }, { lat: 40.634, lng: -74.023 }, { lat: 40.655, lng: -73.998 },
    { lat: 40.679, lng: -73.981 }, { lat: 40.707, lng: -73.958 }, { lat: 40.744, lng: -73.953 },
    { lat: 40.757, lng: -73.954 }, { lat: 40.762, lng: -73.966 }, { lat: 40.795, lng: -73.943 },
    { lat: 40.810, lng: -73.928 }, { lat: 40.797, lng: -73.949 }, { lat: 40.780, lng: -73.963 },
    { lat: 40.7694, lng: -73.9762 },
  ],
  '시카고 마라톤': [
    { lat: 41.8756, lng: -87.6244 }, { lat: 41.889, lng: -87.626 }, { lat: 41.918, lng: -87.636 },
    { lat: 41.935, lng: -87.644 }, { lat: 41.905, lng: -87.630 }, { lat: 41.881, lng: -87.660 },
    { lat: 41.869, lng: -87.667 }, { lat: 41.857, lng: -87.656 }, { lat: 41.8525, lng: -87.632 },
    { lat: 41.831, lng: -87.626 }, { lat: 41.8712, lng: -87.6236 },
  ],
  '도쿄 → 후지산': [
    { lat: 35.6896, lng: 139.6917 }, { lat: 35.655, lng: 139.339 }, { lat: 35.606, lng: 139.190 },
    { lat: 35.610, lng: 138.940 }, { lat: 35.550, lng: 138.900 }, { lat: 35.487, lng: 138.807 },
    { lat: 35.516, lng: 138.751 }, { lat: 35.397, lng: 138.733 }, { lat: 35.3606, lng: 138.7274 },
  ],
  '만리장성 일부': [
    { lat: 40.2170, lng: 116.0680 }, { lat: 40.290, lng: 116.015 }, { lat: 40.3542, lng: 115.9757 },
    { lat: 40.395, lng: 116.100 }, { lat: 40.415, lng: 116.250 }, { lat: 40.432, lng: 116.375 },
    { lat: 40.4319, lng: 116.5704 },
  ],
  '타이베이 101 → 양밍산': [
    { lat: 25.0339, lng: 121.5645 }, { lat: 25.030, lng: 121.535 }, { lat: 25.035, lng: 121.520 },
    { lat: 25.0478, lng: 121.5170 }, { lat: 25.088, lng: 121.525 }, { lat: 25.117, lng: 121.530 },
    { lat: 25.155, lng: 121.541 }, { lat: 25.170, lng: 121.5586 },
  ],
  '부산 갈맷길': [
    { lat: 35.244, lng: 129.222 }, { lat: 35.1587, lng: 129.1604 }, { lat: 35.153, lng: 129.118 },
    { lat: 35.117, lng: 129.123 }, { lat: 35.053, lng: 129.087 }, { lat: 35.076, lng: 129.017 },
    { lat: 35.046, lng: 128.965 }, { lat: 35.024, lng: 128.830 },
  ],
  '시드니 → 본다이': [
    { lat: -33.8568, lng: 151.2153 }, { lat: -33.8732, lng: 151.2110 }, { lat: -33.897, lng: 151.234 },
    { lat: -33.8927, lng: 151.2477 }, { lat: -33.8908, lng: 151.2743 },
  ],
  '빅토리아 호수 둘레': [
    { lat: 0.051, lng: 32.464 }, { lat: 0.200, lng: 32.550 }, { lat: 0.313, lng: 32.581 },
    { lat: 0.350, lng: 32.750 }, { lat: 0.420, lng: 32.950 }, { lat: 0.4244, lng: 33.2041 },
  ],
  '지구 한 바퀴': [
    { lat: 37.5665, lng: 126.978 }, { lat: 35.68, lng: 139.69 }, { lat: 21.31, lng: -157.86 },
    { lat: 37.77, lng: -122.42 }, { lat: 40.71, lng: -74.01 }, { lat: 51.51, lng: -0.13 },
    { lat: 48.86, lng: 2.35 }, { lat: 41.01, lng: 28.98 }, { lat: 25.20, lng: 55.27 },
    { lat: 28.61, lng: 77.21 }, { lat: 13.76, lng: 100.50 }, { lat: 22.32, lng: 114.17 },
    { lat: 37.5665, lng: 126.978 },
  ],
};

// ── Web Mercator ──
function mercator(lat, lngUnwrapped, zoom) {
  const world = TILE * 2 ** zoom;
  const x = ((lngUnwrapped + 180) / 360) * world;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world;
  return { x, y };
}

// 경도 unwrap — 안티메리디안 (도쿄→호놀룰루 139→-157) 을 넘어도 선이 지도 반대편으로
// 점프하지 않게 누적 보정. 타일 x 는 modulo 로 감아 이어붙인다.
function unwrapLngs(points) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < points.length; i++) {
    let lng = points[i].lng + offset;
    if (i > 0) {
      while (lng - out[i - 1].lng > 180) { lng -= 360; offset -= 360; }
      while (lng - out[i - 1].lng < -180) { lng += 360; offset += 360; }
    }
    out.push({ lat: points[i].lat, lng });
  }
  return out;
}

async function fetchTile(z, x, y) {
  const n = 2 ** z;
  const wx = ((x % n) + n) % n; // 좌우 wrap
  if (y < 0 || y >= n) return null; // 극지방 밖 — 빈 타일
  const url = `https://tile.openstreetmap.org/${z}/${wx}/${y}.png`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Routinist/1.2.8 course-hero-generator (routinist@openhan.kr)' } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(`tile fetch failed z${z} ${wx},${y}`);
}

async function buildImage(points) {
  const unwrapped = unwrapLngs(points);

  // bbox 가 패딩 포함 1000×600 에 들어가는 최대 줌 선택
  let zoom = 1;
  for (let z = MAX_ZOOM; z >= 1; z--) {
    const px = unwrapped.map(p => mercator(p.lat, p.lng, z));
    const w = Math.max(...px.map(p => p.x)) - Math.min(...px.map(p => p.x));
    const h = Math.max(...px.map(p => p.y)) - Math.min(...px.map(p => p.y));
    if (w * (1 + PAD_RATIO * 2) <= OUT_W && h * (1 + PAD_RATIO * 2) <= OUT_H) { zoom = z; break; }
  }

  const px = unwrapped.map(p => mercator(p.lat, p.lng, zoom));
  const minX = Math.min(...px.map(p => p.x)), maxX = Math.max(...px.map(p => p.x));
  const minY = Math.min(...px.map(p => p.y)), maxY = Math.max(...px.map(p => p.y));
  const cropX = Math.round((minX + maxX) / 2 - OUT_W / 2);
  const cropY = Math.round((minY + maxY) / 2 - OUT_H / 2);

  // 타일 합성
  const composites = [];
  const tx0 = Math.floor(cropX / TILE), tx1 = Math.floor((cropX + OUT_W - 1) / TILE);
  const ty0 = Math.floor(cropY / TILE), ty1 = Math.floor((cropY + OUT_H - 1) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const buf = await fetchTile(zoom, tx, ty);
      if (buf) composites.push({ input: buf, left: tx * TILE - cropX, top: ty * TILE - cropY });
      await new Promise(r => setTimeout(r, 60)); // OSM 타일 서버 예의
    }
  }

  // 저작자 표시 (ODbL 의무) — 우하단
  const attribution = Buffer.from(
    `<svg width="${OUT_W}" height="${OUT_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${OUT_W - 208}" y="${OUT_H - 26}" width="208" height="26" fill="rgba(255,255,255,0.75)"/>
      <text x="${OUT_W - 10}" y="${OUT_H - 8}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#555">© OpenStreetMap contributors</text>
    </svg>`
  );

  // 빈 영역 (극지방 밖) 은 OSM 바다색으로 — 회색 밴드 방지
  const image = await sharp({ create: { width: OUT_W, height: OUT_H, channels: 3, background: { r: 170, g: 211, b: 223 } } })
    .composite([...composites, { input: attribution, left: 0, top: 0 }])
    .jpeg({ quality: 78 })
    .toBuffer();

  // preview_path — 이미지 crop 과 동일 좌표계 (x 0~100 / y 0~60) 로 재투영
  const preview = px.map(p => ({
    x: Math.round(((p.x - cropX) / OUT_W) * 100 * 100) / 100,
    y: Math.round(((p.y - cropY) / OUT_H) * 60 * 100) / 100,
  }));

  return { image, preview, zoom };
}

async function main() {
  // 버킷 준비 (public) — 이미 있으면 무시
  const bucketRes = await fetch(`${SUPA}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'course-assets', name: 'course-assets', public: true }),
  });
  if (!bucketRes.ok) {
    const t = await bucketRes.text();
    if (!t.includes('already exists') && !t.includes('Duplicate')) throw new Error(`bucket create: ${t}`);
  }

  const coursesRes = await fetch(`${SUPA}/rest/v1/virtual_courses?is_active=eq.true&select=id,name,real_path&order=sort_order`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const courses = await coursesRes.json();

  const filter = process.argv[2];
  for (const course of courses) {
    if (filter && !course.name.includes(filter)) continue;
    const fromDb = Array.isArray(course.real_path) && course.real_path.length >= 2;
    const points = fromDb ? course.real_path : WAYPOINTS[course.name];
    if (!points) { console.log(`SKIP (경로 없음): ${course.name}`); continue; }

    process.stdout.write(`${course.name} ... `);
    const { image, preview, zoom } = await buildImage(points);

    const objectPath = `heroes/${course.id}.jpg`;
    const upRes = await fetch(`${SUPA}/storage/v1/object/course-assets/${objectPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=604800',
      },
      body: image,
    });
    if (!upRes.ok) throw new Error(`upload failed ${course.name}: ${await upRes.text()}`);

    const heroUrl = `${SUPA}/storage/v1/object/public/course-assets/${objectPath}`;
    const patch = { hero_image_url: heroUrl, preview_path: preview };
    if (!fromDb) patch.real_path = points;
    const dbRes = await fetch(`${SUPA}/rest/v1/virtual_courses?id=eq.${course.id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!dbRes.ok) throw new Error(`db update failed ${course.name}: ${await dbRes.text()}`);

    console.log(`OK (z${zoom}, ${(image.length / 1024).toFixed(0)}KB${fromDb ? '' : ', waypoints 신규'})`);
  }
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });
