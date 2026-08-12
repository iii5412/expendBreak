import { describe, expect, it } from 'vitest';
import { RecurringOccurrence, RecurringTemplate } from '../types';
import { normalizeRecurringOccurrencesForMonth } from './recurringNormalization';

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
