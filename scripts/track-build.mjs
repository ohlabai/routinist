#!/usr/bin/env node
// build 203 Phase D: 매 빌드 끝나면 자동으로 build_releases + build_test_checklist INSERT.
//
// 사용법:
//   npm run track-build                        # 마지막 commit 자동 추적
//   npm run track-build -- --commit=<sha>      # 특정 commit 추적
//   npm run track-build -- --dry-run           # API 호출만, DB 쓰지 않음
//
// 환경변수 (.env 또는 shell):
//   ANTHROPIC_API_KEY    — Claude API key (필수)
//   SUPABASE_URL         — fallback NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  — admin RPC 호출용 (RLS 우회)
//
// Claude Haiku 4.5 사용. 빌드당 약 $0.005. 월 50 빌드 = $0.25.

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const DRY = !!args['dry-run'];

if (!ANTHROPIC_KEY) {
  console.error('❌ ANTHROPIC_API_KEY 가 없어요.');
  console.error('   https://console.anthropic.com/settings/keys 에서 발급 후 .env.local 에 추가:');
  console.error('   ANTHROPIC_API_KEY=sk-ant-api03-...');
  process.exit(1);
}
if (!DRY && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없어요. .env.local 확인.');
  process.exit(1);
}

const commitSha = args.commit || execSync('git rev-parse --short HEAD').toString().trim();
const commitMsg = execSync(`git log -1 --format=%B ${commitSha}`).toString().trim();
const diffStat = execSync(`git show --stat --format= ${commitSha}`).toString().trim();
const diffFull = execSync(`git show --format= ${commitSha} -- ':!**/package-lock.json' ':!**/*.lock'`).toString();
const diffSnippet = diffFull.length > 30000 ? diffFull.slice(0, 30000) + '\n...(truncated)' : diffFull;

// 빌드 번호 / 버전 추출
function readBuildNumber() {
  try {
    const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
    const cur = pbx.match(/CURRENT_PROJECT_VERSION = (\d+);/);
    const ver = pbx.match(/MARKETING_VERSION = ([\d.]+);/);
    return { buildNumber: cur ? Number(cur[1]) : null, version: ver ? ver[1] : null };
  } catch {
    return { buildNumber: null, version: null };
  }
}

const { buildNumber, version } = readBuildNumber();
if (!buildNumber) {
  console.error('❌ ios/App/App.xcodeproj/project.pbxproj 에서 CURRENT_PROJECT_VERSION 못 찾음');
  process.exit(1);
}

console.log(`📦 build ${buildNumber} (v${version}) | commit ${commitSha}`);
console.log(`📝 "${commitMsg.split('\n')[0]}"`);
console.log(`📊 ${diffStat.split('\n').slice(-1)[0]}`);

// ─── Claude Haiku 4.5 호출 ─────────────────────────────────────────────
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

const systemPrompt = `당신은 Routinist (러닝 트래커 + 쇼핑 + 소셜 앱) 의 QA 보조 어시스턴트입니다.
새 빌드의 commit 메시지와 git diff 를 읽고, 운영자가 실기기·web 에서 검증해야 할
체크리스트를 카테고리별로 정리합니다.

규칙:
1. JSON 만 반환. 다른 텍스트 없음.
2. 형식:
   {
     "title": "한 줄 요약 (40자 이내)",
     "summary": "마크다운 형식의 상세 설명 (200자 내외)",
     "checklist": [
       {"category": "분류명", "title": "체크 항목", "expected": "정상 동작 기준"}
     ]
   }
3. 카테고리 예: "신규 기능", "UI", "DB 마이그", "RLS/권한", "회귀 점검",
   "iOS 빌드", "결제", "푸시", "Apple 심사 risk".
4. 체크리스트는 8~20개 사이. 각 항목은 운영자가 실기기에서 1분 안에 확인 가능한 수준.
5. "회귀 점검" 카테고리 1~3개 필수 — 변경 영역과 인접한 기존 기능.
6. 사용자 친화적 한국어. 전문 용어는 풀어 쓰기 ("RLS" 보단 "본인만 보이는지").
7. 거짓말 금지 — diff 에 없는 기능은 체크리스트에 포함 X.`;

