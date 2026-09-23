import React, { useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface MigrationFailedScreenProps {
  onRetry: () => Promise<void> | void;
}

/**
 * Shown instead of the dashboard when the server could not verify the legacy
 * data copy. Retry is the only action: nothing is created or saved from here.
 */
export const MigrationFailedScreen: React.FC<MigrationFailedScreenProps> = ({ onRetry }) => {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div role="alert" className="w-full max-w-sm text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-400 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="font-bold">기존 데이터 이전 검증에 실패했습니다.</p>
          <p className="text-sm text-slate-400 leading-relaxed">
            원본은 그대로 있습니다. 관리자에게 알려 주세요.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-60"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          {isRetrying ? '확인 중…' : '다시 시도'}
        </button>
      </div>
    </div>
  );
};
