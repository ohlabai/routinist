'use client';

// 로그인 체크 없이 누구나 접근 가능한 개인정보처리방침. (app)/privacy 와 동일 본문.
// 로그인 페이지/회원가입 링크에서 열릴 때 인증 리다이렉트에 걸리지 않도록 별도 라우트로 분리.

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function PrivacyPage() {
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
          <h1 className="text-xl font-bold text-[var(--foreground)]">개인정보처리방침</h1>
        </div>

        <p className="text-xs text-[var(--muted)]">시행일: 2026년 4월 13일</p>

        <div className="space-y-5">
          {[
            { title: '1. 수집하는 정보', items: [
              '계정 정보: 이메일, 닉네임, 프로필 사진',
              '러닝 기록: 거리, 시간, 날짜, GPS 경로 데이터',
              '건강 데이터: Apple Health / Health Connect를 통한 운동 데이터 (사용자 동의 시에만)',
              '위치 정보: GPS 트래킹 시 실시간 위치, 지역 랭킹을 위한 거주 지역(구)',
              '소셜 정보: 친구 관계, 클럽 가입 정보, 댓글, 쪽지 내용',
              '거래 정보: 마일리지 적립/사용 내역, 쇼핑 주문 내역, 배송 정보',
            ]},
            { title: '2. 정보의 사용 목적', items: [
              '러닝 기록 관리 및 통계 제공',
              '지역별 랭킹 및 클럽 리더보드 제공',
              '지도 위 러닝 경로 및 히트맵 표시',
              '사용자 간 소셜 기능 (친구 추가, 댓글, 응원, 쪽지)',
              '마일리지 적립 및 쇼핑 서비스 제공',
              '서비스 개선 및 개인화',
            ]},
            { title: '3. 정보의 공유', items: [
              '공개 프로필: 닉네임, 프로필 사진, 통산 기록은 다른 사용자에게 공개될 수 있습니다',
              '클럽 멤버에게 러닝 거리 및 순위가 공유됩니다',
              '활동별 공개 범위를 설정할 수 있습니다 (전체공개/친구/클럽/비공개)',
              '쪽지는 발신자와 수신자만 확인할 수 있습니다',
              '제3자에게 개인정보를 판매하거나 제공하지 않습니다',
            ]},
            { title: '4. 건강 데이터', items: [
              'Apple Health / Health Connect를 통해 읽는 데이터: 운동 세션, 이동 거리',
              '건강 데이터는 러닝 기록 동기화 목적으로만 사용됩니다',
              '건강 데이터는 제3자와 공유되지 않습니다',
              '사용자가 언제든지 접근 권한을 철회할 수 있습니다',
            ]},
            { title: '5. 위치 정보', items: [
              'GPS 트래킹 시 실시간 위치 정보를 수집합니다',
              '위치 데이터는 러닝 경로 기록 및 지도 표시에 사용됩니다',
              '프라이버시 존을 설정하여 자택 근처 경로를 숨길 수 있습니다',
              '위치 정보 수집은 앱 설정에서 비활성화할 수 있습니다',
            ]},
            { title: '6. 마일리지 및 결제', items: [
              '마일리지는 러닝 거리에 따라 자동 적립됩니다 (1km = 10P)',
              '마일리지 거래 내역은 투명하게 기록되며 사용자가 조회할 수 있습니다',
              '결제 정보는 PG사를 통해 안전하게 처리되며, 카드 정보는 당사 서버에 저장되지 않습니다',
            ]},
            { title: '7. 사용자 차단 및 신고', items: [
              '원치 않는 사용자를 차단하여 쪽지 및 친구 관계를 제한할 수 있습니다',
              '부적절한 콘텐츠나 행위를 신고할 수 있습니다',
            ]},
            { title: '8. 데이터 보관 및 삭제', items: [
              '데이터는 클라우드에 암호화되어 안전하게 저장됩니다',
              '사용자 요청 시 30일 이내에 모든 데이터를 삭제합니다',
              '계정 삭제 시 러닝 기록, 프로필, 쪽지 등 모든 데이터가 삭제됩니다',
            ]},
            { title: '9. 연락처', items: [
              '개인정보 관련 문의: hans@openhan.kr',
              '운영사: OPENHAN',
            ]},
          ].map(section => (
            <div key={section.title} className="card p-5 space-y-2">
              <h2 className="text-sm font-bold text-[var(--foreground)]">{section.title}</h2>
              <div className="space-y-1">
                {section.items.map((item, i) => (
                  <p key={i} className="text-sm text-[var(--muted)] leading-relaxed">• {item}</p>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-[var(--muted)] pt-4">
          &copy; {new Date().getFullYear()} Routinist. All rights reserved.
        </p>
      </div>
    </div>
  );
}