const userPrompt = `# Build ${buildNumber} (v${version})

## Commit message
\`\`\`
${commitMsg}
\`\`\`

## Diff stat
\`\`\`
${diffStat}
\`\`\`

## Diff (truncated to 30KB if longer)
\`\`\`diff
${diffSnippet}
\`\`\`

위 변경사항을 검증할 체크리스트를 JSON 으로 반환하세요.`;

console.log('🤖 Claude Haiku 4.5 호출 중...');
const t0 = Date.now();
const response = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 4000,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }],
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const usage = response.usage;
const costInput = (usage.input_tokens / 1_000_000) * 0.80;       // Haiku 4.5 input $0.80/MTok
const costOutput = (usage.output_tokens / 1_000_000) * 4.00;     // output $4/MTok
console.log(`✓ ${elapsed}s · input ${usage.input_tokens} · output ${usage.output_tokens} · 비용 $${(costInput + costOutput).toFixed(4)}`);

const text = response.content.find(c => c.type === 'text')?.text ?? '';
const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.error('❌ JSON 응답을 찾을 수 없음:', text.slice(0, 500));
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(jsonMatch[0]);
} catch (e) {
  console.error('❌ JSON parse fail:', e.message);
  console.error(jsonMatch[0].slice(0, 1000));
  process.exit(1);
}

if (!parsed.title || !Array.isArray(parsed.checklist)) {
  console.error('❌ 응답 형식 오류:', parsed);
  process.exit(1);
}

console.log(`📋 체크리스트 ${parsed.checklist.length}개 생성`);
console.log(`   "${parsed.title}"`);

if (DRY) {
  console.log('--- DRY RUN — DB 쓰지 않음 ---');
  console.log(JSON.stringify(parsed, null, 2));
  process.exit(0);
}

// ─── Supabase INSERT ──────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1. build_releases upsert
const { error: relErr } = await supabase
  .from('build_releases')
  .upsert({
    build_number: buildNumber,
    marketing_version: version,
    title: parsed.title.slice(0, 200),
    summary: parsed.summary?.slice(0, 4000) ?? null,
    commit_sha: commitSha,
    released_at: new Date().toISOString().slice(0, 10),
  });
if (relErr) {
  console.error('❌ build_releases upsert fail:', relErr.message);
  process.exit(1);
}

// 2. 기존 체크리스트 있는지 확인 — 있으면 skip (덮어쓰기 방지)
const { count: existing } = await supabase
  .from('build_test_checklist')
  .select('*', { count: 'exact', head: true })
  .eq('build_number', buildNumber);

if (existing && existing > 0) {
  console.log(`⚠️  build ${buildNumber} 에 이미 체크리스트 ${existing}건 있음. 신규 항목만 추가.`);
}

// 3. checklist insert (ord 자동 매김)
const groupOrd = {};
const rows = parsed.checklist.map((item, idx) => {
  const cat = item.category ?? '기타';
  groupOrd[cat] = (groupOrd[cat] ?? 0) + 1;
  return {
    build_number: buildNumber,
    category: cat.slice(0, 50),
    ord: groupOrd[cat],
    title: (item.title ?? '').slice(0, 300),
    expected: (item.expected ?? null)?.slice(0, 500) ?? null,
  };
});

const { error: chErr } = await supabase.from('build_test_checklist').insert(rows);
if (chErr) {
  console.error('❌ checklist insert fail:', chErr.message);
  process.exit(1);
}

console.log(`✅ build ${buildNumber} 자동 등록 완료. → /admin/builds 에서 확인`);
console.log(`   build_releases 1행 + checklist ${rows.length}행`);
