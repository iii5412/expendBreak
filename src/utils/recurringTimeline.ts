import { RecurringOccurrence } from '../types';

const PENDING_STATUSES = new Set<RecurringOccurrence['status']>([
  'scheduled',
  'needs_confirmation',
  'overdue',
]);

/**
 * Items that still need to be handled in the selected accounting period.
 * Posted and skipped occurrences must not appear as future work on the dashboard.
 */
export function getPendingRecurringTimeline(
  occurrences: RecurringOccurrence[],
): RecurringOccurrence[] {
  return occurrences
    .filter(occurrence => PENDING_STATUSES.has(occurrence.status))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}
