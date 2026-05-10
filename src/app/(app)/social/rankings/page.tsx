'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchRegionalRankings } from '@/lib/social-data';
import { ArrowLeft, Trophy, MapPin, Globe, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { RegionalRanking } from '@/types';
import AppLogo from '@/components/AppLogo';
import { COUNTRIES as ALL_COUNTRIES, KR_REGIONS } from '@/lib/regions';

// 랭킹 페이지에서 보여줄 국가 목록 — 전체 국가 목록 사용 (다국가 사용자 대응)
const COUNTRIES = ALL_COUNTRIES.map(c => ({ code: c.code, name: c.native }));

// 한국 시도 → 구/군 — 통합 데이터 (regions.ts 의 KR_REGIONS) 사용
const KR_PROVINCES = KR_REGIONS;

type RankLevel = 'country' | 'province' | 'district';

export default function RankingsPage() {
  const { profile } = useAuth();
  const [rankings, setRankings] = useState<RegionalRanking[]>([]);
  const [year] = useState(new Date().getFullYear());
  const [month] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);

  // 3단 선택 상태
  const [selectedCountry, setSelectedCountry] = useState('KR');
  const [selectedProvince, setSelectedProvince] = useState(profile?.region_si || '서울특별시');
  const [selectedDistrict, setSelectedDistrict] = useState(profile?.region_gu || '강남구');
  const [rankLevel, setRankLevel] = useState<RankLevel>('district');

  const provinces = selectedCountry === 'KR' ? Object.keys(KR_PROVINCES) : [];
  const districts = selectedCountry === 'KR' && selectedProvince ? (KR_PROVINCES[selectedProvince] || []) : [];

  // 지역 변경 시 하위 선택 초기화
  const handleCountryChange = (code: string) => {
    setSelectedCountry(code);
    if (code !== 'KR') {
      setSelectedProvince('');
      setSelectedDistrict('');
      setRankLevel('country');
    } else {
      setSelectedProvince(provinces[0] || '서울특별시');
      setRankLevel('district');
    }
  };

  const handleProvinceChange = (province: string) => {
    setSelectedProvince(province);
    const dists = KR_PROVINCES[province] || [];
    setSelectedDistrict(dists[0] || '');
    setRankLevel('district');
  };

  // 실제 랭킹은 현재 구 단위 API만 있으므로 구 선택 시 로드
  const loadRankings = useCallback(async () => {
    if (!selectedDistrict && rankLevel === 'district') return;
    setLoading(true);
    try {
      const region = rankLevel === 'district' ? selectedDistrict : selectedProvince;
      const data = await fetchRegionalRankings(region, year, month);
      setRankings(data);
    } catch {} finally { setLoading(false); }
  }, [selectedDistrict, selectedProvince, rankLevel, year, month]);

  useEffect(() => { loadRankings(); }, [loadRankings]);

  const medalEmoji = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/social" className="text-[var(--muted)]"><ArrowLeft size={24} /></Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">지역 랭킹</h1>
      </div>

      <p className="text-xs text-[var(--muted)] text-center">{year}년 {month}월</p>

      {/* iOS 에서 <select> = native 휠 피커. 칩 그리드보다 화면 압축 + 익숙한 UX. */}
      {/* 1단: 국가 */}
      <div>
        <div className="flex items-center gap-1 mb-2">
          <Globe size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">국가</span>
        </div>
        <select
          value={selectedCountry}
          onChange={(e) => handleCountryChange(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* 2단: 시/도 (한국만) */}
      {selectedCountry === 'KR' && provinces.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <MapPin size={14} className="text-green-500" />
            <span className="text-sm font-semibold text-[var(--foreground)]">시/도</span>
          </div>
          <select
            value={rankLevel === 'country' ? '__all__' : selectedProvince}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__all__') {
                setSelectedProvince('');
                setSelectedDistrict('');
                setRankLevel('country');
              } else {
                handleProvinceChange(v);
              }
            }}
            className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-base font-semibold focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="__all__">🇰🇷 전체 (국가 단위)</option>
            {provinces.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      )}

      {/* 3단: 구/군 */}
      {selectedCountry === 'KR' && rankLevel !== 'country' && districts.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <MapPin size={14} className="text-orange-500" />
            <span className="text-sm font-semibold text-[var(--foreground)]">구/군</span>
          </div>
          <select
            value={rankLevel === 'province' ? '__all__' : selectedDistrict}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__all__') {
                setSelectedDistrict('');
                setRankLevel('province');
              } else {
                setSelectedDistrict(v);
                setRankLevel('district');
              }
            }}
            className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-base font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="__all__">{selectedProvince.replace('특별시','').replace('광역시','').replace('특별자치시','').replace('특별자치도','')} 전체 (시/도 단위)</option>
            {districts.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {!profile?.region_gu && (
        <p className="text-xs text-[var(--muted)]">
          <Link href="/profile/edit" className="text-[var(--accent)] underline">프로필</Link> 에서 지역을 설정하면 랭킹에 참여할 수 있습니다
        </p>
      )}

      {/* 랭킹 목록 */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      ) : rankings.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">🏆</p>
          <p className="text-sm font-medium text-[var(--foreground)]">
            {rankLevel === 'country'
              ? '국가 단위 통합 랭킹은 곧 출시됩니다'
              : rankLevel === 'province'
              ? `${selectedProvince} 통합 랭킹은 곧 출시됩니다`
              : `${selectedDistrict || selectedProvince}에 아직 기록이 없습니다`}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {rankLevel === 'district' ? '첫 번째 러너가 되어보세요!' : '구/군별 랭킹부터 확인하세요'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {rankings.map((r) => (
            <Link
              key={r.user_id}
              href={`/profile/view?id=${r.user_id}`}
              className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--card-border)] last:border-0 ${
                r.rank_in_gu <= 3 ? 'bg-[var(--accent)]/5' : ''
              }`}
            >
              <div className="w-8 text-center flex-shrink-0">
                <span className={`text-base font-bold ${r.rank_in_gu <= 3 ? 'text-lg' : 'text-[var(--muted)]'}`}>
                  {medalEmoji(r.rank_in_gu)}
                </span>
              </div>
              <div className="w-8 h-8 rounded-full bg-[var(--card-border)] overflow-hidden flex-shrink-0">
                {r.avatar_url ? (
                  <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><AppLogo size={18} /></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--foreground)] truncate">{r.display_name}</p>
                <p className="text-xs text-[var(--muted)]">{r.run_count}회 러닝</p>
              </div>
              <p className="text-base font-bold text-[var(--accent)]">{Number(r.monthly_km).toFixed(1)} km</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
