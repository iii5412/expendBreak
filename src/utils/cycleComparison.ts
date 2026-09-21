import type { Category, Transaction } from '../types';
import {
  AccountingPeriod,
  getAccountingPeriod,
  getLocalDateString,
  isDateInPeriod,
  isSpendingTransaction,
  shiftYearMonth,
} from './calculations';
import { getInstallmentCharge } from './installments';

/**
 * Same-elapsed-day comparison of living expenses (PRD-ui-renewal §3-3, §5 분석).
 *
 * A cycle in progress must not be compared against a whole previous cycle:
 * "day 10 of September vs all of August" always looks like savings. Both
 * sides are cut at the same number of elapsed days, and the result is
 * labelled as a record-based comparison, never as a proven habit change.
 */

export interface CycleElapsedComparison {
  /** Days elapsed in the current cycle, today inclusive (0 before it starts). */
  elapsedDays: number;
  currentPeriod: AccountingPeriod;
  previousPeriod: AccountingPeriod;
  currentSpend: number;
  previousSpend: number;
  /** currentSpend − previousSpend. */
  delta: number;
  /** Rounded to one decimal; null when the previous window had no spending. */
  deltaPercent: number | null;
  /** True when the current cycle is closed and the comparison covers full cycles. */
  isFullCycle: boolean;
}

function livingExpenseIn(
  transactions: Transaction[],
  period: AccountingPeriod,
  untilDate: string,
): number {
  return transactions.reduce((sum, transaction) => {
    if (transaction.type !== 'expense' || transaction.recurringTemplateId || !isSpendingTransaction(transaction)) return sum;
    if (transaction.installment) {
      // A round is charged for the cycle as a whole; count it from day one.
      const charge = getInstallmentCharge(transaction.amount, transaction.installment, period.yearMonth);
      return sum + (charge?.amount ?? 0);
    }
    if (!isDateInPeriod(transaction.localDate, period) || transaction.localDate > untilDate) return sum;
    return sum + Math.round(transaction.amount);
  }, 0);
}

function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return getLocalDateString(new Date(year, month - 1, day + days));
}

export function compareCycleElapsed(
  yearMonth: string,
  transactions: Transaction[],
  monthStartDay: number,
  now = new Date(),
): CycleElapsedComparison {
  const currentPeriod = getAccountingPeriod(yearMonth, monthStartDay, now);
  const previousPeriod = getAccountingPeriod(shiftYearMonth(yearMonth, -1), monthStartDay, now);
  const today = getLocalDateString(now);

  const isFullCycle = today > currentPeriod.endDate;
  const currentUntil = isFullCycle ? currentPeriod.endDate : today < currentPeriod.startDate ? '' : today;
  const elapsedDays = currentUntil
    ? Math.round((Date.parse(`${currentUntil}T12:00:00`) - Date.parse(`${currentPeriod.startDate}T12:00:00`)) / 86_400_000) + 1
    : 0;
  const previousUntil = isFullCycle ? previousPeriod.endDate : addDays(previousPeriod.startDate, Math.max(0, elapsedDays - 1));

  const currentSpend = currentUntil ? livingExpenseIn(transactions, currentPeriod, currentUntil) : 0;
  const previousSpend = elapsedDays > 0 ? livingExpenseIn(transactions, previousPeriod, previousUntil) : 0;
  const delta = currentSpend - previousSpend;
  const deltaPercent = previousSpend > 0 ? Math.round((delta / previousSpend) * 1000) / 10 : null;

  return { elapsedDays, currentPeriod, previousPeriod, currentSpend, previousSpend, delta, deltaPercent, isFullCycle };
}

export interface UncategorizedReview {
  categoryName: string;
  count: number;
  amount: number;
  /** Share of living expenses in the cycle, 0–100 with one decimal. */
  sharePercent: number;
}

/**
 * The catch-all category ("기타") is an actionable review list, not a chart
 * slice: "기타 7건 분류 확인" tells the user what to do. Nothing is reclassified
 * automatically (PRD §3-4).
 */
export function reviewUncategorized(
  transactions: Transaction[],
  categories: Category[],
  period: AccountingPeriod,
): UncategorizedReview | null {
  const catchAll = categories.find(category => category.type === 'expense' && (category.name === '기타' || category.id === 'other'));
  if (!catchAll) return null;
  const inCycle = transactions.filter(transaction => transaction.type === 'expense'
    && !transaction.recurringTemplateId && isSpendingTransaction(transaction)
    && isDateInPeriod(transaction.localDate, period));
  const total = inCycle.reduce((sum, transaction) => sum + Math.round(transaction.amount), 0);
  const rows = inCycle.filter(transaction => transaction.categoryId === catchAll.id);
  const amount = rows.reduce((sum, transaction) => sum + Math.round(transaction.amount), 0);
  return {
    categoryName: catchAll.name,
    count: rows.length,
    amount,
    sharePercent: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
  };
}
