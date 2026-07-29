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
