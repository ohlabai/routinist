// Play 스토어 등록정보 (ko-KR) 갱신 — 심사 미전송 저장 (changesNotSentForReview)
// 사용: node play-listing.mjs <service-account.json> [--apply]
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [saPath, applyFlag] = process.argv.slice(2);
const PKG = 'com.routinist.app';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
const b64url = (buf) => Buffer.from(buf).toString('base64url');

async function getToken(scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j));
  return j.access_token;
}

const token = await getToken('https://www.googleapis.com/auth/androidpublisher');
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// 1) edit 생성
const edit = await api('POST', '/edits');
console.log('edit id:', edit.id);

// 2) 현재 ko-KR 등록정보 읽기
const cur = await api('GET', `/edits/${edit.id}/listings/ko-KR`);
console.log('현재 title:', cur.title);
console.log('현재 shortDescription:', cur.shortDescription);
console.log('현재 fullDescription 길이:', (cur.fullDescription || '').length);

if (applyFlag !== '--apply') {
  console.log('\n(--apply 없이 실행 — 읽기만 하고 종료)');
  await api('DELETE', `/edits/${edit.id}`);
  process.exit(0);
}

// 3) 새 설명 적용 (title 은 유지)
const draft = readFileSync('/Users/hans_macmini/routinist/play-upload/store-description-ko.txt', 'utf8');
const shortDesc = draft.match(/\[간단한 설명[^\]]*\]\n(.+)/)?.[1].trim();
const fullDesc = draft.split(/\[전체 설명[^\]]*\]\n/)[1].trim();
if (!shortDesc || !fullDesc || shortDesc.length > 80 || fullDesc.length > 4000) {
  throw new Error(`파싱/길이 오류: short=${shortDesc?.length} full=${fullDesc?.length}`);
}
await api('PUT', `/edits/${edit.id}/listings/ko-KR`, {
  language: 'ko-KR',
  title: cur.title,
  shortDescription: shortDesc,
  fullDescription: fullDesc,
  video: cur.video,
});
console.log('ko-KR 등록정보 업데이트 OK (short:', shortDesc.length, '자, full:', fullDesc.length, '자)');

// 4) 검증 후 심사 미전송 커밋
await api('POST', `/edits/${edit.id}:validate`);
console.log('validate OK');
const committed = await api('POST', `/edits/${edit.id}:commit?changesNotSentForReview=true`);
console.log('commit OK (심사 미전송 저장):', committed.id);
