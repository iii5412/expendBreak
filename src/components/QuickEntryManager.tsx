import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { BankAccount, Category, PaymentCard, PaymentMethodType, QuickEntry } from '../types';
import { formatKRW } from '../utils/calculations';
import { AmountInput } from './ui/AmountInput';

export interface QuickEntryDraft {
  label: string;
  type: 'income' | 'expense';
  amount: number | null;
  categoryId: string;
  merchant: string;
  memo: string;
  paymentMethodType: PaymentMethodType;
  accountId: string | null;
  cardId: string | null;
}

interface QuickEntryManagerProps {
  entries: QuickEntry[];
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  onCreate: (draft: QuickEntryDraft) => void;
  onUpdate: (id: string, draft: QuickEntryDraft) => void;
  onDelete: (entry: QuickEntry) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
}

const emptyDraft = (categories: Category[]): QuickEntryDraft => ({
  label: '',
  type: 'expense',
  amount: null,
  categoryId: categories.find(category => category.type === 'expense' && category.active)?.id || '',
  merchant: '',
  memo: '',
  paymentMethodType: 'card',
  accountId: null,
  cardId: null,
});

const inputClass =
  'w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-rose-500 focus:outline-none';

/**
 * Create and maintain the one-tap chips.
 *
 * A quick entry deliberately fixes everything except the amount: the point is
 * that recording a repeat should ask nothing at all when the price is stable,
 * and only the number when it is not.
 */
