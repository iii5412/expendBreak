import { RecurringOccurrence } from '../types';

/** Beyond this gap the previous month reads as a one-off, not the new normal. */
const CARRY_FORWARD_TOLERANCE = 0.3;

/**
 * A new monthly occurrence inherits the latest saved amount for the same item.
 * Card bills are not represented by recurring occurrences; they are calculated
 * separately from card-linked transactions and therefore are never copied here.
 *
 * An unusually large or small month is not carried: a one-time settlement or a
 * skipped payment would otherwise become the silent baseline for every month
 * after it. Those fall back to the template amount for the user to adjust.
 */
export function getCarriedRecurringAmount(
  templateId: string,
  defaultAmount: number,
  scheduledDate: string,
  occurrences: RecurringOccurrence[],
): number {
  const history = occurrences
    .filter(occurrence => occurrence.templateId === templateId
      && occurrence.scheduledDate < scheduledDate
      && occurrence.status !== 'skipped')
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate));

  const amountOf = (occurrence?: RecurringOccurrence) =>
    occurrence ? Math.round(occurrence.actualAmount ?? occurrence.expectedAmount) : null;

  const previousAmount = amountOf(history[0]);
  if (previousAmount === null) return Math.round(defaultAmount);

  // Compare the last month against the one before it, not against the template:
  // utilities climb gradually all summer and that drift is the real amount. What
  // must not stick is a single spike, so an outlier month falls back instead.
  const reference = amountOf(history[1]) ?? Math.round(defaultAmount);
  if (reference > 0) {
    const drift = Math.abs(previousAmount - reference) / reference;
    if (drift > CARRY_FORWARD_TOLERANCE) return Math.round(defaultAmount);
  }
  return previousAmount;
}
