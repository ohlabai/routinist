'use client';

// 사용자 푸시 설정 (build 121) — 카테고리별 toggle.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, Trophy, Users, Award, MessageSquare, TrendingUp, Megaphone, Flag, Save, Heart, UserPlus } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import { useI18n } from '@/lib/i18n';

// build 268: build 261/264/266 의 user_notifications push 카테고리 추가.
// social_cheer / social_comment / social_follow / social_friend 4종.
type CategoryKey = 'chat_message' | 'mileage_gift' | 'feedback_reply' | 'likes' | 'friend_overtake' | 'milestone' | 'contest' | 'club_course' | 'weekly_recap' | 'marketing'
  | 'social_cheer' | 'social_comment' | 'social_follow' | 'social_friend' | 'social_rival';

// build 175 #5: 핵심 알림 4종을 상단에 노출 — 채팅·선물·답글·좋아요. 기본 ON.
// 친선런(contest) 은 메뉴 숨김 (build 144) 과 동일하게 알림 설정에서도 표시 안 함.
// DB 의 contest 키는 그대로 유지 — 추후 부활 시 1줄로 복구.
type CategoryDef = { key: CategoryKey; label: string; description: string; Icon: typeof Bell };

function getCategories(tt: (ko: string) => string, locale: 'ko' | 'en'): CategoryDef[] {
  return [
    { key: 'chat_message', label: tt('채팅 메시지'), description: tt('새 쪽지·채팅이 도착했을 때'), Icon: MessageSquare },
    { key: 'social_cheer', label: tt('응원'), description: locale === 'en' ? 'When someone cheers you directly' : '다른 러너가 나에게 응원을 보냈을 때', Icon: Heart },
    { key: 'social_comment', label: tt('댓글'), description: locale === 'en' ? 'When someone comments on your photo or activity' : '내 사진·활동에 댓글이 달렸을 때', Icon: MessageSquare },
    { key: 'social_friend', label: tt('친구 신청·수락'), description: locale === 'en' ? 'Friend requests received and accepted' : '친구 신청을 받거나 내 신청이 수락됐을 때', Icon: UserPlus },
    { key: 'social_rival', label: tt('이달의 라이벌'), description: locale === 'en' ? 'Rival catchup callouts at month-end' : '월말 D-3 ~ D-1 라이벌 따라잡기 알림', Icon: Trophy },
    { key: 'social_follow', label: tt('새 친구'), description: locale === 'en' ? 'When someone adds you as a friend (instant follow)' : '다른 러너가 나를 친구로 추가했을 때', Icon: Users },
    { key: 'mileage_gift', label: tt('마일리지 선물'), description: tt('다른 러너에게 선물을 받았을 때'), Icon: Award },
    { key: 'feedback_reply', label: tt('운영자 답글'), description: tt('내 제안에 운영자가 답글을 달았을 때'), Icon: MessageSquare },
    { key: 'likes', label: tt('좋아요'), description: locale === 'en' ? 'When someone likes your photo or note' : '내 사진·한 줄에 좋아요가 도착했을 때', Icon: Heart },
    { key: 'friend_overtake', label: locale === 'en' ? 'Friend overtake' : '친구 추월', description: locale === 'en' ? 'When a friend passes your km, or you pass theirs' : '친구가 내 km 를 추월하거나 내가 추월했을 때', Icon: Users },
    { key: 'milestone', label: locale === 'en' ? 'My records' : '나의 기록', description: locale === 'en' ? 'Reaching #1, longest distance, etc.' : '1위 등극, 최장 거리 갱신 등', Icon: TrendingUp },
    { key: 'club_course', label: locale === 'en' ? 'Club marathon' : '클럽 마라톤', description: locale === 'en' ? 'Club course start and finish alerts' : '클럽 코스 시작·완주 알림', Icon: Flag },
    { key: 'weekly_recap', label: locale === 'en' ? 'Weekly recap' : '주간 회고', description: locale === 'en' ? 'Weekly running summary' : '매주 내 러닝 요약', Icon: Award },
    { key: 'marketing', label: locale === 'en' ? 'Events & marketing' : '이벤트·마케팅', description: locale === 'en' ? 'New features, shop discounts, etc. (default OFF)' : '신기능, 쇼핑 할인 등 (기본 OFF)', Icon: Megaphone },
  ];
}

