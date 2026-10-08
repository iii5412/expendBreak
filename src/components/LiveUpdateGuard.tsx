import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { applyLiveUpdateNow, liveUpdateReady, startLiveUpdates } from '../utils/liveUpdate';

/**
 * Mounted beside the app inside the app-level error boundary: if the app fails
 * to render, this never mounts, the updater never hears "ready", and it rolls
 * back to the previous bundle on its own.
 *
 * Also offers a downloaded update right away. Applying reloads the screen, so
 * it is the user's choice; "나중에" leaves it for the next long break.
 */
export const LiveUpdateGuard: React.FC = () => {
  useEffect(() => startLiveUpdates(), []);
  const readyVersion = useSyncExternalStore(liveUpdateReady.subscribe, liveUpdateReady.get);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  if (!readyVersion || dismissed === readyVersion) return null;

  return (
    <div role="status" className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-2.5 pl-3.5 text-xs shadow-xl shadow-black/40 backdrop-blur">
      <RefreshCw className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
      <p className="min-w-0 flex-1 font-semibold text-slate-100">새 버전이 준비됐어요</p>
      <button
        type="button"
        disabled={applying}
        onClick={() => {
          setApplying(true);
          void applyLiveUpdateNow().then(reloading => { if (!reloading) setApplying(false); });
        }}
        className="flex min-h-9 items-center gap-1 rounded-lg bg-emerald-500 px-3 font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        지금 적용
      </button>
      <button type="button" onClick={() => setDismissed(readyVersion)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200" aria-label="나중에 적용">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
