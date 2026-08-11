import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Modal } from './Modal';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  message: string;
  description?: string;
  tone?: ToastTone;
  /** Auto-dismiss delay. Defaults to 4s, or 10s when an action is present. */
  durationMs?: number;
  action?: ToastAction;
}

export interface ConfirmDetail {
  label: string;
  value: string;
}

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Rendered as a definition list so the user sees exactly what is affected. */
  details?: ConfirmDetail[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** When set, the confirm button stays disabled until the user types this text. */
  requireText?: string;
}

interface ToastEntry extends ToastOptions {
  id: string;
}

interface FeedbackContextValue {
  showToast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { wrapper: string; icon: React.ElementType; iconColor: string }> = {
  success: {
    wrapper: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
  },
  error: {
    wrapper: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
    icon: XCircle,
    iconColor: 'text-rose-400',
  },
  warning: {
    wrapper: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
  },
  info: {
    wrapper: 'border-slate-700 bg-slate-900 text-slate-100',
    icon: Info,
    iconColor: 'text-slate-300',
  },
};

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmOptions & { resolve: (accepted: boolean) => void }) | null
  >(null);
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const timers = useRef(new Map<string, number>());
  const titleId = 'confirm-dialog-title';

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const showToast = useCallback((options: ToastOptions) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const duration = options.durationMs ?? (options.action ? 10000 : 4000);
    setToasts(current => [...current.slice(-2), { ...options, id }]);
    if (duration > 0) {
      timers.current.set(id, window.setTimeout(() => dismissToast(id), duration));
    }
    return id;
  }, [dismissToast]);

  const confirm = useCallback((options: ConfirmOptions) => {
    setTypedConfirmation('');
    return new Promise<boolean>(resolve => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const settleConfirm = useCallback((accepted: boolean) => {
    setConfirmState(current => {
      current?.resolve(accepted);
      return null;
    });
    setTypedConfirmation('');
  }, []);

  const value = useMemo<FeedbackContextValue>(
    () => ({ showToast, dismissToast, confirm }),
    [showToast, dismissToast, confirm],
  );

  const isDanger = confirmState?.tone === 'danger';
  const confirmBlocked = Boolean(confirmState?.requireText)
    && typedConfirmation.trim() !== confirmState?.requireText;

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {/* Toast stack sits above the bottom navigation and the iOS home indicator. */}
      <div
        className="fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div aria-live="polite" aria-atomic="false" className="sr-only">
          {toasts.filter(toast => toast.tone !== 'error').map(toast => (
            <span key={toast.id}>{toast.message}</span>
          ))}
        </div>

        {toasts.map(toast => {
          const tone = TONE_STYLES[toast.tone || 'info'];
          const ToneIcon = tone.icon;
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto w-full max-w-md rounded-xl border px-3.5 py-3 text-xs shadow-xl backdrop-blur-md ${tone.wrapper}`}
            >
              <div className="flex items-start gap-2.5">
                <ToneIcon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.iconColor}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug">{toast.message}</p>
                  {toast.description && (
                    <p className="mt-1 leading-relaxed text-slate-300">{toast.description}</p>
                  )}
                </div>
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onAction();
                      dismissToast(toast.id);
                    }}
                    className="shrink-0 rounded-lg border border-slate-600 bg-slate-950/60 px-2.5 py-1.5 font-bold text-slate-100 transition-colors hover:bg-slate-800"
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="알림 닫기"
                  className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:text-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        isOpen={Boolean(confirmState)}
        onClose={() => settleConfirm(false)}
        labelledById={titleId}
        dismissOnBackdrop={!confirmState?.requireText}
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl"
        backdropClassName="fixed inset-0 z-[70] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4"
      >
        {confirmState && (
          <>
            <div className="flex items-start gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                  isDanger
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-slate-700 bg-slate-950 text-slate-300'
                }`}
              >
                {isDanger ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 id={titleId} className="text-sm font-bold text-slate-100">
                  {confirmState.title}
                </h2>
                {confirmState.description && (
                  <p className="text-xs leading-relaxed text-slate-400">{confirmState.description}</p>
                )}
              </div>
            </div>

            {confirmState.details && confirmState.details.length > 0 && (
              <dl className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
                {confirmState.details.map(detail => (
                  <div key={detail.label} className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-slate-400">{detail.label}</dt>
                    <dd className="min-w-0 break-words text-right font-semibold text-slate-100">
                      {detail.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {confirmState.requireText && (
              <label className="block space-y-1.5 text-xs">
                <span className="text-slate-400">
                  계속하려면 <span className="font-bold text-rose-300">{confirmState.requireText}</span> 를 입력하세요.
                </span>
                <input
                  type="text"
                  data-autofocus
                  value={typedConfirmation}
                  onChange={event => setTypedConfirmation(event.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-rose-500 focus:outline-none"
                />
              </label>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => settleConfirm(false)}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
              >
                {confirmState.cancelLabel || '취소'}
              </button>
              <button
                type="button"
                data-autofocus={confirmState.requireText ? undefined : true}
                disabled={confirmBlocked}
                onClick={() => settleConfirm(true)}
                className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  isDanger
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'bg-emerald-500 text-slate-950 hover:bg-emerald-600'
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </>
        )}
      </Modal>
    </FeedbackContext.Provider>
  );
};

function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('FeedbackProvider 안에서만 사용할 수 있습니다.');
  }
  return context;
}

export function useToast() {
  const { showToast, dismissToast } = useFeedback();
  return { showToast, dismissToast };
}

export function useConfirm() {
  return useFeedback().confirm;
}
