import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoPostingCandidates, shouldOnboard, toBudgetInput, transactionForStorage } from './adapter';
import {
  emptyLocalAccount,
  ensureLocalOccurrences,
  postLocalOccurrence,
  putLocalTemplate,
  setupLocalAccount,
} from './localAccount';
import { configurePaydaySchedule } from '../utils/paydaySchedule';
import { calculateBudget } from '../lib/calculator';
import { getScheduledDatesInPeriod, getAccountingPeriod } from '../utils/calculations';
import type { TemplateInput } from './RecurringManager';
import { transactionWrite, budgetWrite } from '../utils/firestoreWrites';

const now = new Date(2026, 9, 19, 12);
const template: TemplateInput = {
  type: 'expense',
  name: '월세',
  defaultAmount: 500000,
  categoryId: 'housing_utilities',
  counterparty: '월세',
  expenseNature: 'fixed',
  frequency: 'monthly',
  dayOfMonth: 19,
  holidayPolicy: 'fixed_date',
  postingMode: 'confirm',
  allowAmountChange: false,
  startDate: '2026-10-01',
  nextDueDate: '2026-10-19',
  active: true,
};
beforeEach(() => configurePaydaySchedule());
afterEach(() => configurePaydaySchedule());

describe('existing account adapter', () => {
  it('does not prompt established or skipped accounts, and resumes partial setup', () => {
    const empty = emptyLocalAccount(now);
    expect(shouldOnboard(empty)).toBe(true);
    expect(shouldOnboard(putLocalTemplate(empty, template, 'rent', now))).toBe(false);
    expect(shouldOnboard({ ...empty, profile: { ...empty.profile, onboardingCompletedAt: now.toISOString() } })).toBe(
      false,
    );
    expect(shouldOnboard(putLocalTemplate(empty, { ...template, budgetSetupRole: 'fixed' }, 'setup', now))).toBe(true);
  });
  it('preserves explicit period keys, one-off flags, fixed nature and excludes transfers/settlements', () => {
    let data = putLocalTemplate(emptyLocalAccount(now), template, 'rent', now);
    data = postLocalOccurrence(data, data.occurrences[0].id, 500000, now);
    const fixed = data.transactions[0];
    data.transactions.push(
      { ...fixed, id: 'transfer', role: 'transfer' },
      { ...fixed, id: 'card', role: 'card_settlement' },
      {
        ...fixed,
        id: 'special',
        recurringTemplateId: null,
        recurringOccurrenceKey: null,
        expenseNature: 'variable',
        isOneOff: true,
        budgetPeriodKey: '2026-11',
      },
    );
    const input = toBudgetInput(data, now);
    expect(input.transactions).toHaveLength(2);
    expect(input.transactions.find((t) => t.id === fixed.id)).toMatchObject({
      expenseNature: 'fixed',
      budgetPeriodKey: '2026-10',
    });
    expect(input.transactions.find((t) => t.id === 'special')).toMatchObject({
      isOneOff: true,
      budgetPeriodKey: '2026-11',
    });
    expect(calculateBudget(input).confirmedFixedExpense).toBe(500000);
    expect(calculateBudget(input).accumulatedOneOffExpense).toBe(0);
  });
  it('uses registered early-start period boundaries instead of reconstructing them from the day', () => {
    configurePaydaySchedule(null, { monthStartDay: 25, cycleStartOverrides: { '2026-10': '2026-10-23' } });
    const data = emptyLocalAccount(now);
    data.profile.monthStartDay = 25;
    const input = toBudgetInput(data, new Date(2026, 9, 23, 12));
    expect(input.period).toMatchObject({ key: '2026-10', start: '2026-10-23', end: '2026-11-24' });
    expect(calculateBudget(input).remainingDaysIncludingToday).toBe(33);
  });
  it('counts only this cycle installment charge, not the whole purchase', () => {
    let data = putLocalTemplate(emptyLocalAccount(now), template, 'rent', now);
    data = postLocalOccurrence(data, data.occurrences[0].id, 120000, now);
    data.transactions = [
      {
        ...data.transactions[0],
        recurringTemplateId: null,
        recurringOccurrenceKey: null,
        installment: { totalMonths: 12, currentRound: 1, baseYearMonth: '2026-10' },
      },
    ];
    expect(toBudgetInput(data, now).transactions[0]).toMatchObject({ amount: 10000, isOneOff: true });
  });
  it('treats a newly created account as insufficient data and carries coupon defaults', () => {
    const data = emptyLocalAccount(now);
    data.historyFloor = '2026-09-01';
    data.profile.categoryCountLimits = { delivery_food: 6 };
    const input = toBudgetInput(data, now);
    expect(input.settings.categoryCountLimits).toEqual({ delivery_food: 6 });
    expect(calculateBudget(input).forecastStatus).toBe('insufficient_data');
  });
  it('keeps new fields in account-scoped Firestore write payloads', () => {
    const transaction = transactionForStorage({
      id: 'draft',
      type: 'expense',
      amount: 1000,
      localDate: '2026-10-19',
      budgetPeriodKey: '2026-10',
      expenseNature: 'variable',
      isOneOff: true,
      categoryId: 'groceries',
    });
    const entry = transactionWrite({
      ...transaction,
      id: 'saved',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }).entry;
    expect(entry.data).toMatchObject({ budgetPeriodKey: '2026-10', isOneOff: true, amount: 1000 });
    expect(
      budgetWrite({ ...emptyLocalAccount(now).budget, categoryCountLimits: { delivery_food: 6 } }).entry.data,
    ).toMatchObject({ categoryCountLimits: { delivery_food: 6 } });
  });
});

