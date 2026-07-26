'use client';

// 삼성헬스 → Health Connect 데이터 공유 켜기 가이드 (2026-07-26 hans: "이미지로 직관적으로").
// 실제 화면을 본뜬 미니 목업 일러스트 4단계 — 이미지 에셋 없이 tailwind 로 그려서
// 다크모드·i18n 자동 대응. 연동 화면에서 hcEmpty (연결됐는데 HC 0건) 일 때 노출.

import { useI18n } from '@/lib/i18n';

export default function SamsungHealthGuide() {
  const { locale } = useI18n();
  const ko = locale !== 'en';

  return (
    <div className="mt-2 rounded-2xl bg-amber-50 dark:bg-amber-950/25 border border-amber-200/70 dark:border-amber-800/40 p-4 text-left">
      <p className="text-sm font-extrabold text-amber-800 dark:text-amber-300 mb-1">
        🌱 {ko ? '삼성헬스 기록이 안 보이나요?' : "Can't see your Samsung Health runs?"}
      </p>
      <p className="text-xs text-amber-800/90 dark:text-amber-200/90 leading-relaxed mb-3">
        {ko
          ? '삼성헬스는 기본으로 데이터를 공유하지 않아요. 딱 한 번만 켜주면 자동으로 들어와요.'
          : 'Samsung Health does not share data by default. Turn it on once and runs flow in automatically.'}
      </p>

      <div className="space-y-2.5">
        {/* 1단계 — 삼성헬스 설정 진입 */}
        <Step n={1} label={ko ? '삼성헬스 앱 → 우상단 ⋮ → 설정' : 'Samsung Health → top-right ⋮ → Settings'}>
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="w-7 h-7 rounded-xl bg-teal-500 flex items-center justify-center text-white text-sm font-black">S</span>
            <span className="text-[11px] font-bold text-[var(--foreground)] flex-1">Samsung Health</span>
            <span className="relative w-6 h-6 rounded-full ring-2 ring-emerald-500 flex items-center justify-center text-[var(--foreground)] font-black text-sm">
              ⋮
              <Pointer />
            </span>
          </div>
        </Step>

        {/* 2단계 — Health Connect 메뉴 */}
        <Step n={2} label={ko ? "설정에서 'Health Connect' 선택" : "In Settings, tap 'Health Connect'"}>
          <div className="px-2.5 py-1.5 space-y-1">
            <MockRow dim label={ko ? '알림' : 'Notifications'} />
            <div className="relative flex items-center justify-between rounded-lg ring-2 ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5">
              <span className="text-[11px] font-extrabold text-[var(--foreground)]">Health Connect</span>
              <span className="text-[11px] text-[var(--muted)]">›</span>
              <Pointer />
            </div>
            <MockRow dim label={ko ? '정보' : 'About'} />
          </div>
        </Step>

        {/* 3단계 — 동기화 토글 ON + 운동 */}
        <Step n={3} label={ko ? "'데이터 동기화' 켜기 + '운동' 켜기" : "Turn on 'Sync data' + enable 'Exercise'"}>
          <div className="px-2.5 py-1.5 space-y-1">
            <div className="relative flex items-center justify-between rounded-lg px-2 py-1.5">
              <span className="text-[11px] font-bold text-[var(--foreground)]">
                {ko ? 'Health Connect 와 동기화' : 'Sync with Health Connect'}
              </span>
              <ToggleOn />
            </div>
            <div className="flex items-center justify-between rounded-lg px-2 py-1.5">
              <span className="text-[11px] font-bold text-[var(--foreground)]">🏃 {ko ? '운동' : 'Exercise'}</span>
              <ToggleOn small />
            </div>
          </div>
        </Step>

        {/* 4단계 — 돌아와서 동기화 */}
        <Step n={4} label={ko ? '여기로 돌아와 동기화 누르기' : 'Come back here and tap Sync'}>
          <div className="flex items-center justify-center gap-2 px-2.5 py-2.5">
            <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-extrabold shadow-sm shadow-emerald-500/30">
              🔄 {ko ? '동기화' : 'Sync'}
            </span>
            <span className="text-[11px] text-[var(--muted)]">→ 🏃 {ko ? '기록이 들어와요!' : 'runs appear!'}</span>
          </div>
        </Step>
      </div>
    </div>
  );
}

/* ── 조각들 ─────────────────────────────────────────────────── */

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">
          {n}
        </span>
        <span className="text-xs font-bold text-amber-900 dark:text-amber-200">{label}</span>
      </div>
      {/* 미니 목업 패널 */}
      <div className="rounded-xl bg-white dark:bg-zinc-900 border border-amber-200/60 dark:border-zinc-700 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function MockRow({ label, dim = false }: { label: string; dim?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${dim ? 'opacity-40' : ''}`}>
      <span className="text-[11px] font-bold text-[var(--foreground)]">{label}</span>
      <span className="text-[11px] text-[var(--muted)]">›</span>
    </div>
  );
}

function ToggleOn({ small = false }: { small?: boolean }) {
  const w = small ? 'w-7 h-4' : 'w-8 h-4.5 min-h-[18px]';
  const knob = small ? 'w-3 h-3' : 'w-3.5 h-3.5';
  return (
    <span className={`${w} rounded-full bg-emerald-500 flex items-center justify-end px-0.5 shadow-inner`}>
      <span className={`${knob} rounded-full bg-white shadow`} />
    </span>
  );
}

/** 강조 요소를 가리키는 작은 손가락 포인터 */
function Pointer() {
  return (
    <span className="absolute -bottom-2.5 -right-1 text-sm select-none" aria-hidden>
      👆
    </span>
  );
}
