'use client';

// build 186: 주소 자동완성 검색 sheet — 카카오 로컬 주소 검색 API 사용.
// 타이핑 → debounce 300ms → 상위 10개 추천 카드 → 클릭 시 즉시 채움.
// API key 없으면 fallback 으로 다음 우편번호 sheet 사용 (부모에서 분기).
//
// Kakao REST API key 발급:
// 1. https://developers.kakao.com 로그인
// 2. 내 애플리케이션 → routinist 앱 선택 (없으면 생성)
// 3. 앱 키 → REST API 키 복사
// 4. 플랫폼 설정 → Web → 사이트 도메인 등록 (https://routinist.kr, https://app.routinist.kr)
// 5. .env.local + Vercel env 에 NEXT_PUBLIC_KAKAO_REST_API_KEY 추가

import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X, MapPin, Loader2 } from 'lucide-react';

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY;

export interface AddressResult {
  zonecode: string;
  address: string;
  roadAddress: string;
  jibunAddress: string;
  buildingName: string;
}

interface KakaoAddressDoc {
  address_name: string;
  road_address: null | {
    address_name: string;
    zone_no: string;
    building_name: string;
  };
  address: null | {
    address_name: string;
  };
}

interface Props {
  onClose: () => void;
  onComplete: (r: AddressResult) => void;
}

export default function AddressAutocompleteSheet({ onClose, onComplete }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KakaoAddressDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => inputRef.current?.focus(), 200);
    return () => { document.body.style.overflow = orig; };
  }, []);

  const search = useCallback(async (q: string) => {
    if (!KAKAO_KEY) { setError('주소검색 API 키가 설정되지 않았어요'); return; }
    const trimmed = q.trim();
    if (trimmed.length < 2) { setResults([]); setError(null); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      // 1) 주소 검색 (도로명/지번/우편번호)
      const addr = await fetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(trimmed)}&size=10`,
        { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` }, signal: ctrl.signal },
      );
      if (!addr.ok) throw new Error('검색 실패');
      const addrData = await addr.json();
      let docs: KakaoAddressDoc[] = addrData.documents ?? [];

      // 2) 아파트명/POI 키워드 검색 보강 — 주소 매칭 없으면 키워드로 시도해 도로명주소 추출
      if (docs.length === 0) {
        const kw = await fetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(trimmed)}&size=10&category_group_code=AT4,SC4,PO3`,
          { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` }, signal: ctrl.signal },
        );
        if (kw.ok) {
          const kwData = await kw.json();
          interface KwDoc { road_address_name?: string; address_name?: string; place_name?: string }
          docs = (kwData.documents as KwDoc[] ?? [])
            .filter(d => d.road_address_name || d.address_name)
            .map<KakaoAddressDoc>(d => ({
              address_name: d.address_name ?? '',
              road_address: d.road_address_name
                ? { address_name: d.road_address_name, zone_no: '', building_name: d.place_name ?? '' }
                : null,
              address: d.address_name ? { address_name: d.address_name } : null,
            }));
        }
      }

      setResults(docs);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : '검색 실패');
      setResults([]);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  const handlePick = async (d: KakaoAddressDoc) => {
    const r = d.road_address;
    const a = d.address;
    let zonecode = r?.zone_no ?? '';

    // 키워드 검색에서 온 결과는 zone_no 가 비어있음 — 도로명주소로 한 번 더 조회.
    if (!zonecode && r?.address_name && KAKAO_KEY) {
      try {
        const r2 = await fetch(
          `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(r.address_name)}&size=1`,
          { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } },
        );
        if (r2.ok) {
          const data = await r2.json();
          zonecode = (data.documents?.[0]?.road_address?.zone_no as string | undefined) ?? '';
        }
      } catch { /* 우편번호 못 채우면 빈값으로 진행 */ }
    }

    onComplete({
      zonecode,
      address: r?.address_name ?? a?.address_name ?? '',
      roadAddress: r?.address_name ?? '',
      jibunAddress: a?.address_name ?? '',
      buildingName: r?.building_name ?? '',
    });
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-[var(--background)] w-full max-w-lg h-[90vh] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)] px-4 py-3 flex items-center gap-2">
          <Search size={18} className="text-emerald-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="주소·도로명·아파트명 (예: 개포자이프레지던스)"
            className="flex-1 bg-transparent text-base font-bold focus:outline-none placeholder:font-normal placeholder:text-[var(--muted)] min-w-0"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="입력 지우기"
              className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--card-border)]/40 active:scale-90 flex-shrink-0"
            >
              <X size={14} className="text-[var(--muted)]" />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 flex items-center justify-center active:scale-95 flex-shrink-0"
          >
            <X size={18} className="text-[var(--foreground)]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {!KAKAO_KEY && (
            <div className="p-6 text-center text-sm text-rose-500 font-semibold">
              주소검색 API 키가 설정되지 않았어요.
            </div>
          )}

          {!query.trim() && KAKAO_KEY && (
            <div className="px-5 pt-6 pb-4">
              <p className="text-[11px] font-extrabold text-[var(--muted)] uppercase tracking-wide mb-3">검색 팁</p>
              <ul className="space-y-2.5 text-sm text-[var(--foreground)]">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>도로명: <span className="text-emerald-600 font-bold">강남대로 123</span></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>지번: <span className="text-emerald-600 font-bold">개포동 1149</span></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>아파트명: <span className="text-emerald-600 font-bold">개포자이프레지던스</span></span>
                </li>
              </ul>
            </div>
          )}

          {loading && (
            <div className="p-6 flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
              <Loader2 size={16} className="animate-spin text-emerald-500" />
              검색 중…
            </div>
          )}

          {!loading && error && (
            <div className="p-6 text-center text-sm text-rose-500 font-semibold">{error}</div>
          )}

          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-sm text-[var(--foreground)] font-semibold mb-1">검색 결과가 없어요</p>
              <p className="text-xs text-[var(--muted)]">다른 키워드(도로명·지번·아파트명)로 시도해 보세요</p>
            </div>
          )}

          {results.length > 0 && (
            <ul className="divide-y divide-[var(--card-border)]/40">
              {results.map((d, i) => {
                const r = d.road_address;
                const a = d.address;
                const primary = r?.address_name ?? a?.address_name ?? '주소 없음';
                return (
                  <li key={i}>
                    <button
                      onClick={() => handlePick(d)}
                      className="w-full text-left px-4 py-3.5 active:bg-emerald-50 dark:active:bg-emerald-950/30 transition flex items-start gap-3"
                    >
                      <MapPin size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[var(--foreground)] truncate">
                          {primary}
                          {r?.building_name && (
                            <span className="ml-1.5 text-emerald-600">({r.building_name})</span>
                          )}
                        </p>
                        {r?.address_name && a?.address_name && r.address_name !== a.address_name && (
                          <p className="text-[11px] text-[var(--muted)] truncate mt-0.5">
                            지번: {a.address_name}
                          </p>
                        )}
                        {r?.zone_no && (
                          <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                            {r.zone_no}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
