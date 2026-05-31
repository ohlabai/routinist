// build 214 #3: 1km 마일스톤 음성 알림 (Web Speech API).
// build 223: 백그라운드 재생 + 남/여 voice 선택 + 자연스러운 voice 우선.
//
// iOS WKWebView 의 speechSynthesis 는 AVSpeechSynthesizer 를 wrapping 함. iOS 가 설치한 모든 voice
// (한국어 Yuna/Jian, 영어 Samantha/Aaron/Allison 등 + Enhanced/Premium quality) 를 그대로 사용 가능.
// 백그라운드 발화는 AppDelegate 의 AVAudioSession (.playback + .mixWithOthers) + UIBackgroundModes 'audio'
// 조합으로 가능 (둘 다 build 223 에 들어감).
//
// 옵션 localStorage:
//   'voice-cue:enabled' (default ON)
//   'voice-cue:interval-m' (default 1000)
//   'voice-cue:gender' ('female' | 'male', default 'female' — 친근한 여성 보이스 기본)

const ENABLED_KEY = 'voice-cue:enabled';
const INTERVAL_KEY = 'voice-cue:interval-m';
const GENDER_KEY = 'voice-cue:gender';

export type VoiceGender = 'female' | 'male';

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

export function getVoiceGender(): VoiceGender {
  if (typeof window === 'undefined') return 'female';
  try {
    const v = localStorage.getItem(GENDER_KEY);
    if (v === 'male' || v === 'female') return v;
  } catch {}
  return 'female';
}

export function setVoiceGender(g: VoiceGender) {
  try { localStorage.setItem(GENDER_KEY, g); } catch {}
}

// Voice 추측 — speechSynthesis.getVoices() 가 반환하는 list 에서 locale+gender 에 맞는 가장 자연스러운 보이스 선택.
// iOS 의 SpeechSynthesisVoice.name 은 보통 "Yuna", "Yuna (Enhanced)", "Allison (Premium)" 같은 형태.
// quality: Premium > Enhanced > Default. 이름 keyword 로 gender 판정.
//
// 알려진 iOS voice 매핑:
//   ko-KR 여성: Yuna (기본/Enhanced/Premium). 다른 후보: Sora, Heami.
//   ko-KR 남성: Jian, Minsu, Gyeong-Min, Sung-Ho. iOS 기본은 Yuna 만 들어있는 경우가 많음 → fallback.
//   en-US 여성: Samantha, Allison, Ava, Susan, Karen, Tessa.
//   en-US 남성: Aaron, Daniel, Fred, Tom, Alex.
//
// build 223: 사용 가능 voice 없으면 OS default 로 폴백 (locale 만 설정).

const KO_FEMALE_NAMES = ['Yuna', 'Sora', 'Heami', 'Narae', 'Ji-Min'];
const KO_MALE_NAMES = ['Jian', 'Minsu', 'Gyeong-Min', 'Sung-Ho', 'Junwoo'];
const EN_FEMALE_NAMES = ['Allison', 'Ava', 'Samantha', 'Susan', 'Karen', 'Tessa', 'Moira', 'Serena', 'Zoe'];
const EN_MALE_NAMES = ['Aaron', 'Daniel', 'Fred', 'Tom', 'Alex', 'Oliver', 'Lee', 'Evan'];

function qualityScore(name: string): number {
  // Premium > Enhanced > 기본. 이름에 keyword 포함 여부로 판정.
  const n = name.toLowerCase();
  if (n.includes('premium')) return 3;
  if (n.includes('enhanced') || n.includes('neural')) return 2;
  return 1;
}

function matchesGender(voiceName: string, gender: VoiceGender, locale: 'ko' | 'en'): boolean {
  const candidates = locale === 'ko'
    ? (gender === 'female' ? KO_FEMALE_NAMES : KO_MALE_NAMES)
    : (gender === 'female' ? EN_FEMALE_NAMES : EN_MALE_NAMES);
  return candidates.some(n => voiceName.startsWith(n));
}

