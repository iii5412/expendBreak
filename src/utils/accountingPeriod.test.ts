import { describe, expect, it } from 'vitest';
import { Budget, Transaction } from '../types';
import {
  calculateMonthSummary,
  formatPeriodRange,
  getAccountingPeriod,
  getCategoryBreakdown,
  getCurrentYearMonth,
  getMonthDaysInfo,
  getYearMonthForDate,
  normalizeMonthStartDay,
  shiftYearMonth,
} from './calculations';

const now = new Date(2026, 7, 10); // 2026-08-10
const budget: Budget = {
  yearMonth: '2026-08',
  totalLimit: 1_000_000,
  thresholds: [0.7, 0.85, 1],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx', type: 'expense', amount: 100_000, occurredAt: '2026-08-01T12:00:00.000Z',
  localDate: '2026-08-01', categoryId: 'food', merchant: '상점', memo: '', source: 'manual',
  createdAt: now.toISOString(), updatedAt: now.toISOString(), ...overrides,
});

describe('accounting period', () => {
  it('treats start day 1 as the plain calendar month', () => {
    const period = getAccountingPeriod('2026-08', 1, now);
    expect(period.startDate).toBe('2026-08-01');
    expect(period.endDate).toBe('2026-08-31');
    expect(period.daysInMonth).toBe(31);
    expect(period.daysPassed).toBe(10);
    expect(period.daysRemaining).toBe(22);
  });

  it('runs a payday cycle from the start day to the day before the next one', () => {
    const period = getAccountingPeriod('2026-08', 25, new Date(2026, 7, 30));
    expect(period.startDate).toBe('2026-08-25');
    expect(period.endDate).toBe('2026-09-24');
    expect(period.daysInMonth).toBe(31);
    expect(period.daysPassed).toBe(6);
    expect(period.daysRemaining).toBe(26);
  });

  it('reports a period that has not started and one that has ended', () => {
    expect(getAccountingPeriod('2026-09', 1, now).daysPassed).toBe(0);
    expect(getAccountingPeriod('2026-07', 1, now).daysPassed).toBe(31);
    expect(getAccountingPeriod('2026-07', 1, now).daysRemaining).toBe(1);
  });

  it('handles February and a shorter following month', () => {
    const february = getAccountingPeriod('2026-02', 1, now);
    expect(february.daysInMonth).toBe(28);
    const across = getAccountingPeriod('2026-01', 28, now);
    expect(across.startDate).toBe('2026-01-28');
    expect(across.endDate).toBe('2026-02-27');
  });

  it('clamps the start day to a value every month actually has', () => {
    expect(normalizeMonthStartDay(31)).toBe(28);
    expect(normalizeMonthStartDay(0)).toBe(1);
    expect(normalizeMonthStartDay(undefined)).toBe(1);
    expect(normalizeMonthStartDay(25)).toBe(25);
  });

  it('maps a date to the period that contains it', () => {
    expect(getYearMonthForDate('2026-09-02', 25)).toBe('2026-08');
    expect(getYearMonthForDate('2026-09-25', 25)).toBe('2026-09');
    expect(getYearMonthForDate('2026-09-02', 1)).toBe('2026-09');
    expect(getCurrentYearMonth(25, new Date(2026, 8, 2))).toBe('2026-08');
    expect(getCurrentYearMonth(1, new Date(2026, 8, 2))).toBe('2026-09');
  });

  it('shifts period labels across year boundaries', () => {
    expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftYearMonth('2026-12', 1)).toBe('2027-01');
  });

  it('labels the range only when it is not a calendar month', () => {
    expect(formatPeriodRange(getAccountingPeriod('2026-08', 1, now))).toBe('');
    expect(formatPeriodRange(getAccountingPeriod('2026-08', 25, now))).toBe('8/25~9/24');
  });
});

describe('period-aware aggregation', () => {
  const transactions = [
    tx({ id: 'before', localDate: '2026-08-20', amount: 50_000 }),
    tx({ id: 'inside', localDate: '2026-08-26', amount: 70_000 }),
    tx({ id: 'nextMonth', localDate: '2026-09-05', amount: 30_000 }),
    tx({ id: 'afterEnd', localDate: '2026-09-25', amount: 90_000 }),
  ];

  it('counts only transactions inside the payday cycle', () => {
    const summary = calculateMonthSummary('2026-08', transactions, [], budget, [], new Date(2026, 8, 1), 25);
    expect(summary.confirmedVariableExpenses).toBe(100_000); // 26일 70,000 + 9/5 30,000
  });

  it('produces the same totals as before when the start day is 1', () => {
    const summary = calculateMonthSummary('2026-08', transactions, [], budget, [], now, 1);
    const legacyEquivalent = transactions
      .filter(transaction => transaction.localDate.startsWith('2026-08'))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    expect(summary.confirmedVariableExpenses).toBe(legacyEquivalent);
    expect(getMonthDaysInfo('2026-08', now)).toEqual({ daysInMonth: 31, daysPassed: 10, daysRemaining: 22 });
  });

  it('applies the period to the category breakdown', () => {
    const categoryMap = {
      food: { name: '식비', color: '#f00', icon: 'Food', type: 'expense' as const },
    };
    const scoped = getCategoryBreakdown('2026-08', transactions, categoryMap, { monthStartDay: 25 });
    expect(scoped[0].amount).toBe(100_000);

    const calendar = getCategoryBreakdown('2026-08', transactions, categoryMap, { monthStartDay: 1 });
    expect(calendar[0].amount).toBe(120_000);
  });
});
