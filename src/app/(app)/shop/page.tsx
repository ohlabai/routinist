'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';

// Cafe24 모바일 스토어. 앱 내 iframe 임베드 - 빈 응답이면 index.html 명시 폴백.
const SHOP_BASE = 'https://routinist.kr';
const SHOP_URLS = [
  `${SHOP_BASE}/`,
  `${SHOP_BASE}/index.html`,
];

const LOAD_TIMEOUT_MS = 15000;

function isNativeApp() {
  return typeof window !== 'undefined' && (window as unknown as { Capacitor?: unknown }).Capacitor !== undefined;
}

export default function ShopPage() {
  // build 67: Cafe24 GNB 가 첫 화면부터 정상 노출되는 게 확인됐으므로 자체 헤더 제거.
  // 햄버거/검색/카트 모두 Cafe24 의 모바일 헤더 사용 — 중복 제거.
  const [urlIdx, setUrlIdx] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  const currentUrl = SHOP_URLS[urlIdx];

  useEffect(() => {
    loadedRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!loadedRef.current) {
        // 첫 URL 실패하면 대체 URL 시도, 그래도 실패하면 blocked
        if (urlIdx < SHOP_URLS.length - 1) {
          setUrlIdx(i => i + 1);
          setReloadKey(k => k + 1);
        } else {
          setBlocked(true);
          setLoading(false);
        }
      }
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [reloadKey, urlIdx]);

  const handleReload = () => {
    setLoading(true);
    setBlocked(false);
    setUrlIdx(0);
    setReloadKey(k => k + 1);
  };

  const openExternal = async () => {
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: SHOP_URLS[0], presentationStyle: 'fullscreen' });
    } else {
      window.open(SHOP_URLS[0], '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="relative h-full min-h-full bg-white flex flex-col">
      {/* iframe — Cafe24 모바일 스토어 임베드. 자체 헤더 제거 (build 67) — Cafe24 GNB 사용.
          상단 safe-area 는 (app)/layout.tsx 가 isShop 일 때 흰 padding 으로 처리. */}
      {!blocked && (
        <iframe
          ref={iframeRef}
          key={`${urlIdx}-${reloadKey}`}
          src={currentUrl}
          className="flex-1 block w-full border-0 bg-white"
          onLoad={() => {
            loadedRef.current = true;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            setLoading(false);
          }}
          onError={() => {
            if (urlIdx < SHOP_URLS.length - 1) {
              setUrlIdx(i => i + 1);
              setReloadKey(k => k + 1);
            } else {
              setBlocked(true);
            }
          }}
          allow="clipboard-read; clipboard-write; payment; geolocation; fullscreen; accelerometer; gyroscope"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-modals allow-downloads"
          referrerPolicy="no-referrer-when-downgrade"
          title="Routinist Store"
          loading="eager"
        />
      )}

      {/* 로딩 중엔 흰 배경 + 아주 옅은 스피너만 — "불러오는 중" 문구 제거로 덜 튀게 */}
      {!blocked && loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white z-10 pointer-events-none">
          <div className="animate-spin w-7 h-7 border-2 border-emerald-400 border-t-transparent rounded-full opacity-70" />
        </div>
      )}

      {blocked && (
        <div className="h-full flex flex-col items-center justify-center px-6 space-y-5 bg-gradient-to-br from-emerald-50 to-white">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-lg flex items-center justify-center">
            <AlertCircle size={28} className="text-emerald-600" />
          </div>
          <div className="text-center space-y-2 max-w-sm">
            <h2 className="text-lg font-bold text-gray-800">쇼핑몰을 불러올 수 없어요</h2>
            <p className="text-sm text-gray-500 leading-6">
              네트워크가 느리거나 일시적인 연결 문제일 수 있어요.<br/>
              다시 시도하거나 외부 브라우저로 여실 수 있습니다.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <button
              onClick={handleReload}
              className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold py-3 rounded-xl shadow-sm"
            >
              <RefreshCw size={16} /> 다시 시도
            </button>
            <button
              onClick={openExternal}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold py-3 rounded-xl shadow-md"
            >
              <ExternalLink size={16} /> 외부 브라우저로 열기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
