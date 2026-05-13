'use client';

// 성별 배지 (build 116 A 패키지) — 작은 아이콘만, 배경 없음.
// 데이팅 앱 인상 회피. show_gender=false 면 노출 X.

interface Props {
  gender: 'male' | 'female' | null | undefined;
  show?: boolean;          // profiles.show_gender (기본 true)
  size?: number;            // px
  className?: string;
}

export default function GenderBadge({ gender, show = true, size = 12, className = '' }: Props) {
  if (!show || (gender !== 'male' && gender !== 'female')) return null;
  const color = gender === 'male' ? 'text-sky-500' : 'text-pink-500';
  const symbol = gender === 'male' ? '♂' : '♀';
  return (
    <span
      className={`inline-flex items-center justify-center font-bold ${color} ${className}`}
      style={{ fontSize: size }}
      aria-label={gender === 'male' ? '남성' : '여성'}
      title={gender === 'male' ? '남성' : '여성'}
    >
      {symbol}
    </span>
  );
}
