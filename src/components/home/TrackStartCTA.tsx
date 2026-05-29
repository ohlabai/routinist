'use client';

// 홈 hero 위 미니멀 트래킹 시작 CTA (build 194).
// 옵션 A 진입점. 가입자 100% 노출. 1탭으로 /track 진입.
// 외부 GPS 앱 (Strava·나이키) 사용자는 이걸 굳이 안 눌러도 HealthKit sync 유지됨 — 강제 아님.

import Link from 'next/link';
import { MapPin, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function TrackStartCTA() {
  const { tt } = useI18n();
  return (
    <div className="mx-4">
      <Link
        href="/track"
        className="relative block w-full rounded-2xl overflow-hidden bg-gradient-to-br from-emerald-500 via-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30 active:scale-[0.99] transition"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_55%)]" />
        <div className="relative px-5 py-4 flex items-center gap-3 text-white">
          <div className="w-11 h-11 rounded-full bg-white/15 backdrop-blur flex items-center justify-center flex-shrink-0 shadow-inner">
            <MapPin size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-extrabold tracking-widest uppercase text-emerald-50/85">Start Now</p>
            <p className="text-base font-extrabold leading-tight">{tt('달리기 시작하기')}</p>
            <p className="text-[11px] text-emerald-50/85 mt-0.5">{tt('GPS 로 경로·거리·시간이 자동 기록돼요')}</p>
          </div>
          <ChevronRight size={18} className="text-white/80 flex-shrink-0" />
        </div>
      </Link>
    </div>
  );
}
