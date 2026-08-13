import { describe, expect, it } from 'vitest';
import { findRecurringMatches } from './recurringMatch';
import type { RecurringOccurrence, RecurringTemplate } from '../types';

const template = (overrides: Partial<RecurringTemplate> = {}): RecurringTemplate => ({
  id: 't_rent',
  type: 'expense',
  name: '월세',
  defaultAmount: 700_000,
  categoryId: 'housing_utilities',
  counterparty: '임대인',
  frequency: 'monthly',
  dayOfMonth: 10,
  holidayPolicy: 'fixed_date',
  postingMode: 'confirm',
  allowAmountChange: true,
  paymentMethodType: 'account',
  startDate: '2026-01-01',
  nextDueDate: '2026-08-10',
  active: true,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const occurrence = (overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence => ({
  id: 'occ_rent',
  templateId: 't_rent',
  occurrenceKey: 't_rent_2026-08-10',
  scheduledDate: '2026-08-10',
  expectedAmount: 700_000,
  actualAmount: null,
  status: 'needs_confirmation',
  typeSnapshot: 'expense',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const rentInput = {
  type: 'expense' as const,
  amount: 700_000,
  localDate: '2026-08-10',
  merchant: '임대인',
  categoryId: 'housing_utilities',
};

describe('recurring match detection', () => {
  it('matches a same-day, same-amount manual transfer', () => {
    const matches = findRecurringMatches(rentInput, [occurrence()], [template()]);

    expect(matches).toHaveLength(1);
    expect(matches[0].occurrence.id).toBe('occ_rent');
    expect(matches[0].expectedAmount).toBe(700_000);
  });

  it('tolerates a small amount difference and a few days', () => {
    const matches = findRecurringMatches(
      { ...rentInput, amount: 690_000, localDate: '2026-08-13' },
      [occurrence()],
      [template()],
    );

    expect(matches).toHaveLength(1);
  });

  it('rejects an amount outside tolerance', () => {
    expect(findRecurringMatches({ ...rentInput, amount: 500_000 }, [occurrence()], [template()])).toHaveLength(0);
  });

  it('rejects a date outside tolerance', () => {
    expect(findRecurringMatches({ ...rentInput, localDate: '2026-08-20' }, [occurrence()], [template()])).toHaveLength(0);
  });

  it('ignores occurrences already settled or skipped', () => {
    expect(findRecurringMatches(rentInput, [occurrence({ status: 'posted' })], [template()])).toHaveLength(0);
    expect(findRecurringMatches(rentInput, [occurrence({ status: 'skipped' })], [template()])).toHaveLength(0);
  });

  it('does not match across income and expense', () => {
    const matches = findRecurringMatches(
      { ...rentInput, type: 'income' },
      [occurrence()],
      [template()],
    );

    expect(matches).toHaveLength(0);
  });

  it('prefers the exact match when two recurring items are close', () => {
    const other = template({ id: 't_other', name: '관리비', counterparty: '관리사무소', defaultAmount: 690_000 });
    const matches = findRecurringMatches(rentInput, [
      occurrence({ id: 'occ_other', templateId: 't_other', expectedAmount: 690_000 }),
      occurrence(),
    ], [template(), other]);

    expect(matches).toHaveLength(2);
    expect(matches[0].occurrence.id).toBe('occ_rent');
  });

  it('uses the month-specific amount when one was saved', () => {
    const matches = findRecurringMatches(
      { ...rentInput, amount: 750_000 },
      [occurrence({ actualAmount: 750_000 })],
      [template()],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].expectedAmount).toBe(750_000);
  });

  it('ignores an orphaned occurrence whose template is gone', () => {
    expect(findRecurringMatches(rentInput, [occurrence()], [])).toHaveLength(0);
  });
});