const DEFAULTS: Record<CategoryKey, boolean> = {
  chat_message: true,
  mileage_gift: true,
  feedback_reply: true,
  likes: true,
  friend_overtake: true,
  milestone: true,
  contest: true,
  club_course: true,
  weekly_recap: true,
  marketing: false,
  // build 268: 신규 4종 — 기본 ON. should_send_push 는 default TRUE 라 일관성 맞춤.
  social_cheer: true,
  social_comment: true,
  social_follow: true,
  social_friend: true,
  social_rival: true,
};

export default function PushSettingsPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const CATEGORIES = getCategories(tt, locale);
  const [settings, setSettings] = useState<Record<CategoryKey, boolean>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data } = await supabase.from('profiles').select('push_settings').eq('id', user.id).maybeSingle();
      const stored = (data?.push_settings as Record<string, boolean> | null) ?? {};
      const merged: Record<CategoryKey, boolean> = { ...DEFAULTS };
      (Object.keys(DEFAULTS) as CategoryKey[]).forEach(k => {
        if (k in stored) merged[k] = stored[k];
      });
      setSettings(merged);
    } catch (e) {
      console.warn('[push-settings] load', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const toggle = (k: CategoryKey) => {
    setSettings(prev => ({ ...prev, [k]: !prev[k] }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc('update_push_settings', { p_settings: settings });
      if (error) throw error;
      setDirty(false);
      showToast(tt('✨ 저장됨'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('저장 실패'), 'warn');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-lg mx-auto pb-24 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link href="/profile" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-[var(--card-border)]/30">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight inline-flex items-center gap-1.5">
            <Bell size={18} className="text-emerald-500" /> {locale === 'en' ? 'Notifications' : '알림 설정'}
          </h1>
        </div>
      </header>

      <div className="p-4 space-y-3">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4 shadow-md shadow-emerald-500/30">
          <p className="text-sm font-extrabold text-white">{tt('필요한 알림만 받으세요')}</p>
          <p className="text-xs text-white/85 mt-1 leading-relaxed">
            {locale === 'en'
              ? 'Toggle each category. System notifications can also be fully blocked in iOS Settings > Notifications > Routinist.'
              : '카테고리별로 켜고 끌 수 있어요. 시스템 알림은 iOS 설정 > 알림 > Routinist 에서 전체 차단할 수도 있어요.'}
          </p>
        </div>

        {loading ? (
          [0,1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse" />)
        ) : (
          CATEGORIES.map(c => {
            const on = settings[c.key];
            return (
              <button
                key={c.key}
                onClick={() => toggle(c.key)}
                className={`w-full rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4 text-left active:scale-[0.99] transition flex items-center gap-3`}
              >
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  on ? 'bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-950/40 text-emerald-600' : 'bg-[var(--card-border)]/30 text-[var(--muted)]'
                }`}>
                  <c.Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold">{c.label}</p>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{c.description}</p>
                </div>
                <div className={`w-11 h-6 rounded-full transition relative flex-shrink-0 ${on ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-[var(--card-border)]'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                </div>
              </button>
            );
          })
        )}
      </div>

      {dirty && (
        <div className="fixed left-0 right-0 bottom-0 px-4 pb-4 z-30 pointer-events-none" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <button
            onClick={save}
            disabled={saving}
            className="w-full max-w-lg mx-auto py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-sm disabled:opacity-50 active:scale-[0.98] shadow-xl shadow-emerald-500/40 inline-flex items-center justify-center gap-1.5 pointer-events-auto"
          >
            {saving ? tt('저장 중…') : <><Save size={16} /> {locale === 'en' ? 'Save changes' : '변경사항 저장'}</>}
          </button>
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={1800} />}
    </div>
  );
}
