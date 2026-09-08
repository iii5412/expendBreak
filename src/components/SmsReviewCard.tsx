import React, { useState } from 'react';
import { Check, MessageSquareText, RotateCcw, X } from 'lucide-react';
import { Category, PaymentCard } from '../types';
import { formatKRW } from '../utils/calculations';
import { SmsReviewCandidate } from '../utils/smsImport';

interface SmsReviewCardProps {
  candidates: SmsReviewCandidate[];
  categories: Category[];
  paymentCards: PaymentCard[];
  onApprove: (candidate: SmsReviewCandidate) => Promise<void>;
  onDismiss: (candidate: SmsReviewCandidate) => Promise<void>;
}

export const SmsReviewCard: React.FC<SmsReviewCardProps> = ({
  candidates,
  categories,
  paymentCards,
  onApprove,
  onDismiss,
}) => {
  const [workingId, setWorkingId] = useState<string | null>(null);
  if (candidates.length === 0) return null;

  const run = async (candidate: SmsReviewCandidate, action: 'approve' | 'dismiss') => {
    if (workingId) return;
    setWorkingId(candidate.fingerprint);
    try {
      await (action === 'approve' ? onApprove(candidate) : onDismiss(candidate));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-sky-500/35 bg-sky-500/5" aria-label="SMS 지출 후보">
      <div className="flex items-start gap-3 border-b border-sky-500/20 px-4 py-3">
        <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
        <div>
          <h2 className="text-sm font-bold text-sky-100">SMS 확인 대기 {candidates.length}건</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">아직 지출에 반영되지 않았습니다. 내용을 확인한 뒤 승인해 주세요.</p>
        </div>
      </div>

      <div className="divide-y divide-slate-800/80">
        {candidates.map(candidate => {
          const card = paymentCards.find(item => item.id === candidate.matchedCardId);
          const category = categories.find(item => item.id === candidate.suggestedCategoryId);
          const working = workingId === candidate.fingerprint;
          const isCancellation = candidate.kind === 'cancellation';
          return (
            <article key={candidate.fingerprint} className="space-y-3 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm text-white">{candidate.merchant}</strong>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${isCancellation ? 'bg-amber-500/15 text-amber-200' : 'bg-sky-500/15 text-sky-200'}`}>
                      {isCancellation ? '승인취소 후보' : '지출 후보'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {candidate.localDate} · {card?.cardName || candidate.issuer || '카드 미연결'}
                    {!isCancellation && ` · ${category?.name || '카테고리 확인 필요'}`}
                  </p>
                </div>
                <strong className={`shrink-0 text-sm ${isCancellation ? 'text-amber-200' : 'text-rose-300'}`}>
                  {isCancellation ? '취소 ' : ''}{formatKRW(candidate.amount)}
                </strong>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={Boolean(workingId)}
                  onClick={() => void run(candidate, 'approve')}
                  className="flex min-h-11 items-center justify-center gap-2 border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-bold text-emerald-200 disabled:opacity-50"
                >
                  {isCancellation ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {working ? '처리 중…' : isCancellation ? '취소 반영' : '등록 승인'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(workingId)}
                  onClick={() => void run(candidate, 'dismiss')}
                  className="flex min-h-11 items-center justify-center gap-2 border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-slate-300 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  후보 제외
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
