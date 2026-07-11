'use client';

// 사용자 푸시 설정 (build 121) — 카테고리별 toggle.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, Trophy, Users, Award, MessageSquare, TrendingUp, Megaphone, Flag, Save, Heart, UserPlus, Globe, AlarmClock, CalendarDays } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import AppToast from '@/components/AppToast';
import { useI18n } from '@/lib/i18n';

// build 268: build 261/264/266 의 user_notifications push 카테고리 추가.
// social_cheer / social_comment / social_follow / social_friend 4종.
// build 291 (P2 #23): producer 없는 죽은 토글 제거 (milestone / weekly_recap — push_send_log 에
// 이 카테고리로 INSERT 하는 곳이 repo 어디에도 없음) + 실제 producer 가 있는데 끌 수 없던
// 카테고리 추가 (friend_pb / course_progress / course_complete / world_chase / idle_reminder /
// month_end_recap). club_course 는 producer 가 'club_course_start'/'club_course_complete' 로
// 분리 체크해서 (enqueue_club_course_pushes: 'club_course_' || p_event) 죽은 키 → 2개로 교체.
// build 297 (알림 종단 리뷰): 끌 수 없던 카테고리 7종 추가 — weekly_recap (build 291 에서 죽은
// 토글로 제거 → 293 producer 부활 때 미복구 회귀) / streak_risk / referral / first_place_month /
// pb_distance / weekly_best_quote / review_request. low_stock_wishlist 은 마케팅 성격이라
// 별도 토글 없이 서버에서 marketing (기본 OFF) 게이트로 묶음. welcome_d1 은 가입 다음날 1회성이라 토글 제외.
type CategoryKey = 'chat_message' | 'mileage_gift' | 'feedback_reply' | 'likes' | 'friend_overtake' | 'contest' | 'marketing'
  | 'social_cheer' | 'social_comment' | 'social_follow' | 'social_friend' | 'social_rival'
  | 'friend_pb' | 'course_progress' | 'course_complete' | 'club_course_start' | 'club_course_complete'
  | 'world_chase' | 'idle_reminder' | 'month_end_recap'
  | 'weekly_recap' | 'streak_risk' | 'referral' | 'first_place_month' | 'pb_distance'
  | 'weekly_best_quote' | 'review_request';

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
    { key: 'social_rival', label: tt('이달의 페이스메이커'), description: locale === 'en' ? 'Pacemaker catch-up callouts at month-end' : '월말 D-3 ~ D-1 페이스메이커 따라잡기 알림', Icon: Trophy },
    { key: 'social_follow', label: tt('새 친구'), description: locale === 'en' ? 'When someone adds you as a friend (instant follow)' : '다른 러너가 나를 친구로 추가했을 때', Icon: Users },
    { key: 'mileage_gift', label: tt('마일리지 선물'), description: tt('다른 러너에게 선물을 받았을 때'), Icon: Award },
    { key: 'feedback_reply', label: tt('운영자 답글'), description: tt('내 제안에 운영자가 답글을 달았을 때'), Icon: MessageSquare },
    { key: 'likes', label: tt('좋아요'), description: locale === 'en' ? 'When someone likes your photo or note' : '내 사진·한 줄에 좋아요가 도착했을 때', Icon: Heart },
    { key: 'friend_overtake', label: locale === 'en' ? 'Friend overtake' : '친구 추월', description: locale === 'en' ? 'When a friend passes your km, or you pass theirs' : '친구가 내 km 를 추월하거나 내가 추월했을 때', Icon: Users },
    { key: 'friend_pb', label: tt('친구 신기록'), description: locale === 'en' ? 'When a friend sets a new personal best' : '친구가 개인 최고 기록을 세웠을 때', Icon: Trophy },
    { key: 'course_progress', label: tt('월드런 진행'), description: locale === 'en' ? 'Halfway and 90% milestones on your world run course' : '진행 중인 월드런 코스 절반·90% 도달 소식', Icon: TrendingUp },
    { key: 'course_complete', label: tt('월드런 완주'), description: locale === 'en' ? 'When you finish a world run course' : '월드런 코스를 완주했을 때', Icon: Flag },
    { key: 'world_chase', label: tt('월드런 추격'), description: locale === 'en' ? 'When a friend is closing in on you on a course' : '같은 코스에서 친구가 바짝 따라붙었을 때', Icon: Globe },
    { key: 'club_course_start', label: tt('클럽 마라톤 시작'), description: locale === 'en' ? 'When your club starts a new course together' : '우리 클럽이 새 코스를 함께 시작했을 때', Icon: Flag },
    { key: 'club_course_complete', label: tt('클럽 마라톤 완주'), description: locale === 'en' ? 'When your club finishes a course together' : '우리 클럽이 코스를 함께 완주했을 때', Icon: Award },
    { key: 'idle_reminder', label: tt('러닝 리마인더'), description: locale === 'en' ? 'A gentle nudge when you have been away for a while' : '한동안 달리지 않았을 때 살짝 보내는 안부', Icon: AlarmClock },
    { key: 'streak_risk', label: locale === 'en' ? 'Streak at risk' : '연속 기록 알림', description: locale === 'en' ? 'A weekend heads-up when your weekly streak needs one more run' : '주간 연속 기록이 끊기기 전 주말에 살짝 알려드려요', Icon: AlarmClock },
    { key: 'weekly_recap', label: locale === 'en' ? 'Weekly recap' : '주간 리포트', description: locale === 'en' ? 'Your last week in numbers, every Monday' : '월요일마다 받아보는 지난주 러닝 요약', Icon: CalendarDays },
    { key: 'month_end_recap', label: tt('월말 결산'), description: locale === 'en' ? 'Your monthly running recap at month-end' : '월말에 받아보는 이달의 내 러닝 요약', Icon: CalendarDays },
    { key: 'first_place_month', label: locale === 'en' ? 'Monthly 1st place' : '월간 1위 달성', description: locale === 'en' ? 'When you reach #1 in your ranking scope this month' : '이번 달 내 랭킹 범위에서 1위에 올랐을 때', Icon: Trophy },
    { key: 'pb_distance', label: locale === 'en' ? 'New longest run' : '최장 거리 신기록', description: locale === 'en' ? 'When you set a new personal longest distance' : '내 최장 거리 기록을 갱신했을 때', Icon: Trophy },
    { key: 'weekly_best_quote', label: locale === 'en' ? 'Weekly best note' : '주간 베스트 한 줄', description: locale === 'en' ? 'When your note becomes a weekly favorite' : '내 러너 한 줄이 이번 주 베스트로 뽑혔을 때', Icon: Heart },
    { key: 'referral', label: locale === 'en' ? 'Invite updates' : '초대 소식', description: locale === 'en' ? 'When an invitee joins or earns you a reward' : '초대한 친구가 가입하거나 보상이 도착했을 때', Icon: UserPlus },
    { key: 'review_request', label: locale === 'en' ? 'Review requests' : '리뷰 요청', description: locale === 'en' ? 'A one-time review nudge after delivery' : '쇼핑 상품 배송 후 리뷰 요청 (주문당 1회)', Icon: MessageSquare },
    { key: 'marketing', label: locale === 'en' ? 'Events & marketing' : '이벤트·마케팅', description: locale === 'en' ? 'New features, shop discounts, wishlist stock alerts, etc. (default OFF)' : '신기능, 쇼핑 할인, 찜 재고 알림 등 (기본 OFF)', Icon: Megaphone },
  ];
}

