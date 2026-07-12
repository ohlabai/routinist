'use client';

import { ArrowLeft, MessageSquare, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

export default function SupportPage() {
  const router = useRouter();
  const { tt, locale } = useI18n();

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-[var(--foreground)]">{tt('고객 지원')}</h1>
      </div>

      {/* 제안 / 버그 게시판 CTA — 1:1 이메일보다 빠른 응대 */}
      <Link
        href="/feedback"
        className="block rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 shadow-lg shadow-emerald-500/30 active:scale-[0.99] transition"
      >
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
            <MessageSquare size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-extrabold text-white">{tt('제안 / 버그 게시판')}</p>
            <p className="text-xs text-white/85 mt-0.5 leading-relaxed">
              {tt('버그·기능 요청을 남기면 좋아요 모인 순서대로 우선 반영해요. 공개 글에는 운영자가 답글로 진행 상황을 알려드려요.')}
            </p>
          </div>
          <ChevronRight size={18} className="text-white flex-shrink-0 mt-2" />
        </div>
      </Link>

      <div className="card p-5 space-y-3">
        <h2 className="text-base font-bold text-[var(--foreground)]">{tt('앱 소개')}</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          {locale === 'en'
            ? 'Routinist is an app for managing your running records, tracking goals, and sharing the joy of running together. It syncs running data automatically via Apple HealthKit and Google Health Connect.'
            : 'Routinist는 나만의 러닝 기록을 관리하고, 목표 달성을 추적하며, 함께 달리는 즐거움을 나누는 앱입니다. Apple HealthKit 및 Google Health Connect와 연동하여 자동으로 러닝 데이터를 동기화합니다.'}
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-base font-bold text-[var(--foreground)]">{tt('문의하기')}</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          {tt('앱 사용 중 문제가 발생하거나 문의사항이 있으시면 아래 이메일로 연락해 주세요.')}
        </p>
        <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--accent)]/5 border border-[var(--accent)]/20">
          <span className="text-2xl">&#9993;</span>
          <div>
            <p className="text-xs text-[var(--muted)]">{tt('이메일')}</p>
            <a href="mailto:routinist@openhan.kr" className="text-[var(--accent)] font-semibold">routinist@openhan.kr</a>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-base font-bold text-[var(--foreground)]">{tt('자주 묻는 질문')}</h2>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{tt('러닝 기록이 자동으로 동기화되지 않아요')}</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              {locale === 'en'
                ? 'Open Settings > Health > Data Access & Devices and check Routinist permissions.'
                : '설정 > 건강 > 데이터 접근 및 기기에서 Routinist의 권한을 확인해 주세요.'}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{tt('목표는 어떻게 설정하나요?')}</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              {locale === 'en'
                ? 'Set your monthly running distance goal under Profile > Goals.'
                : '내 정보 > 목표 설정에서 월간 러닝 거리 목표를 설정할 수 있습니다.'}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{tt('회원 탈퇴는 어떻게 하나요?')}</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              {locale === 'en' ? (
                <>Tap the <span className="font-semibold text-[var(--foreground)]">Delete account</span> button at the bottom of your Profile screen. All data is permanently deleted immediately and cannot be recovered.</>
              ) : (
                <>내 정보 화면 하단의 <span className="font-semibold text-[var(--foreground)]">회원 탈퇴</span> 버튼을 눌러주세요.
                탈퇴 즉시 모든 데이터가 영구 삭제되며 복구할 수 없습니다.</>
              )}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{tt('앱에서 수집하는 데이터는 무엇인가요?')}</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              {locale === 'en'
                ? 'We only collect workout data such as running distance and time provided by the Health app. None of it is shared with third parties.'
                : '러닝 거리, 시간 등 건강 앱에서 제공하는 운동 데이터만 수집합니다. 제3자에게 제공되지 않습니다.'}
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-2">
        <h2 className="text-base font-bold text-[var(--foreground)]">{tt('운영 정보')}</h2>
        <div className="text-sm text-[var(--muted)] space-y-1">
          <p>{tt('서비스명')}: Routinist</p>
          <p>{tt('운영사')}: {locale === 'en' ? 'OpenHan Inc.' : '(주)오픈한'}</p>
          <p>{tt('이메일')}: routinist@openhan.kr</p>
        </div>
      </div>
    </div>
  );
}
