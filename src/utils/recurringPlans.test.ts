import { describe, expect, it } from 'vitest';
import { RecurringOccurrence } from '../types';
import { getCarriedRecurringAmount, getRecurringAmountSuggestion } from './recurringPlans';

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

describe('next-cycle amount suggestion', () => {
  it('suggests the most recent confirmed cycle amount and names its source cycle', () => {
    const suggestion = getRecurringAmountSuggestion('utilities', 90_000, '2026-10-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 110_000 }),
      occurrence({ id: 'september', scheduledDate: '2026-09-25', actualAmount: 125_000 }),
    ]);
    expect(suggestion).toEqual({ amount: 125_000, status: 'suggested', source: 'previous_cycle', sourceCycle: '2026-09' });
  });

  it('ignores skipped cycles and falls back to the legacy template amount', () => {
    const suggestion = getRecurringAmountSuggestion('utilities', 90_000, '2026-09-25', [
      occurrence({ status: 'skipped', actualAmount: 300_000 }),
    ]);
    expect(suggestion).toEqual({ amount: 90_000, status: 'suggested', source: 'legacy_template', sourceCycle: null });
  });

  // PRD-ui-renewal §6: the 30% tolerance rule that reverted a spike to the
  // template amount is retired. The previous cycle's final amount is always
  // the suggestion; it is a suggestion, never an automatic confirmation.
  it('carries a one-off spike as a suggestion instead of reverting to the template', () => {
    const suggestion = getRecurringAmountSuggestion('utilities', 90_000, '2026-10-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 95_000 }),
      occurrence({ id: 'september', scheduledDate: '2026-09-25', actualAmount: 300_000 }),
    ]);
    expect(suggestion.amount).toBe(300_000);
    expect(suggestion.status).toBe('suggested');
    expect(suggestion.sourceCycle).toBe('2026-09');
  });

  it('still carries a gradual climb across several months', () => {
    expect(getCarriedRecurringAmount('utilities', 90_000, '2026-11-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 95_000 }),
      occurrence({ id: 'september', scheduledDate: '2026-09-25', actualAmount: 112_000 }),
      occurrence({ id: 'october', scheduledDate: '2026-10-25', actualAmount: 130_000 }),
    ])).toBe(130_000);
  });

  it('does not use a merely suggested cycle as evidence for the next one', () => {
    // September only holds a copied suggestion; the last confirmed value is August.
    const suggestion = getRecurringAmountSuggestion('utilities', 90_000, '2026-10-25', [
      occurrence({ scheduledDate: '2026-08-25', actualAmount: 95_000 }),
      occurrence({
        id: 'september', scheduledDate: '2026-09-25',
        plannedAmount: 95_000, amountStatus: 'suggested', amountSource: 'previous_cycle', sourceCycle: '2026-08',
      }),
    ]);
    expect(suggestion.amount).toBe(95_000);
    expect(suggestion.sourceCycle).toBe('2026-08');
  });

  it('leaves the amount empty when there is no evidence at all', () => {
    const suggestion = getRecurringAmountSuggestion('insurance', undefined, '2026-10-25', []);
    expect(suggestion).toEqual({ amount: null, status: 'missing', source: null, sourceCycle: null });
  });

  it('treats a confirmed zero as evidence, distinct from a missing amount', () => {
    const suggestion = getRecurringAmountSuggestion('utilities', 90_000, '2026-10-25', [
      occurrence({ scheduledDate: '2026-09-25', plannedAmount: 0, amountStatus: 'confirmed', amountSource: 'manual' }),
    ]);
    expect(suggestion.amount).toBe(0);
    expect(suggestion.status).toBe('suggested');
  });
});
