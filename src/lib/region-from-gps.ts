// GPS 좌표로 지역 라벨 도출 (build 136 / 공유카드 #5-C).
// 사용자 결정: 한국이면 "서울 강남" 정도, 해외면 "중국 항저우" 정도. 나라명만/없음 케이스도 허용.
//
// 전략 — 무료 + 키 없음 우선:
//   1. 한국 bbox 안 + profile.region_si/gu 가 있으면 그걸 사용 (가장 정확).
//   2. 한국 bbox 안 + profile 없으면 — 한국 주요 도시 bbox 룩업.
//   3. 한국 밖이면 — 국가 bbox 룩업 (중국/일본/미국/유럽 등 굵직한 코호트). 도시는 생략.
//
// 더 정밀한 reverse geocode 가 필요해지면 Nominatim 같은 서비스 추가. 지금은 오프라인 룩업.
//
// build 291 (2026-07-06): 전 세계 커버.
//   - UN 회원국 + 주요 속령(괌/사이판/푸에르토리코/그린란드/누벨칼레도니 등) 전부 국가 단위 bbox 등록
//     → 세계 어느 나라에서 달려도 최소 국가명은 표시.
//   - 전 엔트리에 en (영문 라벨) 추가. detectRegionLabel(coord, profile, locale) 로 선택.
//   - 경도 180° 를 넘는 나라 (피지/키리바시) 는 inBox 가 단순 min≤lng≤max 비교이므로
//     동/서 두 엔트리로 분할 (같은 name 허용 — 셀프테스트는 name 기준 비교).

interface CoarseRegion {
  name: string;
  // 영문 라벨 — 도시는 "City, Country", 국가는 국가명만 (KR 은 국립국어원 로마자 표기)
  en: string;
  // [minLat, maxLat, minLng, maxLng]
  bbox: [number, number, number, number];
}

// (KR_* export 는 테스트용 — scripts/check-region-bboxes.ts)
export const KR_BBOX: [number, number, number, number] = [33.0, 38.7, 124.5, 131.9];

// build 171 #2: 서울 25개 구 bbox — profile.region_gu 가 비어있어도 GPS 좌표로 "서울 강남" 표시.
// 굵은 사각형이라 인접 구 경계는 살짝 부정확하지만 모서리 ↔ 중심부 대략적인 매칭은 충분.
// 좁은 → 넓은 순서 (검색 정렬에서 좁은 구가 먼저 매칭됨).
export const KR_SEOUL_GU: CoarseRegion[] = [
  { name: '서울 강남', en: 'Gangnam, Seoul', bbox: [37.460, 37.545, 127.000, 127.115] },
  { name: '서울 서초', en: 'Seocho, Seoul', bbox: [37.450, 37.510, 126.985, 127.060] },
  { name: '서울 송파', en: 'Songpa, Seoul', bbox: [37.465, 37.535, 127.080, 127.180] },
  { name: '서울 강동', en: 'Gangdong, Seoul', bbox: [37.520, 37.580, 127.115, 127.190] },
  { name: '서울 광진', en: 'Gwangjin, Seoul', bbox: [37.525, 37.560, 127.060, 127.115] },
  { name: '서울 성동', en: 'Seongdong, Seoul', bbox: [37.530, 37.575, 127.010, 127.080] },
  { name: '서울 중랑', en: 'Jungnang, Seoul', bbox: [37.575, 37.625, 127.075, 127.135] },
  { name: '서울 동대문', en: 'Dongdaemun, Seoul', bbox: [37.560, 37.605, 127.030, 127.085] },
  { name: '서울 종로', en: 'Jongno, Seoul', bbox: [37.565, 37.640, 126.950, 127.030] },
  { name: '서울 중구', en: 'Jung-gu, Seoul', bbox: [37.550, 37.580, 126.965, 127.020] },
  { name: '서울 용산', en: 'Yongsan, Seoul', bbox: [37.510, 37.555, 126.955, 127.020] },
  { name: '서울 성북', en: 'Seongbuk, Seoul', bbox: [37.580, 37.625, 126.995, 127.075] },
  { name: '서울 강북', en: 'Gangbuk, Seoul', bbox: [37.620, 37.665, 126.995, 127.055] },
  { name: '서울 도봉', en: 'Dobong, Seoul', bbox: [37.640, 37.700, 127.020, 127.075] },
  { name: '서울 노원', en: 'Nowon, Seoul', bbox: [37.605, 37.680, 127.060, 127.115] },
  { name: '서울 은평', en: 'Eunpyeong, Seoul', bbox: [37.590, 37.660, 126.890, 126.960] },
  { name: '서울 서대문', en: 'Seodaemun, Seoul', bbox: [37.560, 37.605, 126.910, 126.970] },
  { name: '서울 마포', en: 'Mapo, Seoul', bbox: [37.530, 37.580, 126.890, 126.970] },
  { name: '서울 강서', en: 'Gangseo, Seoul', bbox: [37.530, 37.605, 126.770, 126.880] },
  { name: '서울 양천', en: 'Yangcheon, Seoul', bbox: [37.505, 37.560, 126.835, 126.890] },
  { name: '서울 영등포', en: 'Yeongdeungpo, Seoul', bbox: [37.495, 37.545, 126.870, 126.945] },
  { name: '서울 구로', en: 'Guro, Seoul', bbox: [37.470, 37.515, 126.825, 126.900] },
  { name: '서울 금천', en: 'Geumcheon, Seoul', bbox: [37.450, 37.490, 126.870, 126.925] },
  { name: '서울 동작', en: 'Dongjak, Seoul', bbox: [37.480, 37.520, 126.930, 126.985] },
  { name: '서울 관악', en: 'Gwanak, Seoul', bbox: [37.450, 37.500, 126.910, 126.985] },
];

