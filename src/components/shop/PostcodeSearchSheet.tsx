'use client';

// build 182: 주소검색 bottom-sheet.
// 다음(카카오) 우편번호 서비스 v2 를 embed 모드로 띄움. 한국 표준 우편번호 검색 UX.
// iOS Capacitor WebView 에서도 외부 스크립트만 로드되면 동작.

import { useEffect, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';

export interface PostcodeResult {
  zonecode: string;
  address: string;
  roadAddress: string;
  buildingName: string;
  bname: string;
}

interface Props {
  onClose: () => void;
  onComplete: (result: PostcodeResult) => void;
}

interface DaumPostcodeData {
  zonecode: string;
  address: string;
  roadAddress: string;
  jibunAddress: string;
  buildingName: string;
  bname: string;
}

interface DaumPostcodeAPI {
  embed: (el: HTMLElement) => void;
}

interface DaumPostcodeConstructor {
  new (options: {
    oncomplete: (data: DaumPostcodeData) => void;
    onresize?: (size: { width: number; height: number }) => void;
    width?: string | number;
    height?: string | number;
  }): DaumPostcodeAPI;
}

interface DaumGlobal {
  Postcode: DaumPostcodeConstructor;
}

declare global {
  interface Window { daum?: DaumGlobal }
}

const SCRIPT_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.daum?.Postcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('스크립트 로드 실패')));
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('스크립트 로드 실패'));
    document.head.appendChild(s);
  });
}

export default function PostcodeSearchSheet({ onClose, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled) return;
        if (!containerRef.current || !window.daum?.Postcode) {
          setError('주소검색 서비스를 불러올 수 없어요');
          setLoading(false);
          return;
        }
        try {
          new window.daum.Postcode({
            oncomplete: (data) => {
              onComplete({
                zonecode: data.zonecode,
                address: data.roadAddress || data.address,
                roadAddress: data.roadAddress,
                buildingName: data.buildingName,
                bname: data.bname,
              });
            },
            width: '100%',
            height: '100%',
          }).embed(containerRef.current);
          setLoading(false);
        } catch (e) {
          console.warn('[Postcode] init 실패', e);
          setError('주소검색을 시작하지 못했어요');
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError('네트워크 연결을 확인해 주세요');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--background)] w-full max-w-lg h-[90vh] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-lg border-b border-[var(--card-border)] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search size={18} className="text-emerald-500" />
            <h2 className="text-base font-extrabold text-[var(--foreground)]">주소 검색</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--card-border)]/40 flex items-center justify-center active:scale-95 transition"
            aria-label="닫기"
          >
            <X size={18} className="text-[var(--foreground)]" />
          </button>
        </div>
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--background)]">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-[var(--muted)]">주소검색 불러오는 중…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--background)] px-6">
              <p className="text-sm text-rose-500 font-semibold text-center">{error}</p>
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-bold active:scale-95"
              >
                닫기
              </button>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