const DEFAULTS: Record<CategoryKey, boolean> = {
  chat_message: true,
  mileage_gift: true,
  feedback_reply: true,
  likes: true,
  friend_overtake: true,
  contest: true,
  marketing: false,
  // build 268: 신규 4종 — 기본 ON. should_send_push 는 default TRUE 라 일관성 맞춤.
  social_cheer: true,
  social_comment: true,
  social_follow: true,
  social_friend: true,
  social_rival: true,
  // build 291: producer 존재하는데 토글이 없던 카테고리 — 기본 ON (should_send_push 기본 TRUE 와 일치).
  friend_pb: true,
  course_progress: true,
  course_complete: true,
  club_course_start: true,
  club_course_complete: true,
  world_chase: true,
  idle_reminder: true,
  month_end_recap: true,
  // build 297: 알림 종단 리뷰 — 끌 수 없던 카테고리. 기본 ON (should_send_push 기본 TRUE 와 일치).
  weekly_recap: true,
  streak_risk: true,
  referral: true,
  first_place_month: true,
  pb_distance: true,
  weekly_best_quote: true,
  review_request: true,
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
      // build 291: 옛 'club_course' 단일 키를 끈 사용자 → 새 분리 키에 승계 (저장 시 새 키로 기록됨).
      if ('club_course' in stored) {
        if (!('club_course_start' in stored)) merged.club_course_start = stored.club_course;
        if (!('club_course_complete' in stored)) merged.club_course_complete = stored.club_course;
      }
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
