'use client';

// 분쟁해결 안내 — 소비자분쟁조정위원회, 한국소비자원, 전자상거래분쟁조정위원회 등.

import Link from 'next/link';
import { ArrowLeft, Scale, Phone, Globe } from 'lucide-react';
import { BUSINESS_INFO } from '@/lib/business-info';

export default function DisputePage() {
  const b = BUSINESS_INFO;
  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <Link href="/shop" className="p-1 active:scale-90"><ArrowLeft size={24} /></Link>
        <h1 className="text-xl font-bold flex-1">분쟁해결 안내</h1>
      </div>

      <div className="px-4 space-y-4">
        <div className="card p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40">
          <p className="text-sm font-bold text-blue-700 dark:text-blue-300 mb-1">⚖️ 분쟁이 발생한 경우</p>
          <p className="text-sm text-[var(--foreground)]">
            먼저 회사 고객센터({b.email})에 연락 부탁드립니다. <br />
            원만한 해결이 어려운 경우 아래 외부 분쟁조정 기관을 이용하실 수 있습니다.
          </p>
        </div>

        {/* 1단계: 회사 직접 */}
        <Card title="1단계 — 회사 고객센터" icon={<Phone size={18} className="text-emerald-500" />}>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>이메일: <a href={`mailto:${b.email}`} className="text-[var(--accent)] underline">{b.email}</a></li>
            <li>전화: <a href={`tel:${b.phone.replace(/-/g, '')}`} className="text-[var(--accent)] underline">{b.phone}</a></li>
            <li>운영 시간: 평일 10:00 - 18:00 (점심 12:00-13:00 제외)</li>
            <li>3영업일 이내 답변 드림을 원칙으로 합니다.</li>
          </ul>
        </Card>

        {/* 2단계: 외부 분쟁조정 */}
        <Card title="2단계 — 외부 분쟁조정 기관" icon={<Scale size={18} className="text-amber-500" />}>
          <p className="text-sm text-[var(--muted)] mb-3">
            회사와 원만한 합의가 어려운 경우 다음 기관에 분쟁조정을 신청하실 수 있습니다.
          </p>
          <div className="space-y-3 text-sm">
            <Org
              name="한국소비자원"
              desc="소비자 피해 구제 및 분쟁조정"
              tel="국번없이 1372"
              urls={[{ label: 'kca.go.kr', href: 'https://www.kca.go.kr' }]}
            />
            <Org
              name="전자거래분쟁조정위원회"
              desc="전자상거래 분쟁 (제품 미배송·가품·과대광고 등)"
              tel="1661-5714"
              urls={[{ label: 'ecmc.or.kr', href: 'https://www.ecmc.or.kr' }]}
            />
            <Org
              name="개인정보분쟁조정위원회"
              desc="개인정보 관련 분쟁"
              tel="1833-6972"
              urls={[{ label: 'kopico.go.kr', href: 'https://www.kopico.go.kr' }]}
            />
            <Org
              name="공정거래위원회"
              desc="사업자 등록 및 거래 관련 신고"
              tel="국번없이 1357"
              urls={[
                { label: 'ftc.go.kr', href: 'https://www.ftc.go.kr' },
                { label: '사업자정보 확인', href: b.businessLookupUrl },
              ]}
            />
          </div>
        </Card>

        {/* 3단계: 법적 절차 */}
        <Card title="3단계 — 소송 절차" icon={<Globe size={18} className="text-zinc-500" />}>
          <p className="text-sm text-[var(--muted)]">
            모든 분쟁조정 절차로도 해결되지 않는 경우, 민사소송을 제기하실 수 있습니다.
            소송은 제소 당시 이용자의 주소를 관할하는 법원에 제기합니다 (전자상거래법 제36조).
          </p>
        </Card>

        {/* 처리 절차 */}
        <Card title="회사의 처리 절차">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>이용자 신고 접수 (이메일/전화)</li>
            <li>3영업일 이내 사실 확인 및 1차 답변</li>
            <li>처리에 시간이 필요한 경우 진행 상황 안내 (7영업일 이내)</li>
            <li>처리 결과 통지 — 이메일 또는 전화</li>
            <li>분쟁이 미해결 시 외부 조정 기관 안내</li>
          </ol>
        </Card>

        <p className="text-xs text-[var(--muted)] pt-2 pb-4">
          본 안내는 전자상거래 등에서의 소비자보호에 관한 법률 제20조 및 시행령에 따릅니다.
        </p>
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="text-sm font-bold text-[var(--foreground)] mb-2 flex items-center gap-1.5">
        {icon} {title}
      </h2>
      <div className="text-[var(--foreground)]">{children}</div>
    </div>
  );
}

function Org({ name, desc, tel, urls }: { name: string; desc: string; tel: string; urls: { label: string; href: string }[] }) {
  return (
    <div className="border border-[var(--card-border)] rounded-lg p-3">
      <p className="font-semibold text-[var(--foreground)]">{name}</p>
      <p className="text-xs text-[var(--muted)] mt-0.5">{desc}</p>
      <p className="text-xs mt-1">📞 {tel}</p>
      <p className="text-xs mt-0.5">
        🌐 {urls.map((u, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            <a href={u.href} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">{u.label}</a>
          </span>
        ))}
      </p>
    </div>
  );
}
