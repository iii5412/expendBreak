import { describe, expect, it } from 'vitest';
import { Transaction } from '../types';
import { isFixedExpenseTransaction, isTransactionInPeriod, matchesHistoryKind, sortTransactionsNewestFirst } from './history';

const transaction = (id: string, localDate: string, occurredAt = `${localDate}T12:00:00.000Z`): Transaction => ({
  id,
  type: 'expense',
  amount: 10_000,
  occurredAt,
  localDate,
  categoryId: 'food',
  merchant: '상점',
  memo: '',
  source: 'manual',
  createdAt: occurredAt,
  updatedAt: occurredAt,
});

describe('history helpers', () => {
  it('sorts by local date and then occurrence time, newest first', () => {
    const older = transaction('older', '2026-08-09');
    const newest = transaction('newest', '2026-08-11', '2026-08-11T18:00:00.000Z');
    const sameDayOlder = transaction('same-day-older', '2026-08-11', '2026-08-11T08:00:00.000Z');

    expect(sortTransactionsNewestFirst([older, sameDayOlder, newest]).map(item => item.id))
      .toEqual(['newest', 'same-day-older', 'older']);
  });

  it('uses inclusive local-day windows for today, 7 days, and 30 days', () => {
    const today = new Date(2026, 7, 11, 12);
    const current = transaction('current', '2026-08-11');
    const sevenDayBoundary = transaction('seven-day-boundary', '2026-08-05');
    const outsideSevenDays = transaction('outside-seven-days', '2026-08-04');
    const thirtyDayBoundary = transaction('thirty-day-boundary', '2026-07-13');

    expect(isTransactionInPeriod(current, 'today', today)).toBe(true);
    expect(isTransactionInPeriod(sevenDayBoundary, '7days', today)).toBe(true);
    expect(isTransactionInPeriod(outsideSevenDays, '7days', today)).toBe(false);
    expect(isTransactionInPeriod(thirtyDayBoundary, '30days', today)).toBe(true);
  });

  it('separates ordinary spending from recurring and card-settlement outflows', () => {
    const regular = transaction('regular', '2026-08-11');
    const recurring = { ...transaction('recurring', '2026-08-11'), recurringTemplateId: 'rent' };
    const cardSettlement = { ...transaction('card-bill', '2026-08-11'), role: 'card_settlement' as const };
    const income = { ...transaction('income', '2026-08-11'), type: 'income' as const };

    expect(isFixedExpenseTransaction(regular)).toBe(false);
    expect(isFixedExpenseTransaction(recurring)).toBe(true);
    expect(isFixedExpenseTransaction(cardSettlement)).toBe(true);
    expect([regular, recurring, cardSettlement, income].filter(item => matchesHistoryKind(item, 'regular_expense')))
      .toEqual([regular]);
    expect([regular, recurring, cardSettlement, income].filter(item => matchesHistoryKind(item, 'fixed_expense')))
      .toEqual([recurring, cardSettlement]);
  });
});
