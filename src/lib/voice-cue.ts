// build 214 #3: 1km 마일스톤 음성 알림 (Web Speech API).
// build 223: 백그라운드 재생 + 남/여 voice 선택 + 자연스러운 voice 우선.
// build 226 #1: male voice 매칭 실패 시 pitch 보정 + 메시지 짧고 친근하게 다듬음 +
//   milestone (5/10/half/full) 차별 메시지. Premium/Enhanced quality 가중치 강화.
//
// iOS WKWebView 의 speechSynthesis 는 AVSpeechSynthesizer 를 wrapping 함. iOS 가 설치한 모든 voice
// (한국어 Yuna/Jian, 영어 Samantha/Aaron/Allison 등 + Enhanced/Premium quality) 를 그대로 사용 가능.
// 백그라운드 발화는 AppDelegate 의 AVAudioSession (.playback + .mixWithOthers) + UIBackgroundModes 'audio'
// 조합으로 가능 (build 223).
//
// **자연스러움 한계**: Web Speech API 의 한국어 voice 가 OS 기본 Yuna 뿐인 경우가 많아
// 한계가 있음. 사용자가 iOS 설정 > 손쉬운 사용 > 음성 콘텐츠 > 음성 > 한국어 에서 추가 voice
// (Suhyun, Premium 등) 를 다운로드하면 즉시 활용 (getVoices 가 반영).
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

const KO_FEMALE_NAMES = ['Yuna', 'Sora', 'Heami', 'Narae', 'Ji-Min', 'Suhyun', 'Seoyeon'];
const KO_MALE_NAMES = ['Jian', 'Minsu', 'Gyeong-Min', 'Sung-Ho', 'Junwoo'];
const EN_FEMALE_NAMES = ['Allison', 'Ava', 'Samantha', 'Susan', 'Karen', 'Tessa', 'Moira', 'Serena', 'Zoe'];
const EN_MALE_NAMES = ['Aaron', 'Daniel', 'Fred', 'Tom', 'Alex', 'Oliver', 'Lee', 'Evan'];

function qualityScore(name: string): number {
  // build 226: Premium > Enhanced/Neural > Siri (iOS 17+ Siri voice 가 가장 자연스러움) > 기본.
  const n = name.toLowerCase();
  if (n.includes('premium')) return 5;
  if (n.includes('enhanced') || n.includes('neural')) return 4;
  if (n.includes('siri')) return 3;
  return 1;
}

function matchesGender(voiceName: string, gender: VoiceGender, locale: 'ko' | 'en'): boolean {
  const candidates = locale === 'ko'
    ? (gender === 'female' ? KO_FEMALE_NAMES : KO_MALE_NAMES)
    : (gender === 'female' ? EN_FEMALE_NAMES : EN_MALE_NAMES);
  return candidates.some(n => voiceName.startsWith(n));
}

interface PickedVoice {
  voice: SpeechSynthesisVoice | null;
  // build 226 #1: 사용자가 male 선택했지만 ko 남성 voice 없을 때 true. pitch 를 0.65 로 크게 낮춰
  // "남성 같이" 들리게 보정.
  genderFallback: boolean;
}

function pickBestVoice(locale: 'ko' | 'en', gender: VoiceGender): PickedVoice {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { voice: null, genderFallback: false };
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return { voice: null, genderFallback: false };
  const langPrefix = locale === 'ko' ? 'ko' : 'en';
  // 1) locale 매칭 + gender 매칭 voice 중 최고 quality.
  const matchingGender = voices
    .filter(v => v.lang.startsWith(langPrefix) && matchesGender(v.name, gender, locale))
    .sort((a, b) => qualityScore(b.name) - qualityScore(a.name));
  if (matchingGender.length > 0) return { voice: matchingGender[0], genderFallback: false };
  // 2) locale 만 매칭 (gender 매칭 실패). 같은 언어 최고 quality voice.
  // → 사용자가 male 선택했는데 ko male voice 가 없으면 여기로 와서 Yuna 같은 voice 반환.
  //   genderFallback=true 표시해서 호출부가 pitch 로 보정 가능.
  const matchingLang = voices
    .filter(v => v.lang.startsWith(langPrefix))
    .sort((a, b) => qualityScore(b.name) - qualityScore(a.name));
  if (matchingLang.length > 0) return { voice: matchingLang[0], genderFallback: true };
  return { voice: null, genderFallback: false };
}

