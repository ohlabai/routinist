'use client';

// 취소·환불 정책 — 전자상거래법 제17조 (청약철회) 기반.

import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { BUSINESS_INFO } from '@/lib/business-info';

export default function RefundPolicyPage() {
  const b = BUSINESS_INFO;
  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <Link href="/shop" className="p-1 active:scale-90"><ArrowLeft size={24} /></Link>
        <h1 className="text-xl font-bold flex-1">취소·환불 정책</h1>
      </div>

      <div className="px-4 space-y-4">
        {/* 한 줄 요약 */}
        <div className="card p-4 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40">
          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mb-1">📋 한 줄 요약</p>
          <p className="text-sm text-[var(--foreground)]">
            상품 수령 후 <b>7일 이내 무상 청약철회</b> 가능. 단, 사용/훼손/주문제작 상품 등은 제한됩니다.
          </p>
        </div>

        {/* 청약철회 가능 기간 */}
        <Card title="청약철회 가능 기간" icon={<CheckCircle size={18} className="text-emerald-500" />}>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>상품 수령 후 <b>7일 이내</b></li>
            <li>표시·광고 내용과 상이하거나 약속과 다르게 이행된 경우 <b>3개월 이내</b>, 그 사실을 안 날부터 30일 이내</li>
          </ul>
        </Card>

        {/* 청약철회가 제한되는 경우 */}
        <Card title="청약철회가 제한되는 경우" icon={<AlertTriangle size={18} className="text-amber-500" />}>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>이용자에게 책임 있는 사유로 재화가 멸실 또는 훼손된 경우 (단, 내용 확인을 위한 포장 훼손 제외)</li>
            <li>이용자의 사용 또는 일부 소비로 재화의 가치가 현저히 감소한 경우</li>
            <li>시간의 경과에 의하여 재판매가 곤란할 정도로 가치가 감소한 경우</li>
            <li>같은 성능을 가진 복제 가능한 재화의 포장을 훼손한 경우</li>
            <li>주문 제작 또는 개별 맞춤 상품 (사전 고지된 경우)</li>
            <li>마일리지로 결제된 분에 대해 — 차감된 마일리지는 환원되며, 카드 결제 분만 환불</li>
          </ul>
        </Card>

        {/* 환불 처리 절차 */}
        <Card title="환불 처리 절차" icon={<RefreshCw size={18} className="text-blue-500" />}>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>주문 내역에서 <b>주문 취소</b> 버튼 또는 고객센터({b.email})로 환불 신청</li>
            <li>회사가 환불 요건 확인 (상품 수령 / 훼손 여부 / 사유)</li>
            <li>요건 충족 시 결제 수단별로 환불 진행:
              <ul className="list-disc pl-5 mt-1">
                <li>신용카드: 카드사 통한 결제 취소 (영업일 기준 3-7일 소요)</li>
                <li>간편결제: 결제 PG사 통한 환불 (영업일 기준 3-5일)</li>
                <li>마일리지: 즉시 환원</li>
              </ul>
            </li>
            <li>환불 완료 시 이메일 또는 앱 알림으로 통지</li>
          </ol>
        </Card>

        {/* 반품 비용 */}
        <Card title="반품 비용 부담">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><b>단순 변심</b>: 반품 배송비는 이용자 부담</li>
            <li><b>상품 하자·표시광고와 다른 경우</b>: 반품 배송비는 회사 부담</li>
            <li>일부 환불 시 무료 배송 조건이 깨지면 정상 배송비 차감 후 환불</li>
          </ul>
        </Card>

        {/* 교환 */}
        <Card title="교환">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>동일 상품 다른 옵션(사이즈/색상)으로 교환 가능 — 수령 후 7일 이내</li>
            <li>재고 소진 시 환불로 처리</li>
            <li>교환 배송비 정책은 위 &lsquo;반품 비용 부담&rsquo;과 동일</li>
          </ul>
        </Card>

        {/* 미수령·배송지연 */}
        <Card title="배송 지연 / 미수령">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>발송 후 14일 이상 미수령 시 회사로 즉시 연락</li>
            <li>회사 귀책 사유로 인한 지연 시 전액 환불 또는 보상</li>
            <li>이용자 부재 등 본인 사유로 인한 반송은 재배송비 부담 후 재발송</li>
          </ul>
        </Card>

        {/* 문의 */}
        <div className="card p-4">
          <p className="text-sm font-bold text-[var(--foreground)] mb-2">📮 환불 문의</p>
          <p className="text-sm text-[var(--muted)]">
            이메일: <a href={`mailto:${b.email}`} className="text-[var(--accent)] underline">{b.email}</a>
            <br />
            전화: <a href={`tel:${b.phone.replace(/-/g, '')}`} className="text-[var(--accent)] underline">{b.phone}</a>
            <br />
            평일 10:00 - 18:00 (점심시간 12:00 - 13:00, 주말·공휴일 휴무)
          </p>
        </div>

        <p className="text-xs text-[var(--muted)] pt-2 pb-4">
          본 정책은 전자상거래 등에서의 소비자보호에 관한 법률 제17조 및 관련 시행령에 따라 작성되었습니다.
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
