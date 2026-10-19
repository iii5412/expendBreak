import { describe, expect, it } from 'vitest';
import { calculateBudget, floorKrw, getBudgetPeriod, getBudgetPeriodKey } from './calculator';
import type { BudgetCalculationInput, BudgetTransaction } from '../types/budget';

function expense(id: string, localDate: string, amount: number, extra: Partial<BudgetTransaction> = {}): BudgetTransaction {
  return { id, localDate, amount, budgetPeriodKey: '2026-10', type: 'expense', expenseNature: 'variable', isOneOff: false, ...extra };
}

function fixture(): BudgetCalculationInput {
  return {
    today: '2026-10-19', observationStartDate: '2026-10-01',
    settings: { monthStartDay: 1, variableExpenseLimit: 600_000 },
    templates: [{ id: 'rent', active: true, type: 'expense', expenseNature: 'fixed', amount: 500_000 }],
    transactions: [expense('groceries', '2026-10-18', 100_000)],
    occurrences: [{ id: 'subscription-oct', templateId: 'subscription', localDate: '2026-10-25', budgetPeriodKey: '2026-10', type: 'expense', expenseNature: 'variable', amount: 20_000, status: 'pending' }],
  };
}

describe('deterministic budget calculator', () => {
  it('subtracts today in full without diluting it across remaining days', () => {
    const input = fixture();
    const before = calculateBudget(input);
    input.transactions = [...input.transactions, expense('lunch', input.today, 50_000)];
    const after = calculateBudget(input);
    expect(before.safeBalanceAtStartOfDay).toBe(480_000);
    expect(before.remainingDaysIncludingToday).toBe(13);
    expect(before.todayAllowance).toBe(36_923);
    expect(after.todayAllowance).toBe(before.todayAllowance);
    expect(after.remainingToday).toBe(-13_077);
    expect(after.currentSafeBalance).toBe(430_000);
    expect(after.projectedTomorrowAllowance).toBe(35_833);
    expect(after.fixedExpenseBudget).toBe(500_000);
  });

  it('excludes one-off and fixed expenses from speed, but includes them once in forecast', () => {
    const input = fixture();
    input.transactions = [expense('daily', '2026-10-18', 14_001), expense('hospital', '2026-10-19', 300_000, { isOneOff: true }), expense('rent', '2026-10-01', 500_000, { expenseNature: 'fixed', isOneOff: true })];
    input.occurrences = [...input.occurrences, { ...input.occurrences[0], id: 'fixed', expenseNature: 'fixed', amount: 50_000 }];
    const result = calculateBudget(input);
    expect(result.dailyBurnRate).toBe(1_000);
    expect(result.burnRateObservationDays).toBe(14);
    expect(result.projectedPeriodEndExpense).toBe(876_001);
  });

  it('counts zero-spend days, requires three days, and carries recent history across periods', () => {
    const input = fixture();
    input.observationStartDate = '2026-10-18';
    expect(calculateBudget(input)).toMatchObject({ dailyBurnRate: null, projectedPeriodEndExpense: null, forecastStatus: 'insufficient_data' });
    input.observationStartDate = '2026-10-17';
    input.transactions = [];
    expect(calculateBudget(input)).toMatchObject({ dailyBurnRate: 0, forecastStatus: 'ready', burnRateObservationDays: 3 });
    input.today = '2026-10-02';
    input.observationStartDate = '2026-09-01';
    input.transactions = [expense('previous', '2026-09-30', 14_000, { budgetPeriodKey: '2026-09' })];
    expect(calculateBudget(input)).toMatchObject({ burnRateObservationDays: 14, dailyBurnRate: 1_000, accumulatedDailyVariableExpense: 0 });
  });

  it('reserves overdue items and excludes posted/skipped, income, other periods and future transactions', () => {
    const input = fixture();
    input.transactions = [expense('future', '2026-10-20', 200), expense('income', input.today, 200, { type: 'income' }), expense('old', input.today, 200, { budgetPeriodKey: '2026-09' })];
    const occurrence = input.occurrences[0];
    input.occurrences = [{ ...occurrence, localDate: '2026-10-01' }, { ...occurrence, id: 'posted', status: 'posted' }, { ...occurrence, id: 'skipped', status: 'skipped' }];
    expect(calculateBudget(input)).toMatchObject({ actualVariableToday: 0, pendingVariableExpense: 20_000, safeBalanceAtStartOfDay: 580_000 });
  });

  it('handles negative safe balances and the final day without dividing by zero', () => {
    const input = fixture();
    input.today = '2026-10-31';
    input.settings.variableExpenseLimit = 10_000;
    expect(calculateBudget(input)).toMatchObject({ todayAllowance: 0, currentSafeBalance: -110_000, projectedTomorrowAllowance: null, remainingDaysIncludingToday: 1 });
  });

  it('floors each KRW input and rejects invalid amounts and dates', () => {
    expect(floorKrw(12.99)).toBe(12);
    for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) expect(() => floorKrw(value)).toThrow();
    expect(() => getBudgetPeriodKey('2026-02-30', 1)).toThrow();
    expect(() => getBudgetPeriodKey('2026-10-19', 29)).toThrow();
    const input = fixture();
    input.transactions = [expense('a', input.today, 1.9), expense('b', input.today, 1.9)];
    expect(calculateBudget(input).actualVariableToday).toBe(2);
    input.settings.variableExpenseLimit = Number.MAX_SAFE_INTEGER;
    input.transactions = [expense('a', input.today, Number.MAX_SAFE_INTEGER)];
    expect(() => calculateBudget(input)).toThrow();
  });
});

describe('salary-day budget periods', () => {
  it('handles year boundaries, leap years and salary-day boundaries', () => {
    expect(getBudgetPeriod('2026-01-24', 25)).toEqual({ key: '2025-12', start: '2025-12-25', end: '2026-01-24' });
    expect(getBudgetPeriodKey('2026-01-25', 25)).toBe('2026-01');
    expect(getBudgetPeriod('2024-02-29', 1).end).toBe('2024-02-29');
    expect(getBudgetPeriod('2026-02-28', 28).end).toBe('2026-03-27');
  });

  it('keeps an early salary deposit in the nominal scheduled period only', () => {
    const input = fixture();
    input.settings.monthStartDay = 25;
    input.today = '2026-10-23';
    const salary = expense('salary', '2026-10-23', 3_000_000, { type: 'income', budgetPeriodKey: getBudgetPeriodKey('2026-10-25', 25) });
    expect(getBudgetPeriodKey(salary.localDate, 25)).toBe('2026-09');
    expect(salary.budgetPeriodKey).toBe('2026-10');
    input.transactions = [salary, expense('assigned', '2026-10-23', 500)];
    expect(calculateBudget(input).actualVariableToday).toBe(0);
    input.today = '2026-10-25';
    expect(calculateBudget(input).actualVariableBeforeToday).toBe(500);
  });
});
