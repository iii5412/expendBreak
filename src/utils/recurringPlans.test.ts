import { describe, expect, it } from 'vitest';
import { RecurringOccurrence } from '../types';
import { getCarriedRecurringAmount } from './recurringPlans';

const occurrence = (overrides: Partial<RecurringOccurrence>): RecurringOccurrence => ({
  id: 'occurrence',
  templateId: 'utilities',
  occurrenceKey: 'utilities_2026-08-25',
  scheduledDate: '2026-08-25',
  expectedAmount: 100_000,
  actualAmount: null,
  status: 'needs_confirmation',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('monthly recurring plan carry-forward', () => {
  it('copies the most recent month-specific amount into the next month', () => {
    expect(getCarriedRecurringAmount('utilities', 90_000, '2026-10-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 110_000 }),
      occurrence({ id: 'september', scheduledDate: '2026-09-25', actualAmount: 125_000 }),
    ])).toBe(125_000);
  });

  it('falls back to the template amount and ignores skipped months', () => {
    expect(getCarriedRecurringAmount('utilities', 90_000, '2026-09-25', [
      occurrence({ status: 'skipped', actualAmount: 300_000 }),
    ])).toBe(90_000);
  });

  it('does not let a one-off spike become the new baseline', () => {
    expect(getCarriedRecurringAmount('utilities', 90_000, '2026-10-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 95_000 }),
      occurrence({ id: 'september', scheduledDate: '2026-09-25', actualAmount: 300_000 }),
    ])).toBe(90_000);
  });

  it('still carries a gradual climb across several months', () => {
    expect(getCarriedRecurringAmount('utilities', 90_000, '2026-11-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 95_000 }),
      occurrence({ id: 'september', scheduledDate: '2026-09-25', actualAmount: 112_000 }),
      occurrence({ id: 'october', scheduledDate: '2026-10-25', actualAmount: 130_000 }),
    ])).toBe(130_000);
  });

  it('compares the first recorded month against the template amount', () => {
    expect(getCarriedRecurringAmount('utilities', 90_000, '2026-09-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 400_000 }),
    ])).toBe(90_000);
  });
});
