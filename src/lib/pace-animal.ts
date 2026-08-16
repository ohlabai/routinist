// 페이스 → 동물 매칭 — 러닝 완료·공유카드의 "오늘의 동물" 배지.
// 잔디 픽셀 스프라이트(pixel-sprites.ts)와 세트. 어감은 친근·동반 톤 (적대 표현 금지 룰).
// 신기록(PB) 달성 시엔 페이스와 무관하게 용(dragon)이 등장한다.

export interface PaceAnimal {
  name: string; // pixel-sprites 의 runner name
  label: string; // 한국어 동물명
  copy: string; // 완료 화면 축하 카피
}

const LADDER: Array<{ maxPaceSec: number; animal: PaceAnimal }> = [
  { maxPaceSec: 240, animal: { name: 'cheetah', label: '치타', copy: '치타처럼 질주했어요!' } },
  { maxPaceSec: 280, animal: { name: 'horse', label: '말', copy: '말처럼 힘차게 달렸어요!' } },
  { maxPaceSec: 320, animal: { name: 'dog', label: '강아지', copy: '강아지처럼 신나게 달렸어요!' } },
  { maxPaceSec: 360, animal: { name: 'rabbit', label: '토끼', copy: '토끼처럼 가볍게 뛰었어요!' } },
  { maxPaceSec: 400, animal: { name: 'cat', label: '고양이', copy: '고양이처럼 사뿐사뿐 달렸어요!' } },
  { maxPaceSec: 440, animal: { name: 'monkey', label: '원숭이', copy: '원숭이처럼 경쾌하게 달렸어요!' } },
  { maxPaceSec: 480, animal: { name: 'chicken', label: '닭', copy: '총총총, 닭처럼 부지런히 달렸어요!' } },
  { maxPaceSec: 540, animal: { name: 'elephant', label: '코끼리', copy: '코끼리처럼 묵직하게 완주했어요!' } },
];

const TURTLE: PaceAnimal = { name: 'turtle', label: '거북이', copy: '거북이처럼 꾸준히 완주했어요!' };
const DRAGON: PaceAnimal = { name: 'dragon', label: '용', copy: '최고 기록! 용처럼 날아올랐어요!' };

/**
 * @param avgPaceSecPerKm 평균 페이스 (초/km). null/0 이면 거북이.
 * @param isPersonalBest 신기록 달성 여부 — true 면 용.
 */
export function paceAnimal(avgPaceSecPerKm: number | null | undefined, isPersonalBest = false): PaceAnimal {
  if (isPersonalBest) return DRAGON;
  if (!avgPaceSecPerKm || avgPaceSecPerKm <= 0 || !Number.isFinite(avgPaceSecPerKm)) return TURTLE;
  for (const step of LADDER) {
    if (avgPaceSecPerKm < step.maxPaceSec) return step.animal;
  }
  return TURTLE;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-16 (hans): 러닝 중 구간 페이스 음성에 동물 비유를 붙인다.
//   "아주 느린 사람에게는 거북이처럼 꾸준하게 잘 달리고 있어요,
//    아주 빠른 사람한테는 치타처럼 어마어마하게 빨라요"
//
// 위 LADDER 와 **같은 임계값**을 쓴다 — 달리는 중에 들은 동물과 완주 후 배지 동물이
// 다르면 이상하다. 문구만 달라진다 (완료 카피는 과거형, 음성은 진행형).
//
// 티어당 2개를 두고 마일스톤 순번으로 번갈아 쓴다. 10km 면 10번 듣는데 같은 문장이
// 반복되면 금방 질린다.
//
// ⚠️ 네이티브(iOS/Android 플러그인)와 워치도 같은 사다리를 쓴다. 임계값을 바꾸면
//    RunSessionPlugin.swift / RunSessionEngine.kt 는 여기서 내려주는 배열을 그대로 받지만,
//    **워치(WorkoutManager.swift)는 자체 복사본**이라 같이 고쳐야 한다.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaceAnimalVoiceTier {
  /** 이 값 **미만**이면 이 티어. 0 이면 폴백(가장 느린 구간) */
  maxPaceSec: number;
  phrases: string[];
}

