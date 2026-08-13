import { RecurringOccurrence, RecurringTemplate, Transaction } from '../types';

/**
 * Links a hand-entered transaction to the recurring item it settles.
 *
 * Transferring the rent and then typing it in leaves the money counted twice:
 * once as living-expense spending (the transaction has no template) and once as
 * a still-pending fixed transfer. Neither number is right afterwards, so the
 * overlap is caught at entry rather than left for the user to notice.
 */

const AMOUNT_TOLERANCE = 0.1;
const DATE_TOLERANCE_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RecurringMatchCandidate {
  occurrence: RecurringOccurrence;
  template: RecurringTemplate;
  expectedAmount: number;
  /** Higher is a closer match; the caller shows the best one first. */
  score: number;
}

export interface RecurringMatchInput {
  type: Transaction['type'];
  amount: number;
  localDate: string;
  merchant?: string;
  categoryId?: string;
}

const daysBetween = (left: string, right: string) => {
  const [ly, lm, ld] = left.split('-').map(Number);
  const [ry, rm, rd] = right.split('-').map(Number);
  return Math.abs(
    (new Date(ly, lm - 1, ld).getTime() - new Date(ry, rm - 1, rd).getTime()) / MS_PER_DAY,
  );
};

const normalize = (value: string) => value.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

function textOverlaps(left: string, right: string): boolean {
  const a = normalize(left);
  const b = normalize(right);
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Pending recurring items this transaction could be settling, best first.
 * Returns nothing unless the amount is close, which keeps the prompt rare enough
 * to stay meaningful.
 */
export function findRecurringMatches(
  input: RecurringMatchInput,
  occurrences: RecurringOccurrence[],
  templates: RecurringTemplate[],
): RecurringMatchCandidate[] {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const templateMap = new Map(templates.map(template => [template.id, template]));

  const candidates: RecurringMatchCandidate[] = [];

  for (const occurrence of occurrences) {
    if (occurrence.status === 'posted' || occurrence.status === 'skipped') continue;
    const template = templateMap.get(occurrence.templateId);
    if (!template) continue;
    if ((occurrence.typeSnapshot ?? template.type) !== input.type) continue;

    const expectedAmount = Math.round(occurrence.actualAmount ?? occurrence.expectedAmount);
    if (expectedAmount <= 0) continue;

    const amountDrift = Math.abs(amount - expectedAmount) / expectedAmount;
    if (amountDrift > AMOUNT_TOLERANCE) continue;

    const dayGap = daysBetween(input.localDate, occurrence.scheduledDate);
    if (dayGap > DATE_TOLERANCE_DAYS) continue;

    // Exact amounts and same-day entries are the strongest signals; a matching
    // merchant or category only breaks ties between similar recurring items.
    let score = 0;
    score += amountDrift === 0 ? 60 : Math.round((1 - amountDrift / AMOUNT_TOLERANCE) * 40);
    score += Math.round((1 - dayGap / DATE_TOLERANCE_DAYS) * 25);
    if (input.merchant && (textOverlaps(input.merchant, template.counterparty) || textOverlaps(input.merchant, template.name))) {
      score += 10;
    }
    if (input.categoryId && input.categoryId === (occurrence.categoryIdSnapshot ?? template.categoryId)) {
      score += 5;
    }

    candidates.push({ occurrence, template, expectedAmount, score });
  }

  return candidates.sort((left, right) => right.score - left.score);
}
