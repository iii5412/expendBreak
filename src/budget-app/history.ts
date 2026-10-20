import type { BudgetTransaction } from '../types/budget';

export type HistoryFilter = 'all' | 'variable' | 'one_off' | 'fixed' | 'income' | 'etc';

export const HISTORY_FILTERS: ReadonlyArray<{ id: HistoryFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'variable', label: '변동지출' },
  { id: 'one_off', label: '일회성' },
  { id: 'fixed', label: '고정지출' },
  { id: 'income', label: '수입' },
  { id: 'etc', label: '기타(미분류)만' },
];

/** The category text-message and bulk imports fall back to when nothing matched. */
export const UNCLASSIFIED_CATEGORY_ID = 'etc_expense';

export function matchesHistoryFilter(t: BudgetTransaction, filter: HistoryFilter) {
  switch (filter) {
    case 'income':
      return t.type === 'income';
    case 'one_off':
      return t.type === 'expense' && t.isOneOff;
    case 'fixed':
      return t.type === 'expense' && !t.isOneOff && t.expenseNature === 'fixed';
    case 'variable':
      return t.type === 'expense' && !t.isOneOff && t.expenseNature !== 'fixed';
    case 'etc':
      return t.type === 'expense' && t.categoryId === UNCLASSIFIED_CATEGORY_ID;
    default:
      return true;
  }
}

/** Newest first. The query matches merchant and memo, ignoring case and spacing. */
export function filterHistory(
  transactions: readonly BudgetTransaction[],
  { query = '', filter = 'all' }: { query?: string; filter?: HistoryFilter } = {},
) {
  const needle = query.toLowerCase().replace(/\s/g, '');
  return transactions
    .filter((t) => matchesHistoryFilter(t, filter))
    .filter(
      (t) => !needle || `${t.merchant || ''}${t.memo || ''}`.toLowerCase().replace(/\s/g, '').includes(needle),
    )
    .sort((a, b) => b.localDate.localeCompare(a.localDate));
}

export interface TransactionEdit {
  merchant: string;
  amount: number;
  localDate: string;
  categoryId?: string;
  isOneOff: boolean;
  memo: string;
  /** Remember merchant → category for future messages and entries. */
  saveRule: boolean;
}

/** Returns an error message, or null when the edit can be saved. */
export function validateTransactionEdit(edit: TransactionEdit): string | null {
  if (!Number.isSafeInteger(edit.amount) || edit.amount < 1) return '금액은 1원 이상의 정수로 입력해 주세요.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edit.localDate) || !Number.isFinite(Date.parse(edit.localDate)))
    return '날짜를 확인해 주세요.';
  return null;
}
