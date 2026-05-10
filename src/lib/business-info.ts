// 전자상거래법 의무 표시 사업자 정보 — 단일 진실의 원천.
//
// 사업자 정보 변경 시 이 파일만 수정. 푸터/주문상세/info 페이지 등 모두 자동 반영.
//
// 필수 항목 (전자상거래등에서의 소비자보호에 관한 법률 제13조):
//   1. 상호 (사업자명)
//   2. 대표자 성명
//   3. 사업장 소재지 (주소)
//   4. 사업자등록번호
//   5. 통신판매업 신고번호
//   6. 연락처 (전화번호, 이메일)
//   7. 호스팅서비스 제공자 (선택)
//   8. 결제 / 배송 / 환불 정책 표시
//
// 데이터 출처: routinist.kr (Cafe24 운영) 푸터 사업자 정보 (2026-05-10 추출).
// 'TODO_' 접두사가 남아있는 값은 Cafe24 에도 미입력 — 사용자 확인 후 채워야 정상 컴플라이언스.

export interface BusinessInfo {
  /** 브랜드명 (UI 노출용 — 사업자등록증의 법적 상호와 다를 수 있음) */
  brandName: string;
  /** 법적 상호 (사업자등록증 기재) */
  companyName: string;
  /** 대표자 성명 (개인) */
  ceoName: string;
  /** 사업자등록번호 */
  businessNumber: string;
  /** 통신판매업 신고번호 */
  ecommerceNumber: string;
  /** 사업장 주소 */
  address: string;
  /** 대표 전화 */
  phone: string;
  /** 대표 이메일 */
  email: string;
  /** 호스팅 / 인프라 제공자 */
  hostProvider: string;
  /** 개인정보 보호책임자 */
  privacyOfficer: string;
  /** 개인정보 보호책임자 이메일 */
  privacyOfficerEmail: string;
  /** 사업자정보 공개 조회 URL (공정위 wrkr_no 자동 입력) */
  businessLookupUrl: string;
}

const BIZ_NUM = '204-86-22070';

export const BUSINESS_INFO: BusinessInfo = {
  brandName: '루티니스트',
  companyName: '(주)오픈한',
  ceoName: 'TODO_CEO_NAME',                        // ⚠️ 사용자 입력 필요
  businessNumber: BIZ_NUM,
  ecommerceNumber: '제 2025-서울강남-02917 호',
  address: 'TODO_ADDRESS',                         // ⚠️ 사용자 입력 필요 (서울 강남구 ...)
  phone: '070-5014-2225',
  email: 'routinist@openhan.kr',
  hostProvider: 'Vercel Inc., Cloudflare Inc., Cafe24 Corp.',
  privacyOfficer: '안윤정',
  privacyOfficerEmail: 'routinist@openhan.kr',
  businessLookupUrl: `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${BIZ_NUM.replace(/-/g, '')}`,
};

/** placeholder 미입력 항목이 있으면 true (콘솔 경고용) */
export function hasPlaceholders(): boolean {
  return Object.values(BUSINESS_INFO).some(v => typeof v === 'string' && v.startsWith('TODO_'));
}
