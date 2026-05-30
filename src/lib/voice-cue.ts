// build 214 #3: 1km 마일스톤 음성 알림 (Web Speech API).
// iOS WKWebView 는 Siri voice (한국어/영어) 사용. 이어폰/스피커는 OS 가 자동 라우팅.
// 트리거: appendCoord 후 floor(distance/1000) 가 변하면 발화.
//
// 옵션 토글은 localStorage:'voice-cue:enabled' (default ON), 'voice-cue:interval-m' (default 1000).

const ENABLED_KEY = 'voice-cue:enabled';
const INTERVAL_KEY = 'voice-cue:interval-m';

export interface VoiceCueOptions {
  locale: 'ko' | 'en';
}

export function isVoiceCueEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    return v !== 'false';   // default ON
  } catch { return true; }
}

export function setVoiceCueEnabled(on: boolean) {
  try { localStorage.setItem(ENABLED_KEY, on ? 'true' : 'false'); } catch {}
}

export function getVoiceCueIntervalMeters(): number {
  if (typeof window === 'undefined') return 1000;
  try {
    const v = Number(localStorage.getItem(INTERVAL_KEY));
    if (v === 500 || v === 1000) return v;
  } catch {}
  return 1000;
}

export function setVoiceCueIntervalMeters(m: 500 | 1000) {
  try { localStorage.setItem(INTERVAL_KEY, String(m)); } catch {}
}

function paceLabel(secondsPerKm: number | null, locale: 'ko' | 'en'): string {
  if (!secondsPerKm || secondsPerKm <= 0) return '';
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.floor(secondsPerKm % 60);
  if (locale === 'en') return `pace ${m} minute${m !== 1 ? 's' : ''} ${s} second${s !== 1 ? 's' : ''} per kilometer`;
  return `킬로미터당 ${m}분 ${s}초`;
}

/** 발화 — Web Speech API. 사용자가 OFF 했거나 unsupported 면 no-op. */
export function speakMilestone(args: {
  totalKm: number;              // 누적 km (정수)
  elapsedSeconds: number;       // 누적 시간 (초)
  avgPaceSecPerKm: number | null;
  locale: 'ko' | 'en';
}) {
  if (!isVoiceCueEnabled()) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const { totalKm, elapsedSeconds, avgPaceSecPerKm, locale } = args;
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = Math.floor(elapsedSeconds % 60);

  let text: string;
  if (locale === 'en') {
    text = `${totalKm} kilometer${totalKm !== 1 ? 's' : ''} reached. Time ${mm} minute${mm !== 1 ? 's' : ''} ${ss} second${ss !== 1 ? 's' : ''}.`;
    const p = paceLabel(avgPaceSecPerKm, 'en');
    if (p) text += ` Average ${p}.`;
  } else {
    text = `${totalKm}킬로미터 도달. 시간 ${mm}분 ${ss}초.`;
    const p = paceLabel(avgPaceSecPerKm, 'ko');
    if (p) text += ` 평균 ${p}.`;
  }

  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale === 'en' ? 'en-US' : 'ko-KR';
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    // 같은 시점에 다른 utterance 가 있으면 cancel 후 새 것
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* unsupported, ignore */
  }
}

/** 즉시 테스트용 — 설정 화면에서 "샘플 듣기" 버튼에 쓰임. */
export function speakSample(locale: 'ko' | 'en') {
  speakMilestone({ totalKm: 1, elapsedSeconds: 330, avgPaceSecPerKm: 330, locale });
}
