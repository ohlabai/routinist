// 쇼핑몰 페이지 공통 푸터 — 전자상거래법 표시.
// 모든 결제 진입 페이지 (cart / checkout / product / orders / order detail) 의 하단에 노출.

import Link from 'next/link';
import { BUSINESS_INFO } from '@/lib/business-info';

interface Props {
  /** 'compact' = 핵심 정보만 (cart/product 등). 'full' = 모든 정보 + 정책 링크 (checkout) */
  variant?: 'compact' | 'full';
  /** 상단 여백 추가 (sticky 액션 바 영역 회피용 padding 별도 처리) */
  withTopBorder?: boolean;
}

export default function BusinessFooter({ variant = 'compact', withTopBorder = true }: Props) {
  const b = BUSINESS_INFO;

  return (
    <footer
      className={`px-4 py-5 text-[13px] leading-relaxed text-[var(--muted)] ${
        withTopBorder ? 'border-t border-[var(--card-border)]' : ''
      }`}
    >
      <div className="space-y-1">
        <p className="text-[var(--foreground)] font-semibold">{b.brandName}</p>
        <p>
          상호: {b.companyName} · 사업자등록번호: {b.businessNumber}{' '}
          <a
            href={b.businessLookupUrl}
            target="_blank"
            rel="noreferrer"
            className="underline text-[var(--accent)]"
          >
            [정보확인]
          </a>
        </p>
        <p>통신판매업 신고: {b.ecommerceNumber}</p>
        {!b.ceoName.startsWith('TODO_') && <p>대표: {b.ceoName}</p>}
        {!b.address.startsWith('TODO_') && <p>주소: {b.address}</p>}
        <p>대표전화: {b.phone} · 이메일: {b.email}</p>
        {variant === 'full' && (
          <>
            <p>개인정보 보호책임자: {b.privacyOfficer} ({b.privacyOfficerEmail})</p>
            <p>호스팅: {b.hostProvider}</p>
          </>
        )}
      </div>

      <nav className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
        <Link href="/shop/info" className="text-[var(--accent)] hover:underline">사업자 정보</Link>
        <Link href="/shop/terms" className="text-[var(--accent)] hover:underline">이용약관</Link>
        <Link href="/shop/refund" className="text-[var(--accent)] hover:underline">취소·환불 정책</Link>
        <Link href="/shop/dispute" className="text-[var(--accent)] hover:underline">분쟁해결</Link>
        <Link href="/privacy" className="text-[var(--accent)] hover:underline">개인정보처리방침</Link>
      </nav>

      <p className="mt-4 text-[12px] text-[var(--muted)]/70">
        © {new Date().getFullYear()} {b.companyName}. All rights reserved.
      </p>
    </footer>
  );
}