export const QuickEntryManager: React.FC<QuickEntryManagerProps> = ({
  entries,
  categories,
  bankAccounts,
  paymentCards,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}) => {
  const [draft, setDraft] = useState<QuickEntryDraft>(() => emptyDraft(categories));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [hasFixedAmount, setHasFixedAmount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectableCategories = categories.filter(
    category => category.type === draft.type && category.active,
  );

  const resetForm = () => {
    setDraft(emptyDraft(categories));
    setEditingId(null);
    setIsFormOpen(false);
    setHasFixedAmount(false);
    setError(null);
  };

  const startEdit = (entry: QuickEntry) => {
    setDraft({
      label: entry.label,
      type: entry.type,
      amount: entry.amount,
      categoryId: entry.categoryId,
      merchant: entry.merchant,
      memo: entry.memo,
      paymentMethodType: entry.paymentMethodType,
      accountId: entry.accountId ?? null,
      cardId: entry.cardId ?? null,
    });
    setHasFixedAmount(entry.amount !== null);
    setEditingId(entry.id);
    setIsFormOpen(true);
    setError(null);
  };

  const submit = () => {
    if (draft.label.trim() === '') {
      setError('이름을 입력해 주세요.');
      return;
    }
    if (draft.categoryId === '') {
      setError('카테고리를 선택해 주세요.');
      return;
    }
    if (hasFixedAmount && (draft.amount === null || draft.amount <= 0)) {
      setError('고정 금액을 입력하거나 "누를 때 입력"으로 바꿔 주세요.');
      return;
    }

    const payload: QuickEntryDraft = {
      ...draft,
      label: draft.label.trim(),
      merchant: draft.merchant.trim() || draft.label.trim(),
      amount: hasFixedAmount ? draft.amount : null,
    };

    if (editingId) onUpdate(editingId, payload);
    else onCreate(payload);
    resetForm();
  };

  const categoryName = (categoryId: string) =>
    categories.find(category => category.id === categoryId)?.name || '미분류';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
              <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
              퀵등록 항목
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              자주 반복되는 내역을 등록해 두면 홈에서 한 번 눌러 기록합니다.
              금액이 매번 달라지면 "누를 때 입력"으로 두세요.
            </p>
          </div>
          {!isFormOpen && (
            <button
              onClick={() => {
                setDraft(emptyDraft(categories));
                setIsFormOpen(true);
              }}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-rose-500 px-3 text-xs font-extrabold text-white transition-colors hover:bg-rose-600"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              추가
            </button>
          )}
        </div>
      </div>

      {isFormOpen && (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="grid grid-cols-2 gap-2">
            {(['expense', 'income'] as const).map(type => (
              <button
                key={type}
                onClick={() => setDraft(previous => ({
                  ...previous,
                  type,
                  categoryId: categories.find(c => c.type === type && c.active)?.id || '',
                }))}
                className={`min-h-11 rounded-lg text-sm font-bold transition-colors ${
                  draft.type === type
                    ? 'bg-rose-500 text-white'
                    : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {type === 'expense' ? '지출' : '수입'}
              </button>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-300">이름</span>
            <input
              value={draft.label}
              onChange={event => setDraft(previous => ({ ...previous, label: event.target.value }))}
              placeholder="예: 점심, 출근 교통비"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-300">사용처 (비우면 이름을 사용)</span>
            <input
              value={draft.merchant}
              onChange={event => setDraft(previous => ({ ...previous, merchant: event.target.value }))}
              placeholder="예: 김밥천국"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-300">카테고리</span>
            <select
              value={draft.categoryId}
              onChange={event => setDraft(previous => ({ ...previous, categoryId: event.target.value }))}
              className={inputClass}
            >
              <option value="">선택하세요</option>
              {selectableCategories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-300">결제 수단</span>
            <select
              value={draft.paymentMethodType}
              onChange={event => setDraft(previous => ({
                ...previous,
                paymentMethodType: event.target.value as PaymentMethodType,
                accountId: null,
                cardId: null,
              }))}
              className={inputClass}
            >
              <option value="card">카드</option>
              <option value="account">계좌</option>
              <option value="cash">현금</option>
              <option value="other">기타</option>
            </select>
          </label>

          {draft.paymentMethodType === 'card' && paymentCards.length > 0 && (
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-300">카드</span>
              <select
                value={draft.cardId ?? ''}
                onChange={event => setDraft(previous => ({ ...previous, cardId: event.target.value || null }))}
                className={inputClass}
              >
                <option value="">선택 안 함</option>
                {paymentCards.map(card => (
                  <option key={card.id} value={card.id}>{card.cardCompany} {card.cardName}</option>
                ))}
              </select>
            </label>
          )}

          {draft.paymentMethodType === 'account' && bankAccounts.length > 0 && (
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-300">계좌</span>
              <select
                value={draft.accountId ?? ''}
                onChange={event => setDraft(previous => ({ ...previous, accountId: event.target.value || null }))}
                className={inputClass}
              >
                <option value="">선택 안 함</option>
                {bankAccounts.map(account => (
                  <option key={account.id} value={account.id}>{account.bankName} {account.accountName}</option>
                ))}
              </select>
            </label>
          )}

          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-300">금액을 고정합니다</span>
              <input
                type="checkbox"
                checked={hasFixedAmount}
                onChange={event => setHasFixedAmount(event.target.checked)}
                className="h-11 w-11 shrink-0 accent-rose-500"
                aria-label="금액을 고정합니다"
              />
            </label>
            {hasFixedAmount ? (
              <AmountInput
                value={draft.amount ?? 0}
                onChange={amount => setDraft(previous => ({ ...previous, amount }))}
                showQuickAdd
              />
            ) : (
              <p className="text-[11px] text-slate-400">
                누를 때마다 금액만 입력합니다. 나머지는 이 설정대로 기록됩니다.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs font-semibold text-rose-400">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={resetForm}
              className="min-h-11 flex-1 rounded-lg border border-slate-800 bg-slate-950 text-sm font-bold text-slate-300 transition-colors hover:bg-slate-800"
            >
              취소
            </button>
            <button
              onClick={submit}
              className="min-h-11 flex-1 rounded-lg bg-rose-500 text-sm font-extrabold text-white transition-colors hover:bg-rose-600"
            >
              {editingId ? '수정' : '추가'}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 && !isFormOpen ? (
        <p className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
          아직 등록된 퀵등록 항목이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-slate-100">{entry.label}</p>
                <p className="truncate text-[11px] text-slate-400">
                  {entry.type === 'income' ? '수입' : '지출'} · {categoryName(entry.categoryId)} ·{' '}
                  {entry.amount === null ? '누를 때 입력' : formatKRW(entry.amount)}
                  {entry.useCount > 0 && ` · ${entry.useCount}회 사용`}
                </p>
              </div>

              <div className="flex shrink-0 items-center">
                <button
                  onClick={() => onReorder(entry.id, -1)}
                  disabled={index === 0}
                  aria-label={`${entry.label} 위로`}
                  className="flex h-11 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-100 disabled:opacity-25"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onReorder(entry.id, 1)}
                  disabled={index === entries.length - 1}
                  aria-label={`${entry.label} 아래로`}
                  className="flex h-11 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-100 disabled:opacity-25"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => startEdit(entry)}
                  aria-label={`${entry.label} 수정`}
                  className="flex h-11 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onDelete(entry)}
                  aria-label={`${entry.label} 삭제`}
                  className="flex h-11 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
