import { describe, expect, it } from 'vitest';
import { buildBudgetAnalytics } from './analytics';
import type { BudgetCalculationInput, BudgetTransaction } from '../types/budget';
import { budgetWithSettings, toBudgetInput } from './adapter';
import { emptyLocalAccount } from './localAccount';
import { budgetWrite } from '../utils/firestoreWrites';

const row = (patch: Partial<BudgetTransaction>): BudgetTransaction => ({
  id: 't',
  localDate: '2026-10-19',
  budgetPeriodKey: '2026-10',
  type: 'expense',
  amount: 1000,
  expenseNature: 'variable',
  isOneOff: false,
  categoryId: 'food',
  ...patch,
});
const input = (transactions: BudgetTransaction[]): BudgetCalculationInput => ({
  today: '2026-10-19',
  observationStartDate: '2026-10-01',
  settings: {
    monthStartDay: 1,
    variableExpenseLimit: 600000,
    categoryAmountLimits: { food: 2000 },
    categoryCountLimits: { food: 2 },
  },
  transactions,
  templates: [],
  occurrences: [],
});

describe('budget analytics', () => {
  it('counts posted income/expenses once; excludes future and other cycles', () => {
    const data = buildBudgetAnalytics(
      input([
        row({ type: 'income', amount: 3000000 }),
        row({}),
        row({ expenseNature: 'fixed', amount: 500000 }),
        row({ localDate: '2026-10-20' }),
        row({ budgetPeriodKey: '2026-09' }),
      ]),
      { food: '식비' },
    );
    expect(data.income).toBe(3000000);
    expect(data.expense).toBe(501000);
    expect(data.categories[0]).toMatchObject({
      name: '식비',
      amount: 501000,
      variable: 1000,
      count: 1,
      budget: 2000,
      coupons: 2,
    });
  });
  it('includes one-off expenses and zero-spend days; future cumulative values stay blank', () => {
    const data = buildBudgetAnalytics(
      input([row({ localDate: '2026-10-02' }), row({ amount: 5000, isOneOff: true })]),
      {},
    );
    expect(data.days).toHaveLength(31);
    expect(data.days[0].spent).toBe(0);
    expect(data.days[17].spent).toBe(1000);
    expect(data.days[18]).toMatchObject({ spent: 6000, limit: 600000 });
    expect(data.days[19].spent).toBeNull();
    expect(data.categories[0].count).toBe(2);
  });
  it('preserves early charges explicitly assigned to shifted accounting periods', () => {
    const shifted = {
      ...input([row({ localDate: '2026-10-09' })]),
      period: { key: '2026-10', start: '2026-10-10', end: '2026-11-09' },
    };
    const data = buildBudgetAnalytics(shifted, {});
    expect(data.days[0]).toEqual({ date: '2026-10-10', spent: 1000, limit: 600000 });
    expect(data.days.at(-1)?.date).toBe('2026-11-09');
  });
  it('includes configured unused categories without inventing budgets', () => {
    const data = buildBudgetAnalytics(input([]), { food: '식비' });
    expect(data.categories).toEqual([
      { id: 'food', name: '식비', amount: 0, variable: 0, count: 0, budget: 2000, coupons: 2 },
    ]);
    expect(data.expense).toBe(0);
  });
  it('persists caps through the existing budget writer and adapter', () => {
    const account = emptyLocalAccount(new Date(2026, 9, 19));
    account.budget = budgetWithSettings(account.budget, input([]).settings);
    expect(budgetWrite(account.budget).entry.data).toMatchObject({ categoryAmountLimits: { food: 2000 } });
    expect(toBudgetInput(account, new Date(2026, 9, 19)).settings.categoryAmountLimits).toEqual({ food: 2000 });
  });
});
