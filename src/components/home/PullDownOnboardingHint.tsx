'use client';

// build 167 #8: 첫 방문자 PTR 온보딩 힌트.
// 회색 빈 상태일 때 (activities 없음) 화면 상단에 친근 안내 + 위→아래 화살표 애니메이션.
// 사용자가 한 번이라도 당겨서 새로고침하거나, X 로 닫으면 영구 dismiss.

import { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useUserData } from '@/components/UserDataProvider';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';

const STORAGE_KEY = 'ptr_onboarding_hint_dismissed';

export default function PullDownOnboardingHint() {
  const { user } = useAuth();
  const { activities, loading, lastUpdated } = useUserData();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;
    if (loading) return;
    // 한 번이라도 새로고침했거나 활동이 이미 있으면 표시 안 함.
    if (activities.length > 0) return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
    } catch {}
    setVisible(true);
  }, [user, loading, activities.length]);

  // PTR 1회 성공 시 (lastUpdated 갱신) 자동 dismiss.
  useEffect(() => {
    if (visible && lastUpdated) {
      handleDismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUpdated]);

  const handleDismiss = () => {
    setDismissing(true);
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    setTimeout(() => setVisible(false), 300);
  };

  if (!visible) return null;

  return (
    <div
      className={`mx-4 mt-2 mb-1 transition-all duration-300 ${dismissing ? 'opacity-0 -translate-y-2' : 'opacity-100'}`}
    >
      <div className="relative rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-3.5 overflow-hidden">
        <button
          onClick={handleDismiss}
          aria-label="안내 닫기"
          className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-emerald-100/60 dark:hover:bg-emerald-900/30 active:scale-90"
        >
          <X size={14} />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md animate-bounce-soft">
            <ChevronDown size={22} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
              {t('ptr.welcomeTitle')}
            </p>
            <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-0.5 leading-relaxed">
              {t('ptr.welcomeSub')}
            </p>
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes bounce-soft {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(6px); }
        }
        .animate-bounce-soft {
          animation: bounce-soft 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
