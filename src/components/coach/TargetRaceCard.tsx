'use client';

// 타겟 레이스 카운트다운 + 권장 주간 km (build 199).
// /coach 페이지 안에 삽입.

import { useEffect, useState } from 'react';
import { Flag, Calendar, Plus, ChevronRight, X, Save, Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';

interface RaceInfo {
  race: {
    id: string;
    name: string;
    race_date: string;
    distance_meters: number;
    target_seconds: number | null;
    notes: string | null;
  } | null;
  days_left?: number;
  weeks_left?: number;
  recommended_weekly_km?: number;
  is_taper?: boolean;
}

const DISTANCES = [
  { meters: 5000, label: '5K' },
  { meters: 10000, label: '10K' },
  { meters: 21097, label: '하프' },
  { meters: 42195, label: '풀' },
];

export default function TargetRaceCard() {
  const [info, setInfo] = useState<RaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [distance, setDistance] = useState<number>(42195);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const supabase = getSupabase();
    const { data } = await supabase.rpc('get_next_target_race');
    setInfo(data as RaceInfo);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await reload(); } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    if (!name.trim() || !raceDate) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인 필요');
      const { error } = await supabase.from('target_races').insert({
        user_id: user.id, name: name.trim(), race_date: raceDate, distance_meters: distance,
      });
      if (error) throw error;
      setShowForm(false);
      setName(''); setRaceDate(''); setDistance(42195);
      await reload();
    } catch (e) {
      console.warn('[target-race] save fail', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const race = info?.race;

  if (!race) {
    return (
      <div className="card p-4 border-violet-200/40 dark:border-violet-900/30">
        <div className="flex items-center gap-2 mb-2">
          <Flag size={14} className="text-violet-500" />
          <h3 className="text-sm font-extrabold">목표 레이스</h3>
        </div>
        {showForm ? (
          <RaceForm
            name={name} setName={setName}
            raceDate={raceDate} setRaceDate={setRaceDate}
            distance={distance} setDistance={setDistance}
            saving={saving} onSave={handleSave} onCancel={() => setShowForm(false)}
          />
        ) : (
          <button onClick={() => setShowForm(true)}
            className="w-full mt-1 px-3 py-2.5 rounded-xl border-2 border-dashed border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 text-xs font-extrabold active:scale-95 inline-flex items-center justify-center gap-1.5">
            <Plus size={14} /> 다음 대회 등록하기
          </button>
        )}
      </div>
    );
  }

  const distLabel = race.distance_meters === 42195 ? '풀마라톤'
    : race.distance_meters === 21097 ? '하프마라톤'
    : `${(race.distance_meters / 1000).toFixed(0)}K`;

  return (
    <div className="card p-5 bg-gradient-to-br from-violet-50/50 via-transparent to-fuchsia-50/40 dark:from-violet-950/20 dark:to-fuchsia-950/15">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flag size={14} className="text-violet-500" />
          <h3 className="text-sm font-extrabold">목표 레이스</h3>
        </div>
        <span className="text-[12px] font-extrabold text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40">
          {distLabel}
        </span>
      </div>

      <p className="text-lg font-extrabold mb-1">{race.name}</p>
      <p className="text-xs text-[var(--muted)] mb-3 inline-flex items-center gap-1">
        <Calendar size={11} /> {race.race_date}
      </p>

      {/* 카운트다운 hero */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="text-center">
          <p className="text-3xl font-extrabold text-violet-600 tabular-nums">{info?.days_left ?? '-'}</p>
          <p className="text-[12px] font-bold text-[var(--muted)] uppercase tracking-widest mt-0.5">일 남음</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-extrabold text-fuchsia-600 tabular-nums">{info?.recommended_weekly_km ?? '-'}</p>
          <p className="text-[12px] font-bold text-[var(--muted)] uppercase tracking-widest mt-0.5">권장 주간 km</p>
        </div>
      </div>

      {info?.is_taper && (
        <div className="mt-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30">
          <p className="text-[13px] font-bold text-amber-700 dark:text-amber-300">⚠️ 테이퍼링 기간 — 강도 낮추고 회복 중심으로</p>
        </div>
      )}

      <button onClick={() => setShowForm(true)}
        className="mt-3 w-full px-3 py-2 rounded-xl border border-violet-200/60 dark:border-violet-900/40 text-violet-600 dark:text-violet-400 text-[13px] font-bold active:scale-95 inline-flex items-center justify-center gap-1">
        <ChevronRight size={11} /> 다른 대회 추가
      </button>

      {showForm && (
        <div className="mt-3 pt-3 border-t border-violet-200/40 dark:border-violet-900/30">
          <RaceForm
            name={name} setName={setName}
            raceDate={raceDate} setRaceDate={setRaceDate}
            distance={distance} setDistance={setDistance}
            saving={saving} onSave={handleSave} onCancel={() => setShowForm(false)}
          />
        </div>
      )}
    </div>
  );
}

interface FormProps {
  name: string; setName: (v: string) => void;
  raceDate: string; setRaceDate: (v: string) => void;
  distance: number; setDistance: (v: number) => void;
  saving: boolean; onSave: () => void; onCancel: () => void;
}

function RaceForm({ name, setName, raceDate, setRaceDate, distance, setDistance, saving, onSave, onCancel }: FormProps) {
  return (
    <div className="space-y-2.5">
      <input type="text" placeholder="대회명 (예: 춘천마라톤)"
        value={name} onChange={e => setName(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm focus:outline-none focus:border-violet-500"
      />
      <input type="date" value={raceDate} onChange={e => setRaceDate(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm focus:outline-none focus:border-violet-500"
      />
      <div className="grid grid-cols-4 gap-1.5">
        {DISTANCES.map(d => (
          <button key={d.meters} onClick={() => setDistance(d.meters)} type="button"
            className={`py-2 rounded-xl text-xs font-extrabold border-2 active:scale-95 ${
              distance === d.meters
                ? 'bg-violet-500 border-violet-500 text-white'
                : 'bg-[var(--card)] border-[var(--card-border)] text-[var(--foreground)]'
            }`}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} disabled={saving}
          className="flex-1 py-2.5 rounded-xl border-2 border-[var(--card-border)] text-[var(--muted)] text-sm font-bold active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-1">
          <X size={14} /> 취소
        </button>
        <button onClick={onSave} disabled={saving || !name.trim() || !raceDate}
          className="flex-[2] py-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm font-extrabold active:scale-95 disabled:opacity-50 shadow-md shadow-violet-500/30 inline-flex items-center justify-center gap-1">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
        </button>
      </div>
    </div>
  );
}
