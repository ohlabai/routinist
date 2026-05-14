'use client';

// build 136: 러너의 에세이 페이지 숨김 — 한 줄 일기로 통합되고 소셜 탭에 노출.
// 직접 URL 접근 시 소셜로 redirect.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EssaysHiddenRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/social'); }, [router]);
  return null;
}