describe('recurring lifecycle', () => {
  it('generates once, posts once, and advances both revisions exactly once', () => {
    let data = putLocalTemplate(emptyLocalAccount(now), template, 'rent', now);
    data = ensureLocalOccurrences(ensureLocalOccurrences(data, now), now);
    expect(data.occurrences).toHaveLength(1);
    const id = data.occurrences[0].id;
    data = postLocalOccurrence(data, id, 500000, now);
    data = postLocalOccurrence(data, id, 500000, now);
    expect(data.transactions).toHaveLength(1);
    expect(data.occurrences[0]).toMatchObject({ status: 'posted', revision: 1, budgetPeriodKey: '2026-10' });
    expect(data.transactions[0]).toMatchObject({ revision: 1, amount: 500000 });
  });
  it('never auto-posts legacy auto, future, skipped, inactive or variable-amount items', () => {
    const data = putLocalTemplate(emptyLocalAccount(now), { ...template, postingMode: 'auto' }, 'rent', now);
    expect(autoPostingCandidates(data, '2026-10-19')).toEqual([]);
    data.templates[0].budgetAutoPostingEnabled = true;
    expect(autoPostingCandidates(data, '2026-10-19')).toEqual([{ id: data.occurrences[0].id, amount: 500000 }]);
    expect(autoPostingCandidates(data, '2026-10-18')).toEqual([]);
    data.templates[0].budgetAutoPostingStartDate = '2026-11-01';
    expect(autoPostingCandidates(data, '2026-10-19')).toEqual([]);
    data.templates[0].budgetAutoPostingStartDate = '2026-10-01';
    expect(
      autoPostingCandidates(
        { ...data, occurrences: data.occurrences.map((o) => ({ ...o, status: 'skipped' })) },
        '2026-10-19',
      ),
    ).toEqual([]);
    data.templates[0].allowAmountChange = true;
    expect(autoPostingCandidates(data, '2026-10-19')).toEqual([]);
    data.templates[0].allowAmountChange = false;
    data.templates[0].active = false;
    expect(autoPostingCandidates(data, '2026-10-19')).toEqual([]);
  });
  it('handles weekends and user-specified public holidays for both policies', () => {
    const base = {
      ...template,
      id: 'salary',
      dayOfMonth: 9,
      createdAt: '',
      updatedAt: '',
      nonBusinessDates: ['2026-10-09'],
    };
    const period = getAccountingPeriod('2026-10', 1, now);
    expect(getScheduledDatesInPeriod({ ...base, holidayPolicy: 'previous_business_day' }, period)).toEqual([
      '2026-10-08',
    ]);
    expect(getScheduledDatesInPeriod({ ...base, holidayPolicy: 'next_business_day' }, period)).toEqual(['2026-10-12']);
    expect(getScheduledDatesInPeriod({ ...base, holidayPolicy: 'fixed_date' }, period)).toEqual(['2026-10-09']);
  });
  it('retries setup without duplicate templates and preserves the coupon choice', () => {
    const setup = { salary: 3000000, salaryDay: 25, fixed: 500000, fixedDay: 1, limit: 600000, deliveryCount: 6 };
    const first = setupLocalAccount(emptyLocalAccount(now), setup, now);
    const second = setupLocalAccount(first, setup, now);
    expect(second.templates).toHaveLength(2);
    expect(second.profile.onboardingCompletedAt).toBeTruthy();
    expect(second.budget.categoryCountLimits).toEqual({ delivery_food: 6 });
  });
});
