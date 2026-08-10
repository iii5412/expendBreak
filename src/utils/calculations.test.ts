import { describe, expect, it } from 'vitest';
import { Budget, Category, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { calculateMonthSummary, getCategoryBreakdown } from './calculations';

const now = new Date(2026, 7, 10);
const budget: Budget = {
  yearMonth: '2026-08',
  totalLimit: 1_000_000,
  categoryLimits: {},
  thresholds: [0.5, 0.75, 0.9],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const categories: Category[] = [
  { id: 'salary', name: '급여', type: 'income', icon: 'Briefcase', color: '#0f0', active: true },
  { id: 'food', name: '식비', type: 'expense', icon: 'Food', color: '#f00', active: true },
];

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx', type: 'expense', amount: 100_000, occurredAt: '2026-08-01T12:00:00.000Z',
  localDate: '2026-08-01', categoryId: 'food', merchant: '상점', memo: '', source: 'manual',
  createdAt: now.toISOString(), updatedAt: now.toISOString(), ...overrides,
});

describe('financial calculations', () => {
  it('keeps mismatched expense categories in a review bucket without changing the expense total', () => {
    const transactions = [tx({ categoryId: 'salary', amount: 120_000 })];
    const categoryMap = Object.fromEntries(categories.map(category => [category.id, category]));
    const breakdown = getCategoryBreakdown('2026-08', transactions, categoryMap);
    expect(breakdown).toEqual([expect.objectContaining({ categoryName: '분류 확인 필요', amount: 120_000 })]);

    const summary = calculateMonthSummary('2026-08', transactions, [], budget, [], now);
    expect(summary.confirmedExpenses).toBe(120_000);
    expect(summary.confirmedIncome).toBe(0);
  });

  it('does not count an orphan occurrence as an expense', () => {
    const occurrence: RecurringOccurrence = {
      id: 'orphan', templateId: 'missing', occurrenceKey: 'missing_2026-08-10', scheduledDate: '2026-08-10',
      expectedAmount: 300_000, status: 'scheduled', createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const summary = calculateMonthSummary('2026-08', [], [occurrence], budget, [] as RecurringTemplate[], now);
    expect(summary.remainingScheduledExpenses).toBe(0);
  });

  it('uses configured alert thresholds', () => {
    const summary = calculateMonthSummary('2026-08', [tx({ amount: 520_000 })], [], budget, [], now);
    expect(summary.alertLevel).toBe('caution');
  });
});
