import React, { useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, Loader2, RefreshCw, UploadCloud, WifiOff } from 'lucide-react';
import {
  SyncState,
  getSyncState,
  retryPendingWrites,
  subscribeToSyncStatus,
} from '../utils/syncStatus';
import { describePendingCollection, getPendingFirestoreWrites, syncPendingCountFromStorage } from '../utils/firestoreSync';
import { Modal } from './ui/Modal';

export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(getSyncState);
  useEffect(() => subscribeToSyncStatus(setState), []);
  return state;
}

const PHASE_STYLE: Record<SyncState['phase'], { label: string; className: string; icon: React.ElementType }> = {
  synced: {
    label: '저장 완료',
    className: 'border-slate-700 bg-slate-800 text-slate-300',
    icon: CheckCircle2,
  },
  syncing: {
    label: '저장 중',
    className: 'border-slate-700 bg-slate-800 text-slate-200',
    icon: Loader2,
  },
  pending: {
    label: '미반영',
    className: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
    icon: UploadCloud,
  },
  offline: {
    label: '오프라인',
    className: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
    icon: CloudOff,
  },
};

/** Navbar badge that always tells the user whether local edits reached the server. */
export const SyncStatusIndicator: React.FC = () => {
  const state = useSyncState();
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(() => getPendingFirestoreWrites());

  useEffect(() => {
    syncPendingCountFromStorage();
  }, []);

  useEffect(() => {
    if (!isPanelOpen) return;
    setPendingWrites(getPendingFirestoreWrites());
  }, [isPanelOpen, state.pendingCount, state.phase]);

  const style = PHASE_STYLE[state.phase];
  const StatusIcon = style.icon;
  const hasProblem = state.phase === 'pending' || state.phase === 'offline';

  const handleRetry = async () => {
    setIsRetrying(true);
    await retryPendingWrites();
    setPendingWrites(getPendingFirestoreWrites());
    setIsRetrying(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsPanelOpen(true)}
        aria-label={`동기화 상태: ${style.label}${state.pendingCount > 0 ? `, 미반영 ${state.pendingCount}건` : ''}`}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${style.className}`}
      >
        <StatusIcon className={`h-3.5 w-3.5 ${state.phase === 'syncing' ? 'animate-spin' : ''}`} />
        <span className={hasProblem ? 'font-bold' : 'hidden sm:inline'}>
          {hasProblem ? `미반영 ${state.pendingCount}` : style.label}
        </span>
      </button>

      <Modal
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        labelledById="sync-panel-title"
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 id="sync-panel-title" className="text-sm font-bold text-slate-100">
              저장 상태
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {state.phase === 'synced'
                ? '모든 변경사항이 DB에 반영되었습니다.'
                : `DB에 반영되지 않은 변경 ${state.pendingCount}건이 이 기기에 보관되어 있습니다.`}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-bold ${style.className}`}>
            {style.label}
          </span>
        </div>

        {!state.isOnline && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              네트워크에 연결되어 있지 않습니다. 기록은 이 기기에 안전하게 보관되며, 연결이 복구되면 자동으로 반영됩니다.
            </span>
          </div>
        )}

        {state.lastError && (
          <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            마지막 오류: {state.lastError}
          </p>
        )}

        {pendingWrites.length > 0 ? (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
            {pendingWrites.map(write => (
              <li
                key={write.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-slate-200">
                    {describePendingCollection(write.collectionName)}
                  </span>
                  <span className="ml-1.5 text-slate-400">
                    {write.operation === 'delete' ? '삭제' : '저장'}
                  </span>
                  <div className="truncate text-xs text-slate-400">{write.documentId}</div>
                </div>
                <time className="shrink-0 text-xs text-slate-400" dateTime={write.queuedAt}>
                  {write.queuedAt.slice(5, 16).replace('T', ' ')}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-center text-xs text-slate-400">
            대기 중인 변경사항이 없습니다.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsPanelOpen(false)}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying || pendingWrites.length === 0}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>{isRetrying ? '재시도 중' : '전체 재시도'}</span>
          </button>
        </div>
      </Modal>
    </>
  );
};

/** Persistent banner so offline state is visible without opening the panel. */
export const OfflineBanner: React.FC = () => {
  const state = useSyncState();
  if (state.isOnline) return null;

  return (
    <div
      role="status"
      className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-center text-xs text-rose-200"
    >
      <WifiOff className="mr-1.5 inline h-3.5 w-3.5" />
      오프라인 상태입니다. 기록은 기기에 저장되고 연결되면 자동으로 반영됩니다
      {state.pendingCount > 0 ? ` (미반영 ${state.pendingCount}건)` : ''}.
    </div>
  );
};