function pickBestVoice(locale: 'ko' | 'en', gender: VoiceGender): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;
  const langPrefix = locale === 'ko' ? 'ko' : 'en';
  // 1) locale 매칭 + gender 매칭 voice 중 최고 quality.
  const matchingGender = voices
    .filter(v => v.lang.startsWith(langPrefix) && matchesGender(v.name, gender, locale))
    .sort((a, b) => qualityScore(b.name) - qualityScore(a.name));
  if (matchingGender.length > 0) return matchingGender[0];
  // 2) locale 만 매칭. 사용자 선택 gender 못 찾으면 그냥 같은 언어 최고 quality voice.
  const matchingLang = voices
    .filter(v => v.lang.startsWith(langPrefix))
    .sort((a, b) => qualityScore(b.name) - qualityScore(a.name));
  if (matchingLang.length > 0) return matchingLang[0];
  return null;
}

// voiceschanged 이벤트는 iOS Safari/WKWebView 에서 첫 호출 후 비동기로 발생.
// 첫 마운트에서 voice list 가 비어 있으면 이 콜백이 한 번 더 호출됨.
// 미리 voices 를 warm-up — 첫 발화 직전 list 확보 보장.
let voicesPrimed = false;
function primeVoices() {
  if (voicesPrimed) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  // 첫 호출
  window.speechSynthesis.getVoices();
  // voiceschanged 도 등록 — async 로 list 가 채워지면 그때 ready 처리
  try {
    window.speechSynthesis.onvoiceschanged = () => {
      voicesPrimed = true;
    };
  } catch {
    // older browsers
  }
  voicesPrimed = true;
}

function paceLabel(secondsPerKm: number | null, locale: 'ko' | 'en'): string {
  if (!secondsPerKm || secondsPerKm <= 0) return '';
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.floor(secondsPerKm % 60);
  if (locale === 'en') return `pace ${m} minute${m !== 1 ? 's' : ''} ${s} second${s !== 1 ? 's' : ''} per kilometer`;
  return `킬로미터당 ${m}분 ${s}초`;
}

/** 발화 — Web Speech API + iOS native voice 선택. 사용자가 OFF 했거나 unsupported 면 no-op. */
export function speakMilestone(args: {
  totalKm: number;              // 누적 km (정수)
  elapsedSeconds: number;       // 누적 시간 (초)
  avgPaceSecPerKm: number | null;
  locale: 'ko' | 'en';
}) {
  if (!isVoiceCueEnabled()) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  primeVoices();

  const { totalKm, elapsedSeconds, avgPaceSecPerKm, locale } = args;
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = Math.floor(elapsedSeconds % 60);

  // build 223: 친근하고 응원하는 톤. 기계적인 "도달" → "축하" 표현.
  let text: string;
  if (locale === 'en') {
    text = `Great job! ${totalKm} kilometer${totalKm !== 1 ? 's' : ''}. Time ${mm} minute${mm !== 1 ? 's' : ''} ${ss} second${ss !== 1 ? 's' : ''}.`;
    const p = paceLabel(avgPaceSecPerKm, 'en');
    if (p) text += ` Average ${p}. Keep going!`;
  } else {
    text = `잘하고 있어요! ${totalKm}킬로미터 통과. ${mm}분 ${ss}초 지났습니다.`;
    const p = paceLabel(avgPaceSecPerKm, 'ko');
    if (p) text += ` 평균 ${p}. 이대로 가요!`;
  }

  try {
    const gender = getVoiceGender();
    const voice = pickBestVoice(locale, gender);
    const u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = locale === 'en' ? 'en-US' : 'ko-KR';
    }
    // build 223: 친근감을 위해 살짝 느린 속도 + 약간 높은 pitch. 너무 기계음으로 들리지 않도록.
    u.rate = 0.95;
    u.pitch = gender === 'female' ? 1.05 : 0.95;
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

/** 짧은 인사 발화 — 성별 토글 직후 미리듣기용. */
export function speakGreetingSample(locale: 'ko' | 'en') {
  if (!isVoiceCueEnabled()) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  primeVoices();
  const text = locale === 'en'
    ? 'Hi there! Ready to run together?'
    : '안녕하세요! 같이 달려볼까요?';
  try {
    const gender = getVoiceGender();
    const voice = pickBestVoice(locale, gender);
    const u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = locale === 'en' ? 'en-US' : 'ko-KR';
    }
    u.rate = 0.95;
    u.pitch = gender === 'female' ? 1.05 : 0.95;
    u.volume = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
