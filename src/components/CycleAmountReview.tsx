import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckSquare, Square } from 'lucide-react';
import type { BankAccount, PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { AccountingPeriod, formatKRW, formatPeriodRange, getYearMonthForDate } from '../utils/calculations';
import { resolveRecurringAmount, ResolvedRecurringAmount } from '../utils/recurringAmounts';
import { AmountInput } from './ui/AmountInput';
import { useToast } from './ui/FeedbackProvider';

/**
 * Cycle-start amount confirmation (PRD-ui-renewal §6).
 *
 * The user fixes only the items that changed since the previous cycle and
 * confirms the rest in one action. Confirming an amount never posts a payment,
 * creates a transaction or moves money; it only pins this cycle's figure.
 */

export interface CycleAmountConfirmResult {
  confirmed: string[];
  failed: string[];
  /** Operation ids of the applied changes, for a one-tap undo. */
  operationIds?: string[];
}

export interface CycleAmountReviewItem {
  occurrence: RecurringOccurrence;
  template?: RecurringTemplate;
  type: 'income' | 'expense';
}

interface CycleAmountReviewProps {
  period: AccountingPeriod;
  /** Every non-skipped occurrence of the cycle, confirmed ones included (for the subtotal). */
  items: CycleAmountReviewItem[];
  transactions: Transaction[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  onConfirm?: (updates: Array<{ occurrenceId: string; amount: number }>) => void | Promise<void | CycleAmountConfirmResult>;
  onUndo?: (operationIds: string[]) => number;
  /** All saved rows; used to detect that a suggestion's source cycle changed since it was copied. */
  history?: RecurringOccurrence[];
}

type Draft = number | null;

const draftStorageKey = (yearMonth: string) => `eb.cycleAmountDrafts.${yearMonth}`;

function loadDrafts(yearMonth: string): Record<string, Draft> {
  try {
    const raw = localStorage.getItem(draftStorageKey(yearMonth));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDrafts(yearMonth: string, drafts: Record<string, Draft>) {
  try {
    if (Object.keys(drafts).length === 0) localStorage.removeItem(draftStorageKey(yearMonth));
    else localStorage.setItem(draftStorageKey(yearMonth), JSON.stringify(drafts));
  } catch {
    // Drafts are a per-device convenience; losing them is not an error.
  }
}

const signedKRW = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatKRW(Math.abs(value))}`;

export const CycleAmountReview: React.FC<CycleAmountReviewProps> = ({
  period, items, transactions, bankAccounts, paymentCards, onConfirm, onUndo, history = [],
}) => {
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => loadDrafts(period.yearMonth));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [deferred, setDeferred] = useState(false);

  useEffect(() => { setDrafts(loadDrafts(period.yearMonth)); setSelected(new Set()); setFailedIds(new Set()); setDeferred(false); }, [period.yearMonth]);
  useEffect(() => { saveDrafts(period.yearMonth, drafts); }, [period.yearMonth, drafts]);

  const resolved = useMemo(() => new Map<string, ResolvedRecurringAmount>(
    items.map(({ occurrence }) => [occurrence.id, resolveRecurringAmount(occurrence, transactions)]),
  ), [items, transactions]);

  // Rows needing a decision: missing, suggested, or a posted amount that
  // disagrees with its transaction. Sorted once from stored state so typing
  // never reorders the list under the user's finger.
  const reviewRows = useMemo(() => items
    .filter(({ occurrence }) => {
      const state = resolved.get(occurrence.id)!;
      return occurrence.status !== 'posted' ? state.status !== 'confirmed' : state.integrityIssue;
    })
    .sort((left, right) => {
      const rank = (item: CycleAmountReviewItem) => {
        const state = resolved.get(item.occurrence.id)!;
        return state.status === 'missing' ? 0 : state.integrityIssue ? 1 : 2;
      };
      return rank(left) - rank(right) || left.occurrence.scheduledDate.localeCompare(right.occurrence.scheduledDate);
    }), [items, resolved]);

  // Keep the selection in step with the rows: newly appearing suggestions with
  // a usable amount start selected, blanks never do (acceptance #13).
  const rowIds = reviewRows.map(({ occurrence }) => occurrence.id).join('|');
  useEffect(() => {
    setSelected(current => {
      const next = new Set<string>();
      reviewRows.forEach(({ occurrence }) => {
        const known = current.has(occurrence.id);
        const value = drafts[occurrence.id] ?? resolved.get(occurrence.id)!.amount;
        if (known || (value != null && !current.size)) next.add(occurrence.id);
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIds]);

  // The value the source cycle holds *now*. When it differs from what was
  // copied, the copy is not changed silently; the row offers to fetch it again.
  const sourceCycleAmountNow = (occurrence: RecurringOccurrence): number | null => {
    const state = resolved.get(occurrence.id)!;
    if (state.status !== 'suggested' || !state.sourceCycle) return null;
    const sourceRows = history.filter(row => row.templateId === occurrence.templateId
      && row.id !== occurrence.id
      && !row.projected
      && getYearMonthForDate(row.scheduledDate, period.monthStartDay) === state.sourceCycle
      && resolveRecurringAmount(row, transactions).status === 'confirmed')
      .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate));
    return sourceRows.length ? resolveRecurringAmount(sourceRows[0], transactions).amount : null;
  };

  const draftOf = (occurrence: RecurringOccurrence): Draft => {
    if (occurrence.id in drafts) return drafts[occurrence.id];
    return resolved.get(occurrence.id)!.amount;
  };
  const isValid = (occurrence: RecurringOccurrence) => draftOf(occurrence) != null;

  const counts = useMemo(() => {
    let missing = 0; let suggested = 0; let mismatch = 0;
    reviewRows.forEach(({ occurrence }) => {
      const state = resolved.get(occurrence.id)!;
      if (state.status === 'missing') missing += 1;
      else if (state.integrityIssue) mismatch += 1;
      else suggested += 1;
    });
    return { missing, suggested, mismatch };
  }, [reviewRows, resolved]);

  // Bottom summary over expense items only: confirmed subtotal, projected total
  // including suggestions/drafts, and how the living budget would move.
  const summary = useMemo(() => {
    let confirmedSubtotal = 0; let projectedTotal = 0; let budgetDelta = 0;
    items.forEach(({ occurrence, type }) => {
      const state = resolved.get(occurrence.id)!;
      const sign = type === 'expense' ? -1 : 1;
      const draft = draftOf(occurrence);
      if (type === 'expense') {
        if (state.status === 'confirmed' && !state.integrityIssue) confirmedSubtotal += state.amount ?? 0;
        projectedTotal += draft ?? state.amount ?? 0;
      }
      if (selected.has(occurrence.id) && draft != null) budgetDelta += sign * (draft - (state.amount ?? 0));
    });
    return { confirmedSubtotal, projectedTotal, budgetDelta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, resolved, drafts, selected]);

  const selectableIds = reviewRows.filter(({ occurrence }) => isValid(occurrence)).map(({ occurrence }) => occurrence.id);
  const selectedValidCount = selectableIds.filter(id => selected.has(id)).length;

  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAllSuggested = () => setSelected(new Set(selectableIds));

  const confirmSelected = async () => {
    if (!onConfirm || isSaving) return;
    const updates = reviewRows
      .filter(({ occurrence }) => selected.has(occurrence.id) && isValid(occurrence))
      .map(({ occurrence }) => ({ occurrenceId: occurrence.id, amount: draftOf(occurrence) as number }));
    if (updates.length === 0) { showToast({ message: '확정할 항목을 선택해 주세요. 금액이 비어 있는 항목은 먼저 입력해야 합니다.', tone: 'warning' }); return; }
    setIsSaving(true);
    try {
      const result = await onConfirm(updates);
      const confirmedIds = result ? result.confirmed : updates.map(update => update.occurrenceId);
      const failed = result ? result.failed : [];
      setDrafts(current => { const next = { ...current }; confirmedIds.forEach(id => { delete next[id]; }); return next; });
      setSelected(current => { const next = new Set(current); confirmedIds.forEach(id => next.delete(id)); return next; });
      setFailedIds(new Set(failed));
      if (failed.length) showToast({ message: `${confirmedIds.length}건 확정, ${failed.length}건은 저장하지 못했습니다. 실패한 항목만 다시 시도해 주세요.`, tone: 'warning' });
      else {
        const operationIds = (result && result.operationIds) || [];
        showToast({
          message: `${confirmedIds.length}건의 이번 주기 금액을 확정했습니다. 납부 상태와 거래는 바뀌지 않았습니다.`,
          tone: 'success',
          action: onUndo && operationIds.length ? {
            label: '실행 취소',
            onAction: () => {
              const reverted = onUndo(operationIds);
              showToast({ message: reverted === operationIds.length ? `${reverted}건을 되돌렸습니다.` : `${reverted}건만 되돌렸습니다. 나머지는 그 사이 바뀌었습니다.`, tone: reverted === operationIds.length ? 'info' : 'warning' });
            },
          } : undefined,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const describeMethod = (occurrence: RecurringOccurrence, template?: RecurringTemplate) => {
    const method = occurrence.paymentMethodType ?? template?.paymentMethodType;
    if (method === 'card') return paymentCards.find(card => card.id === (occurrence.cardId ?? template?.cardId))?.cardName ?? '카드';
    if (method === 'account') return bankAccounts.find(account => account.id === (occurrence.accountId ?? template?.accountId))?.accountName ?? '계좌';
    return '결제수단 미지정';
  };

  const allDone = reviewRows.length === 0;
  const monthLabel = `${Number(period.yearMonth.slice(5, 7))}월`;

  return (
    <section
      className={`rounded-2xl border p-4 ${allDone ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-blue-500/35 bg-blue-500/5'}`}
      aria-labelledby="cycle-amount-review-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="cycle-amount-review-title" className="text-base font-extrabold text-slate-100">
            {monthLabel} 주기 금액 확인 <span className="text-xs font-semibold text-slate-400">· {formatPeriodRange(period)}</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {allDone
              ? '이번 주기 금액이 모두 확정되어 있습니다. 청구액이 달라지면 항목의 금액을 눌러 바로 고칠 수 있습니다.'
              : `대상 ${reviewRows.length}건 · 제안 ${counts.suggested}건 · 미입력 ${counts.missing}건${counts.mismatch ? ` · 기록 불일치 ${counts.mismatch}건` : ''}. 확정은 납부 완료·이체·거래 생성을 실행하지 않습니다.`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${allDone ? 'bg-emerald-500/15 text-emerald-200' : 'bg-blue-500/15 text-blue-200'}`}>
          {allDone ? '모두 확정됨' : `${reviewRows.length}건 확인 필요`}
        </span>
      </div>

      {!allDone && deferred && (
        <button type="button" onClick={() => setDeferred(false)} className="mt-3 min-h-10 w-full rounded-xl border border-blue-500/30 text-xs font-bold text-blue-200">
          입력 중인 초안은 유지됩니다 · 다시 열기
        </button>
      )}

      {!allDone && !deferred && (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={selectAllSuggested} disabled={selectableIds.length === 0} className="min-h-9 rounded-lg border border-slate-700 px-2.5 text-xs font-bold text-slate-300 disabled:opacity-50">
              제안 금액 전체 선택
            </button>
            <span className="text-xs text-slate-400">선택 {selectedValidCount}/{selectableIds.length}</span>
          </div>

          <ul className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/70">
            {reviewRows.map(({ occurrence, template, type }) => {
              const state = resolved.get(occurrence.id)!;
              const draft = draftOf(occurrence);
              const valid = draft != null;
              const checked = valid && selected.has(occurrence.id);
              const previous = state.amount;
              const delta = valid && previous != null && draft !== previous ? draft - previous : null;
              const failed = failedIds.has(occurrence.id);
              const statusLabel = state.status === 'missing' ? '금액 입력 필요' : state.integrityIssue ? '기록 불일치' : '제안';
              const statusClass = state.status === 'missing' ? 'bg-amber-500/15 text-amber-200' : state.integrityIssue ? 'bg-rose-500/15 text-rose-200' : 'bg-slate-700/60 text-slate-200';
              const sourceNow = sourceCycleAmountNow(occurrence);
              const sourceChanged = sourceNow != null && previous != null && sourceNow !== previous;
              const previousLabel = previous == null
                ? '전 주기 기록 없음'
                : `전 주기 ${formatKRW(previous)}${state.sourceCycle ? ` · ${Number(state.sourceCycle.slice(5, 7))}월 주기에서 가져옴` : state.source === 'legacy_template' ? ' · 기존 원본 금액' : ''}`;
              return (
                <li key={occurrence.id} className={`p-3 ${failed ? 'bg-rose-500/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => valid && toggle(occurrence.id)}
                      disabled={!valid}
                      aria-pressed={checked}
                      aria-label={`${template?.name || '정기 항목'} 선택`}
                      className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-blue-300 disabled:text-slate-700"
                    >
                      {checked ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-100">{template?.name || '정기 항목'}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${statusClass}`}>{statusLabel}</span>
                        {type === 'income' && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-bold text-emerald-300">수입</span>}
                        {failed && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold text-rose-200">저장 실패</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{occurrence.scheduledDate} · {describeMethod(occurrence, template)}</p>
                      {sourceChanged && (
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-200">
                          <span>전 주기 기록이 {formatKRW(sourceNow!)}(으)로 바뀌었습니다. 이 주기의 제안값은 그대로 두었습니다.</span>
                          <button type="button" onClick={() => setDrafts(current => ({ ...current, [occurrence.id]: sourceNow }))} className="min-h-8 rounded border border-amber-400/40 px-2 font-bold">다시 가져오기</button>
                        </p>
                      )}
                      <div className="mt-2 grid items-center gap-2 sm:grid-cols-[1fr_170px]">
                        <p className="text-xs text-slate-400">{previousLabel}</p>
                        <div>
                          <AmountInput
                            value={draft ?? 0}
                            placeholder="이번 주기 금액"
                            onChange={value => setDrafts(current => ({ ...current, [occurrence.id]: value === 0 ? null : value }))}
                          />
                          {delta != null && (
                            <p className={`mt-1 text-right text-[11px] font-bold ${delta > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{signedKRW(delta)} 전 주기 대비</p>
                          )}
                          {/* A blank means "unknown"; zero is a decision and must be explicit (PRD §6). */}
                          {draft === 0
                            ? <p className="mt-1 flex items-center justify-between text-[11px] font-bold text-emerald-300"><span>확정 0원 · 이번 주기 납부 없음</span><button type="button" onClick={() => setDrafts(current => ({ ...current, [occurrence.id]: null }))} className="rounded border border-slate-700 px-1.5 py-0.5 font-semibold text-slate-400">지우기</button></p>
                            : draft == null && (
                              <button type="button" onClick={() => setDrafts(current => ({ ...current, [occurrence.id]: 0 }))} className="mt-1 min-h-9 w-full rounded-lg border border-slate-700 text-[11px] font-bold text-slate-300">이번 주기 납부 없음 (0원 확정)</button>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs">
            <dt className="text-slate-400">확정 소계</dt>
            <dd className="text-right font-bold text-slate-100">{formatKRW(summary.confirmedSubtotal)}</dd>
            <dt className="text-slate-400">제안 포함 예상 합계</dt>
            <dd className="text-right font-bold text-slate-100">{formatKRW(summary.projectedTotal)}{counts.missing > 0 && <span className="ml-1 font-semibold text-amber-200">· 미입력 {counts.missing}건 별도</span>}</dd>
            <dt className="text-slate-400">확정 시 생활비 재원 변화</dt>
            <dd className={`text-right font-bold ${summary.budgetDelta < 0 ? 'text-rose-300' : summary.budgetDelta > 0 ? 'text-emerald-300' : 'text-slate-300'}`}>{signedKRW(summary.budgetDelta)}</dd>
          </dl>

          {counts.mismatch > 0 && (
            <p className="mt-2 flex items-start gap-1 text-xs text-rose-200"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />기록 불일치 항목은 연결 거래 금액을 대표값으로 보여줍니다. 다른 값을 확정하면 거래 기록도 함께 수정됩니다.</p>
          )}

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <button type="button" onClick={() => void confirmSelected()} disabled={isSaving || selectedValidCount === 0} className="min-h-11 rounded-xl bg-blue-500 text-sm font-extrabold text-white disabled:opacity-50">
              {isSaving ? '확정 중…' : `선택한 ${selectedValidCount}건 금액 확정`}
            </button>
            <button type="button" onClick={() => setDeferred(true)} className="min-h-11 rounded-xl border border-slate-700 px-3 text-xs font-bold text-slate-300">나중에 확인</button>
          </div>
        </>
      )}
    </section>
  );
};
