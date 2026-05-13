'use client';

// 이용약관 — Apple 가입 흐름 + ToS 표준 요구. 로그인 체크 없이 누구나 접근.

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function TermsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6 pb-8">
        <div className="flex items-center gap-3 pt-[env(safe-area-inset-top)]">
          <button
            onClick={() => { if (window.history.length > 1) router.back(); else router.push('/login'); }}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors"
            aria-label="뒤로가기"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-[var(--foreground)]">이용약관</h1>
        </div>

        <p className="text-xs text-[var(--muted)]">시행일: 2026년 5월 10일</p>

        <div className="space-y-5">
          {[
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
              '친구/클럽/쪽지 등 소셜 기능, 루틴포토 공유',
              '마일리지 적립 및 외부 쇼핑(routinist.kr) 연동',
            ]},
            { title: '제4조 (사용자의 의무)', items: [
              '본인이 직접 달린 기록만 업로드해야 하며, 조작·도용은 금지됩니다.',
              '타인을 비방·괴롭히거나 부적절한 콘텐츠를 게시할 수 없습니다.',
              '서비스를 영리 목적의 광고/스팸에 사용할 수 없습니다.',
              '비밀번호와 계정 보안은 사용자가 직접 관리해야 합니다.',
            ]},
            { title: '제5조 (콘텐츠 신고 및 제재)', items: [
              '부적절한 콘텐츠는 앱 내 신고 기능으로 알릴 수 있으며, 운영팀이 24시간 안에 검토·조치합니다.',
              '신고 누적, 약관 위반 시 콘텐츠 삭제 또는 계정 이용이 제한될 수 있습니다.',
            ]},
            { title: '제6조 (마일리지)', items: [
              '마일리지는 러닝 거리(1km = 10P)에 따라 자동 적립되며 현금 환불은 되지 않습니다.',
              '마일리지는 routinist.kr 쇼핑에서 결제 시 사용할 수 있습니다.',
              '계정 탈퇴 시 보유한 마일리지는 모두 소멸됩니다.',
            ]},
            { title: '제7조 (계정 탈퇴)', items: [
              '사용자는 앱 내 "내 정보 → 계정 탈퇴" 메뉴에서 언제든 계정을 영구 탈퇴할 수 있습니다.',
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
          ].map((section) => (
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

        <p className="text-center text-xs text-[var(--muted)]">Routinist · 본 약관은 사전 공지 없이 변경될 수 있습니다.</p>
      </div>
    </div>
  );
}
