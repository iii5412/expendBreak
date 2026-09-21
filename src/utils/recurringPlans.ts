import { RecurringAmountSource, RecurringAmountStatus, RecurringOccurrence } from '../types';
import { getYearMonthForDate, shiftYearMonth } from './calculations';
import { resolveRecurringAmount } from './recurringAmounts';

export interface RecurringAmountSuggestion {
  amount: number | null;
  status: RecurringAmountStatus;
  source: RecurringAmountSource | null;
  sourceCycle: string | null;
}

export interface SuggestionOptions {
  frequency?: 'monthly' | 'weekly';
  monthStartDay?: number;
}

const isEvidence = (occurrence: RecurringOccurrence) =>
  occurrence.status !== 'skipped' && !occurrence.projected && resolveRecurringAmount(occurrence).status === 'confirmed';

const suggestFrom = (occurrence: RecurringOccurrence, cycle: string): RecurringAmountSuggestion => ({
  amount: resolveRecurringAmount(occurrence).amount,
  status: 'suggested',
  source: 'previous_cycle',
  sourceCycle: cycle,
});

/**
 * The amount proposed for a new cycle row (PRD-ui-renewal §6 "다음 주기의 제안값").
 *
 * The most recent confirmed amount for the item is proposed, never confirmed
 * automatically. A cycle that only holds a copied suggestion is not evidence,
 * so the search walks back to the last confirmed one and names that cycle.
 *
 * Weekly items match occurrence ordinals between cycles (2nd of this cycle ←
 * 2nd of the previous). When this cycle has more occurrences than the last,
 * the extra ones take the most recent single confirmed amount rather than a
 * copy of a total.
 */
export function getRecurringAmountSuggestion(
  templateId: string,
  legacyTemplateAmount: number | undefined,
  scheduledDate: string,
  occurrences: RecurringOccurrence[],
  options: SuggestionOptions = {},
): RecurringAmountSuggestion {
  if (options.frequency === 'weekly') {
    const monthStartDay = options.monthStartDay ?? 1;
    const cycle = getYearMonthForDate(scheduledDate, monthStartDay);
    const ordinal = occurrences.filter(occurrence => occurrence.templateId === templateId
      && occurrence.scheduledDate < scheduledDate
      && getYearMonthForDate(occurrence.scheduledDate, monthStartDay) === cycle).length;
    const previousCycle = shiftYearMonth(cycle, -1);
    const previousRows = occurrences
      .filter(occurrence => occurrence.templateId === templateId
        && getYearMonthForDate(occurrence.scheduledDate, monthStartDay) === previousCycle)
      .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate));
    const counterpart = previousRows[ordinal];
    if (counterpart && isEvidence(counterpart)) return suggestFrom(counterpart, previousCycle);
    const latestPrevious = [...previousRows].reverse().find(isEvidence);
    if (latestPrevious) return suggestFrom(latestPrevious, previousCycle);
  }

  const history = occurrences
    .filter(occurrence => occurrence.templateId === templateId
      && occurrence.scheduledDate < scheduledDate
      && isEvidence(occurrence))
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate));
  const previous = history[0];
  if (previous) return suggestFrom(previous, previous.scheduledDate.slice(0, 7));
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
