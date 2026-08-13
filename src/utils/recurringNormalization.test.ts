import { describe, expect, it } from 'vitest';
import { RecurringOccurrence, RecurringTemplate } from '../types';
import { getScheduledDatesForMonth, normalizeRecurringOccurrencesForMonth } from './recurringNormalization';

const now = '2026-08-11T00:00:00.000Z';
const template: RecurringTemplate = {
  id: 'rent', type: 'expense', name: '월세', defaultAmount: 500_000, categoryId: 'housing',
  counterparty: '임대인', frequency: 'monthly', dayOfMonth: 10, holidayPolicy: 'fixed_date',
  postingMode: 'confirm', allowAmountChange: false, startDate: '2026-01-01', nextDueDate: '2026-09-10',
  active: true, createdAt: now, updatedAt: now,
};
const occurrence = (id: string, scheduledDate: string, status: RecurringOccurrence['status'] = 'needs_confirmation'): RecurringOccurrence => ({
  id, templateId: template.id, occurrenceKey: `${template.id}_${scheduledDate}`, scheduledDate,
  expectedAmount: 500_000, status, createdAt: now, updatedAt: now,
});

describe('recurring occurrence normalization', () => {
  it('removes the old unposted date after a due date changes', () => {
    const result = normalizeRecurringOccurrencesForMonth([
      occurrence('old-15th', '2026-09-15'),
      occurrence('current-10th', '2026-09-10'),
    ], [template], '2026-09');

    expect(result.occurrences.map(item => item.id)).toEqual(['current-10th']);
    expect(result.removedIds).toEqual(['old-15th']);
  });

  it('preserves a posted historical item and removes a newly generated duplicate', () => {
    const result = normalizeRecurringOccurrencesForMonth([
      occurrence('paid-15th', '2026-09-15', 'posted'),
      occurrence('duplicate-10th', '2026-09-10'),
    ], [template], '2026-09');

    expect(result.occurrences.map(item => item.id)).toEqual(['paid-15th']);
    expect(result.removedIds).toEqual(['duplicate-10th']);
  });
});

describe('holiday shifts stay inside their salary cycle', () => {
  const salary: RecurringTemplate = {
    ...template,
    id: 'salary', type: 'income', name: '급여', dayOfMonth: 10,
    holidayPolicy: 'previous_business_day',
  };

  it('does not pull a due date back into the previous cycle', () => {
    // 2026-10-10 is a Saturday. Shifted back it becomes 10/09, which sits in the
    // 9/10~10/9 cycle that already holds 9/10 — the salary counted twice there
    // and vanished from the cycle starting 10/10.
    expect(getScheduledDatesForMonth(salary, '2026-09', 10)).toEqual(['2026-09-10']);
    expect(getScheduledDatesForMonth(salary, '2026-10', 10)).toEqual(['2026-10-12']);
  });

  it('still applies the policy when it does not cross a boundary', () => {
    // 2026-09-05 is a Saturday and the cycle starts on the 25th, so moving back
    // to Friday 9/04 keeps it in the same cycle.
    const early = { ...salary, dayOfMonth: 5 };
    expect(getScheduledDatesForMonth(early, '2026-09', 25)).toEqual(['2026-09-04']);
  });

  it('removes an occurrence left on the boundary-crossing date', () => {
    const result = normalizeRecurringOccurrencesForMonth([
      { ...occurrence('stale-10-09', '2026-10-09'), templateId: salary.id },
    ], [salary], '2026-10', 10);

    expect(result.removedIds).toEqual(['stale-10-09']);
  });
});
