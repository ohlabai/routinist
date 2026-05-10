'use client';

// 사업자 정보 페이지 — 전자상거래법 의무 표시.
// 푸터에서 "사업자 정보" 링크로 진입.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BUSINESS_INFO } from '@/lib/business-info';

export default function BusinessInfoPage() {
  const b = BUSINESS_INFO;
  const rows: { label: string; value: string; isLink?: 'biz' | 'mail' | 'tel' }[] = [
    { label: '브랜드', value: b.brandName },
    { label: '상호', value: b.companyName },
    { label: '대표자', value: b.ceoName.startsWith('TODO_') ? '(미입력)' : b.ceoName },
    { label: '사업자등록번호', value: b.businessNumber, isLink: 'biz' },
    { label: '통신판매업 신고번호', value: b.ecommerceNumber },
    { label: '사업장 주소', value: b.address.startsWith('TODO_') ? '(미입력)' : b.address },
    { label: '대표전화', value: b.phone, isLink: 'tel' },
    { label: '이메일', value: b.email, isLink: 'mail' },
    { label: '개인정보 보호책임자', value: `${b.privacyOfficer} (${b.privacyOfficerEmail})` },
    { label: '호스팅 제공자', value: b.hostProvider },
  ];

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <Link href="/shop" className="p-1 active:scale-90"><ArrowLeft size={24} /></Link>
        <h1 className="text-xl font-bold flex-1">사업자 정보</h1>
      </div>

      <div className="px-4">
        <div className="card p-5">
          <p className="text-xs text-[var(--muted)] mb-3">전자상거래등에서의 소비자보호에 관한 법률 제13조에 따라 의무 표시</p>
          <dl className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[120px_1fr] gap-2 text-sm border-b border-[var(--card-border)]/50 pb-3 last:border-0 last:pb-0">
                <dt className="text-[var(--muted)] font-medium">{r.label}</dt>
                <dd className="text-[var(--foreground)] break-keep">
                  {r.isLink === 'biz' ? (
                    <>
                      {r.value}{' '}
                      <a
                        href={b.businessLookupUrl}
                        target="_blank" rel="noreferrer"
                        className="text-[var(--accent)] underline text-xs ml-1"
                      >
                        [공정위 정보확인]
                      </a>
                    </>
                  ) : r.isLink === 'tel' ? (
                    <a href={`tel:${r.value.replace(/-/g, '')}`} className="text-[var(--accent)]">{r.value}</a>
                  ) : r.isLink === 'mail' ? (
                    <a href={`mailto:${r.value}`} className="text-[var(--accent)]">{r.value}</a>
                  ) : (
                    r.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-4 text-xs text-[var(--muted)] space-y-2">
          <p>· 사업자등록증 사본은 요청 시 이메일로 송부해드립니다.</p>
          <p>· 본 사이트의 상품 거래 정보는 회사가 직접 제공하며, 거래에 대한 책임은 회사에 있습니다.</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <Link href="/shop/terms" className="card p-3 text-center text-sm font-semibold text-[var(--accent)]">이용약관</Link>
          <Link href="/shop/refund" className="card p-3 text-center text-sm font-semibold text-[var(--accent)]">취소·환불 정책</Link>
          <Link href="/shop/dispute" className="card p-3 text-center text-sm font-semibold text-[var(--accent)]">분쟁해결</Link>
          <Link href="/privacy" className="card p-3 text-center text-sm font-semibold text-[var(--accent)]">개인정보처리방침</Link>
        </div>
      </div>
    </div>
  );
}
