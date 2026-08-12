import { RecurringOccurrence } from '../types';

/**
 * A new monthly occurrence inherits the latest saved amount for the same item.
 * Card bills are not represented by recurring occurrences; they are calculated
 * separately from card-linked transactions and therefore are never copied here.
 */
export function getCarriedRecurringAmount(
  templateId: string,
  defaultAmount: number,
  scheduledDate: string,
  occurrences: RecurringOccurrence[],
): number {
  const previous = occurrences
    .filter(occurrence => occurrence.templateId === templateId
      && occurrence.scheduledDate < scheduledDate
      && occurrence.status !== 'skipped')
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate))[0];

  return Math.round(previous?.actualAmount ?? previous?.expectedAmount ?? defaultAmount);
}
