// scripts/check-region-bboxes.ts — region-from-gps 셀프테스트 (build 290)
//
// 실행: npx tsx scripts/check-region-bboxes.ts
//
// 검사 항목:
//   1. 알려진 케이스 — first-match shadow 버그로 오표기되던 좌표들 (타이베이→대만 등)
//   2. WORLD 전수 검사 — 각 bbox 중심점이 자기 자신 라벨로 매칭되는지
//      (bbox 가 서로 겹쳐 면적 매칭으로도 해소 불가한 엔트리는 KNOWN_DATA_ISSUES 로 문서화)
//   3. 한국 회귀 검사 — KR_BBOX 내부 0.05° 그리드 전체에서 이전 first-match 알고리즘과
//      결과 동일한지 (유일한 의도적 차이: 후쿠오카 bbox 겹침 구간 '한국'→'일본 후쿠오카')

import {
  detectRegionLabel,
  WORLD,
  KR_BBOX,
  KR_SEOUL_GU,
  KR_NON_SEOUL_CITY,
  KR_CITY,
} from '../src/lib/region-from-gps';

type BBox = [number, number, number, number];

function inBox(lat: number, lng: number, bbox: BBox): boolean {
  return lat >= bbox[0] && lat <= bbox[1] && lng >= bbox[2] && lng <= bbox[3];
}

// detectRegionLabel 은 [lng, lat] 순서를 받음
function label(lat: number, lng: number): string | null {
  return detectRegionLabel([lng, lat]);
}

let failures = 0;
let knownIssues = 0;

// ─── 1. 알려진 케이스 ────────────────────────────────────────────────
// expect: 정확히 일치해야 하는 라벨. expectPrefix: "~ 계열" (도시 라벨 허용)
const KNOWN_CASES: { desc: string; lat: number; lng: number; expect?: string; expectPrefix?: string }[] = [
  { desc: '타이베이', lat: 25.03, lng: 121.56, expect: '대만' },
  { desc: '홍콩', lat: 22.3, lng: 114.17, expect: '홍콩' },
  { desc: '마카오', lat: 22.16, lng: 113.56, expect: '마카오' },
  { desc: '울란바토르', lat: 47.92, lng: 106.92, expect: '몽골' },
  { desc: '토론토', lat: 43.65, lng: -79.38, expectPrefix: '캐나다' },
  { desc: '밴쿠버', lat: 49.28, lng: -123.12, expectPrefix: '캐나다' },
  { desc: '몬트리올', lat: 45.5, lng: -73.57, expectPrefix: '캐나다' },
  { desc: '더블린', lat: 53.35, lng: -6.26, expectPrefix: '아일랜드' },
  { desc: '키이우', lat: 50.45, lng: 30.52, expect: '우크라이나' },
  { desc: '후쿠오카', lat: 33.59, lng: 130.4, expectPrefix: '일본' },
  { desc: '서울 강남', lat: 37.5, lng: 127.03, expect: '서울 강남' },
  { desc: '뉴욕', lat: 40.71, lng: -74.01, expectPrefix: '미국' },
  // build 290 전 세계 등록 검증 (대륙별 대표 좌표)
  { desc: '싱가포르', lat: 1.35, lng: 103.82, expect: '싱가포르' },
  { desc: '뭄바이', lat: 19.08, lng: 72.88, expectPrefix: '인도' },
  { desc: '카트만두 네팔', lat: 27.72, lng: 85.32, expect: '네팔' },
  { desc: '타슈켄트 우즈베키스탄', lat: 41.3, lng: 69.24, expect: '우즈베키스탄' },
  { desc: '라고스 나이지리아', lat: 6.52, lng: 3.38, expectPrefix: '나이지리아' },
  { desc: '나이로비 케냐', lat: -1.29, lng: 36.82, expectPrefix: '케냐' },
  { desc: '아디스아바바 에티오피아', lat: 9.03, lng: 38.74, expect: '에티오피아' },
  { desc: '루안다 앙골라', lat: -8.84, lng: 13.23, expect: '앙골라' },
  { desc: '로메 토고', lat: 6.13, lng: 1.22, expect: '토고' },
  { desc: '코토누 베냉', lat: 6.37, lng: 2.39, expect: '베냉' },
  { desc: '리마 페루', lat: -12.05, lng: -77.04, expectPrefix: '페루' },
  { desc: '킹스턴 자메이카', lat: 17.97, lng: -76.79, expect: '자메이카' },
  { desc: '수바 피지 (180° 서쪽)', lat: -18.14, lng: 178.44, expect: '피지' },
  { desc: '레이캬비크 아이슬란드', lat: 64.15, lng: -21.94, expectPrefix: '아이슬란드' },
  { desc: '스플리트 크로아티아', lat: 43.51, lng: 16.44, expectPrefix: '크로아티아' },
  { desc: '두브로브니크 크로아티아', lat: 42.65, lng: 18.09, expectPrefix: '크로아티아' },
];