// build 218 #1: 비-서울 한국 시·군 2-tier bbox. "경기 양평" / "경남 진주" 등.
// 정확도는 ±0.05도 (≈5km) 수준. 좁은 도시 매칭 → 광역시·도 fallback 순서.
// 군은 전 면적 포괄하도록 넓게 잡음.
export const KR_NON_SEOUL_CITY: CoarseRegion[] = [
  // 경기
  { name: '경기 양평', en: 'Yangpyeong', bbox: [37.39, 37.66, 127.31, 127.86] },
  { name: '경기 가평', en: 'Gapyeong', bbox: [37.66, 38.00, 127.25, 127.65] },
  { name: '경기 수원', en: 'Suwon', bbox: [37.21, 37.34, 126.93, 127.10] },
  { name: '경기 성남', en: 'Seongnam', bbox: [37.36, 37.50, 127.06, 127.21] },
  { name: '경기 용인', en: 'Yongin', bbox: [37.13, 37.38, 127.05, 127.34] },
  { name: '경기 안양', en: 'Anyang', bbox: [37.34, 37.43, 126.89, 126.99] },
  { name: '경기 부천', en: 'Bucheon', bbox: [37.43, 37.55, 126.71, 126.84] },
  { name: '경기 평택', en: 'Pyeongtaek', bbox: [36.92, 37.13, 126.79, 127.20] },
  { name: '경기 의정부', en: 'Uijeongbu', bbox: [37.69, 37.79, 127.02, 127.13] },
  { name: '경기 화성', en: 'Hwaseong', bbox: [36.96, 37.30, 126.65, 127.10] },
  { name: '경기 시흥', en: 'Siheung', bbox: [37.30, 37.46, 126.69, 126.85] },
  { name: '경기 광주', en: 'Gwangju, Gyeonggi', bbox: [37.30, 37.52, 127.15, 127.40] },
  { name: '경기 파주', en: 'Paju', bbox: [37.65, 38.00, 126.65, 127.00] },
  { name: '경기 김포', en: 'Gimpo', bbox: [37.55, 37.78, 126.55, 126.78] },
  { name: '경기 안산', en: 'Ansan', bbox: [37.25, 37.40, 126.70, 126.90] },
  { name: '경기 광명', en: 'Gwangmyeong', bbox: [37.41, 37.50, 126.81, 126.91] },
  { name: '경기 남양주', en: 'Namyangju', bbox: [37.55, 37.80, 127.10, 127.40] },
  { name: '경기 하남', en: 'Hanam', bbox: [37.49, 37.62, 127.16, 127.30] },
  { name: '경기 구리', en: 'Guri', bbox: [37.57, 37.65, 127.12, 127.20] },
  { name: '경기 이천', en: 'Icheon', bbox: [37.15, 37.39, 127.30, 127.55] },
  { name: '경기 여주', en: 'Yeoju', bbox: [37.18, 37.45, 127.50, 127.85] },
  { name: '경기 포천', en: 'Pocheon', bbox: [37.78, 38.15, 127.05, 127.40] },
  // 경남
  { name: '경남 진주', en: 'Jinju', bbox: [35.10, 35.30, 127.95, 128.25] },
  { name: '경남 창원', en: 'Changwon', bbox: [35.10, 35.40, 128.50, 128.85] },
  { name: '경남 김해', en: 'Gimhae', bbox: [35.13, 35.35, 128.75, 129.00] },
  { name: '경남 양산', en: 'Yangsan', bbox: [35.25, 35.50, 128.95, 129.20] },
  { name: '경남 거제', en: 'Geoje', bbox: [34.65, 34.95, 128.55, 128.80] },
  { name: '경남 통영', en: 'Tongyeong', bbox: [34.75, 34.95, 128.30, 128.50] },
  // 경북
  { name: '경북 포항', en: 'Pohang', bbox: [35.95, 36.25, 129.20, 129.55] },
  { name: '경북 경주', en: 'Gyeongju', bbox: [35.70, 35.95, 129.10, 129.40] },
  { name: '경북 구미', en: 'Gumi', bbox: [36.05, 36.25, 128.25, 128.55] },
  { name: '경북 안동', en: 'Andong', bbox: [36.45, 36.70, 128.55, 128.95] },
  // 충북
  { name: '충북 청주', en: 'Cheongju', bbox: [36.55, 36.75, 127.40, 127.65] },
  { name: '충북 충주', en: 'Chungju', bbox: [36.85, 37.15, 127.75, 128.10] },
  // 충남
  { name: '충남 천안', en: 'Cheonan', bbox: [36.70, 36.95, 127.05, 127.25] },
  { name: '충남 아산', en: 'Asan', bbox: [36.70, 36.95, 126.85, 127.10] },
  { name: '충남 서산', en: 'Seosan', bbox: [36.65, 37.00, 126.30, 126.70] },
  { name: '충남 공주', en: 'Gongju', bbox: [36.30, 36.65, 126.85, 127.25] },
  // 전북
  { name: '전북 전주', en: 'Jeonju', bbox: [35.75, 35.95, 127.05, 127.20] },
  { name: '전북 익산', en: 'Iksan', bbox: [35.85, 36.10, 126.85, 127.10] },
  { name: '전북 군산', en: 'Gunsan', bbox: [35.85, 36.10, 126.55, 126.80] },
  // 전남
  { name: '전남 여수', en: 'Yeosu', bbox: [34.50, 34.85, 127.55, 127.85] },
  { name: '전남 순천', en: 'Suncheon', bbox: [34.85, 35.15, 127.30, 127.65] },
  { name: '전남 광양', en: 'Gwangyang', bbox: [34.90, 35.10, 127.55, 127.85] },
  { name: '전남 목포', en: 'Mokpo', bbox: [34.70, 34.85, 126.30, 126.45] },
  // 강원
  { name: '강원 춘천', en: 'Chuncheon', bbox: [37.75, 38.05, 127.65, 127.95] },
  { name: '강원 강릉', en: 'Gangneung', bbox: [37.65, 37.95, 128.75, 129.05] },
  { name: '강원 원주', en: 'Wonju', bbox: [37.20, 37.50, 127.85, 128.20] },
  { name: '강원 속초', en: 'Sokcho', bbox: [38.15, 38.25, 128.50, 128.65] },
  // 제주 — 시 단위 (도가 작아 제주/서귀포 2개로 분할)
  { name: '제주시', en: 'Jeju City', bbox: [33.40, 33.65, 126.30, 126.95] },
  { name: '제주 서귀포', en: 'Seogwipo', bbox: [33.20, 33.40, 126.30, 126.95] },
  // 인천 군구 — 광역시 직속 군은 인천 광역시 전체 매칭. 별도 처리 X
];

// 한국 시·도 단위 bbox — KR_NON_SEOUL_CITY 에서 매칭 안 되면 fallback.
export const KR_CITY: CoarseRegion[] = [
  { name: '서울', en: 'Seoul', bbox: [37.42, 37.71, 126.76, 127.18] },
  { name: '인천', en: 'Incheon', bbox: [37.30, 37.65, 126.40, 126.78] },
  { name: '경기', en: 'Gyeonggi', bbox: [36.85, 38.30, 126.30, 127.90] },
  { name: '강원', en: 'Gangwon', bbox: [37.05, 38.60, 127.10, 129.50] },
  { name: '대전', en: 'Daejeon', bbox: [36.20, 36.50, 127.30, 127.55] },
  { name: '세종', en: 'Sejong', bbox: [36.40, 36.70, 127.10, 127.35] },
  { name: '충북', en: 'Chungbuk', bbox: [36.00, 37.15, 127.00, 128.65] },
  { name: '충남', en: 'Chungnam', bbox: [35.95, 37.05, 125.95, 127.55] },
  { name: '전북', en: 'Jeonbuk', bbox: [35.30, 36.25, 126.10, 127.95] },
  { name: '전남', en: 'Jeonnam', bbox: [33.80, 35.50, 125.90, 127.85] },
  { name: '광주', en: 'Gwangju', bbox: [35.05, 35.30, 126.65, 127.00] },
  { name: '경북', en: 'Gyeongbuk', bbox: [35.45, 37.15, 127.85, 129.65] },
  { name: '경남', en: 'Gyeongnam', bbox: [34.45, 35.65, 127.45, 129.30] },
  { name: '대구', en: 'Daegu', bbox: [35.75, 36.05, 128.45, 128.80] },
  { name: '울산', en: 'Ulsan', bbox: [35.40, 35.75, 128.95, 129.45] },
  { name: '부산', en: 'Busan', bbox: [35.05, 35.40, 128.85, 129.30] },
  { name: '제주', en: 'Jeju', bbox: [33.10, 33.65, 126.10, 126.95] },
];

