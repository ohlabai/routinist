// GPS 좌표로 지역 라벨 도출 (build 136 / 공유카드 #5-C).
// 사용자 결정: 한국이면 "서울 강남" 정도, 해외면 "중국 항저우" 정도. 나라명만/없음 케이스도 허용.
//
// 전략 — 무료 + 키 없음 우선:
//   1. 한국 bbox 안 + profile.region_si/gu 가 있으면 그걸 사용 (가장 정확).
//   2. 한국 bbox 안 + profile 없으면 — 한국 주요 도시 bbox 룩업.
//   3. 한국 밖이면 — 국가 bbox 룩업 (중국/일본/미국/유럽 등 굵직한 코호트). 도시는 생략.
//
// 더 정밀한 reverse geocode 가 필요해지면 Nominatim 같은 서비스 추가. 지금은 오프라인 룩업.

interface CoarseRegion {
  name: string;
  // [minLat, maxLat, minLng, maxLng]
  bbox: [number, number, number, number];
}

const KR_BBOX: [number, number, number, number] = [33.0, 38.7, 124.5, 131.9];

// build 171 #2: 서울 25개 구 bbox — profile.region_gu 가 비어있어도 GPS 좌표로 "서울 강남" 표시.
// 굵은 사각형이라 인접 구 경계는 살짝 부정확하지만 모서리 ↔ 중심부 대략적인 매칭은 충분.
// 좁은 → 넓은 순서 (검색 정렬에서 좁은 구가 먼저 매칭됨).
const KR_SEOUL_GU: CoarseRegion[] = [
  { name: '서울 강남', bbox: [37.460, 37.545, 127.000, 127.115] },
  { name: '서울 서초', bbox: [37.450, 37.510, 126.985, 127.060] },
  { name: '서울 송파', bbox: [37.465, 37.535, 127.080, 127.180] },
  { name: '서울 강동', bbox: [37.520, 37.580, 127.115, 127.190] },
  { name: '서울 광진', bbox: [37.525, 37.560, 127.060, 127.115] },
  { name: '서울 성동', bbox: [37.530, 37.575, 127.010, 127.080] },
  { name: '서울 중랑', bbox: [37.575, 37.625, 127.075, 127.135] },
  { name: '서울 동대문', bbox: [37.560, 37.605, 127.030, 127.085] },
  { name: '서울 종로', bbox: [37.565, 37.640, 126.950, 127.030] },
  { name: '서울 중구', bbox: [37.550, 37.580, 126.965, 127.020] },
  { name: '서울 용산', bbox: [37.510, 37.555, 126.955, 127.020] },
  { name: '서울 성북', bbox: [37.580, 37.625, 126.995, 127.075] },
  { name: '서울 강북', bbox: [37.620, 37.665, 126.995, 127.055] },
  { name: '서울 도봉', bbox: [37.640, 37.700, 127.020, 127.075] },
  { name: '서울 노원', bbox: [37.605, 37.680, 127.060, 127.115] },
  { name: '서울 은평', bbox: [37.590, 37.660, 126.890, 126.960] },
  { name: '서울 서대문', bbox: [37.560, 37.605, 126.910, 126.970] },
  { name: '서울 마포', bbox: [37.530, 37.580, 126.890, 126.970] },
  { name: '서울 강서', bbox: [37.530, 37.605, 126.770, 126.880] },
  { name: '서울 양천', bbox: [37.505, 37.560, 126.835, 126.890] },
  { name: '서울 영등포', bbox: [37.495, 37.545, 126.870, 126.945] },
  { name: '서울 구로', bbox: [37.470, 37.515, 126.825, 126.900] },
  { name: '서울 금천', bbox: [37.450, 37.490, 126.870, 126.925] },
  { name: '서울 동작', bbox: [37.480, 37.520, 126.930, 126.985] },
  { name: '서울 관악', bbox: [37.450, 37.500, 126.910, 126.985] },
];

// 한국 시·도 단위 bbox — 충분히 굵게 잡음. profile region 이 우선이므로 fallback 용.
const KR_CITY: CoarseRegion[] = [
  { name: '서울', bbox: [37.42, 37.71, 126.76, 127.18] },
  { name: '인천', bbox: [37.30, 37.65, 126.40, 126.78] },
  { name: '경기', bbox: [36.85, 38.30, 126.30, 127.90] },
  { name: '강원', bbox: [37.05, 38.60, 127.10, 129.50] },
  { name: '대전', bbox: [36.20, 36.50, 127.30, 127.55] },
  { name: '세종', bbox: [36.40, 36.70, 127.10, 127.35] },
  { name: '충북', bbox: [36.00, 37.15, 127.00, 128.65] },
  { name: '충남', bbox: [35.95, 37.05, 125.95, 127.55] },
  { name: '전북', bbox: [35.30, 36.25, 126.10, 127.95] },
  { name: '전남', bbox: [33.80, 35.50, 125.90, 127.85] },
  { name: '광주', bbox: [35.05, 35.30, 126.65, 127.00] },
  { name: '경북', bbox: [35.45, 37.15, 127.85, 129.65] },
  { name: '경남', bbox: [34.45, 35.65, 127.45, 129.30] },
  { name: '대구', bbox: [35.75, 36.05, 128.45, 128.80] },
  { name: '울산', bbox: [35.40, 35.75, 128.95, 129.45] },
  { name: '부산', bbox: [35.05, 35.40, 128.85, 129.30] },
  { name: '제주', bbox: [33.10, 33.65, 126.10, 126.95] },
];

