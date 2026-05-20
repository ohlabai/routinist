'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { updateProfile } from '@/lib/auth';
import AppLogo from '@/components/AppLogo';
import { Target, MapPin, ChevronRight } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useDisplayNameCheck } from '@/lib/useDisplayNameCheck';
import DisplayNameStatusHint from '@/components/DisplayNameStatusHint';

interface OnboardingProps {
  onComplete: () => void;
}

const REGIONS = ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [goalKm, setGoalKm] = useState(30);
  const [regionGu, setRegionGu] = useState('');
  const [saving, setSaving] = useState(false);
  // 본인 row 는 trigger 로 이미 만들어져있음 → 본인 id 제외해서 검증
  const displayNameCheck = useDisplayNameCheck(displayName, user?.id);

  const handleFinish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateProfile(user.id, { display_name: displayName.trim() || profile?.display_name || '러너' });

      const supabase = getSupabase();
      // 지역 설정
      if (regionGu) {
        await supabase.from('profiles').update({ region_si: '서울특별시', region_gu: regionGu }).eq('id', user.id);
      }

      // 월간 목표 설정
      const now = new Date();
      await supabase.from('monthly_goals').upsert({
        user_id: user.id,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        goal_km: goalKm,
      }, { onConflict: 'user_id,year,month' });

      await refreshProfile();
      onComplete();
    } catch {
      onComplete(); // 실패해도 진행
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    // Step 0: 환영
    <div key="welcome" className="text-center">
      <div className="mb-6"><AppLogo size={72} /></div>
      <h2 className="text-2xl font-extrabold text-[var(--foreground)] mb-2">Routinist에 오신 걸 환영합니다!</h2>
      <p className="text-xs text-[var(--muted)] mb-8">나만의 러닝 루틴을 만들어볼까요?</p>
      <button
        onClick={() => setStep(1)}
        className="w-full py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-base flex items-center justify-center gap-2"
      >
        시작하기 <ChevronRight size={18} />
      </button>
    </div>,

    // Step 1: 닉네임
    <div key="name">
      <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">닉네임을 정해주세요</h2>
      <p className="text-xs text-[var(--muted)] mb-6">다른 러너들에게 보여지는 이름이에요</p>
      <input
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={20}
        placeholder="닉네임"
        className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      />
      <div className="mb-6">
        <DisplayNameStatusHint check={displayNameCheck} />
      </div>
      <button
        onClick={() => setStep(2)}
        disabled={!displayName.trim() || !displayNameCheck.isValid}
        className="w-full py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
      >
        다음 <ChevronRight size={18} />
      </button>
    </div>,

    // Step 2: 목표 설정
    <div key="goal">
      <div className="flex items-center gap-2 mb-2">
        <Target size={20} className="text-[var(--accent)]" />
        <h2 className="text-xl font-bold text-[var(--foreground)]">이번 달 목표를 정해볼까요?</h2>
      </div>
      <p className="text-xs text-[var(--muted)] mb-6">언제든 변경할 수 있어요</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[30, 50, 100].map((km) => (
          <button
            key={km}
            onClick={() => setGoalKm(km)}
            className={`py-3 rounded-xl text-base font-bold transition-all ${
              goalKm === km ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)]'
            }`}
          >
            {km}km
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-6">
        <input
          type="number"
          value={goalKm}
          onChange={(e) => setGoalKm(Number(e.target.value))}
          min={1}
          max={1000}
          className="flex-1 px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-center font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <span className="text-xs text-[var(--muted)]">km / 월</span>
      </div>
      <button
        onClick={() => setStep(3)}
        className="w-full py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-base flex items-center justify-center gap-2"
      >
        다음 <ChevronRight size={18} />
      </button>
    </div>,

    // Step 3: 지역 설정
    <div key="region">
      <div className="flex items-center gap-2 mb-2">
        <MapPin size={20} className="text-[var(--accent)]" />
        <h2 className="text-xl font-bold text-[var(--foreground)]">어디서 달리시나요?</h2>
      </div>
      <p className="text-xs text-[var(--muted)] mb-6">지역 랭킹에 참여할 수 있어요 (선택사항)</p>
      <div className="grid grid-cols-3 gap-2 mb-6 max-h-48 overflow-y-auto">
        {REGIONS.map((gu) => (
          <button
            key={gu}
            onClick={() => setRegionGu(regionGu === gu ? '' : gu)}
            className={`py-2 rounded-lg text-sm font-semibold transition-all ${
              regionGu === gu ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)]'
            }`}
          >
            {gu}
          </button>
        ))}
      </div>
      <button
        onClick={handleFinish}
        disabled={saving}
        className="w-full py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-base disabled:opacity-50"
      >
        {saving ? '설정 중...' : '시작하기!'}
      </button>
      <button
        onClick={handleFinish}
        className="w-full text-center text-xs text-[var(--muted)] mt-3 py-2"
      >
        건너뛰기
      </button>
    </div>,
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-6">
      <div className="w-full max-w-sm">
        {/* 진행 바 */}
        <div className="flex gap-1.5 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`flex-1 h-1 rounded-full transition-all ${i <= step ? 'bg-[var(--accent)]' : 'bg-[var(--card-border)]'}`} />
          ))}
        </div>
        {steps[step]}
      </div>
    </div>
  );
}
