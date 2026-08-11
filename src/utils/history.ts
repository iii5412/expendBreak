import { Transaction } from '../types';
import { AccountingPeriod, getLocalDateString, isDateInPeriod } from './calculations';

/** `period` follows the app-wide accounting period; the rest are rolling windows. */
export type HistoryPeriod = 'period' | 'all' | 'today' | '7days' | '30days';

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