// 글로벌 — 대륙·국가 단위. 사용자가 자주 가는 곳 위주로 굵게.
const WORLD: CoarseRegion[] = [
  { name: '일본 도쿄', bbox: [35.40, 35.95, 139.30, 139.95] },
  { name: '일본 오사카', bbox: [34.40, 34.85, 135.30, 135.75] },
  { name: '일본', bbox: [24.0, 46.0, 122.5, 153.0] },
  { name: '중국 베이징', bbox: [39.40, 40.30, 115.70, 117.50] },
  { name: '중국 상하이', bbox: [30.70, 31.55, 120.85, 122.20] },
  { name: '중국 항저우', bbox: [30.05, 30.55, 119.85, 120.55] },
  { name: '중국 광저우', bbox: [22.95, 23.55, 113.10, 113.75] },
  { name: '중국', bbox: [18.0, 54.0, 73.0, 135.0] },
  { name: '대만', bbox: [21.8, 25.4, 119.5, 122.1] },
  { name: '홍콩', bbox: [22.15, 22.55, 113.85, 114.45] },
  { name: '베트남 호치민', bbox: [10.65, 10.95, 106.55, 106.85] },
  { name: '베트남 하노이', bbox: [20.85, 21.15, 105.70, 106.00] },
  { name: '베트남', bbox: [8.5, 23.4, 102.0, 110.0] },
  { name: '태국 방콕', bbox: [13.55, 14.05, 100.30, 100.95] },
  { name: '태국', bbox: [5.5, 20.5, 97.0, 106.0] },
  { name: '싱가포르', bbox: [1.18, 1.48, 103.60, 104.05] },
  { name: '미국 LA', bbox: [33.65, 34.35, -118.70, -117.95] },
  { name: '미국 뉴욕', bbox: [40.50, 40.95, -74.30, -73.65] },
  { name: '미국 샌프란시스코', bbox: [37.65, 37.85, -122.55, -122.30] },
  { name: '미국', bbox: [24.0, 50.0, -125.0, -66.0] },
  { name: '캐나다', bbox: [42.0, 70.0, -141.0, -52.0] },
  { name: '영국 런던', bbox: [51.30, 51.70, -0.55, 0.25] },
  { name: '영국', bbox: [49.5, 60.5, -8.5, 2.0] },
  { name: '프랑스 파리', bbox: [48.75, 48.95, 2.20, 2.50] },
  { name: '프랑스', bbox: [41.5, 51.5, -5.0, 9.5] },
  { name: '독일 베를린', bbox: [52.30, 52.70, 13.05, 13.75] },
  { name: '독일', bbox: [47.0, 55.5, 5.5, 15.5] },
  { name: '스페인', bbox: [35.5, 44.0, -10.0, 4.5] },
  { name: '이탈리아', bbox: [35.0, 47.5, 6.5, 19.0] },
  { name: '호주 시드니', bbox: [-34.20, -33.55, 150.50, 151.40] },
  { name: '호주', bbox: [-44.0, -10.0, 112.0, 154.0] },
];

function inBox(lat: number, lng: number, bbox: [number, number, number, number]): boolean {
  return lat >= bbox[0] && lat <= bbox[1] && lng >= bbox[2] && lng <= bbox[3];
}

export interface ProfileRegionHint {
  region_si?: string | null;
  region_gu?: string | null;
}

/**
 * GPS 첫 좌표 + 선택적 profile 힌트 → 표시용 라벨.
 * 한국이면 profile 의 시·구 합쳐 "서울 강남". 해외면 굵직한 도시명.
 * null 반환 시 라벨 미표시.
 */
export function detectRegionLabel(
  firstCoord: [number, number] | null | undefined,
  profile?: ProfileRegionHint | null,
): string | null {
  if (!firstCoord) {
    // GPS 없으면 profile 정보라도
    if (profile?.region_si || profile?.region_gu) {
      return shortenKR(profile.region_si, profile.region_gu);
    }
    return null;
  }
  const [lng, lat] = firstCoord;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // build 173.1 #3: GPS 우선 정책 변경.
  //   이전: profile.region_gu 가 있으면 거주지 우선 → 사용자가 다른 지역에서 달려도 거주지 표시 (사용자 신고).
  //   변경: 한국 안 + GPS 좌표 → 25개 구 bbox 룩업 (서울) 또는 KR_CITY (시·도) 룩업 우선.
  //   profile region 은 마지막 fallback (GPS 가 매칭 안 될 때).
  if (inBox(lat, lng, KR_BBOX)) {
    // 1) GPS 가 서울 안이면 25개 구 bbox 룩업 (가장 정밀)
    for (const r of KR_SEOUL_GU) {
      if (inBox(lat, lng, r.bbox)) return r.name;
    }
    // 2) 서울 외 시·도 bbox 룩업
    for (const r of KR_CITY) {
      if (inBox(lat, lng, r.bbox)) return r.name;
    }
    // 3) 매칭 안 되면 profile region 사용 (한국 안인데 bbox 룩업 실패한 변두리)
    if (profile?.region_si || profile?.region_gu) {
      return shortenKR(profile.region_si, profile.region_gu);
    }
    return '한국';
  }

  // 해외 — 첫 매칭 룩업 (좁은 도시 → 넓은 국가 순서로 정렬됨)
  for (const r of WORLD) {
    if (inBox(lat, lng, r.bbox)) return r.name;
  }
  return null; // 알 수 없는 좌표 — 라벨 생략
}

function shortenKR(si?: string | null, gu?: string | null): string | null {
  // "서울특별시" → "서울", "강남구" → "강남"
  const shortSi = si ? si.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/g, '') : '';
  const shortGu = gu ? gu.replace(/(구|군|시)$/g, '') : '';
  const out = [shortSi, shortGu].filter(Boolean).join(' ');
  return out || null;
}
