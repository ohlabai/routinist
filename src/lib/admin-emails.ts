// 어드민 이메일 단일 진실 — DB 의 is_shop_admin() 함수와 동기화 유지.
// 새 admin 추가 시 양쪽 (이 파일 + supabase 마이그) 함께 갱신.

export const ADMIN_EMAILS = [
  'hans@openhan.kr',
  'claire@openhan.kr',
  'dylan@openhan.kr',
  'jane@openhan.kr',
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (ADMIN_EMAILS as readonly string[]).includes(email.toLowerCase());
}