let voicesPrimed = false;
function primeVoices() {
  if (voicesPrimed) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.getVoices();
  try {
    window.speechSynthesis.onvoiceschanged = () => {
      voicesPrimed = true;
    };
  } catch {}
  voicesPrimed = true;
}

// build 226 #1: 마일스톤별 친근하고 짧은 메시지. 너무 길면 기계음 티가 나기 쉬워서 한 호흡으로
// 마칠 수 있는 분량. 5km / 10km / 21.0975 (하프) / 42.195 (풀) 는 더 응원하는 톤.
function buildMilestoneMessage(totalKm: number, locale: 'ko' | 'en'): string {
  const km = Math.round(totalKm * 10) / 10;
  const isHalf = Math.abs(km - 21.1) < 0.1 || Math.abs(km - 21.0) < 0.1;
  const isFull = Math.abs(km - 42.2) < 0.1 || Math.abs(km - 42.0) < 0.1;
  if (locale === 'en') {
    if (isFull) return `Full marathon! You did it. Incredible run.`;
    if (isHalf) return `Half marathon! Amazing. Keep going.`;
    if (km === 10) return `Ten kilometers! You're on fire today.`;
    if (km === 5) return `Five kilometers! Nice and steady.`;
    if (km === 1) return `One kilometer. Nice pace, off to a good start.`;
    if (km % 1 === 0) return `${km} kilometers. Looking strong.`;
    return `${km} kilometers. You've got this.`;
  }
  // ko
  if (isFull) return `풀 마라톤! 해냈어요. 정말 대단해요.`;
  if (isHalf) return `하프 마라톤! 잘 왔어요. 끝까지 같이 가요.`;
  if (km === 10) return `10킬로 통과! 오늘 컨디션 좋네요.`;
  if (km === 5) return `5킬로 통과! 페이스 좋아요.`;
  if (km === 1) return `1킬로 통과. 가볍게 시작했어요.`;
  if (km % 1 === 0) return `${km}킬로 통과. 잘하고 있어요.`;
  return `${km}킬로 통과. 천천히 같이 가요.`;
}

/** 발화 — Web Speech API + iOS native voice 선택. 사용자가 OFF 했거나 unsupported 면 no-op. */
export function speakMilestone(args: {
  totalKm: number;
  elapsedSeconds: number;
  avgPaceSecPerKm: number | null;
  locale: 'ko' | 'en';
}) {
  if (!isVoiceCueEnabled()) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  primeVoices();

  const { totalKm, locale } = args;
  const text = buildMilestoneMessage(totalKm, locale);

  try {
    const gender = getVoiceGender();
    const picked = pickBestVoice(locale, gender);
    const u = new SpeechSynthesisUtterance(text);
    if (picked.voice) {
      u.voice = picked.voice;
      u.lang = picked.voice.lang;
    } else {
      u.lang = locale === 'en' ? 'en-US' : 'ko-KR';
    }
    // build 226: 자연스러운 prosody 를 위해 rate 살짝 느림 (0.92).
    // 남성 fallback (ko 남성 voice 없는 경우) 시 pitch 0.65 로 크게 낮춰 다른 caractère 부여.
    // 일반 남성: 0.88, 여성: 1.04 (살짝 밝은 톤).
    u.rate = 0.92;
    if (gender === 'male') {
      u.pitch = picked.genderFallback ? 0.65 : 0.88;
    } else {
      u.pitch = 1.04;
    }
    u.volume = 1.0;
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

/** 짧은 인사 발화 — 성별 토글 직후 미리듣기용. build 226: 친근한 톤. */
export function speakGreetingSample(locale: 'ko' | 'en') {
  if (!isVoiceCueEnabled()) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  primeVoices();
  const text = locale === 'en'
    ? 'Hey, ready to run? I will be with you the whole way.'
    : '안녕하세요. 오늘도 같이 달려요. 끝까지 함께할게요.';
  try {
    const gender = getVoiceGender();
    const picked = pickBestVoice(locale, gender);
    const u = new SpeechSynthesisUtterance(text);
    if (picked.voice) {
      u.voice = picked.voice;
      u.lang = picked.voice.lang;
    } else {
      u.lang = locale === 'en' ? 'en-US' : 'ko-KR';
    }
    u.rate = 0.92;
    if (gender === 'male') {
      u.pitch = picked.genderFallback ? 0.65 : 0.88;
    } else {
      u.pitch = 1.04;
    }
    u.volume = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
