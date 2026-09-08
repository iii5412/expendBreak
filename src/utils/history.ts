import { Transaction } from '../types';
import { AccountingPeriod, getLocalDateString, isDateInPeriod } from './calculations';
import { getInstallmentCharge } from './installments';

/** `period` follows the app-wide accounting period; the rest are rolling windows. */
export type HistoryPeriod = 'spending' | 'period' | 'all' | 'today' | '7days' | '30days';
export type HistoryKind = 'regular_expense' | 'fixed_expense' | 'income' | 'all';

/** Recurring postings and the monthly card-bill withdrawal are fixed outflows. */
export function isFixedExpenseTransaction(transaction: Transaction): boolean {
  return transaction.type === 'expense'
    && (Boolean(transaction.recurringTemplateId) || transaction.role === 'card_settlement');
}

export function matchesHistoryKind(transaction: Transaction, kind: HistoryKind): boolean {
  if (kind === 'all') return true;
  if (kind === 'income') return transaction.type === 'income';
  if (kind === 'fixed_expense') return isFixedExpenseTransaction(transaction);
  return transaction.type === 'expense' && (transaction.role ?? 'normal') === 'normal' && !isFixedExpenseTransaction(transaction);
}

export function historyAmount(transaction: Transaction, spendingMonth?: string): number {
  if (spendingMonth && transaction.type === 'expense' && !transaction.recurringTemplateId
    && (transaction.role ?? 'normal') === 'normal' && transaction.installment) {
    return getInstallmentCharge(transaction.amount, transaction.installment, spendingMonth)?.amount ?? 0;
  }
  return Math.round(transaction.amount);
}

export function summarizeHistory(transactions: Transaction[], replacedTemplateIds: ReadonlySet<string> = new Set(), spendingMonth?: string) {
  const totals = { income: 0, expense: 0, settlement: 0, transfer: 0, replaced: 0, net: 0 };
  for (const transaction of transactions) {
    const amount = historyAmount(transaction, spendingMonth);
    if (transaction.recurringTemplateId && replacedTemplateIds.has(transaction.recurringTemplateId)) totals.replaced += amount;
    else if (transaction.role === 'transfer') totals.transfer += amount;
    else if (transaction.role === 'card_settlement') totals.settlement += amount;
    else if (transaction.type === 'income') totals.income += amount;
    else totals.expense += amount;
  }
  totals.net = totals.income - totals.expense;
  return totals;
}

function subtractLocalDays(date: Date, days: number): string {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() - days);
  return getLocalDateString(result);
}

export function isTransactionInPeriod(
  transaction: Transaction,
  period: HistoryPeriod,
  today = new Date(),
  accountingPeriod?: AccountingPeriod,
): boolean {
  if (period === 'all') return true;
  if (period === 'spending') {
    if (!accountingPeriod) return false;
    if (transaction.installment && transaction.type === 'expense' && !transaction.recurringTemplateId
      && (transaction.role ?? 'normal') === 'normal') return historyAmount(transaction, accountingPeriod.yearMonth) > 0;
    return isDateInPeriod(transaction.localDate, accountingPeriod);
  }
  if (period === 'period') {
    return accountingPeriod ? isDateInPeriod(transaction.localDate, accountingPeriod) : true;
  }

  const end = getLocalDateString(today);
  const start = period === 'today'
    ? end
    : subtractLocalDays(today, period === '7days' ? 6 : 29);

  return transaction.localDate >= start && transaction.localDate <= end;
}

function timestamp(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortTransactionsNewestFirst(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => {
    const dateDifference = b.localDate.localeCompare(a.localDate);
    if (dateDifference !== 0) return dateDifference;

    const occurrenceDifference = timestamp(b.occurredAt) - timestamp(a.occurredAt);
    if (occurrenceDifference !== 0) return occurrenceDifference;

    const creationDifference = timestamp(b.createdAt) - timestamp(a.createdAt);
    if (creationDifference !== 0) return creationDifference;

    return b.id.localeCompare(a.id);
  });
}
