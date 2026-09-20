import { RecurringAmountSource, RecurringAmountStatus, RecurringOccurrence } from '../types';
import { resolveRecurringAmount } from './recurringAmounts';

export interface RecurringAmountSuggestion {
  amount: number | null;
  status: RecurringAmountStatus;
  source: RecurringAmountSource | null;
  sourceCycle: string | null;
}

/**
 * A new monthly occurrence inherits the latest saved amount for the same item.
 * Card bills are not represented by recurring occurrences; they are calculated
 * separately from card-linked transactions and therefore are never copied here.
 *
 * An unusually large or small month is not carried: a one-time settlement or a
 * skipped payment would otherwise become the silent baseline for every month
 * after it. Those fall back to the template amount for the user to adjust.
 */
export function getRecurringAmountSuggestion(
  templateId: string,
  legacyTemplateAmount: number | undefined,
  scheduledDate: string,
  occurrences: RecurringOccurrence[],
): RecurringAmountSuggestion {
  const history = occurrences
    .filter(occurrence => occurrence.templateId === templateId
      && occurrence.scheduledDate < scheduledDate
      && occurrence.status !== 'skipped'
      && resolveRecurringAmount(occurrence).status === 'confirmed')
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate));
  const previous = history[0];
  if (previous) {
    return {
      amount: resolveRecurringAmount(previous).amount,
      status: 'suggested', source: 'previous_cycle', sourceCycle: previous.scheduledDate.slice(0, 7),
    };
  }
  if (legacyTemplateAmount != null && legacyTemplateAmount > 0) {
    return { amount: Math.round(legacyTemplateAmount), status: 'suggested', source: 'legacy_template', sourceCycle: null };
  }
  return { amount: null, status: 'missing', source: null, sourceCycle: null };
}

/** @deprecated Compatibility wrapper for older callers/tests. */
export function getCarriedRecurringAmount(
  templateId: string, defaultAmount: number, scheduledDate: string, occurrences: RecurringOccurrence[],
): number {
  return getRecurringAmountSuggestion(templateId, defaultAmount, scheduledDate, occurrences).amount ?? 0;
}
