'use client';

// 지역 랭킹 — 모던 모바일 UX/UI (에메랄드 그린).

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { fetchRegionalRankings } from '@/lib/social-data';
import { ArrowLeft, Trophy, MapPin, Globe, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { RegionalRanking } from '@/types';
import AppLogo from '@/components/AppLogo';
import { COUNTRIES as ALL_COUNTRIES, KR_REGIONS } from '@/lib/regions';
import { logClientWarn } from '@/lib/error-logger';

const COUNTRIES = ALL_COUNTRIES.map(c => ({ code: c.code, name: c.native }));
const KR_PROVINCES = KR_REGIONS;
type RankLevel = 'country' | 'province' | 'district';

export default function RankingsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [rankings, setRankings] = useState<RegionalRanking[]>([]);
  const [year] = useState(new Date().getFullYear());
  const [month] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState('KR');
  const [selectedProvince, setSelectedProvince] = useState(profile?.region_si || '서울특별시');
  const [selectedDistrict, setSelectedDistrict] = useState(profile?.region_gu || '강남구');
  const [rankLevel, setRankLevel] = useState<RankLevel>('district');

  const provinces = selectedCountry === 'KR' ? Object.keys(KR_PROVINCES) : [];
  const districts = selectedCountry === 'KR' && selectedProvince ? (KR_PROVINCES[selectedProvince] || []) : [];

  const handleCountryChange = (code: string) => {
    setSelectedCountry(code);
    if (code !== 'KR') {
      setSelectedProvince(''); setSelectedDistrict(''); setRankLevel('country');
    } else {
      setSelectedProvince(provinces[0] || '서울특별시'); setRankLevel('district');
    }
  };

  const handleProvinceChange = (province: string) => {
    setSelectedProvince(province);
    const dists = KR_PROVINCES[province] || [];
    setSelectedDistrict(dists[0] || ''); setRankLevel('district');
  };

  const loadRankings = useCallback(async () => {
    if (!selectedDistrict && rankLevel === 'district') return;
    setLoading(true);
    try {
      const region = rankLevel === 'district' ? selectedDistrict : selectedProvince;
      const data = await fetchRegionalRankings(region, year, month);
      setRankings(data);
    } catch (e) {
      logClientWarn('rankings', 'fetchRegionalRankings 실패', { region: rankLevel === 'district' ? selectedDistrict : selectedProvince, year, month, err: String(e) });
    } finally { setLoading(false); }
  }, [selectedDistrict, selectedProvince, rankLevel, year, month]);

  useEffect(() => { loadRankings(); }, [loadRankings]);

  const medalEmoji = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
  };

  const regionDisplay = rankLevel === 'country' ? COUNTRIES.find(c => c.code === selectedCountry)?.name :
                       rankLevel === 'province' ? selectedProvince :
                       selectedDistrict;

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">지역 랭킹</h1>
        </div>
      </header>

      {/* Hero — 현재 지역 + 기간 */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-5 shadow-lg shadow-emerald-500/30">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm mb-2">
              <Trophy size={11} className="text-white" />
              <span className="text-[10px] font-extrabold text-white tracking-widest">{year}년 {month}월 랭킹</span>
            </div>
            <p className="text-3xl font-extrabold text-white leading-tight inline-flex items-center gap-2">
              <MapPin size={22} className="text-white/80" />
              {regionDisplay || '지역 선택'}
            </p>
            <p className="text-xs text-white/85 mt-1.5">
              {rankings.length > 0 ? `${rankings.length}명의 러너가 경쟁 중` : '랭킹을 확인해보세요'}
            </p>
          </div>
        </div>
      </section>

      {/* 지역 셀렉터 */}
      <section className="px-4 mt-4 space-y-2.5">
        <SelectField icon={<Globe size={14} className="text-emerald-500" />} label="국가">
          <select
            value={selectedCountry}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-sm font-bold focus:outline-none focus:border-emerald-500 transition"
          >
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </SelectField>

        {selectedCountry === 'KR' && provinces.length > 0 && (
          <SelectField icon={<MapPin size={14} className="text-emerald-500" />} label="시/도">
            <select
              value={rankLevel === 'country' ? '__all__' : selectedProvince}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__all__') { setSelectedProvince(''); setSelectedDistrict(''); setRankLevel('country'); }
                else handleProvinceChange(v);
              }}
              className="w-full px-4 py-3 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-sm font-bold focus:outline-none focus:border-emerald-500 transition"
            >
              <option value="__all__">🇰🇷 전체 (국가 단위)</option>
              {provinces.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </SelectField>
        )}

        {selectedCountry === 'KR' && rankLevel !== 'country' && districts.length > 0 && (
          <SelectField icon={<MapPin size={14} className="text-emerald-500" />} label="구/군">
            <select
              value={rankLevel === 'province' ? '__all__' : selectedDistrict}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__all__') { setSelectedDistrict(''); setRankLevel('province'); }
                else { setSelectedDistrict(v); setRankLevel('district'); }
              }}
              className="w-full px-4 py-3 rounded-2xl bg-[var(--card)] border-2 border-[var(--card-border)] text-sm font-bold focus:outline-none focus:border-emerald-500 transition"
            >
              <option value="__all__">{selectedProvince.replace('특별시','').replace('광역시','').replace('특별자치시','').replace('특별자치도','')} 전체 (시/도 단위)</option>
              {districts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </SelectField>
        )}
      </section>

      {!profile?.region_gu && (
        <div className="px-4 mt-3">
          <div className="card p-3 inline-flex items-start gap-2 text-[11px]">
            <Sparkles size={12} className="text-emerald-500 flex-shrink-0 mt-0.5" />
            <p className="text-[var(--muted)]">
              <Link href="/profile/edit" className="text-emerald-600 font-bold underline">프로필</Link> 에서 지역을 설정하면 랭킹에 참여할 수 있어요
            </p>
          </div>
        </div>
      )}

      {/* 랭킹 목록 */}
      <section className="px-4 mt-4">
        {loading ? (
          <div className="space-y-2">
            {[0,1,2,3].map(i => (
              <div key={i} className="card p-3 flex items-center gap-3 animate-pulse">
                <div className="w-7 h-7 rounded bg-[var(--card-border)]/50" />
                <div className="w-9 h-9 rounded-full bg-[var(--card-border)]/50" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/2 bg-[var(--card-border)]/50 rounded" />
                  <div className="h-2 w-1/3 bg-[var(--card-border)]/50 rounded" />
                </div>
                <div className="h-4 w-16 bg-[var(--card-border)]/50 rounded" />
              </div>
            ))}
          </div>
        ) : rankings.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-4 flex items-center justify-center">
              <Trophy size={36} className="text-emerald-500" />
            </div>
            <p className="text-base font-extrabold mb-1">
              {rankLevel === 'country' ? '국가 단위 통합 랭킹은 곧 출시' :
               rankLevel === 'province' ? `${selectedProvince} 통합 랭킹은 곧 출시` :
               `${selectedDistrict || selectedProvince}에 아직 기록이 없어요`}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {rankLevel === 'district' ? '첫 번째 러너가 되어보세요!' : '구/군별 랭킹부터 확인하세요'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {rankings.map(r => {
              const isTop3 = r.rank_in_gu <= 3;
              return (
                <Link
                  key={r.user_id}
                  href={`/social/user?id=${r.user_id}`}
                  className={`card p-3 flex items-center gap-3 active:scale-[0.99] transition ${
                    isTop3 ? 'bg-gradient-to-br from-emerald-50/60 to-transparent dark:from-emerald-950/20 border-emerald-200/50 dark:border-emerald-900/40' : ''
                  }`}
                >
                  <div className="w-9 text-center flex-shrink-0">
                    {isTop3 ? (
                      <span className="text-2xl">{medalEmoji(r.rank_in_gu)}</span>
                    ) : (
                      <span className="text-sm font-extrabold text-[var(--muted)]">{r.rank_in_gu}</span>
                    )}
                  </div>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/30 overflow-hidden flex-shrink-0">
                    {r.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><AppLogo size={20} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold truncate">{r.display_name}</p>
                    <p className="text-[11px] text-[var(--muted)]">{r.run_count}회 러닝</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-extrabold text-emerald-600">{Number(r.monthly_km).toFixed(1)}</p>
                    <p className="text-[10px] text-[var(--muted)] font-bold">km</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SelectField({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 px-1">
        {icon}
        <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">{label}</span>
      </div>
      {children}
    </div>
  );
}
