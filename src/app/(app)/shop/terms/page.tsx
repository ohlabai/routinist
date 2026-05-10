'use client';

// 쇼핑몰 이용약관 — 표준약관 (공정거래위원회 제10023호) 기반 + 자체 조항.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BUSINESS_INFO } from '@/lib/business-info';

export default function ShopTermsPage() {
  const b = BUSINESS_INFO;
  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <Link href="/shop" className="p-1 active:scale-90"><ArrowLeft size={24} /></Link>
        <h1 className="text-xl font-bold flex-1">쇼핑몰 이용약관</h1>
      </div>

      <article className="px-4 prose prose-sm max-w-none text-[var(--foreground)] space-y-4">
        <p className="text-xs text-[var(--muted)]">
          시행일: 2026-05-10 · {b.companyName} ({b.brandName})
        </p>

        <Section n="1" title="목적">
          이 약관은 {b.companyName}(이하 &lsquo;회사&rsquo;)가 운영하는 {b.brandName} 쇼핑몰(이하 &lsquo;몰&rsquo;)에서 제공하는
          전자상거래 관련 서비스(이하 &lsquo;서비스&rsquo;)를 이용함에 있어 회사와 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
        </Section>

        <Section n="2" title="정의">
          <ul className="list-disc pl-5 space-y-1">
            <li>&lsquo;몰&rsquo;: {b.companyName}이 재화 또는 용역을 이용자에게 제공하기 위하여 컴퓨터 등 정보통신설비를 이용하여 재화 또는 용역을 거래할 수 있도록 설정한 가상의 영업장</li>
            <li>&lsquo;이용자&rsquo;: 몰에 접속하여 이 약관에 따라 몰이 제공하는 서비스를 받는 회원 및 비회원</li>
            <li>&lsquo;회원&rsquo;: 몰에 회원등록을 한 자로서, 계속적으로 몰이 제공하는 서비스를 이용할 수 있는 자</li>
          </ul>
        </Section>

        <Section n="3" title="약관의 효력 및 변경">
          1) 이 약관은 서비스를 이용하고자 하는 모든 이용자에 대하여 그 효력을 발생합니다.<br />
          2) 회사는 관련 법령을 위배하지 않는 범위에서 약관을 개정할 수 있으며, 변경사항은 적용일 7일 전부터 공지합니다.
          이용자에게 불리한 변경의 경우 30일 전부터 공지합니다.
        </Section>

        <Section n="4" title="회원가입">
          1) 이용자는 몰이 정한 가입 양식에 정보를 기입하고 약관에 동의하여 회원가입을 신청합니다.<br />
          2) 회사는 다음 각 호에 해당하지 않는 한 회원으로 등록합니다:
          <ul className="list-disc pl-5 mt-1">
            <li>가입신청자가 이전에 회원자격을 상실한 적이 있는 경우</li>
            <li>등록 내용에 허위, 기재누락, 오기가 있는 경우</li>
            <li>기타 회원으로 등록하는 것이 몰의 운영을 현저히 저해한다고 판단되는 경우</li>
          </ul>
        </Section>

        <Section n="5" title="구매신청 및 계약 성립">
          1) 이용자는 몰에서 다음 절차에 의하여 구매를 신청합니다:
          <ul className="list-disc pl-5 mt-1">
            <li>재화 등의 검색 및 선택</li>
            <li>받는 사람의 성명, 주소, 전화번호 등 입력</li>
            <li>약관 내용, 청약철회권이 제한되는 서비스, 배송료·설치비 등 비용 부담 확인</li>
            <li>이 약관에 동의하고 위 사항을 확인하거나 거부하는 표시</li>
            <li>재화 등의 구매신청 및 이에 관한 확인 또는 회사의 확인에 대한 동의</li>
            <li>결제방법의 선택</li>
          </ul>
          2) 회사는 이용자의 구매신청이 있는 경우 이용자에게 수신확인 통지를 합니다.<br />
          3) 수신확인 통지 후 회사가 매매계약 체결의 의사를 통지한 시점에 계약이 성립합니다.
        </Section>

        <Section n="6" title="지급방법">
          이용자가 구매한 재화 또는 용역에 대한 대금지급방법은 다음과 같습니다:
          <ul className="list-disc pl-5 mt-1">
            <li>신용카드</li>
            <li>실시간 계좌이체</li>
            <li>간편결제 (카카오페이, 네이버페이, 토스페이 등)</li>
            <li>마일리지 결제 (회사가 발행한 마일리지에 한함)</li>
          </ul>
        </Section>

        <Section n="7" title="배송">
          1) 배송은 결제완료 확인 후 영업일 기준 1-3일 이내 발송을 원칙으로 합니다.<br />
          2) 배송 지역, 상품의 특성에 따라 추가 시일이 소요될 수 있습니다.<br />
          3) 5만원 이상 구매 시 배송비 무료, 그 미만은 3,000원의 배송비가 부과됩니다.
        </Section>

        <Section n="8" title="환불·청약철회">
          청약철회 및 환불에 대한 사항은 별도의 <Link href="/shop/refund" className="text-[var(--accent)] underline">취소·환불 정책</Link>에 따릅니다.
        </Section>

        <Section n="9" title="개인정보 보호">
          회사는 이용자의 개인정보를 수집·이용함에 있어 관련 법령에 따라 보호하며, 자세한 사항은
          <Link href="/privacy" className="text-[var(--accent)] underline mx-1">개인정보처리방침</Link>에 따릅니다.
        </Section>

        <Section n="10" title="회사의 의무">
          1) 회사는 법령과 이 약관이 금지하거나 미풍양속에 반하는 행위를 하지 않으며 이 약관이 정하는 바에 따라 지속적이고 안정적으로 재화·용역을 제공하는데 최선을 다합니다.<br />
          2) 회사는 이용자가 안전하게 인터넷 서비스를 이용할 수 있도록 이용자의 개인정보(신용정보 포함) 보호를 위한 보안 시스템을 갖추어야 합니다.
        </Section>

        <Section n="11" title="이용자의 의무">
          이용자는 다음 행위를 하여서는 안됩니다:
          <ul className="list-disc pl-5 mt-1">
            <li>신청 또는 변경 시 허위 내용의 등록</li>
            <li>타인의 정보 도용</li>
            <li>회사가 게시한 정보의 변경</li>
            <li>외설 또는 폭력적인 메시지·화상·음성, 기타 공서양속에 반하는 정보를 몰에 공개 또는 게시하는 행위</li>
            <li>회사 기타 제3자의 저작권 등 지적재산권에 대한 침해</li>
          </ul>
        </Section>

        <Section n="12" title="분쟁 해결">
          분쟁의 신속·공정 해결을 위해 회사는 별도의 <Link href="/shop/dispute" className="text-[var(--accent)] underline">분쟁해결 안내</Link>를 운영하며,
          미해결 분쟁은 소비자분쟁조정위원회의 조정을 받을 수 있습니다.
        </Section>

        <Section n="13" title="재판권 및 준거법">
          1) 회사와 이용자 간에 발생한 분쟁에 관한 소송은 제소 당시 이용자의 주소를 관할하는 법원에 제기합니다.<br />
          2) 회사와 이용자 간에 제기된 전자상거래 소송에는 한국법을 적용합니다.
        </Section>

        <p className="text-xs text-[var(--muted)] pt-6 pb-4">
          공정거래위원회 표준약관 제10023호를 참고하여 작성되었습니다.
        </p>
      </article>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-[var(--foreground)] mt-4 mb-2">제{n}조 ({title})</h2>
      <div className="text-sm text-[var(--foreground)] leading-relaxed">{children}</div>
    </section>
  );
}