console.log('── 1. 알려진 케이스 ──');
for (const c of KNOWN_CASES) {
  const got = label(c.lat, c.lng);
  const ok = c.expect ? got === c.expect : got != null && got.startsWith(c.expectPrefix!);
  const want = c.expect ?? `${c.expectPrefix}…`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.desc} (${c.lat}, ${c.lng}) → ${got}  (기대: ${want})`);
  if (!ok) failures++;
}

// ─── 2. WORLD 중심점 전수 검사 ──────────────────────────────────────
// bbox 데이터 자체의 겹침 문제 (면적 매칭으로 해소 불가) — 알고리즘 버그 아님.
// 이웃 bbox 가 더 좁아서 중심점을 삼키는 케이스. 실제 라벨은 두 후보 모두 그럴듯한 국경/성경계 지대.
const KNOWN_DATA_ISSUES = new Map<string, string>([
  // '엔트리 이름' → 중심점에서 대신 매칭되는 라벨
  ['노르웨이', '스웨덴'],          // 노르웨이 bbox 중심(64.55, 17.85)이 더 좁은 스웨덴 bbox 내부
  ['콜롬비아', '베네수엘라'],      // 콜롬비아 bbox 중심이 더 좁은 베네수엘라 bbox 내부
  ['베트남', '라오스'],            // 베트남 bbox 중심(내륙 국경지대)이 더 좁은 라오스 bbox 내부
  ['중국 장쑤', '중국 안후이'],    // 성(省) bbox 상호 겹침 — 안후이가 근소하게 좁음
  ['중국 장시', '중국 푸젠'],      // 장시 중심이 푸젠 bbox 서쪽 끝에 걸침
  ['중국 톈진', '중국 베이징'],    // 톈진 중심이 베이징 bbox 동쪽 끝에 걸침 (베이징이 더 좁음)
  ['크로아티아', '보스니아 헤르체고비나'], // 초승달 국토 — bbox 중심(44.45, 16.45)이 실제 보스니아 영토. 해안은 도시 bbox 로 구제
]);

console.log('\n── 2. WORLD 중심점 전수 검사 ──');
let centerPass = 0;
for (const r of WORLD) {
  const clat = (r.bbox[0] + r.bbox[1]) / 2;
  const clng = (r.bbox[2] + r.bbox[3]) / 2;
  const got = label(clat, clng);
  if (got === r.name) {
    centerPass++;
    continue;
  }
  if (KNOWN_DATA_ISSUES.get(r.name) === got) {
    knownIssues++;
    console.log(`KNOWN  ${r.name} 중심 (${clat.toFixed(2)}, ${clng.toFixed(2)}) → ${got}  (bbox 겹침, 문서화됨)`);
    continue;
  }
  failures++;
  console.log(`FAIL   ${r.name} 중심 (${clat.toFixed(2)}, ${clng.toFixed(2)}) → ${got}`);
}
console.log(`중심점 자기매칭: ${centerPass}/${WORLD.length} (known data issue ${knownIssues}건 별도)`);

// ─── 3. 한국 회귀 검사 (이전 알고리즘과 그리드 비교) ────────────────
// 이전 (build 289 이하) KR 분기: 구 → 시·군 → 시·도 first-match, 없으면 '한국'
function legacyKrLabel(lat: number, lng: number): string {
  for (const r of KR_SEOUL_GU) if (inBox(lat, lng, r.bbox)) return r.name;
  for (const r of KR_NON_SEOUL_CITY) if (inBox(lat, lng, r.bbox)) return r.name;
  for (const r of KR_CITY) if (inBox(lat, lng, r.bbox)) return r.name;
  return '한국';
}

console.log('\n── 3. 한국 그리드 회귀 검사 (0.05° step) ──');
let grid = 0;
let same = 0;
let intendedDiff = 0;
const unexpectedDiffs: string[] = [];
// 인덱스 기반 좌표 생성 — float 누적 오차로 그리드가 KR_BBOX 를 벗어나는 것 방지
const latSteps = Math.floor((KR_BBOX[1] - KR_BBOX[0]) / 0.05);
const lngSteps = Math.floor((KR_BBOX[3] - KR_BBOX[2]) / 0.05);
for (let i = 0; i <= latSteps; i++) {
  const lat = Math.min(KR_BBOX[0] + i * 0.05, KR_BBOX[1]);
  for (let j = 0; j <= lngSteps; j++) {
    const lng = Math.min(KR_BBOX[2] + j * 0.05, KR_BBOX[3]);
    grid++;
    const oldLabel = legacyKrLabel(lat, lng);
    const newLabel = label(lat, lng);
    if (newLabel === oldLabel) {
      same++;
    } else if (oldLabel === '한국' && newLabel != null && newLabel.startsWith('일본')) {
      // 의도된 변경: 후쿠오카 겹침 구간 fall-through
      intendedDiff++;
    } else {
      unexpectedDiffs.push(`(${lat.toFixed(2)}, ${lng.toFixed(2)}) old=${oldLabel} new=${newLabel}`);
    }
  }
}
console.log(`그리드 ${grid}점: 동일 ${same}, 의도된 변경(→일본) ${intendedDiff}, 예상밖 차이 ${unexpectedDiffs.length}`);
if (unexpectedDiffs.length > 0) {
  failures += unexpectedDiffs.length;
  for (const d of unexpectedDiffs.slice(0, 20)) console.log(`FAIL   ${d}`);
}

// ─── 4. 영문 라벨 검사 ──────────────────────────────────────────────
console.log('\n── 4. 영문 라벨 검사 ──');
let enMissing = 0;
for (const arr of [WORLD, KR_SEOUL_GU, KR_NON_SEOUL_CITY, KR_CITY]) {
  for (const r of arr) {
    if (!r.en || !r.en.trim()) {
      enMissing++;
      console.log(`FAIL   en 누락: ${r.name}`);
    }
  }
}
failures += enMissing;

const EN_CASES: { desc: string; lat: number; lng: number; expect: string }[] = [
  { desc: '타이베이 en', lat: 25.03, lng: 121.56, expect: 'Taiwan' },
  { desc: '싱가포르 en', lat: 1.35, lng: 103.82, expect: 'Singapore' },
  { desc: '서울 강남 en', lat: 37.5, lng: 127.03, expect: 'Gangnam, Seoul' },
  { desc: '나이로비 en', lat: -1.29, lng: 36.82, expect: 'Nairobi, Kenya' },
  { desc: '수바 피지 en', lat: -18.14, lng: 178.44, expect: 'Fiji' },
];
for (const c of EN_CASES) {
  const got = detectRegionLabel([c.lng, c.lat], null, 'en');
  const ok = got === c.expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.desc} → ${got}  (기대: ${c.expect})`);
  if (!ok) failures++;
}
console.log(`en 필드: ${enMissing === 0 ? '전 엔트리 존재' : `${enMissing}건 누락`}`);

// ─── 결과 ───────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} (known data issues: ${knownIssues})`);
process.exit(failures === 0 ? 0 : 1);
