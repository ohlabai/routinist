'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from './supabase';

export type DisplayNameStatus =
  | 'idle'
  | 'invalid'
  | 'checking'
  | 'available'
  | 'taken'
  | 'unchanged';

export interface DisplayNameCheck {
  status: DisplayNameStatus;
  message: string;
  /** 제출 가능한 상태 — available 또는 unchanged (본인 기존 닉네임 유지) */
  isValid: boolean;
}

/**
 * 닉네임 사용 가능 여부 실시간 체크.
 * - 입력 후 400ms debounce → RPC 호출
 * - excludeUserId: 본인 row 제외 (프로필 편집 시 자기 닉네임 유지 OK)
 * - originalName: 본인 기존 닉네임. 변경 안 됐으면 RPC 스킵하고 unchanged 반환
 */
export function useDisplayNameCheck(
  name: string,
  excludeUserId?: string | null,
  originalName?: string | null,
): DisplayNameCheck {
  const [state, setState] = useState<DisplayNameCheck>({
    status: 'idle',
    message: '',
    isValid: false,
  });
  const reqIdRef = useRef(0);

  useEffect(() => {
    const trimmed = name.trim();
    const reqId = ++reqIdRef.current;

    if (!trimmed) {
      setState({ status: 'idle', message: '', isValid: false });
      return;
    }
    // 본인 기존 닉네임과 동일 — 통과 (변경 안 함)
    if (originalName && trimmed === originalName.trim()) {
      setState({ status: 'unchanged', message: '', isValid: true });
      return;
    }
    if (trimmed.length < 2) {
      setState({ status: 'invalid', message: '2자 이상 입력해주세요', isValid: false });
      return;
    }
    if (trimmed.length > 20) {
      setState({ status: 'invalid', message: '20자 이하로 입력해주세요', isValid: false });
      return;
    }

    setState({ status: 'checking', message: '확인 중...', isValid: false });

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await getSupabase().rpc('is_display_name_available', {
          p_name: trimmed,
          p_exclude_user: excludeUserId ?? null,
        });
        // 요청이 빠르게 바뀌었으면 결과 무시
        if (reqId !== reqIdRef.current) return;
        if (error) throw error;
        if (data === true) {
          setState({ status: 'available', message: '사용 가능한 닉네임이에요', isValid: true });
        } else {
          setState({
            status: 'taken',
            message: '이미 사용 중이거나 사용할 수 없는 닉네임이에요',
            isValid: false,
          });
        }
      } catch {
        if (reqId !== reqIdRef.current) return;
        // 네트워크 실패 시엔 통과 — 서버에서 다시 검증되므로 사용자 차단보다 진행이 낫다.
        setState({ status: 'idle', message: '', isValid: true });
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [name, excludeUserId, originalName]);

  return state;
}
