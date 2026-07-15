#!/usr/bin/env node
/**
 * iOS Capacitor 빌드 — Next.js static export 시 API routes 와 충돌하므로 임시 제외 후 빌드.
 *
 * Vercel 배포는 그대로 API routes 사용 (별도 빌드).
 * Capacitor 정적 export 는 클라 코드만 → ios/App/public 으로 복사.
 *
 * 흐름:
 *   1. src/app/api → src/app/_api_disabled (임시 이동)
 *   2. BUILD_TARGET=capacitor next build (static export)
 *   3. npx cap sync ios
 *   4. src/app/_api_disabled → src/app/api (복원)
 *
 * 중간에 실패해도 finally 에서 복원.
 */

import { existsSync, renameSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// Capacitor static export 와 충돌하는 디렉토리(API routes / force-dynamic SSR pages).
// 임시로 _disabled 접미사 붙여 next build 가 못 보게 한 뒤 마지막에 복원.
const STATIC_EXPORT_INCOMPATIBLE = [
  { active: 'src/app/api', parked: 'src/app/_api_disabled' },
  // build 136: /r/[id] 공유 랜딩 — Vercel SSR 전용. Capacitor 정적 export 와 양립 불가.
  { active: 'src/app/r', parked: 'src/app/_r_disabled' },
];

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });
  return r.status ?? 0;
}

function moveIncompatible(forward) {
  for (const entry of STATIC_EXPORT_INCOMPATIBLE) {
    const [from, to] = forward
      ? [resolve(root, entry.active), resolve(root, entry.parked)]
      : [resolve(root, entry.parked), resolve(root, entry.active)];
    if (existsSync(from)) {
      renameSync(from, to);
      console.log(`📦 ${forward ? entry.active + ' → ' + entry.parked : entry.parked + ' → ' + entry.active}`);
    }
  }
}

// 2026-07-16: 마케팅 버전 트레인 닫힘 사전 경고 — v1.2.4→1.2.5, v1.2.9→1.2.10 두 번이나
// Archive 업로드 (90186 Invalid Pre-Release Train) 에서야 발견. App Store 에 이미 출시된
// 버전과 pbxproj MARKETING_VERSION 을 대조해 archive 전에 알려준다. 네트워크 실패는 조용히 skip.
async function warnIfTrainClosed() {
  try {
    const text = readFileSync(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const m = text.match(/MARKETING_VERSION = ([\d.]+);/);
    if (!m) return;
    const local = m[1];
    const res = await fetch('https://itunes.apple.com/lookup?bundleId=com.routinist.app&country=kr', { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    const released = json?.results?.[0]?.version;
    if (!released) return;
    const cmp = local.split('.').map(Number);
    const rel = released.split('.').map(Number);
    let higher = false;
    for (let i = 0; i < Math.max(cmp.length, rel.length); i++) {
      const a = cmp[i] ?? 0, b = rel[i] ?? 0;
      if (a > b) { higher = true; break; }
      if (a < b) break;
    }
    if (!higher) {
      console.warn(`\n⚠️  MARKETING_VERSION ${local} ≤ App Store 출시 버전 ${released} — 트레인 닫힘.`);
      console.warn('⚠️  Archive 업로드가 90186 으로 거절됩니다. pbxproj MARKETING_VERSION 을 올리세요.\n');
    } else {
      console.log(`✅ MARKETING_VERSION ${local} > App Store ${released} (트레인 열림)`);
    }
  } catch { /* 오프라인/조회 실패 — 경고 없이 진행 */ }
}

let exitCode = 0;
try {
  await warnIfTrainClosed();
  moveIncompatible(true);
  // build 165: APP_VERSION 을 pbxproj CURRENT_PROJECT_VERSION 에서 읽어 NEXT_PUBLIC_APP_VERSION 에 주입.
  // 빌드마다 고유한 dataCache prefix → 캐시 회귀 차단 (build 163 의 'dev' 공유 문제 근본 해결).
  let appVersion = 'dev';
  try {
    const text = readFileSync(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const m = text.match(/CURRENT_PROJECT_VERSION = (\d+);/);
    if (m) appVersion = m[1];
  } catch {}
  console.log(`📦 NEXT_PUBLIC_APP_VERSION = ${appVersion}`);
  exitCode = run('npx', ['next', 'build'], { BUILD_TARGET: 'capacitor', NEXT_PUBLIC_APP_VERSION: appVersion });
  if (exitCode !== 0) {
    console.error('❌ next build 실패');
  } else {
    exitCode = run('npx', ['cap', 'sync', 'ios']);
    if (exitCode !== 0) console.error('❌ cap sync 실패');
  }
} finally {
  moveIncompatible(false);
}
process.exit(exitCode);
