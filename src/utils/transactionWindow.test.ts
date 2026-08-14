import { describe, expect, it } from 'vitest';
import { Transaction } from '../types';
import {
  getTransactionWindowStart,
  mergeFetchedHistory,
  mergeTransactionWindow,
} from './transactionWindow';

function tx(id: string, localDate: string): Transaction {
  return {
    id,
    type: 'expense',
    amount: 1000,
    occurredAt: `${localDate}T12:00:00.000Z`,
    localDate,
    categoryId: 'etc_expense',
    merchant: id,
    memo: '',
    source: 'manual',
    createdAt: `${localDate}T12:00:00.000Z`,
    updatedAt: `${localDate}T12:00:00.000Z`,
  };
}

describe('getTransactionWindowStart', () => {
  it('reaches back to the start of the previous accounting period', () => {
    expect(getTransactionWindowStart('2026-08', 10)).toBe('2026-07-10');
  });

  it('follows the payday cycle rather than the calendar month', () => {
    expect(getTransactionWindowStart('2026-08', 25)).toBe('2026-07-25');
  });

  it('handles a calendar-month cycle', () => {
    expect(getTransactionWindowStart('2026-08', 1)).toBe('2026-07-01');
  });

  it('crosses a year boundary', () => {
    expect(getTransactionWindowStart('2026-01', 10)).toBe('2025-12-10');
  });

  it('covers only the current period when asked for one', () => {
    expect(getTransactionWindowStart('2026-08', 10, 1)).toBe('2026-08-10');
  });
});

describe('mergeTransactionWindow', () => {
  it('keeps cached history that predates the live window', () => {
    const cached = [tx('old', '2026-05-02'), tx('recent', '2026-07-20')];
    const live = [tx('recent', '2026-07-20'), tx('new', '2026-08-11')];

    const merged = mergeTransactionWindow(cached, live, '2026-07-10');

    expect(merged.map(t => t.id)).toEqual(['new', 'recent', 'old']);
  });

  it('drops a cached transaction inside the window that the snapshot no longer has', () => {
    const cached = [tx('deleted', '2026-07-20'), tx('kept', '2026-08-01')];
    const live = [tx('kept', '2026-08-01')];

    const merged = mergeTransactionWindow(cached, live, '2026-07-10');

    expect(merged.map(t => t.id)).toEqual(['kept']);
  });

  it('does not duplicate a transaction present in both halves', () => {
    const cached = [tx('shared', '2026-05-02')];
    const live = [tx('shared', '2026-05-02')];

    const merged = mergeTransactionWindow(cached, live, '2026-07-10');

    expect(merged.map(t => t.id)).toEqual(['shared']);
  });

  it('returns the live snapshot when there is no older history', () => {
    const live = [tx('a', '2026-08-01')];

    expect(mergeTransactionWindow([], live, '2026-07-10')).toHaveLength(1);
  });
});

describe('mergeFetchedHistory', () => {
  it('adds fetched history and keeps everything sorted newest first', () => {
    const cached = [tx('new', '2026-08-11')];
    const fetched = [tx('older', '2026-03-04'), tx('oldest', '2026-01-09')];

    const merged = mergeFetchedHistory(cached, fetched);

    expect(merged.map(t => t.id)).toEqual(['new', 'older', 'oldest']);
  });

  it('lets the fetched copy replace a stale cached one', () => {
    const cached = [{ ...tx('same', '2026-03-04'), amount: 1000 }];
    const fetched = [{ ...tx('same', '2026-03-04'), amount: 7700 }];

    const merged = mergeFetchedHistory(cached, fetched);

    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(7700);
  });
});
