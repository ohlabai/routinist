'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SupportPage() {
  const router = useRouter();

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[var(--card-border)] transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-[var(--foreground)]">고객 지원</h1>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-base font-bold text-[var(--foreground)]">앱 소개</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Routinist는 나만의 러닝 기록을 관리하고, 목표 달성을 추적하며, 함께 달리는 즐거움을 나누는 앱입니다.
          Apple HealthKit 및 Google Health Connect와 연동하여 자동으로 러닝 데이터를 동기화합니다.
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-base font-bold text-[var(--foreground)]">문의하기</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          앱 사용 중 문제가 발생하거나 문의사항이 있으시면 아래 이메일로 연락해 주세요.
        </p>
        <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--accent)]/5 border border-[var(--accent)]/20">
          <span className="text-2xl">&#9993;</span>
          <div>
            <p className="text-xs text-[var(--muted)]">이메일</p>
            <a href="mailto:hans@openhan.kr" className="text-[var(--accent)] font-semibold">hans@openhan.kr</a>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-base font-bold text-[var(--foreground)]">자주 묻는 질문</h2>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">러닝 기록이 자동으로 동기화되지 않아요</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              설정 &gt; 건강 &gt; 데이터 접근 및 기기에서 Routinist의 권한을 확인해 주세요.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">목표는 어떻게 설정하나요?</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              내 정보 &gt; 목표 설정에서 월간 러닝 거리 목표를 설정할 수 있습니다.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">회원 탈퇴는 어떻게 하나요?</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              내 정보 화면 하단의 <span className="font-semibold text-[var(--foreground)]">계정 탈퇴</span> 버튼을 눌러주세요.
              탈퇴 즉시 모든 데이터가 영구 삭제되며 복구할 수 없습니다.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">앱에서 수집하는 데이터는 무엇인가요?</h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              러닝 거리, 시간 등 건강 앱에서 제공하는 운동 데이터만 수집합니다. 제3자에게 제공되지 않습니다.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-2">
        <h2 className="text-base font-bold text-[var(--foreground)]">운영 정보</h2>
        <div className="text-sm text-[var(--muted)] space-y-1">
          <p>서비스명: Routinist</p>
          <p>이메일: hans@openhan.kr</p>
        </div>
      </div>
    </div>
  );
}
