'use client';

// 마일리지 적립 가이드 — /mileage 에서 ? 아이콘으로 진입.
// build 224: 사용자 질문이 잦은 "마일리지가 어떻게 쌓이는지" 를 한 페이지로 정리.

import { ArrowLeft, Coins, Sparkles, Flame, Trophy, Gift, Heart, AlertCircle, ShoppingBag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

interface Rule {
  Icon: typeof Coins;
  title: string;
  formula: string;
  desc: string;
  accent: 'emerald' | 'amber' | 'rose' | 'sky';
}

const EARN_RULES: Rule[] = [
  {
    Icon: Coins,
    title: '러닝 기본 적립',
    formula: '1km = 1P',
    desc: 'GPS·Apple Health 어디서든 1km 달릴 때마다 1포인트가 자동으로 쌓여요.',
    accent: 'emerald',
  },
  {
    Icon: Flame,
    title: '어제도 달렸어요 보너스',
    formula: '×2 배수',
    desc: '어제 0.5km 이상 달렸으면 오늘은 1km = 2P. 이틀 연속이 시작이에요!',
    accent: 'rose',
  },
  {
    Icon: Trophy,
    title: '연속 일수 보너스',
    formula: '+7P / +30P',
    desc: '7일 연속 7P 보너스, 30일 연속 30P 보너스가 추가로 들어와요.',
    accent: 'amber',
  },
  {
    Icon: Sparkles,
    title: '최초 거리 달성 보너스',
    formula: '+5 ~ +50P',
    desc: '첫 5km (+5P), 첫 10km (+10P), 첫 하프 (+25P), 첫 마라톤 풀코스 (+50P).',
    accent: 'sky',
  },
];

const SPEND_RULES: Rule[] = [
  {
    Icon: ShoppingBag,
    title: '쇼핑 결제',
    formula: '1P = 1원',
    desc: '쇼핑 탭에서 상품 결제할 때 마일리지로 쓸 수 있어요. 일부 또는 전액 사용 가능.',
    accent: 'sky',
  },
  {
    Icon: Gift,
    title: '친구에게 선물',
    formula: '최소 10P부터',
    desc: '내 마일리지를 친구에게 보내요. 받는 사람한테 알림이 가요.',
    accent: 'emerald',
  },
  {
    Icon: Heart,
    title: '클럽 후원',
    formula: '소속 클럽에게',
    desc: '내가 가입한 클럽의 공동 적립금으로 보내요. 이벤트·상품권에 쓰여요.',
    accent: 'rose',
  },
];

const accentMap = {
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', icon: 'text-emerald-600', tag: 'bg-emerald-500' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', icon: 'text-amber-600', tag: 'bg-amber-500' },
  rose: { bg: 'bg-rose-50 dark:bg-rose-950/30', icon: 'text-rose-600', tag: 'bg-rose-500' },
  sky: { bg: 'bg-sky-50 dark:bg-sky-950/30', icon: 'text-sky-600', tag: 'bg-sky-500' },
};

export default function MileageHelpPage() {
  const router = useRouter();
  const { tt } = useI18n();

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight">{tt('마일리지 가이드')}</h1>
        </div>
      </header>

      <section className="px-4 pt-5 space-y-5">
        {/* Hero */}
        <div className="card p-5 bg-gradient-to-br from-emerald-50/60 to-transparent dark:from-emerald-950/20 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-500/30">
            <Coins size={28} className="text-white" />
          </div>
          <h2 className="text-xl font-extrabold mb-1">{tt('달릴수록 쌓여요 🌱')}</h2>
          <p className="text-base text-[var(--muted)] break-keep leading-relaxed">
            {tt('루티니스트의 마일리지는 달린 거리 + 연속 일수 + 최초 달성에서 자동으로 모입니다. 모은 포인트는 친구에게 선물하거나 클럽 후원에 써요.')}
          </p>
        </div>

        {/* 적립 규칙 */}
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--muted)] mb-2 px-1">{tt('어떻게 모이나요?')}</h3>
          <div className="space-y-2.5">
            {EARN_RULES.map((rule) => {
              const a = accentMap[rule.accent];
              return (
                <div key={rule.title} className={`card p-4 ${a.bg}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-2xl bg-white dark:bg-black/30 flex items-center justify-center flex-shrink-0 ${a.icon}`}>
                      <rule.Icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="text-base font-extrabold text-[var(--foreground)]">{tt(rule.title)}</h4>
                        <span className={`text-xs font-extrabold px-2 py-0.5 rounded-full text-white ${a.tag}`}>{tt(rule.formula)}</span>
                      </div>
                      <p className="text-sm text-[var(--muted)] break-keep leading-relaxed">{tt(rule.desc)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 사용처 */}
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--muted)] mb-2 px-1">{tt('어디에 쓰나요?')}</h3>
          <div className="space-y-2.5">
            {SPEND_RULES.map((rule) => {
              const a = accentMap[rule.accent];
              return (
                <div key={rule.title} className={`card p-4 ${a.bg}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-2xl bg-white dark:bg-black/30 flex items-center justify-center flex-shrink-0 ${a.icon}`}>
                      <rule.Icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="text-base font-extrabold text-[var(--foreground)]">{tt(rule.title)}</h4>
                        <span className={`text-xs font-extrabold px-2 py-0.5 rounded-full text-white ${a.tag}`}>{tt(rule.formula)}</span>
                      </div>
                      <p className="text-sm text-[var(--muted)] break-keep leading-relaxed">{tt(rule.desc)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 자주 묻는 질문 */}
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--muted)] mb-2 px-1">{tt('자주 묻는 질문')}</h3>
          <div className="card divide-y divide-[var(--card-border)]/40">
            <div className="p-4">
              <p className="text-base font-extrabold mb-1.5">{tt('Q. 적립이 안 보여요')}</p>
              <p className="text-sm text-[var(--muted)] break-keep leading-relaxed">
                {tt('러닝 저장 직후 자동 적립되지만, Apple Health 동기화는 잠시 시간이 걸릴 수 있어요. 홈에서 새로고침 한 번이면 보통 반영돼요.')}
              </p>
            </div>
            <div className="p-4">
              <p className="text-base font-extrabold mb-1.5">{tt('Q. 같은 러닝이 2번 잡혔어요')}</p>
              <p className="text-sm text-[var(--muted)] break-keep leading-relaxed">
                {tt('Routinist GPS 와 Apple Health 양쪽에서 같은 워크아웃이 들어오면 자동으로 1건만 인정해요. 혹시 중복이 보이면 내 정보 → 진단에서 알려주세요.')}
              </p>
            </div>
            <div className="p-4">
              <p className="text-base font-extrabold mb-1.5">{tt('Q. 마일리지에 유효기간이 있나요?')}</p>
              <p className="text-sm text-[var(--muted)] break-keep leading-relaxed">
                {tt('현재 만료 없이 누적돼요. 정책이 바뀌면 사전에 알려드릴게요.')}
              </p>
            </div>
          </div>
        </div>

        {/* 푸터 안내 */}
        <div className="rounded-2xl bg-[var(--card)] border border-[var(--card-border)] p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--muted)] mt-0.5 flex-shrink-0" />
          <p className="text-sm text-[var(--muted)] break-keep leading-relaxed">
            {tt('세부 배수·보너스 규칙은 운영 상황에 따라 조정될 수 있어요. 최신 정책은 이 페이지에 항상 반영돼요.')}
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/mileage"
            className="block text-center w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold shadow-md shadow-emerald-500/30 active:scale-[0.98]"
          >
            {tt('내 마일리지 보기')}
          </Link>
        </div>
      </section>
    </div>
  );
}
