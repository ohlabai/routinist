'use client';

// 친구 초대 카드 (build 292 성장 루프) — /profile 에 마운트.
// 내 초대 코드 (get_my_referral_code, localStorage 캐시) + 복사 + 공유 (Capacitor Share).
// RPC 미배포/실패 시 카드 자체를 숨김 (조용히) — 에러 노출 없음.

import { useEffect, useState } from 'react';
import { Gift, Copy, Share2, Check } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getMyReferralCode, buildInviteUrl } from '@/lib/referral-data';
import { isNativeApp } from '@/lib/health-sync';

export default function InviteFriendCard() {
  const { user } = useAuth();
  const { tt, locale } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getMyReferralCode(user.id).then((c) => {
      if (!cancelled) setCode(c);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!user || !code) return null;

  const inviteUrl = buildInviteUrl(code);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard 권한 없음 — 코드는 화면에 그대로 보임 */ }
  };

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    const text = locale === 'en'
      ? `Run with me on Routinist! 🏃 Sign up with my code ${code} and we both get 100P`
      : `Routinist 에서 같이 달려요! 🏃 내 코드 ${code} 로 가입하면 서로 100P 를 받아요`;
    const title = locale === 'en' ? 'Routinist invite' : 'Routinist 친구 초대';
    try {
      if (isNativeApp()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title, text, url: inviteUrl });
      } else if (navigator.share) {
        await navigator.share({ title, text, url: inviteUrl });
      } else {
        await navigator.clipboard.writeText(`${text}\n${inviteUrl}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { /* 사용자가 공유 시트 닫음 등 — 조용히 */ } finally {
      setSharing(false);
    }
  };

  return (
    <div className="card p-5 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border-emerald-200/60 dark:border-emerald-900/40">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
          <Gift size={15} className="text-emerald-600" />
        </div>
        <h3 className="text-sm font-extrabold text-emerald-800 dark:text-emerald-200">{tt('친구 초대')}</h3>
      </div>
      <p className="text-[13px] text-emerald-700/80 dark:text-emerald-400/80 leading-relaxed">
        {locale === 'en'
          ? 'When a friend signs up with your code, you both get 100P 🎁'
          : '친구가 내 코드로 가입하면 서로 100P 를 받아요 🎁'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-emerald-200/60 dark:border-emerald-900/40 text-center">
          <span className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300 tracking-[0.25em]">{code}</span>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border-[1.5px] border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm font-bold active:scale-[0.97] transition"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? tt('복사했어요!') : tt('복사')}
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={sharing}
          className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold shadow-md shadow-emerald-500/25 active:scale-[0.97] transition disabled:opacity-50"
        >
          <Share2 size={14} />
          {tt('공유')}
        </button>
      </div>
    </div>
  );
}
