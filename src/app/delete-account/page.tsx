// Google Play 데이터 보안 요건: 계정 삭제 요청 공개 페이지 (로그인 불필요).
// 요건 — 앱 이름 명시 / 삭제 절차 안내 / 삭제·보관 데이터 유형과 기간 명시.
export const metadata = { title: '계정 삭제 안내 — 달리기 습관, 루티니스트' };

export default function DeleteAccountPage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', fontFamily: '-apple-system, sans-serif', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>계정 삭제 안내</h1>
      <p style={{ color: '#555' }}>달리기 습관, 루티니스트 (Routinist) — (주)오픈한</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 32 }}>앱에서 직접 삭제 (즉시)</h2>
      <ol>
        <li>앱 실행 → 하단 <b>내 정보</b> 탭</li>
        <li>화면 맨 아래 <b>계정 탈퇴</b> 선택</li>
        <li>안내 확인 후 &quot;탈퇴&quot; 입력 → 확인</li>
      </ol>
      <p>탈퇴 즉시 계정과 모든 데이터가 영구 삭제됩니다.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 32 }}>이메일로 요청</h2>
      <p>
        앱에 접근할 수 없는 경우 가입 이메일로{' '}
        <a href="mailto:routinist@openhan.kr">routinist@openhan.kr</a> 에 &quot;계정 삭제 요청&quot; 을
        보내주세요. 본인 확인 후 3영업일 이내 처리됩니다.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 32 }}>삭제되는 데이터</h2>
      <p>
        계정 정보 (이메일·닉네임·프로필), 러닝 기록·경로, 사진·댓글·쪽지, 마일리지 등
        모든 사용자 데이터가 영구 삭제되며 복구할 수 없습니다.
      </p>
      <p>
        단, 전자상거래법에 따라 상품 주문·결제 기록은 관련 법정 기간 (5년) 동안 별도
        보관 후 파기됩니다.
      </p>

      <hr style={{ margin: '32px 0', border: 'none', borderTop: '1px solid #ddd' }} />
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Delete your account (English)</h2>
      <p>
        In the Routinist app: <b>My Info</b> tab → <b>Delete account</b> at the bottom → confirm.
        Deletion is immediate and permanent (account, runs, photos, messages, mileage).
        If you cannot access the app, email <a href="mailto:routinist@openhan.kr">routinist@openhan.kr</a>{' '}
        from your registered address — processed within 3 business days.
        Order/payment records are retained for the legally required period (5 years) before disposal.
      </p>
    </main>
  );
}
