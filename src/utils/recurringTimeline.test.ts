import { describe, expect, it } from 'vitest';
import { RecurringOccurrence } from '../types';
import { getPendingRecurringTimeline } from './recurringTimeline';

const occurrence = (
  id: string,
  scheduledDate: string,
  status: RecurringOccurrence['status'],
): RecurringOccurrence => ({
  id,
  templateId: `template_${id}`,
  occurrenceKey: `template_${id}_${scheduledDate}`,
  scheduledDate,
  expectedAmount: 10_000,
  status,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

describe('getPendingRecurringTimeline', () => {
  it('keeps only unprocessed items and sorts them by scheduled date', () => {
    const result = getPendingRecurringTimeline([
      occurrence('posted', '2026-08-03', 'posted'),
      occurrence('later', '2026-08-25', 'scheduled'),
      occurrence('skipped', '2026-08-04', 'skipped'),
      occurrence('overdue', '2026-08-10', 'overdue'),
      occurrence('confirm', '2026-08-15', 'needs_confirmation'),
    ]);

    expect(result.map(item => item.id)).toEqual(['overdue', 'confirm', 'later']);
  });
});