// 글로벌 — 대륙·국가 단위. 사용자가 자주 가는 곳 위주로 굵게.
//
// build 288 (2026-06-13): 주요 50+ 국가 선제 등록. 이전엔 사용자 신고 받을 때마다 추가하던 방식.
// 한국 outbound 인기 destination 위주 — 아시아 / 미주 / 유럽 / 오세아니아 / 아프리카 / 중동 망라.
//
// **매칭 룰** (build 290 변경): 첫 매칭이 아니라 **포인트를 포함하는 bbox 중 면적 최소**를 선택.
//   → 배열 순서에 의존하지 않음. 도시 > 소국 > 대국이 면적으로 자연 우선됨.
//   → 이전의 first-match 방식은 중국 bbox 가 대만/홍콩/몽골을, 미국이 캐나다 도시를,
//     영국이 더블린을, 러시아가 우크라이나를 shadow 하는 버그가 있었음.
//   면적 동률일 때만 배열 앞쪽이 이김. 아래 배열은 가독성을 위해 좁은 → 넓은 순서 유지.
// (테스트용 export — scripts/check-region-bboxes.ts 에서 전수 검사)
export const WORLD: CoarseRegion[] = [
  // ─── 동아시아 ─────────────────────────────────────────────────
  // 일본
  { name: '일본 도쿄', en: 'Tokyo, Japan', bbox: [35.40, 35.95, 139.30, 139.95] },
  { name: '일본 오사카', en: 'Osaka, Japan', bbox: [34.40, 34.85, 135.30, 135.75] },
  { name: '일본 교토', en: 'Kyoto, Japan', bbox: [34.95, 35.10, 135.65, 135.85] },
  { name: '일본 후쿠오카', en: 'Fukuoka, Japan', bbox: [33.45, 33.75, 130.30, 130.55] },
  { name: '일본 삿포로', en: 'Sapporo, Japan', bbox: [42.95, 43.20, 141.20, 141.50] },
  { name: '일본 나고야', en: 'Nagoya, Japan', bbox: [35.10, 35.30, 136.80, 137.00] },
  { name: '일본 오키나와', en: 'Okinawa, Japan', bbox: [26.00, 26.40, 127.50, 127.90] },
  { name: '일본', en: 'Japan', bbox: [24.0, 46.0, 122.5, 153.0] },

  // 중국 — 직할시 / 성(省) 단위 / 국가 fallback. build 220 #5: 항저우 등 좁은 도시는 성 단위로 통합.
  { name: '중국 베이징', en: 'Beijing, China', bbox: [39.40, 40.30, 115.70, 117.50] },
  { name: '중국 상하이', en: 'Shanghai, China', bbox: [30.70, 31.55, 120.85, 122.20] },
  { name: '중국 톈진', en: 'Tianjin, China', bbox: [38.70, 40.30, 116.70, 118.20] },
  { name: '중국 충칭', en: 'Chongqing, China', bbox: [28.00, 32.20, 105.30, 110.20] },
  { name: '중국 저장', en: 'Zhejiang, China', bbox: [27.00, 31.30, 118.00, 123.00] },
  { name: '중국 광둥', en: 'Guangdong, China', bbox: [20.20, 25.50, 109.70, 117.20] },
  { name: '중국 장쑤', en: 'Jiangsu, China', bbox: [30.70, 35.20, 116.30, 121.95] },
  { name: '중국 산둥', en: 'Shandong, China', bbox: [34.30, 38.40, 114.80, 122.70] },
  { name: '중국 푸젠', en: 'Fujian, China', bbox: [23.50, 28.30, 115.80, 120.50] },
  { name: '중국 쓰촨', en: 'Sichuan, China', bbox: [26.00, 34.30, 97.30, 108.60] },
  { name: '중국 후베이', en: 'Hubei, China', bbox: [29.00, 33.30, 108.30, 116.10] },
  { name: '중국 산시(陝)', en: 'Shaanxi, China', bbox: [31.40, 39.60, 105.50, 111.20] },
  { name: '중국 랴오닝', en: 'Liaoning, China', bbox: [38.70, 43.30, 118.80, 125.80] },
  { name: '중국 헤이룽장', en: 'Heilongjiang, China', bbox: [43.40, 53.60, 121.20, 135.10] },
  { name: '중국 윈난', en: 'Yunnan, China', bbox: [21.10, 29.20, 97.50, 106.20] },
  { name: '중국 허난', en: 'Henan, China', bbox: [31.40, 36.40, 110.30, 116.70] },
  { name: '중국 후난', en: 'Hunan, China', bbox: [24.60, 30.10, 108.80, 114.30] },
  { name: '중국 안후이', en: 'Anhui, China', bbox: [29.40, 34.70, 114.80, 119.40] },
  { name: '중국 허베이', en: 'Hebei, China', bbox: [36.00, 42.70, 113.40, 119.90] },
  { name: '중국 광시', en: 'Guangxi, China', bbox: [20.80, 26.40, 104.30, 112.00] },
  { name: '중국 장시', en: 'Jiangxi, China', bbox: [24.40, 30.10, 113.50, 118.50] },
  { name: '중국 하이난', en: 'Hainan, China', bbox: [18.10, 20.20, 108.50, 111.10] },
  { name: '중국', en: 'China', bbox: [18.0, 54.0, 73.0, 135.0] },
  { name: '대만', en: 'Taiwan', bbox: [21.8, 25.4, 119.5, 122.1] },
  { name: '홍콩', en: 'Hong Kong', bbox: [22.15, 22.55, 113.85, 114.45] },
  { name: '마카오', en: 'Macau', bbox: [22.10, 22.22, 113.50, 113.62] },
  { name: '몽골', en: 'Mongolia', bbox: [41.5, 52.2, 87.7, 119.9] },
  // build 291: latMax 42.5 — 43.01 까지가 실제 북단(온성)이지만 중국 옌지(42.9) 흡수 방지.
  //            국경 하천변 중국 소도시 (단둥 등) 일부가 북한으로 표기될 수 있음 (rect 한계).
  { name: '북한', en: 'North Korea', bbox: [37.67, 42.5, 124.15, 130.7] },

  // ─── 동남아 ───────────────────────────────────────────────────
  { name: '베트남 호치민', en: 'Ho Chi Minh City, Vietnam', bbox: [10.65, 10.95, 106.55, 106.85] },
  { name: '베트남 하노이', en: 'Hanoi, Vietnam', bbox: [20.85, 21.15, 105.70, 106.00] },
  { name: '베트남 다낭', en: 'Da Nang, Vietnam', bbox: [15.90, 16.20, 108.10, 108.35] },
  { name: '베트남', en: 'Vietnam', bbox: [8.5, 23.4, 102.0, 110.0] },
  { name: '태국 방콕', en: 'Bangkok, Thailand', bbox: [13.55, 14.05, 100.30, 100.95] },
  { name: '태국 푸켓', en: 'Phuket, Thailand', bbox: [7.70, 8.20, 98.20, 98.55] },
  { name: '태국 치앙마이', en: 'Chiang Mai, Thailand', bbox: [18.60, 18.95, 98.85, 99.10] },
  { name: '태국', en: 'Thailand', bbox: [5.5, 20.5, 97.0, 106.0] },
  { name: '싱가포르', en: 'Singapore', bbox: [1.18, 1.48, 103.60, 104.05] },          // 말레이시아 위
  { name: '브루나이', en: 'Brunei', bbox: [4.0, 5.1, 114.0, 115.4] },              // 말레이시아 위
  { name: '말레이시아 쿠알라룸푸르', en: 'Kuala Lumpur, Malaysia', bbox: [3.00, 3.30, 101.55, 101.85] },
  { name: '말레이시아', en: 'Malaysia', bbox: [0.8, 7.4, 99.6, 119.3] },
  { name: '인도네시아 자카르타', en: 'Jakarta, Indonesia', bbox: [-6.40, -6.05, 106.65, 107.05] },
  { name: '인도네시아 발리', en: 'Bali, Indonesia', bbox: [-8.85, -8.30, 114.95, 115.75] },
  { name: '인도네시아', en: 'Indonesia', bbox: [-11.0, 6.1, 95.0, 141.0] },
  { name: '필리핀 마닐라', en: 'Manila, Philippines', bbox: [14.40, 14.80, 120.85, 121.10] },
  { name: '필리핀 세부', en: 'Cebu, Philippines', bbox: [10.10, 10.50, 123.70, 124.10] },
  { name: '필리핀', en: 'Philippines', bbox: [4.5, 21.0, 116.9, 126.7] },
  { name: '캄보디아', en: 'Cambodia', bbox: [10.4, 14.7, 102.3, 107.6] },
  { name: '라오스', en: 'Laos', bbox: [13.9, 22.5, 100.1, 107.7] },
  { name: '미얀마', en: 'Myanmar', bbox: [9.5, 28.6, 92.2, 101.2] },
  { name: '동티모르', en: 'Timor-Leste', bbox: [-9.51, -8.12, 124.04, 127.35] }, // 인도네시아 위 (면적 최소 매칭)

  // ─── 남아시아 ─────────────────────────────────────────────────
  { name: '인도 뭄바이', en: 'Mumbai, India', bbox: [18.85, 19.30, 72.75, 73.05] },
  { name: '인도 델리', en: 'Delhi, India', bbox: [28.40, 28.85, 76.90, 77.45] },
  { name: '인도 방갈로르', en: 'Bangalore, India', bbox: [12.80, 13.15, 77.45, 77.75] },
  { name: '인도', en: 'India', bbox: [6.5, 35.5, 68.0, 97.5] },
  { name: '네팔', en: 'Nepal', bbox: [26.3, 30.5, 80.0, 88.2] },
  { name: '스리랑카', en: 'Sri Lanka', bbox: [5.9, 9.9, 79.5, 81.9] },
  { name: '방글라데시', en: 'Bangladesh', bbox: [20.7, 26.7, 88.0, 92.7] },
  { name: '파키스탄', en: 'Pakistan', bbox: [23.7, 37.1, 60.8, 77.0] },
  { name: '몰디브', en: 'Maldives', bbox: [-0.7, 7.1, 72.6, 73.8] },
  { name: '부탄', en: 'Bhutan', bbox: [26.7, 28.35, 88.7, 92.15] },
  // build 291: latMin 30.5 — 실제 남단은 29.4 이지만 파키스탄 bbox 중심점(30.4, 68.9) 충돌 회피.
  //            남부 사막(레기스탄) 일부는 파키스탄으로 표기됨 (rect 한계).
  { name: '아프가니스탄', en: 'Afghanistan', bbox: [30.5, 38.5, 60.5, 74.9] },

  // ─── 중앙아시아 ───────────────────────────────────────────────
  { name: '카자흐스탄', en: 'Kazakhstan', bbox: [40.5, 55.5, 46.4, 87.4] },
  { name: '우즈베키스탄', en: 'Uzbekistan', bbox: [37.2, 45.6, 56.0, 73.2] },
  // build 291: 페르가나 분지 국경이 톱니라 rect 로는 상호 침범 불가피 — 수도/주요 도시 기준으로 조정.
  { name: '키르기스스탄', en: 'Kyrgyzstan', bbox: [39.17, 43.27, 69.3, 80.3] },   // lngMin 69.3: 타슈켄트(69.24) 제외
  { name: '타지키스탄', en: 'Tajikistan', bbox: [36.67, 40.4, 67.3, 75.15] },     // latMax 40.4: 오시(40.53) 제외
  { name: '투르크메니스탄', en: 'Turkmenistan', bbox: [35.13, 42.2, 52.44, 64.5] }, // lngMax 64.5: 우즈벡 bbox 중심점(64.6) 충돌 회피

  // ─── 중동 ─────────────────────────────────────────────────────
  { name: 'UAE 두바이', en: 'Dubai, UAE', bbox: [24.95, 25.50, 55.05, 55.50] },
  { name: 'UAE 아부다비', en: 'Abu Dhabi, UAE', bbox: [24.30, 24.70, 54.20, 54.70] },
  { name: 'UAE', en: 'UAE', bbox: [22.5, 26.5, 51.0, 56.5] },
  { name: '이스라엘 텔아비브', en: 'Tel Aviv, Israel', bbox: [32.00, 32.20, 34.70, 34.85] },
  { name: '이스라엘', en: 'Israel', bbox: [29.5, 33.5, 34.0, 36.0] },
  { name: '터키 이스탄불', en: 'Istanbul, Turkey', bbox: [40.80, 41.30, 28.65, 29.30] },
  { name: '터키', en: 'Turkey', bbox: [35.8, 42.1, 26.0, 44.8] },
  { name: '사우디아라비아', en: 'Saudi Arabia', bbox: [16.5, 32.2, 34.5, 55.7] },
  { name: '카타르', en: 'Qatar', bbox: [24.4, 26.2, 50.7, 51.7] },
  { name: '쿠웨이트', en: 'Kuwait', bbox: [28.5, 30.1, 46.5, 48.5] },
  { name: '바레인', en: 'Bahrain', bbox: [25.5, 26.4, 50.3, 50.8] },
  { name: '오만', en: 'Oman', bbox: [16.6, 26.5, 51.9, 59.8] },
  { name: '요르단', en: 'Jordan', bbox: [29.2, 33.4, 34.9, 39.3] },
  { name: '이란', en: 'Iran', bbox: [25.1, 39.8, 44.0, 63.3] },
  { name: '이라크', en: 'Iraq', bbox: [29.0, 37.4, 38.8, 48.6] },
  // build 291: latMax 37.05 — 실제 북단 37.32 지만 터키 가지안테프(37.07) 흡수 방지.
  { name: '시리아', en: 'Syria', bbox: [32.3, 37.05, 35.7, 42.4] },
  { name: '레바논', en: 'Lebanon', bbox: [33.05, 34.7, 35.1, 36.63] },           // 시리아/이스라엘 위 (더 좁음)
  { name: '예멘', en: 'Yemen', bbox: [12.1, 19.0, 42.5, 53.1] },
  // 팔레스타인 — 가자 + 서안 2분할. 서안 latMin 31.55: 이스라엘 bbox 중심점(31.5, 35.0) 충돌 회피.
  { name: '팔레스타인', en: 'Palestine', bbox: [31.22, 31.60, 34.20, 34.57] },   // 가자
  { name: '팔레스타인', en: 'Palestine', bbox: [31.55, 32.55, 34.95, 35.57] },   // 서안
  { name: '이스라엘 예루살렘', en: 'Jerusalem, Israel', bbox: [31.72, 31.85, 35.10, 35.28] }, // 서안 bbox 보다 좁게
  { name: '키프로스', en: 'Cyprus', bbox: [34.5, 35.72, 32.2, 34.65] },
  { name: '조지아', en: 'Georgia', bbox: [41.05, 43.59, 39.99, 46.74] },
  { name: '아르메니아', en: 'Armenia', bbox: [38.84, 41.30, 43.45, 46.63] },
  { name: '아제르바이잔', en: 'Azerbaijan', bbox: [38.39, 41.91, 44.77, 50.37] },

  // ─── 북미 ─────────────────────────────────────────────────────
  // 미국 — 본토 도시 → 본토 → 알래스카·하와이 별도
  { name: '미국 LA', en: 'Los Angeles, USA', bbox: [33.65, 34.35, -118.70, -117.95] },
  { name: '미국 뉴욕', en: 'New York, USA', bbox: [40.50, 40.95, -74.30, -73.65] },
  { name: '미국 샌프란시스코', en: 'San Francisco, USA', bbox: [37.65, 37.85, -122.55, -122.30] },
  { name: '미국 시애틀', en: 'Seattle, USA', bbox: [47.45, 47.75, -122.45, -122.20] },
  { name: '미국 시카고', en: 'Chicago, USA', bbox: [41.65, 42.05, -87.95, -87.50] },
  { name: '미국 보스턴', en: 'Boston, USA', bbox: [42.20, 42.45, -71.25, -70.95] },
  { name: '미국 워싱턴DC', en: 'Washington D.C., USA', bbox: [38.80, 39.00, -77.15, -76.90] },
  { name: '미국 마이애미', en: 'Miami, USA', bbox: [25.55, 25.95, -80.45, -80.10] },
  { name: '미국 라스베이거스', en: 'Las Vegas, USA', bbox: [36.00, 36.35, -115.35, -115.00] },
  { name: '미국 호놀룰루', en: 'Honolulu, USA', bbox: [21.15, 21.45, -158.10, -157.65] },
  { name: '미국 하와이', en: 'Hawaii, USA', bbox: [18.5, 23.0, -161.5, -154.5] },        // 본토 외 섬
  { name: '미국 알래스카', en: 'Alaska, USA', bbox: [51.0, 72.0, -180.0, -130.0] },      // 본토 외
  { name: '미국', en: 'USA', bbox: [24.0, 50.0, -125.0, -66.0] },

  // 캐나다
  { name: '캐나다 토론토', en: 'Toronto, Canada', bbox: [43.55, 43.85, -79.65, -79.10] },
  { name: '캐나다 밴쿠버', en: 'Vancouver, Canada', bbox: [49.20, 49.40, -123.30, -122.95] },
  { name: '캐나다 몬트리올', en: 'Montreal, Canada', bbox: [45.35, 45.70, -73.85, -73.30] },
  { name: '캐나다', en: 'Canada', bbox: [42.0, 70.0, -141.0, -52.0] },

  // 멕시코
  { name: '멕시코 멕시코시티', en: 'Mexico City, Mexico', bbox: [19.25, 19.60, -99.30, -98.95] },
  { name: '멕시코 칸쿤', en: 'Cancun, Mexico', bbox: [21.00, 21.35, -87.10, -86.70] },
  { name: '멕시코', en: 'Mexico', bbox: [14.5, 32.7, -118.4, -86.7] },

  // ─── 중남미 ───────────────────────────────────────────────────
  { name: '쿠바', en: 'Cuba', bbox: [19.8, 23.3, -85.0, -74.1] },
  { name: '도미니카', en: 'Dominican Republic', bbox: [17.6, 19.9, -72.0, -68.3] },
  { name: '코스타리카', en: 'Costa Rica', bbox: [8.0, 11.2, -85.9, -82.5] },
  { name: '파나마', en: 'Panama', bbox: [7.2, 9.7, -83.0, -77.2] },
  { name: '브라질 상파울루', en: 'Sao Paulo, Brazil', bbox: [-23.85, -23.30, -46.85, -46.40] },
  { name: '브라질 리우데자네이루', en: 'Rio de Janeiro, Brazil', bbox: [-23.10, -22.75, -43.85, -43.10] },
  { name: '브라질', en: 'Brazil', bbox: [-33.8, 5.3, -73.9, -34.7] },
  { name: '아르헨티나 부에노스아이레스', en: 'Buenos Aires, Argentina', bbox: [-34.80, -34.45, -58.55, -58.20] },
  { name: '아르헨티나', en: 'Argentina', bbox: [-55.0, -21.8, -73.5, -53.6] },
  { name: '칠레 산티아고', en: 'Santiago, Chile', bbox: [-33.65, -33.30, -70.85, -70.45] },
  { name: '칠레', en: 'Chile', bbox: [-55.9, -17.5, -75.7, -66.4] },
  { name: '페루 리마', en: 'Lima, Peru', bbox: [-12.20, -11.85, -77.20, -76.85] },
  { name: '페루', en: 'Peru', bbox: [-18.4, -0.04, -81.4, -68.7] },
  { name: '콜롬비아', en: 'Colombia', bbox: [-4.2, 12.6, -79.0, -66.8] },
  { name: '베네수엘라', en: 'Venezuela', bbox: [0.6, 12.2, -73.4, -59.8] },
  { name: '에콰도르', en: 'Ecuador', bbox: [-5.0, 1.4, -81.0, -75.2] },
  { name: '볼리비아', en: 'Bolivia', bbox: [-22.9, -9.7, -69.6, -57.5] },
  { name: '우루과이', en: 'Uruguay', bbox: [-35.0, -30.1, -58.5, -53.1] },
  // build 291: 중미
  { name: '과테말라', en: 'Guatemala', bbox: [13.72, 17.83, -92.25, -88.2] },
  { name: '벨리즈', en: 'Belize', bbox: [15.88, 18.5, -89.25, -87.4] },
  // 온두라스/니카라과 bbox 는 서로 겹침 — 온두라스 중심점이 니카라과 bbox 안이라 니카라과 lngMax 를
  // 바다 쪽(-82.5)으로 넓혀 온두라스가 근소하게 좁도록 유지 (중심점 자기매칭 보장).
  { name: '온두라스', en: 'Honduras', bbox: [12.98, 16.5, -89.36, -83.13] },
  { name: '엘살바도르', en: 'El Salvador', bbox: [13.15, 14.45, -90.13, -87.68] },
  { name: '니카라과', en: 'Nicaragua', bbox: [10.7, 15.05, -87.7, -82.5] },
  // build 291: 카리브
  { name: '아이티', en: 'Haiti', bbox: [17.97, 20.13, -74.5, -71.6] },
  { name: '자메이카', en: 'Jamaica', bbox: [17.65, 18.6, -78.45, -76.15] },
  { name: '바하마', en: 'Bahamas', bbox: [20.9, 27.3, -79.6, -72.7] },
  { name: '푸에르토리코', en: 'Puerto Rico', bbox: [17.9, 18.55, -67.3, -65.2] },
  { name: '트리니다드 토바고', en: 'Trinidad and Tobago', bbox: [10.03, 11.4, -61.95, -60.45] }, // 베네수엘라 위
  { name: '바베이도스', en: 'Barbados', bbox: [13.0, 13.35, -59.7, -59.4] },
  { name: '세인트루시아', en: 'Saint Lucia', bbox: [13.7, 14.12, -61.09, -60.85] },
  { name: '세인트빈센트 그레나딘', en: 'Saint Vincent and the Grenadines', bbox: [12.5, 13.4, -61.48, -61.1] },
  { name: '그레나다', en: 'Grenada', bbox: [11.95, 12.55, -61.85, -61.35] },
  { name: '도미니카 연방', en: 'Dominica', bbox: [15.2, 15.65, -61.52, -61.23] }, // 기존 '도미니카'(공화국)와 별개
  { name: '앤티가 바부다', en: 'Antigua and Barbuda', bbox: [16.98, 17.75, -62.0, -61.65] },
  { name: '세인트키츠 네비스', en: 'Saint Kitts and Nevis', bbox: [17.09, 17.42, -62.88, -62.52] },
  // build 291: 남미 잔여
  { name: '가이아나', en: 'Guyana', bbox: [1.18, 8.56, -61.4, -56.48] },
  { name: '수리남', en: 'Suriname', bbox: [1.83, 6.0, -58.07, -53.98] },
  { name: '프랑스령 기아나', en: 'French Guiana', bbox: [2.11, 5.76, -54.6, -51.62] },
  { name: '파라과이', en: 'Paraguay', bbox: [-27.6, -19.29, -62.65, -54.24] },

  // ─── 유럽 ─────────────────────────────────────────────────────
  // 영국 / 아일랜드 — 독립 섬, 인접 흡수 걱정 없음
  { name: '영국 런던', en: 'London, UK', bbox: [51.30, 51.70, -0.55, 0.25] },
  { name: '영국', en: 'UK', bbox: [49.5, 60.5, -8.5, 2.0] },
  { name: '아일랜드 더블린', en: 'Dublin, Ireland', bbox: [53.20, 53.50, -6.45, -6.05] },
  { name: '아일랜드', en: 'Ireland', bbox: [51.4, 55.4, -10.5, -6.0] },

  // tiny 국가 — 큰 이웃에 흡수되지 않게 맨 앞
  { name: '모나코', en: 'Monaco', bbox: [43.71, 43.78, 7.40, 7.45] },              // 프랑스 위
  { name: '안도라', en: 'Andorra', bbox: [42.4, 42.7, 1.4, 1.8] },                  // 스페인/프랑스 위
  { name: '룩셈부르크', en: 'Luxembourg', bbox: [49.4, 50.2, 5.7, 6.5] },              // 프랑스/독일 위
  { name: '리히텐슈타인', en: 'Liechtenstein', bbox: [47.0, 47.3, 9.4, 9.7] },             // 스위스/오스트리아 위
  { name: '몰타', en: 'Malta', bbox: [35.8, 36.1, 14.2, 14.6] },                  // 이탈리아 위

  // 작은 국가 — 큰 이웃 (프랑스/독일/이탈리아) 위에 배치
  { name: '네덜란드 암스테르담', en: 'Amsterdam, Netherlands', bbox: [52.25, 52.50, 4.70, 5.05] },
  { name: '네덜란드', en: 'Netherlands', bbox: [50.7, 53.6, 3.3, 7.2] },
  { name: '벨기에 브뤼셀', en: 'Brussels, Belgium', bbox: [50.75, 50.95, 4.25, 4.50] },
  { name: '벨기에', en: 'Belgium', bbox: [49.5, 51.5, 2.5, 6.4] },
  // 스위스 — 작은 국가지만 관광/러닝 명소 다수. 좁은 도시 먼저, 국가 fallback 마지막.
  // build 289: 사용자 hans 2026-06 루체른 호수에서 달림 (좌표 47.10/8.27) → '스위스' 만 떴음. 도시 확장.
  { name: '스위스 취리히', en: 'Zurich, Switzerland', bbox: [47.30, 47.45, 8.40, 8.65] },
  { name: '스위스 제네바', en: 'Geneva, Switzerland', bbox: [46.15, 46.25, 6.05, 6.20] },
  { name: '스위스 베른', en: 'Bern, Switzerland', bbox: [46.90, 47.00, 7.38, 7.52] },
  { name: '스위스 바젤', en: 'Basel, Switzerland', bbox: [47.52, 47.60, 7.54, 7.66] },
  { name: '스위스 로잔', en: 'Lausanne, Switzerland', bbox: [46.48, 46.56, 6.58, 6.68] },
  { name: '스위스 루체른', en: 'Lucerne, Switzerland', bbox: [47.00, 47.15, 8.20, 8.40] },             // hans 2026-06-25/26 좌표 포함
  { name: '스위스 인터라켄', en: 'Interlaken, Switzerland', bbox: [46.65, 46.72, 7.83, 7.92] },
  { name: '스위스 체르마트', en: 'Zermatt, Switzerland', bbox: [45.98, 46.05, 7.70, 7.80] },
  { name: '스위스 그린델발트', en: 'Grindelwald, Switzerland', bbox: [46.59, 46.66, 7.99, 8.10] },
  { name: '스위스 장크트모리츠', en: 'St. Moritz, Switzerland', bbox: [46.47, 46.53, 9.80, 9.88] },
  { name: '스위스 다보스', en: 'Davos, Switzerland', bbox: [46.77, 46.83, 9.79, 9.89] },
  { name: '스위스 로카르노', en: 'Locarno, Switzerland', bbox: [46.14, 46.20, 8.77, 8.83] },
  { name: '스위스 루가노', en: 'Lugano, Switzerland', bbox: [45.97, 46.04, 8.91, 8.99] },
  { name: '스위스 몽트뢰', en: 'Montreux, Switzerland', bbox: [46.40, 46.47, 6.88, 6.95] },
  { name: '스위스 빈터투어', en: 'Winterthur, Switzerland', bbox: [47.47, 47.54, 8.70, 8.78] },
  { name: '스위스', en: 'Switzerland', bbox: [45.8, 47.8, 5.9, 10.5] },
  { name: '오스트리아 빈', en: 'Vienna, Austria', bbox: [48.10, 48.35, 16.20, 16.55] },
  { name: '오스트리아', en: 'Austria', bbox: [46.4, 49.0, 9.5, 17.2] },
  { name: '슬로베니아', en: 'Slovenia', bbox: [45.4, 46.9, 13.4, 16.6] },             // 이탈리아 위
  { name: '크로아티아', en: 'Croatia', bbox: [42.4, 46.5, 13.5, 19.4] },             // 이탈리아/세르비아 위
  // 크로아티아 초승달 국토 — 본체 bbox 중심이 실제 보스니아 영토라 달마티아 해안이 보스니아 bbox(더 좁음)에 덮임.
  // 해안 주요 도시를 도시 bbox 로 구제 (내륙 달마티아 경계 지대는 KNOWN 한계).
  { name: '크로아티아 스플리트', en: 'Split, Croatia', bbox: [43.45, 43.58, 16.35, 16.55] },
  { name: '크로아티아 자다르', en: 'Zadar, Croatia', bbox: [44.05, 44.18, 15.18, 15.32] },
  { name: '크로아티아 두브로브니크', en: 'Dubrovnik, Croatia', bbox: [42.60, 42.70, 18.00, 18.15] },

  // 큰 국가 (인접 작은 국가 이미 정의됨)
  { name: '프랑스 파리', en: 'Paris, France', bbox: [48.75, 48.95, 2.20, 2.50] },
  { name: '프랑스 니스', en: 'Nice, France', bbox: [43.65, 43.78, 7.20, 7.35] },
  { name: '프랑스', en: 'France', bbox: [41.5, 51.5, -5.0, 9.5] },
  { name: '독일 베를린', en: 'Berlin, Germany', bbox: [52.30, 52.70, 13.05, 13.75] },
  { name: '독일 뮌헨', en: 'Munich, Germany', bbox: [48.05, 48.25, 11.40, 11.75] },
  { name: '독일 프랑크푸르트', en: 'Frankfurt, Germany', bbox: [50.05, 50.20, 8.55, 8.75] },
  { name: '독일', en: 'Germany', bbox: [47.0, 55.5, 5.5, 15.5] },
  { name: '이탈리아 로마', en: 'Rome, Italy', bbox: [41.70, 42.10, 12.30, 12.65] },
  { name: '이탈리아 밀라노', en: 'Milan, Italy', bbox: [45.35, 45.60, 9.00, 9.30] },
  { name: '이탈리아 베네치아', en: 'Venice, Italy', bbox: [45.35, 45.55, 12.25, 12.45] },
  { name: '이탈리아 피렌체', en: 'Florence, Italy', bbox: [43.70, 43.85, 11.15, 11.35] },
  { name: '이탈리아', en: 'Italy', bbox: [35.0, 47.5, 6.5, 19.0] },

  // 포르투갈 → 스페인 (build 287, 포르토 흡수 회귀 fix)
  { name: '포르투갈 포르토', en: 'Porto, Portugal', bbox: [41.05, 41.40, -8.80, -8.40] },
  { name: '포르투갈 리스본', en: 'Lisbon, Portugal', bbox: [38.60, 38.90, -9.35, -9.05] },
  { name: '포르투갈 신트라', en: 'Sintra, Portugal', bbox: [38.76, 38.84, -9.45, -9.32] },
  { name: '포르투갈 카스카이스', en: 'Cascais, Portugal', bbox: [38.66, 38.74, -9.50, -9.37] },
  { name: '포르투갈 코임브라', en: 'Coimbra, Portugal', bbox: [40.17, 40.26, -8.50, -8.37] },
  { name: '포르투갈 파로', en: 'Faro, Portugal', bbox: [36.98, 37.07, -8.00, -7.85] },           // 알가르브 동
  { name: '포르투갈 라구스', en: 'Lagos, Portugal', bbox: [37.07, 37.15, -8.73, -8.60] },         // 알가르브 서
  { name: '포르투갈 마데이라', en: 'Madeira, Portugal', bbox: [32.40, 32.90, -17.30, -16.30] },     // 본토 bbox 밖 — 별도
  { name: '포르투갈 아조레스', en: 'Azores, Portugal', bbox: [36.90, 39.80, -31.30, -25.00] },     // 군도 전체
  { name: '포르투갈', en: 'Portugal', bbox: [36.95, 42.20, -9.55, -6.20] },
  { name: '스페인 마드리드', en: 'Madrid, Spain', bbox: [40.30, 40.55, -3.90, -3.55] },
  { name: '스페인 바르셀로나', en: 'Barcelona, Spain', bbox: [41.25, 41.55, 2.05, 2.35] },
  // build 289: hans 2026-06-24 산티아고 콤포스텔라 (카미노 종점) → '스페인' 만 떴음. 도시 확장.
  { name: '스페인 산티아고데콤포스텔라', en: 'Santiago de Compostela, Spain', bbox: [42.84, 42.92, -8.62, -8.48] },
  { name: '스페인 세비야', en: 'Seville, Spain', bbox: [37.34, 37.45, -6.04, -5.93] },
  { name: '스페인 발렌시아', en: 'Valencia, Spain', bbox: [39.42, 39.52, -0.45, -0.30] },
  { name: '스페인 말라가', en: 'Malaga, Spain', bbox: [36.66, 36.77, -4.50, -4.36] },
  { name: '스페인 그라나다', en: 'Granada, Spain', bbox: [37.13, 37.22, -3.65, -3.55] },
  { name: '스페인 빌바오', en: 'Bilbao, Spain', bbox: [43.22, 43.31, -3.02, -2.87] },
  { name: '스페인 산세바스티안', en: 'San Sebastian, Spain', bbox: [43.28, 43.36, -2.05, -1.94] },
  { name: '스페인 사라고사', en: 'Zaragoza, Spain', bbox: [41.60, 41.70, -0.96, -0.80] },
  { name: '스페인 톨레도', en: 'Toledo, Spain', bbox: [39.82, 39.92, -4.10, -3.95] },
  { name: '스페인 팜플로나', en: 'Pamplona, Spain', bbox: [42.78, 42.85, -1.68, -1.58] },
  { name: '스페인 마요르카', en: 'Mallorca, Spain', bbox: [39.20, 39.95, 2.30, 3.55] },           // 섬 전체
  { name: '스페인 이비자', en: 'Ibiza, Spain', bbox: [38.85, 39.10, 1.20, 1.60] },
  { name: '스페인 테네리페', en: 'Tenerife, Spain', bbox: [27.95, 28.60, -16.95, -16.10] },        // 카나리아 — 본토 bbox 밖
  { name: '스페인 그란카나리아', en: 'Gran Canaria, Spain', bbox: [27.72, 28.20, -15.85, -15.36] },
  { name: '스페인', en: 'Spain', bbox: [35.5, 44.0, -10.0, 4.5] },

  // 그리스, 동유럽
  { name: '그리스 아테네', en: 'Athens, Greece', bbox: [37.85, 38.10, 23.55, 23.95] },
  { name: '그리스', en: 'Greece', bbox: [34.8, 41.5, 19.4, 28.3] },
  { name: '체코 프라하', en: 'Prague, Czech Republic', bbox: [49.95, 50.20, 14.20, 14.65] },
  { name: '체코', en: 'Czech Republic', bbox: [48.5, 51.1, 12.1, 18.9] },
  { name: '폴란드 바르샤바', en: 'Warsaw, Poland', bbox: [52.10, 52.35, 20.85, 21.20] },
  { name: '폴란드', en: 'Poland', bbox: [49.0, 54.9, 14.1, 24.2] },
  { name: '헝가리 부다페스트', en: 'Budapest, Hungary', bbox: [47.35, 47.65, 18.85, 19.30] },
  { name: '헝가리', en: 'Hungary', bbox: [45.7, 48.6, 16.1, 22.9] },
  { name: '슬로바키아', en: 'Slovakia', bbox: [47.7, 49.6, 16.8, 22.6] },
  { name: '루마니아', en: 'Romania', bbox: [43.6, 48.3, 20.3, 29.7] },
  { name: '불가리아', en: 'Bulgaria', bbox: [41.2, 44.2, 22.4, 28.6] },
  { name: '세르비아', en: 'Serbia', bbox: [42.2, 46.2, 18.8, 23.0] },

  // 북유럽
  { name: '스웨덴 스톡홀름', en: 'Stockholm, Sweden', bbox: [59.20, 59.50, 17.85, 18.30] },
  { name: '스웨덴', en: 'Sweden', bbox: [55.3, 69.1, 11.0, 24.2] },
  { name: '노르웨이 오슬로', en: 'Oslo, Norway', bbox: [59.80, 60.05, 10.55, 11.00] },
  { name: '노르웨이', en: 'Norway', bbox: [57.9, 71.2, 4.5, 31.2] },
  { name: '덴마크 코펜하겐', en: 'Copenhagen, Denmark', bbox: [55.55, 55.80, 12.40, 12.75] },
  { name: '덴마크', en: 'Denmark', bbox: [54.5, 57.8, 8.0, 15.2] },
  { name: '핀란드 헬싱키', en: 'Helsinki, Finland', bbox: [60.05, 60.30, 24.75, 25.15] },
  { name: '핀란드', en: 'Finland', bbox: [59.7, 70.1, 20.5, 31.6] },
  { name: '아이슬란드 레이캬비크', en: 'Reykjavik, Iceland', bbox: [64.00, 64.25, -22.20, -21.65] },
  { name: '아이슬란드', en: 'Iceland', bbox: [63.3, 66.6, -24.5, -13.5] },

  // 러시아 / 우크라이나
  { name: '러시아 모스크바', en: 'Moscow, Russia', bbox: [55.40, 56.05, 37.20, 37.95] },
  { name: '러시아 상트페테르부르크', en: 'Saint Petersburg, Russia', bbox: [59.75, 60.10, 30.10, 30.55] },
  { name: '러시아', en: 'Russia', bbox: [41.2, 81.9, 19.6, 180.0] },
  { name: '우크라이나', en: 'Ukraine', bbox: [44.0, 52.5, 22.0, 40.3] },

  // build 291: 발트 3국 / 동유럽 잔여
  { name: '에스토니아', en: 'Estonia', bbox: [57.5, 59.7, 21.6, 28.2] },
  { name: '라트비아', en: 'Latvia', bbox: [55.65, 58.1, 20.95, 28.25] },
  { name: '리투아니아', en: 'Lithuania', bbox: [53.9, 56.45, 20.9, 26.85] },
  { name: '벨라루스', en: 'Belarus', bbox: [51.26, 56.17, 23.18, 32.77] },
  { name: '몰도바', en: 'Moldova', bbox: [45.47, 48.49, 26.62, 30.16] },        // 루마니아/우크라이나 위

  // build 291: 발칸 잔여
  { name: '보스니아 헤르체고비나', en: 'Bosnia and Herzegovina', bbox: [42.56, 45.28, 15.72, 19.62] },
  { name: '몬테네그로', en: 'Montenegro', bbox: [41.85, 43.56, 18.43, 20.35] },
  { name: '알바니아', en: 'Albania', bbox: [39.64, 42.66, 19.27, 21.06] },
  { name: '북마케도니아', en: 'North Macedonia', bbox: [40.85, 42.37, 20.45, 23.05] },
  // 코소보 — latMin 42.08 / lngMax 21.6: 스코페(42.0, 21.43)·쿠마노보(42.13, 21.71) 흡수 방지
  { name: '코소보', en: 'Kosovo', bbox: [42.08, 43.27, 19.98, 21.6] },

  // build 291: 초소형국 잔여
  { name: '산마리노', en: 'San Marino', bbox: [43.89, 43.99, 12.40, 12.52] },   // 이탈리아 위
  { name: '바티칸', en: 'Vatican City', bbox: [41.899, 41.907, 12.443, 12.459] }, // 로마 bbox 중심(41.90, 12.475) 제외 유지

  // build 291: 그린란드 (덴마크령) — 남/북 2분할. 남쪽 lngMin -55: 캐나다 래브라도(-55.7~) 침범 방지,
  // 북쪽은 캐나다 bbox latMax(70) 위라 겹침 없음.
  { name: '그린란드', en: 'Greenland', bbox: [59.7, 70.0, -55.0, -11.0] },
  { name: '그린란드', en: 'Greenland', bbox: [70.0, 83.7, -73.5, -11.0] },

  // ─── 오세아니아 ───────────────────────────────────────────────
  { name: '호주 시드니', en: 'Sydney, Australia', bbox: [-34.20, -33.55, 150.50, 151.40] },
  { name: '호주 멜버른', en: 'Melbourne, Australia', bbox: [-38.10, -37.55, 144.50, 145.40] },
  { name: '호주 브리즈번', en: 'Brisbane, Australia', bbox: [-27.65, -27.30, 152.85, 153.20] },
  { name: '호주 퍼스', en: 'Perth, Australia', bbox: [-32.20, -31.70, 115.65, 116.10] },
  { name: '호주', en: 'Australia', bbox: [-44.0, -10.0, 112.0, 154.0] },
  { name: '뉴질랜드 오클랜드', en: 'Auckland, New Zealand', bbox: [-37.10, -36.65, 174.45, 175.05] },
  { name: '뉴질랜드 웰링턴', en: 'Wellington, New Zealand', bbox: [-41.45, -41.10, 174.55, 175.05] },
  { name: '뉴질랜드', en: 'New Zealand', bbox: [-47.5, -34.0, 166.0, 179.0] },
  { name: '피지', en: 'Fiji', bbox: [-19.5, -16.0, 177.0, 180.0] },
  // build 291: 피지 동쪽 절반 (경도 180° 너머 — inBox 단순 비교라 서/동 분할)
  { name: '피지', en: 'Fiji', bbox: [-21.05, -15.5, -180.0, -178.2] },
  { name: '파푸아뉴기니', en: 'Papua New Guinea', bbox: [-11.7, -1.0, 140.85, 156.0] },
  { name: '솔로몬 제도', en: 'Solomon Islands', bbox: [-11.9, -6.55, 155.4, 162.85] },
  { name: '바누아투', en: 'Vanuatu', bbox: [-20.3, -13.0, 166.5, 170.3] },
  { name: '누벨칼레도니', en: 'New Caledonia', bbox: [-22.8, -19.5, 163.8, 168.2] }, // 프랑스령
  { name: '사모아', en: 'Samoa', bbox: [-14.08, -13.42, -172.82, -171.38] },
  { name: '통가', en: 'Tonga', bbox: [-21.5, -18.5, -175.7, -173.7] },
  { name: '투발루', en: 'Tuvalu', bbox: [-9.5, -5.6, 176.0, 179.9] },
  // 키리바시 — 길버트 제도(서) + 라인 제도(동, 크리스마스섬) 분할. 180° 양쪽에 걸침.
  { name: '키리바시', en: 'Kiribati', bbox: [-2.9, 3.5, 172.5, 177.2] },
  { name: '키리바시', en: 'Kiribati', bbox: [1.6, 2.1, -157.6, -157.1] },
  { name: '나우루', en: 'Nauru', bbox: [-0.6, -0.45, 166.85, 167.0] },
  { name: '마셜 제도', en: 'Marshall Islands', bbox: [4.5, 12.0, 165.2, 172.2] },
  { name: '미크로네시아', en: 'Micronesia', bbox: [5.2, 9.7, 137.9, 163.1] },
  { name: '팔라우', en: 'Palau', bbox: [6.8, 8.2, 134.1, 134.7] },
  { name: '괌', en: 'Guam', bbox: [13.2, 13.72, 144.6, 145.05] },               // 미국령
  { name: '사이판', en: 'Saipan', bbox: [15.05, 15.35, 145.6, 145.9] },          // 북마리아나 (미국령)
  { name: '프랑스령 폴리네시아', en: 'French Polynesia', bbox: [-18.6, -14.0, -152.5, -147.0] }, // 타히티 일대

  // ─── 아프리카 ─────────────────────────────────────────────────
  { name: '남아프리카 케이프타운', en: 'Cape Town, South Africa', bbox: [-34.20, -33.65, 18.20, 18.70] },
  { name: '남아프리카 요하네스버그', en: 'Johannesburg, South Africa', bbox: [-26.45, -25.85, 27.85, 28.30] },
  { name: '남아프리카', en: 'South Africa', bbox: [-34.9, -22.1, 16.5, 32.9] },
  { name: '이집트 카이로', en: 'Cairo, Egypt', bbox: [29.85, 30.25, 31.05, 31.50] },
  { name: '이집트', en: 'Egypt', bbox: [22.0, 31.7, 24.7, 36.9] },
  { name: '모로코 카사블랑카', en: 'Casablanca, Morocco', bbox: [33.40, 33.75, -7.85, -7.40] },
  { name: '모로코 마라케시', en: 'Marrakesh, Morocco', bbox: [31.50, 31.75, -8.15, -7.85] },
  { name: '모로코', en: 'Morocco', bbox: [21.3, 35.9, -17.1, -1.0] },
  { name: '튀니지', en: 'Tunisia', bbox: [30.2, 37.5, 7.5, 11.6] },
  { name: '케냐 나이로비', en: 'Nairobi, Kenya', bbox: [-1.45, -1.10, 36.65, 37.05] },
  { name: '케냐', en: 'Kenya', bbox: [-4.7, 5.0, 33.9, 41.9] },
  { name: '탄자니아', en: 'Tanzania', bbox: [-11.7, -1.0, 29.3, 40.4] },
  { name: '에티오피아', en: 'Ethiopia', bbox: [3.4, 14.9, 33.0, 48.0] },
  { name: '나이지리아', en: 'Nigeria', bbox: [4.3, 13.9, 2.7, 14.7] },
  { name: '가나', en: 'Ghana', bbox: [4.7, 11.2, -3.3, 1.2] },
  { name: '마다가스카르', en: 'Madagascar', bbox: [-25.6, -11.9, 43.2, 50.5] },
  { name: '모리셔스', en: 'Mauritius', bbox: [-20.6, -20.0, 57.3, 57.8] },

  // build 291: 아프리카 잔여 국가 전부 — 북아프리카/사헬/서아프리카/중부/동부/남부/도서
  { name: '알제리', en: 'Algeria', bbox: [18.9, 37.1, -8.7, 12.0] },
  { name: '리비아', en: 'Libya', bbox: [19.5, 33.2, 9.3, 25.2] },
  { name: '수단', en: 'Sudan', bbox: [8.7, 22.2, 21.8, 38.6] },
  { name: '남수단', en: 'South Sudan', bbox: [3.49, 12.24, 24.14, 35.94] },
  { name: '모리타니', en: 'Mauritania', bbox: [14.72, 27.3, -17.07, -4.8] },
  { name: '말리', en: 'Mali', bbox: [10.15, 25.0, -12.25, 4.27] },
  { name: '니제르', en: 'Niger', bbox: [11.7, 23.52, 0.17, 16.0] },
  { name: '차드', en: 'Chad', bbox: [7.44, 23.45, 13.47, 24.0] },
  { name: '세네갈', en: 'Senegal', bbox: [12.3, 16.7, -17.55, -11.35] },
  { name: '감비아', en: 'Gambia', bbox: [13.06, 13.83, -16.83, -13.79] },      // 세네갈 위 (더 좁음)
  { name: '기니비사우', en: 'Guinea-Bissau', bbox: [10.92, 12.69, -16.72, -13.64] },
  { name: '기니', en: 'Guinea', bbox: [7.19, 12.68, -15.08, -7.64] },
  // 시에라리온 latMax 9.9 — 실제 북단 10.0 이지만 기니 bbox 중심점(9.94) 충돌 회피
  { name: '시에라리온', en: 'Sierra Leone', bbox: [6.9, 9.9, -13.3, -10.27] },
  { name: '라이베리아', en: 'Liberia', bbox: [4.35, 8.55, -11.5, -7.37] },
  { name: '코트디부아르', en: "Cote d'Ivoire", bbox: [4.35, 10.74, -8.6, -2.49] },
  { name: '부르키나파소', en: 'Burkina Faso', bbox: [9.4, 15.09, -5.52, 2.4] },
  { name: '토고', en: 'Togo', bbox: [6.1, 11.14, -0.15, 1.81] },
  // 베냉 — 남(좁음)/북(3.85 까지) 분할: 남부를 2.78 에서 끊어 나이지리아 해안(바다그리~라고스) 침범 방지.
  // 남부 서쪽 경계 1.55: 0.76 이면 토고 남부(로메 등)를 덮어 토고 중심점이 베냉으로 새는 회귀 (셀프테스트 검출).
  { name: '베냉', en: 'Benin', bbox: [6.22, 9.0, 1.55, 2.78] },
  { name: '베냉', en: 'Benin', bbox: [9.0, 12.42, 0.76, 3.85] },
  { name: '나이지리아 라고스', en: 'Lagos, Nigeria', bbox: [6.35, 6.70, 3.10, 3.70] }, // 아프리카 최대 러닝 도시
  // 카메룬 lngMin 8.75 — 나이지리아 bbox 중심점(9.1, 8.7) 충돌 회피 (바카시 반도 일부 나이지리아 표기)
  { name: '카메룬', en: 'Cameroon', bbox: [1.65, 13.1, 8.75, 16.2] },
  { name: '중앙아프리카공화국', en: 'Central African Republic', bbox: [2.2, 11.0, 14.42, 27.46] },
  { name: '가봉', en: 'Gabon', bbox: [-4.0, 2.32, 8.7, 14.53] },
  // 적도 기니 — 본토(리오무니) + 비오코섬(수도 말라보) 분할
  { name: '적도 기니', en: 'Equatorial Guinea', bbox: [0.92, 2.35, 9.3, 11.4] },
  { name: '적도 기니', en: 'Equatorial Guinea', bbox: [3.2, 3.82, 8.4, 9.0] },
  { name: '콩고 공화국', en: 'Republic of the Congo', bbox: [-5.1, 3.7, 11.2, 18.6] },
  // 킨샤사 — 브라자빌 강 건너라 콩고 공화국 bbox 에 삼켜짐 → 도시 엔트리로 구제
  { name: '콩고민주공화국 킨샤사', en: 'Kinshasa, DR Congo', bbox: [-4.5, -4.2, 15.2, 15.6] },
  { name: '콩고민주공화국', en: 'DR Congo', bbox: [-13.5, 5.4, 12.2, 31.3] },
  { name: '우간다', en: 'Uganda', bbox: [-1.5, 4.25, 29.55, 35.0] },
  { name: '르완다', en: 'Rwanda', bbox: [-2.85, -1.05, 28.85, 30.9] },
  { name: '부룬디', en: 'Burundi', bbox: [-4.48, -2.3, 28.98, 30.85] },
  { name: '소말리아', en: 'Somalia', bbox: [-1.68, 11.98, 40.99, 51.42] },
  { name: '지부티', en: 'Djibouti', bbox: [10.9, 12.72, 41.75, 43.42] },
  { name: '에리트레아', en: 'Eritrea', bbox: [12.35, 18.02, 36.42, 43.14] },
  { name: '잠비아', en: 'Zambia', bbox: [-18.08, -8.2, 21.99, 33.7] },
  { name: '짐바브웨', en: 'Zimbabwe', bbox: [-22.42, -15.6, 25.24, 33.07] },
  { name: '말라위', en: 'Malawi', bbox: [-17.13, -9.37, 32.67, 35.92] },
  { name: '모잠비크', en: 'Mozambique', bbox: [-26.87, -10.47, 30.22, 40.84] },
  { name: '보츠와나', en: 'Botswana', bbox: [-26.9, -17.78, 19.99, 29.38] },
  // 나미비아 — 본토 + 카프리비 회랑 분할: 단일 rect 는 남아공 bbox 중심점(-28.5, 24.7)을 삼킴
  { name: '나미비아', en: 'Namibia', bbox: [-28.97, -16.95, 11.72, 21.0] },
  { name: '나미비아', en: 'Namibia', bbox: [-18.55, -17.15, 21.0, 25.3] },
  { name: '앙골라', en: 'Angola', bbox: [-18.05, -4.38, 11.67, 24.08] },
  { name: '레소토', en: 'Lesotho', bbox: [-30.68, -28.57, 27.0, 29.46] },       // 남아공 위 (더 좁음)
  { name: '에스와티니', en: 'Eswatini', bbox: [-27.32, -25.72, 30.79, 32.14] }, // 남아공/모잠비크 위
  { name: '카보베르데', en: 'Cape Verde', bbox: [14.75, 17.3, -25.4, -22.6] },
  { name: '상투메 프린시페', en: 'Sao Tome and Principe', bbox: [-0.05, 1.75, 6.4, 7.5] },
  { name: '코모로', en: 'Comoros', bbox: [-12.42, -11.36, 43.21, 44.55] },
  { name: '세이셸', en: 'Seychelles', bbox: [-4.85, -4.2, 55.2, 55.9] },
];

