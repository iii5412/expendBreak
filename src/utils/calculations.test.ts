import { describe, expect, it } from 'vitest';
import { Budget, Category, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { calculateMonthSummary, getCategoryBreakdown } from './calculations';

const now = new Date(2026, 7, 10);
const budget: Budget = {
  yearMonth: '2026-08',
  totalLimit: 1_000_000,
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

  it('keeps fixed expenses outside the user allowance and derives planned savings', () => {
    const fixedTemplate: RecurringTemplate = {
      id: 'rent',
      type: 'expense',
      name: '월세',
      defaultAmount: 400_000,
      categoryId: 'food',
      counterparty: '임대인',
      expenseNature: 'fixed',
      frequency: 'monthly',
      dayOfMonth: 1,
      holidayPolicy: 'fixed_date',
      postingMode: 'auto',
      allowAmountChange: false,
      startDate: '2026-01-01',
      nextDueDate: '2026-09-01',
      active: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const pendingFixed: RecurringOccurrence = {
      id: 'rent-pending',
      templateId: fixedTemplate.id,
      occurrenceKey: 'rent_2026-08-25',
      scheduledDate: '2026-08-25',
      expectedAmount: 100_000,
      status: 'scheduled',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const allowanceBudget = { ...budget, totalLimit: 500_000 };
    const transactions = [
      tx({ id: 'income', type: 'income', categoryId: 'salary', amount: 3_000_000 }),
      tx({ id: 'fixed', amount: 400_000, recurringTemplateId: fixedTemplate.id }),
      tx({ id: 'variable', amount: 200_000 }),
    ];

    const summary = calculateMonthSummary(
      '2026-08',
      transactions,
      [pendingFixed],
      allowanceBudget,
      [fixedTemplate],
      now,
    );

    expect(summary.confirmedExpenses).toBe(600_000);
    expect(summary.confirmedFixedExpenses).toBe(400_000);
    expect(summary.confirmedVariableExpenses).toBe(200_000);
    expect(summary.totalExpectedFixedExpenses).toBe(500_000);
    expect(summary.disposableAfterFixed).toBe(2_500_000);
    expect(summary.allowanceLimit).toBe(500_000);
    expect(summary.remainingAllowance).toBe(300_000);
    expect(summary.plannedSavings).toBe(2_000_000);
    expect(summary.budgetUsagePercent).toBe(40);
  });

  it('can exclude recurring fixed expenses from the allowance category breakdown', () => {
    const categoryMap = Object.fromEntries(categories.map(category => [category.id, category]));
    const breakdown = getCategoryBreakdown(
      '2026-08',
      [tx({ id: 'fixed', amount: 400_000, recurringTemplateId: 'rent' }), tx({ id: 'variable', amount: 150_000 })],
      categoryMap,
      { variableOnly: true },
    );

    expect(breakdown).toEqual([expect.objectContaining({ amount: 150_000, percent: 100 })]);
  });
});
