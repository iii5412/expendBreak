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

  it('does not count a deleted template occurrence as an expense even when it has a type snapshot', () => {
    const occurrence: RecurringOccurrence = {
      id: 'orphan', templateId: 'missing', occurrenceKey: 'missing_2026-08-10', scheduledDate: '2026-08-10',
      expectedAmount: 300_000, status: 'scheduled', typeSnapshot: 'expense',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const summary = calculateMonthSummary('2026-08', [], [occurrence], budget, [] as RecurringTemplate[], now);
    expect(summary.remainingScheduledExpenses).toBe(0);
  });

  it('uses configured alert thresholds', () => {
    const summary = calculateMonthSummary('2026-08', [
      tx({ id: 'income', type: 'income', categoryId: 'salary', amount: 1_000_000 }),
      tx({ amount: 520_000 }),
    ], [], budget, [], now);
    expect(summary.alertLevel).toBe('caution');
  });

  it('plans on scheduled income before it is deposited, but keeps reported income at zero', () => {
    const incomeTemplate: RecurringTemplate = {
      id: 'salary-template', type: 'income', name: '급여', defaultAmount: 3_000_000,
      categoryId: 'salary', counterparty: '회사', frequency: 'monthly', dayOfMonth: 10,
      holidayPolicy: 'previous_business_day', postingMode: 'confirm', allowAmountChange: true,
      startDate: '2026-01-01', nextDueDate: '2026-08-10', active: true,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const scheduledIncome: RecurringOccurrence = {
      id: 'salary-pending', templateId: incomeTemplate.id, occurrenceKey: 'salary_2026-08-10',
      scheduledDate: '2026-08-10', expectedAmount: 3_000_000, status: 'needs_confirmation',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };

    const summary = calculateMonthSummary('2026-08', [], [scheduledIncome], budget, [incomeTemplate], now, 10);
    expect(summary.scheduledIncome).toBe(3_000_000);
    // Reported income counts deposits only...
    expect(summary.totalIncome).toBe(0);
    // ...while planning uses the scheduled deposit and says so.
    expect(summary.isProjected).toBe(true);
    expect(summary.planningIncome).toBe(3_000_000);
    expect(summary.spendableLimit).toBe(budget.totalLimit);
  });

  it('reserves every active fixed expense in the salary cycle before its due date', () => {
    const fixedTemplate: RecurringTemplate = {
      id: 'insurance', type: 'expense', name: '보험료', defaultAmount: 250_000,
      categoryId: 'food', counterparty: '보험사', expenseNature: 'fixed', frequency: 'monthly', dayOfMonth: 25,
      holidayPolicy: 'next_business_day', postingMode: 'confirm', allowAmountChange: true,
      startDate: '2026-08-10', nextDueDate: '2026-08-25', active: true,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const salary = tx({ id: 'salary', type: 'income', categoryId: 'salary', amount: 3_000_000, localDate: '2026-08-10' });

    const summary = calculateMonthSummary('2026-08', [salary], [], budget, [fixedTemplate], now, 10);
    expect(summary.totalExpectedFixedExpenses).toBe(250_000);
    expect(summary.disposableAfterFixed).toBe(2_750_000);
    expect(summary.spendableLimit).toBe(1_000_000);
  });

  it('keeps settlements and transfers out of category spending and charges only one installment round', () => {
    const categoryMap = Object.fromEntries(categories.map(category => [category.id, category]));
    const transactions = [
      tx({ id: 'normal', amount: 50_000 }),
      tx({ id: 'settlement', amount: 900_000, role: 'card_settlement' }),
      tx({ id: 'transfer', amount: 300_000, role: 'transfer' }),
      tx({
        id: 'installment',
        amount: 300_000,
        installment: { totalMonths: 3, currentRound: 1, baseYearMonth: '2026-08' },
        paymentMethodType: 'card',
      }),
    ];

    const breakdown = getCategoryBreakdown('2026-08', transactions, categoryMap, { variableOnly: true });

    expect(breakdown).toEqual([expect.objectContaining({ categoryName: '식비', amount: 150_000 })]);
    expect(calculateMonthSummary('2026-08', transactions, [], budget, [], now).confirmedVariableExpenses)
      .toBe(150_000);
  });

  it('keeps an existing monthly plan unchanged until the master list is explicitly reloaded', () => {
    const newlyAddedMaster: RecurringTemplate = {
      id: 'new-insurance', type: 'expense', name: '새 보험료', defaultAmount: 180_000,
      categoryId: 'food', counterparty: '보험사', expenseNature: 'fixed', frequency: 'monthly', dayOfMonth: 25,
      holidayPolicy: 'next_business_day', postingMode: 'confirm', allowAmountChange: true,
      startDate: '2026-08-01', nextDueDate: '2026-08-25', active: true,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };

    const summary = calculateMonthSummary(
      '2026-08', [], [], budget, [newlyAddedMaster], now, 1,
      { reserveUnmaterializedTemplates: false },
    );

    expect(summary.totalExpectedFixedExpenses).toBe(0);
  });

  it('spends the same money whether a fixed expense leaves early or late in the cycle', () => {
    // Only cycle membership matters to "what is left": a bill due 8/28 and one
    // due 9/10 both leave the 8/25~9/24 cycle, and paying one changes nothing
    // either, because it was already reserved.
    const salaryDay = 25;
    const utility = (dayOfMonth: number): RecurringTemplate => ({
      id: 'utility', type: 'expense', name: '관리비', defaultAmount: 300_000,
      categoryId: 'food', counterparty: '관리사무소', expenseNature: 'fixed', frequency: 'monthly',
      dayOfMonth, holidayPolicy: 'fixed_date', postingMode: 'confirm', allowAmountChange: true,
      paymentMethodType: 'account', startDate: '2026-01-01', nextDueDate: '2026-09-10', active: true,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
    const due = (scheduledDate: string, status: RecurringOccurrence['status']): RecurringOccurrence => ({
      id: `utility_${scheduledDate}`, templateId: 'utility', occurrenceKey: `utility_${scheduledDate}`,
      scheduledDate, expectedAmount: 300_000, status, typeSnapshot: 'expense',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
    const salary = tx({ id: 'salary', type: 'income', categoryId: 'salary', amount: 3_000_000, localDate: '2026-08-25' });
    const summaryOf = (
      transactions: Transaction[], occurrence: RecurringOccurrence, dayOfMonth: number,
    ) => calculateMonthSummary(
      '2026-08', transactions, [occurrence], budget, [utility(dayOfMonth)], now, salaryDay,
    );

    const summaries = [
      summaryOf([salary], due('2026-08-28', 'needs_confirmation'), 28),
      summaryOf([salary], due('2026-09-10', 'needs_confirmation'), 10),
      summaryOf(
        [salary, tx({ id: 'paid', amount: 300_000, localDate: '2026-08-28', recurringTemplateId: 'utility' })],
        due('2026-08-28', 'posted'),
        28,
      ),
    ];

    expect(summaries.map(summary => summary.accountFixedOutflow)).toEqual([300_000, 300_000, 300_000]);
    expect(summaries.map(summary => summary.disposableAfterFixed)).toEqual([2_700_000, 2_700_000, 2_700_000]);
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