function inBox(lat: number, lng: number, bbox: [number, number, number, number]): boolean {
  return lat >= bbox[0] && lat <= bbox[1] && lng >= bbox[2] && lng <= bbox[3];
}

// bbox 면적 (위도범위 × 경도범위). 라벨 우선순위 비교용 — 실제 km² 아님.
function bboxArea(bbox: [number, number, number, number]): number {
  return (bbox[1] - bbox[0]) * (bbox[3] - bbox[2]);
}

// build 290: KR 분기 fall-through 를 허용하는 WORLD bbox 최대 면적 (도시 스케일).
const KR_WORLD_OVERRIDE_MAX_AREA = 2;

// build 290: 포인트를 포함하는 모든 bbox 중 면적 최소 엔트리. 동률이면 배열 앞쪽 우선.
function smallestContaining(lat: number, lng: number, regions: CoarseRegion[]): CoarseRegion | null {
  let best: CoarseRegion | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    if (!inBox(lat, lng, r.bbox)) continue;
    const a = bboxArea(r.bbox);
    if (a < bestArea) {
      best = r;
      bestArea = a;
    }
  }
  return best;
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
  locale: 'ko' | 'en' = 'ko',
): string | null {
  // build 290: locale='en' 이면 엔트리의 en 라벨 반환. 기본 'ko' — 기존 호출부 동작 무변경.
  const labelOf = (r: CoarseRegion) => (locale === 'en' ? r.en : r.name);
  if (!firstCoord) {
    // GPS 없으면 profile 정보라도 (profile region 은 한국어 원문뿐 — en 미지원 한계, ko 반환)
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
    // 한국 내부 룩업 — 기존 tier 순서 그대로 (서울 구 → 시·군 → 시·도).
    let kr: CoarseRegion | null = null;
    // 1) 서울 25개 구 (가장 정밀)
    for (const r of KR_SEOUL_GU) {
      if (inBox(lat, lng, r.bbox)) { kr = r; break; }
    }
    // 2) build 218 #1: 비-서울 주요 시·군 (2-tier "경기 양평" 등)
    if (!kr) {
      for (const r of KR_NON_SEOUL_CITY) {
        if (inBox(lat, lng, r.bbox)) { kr = r; break; }
      }
    }
    // 3) 광역시·도 fallback
    if (!kr) {
      for (const r of KR_CITY) {
        if (inBox(lat, lng, r.bbox)) { kr = r; break; }
      }
    }
    // build 290: KR_BBOX 가 일본 후쿠오카·쓰시마 일부를 포함 — KR 분기에 갇히면
    // 후쿠오카 러닝이 "한국"으로 표기되던 버그. WORLD 에서 도시 스케일 매칭
    // (예: '일본 후쿠오카' bbox) 이 있고, 한국 내부 매칭보다 좁으면 그쪽 우선.
    // 도시 스케일 (< 2 deg² ≈ 150km×150km) 로 제한하는 이유: 국가·성(省) 단위 bbox 는
    // KR_BBOX 모서리에 걸치기만 해도 (예: 중국 랴오닝 하단 == KR_BBOX 상단 lat 38.7)
    // 경계선 좌표가 '중국 랴오닝' 등으로 새는 노이즈가 생김. 한국 실좌표는 도시 스케일
    // WORLD bbox 와 겹치지 않으므로 기존 동작에 영향 없음.
    const world = smallestContaining(lat, lng, WORLD);
    if (
      world &&
      bboxArea(world.bbox) < KR_WORLD_OVERRIDE_MAX_AREA &&
      (!kr || bboxArea(world.bbox) < bboxArea(kr.bbox))
    ) {
      return labelOf(world);
    }
    if (kr) return labelOf(kr);
    // 4) 변두리 — profile region 사용 (한국어 원문뿐 — en 미지원 한계)
    if (profile?.region_si || profile?.region_gu) {
      return shortenKR(profile.region_si, profile.region_gu);
    }
    return locale === 'en' ? 'South Korea' : '한국';
  }

  // 해외 — build 290: 포함하는 bbox 중 면적 최소 선택 (도시 > 소국 > 대국 자연 우선)
  const best = smallestContaining(lat, lng, WORLD);
  return best ? labelOf(best) : null; // 알 수 없는 좌표 — 라벨 생략
}

function shortenKR(si?: string | null, gu?: string | null): string | null {
  // "서울특별시" → "서울", "강남구" → "강남"
  const shortSi = si ? si.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/g, '') : '';
  const shortGu = gu ? gu.replace(/(구|군|시)$/g, '') : '';
  const out = [shortSi, shortGu].filter(Boolean).join(' ');
  return out || null;
}
