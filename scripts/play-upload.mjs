// Google Play 내부 테스트 트랙 AAB 업로드 (androidpublisher v3)
// 사용법: node play-upload.mjs <service-account.json> <app.aab> [track]
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [saPath, aabPath, track = 'internal'] = process.argv.slice(2);
const PKG = 'com.routinist.app';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function getToken(scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${sig}`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j));
  return j.access_token;
}

const token = await getToken('https://www.googleapis.com/auth/androidpublisher');
const H = { Authorization: `Bearer ${token}` };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;

async function jfetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}\n${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// 1) edit 생성
const edit = await jfetch(`${base}/edits`, { method: 'POST', body: '{}' , headers: { 'Content-Type': 'application/json' }});
console.log('edit:', edit.id);

// 2) AAB 업로드
const aab = readFileSync(aabPath);
const up = await jfetch(
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}/edits/${edit.id}/bundles?uploadType=media`,
  { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: aab },
);
console.log('bundle versionCode:', up.versionCode, 'sha256:', (up.sha256 || '').slice(0, 12));

// 3) 트랙 배정
const rel = await jfetch(`${base}/edits/${edit.id}/tracks/${track}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track,
    releases: [{ versionCodes: [String(up.versionCode)], status: 'completed' }],
  }),
});
console.log('track:', JSON.stringify(rel));

// 4) commit
const done = await jfetch(`${base}/edits/${edit.id}:commit`, { method: 'POST' });
console.log('committed:', done.id);
console.log(`OK — versionCode ${up.versionCode} → ${track} track`);
