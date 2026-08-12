// Google Play 멀티-AAB 업로드 (폰 + Wear OS 를 같은 릴리스에).
// 사용법: node play-upload-multi.mjs <service-account.json> <track> <notesVersion> <aab1> [aab2...]
//   - 폰 AAB + 워치 AAB 를 한 edit 에 올리고 versionCodes 를 함께 릴리스에 배정
//   - notesVersion: 릴리스 노트로 쓸 changelogs/<v>.txt 의 버전 (폰 versionCode)
//   - Wear 스토어 스크린샷은 WEAR_SHOTS_DIR 있으면 best-effort 업로드 (실패해도 commit 진행)
import { createSign } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const [saPath, track = 'production', notesVersion, ...aabPaths] = process.argv.slice(2);
const PKG = 'com.routinist.app';
const LANGS = ['ko-KR', 'en-US'];
const WEAR_SHOTS_DIR = process.env.WEAR_SHOTS_DIR || '';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
const b64url = (b) => Buffer.from(b).toString('base64url');

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j));
  return j.access_token;
}

const token = await getToken();
const H = { Authorization: `Bearer ${token}` };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const upBase = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}`;

async function jfetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

// 1) edit
const edit = await jfetch(`${base}/edits`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
console.log('edit:', edit.id);

// 2) 모든 AAB 업로드
// 2026-08-12: Play 가 폼팩터 트랙을 강제하게 됨. 워치 AAB 를 폰과 같은 트랙에 넣으면 commit 이
// 400 "requires the Wear OS system feature android.hardware.type.watch" 로 거절된다.
// → 경로에 /wear/ 가 있는 아티팩트는 `wear:<track>` 로 자동 분리 (콘솔의 Wear OS 트랙과 동일).
const byTrack = new Map();   // track → [versionCode]
for (const p of aabPaths) {
  const up = await jfetch(`${upBase}/edits/${edit.id}/bundles?uploadType=media`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(p) });
  const isWear = /(^|\/)wear[\/-]/.test(p);
  const t = isWear ? `wear:${track}` : track;
  console.log('bundle:', p.split('/').pop(), '→ versionCode', up.versionCode, `(track: ${t})`);
  byTrack.set(t, [...(byTrack.get(t) || []), String(up.versionCode)]);
}

// 3) Wear 스크린샷 best-effort (실패해도 계속)
if (WEAR_SHOTS_DIR && existsSync(WEAR_SHOTS_DIR)) {
  const shots = readdirSync(WEAR_SHOTS_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
  for (const lang of LANGS) {
    try {
      await jfetch(`${base}/edits/${edit.id}/listings/${lang}/wearScreenshots`, { method: 'DELETE' }).catch(() => {});
      for (const s of shots) {
        const ct = s.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        await jfetch(`${upBase}/edits/${edit.id}/listings/${lang}/wearScreenshots?uploadType=media`,
          { method: 'POST', headers: { 'Content-Type': ct }, body: readFileSync(`${WEAR_SHOTS_DIR}/${s}`) });
      }
      console.log(`wearScreenshots [${lang}]: ${shots.length}장`);
    } catch (e) {
      console.log(`⚠️ wearScreenshots [${lang}] 실패 (무시, 콘솔에서 추가 가능): ${String(e).slice(0, 120)}`);
    }
  }
}

// 4) 릴리스 노트
const releaseNotes = [];
for (const lang of LANGS) {
  const f = `fastlane/metadata/android/${lang}/changelogs/${notesVersion}.txt`;
  if (existsSync(f)) releaseNotes.push({ language: lang, text: readFileSync(f, 'utf8').trim() });
}

// 5) 각 트랙에 versionCodes 배정 (폰 = <track>, 워치 = wear:<track>). 같은 edit 안이라
//    commit 한 번으로 폰·워치가 세트로 함께 올라간다.
for (const [t, versionCodes] of byTrack) {
  const rel = await jfetch(`${base}/edits/${edit.id}/tracks/${encodeURIComponent(t)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track: t, releases: [{ versionCodes, status: 'completed', releaseNotes }] }),
  });
  console.log('track:', t, JSON.stringify(rel.releases?.[0]?.versionCodes));
}

// 6) commit (관리형 게시/정책 앱은 changesNotSentForReview 폴백)
let done;
try {
  done = await jfetch(`${base}/edits/${edit.id}:commit`, { method: 'POST' });
} catch (e) {
  if (String(e).includes('changesNotSentForReview')) {
    done = await jfetch(`${base}/edits/${edit.id}:commit?changesNotSentForReview=true`, { method: 'POST' });
    console.log('⚠️  검토 미전송 모드로 commit — Play Console 게시 개요에서 "변경사항 전송" 필요');
  } else throw e;
}
console.log('committed:', done.id, '→', [...byTrack].map(([t, v]) => `${t}=${v.join(",")}`).join(" | "));
