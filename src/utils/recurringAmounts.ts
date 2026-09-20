import { RecurringAmountSource, RecurringAmountStatus, RecurringOccurrence, Transaction } from '../types';

export interface ResolvedRecurringAmount {
  amount: number | null;
  status: RecurringAmountStatus;
  source: RecurringAmountSource | null;
  /** Cycle (YYYY-MM) the suggested amount was copied from, when known. */
  sourceCycle: string | null;
  integrityIssue: boolean;
}

/** Resolve one authoritative cycle amount while remaining compatible with old exports. */
export function resolveRecurringAmount(
  occurrence: RecurringOccurrence,
  transactions: Transaction[] = [],
): ResolvedRecurringAmount {
  const linked = occurrence.transactionId
    ? transactions.find(transaction => transaction.id === occurrence.transactionId)
    : transactions.find(transaction => transaction.recurringOccurrenceKey === occurrence.occurrenceKey);
  if (occurrence.status === 'posted' && linked) {
    const legacy = occurrence.actualAmount ?? occurrence.plannedAmount ?? occurrence.expectedAmount;
    return {
      amount: Math.round(linked.amount), status: 'confirmed', source: 'transaction', sourceCycle: null,
      integrityIssue: Number.isFinite(legacy) && Math.round(legacy) !== Math.round(linked.amount),
    };
  }
  if (occurrence.amountStatus) {
    return {
      amount: occurrence.plannedAmount == null ? null : Math.round(occurrence.plannedAmount),
      status: occurrence.amountStatus,
      source: occurrence.amountSource ?? null,
      sourceCycle: occurrence.sourceCycle ?? null,
      integrityIssue: Boolean(occurrence.amountIntegrityIssue),
    };
  }
  if (occurrence.status === 'posted' || occurrence.actualAmount != null) {
    return { amount: Math.round(occurrence.actualAmount ?? occurrence.expectedAmount), status: 'confirmed', source: 'legacy_occurrence', sourceCycle: null, integrityIssue: false };
  }
  if (Number.isFinite(occurrence.expectedAmount) && occurrence.expectedAmount > 0) {
    return { amount: Math.round(occurrence.expectedAmount), status: 'suggested', source: 'legacy_occurrence', sourceCycle: null, integrityIssue: false };
  }
  return { amount: null, status: 'missing', source: null, sourceCycle: null, integrityIssue: false };
}

export function amountOrZero(occurrence: RecurringOccurrence, transactions: Transaction[] = []): number {
  return resolveRecurringAmount(occurrence, transactions).amount ?? 0;
}
