import { MessageSquareText, X } from 'lucide-react';

interface SmsFoundBannerProps {
  count: number;
  onReview: () => void;
  onDismiss: () => void;
}

/**
 * Shown on opening or returning to the app when card messages are waiting.
 * Nothing is recorded until the user approves each one on the review card.
 */
export const SmsFoundBanner: React.FC<SmsFoundBannerProps> = ({ count, onReview, onDismiss }) => (
  <div
    role="status"
    className="fixed inset-x-3 z-50 mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-sky-500/45 bg-slate-900/95 p-2.5 pl-3.5 text-xs shadow-xl shadow-black/40 backdrop-blur"
    style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
  >
    <MessageSquareText className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
    <p className="min-w-0 flex-1 font-semibold text-slate-100">결제 문자 {count}건을 찾았어요</p>
    <button type="button" onClick={onReview} className="min-h-9 rounded-lg bg-sky-500 px-3 font-extrabold text-slate-950 hover:bg-sky-400">
      확인하기
    </button>
    <button type="button" onClick={onDismiss} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200" aria-label="결제 문자 알림 닫기">
      <X className="h-4 w-4" />
    </button>
  </div>
);