const VOICE_KO: PaceAnimalVoiceTier[] = [
  { maxPaceSec: 240, phrases: ['치타처럼 어마어마하게 빨라요!', '치타가 따로 없어요. 엄청난데요!'] },
  { maxPaceSec: 280, phrases: ['말처럼 힘차게 달리고 있어요!', '말처럼 시원하게 나가고 있어요!'] },
  { maxPaceSec: 320, phrases: ['강아지처럼 신나게 달리고 있어요!', '강아지처럼 즐겁게 가고 있어요!'] },
  { maxPaceSec: 360, phrases: ['토끼처럼 가볍게 뛰고 있어요!', '토끼처럼 통통 튀는 발걸음이에요!'] },
  { maxPaceSec: 400, phrases: ['고양이처럼 사뿐사뿐 달리고 있어요!', '고양이처럼 부드럽게 흐르고 있어요!'] },
  { maxPaceSec: 440, phrases: ['원숭이처럼 경쾌해요!', '원숭이처럼 리듬을 잘 타고 있어요!'] },
  { maxPaceSec: 480, phrases: ['총총총, 닭처럼 부지런해요!', '닭처럼 쉬지 않고 총총 가고 있어요!'] },
  { maxPaceSec: 540, phrases: ['코끼리처럼 묵직하게 가고 있어요!', '코끼리처럼 단단하게 밀고 있어요!'] },
  { maxPaceSec: 0, phrases: ['거북이처럼 꾸준하게 잘 달리고 있어요!', '거북이처럼 한 걸음씩, 그게 제일 강해요!'] },
];

const VOICE_EN: PaceAnimalVoiceTier[] = [
  { maxPaceSec: 240, phrases: ['Cheetah fast! Incredible.', "You're flying like a cheetah!"] },
  { maxPaceSec: 280, phrases: ['Galloping like a horse!', 'Strong as a horse out there!'] },
  { maxPaceSec: 320, phrases: ['Happy as a dog on a run!', "Bounding along like a puppy!"] },
  { maxPaceSec: 360, phrases: ['Light as a rabbit!', 'Hopping along like a rabbit!'] },
  { maxPaceSec: 400, phrases: ['Smooth like a cat!', 'Padding along, cat smooth!'] },
  { maxPaceSec: 440, phrases: ['Nimble as a monkey!', "You've got a monkey's rhythm!"] },
  { maxPaceSec: 480, phrases: ['Busy little chicken steps!', 'Steady as a chicken, never stopping!'] },
  { maxPaceSec: 540, phrases: ['Solid as an elephant!', 'Pushing on with elephant strength!'] },
  { maxPaceSec: 0, phrases: ["Steady as a turtle — that's the strongest kind!", 'Turtle steady, one step at a time!'] },
];

export function paceAnimalVoiceTiers(locale: 'ko' | 'en'): PaceAnimalVoiceTier[] {
  return locale === 'en' ? VOICE_EN : VOICE_KO;
}

/**
 * 구간 페이스 → 음성 한 마디.
 * @param splitPaceSecPerKm 이번 구간 페이스 (초/km). 없으면 가장 느린 티어.
 * @param index 마일스톤 순번 (1, 2, 3...) — 같은 티어 안에서 문구를 번갈아 쓰는 데 사용.
 */
export function paceAnimalVoicePhrase(
  splitPaceSecPerKm: number | null | undefined,
  locale: 'ko' | 'en',
  index = 0,
): string {
  const tiers = paceAnimalVoiceTiers(locale);
  const p = splitPaceSecPerKm;
  const tier = (p && p > 0 && Number.isFinite(p))
    ? tiers.find(t => t.maxPaceSec > 0 && p < t.maxPaceSec) ?? tiers[tiers.length - 1]
    : tiers[tiers.length - 1];
  return tier.phrases[Math.abs(index) % tier.phrases.length];
}
