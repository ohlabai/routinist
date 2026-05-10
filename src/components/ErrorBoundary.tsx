'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  screenPath: string;
}

// 빌드 번호 — iOS Xcode CURRENT_PROJECT_VERSION 과 sync. 회귀 디버그 가속용 (사용자 피드백 추가제안).
// fastlane/Xcode 가 ios/App/App.xcodeproj 의 CURRENT_PROJECT_VERSION 만 올리므로 여기도 함께 갱신.
const APP_BUILD = '81';

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      screenPath: typeof window !== 'undefined' ? window.location.pathname : '',
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      screenPath: typeof window !== 'undefined' ? window.location.pathname : '',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const screenPath = typeof window !== 'undefined' ? window.location.pathname : '';
    console.error('[ErrorBoundary]', { build: APP_BUILD, screen: screenPath, error, stack: info.componentStack });
    // 서버에 클라 오류 전송 — 다음 회귀 디버그 가속 (사용자 피드백: build/screen 컨텍스트 보강)
    import('@/lib/error-logger').then(({ logClientError }) => {
      logClientError('ErrorBoundary', error.message, {
        build: APP_BUILD,
        screen: screenPath,
        stack: error.stack?.slice(0, 2000),
        componentStack: info.componentStack?.slice(0, 1000),
      });
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] p-6 text-center">
          <p className="text-4xl mb-4">😵</p>
          <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">앗, 문제가 발생했어요</h2>
          <p className="text-sm text-[var(--muted)] mb-6 max-w-xs">
            일시적인 오류입니다. 앱을 다시 시작해주세요.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, screenPath: '' });
              window.location.href = '/dashboard';
            }}
            className="px-6 py-3 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm"
          >
            홈으로 돌아가기
          </button>
          <p className="text-[10px] text-[var(--muted)] mt-4">
            build {APP_BUILD} · {this.state.screenPath || '/'}
          </p>
          {this.state.error && (
            <p className="text-xs text-[var(--muted)] mt-2 max-w-xs break-all">
              {this.state.error.message}
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
