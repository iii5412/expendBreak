import { RecurringOccurrence, RecurringTemplate } from '../types';
import {
  AccountingPeriod,
  getAccountingPeriod,
  getScheduledDatesInPeriod,
  shiftYearMonth,
} from './calculations';

/**
 * Why a registered item is absent from the period list.
 *
 * `other_cycle` is the one that surprises people: with payday on the 25th the
 * cycle runs 8/25~9/24, so an item due on the 20th belongs to the neighbouring
 * cycle and is not missing at all.
 */
export type HiddenRecurringReason =
  | 'card_settlement_replaced'
  | 'inactive'
  | 'ended'
  | 'not_started'
  | 'other_cycle'
  | 'not_generated';

export interface HiddenRecurringItem {
  templateId: string;
  name: string;
  dayOfMonth: number;
  amount: number;
  reason: HiddenRecurringReason;
  startDate: string;
  /** Nearest due date in the neighbouring cycles, so "언제 나오는지" is answerable. */
  otherCycleDate: string | null;
}

/**
 * Registered recurring items of one type that produce no row in this period.
 *
 * The counts on the recurring screen come from occurrences, while the settings
 * screen counts templates, so the two legitimately disagree. This explains the
 * gap item by item instead of leaving the user to subtract.
 */
export function findHiddenRecurringItems(
  templates: RecurringTemplate[],
  periodOccurrences: RecurringOccurrence[],
  period: AccountingPeriod,
  options: {
    type?: RecurringTemplate['type'];
    replacedTemplateIds?: Iterable<string>;
  } = {},
): HiddenRecurringItem[] {
  const type = options.type ?? 'expense';
  const replaced = new Set(options.replacedTemplateIds ?? []);
  const visibleTemplateIds = new Set(periodOccurrences.map(occurrence => occurrence.templateId));

  const neighbourPeriods = [-1, 1].map(offset =>
    getAccountingPeriod(shiftYearMonth(period.yearMonth, offset), period.monthStartDay));

  return templates
    .filter(template => template.type === type && !visibleTemplateIds.has(template.id))
    .map(template => {
      const neighbourDate = neighbourPeriods
        .flatMap(neighbour => getScheduledDatesInPeriod(template, neighbour))
        .sort()[0] ?? null;

      return {
        templateId: template.id,
        name: template.name,
        dayOfMonth: template.dayOfMonth,
        amount: template.defaultAmount,
        reason: resolveReason(template, period, replaced),
        startDate: template.startDate,
        otherCycleDate: neighbourDate,
      };
    });
}

function resolveReason(
  template: RecurringTemplate,
  period: AccountingPeriod,
  replaced: Set<string>,
): HiddenRecurringReason {
  // Checked before `active`: a replaced card bill is deliberately stood down,
  // and naming the card bill is the answer the user is looking for.
  if (replaced.has(template.id) || template.cardSettlementCardId) return 'card_settlement_replaced';
  if (!template.active) return 'inactive';
  if (template.endDate && template.endDate < period.startDate) return 'ended';
  if (getScheduledDatesInPeriod(template, period).length === 0) {
    // An item registered after its own due day has already passed starts
    // counting from the next cycle, which reads as "missing" this one.
    return template.startDate > period.startDate ? 'not_started' : 'other_cycle';
  }
  // Due in this period, yet no occurrence exists: generation has not caught up.
  return 'not_generated';
}
