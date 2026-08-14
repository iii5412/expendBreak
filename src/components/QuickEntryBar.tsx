import React, { useState } from 'react';
import { Plus, Settings2, Zap } from 'lucide-react';
import { Category, QuickEntry } from '../types';
import { QuickEntrySuggestion } from '../utils/quickEntrySuggestions';
import { formatKRW } from '../utils/calculations';
import { AmountInput } from './ui/AmountInput';
import { Modal } from './ui/Modal';

interface QuickEntryBarProps {
  entries: QuickEntry[];
  categories: Category[];
  suggestions: QuickEntrySuggestion[];
  /** Records the transaction. `amountOverride` applies to variable-amount chips. */
  onPost: (id: string, amountOverride?: number) => void;
  onAcceptSuggestion: (suggestion: QuickEntrySuggestion) => void;
  onDismissSuggestion: (suggestion: QuickEntrySuggestion) => void;
  onManage: () => void;
}

/**
 * One-tap recording for the transactions the user repeats.
 *
 * A fixed-amount chip saves immediately. A variable-amount chip opens nothing
 * but a number pad, because the merchant, category and payment method are
 * already settled — asking for them again is the cost this is meant to remove.
 */
export const QuickEntryBar: React.FC<QuickEntryBarProps> = ({
  entries,
  categories,
  suggestions,
  onPost,
  onAcceptSuggestion,
  onDismissSuggestion,
  onManage,
}) => {
  const [amountPrompt, setAmountPrompt] = useState<QuickEntry | null>(null);
  const [promptAmount, setPromptAmount] = useState<number>(0);

  const categoryName = (categoryId: string) =>
    categories.find(category => category.id === categoryId)?.name || '미분류';

  const openAmountPrompt = (entry: QuickEntry) => {
    setPromptAmount(0);
    setAmountPrompt(entry);
  };

  const confirmAmountPrompt = () => {
    if (!amountPrompt || promptAmount <= 0) return;
    onPost(amountPrompt.id, promptAmount);
    setAmountPrompt(null);
  };

  const hasAnything = entries.length > 0 || suggestions.length > 0;
  if (!hasAnything) return null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
          <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
          퀵등록
        </h2>
        <button
          onClick={onManage}
          className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-200"
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
          관리
        </button>
      </div>

      {entries.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {entries.map(entry => (
            <li key={entry.id}>
              <button
                onClick={() => (entry.amount === null ? openAmountPrompt(entry) : onPost(entry.id))}
                className="flex min-h-11 flex-col items-start rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-left transition-colors hover:border-rose-500/50 hover:bg-slate-800"
              >
                <span className="text-xs font-extrabold text-slate-100">{entry.label}</span>
                <span className="text-[11px] text-slate-400">
                  {entry.amount === null ? '금액 입력' : formatKRW(entry.amount)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {entries.length === 0 && (
        <p className="text-xs leading-relaxed text-slate-400">
          자주 쓰는 내역을 등록해 두면 한 번 눌러 기록할 수 있습니다.
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
          <p className="text-[11px] font-bold text-slate-400">이 내역을 자주 기록하셨습니다</p>
          {suggestions.map(suggestion => (
            <div
              key={`${suggestion.merchant}-${suggestion.categoryId}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-100">{suggestion.merchant}</p>
                <p className="text-[11px] text-slate-400">
                  {categoryName(suggestion.categoryId)} · 최근 90일 {suggestion.count}회
                  {suggestion.fixedAmount !== null && ` · ${formatKRW(suggestion.fixedAmount)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => onAcceptSuggestion(suggestion)}
                  className="flex min-h-11 items-center gap-1 rounded-lg bg-rose-500 px-2.5 text-[11px] font-extrabold text-white transition-colors hover:bg-rose-600"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  추가
                </button>
                <button
                  onClick={() => onDismissSuggestion(suggestion)}
                  className="min-h-11 rounded-lg px-2 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
                >
                  안 함
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={amountPrompt !== null}
        onClose={() => setAmountPrompt(null)}
        ariaLabel={`${amountPrompt?.label ?? ''} 금액 입력`}
      >
        <h3 className="text-base font-extrabold text-slate-100">{amountPrompt?.label}</h3>
        <p className="mt-1 mb-4 text-xs text-slate-400">
          {amountPrompt?.merchant} · {categoryName(amountPrompt?.categoryId ?? '')}
        </p>

        <AmountInput value={promptAmount} onChange={setPromptAmount} showQuickAdd autoFocus />

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => setAmountPrompt(null)}
            className="min-h-11 flex-1 rounded-lg border border-slate-800 bg-slate-950 text-sm font-bold text-slate-300 transition-colors hover:bg-slate-800"
          >
            취소
          </button>
          <button
            onClick={confirmAmountPrompt}
            disabled={promptAmount <= 0}
            className="min-h-11 flex-1 rounded-lg bg-rose-500 text-sm font-extrabold text-white transition-colors hover:bg-rose-600 disabled:opacity-40"
          >
            기록
          </button>
        </div>
      </Modal>
    </section>
  );
};
