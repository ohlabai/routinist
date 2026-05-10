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

import { existsSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'src/app/api');
const dst = resolve(root, 'src/app/_api_disabled');

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });
  return r.status ?? 0;
}

function moveApi(forward) {
  const [from, to] = forward ? [src, dst] : [dst, src];
  if (existsSync(from)) {
    renameSync(from, to);
    console.log(`📦 ${forward ? 'api → _api_disabled' : '_api_disabled → api'} (Capacitor 빌드 ${forward ? '시작' : '종료'})`);
  }
}

let exitCode = 0;
try {
  moveApi(true);
  exitCode = run('npx', ['next', 'build'], { BUILD_TARGET: 'capacitor' });
  if (exitCode !== 0) {
    console.error('❌ next build 실패');
  } else {
    exitCode = run('npx', ['cap', 'sync', 'ios']);
    if (exitCode !== 0) console.error('❌ cap sync 실패');
  }
} finally {
  moveApi(false);
}
process.exit(exitCode);
