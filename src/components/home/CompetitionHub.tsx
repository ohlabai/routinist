'use client';

// 경쟁 허브 — 홈 UX Phase C (build 327, hans 리뷰).
// 홈에 4장 연속으로 쌓이던 경쟁 표면 (친구 리더보드·동네 TOP·쫓는사람) 을
// 탭 하나로 통합 — 한 번에 한 장만 보이고, 취향 탭은 localStorage 로 기억.
// (랭킹 히어로는 홈의 얼굴로 별도 유지, 승자 예측은 인터랙티브 게임이라 별도 카드)

import { useState } from 'react';
import { Users, MapPin, Zap } from 'lucide-react';
import FriendsLeaderboard from '@/components/home/FriendsLeaderboard';
import TodayLocalTop from '@/components/home/TodayLocalTop';
import RankNeighbors from '@/components/home/RankNeighbors';
import { useI18n } from '@/lib/i18n';

type HubTab = 'friends' | 'local' | 'chasers';
const TAB_KEY = 'home:competition-hub-tab';

export default function CompetitionHub() {
  const { tt } = useI18n();
  // lazy 초기값 — LazyMount 아래라 클라이언트에서만 마운트 (SSR 미스매치 없음)
  const [tab, setTab] = useState<HubTab>(() => {
    if (typeof window === 'undefined') return 'friends';
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      return saved === 'local' || saved === 'chasers' ? saved : 'friends';
    } catch { return 'friends'; }
  });

  const pick = (t: HubTab) => {
    setTab(t);
    try { window.localStorage.setItem(TAB_KEY, t); } catch { /* 무시 */ }
  };

  const tabs: { id: HubTab; label: string; Icon: typeof Users }[] = [
    { id: 'friends', label: tt('친구'), Icon: Users },
    { id: 'local', label: tt('동네'), Icon: MapPin },
    { id: 'chasers', label: tt('쫓는 사람'), Icon: Zap },
  ];

  return (
    <div>
      <div className="mx-4 flex bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-1 shadow-sm">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => pick(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-extrabold transition-all active:scale-95 ${
              tab === id
                ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                : 'text-[var(--muted)]'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      {/* 각 컴포넌트는 자체 카드 래퍼·빈 상태 처리를 그대로 사용 */}
      {tab === 'friends' && <FriendsLeaderboard />}
      {tab === 'local' && <TodayLocalTop />}
      {tab === 'chasers' && <RankNeighbors />}
    </div>
  );
}
