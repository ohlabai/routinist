'use client';

// build 136: 단일 에세이 보기 페이지 숨김 — 한 줄 일기는 사진 카드 안에서 캡션으로 표시.
// 직접 URL 접근 시 소셜로 redirect.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EssayViewHiddenRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/social'); }, [router]);
  return null;
}
