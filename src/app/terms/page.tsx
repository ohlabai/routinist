'use client';

// 이용약관 — Apple 가입 흐름 + ToS 표준 요구. 로그인 체크 없이 누구나 접근.

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

const SECTIONS_KO: { title: string; items: string[] }[] = [
  { title: '제1조 (목적)', items: [
    '본 약관은 Routinist(이하 "서비스")가 제공하는 러닝 기록·분석·소셜·쇼핑 서비스의 이용 조건과 책임 사항을 규정합니다.',
  ]},
  { title: '제2조 (가입)', items: [
    '14세 이상 누구나 이메일/Apple/Google/Kakao 계정으로 가입할 수 있습니다.',
    '가입 시 본 약관과 개인정보처리방침에 동의하는 것으로 간주됩니다.',
  ]},
  { title: '제3조 (서비스 내용)', items: [
    'Apple Health/Health Connect 연동을 통한 러닝 기록 자동 수집',
    'GPS 트래킹, 통계·분석, 지역·연령 기반 랭킹',
    '친구/클럽/쪽지 등 소셜 기능, 러닝사진 공유',
    '마일리지 적립 및 외부 쇼핑(routinist.kr) 연동',
  ]},
  { title: '제4조 (사용자의 의무)', items: [
    '본인이 직접 달린 기록만 업로드해야 하며, 조작·도용은 금지됩니다.',
    '타인을 비방·괴롭히거나 부적절한 콘텐츠를 게시할 수 없습니다.',
    '서비스를 영리 목적의 광고/스팸에 사용할 수 없습니다.',
    '비밀번호와 계정 보안은 사용자가 직접 관리해야 합니다.',
  ]},
  { title: '제5조 (콘텐츠 신고 및 제재 — 무관용 원칙)', items: [
    'Routinist 는 불쾌감을 주는 콘텐츠와 악성 사용자에 대해 무관용(zero tolerance) 원칙을 적용합니다.',
    '부적절한 콘텐츠는 앱 내 신고 기능으로 알릴 수 있으며, 운영팀이 24시간 안에 검토하여 해당 콘텐츠를 삭제하고 게시자를 제재합니다.',
    '욕설·성적·혐오 콘텐츠, 괴롭힘 등 약관 위반 시 사전 경고 없이 콘텐츠 삭제 및 계정 영구 정지(추방)될 수 있습니다.',
    '다른 사용자를 차단하면 그 사용자의 콘텐츠가 내 피드에서 즉시 사라지며, 차단 사실은 운영팀에 자동 접수됩니다.',
  ]},
  { title: '제6조 (마일리지)', items: [
    '마일리지는 러닝 거리(1km = 10P)에 따라 자동 적립되며 현금 환불은 되지 않습니다.',
    '마일리지는 routinist.kr 쇼핑에서 결제 시 사용할 수 있습니다.',
    '회원 탈퇴 시 보유한 마일리지는 모두 소멸됩니다.',
  ]},
  { title: '제7조 (회원 탈퇴)', items: [
    '사용자는 앱 내 "내 정보 → 회원 탈퇴" 메뉴에서 언제든 계정을 영구 탈퇴할 수 있습니다.',
    '탈퇴 시 러닝 기록·사진·친구·마일리지 등 모든 데이터가 즉시 영구 삭제되며 복구되지 않습니다.',
  ]},
  { title: '제8조 (책임의 제한)', items: [
    '서비스는 무료로 제공되며, GPS·HealthKit 등 외부 시스템 오류로 인한 손해에는 책임지지 않습니다.',
    '러닝은 사용자 본인의 건강 상태를 고려하여 안전하게 진행해주세요.',
  ]},
  { title: '제9조 (분쟁 해결)', items: [
    '본 약관에 관한 분쟁은 대한민국 법령을 따르며, 서울중앙지방법원을 1심 관할로 합니다.',
  ]},
  { title: '제10조 (문의)', items: [
    '약관 관련 문의: routinist@openhan.kr',
    '개인정보 관련 문의: 앱 내 "내 정보 → 개인정보처리방침" 참고',
    '운영사: (주)오픈한',
  ]},
];

