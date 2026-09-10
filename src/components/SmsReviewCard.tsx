import React, { useState } from 'react';
import { Check, MessageSquareText, Pencil, RotateCcw, Save, X } from 'lucide-react';
import { Category, PaymentCard } from '../types';
import { formatKRW } from '../utils/calculations';
import { SmsReviewCandidate } from '../utils/smsImport';

interface SmsReviewCardProps {
  candidates: SmsReviewCandidate[];
  categories: Category[];
  paymentCards: PaymentCard[];
  onApprove: (candidate: SmsReviewCandidate) => Promise<void>;
  onDismiss: (candidate: SmsReviewCandidate) => Promise<void>;
  onUpdate: (candidate: SmsReviewCandidate) => void;
}

export const SmsReviewCard: React.FC<SmsReviewCardProps> = ({
  candidates,
  categories,
  paymentCards,
  onApprove,
  onDismiss,
  onUpdate,
}) => {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SmsReviewCandidate | null>(null);
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

              {editing?.fingerprint === candidate.fingerprint ? (
                <div className="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/80 p-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">
                    <span>사용처</span>
                    <input
                      value={editing.merchant}
                      onChange={event => setEditing({ ...editing, merchant: event.target.value })}
                      className="min-h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-400">
                    <span>금액</span>
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={editing.amount}
                      onChange={event => setEditing({ ...editing, amount: Math.max(0, Number(event.target.value)) })}
                      className="min-h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-400">
                    <span>사용일</span>
                    <input
                      type="date"
                      value={editing.localDate}
                      onChange={event => {
                        const localDate = event.target.value;
                        const occurredAt = localDate
                          ? new Date(`${localDate}T12:00:00`).toISOString()
                          : editing.occurredAt;
                        setEditing({ ...editing, localDate, occurredAt });
                      }}
                      className="min-h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-400">
                    <span>카드</span>
                    <select
                      value={editing.matchedCardId || ''}
                      onChange={event => setEditing({ ...editing, matchedCardId: event.target.value || null })}
                      className="min-h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    >
                      <option value="">카드 미연결</option>
                      {paymentCards.map(item => <option key={item.id} value={item.id}>{item.cardName}</option>)}
                    </select>
                  </label>
                  {!isCancellation && (
                    <label className="space-y-1 text-xs text-slate-400">
                      <span>카테고리</span>
                      <select
                        value={editing.suggestedCategoryId}
                        onChange={event => setEditing({ ...editing, suggestedCategoryId: event.target.value })}
                        className="min-h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                      >
                        {categories.filter(item => item.type === 'expense' && item.active).map(item => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="flex gap-2 sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="min-h-10 flex-1 border border-slate-700 px-3 text-xs font-bold text-slate-300"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      disabled={!editing.merchant.trim() || editing.amount <= 0 || !editing.localDate}
                      onClick={() => {
                        onUpdate({ ...editing, merchant: editing.merchant.trim() });
                        setEditing(null);
                      }}
                      className="flex min-h-10 flex-1 items-center justify-center gap-2 bg-sky-500 px-3 text-xs font-bold text-slate-950 disabled:opacity-40"
                    >
                      <Save className="h-4 w-4" /> 수정 저장
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(workingId)}
                  onClick={() => setEditing({ ...candidate })}
                  className="flex min-h-10 w-full items-center justify-center gap-2 border border-slate-700 bg-slate-950 px-3 text-xs font-bold text-slate-300 disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" /> 금액·사용처·카드·카테고리 수정
                </button>
              )}

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
