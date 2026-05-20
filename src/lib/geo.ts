// 현재 위치 → 시/구 자동 선택용 역지오코딩 유틸.
// Kakao 로컬 API 가 발급 KEY 필요 + CORS 가 native 에서만 문제없음.
// 무료/키없음 대안으로 OpenStreetMap Nominatim 사용 (공공 Rate limit: 1 req/sec).

import { KR_SIDO_LIST, KR_REGIONS } from './regions';

export interface DetectedRegion {
  country_code: string;   // 'KR', 'US' 등 (ISO 3166-1 alpha-2)
  si: string | null;      // 한국: 시도명 ("서울특별시")
  gu: string | null;      // 한국: 구/군명 ("강남구")
  display: string;        // 사람 읽기용 한 줄 ("서울특별시 강남구")
}

async function getCoords(): Promise<{ lat: number; lng: number }> {
  // Capacitor WKWebView 도 navigator.geolocation 을 지원. 별도 플러그인 없어도 동작.
  // 단 iOS 는 Info.plist 에 NSLocationWhenInUseUsageDescription 필수.
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation 을 지원하지 않는 환경입니다.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error('위치 권한이 거부되었습니다: ' + err.message)),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60_000 }
    );
  });
}

interface NominatimResponse {
  address?: {
    country_code?: string;
    state?: string;
    province?: string;
    city?: string;
    county?: string;
    borough?: string;
    suburb?: string;
    city_district?: string;
  };
}

// 한국 Nominatim 응답 → 우리 시도 리스트에 매핑 ("Seoul" → "서울특별시")
function mapNominatimToKorSido(state: string | undefined): string | null {
  if (!state) return null;
  // 이미 한글이면 그대로 매칭
  const hit = KR_SIDO_LIST.find(s => state.includes(s));
  if (hit) return hit;
  // 영문 → 한글 fallback (간단 매핑)
  const en: Record<string, string> = {
    Seoul: '서울특별시',
    Busan: '부산광역시',
    Daegu: '대구광역시',
    Incheon: '인천광역시',
    Gwangju: '광주광역시',
    Daejeon: '대전광역시',
    Ulsan: '울산광역시',
    Sejong: '세종특별자치시',
    Gyeonggi: '경기도',
    Gangwon: '강원특별자치도',
    Chungcheongbuk: '충청북도',
    Chungcheongnam: '충청남도',
    Jeollabuk: '전북특별자치도',
    Jeollanam: '전라남도',
    Gyeongsangbuk: '경상북도',
    Gyeongsangnam: '경상남도',
    Jeju: '제주특별자치도',
  };
  for (const [k, v] of Object.entries(en)) {
    if (state.includes(k)) return v;
  }
  return null;
}

function mapNominatimToKorGu(si: string, raw: string | undefined): string | null {
  if (!si || !raw) return null;
  const candidates = KR_REGIONS[si] ?? [];
  const hit = candidates.find(g => raw.includes(g));
  return hit ?? null;
}

export async function detectRegion(): Promise<DetectedRegion> {
  const { lat, lng } = await getCoords();
  return detectRegionFromCoord(lat, lng);
}

/**
 * 임의 lat/lng 좌표로 역지오코딩 (build 155).
 * - activity 의 첫 GPS 좌표로 profile 자동 등록
 * - admin 백필 일괄 처리
 * Nominatim 공공 rate limit 1req/sec — 일괄 처리 시 호출자가 throttle 책임.
 */
export async function detectRegionFromCoord(lat: number, lng: number): Promise<DetectedRegion> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ko&zoom=12`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) throw new Error('역지오코딩 실패');
  const data = (await resp.json()) as NominatimResponse;

  const country = (data.address?.country_code || 'kr').toUpperCase();

  if (country === 'KR') {
    const state = data.address?.state || data.address?.province;
    const si = mapNominatimToKorSido(state);
    const rawGu =
      data.address?.city_district ||
      data.address?.borough ||
      data.address?.county ||
      data.address?.suburb ||
      data.address?.city;
    const gu = si ? mapNominatimToKorGu(si, rawGu) : null;
    return {
      country_code: 'KR',
      si,
      gu,
      display: [si, gu].filter(Boolean).join(' ') || '한국',
    };
  }

  // 해외: 구체 행정구역은 현재 랭킹에서 사용하지 않음, 국가 코드만 돌려줌
  return {
    country_code: country,
    si: data.address?.state ?? null,
    gu: data.address?.city ?? null,
    display: [data.address?.state, data.address?.city].filter(Boolean).join(' ') || country,
  };
}