const SECTIONS_EN: { title: string; items: string[] }[] = [
  { title: 'Article 1 (Purpose)', items: [
    'These Terms govern the conditions and responsibilities for use of the running record, analytics, social, and shopping services provided by Routinist (the "Service").',
  ]},
  { title: 'Article 2 (Account Registration)', items: [
    'Anyone aged 14 or older may register with an Email / Apple / Google / Kakao account.',
    'By registering, you are deemed to agree to these Terms and the Privacy Policy.',
  ]},
  { title: 'Article 3 (Service Content)', items: [
    'Automatic running record collection via Apple Health / Health Connect integration',
    'GPS tracking, statistics and analytics, and regional / age-based ranking',
    'Social features such as friends, clubs, direct messages, and run photo sharing',
    'Mileage accrual and external shopping integration (routinist.kr)',
  ]},
  { title: 'Article 4 (User Obligations)', items: [
    'You must upload only your own runs; manipulation or impersonation is prohibited.',
    'Defaming, harassing others, or posting inappropriate content is prohibited.',
    'You may not use the Service for commercial advertising or spam.',
    'You are responsible for managing your password and account security.',
  ]},
  { title: 'Article 5 (Content Reports and Sanctions — Zero Tolerance)', items: [
    'Routinist applies a zero-tolerance policy toward objectionable content and abusive users.',
    'Inappropriate content can be reported via the in-app report feature; the operations team reviews within 24 hours, removes the content, and sanctions the poster.',
    'Profanity, sexual or hateful content, and harassment may result in immediate content removal and permanent account suspension (ejection) without prior warning.',
    'Blocking another user instantly removes their content from your feed, and the block is automatically reported to the operations team.',
  ]},
  { title: 'Article 6 (Mileage)', items: [
    'Mileage is auto-credited based on running distance (1km = 10P) and is not refundable to cash.',
    'Mileage may be used at checkout on routinist.kr shopping.',
    'On account deletion, all held mileage is forfeited.',
  ]},
  { title: 'Article 7 (Account Deletion)', items: [
    'You may permanently delete your account at any time via Profile → Delete Account.',
    'Upon deletion, all data including running records, photos, friends, and mileage is immediately and permanently deleted and cannot be recovered.',
  ]},
  { title: 'Article 8 (Limitation of Liability)', items: [
    'The Service is provided free of charge; we are not liable for damages caused by external system errors such as GPS or HealthKit.',
    'Please run safely considering your own health condition.',
  ]},
  { title: 'Article 9 (Dispute Resolution)', items: [
    'Disputes regarding these Terms are governed by the laws of the Republic of Korea, with the Seoul Central District Court as the court of first instance.',
  ]},
  { title: 'Article 10 (Contact)', items: [
    'Terms inquiries: routinist@openhan.kr',
    'Privacy inquiries: see Profile → Privacy Policy in the app',
    'Operator: OpenHan Inc.',
  ]},
];

export default function TermsPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const isEn = locale === 'en';
  const sections = isEn ? SECTIONS_EN : SECTIONS_KO;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6 pb-8">
        <div className="flex items-center gap-3 pt-[env(safe-area-inset-top)]">
          <button
            onClick={() => { if (window.history.length > 1) router.back(); else router.push('/login'); }}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors"
            aria-label={isEn ? 'Back' : '뒤로가기'}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-[var(--foreground)]">{isEn ? 'Terms of Service' : '이용약관'}</h1>
        </div>

        <p className="text-xs text-[var(--muted)]">{isEn ? 'Effective date: May 10, 2026' : '시행일: 2026년 5월 10일'}</p>

        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.title} className="card p-5">
              <h2 className="text-base font-bold text-[var(--foreground)] mb-3">{section.title}</h2>
              <ul className="space-y-2">
                {section.items.map((item, i) => (
                  <li key={i} className="text-sm text-[var(--muted)] leading-relaxed flex gap-2">
                    <span className="text-emerald-500 flex-shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-[var(--muted)]">
          {isEn
            ? 'Routinist · These Terms may be updated without prior notice.'
            : 'Routinist · 본 약관은 사전 공지 없이 변경될 수 있습니다.'}
        </p>
      </div>
    </div>
  );
}
