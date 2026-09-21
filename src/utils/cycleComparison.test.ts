import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../types';
import { compareCycleElapsed, reviewUncategorized } from './cycleComparison';
import { getAccountingPeriod } from './calculations';

const tx = (localDate: string, amount: number, overrides: Partial<Transaction> = {}): Transaction => ({
  id: `${localDate}_${amount}`, type: 'expense', localDate, amount, categoryId: 'food', merchant: '',
  memo: '', source: 'manual', occurredAt: '', createdAt: '', updatedAt: '', paymentMethodType: 'card', ...overrides,
} as Transaction);

// Payday 10th. August cycle 8/10–9/9, September cycle 9/10–10/9. "Today" is 9/19 (day 10).
const NOW = new Date(2026, 8, 19, 12);
const transactions = [
  tx('2026-08-10', 100_000), tx('2026-08-15', 200_000), tx('2026-08-19', 300_000),
  tx('2026-08-25', 1_000_000), // after day 10 of August: must be excluded
  tx('2026-09-10', 50_000), tx('2026-09-18', 150_000),
  tx('2026-09-25', 999_999), // future in September: not yet spent
  tx('2026-09-12', 80_000, { recurringTemplateId: 'rent' }), // fixed, not living expense
  tx('2026-09-13', 70_000, { role: 'card_settlement' }), // settlement, not living expense
];

describe('compareCycleElapsed', () => {
  it('cuts both cycles at the same elapsed day while the cycle is open', () => {
    const result = compareCycleElapsed('2026-09', transactions, 10, NOW);
    expect(result.elapsedDays).toBe(10);
    expect(result.currentSpend).toBe(200_000);
    expect(result.previousSpend).toBe(600_000);
    expect(result.delta).toBe(-400_000);
    expect(result.deltaPercent).toBe(-66.7);
    expect(result.isFullCycle).toBe(false);
  });

  it('compares whole cycles once the current one is closed', () => {
    const result = compareCycleElapsed('2026-08', transactions, 10, NOW);
    expect(result.isFullCycle).toBe(true);
    expect(result.currentSpend).toBe(1_600_000);
    expect(result.elapsedDays).toBe(31);
  });

  it('reports nothing before the cycle starts', () => {
    const result = compareCycleElapsed('2026-10', transactions, 10, NOW);
    expect(result.elapsedDays).toBe(0);
    expect(result.currentSpend).toBe(0);
    expect(result.deltaPercent).toBeNull();
  });
});

describe('reviewUncategorized', () => {
  const categories: Category[] = [
    { id: 'food', name: '식비', type: 'expense', color: '', icon: '', active: true },
    { id: 'other', name: '기타', type: 'expense', color: '', icon: '', active: true },
  ];

  it('counts catch-all rows and their share of living expenses', () => {
    const period = getAccountingPeriod('2026-09', 10, NOW);
    const review = reviewUncategorized([
      tx('2026-09-11', 100_000), tx('2026-09-12', 50_000, { categoryId: 'other' }), tx('2026-09-13', 50_000, { categoryId: 'other' }),
      tx('2026-09-14', 30_000, { categoryId: 'other', recurringTemplateId: 'rent' }), // fixed: excluded
    ], categories, period);
    expect(review).toEqual({ categoryName: '기타', count: 2, amount: 100_000, sharePercent: 50 });
  });

  it('returns null when there is no catch-all category', () => {
    expect(reviewUncategorized([], [categories[0]], getAccountingPeriod('2026-09', 10, NOW))).toBeNull();
  });
});
