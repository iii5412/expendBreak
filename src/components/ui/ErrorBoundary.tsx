import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { recordRenderError } from '../../utils/renderErrors';
import { resetAppCache } from '../../utils/cacheReset';

interface ErrorBoundaryProps {
  /** Shown in the diagnostic record, e.g. "analytics". */
  scope: string;
  /** `screen` replaces one area; `app` is the last line of defence and owns the whole page. */
  level?: 'screen' | 'app' | 'modal';
  /** Changing this value clears a caught error, e.g. the active tab. */
  resetKey?: string;
  onClose?: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`Render error in ${this.props.scope}:`, error);
    recordRenderError(this.props.scope, error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private retry = () => this.setState({ error: null });

  private reload = () => window.location.reload();

  private clearCacheAndRestart = () => {
    const { keptOutboxes } = resetAppCache();
    if (keptOutboxes.length > 0) {
      window.alert('아직 서버에 전송되지 않은 변경이 있어 그 데이터는 지우지 않았습니다. 연결이 되면 자동으로 전송됩니다.');
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { level = 'screen', onClose } = this.props;

    const buttonClass = 'min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-4 text-xs font-bold text-slate-100 hover:bg-slate-800';
    const body = (
      <div role="alert" className="mx-auto max-w-sm space-y-3 rounded-2xl border border-rose-500/30 bg-slate-900 p-5 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-rose-400" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-100">
          {level === 'app' ? '앱을 표시하지 못했습니다.' : '이 화면을 표시하지 못했습니다.'}
        </p>
        <p className="text-xs leading-relaxed text-slate-400">입력한 데이터는 안전합니다. 문제는 진단 내보내기 파일에 기록됩니다.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {level === 'app' ? (
            <>
              <button type="button" className={buttonClass} onClick={this.reload}>
                <RefreshCw className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />다시 불러오기
              </button>
              <button type="button" className={buttonClass} onClick={this.clearCacheAndRestart}>캐시 비우고 다시 시작</button>
            </>
          ) : (
            <>
              <button type="button" className={buttonClass} onClick={this.retry}>다시 시도</button>
              {level === 'modal' && onClose && <button type="button" className={buttonClass} onClick={onClose}>닫기</button>}
            </>
          )}
        </div>
      </div>
    );

    if (level === 'app') {
      return <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 p-6">{body}</div>;
    }
    if (level === 'modal') {
      return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4">{body}</div>;
    }
    return <div className="py-10">{body}</div>;
  }
}
