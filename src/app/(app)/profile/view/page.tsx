'use client';

// /profile/view 는 /social/user 로 통합 (사용자 피드백 #8: 친구 정보를 dashboard 스타일로).
// /social/user 가 이미 캘린더 + 그래프 + 배지 + PB + 액션 버튼을 갖춘 풍부한 뷰.
// 기존 호출자(쪽지/클럽/랭킹/댓글/UserRow)들의 링크를 일괄 수정하지 않고 한 곳에서 redirect.

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function Redirector() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');

  useEffect(() => {
    if (id) {
      router.replace(`/social/user?id=${id}`);
    } else {
      router.replace('/social');
    }
  }, [id, router]);

  return (
    <div className="flex justify-center py-20">
      <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
    </div>
  );
}

export default function ProfileViewRedirect() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    }>
      <Redirector />
    </Suspense>
  );
}
