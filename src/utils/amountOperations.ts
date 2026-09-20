import type {
  AmountChangeRecord,
  AmountChangeSnapshot,
  PaymentMethodType,
  RecurringOccurrence,
  Transaction,
} from '../types';
import { resolveRecurringAmount } from './recurringAmounts';

/**
 * Domain operations on a cycle amount (PRD-ui-renewal §8 "구현 설계").
 *
 * Every amount change — plan-only edit, correction of a posted payment,
 * posting, undo — is one operation with an id, the revision it was based on,
 * and a before/after record. The pure builders here produce the documents and
 * the change record; `storage.ts` applies them locally and hands them to the
 * conditional sync path, which refuses to apply an operation on a document
 * whose revision moved since the operation was built.
 */

export class AmountConflictError extends Error {
  readonly conflict = true;
  constructor(message = '다른 기기에서 먼저 수정한 항목입니다.') {
    super(message);
    this.name = 'AmountConflictError';
  }
}

export function isAmountConflict(error: unknown): error is AmountConflictError {
  return Boolean(error && typeof error === 'object' && (error as { conflict?: boolean }).conflict === true);
}

export const revisionOf = (document: { revision?: number } | null | undefined) => document?.revision ?? 0;

export function newOperationId(prefix = 'op'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export function snapshotOf(
  occurrence: RecurringOccurrence,
  transaction?: Transaction | null,
): AmountChangeSnapshot {
  const resolved = resolveRecurringAmount(occurrence, transaction ? [transaction] : []);
  return {
    amount: resolved.amount,
    amountStatus: resolved.status,
    status: occurrence.status,
    transactionAmount: transaction ? Math.round(transaction.amount) : null,
    paymentMethodType: occurrence.paymentMethodType ?? null,
    accountId: occurrence.accountId ?? null,
    cardId: occurrence.cardId ?? null,
  };
}

export interface AmountOperation {
  operationId: string;
  occurrence: RecurringOccurrence;
  /** Present when the linked transaction changes with the occurrence. */
  transaction?: Transaction;
  /** Present when the operation removes the linked transaction (undo of a posting). */
  removeTransactionId?: string;
  record: AmountChangeRecord;
}

interface PlanAmountInput {
  amount: number;
  paymentMethodType?: PaymentMethodType;
  accountId?: string | null;
  cardId?: string | null;
}

/**
 * Plan-only edit, or a correction of a posted payment when `linked` is given.
 * The correction keeps the transaction id and its actual payment date; only
 * the amount moves, together with the occurrence, under one operation id.
 */
export function buildPlanAmountOperation(
  target: RecurringOccurrence,
  linked: Transaction | null,
  input: PlanAmountInput,
  now: string,
  undoOf: string | null = null,
): AmountOperation {
  const amount = Math.round(Number(input.amount));
  const operationId = newOperationId();
  const before = snapshotOf(target, linked);

  const occurrence: RecurringOccurrence = {
    ...target,
    plannedAmount: amount,
    amountStatus: 'confirmed',
    amountSource: linked ? 'transaction' : 'manual',
    amountConfirmedAt: now,
    actualAmount: amount,
    expectedAmount: amount,
    amountIntegrityIssue: false,
    updatedAt: now,
    revision: revisionOf(target) + 1,
    lastOperationId: operationId,
  };
  if (input.paymentMethodType) {
    occurrence.paymentMethodType = input.paymentMethodType;
    occurrence.accountId = input.paymentMethodType === 'account' ? input.accountId ?? null : null;
    occurrence.cardId = input.paymentMethodType === 'card' ? input.cardId ?? null : null;
  }

  let transaction: Transaction | undefined;
  if (linked) {
    transaction = {
      ...linked,
      amount,
      updatedAt: now,
      revision: revisionOf(linked) + 1,
      lastOperationId: operationId,
    };
    occurrence.transactionId = linked.id;
  }

  return {
    operationId,
    occurrence,
    transaction,
    record: {
      id: operationId,
      kind: linked ? 'posted_correction' : 'plan_amount',
      occurrenceId: target.id,
      templateId: target.templateId,
      scheduledDate: target.scheduledDate,
      transactionId: linked?.id ?? null,
      before,
      after: snapshotOf(occurrence, transaction ?? null),
      expectedOccurrenceRevision: revisionOf(target),
      expectedTransactionRevision: linked ? revisionOf(linked) : null,
      undoOf,
      createdAt: now,
    },
  };
}

/** Posting: creates the transaction and marks the occurrence paid. */
export function buildPostOperation(
  target: RecurringOccurrence,
  transaction: Omit<Transaction, 'revision' | 'lastOperationId'>,
  now: string,
): AmountOperation {
  const operationId = newOperationId();
  const before = snapshotOf(target, null);
  const posted: Transaction = { ...transaction, revision: 1, lastOperationId: operationId };
  const occurrence: RecurringOccurrence = {
    ...target,
    status: 'posted',
    actualAmount: Math.round(transaction.amount),
    plannedAmount: Math.round(transaction.amount),
    amountStatus: 'confirmed',
    amountSource: 'transaction',
    amountConfirmedAt: now,
    amountIntegrityIssue: false,
    paymentMethodType: transaction.paymentMethodType,
    accountId: transaction.accountId,
    cardId: transaction.cardId,
    transactionId: posted.id,
    updatedAt: now,
    revision: revisionOf(target) + 1,
    lastOperationId: operationId,
  };
  return {
    operationId,
    occurrence,
    transaction: posted,
    record: {
      id: operationId,
      kind: 'post',
      occurrenceId: target.id,
      templateId: target.templateId,
      scheduledDate: target.scheduledDate,
      transactionId: posted.id,
      before,
      after: snapshotOf(occurrence, posted),
      expectedOccurrenceRevision: revisionOf(target),
      // The transaction must not exist yet; an existing one means another
      // device posted first.
      expectedTransactionRevision: 0,
      undoOf: null,
      createdAt: now,
    },
  };
}

/** Undo of a posting: removes the transaction, reopens the occurrence, keeps the confirmed amount. */
export function buildUndoPostOperation(
  target: RecurringOccurrence,
  linked: Transaction | null,
  transactionId: string,
  now: string,
): AmountOperation {
  const operationId = newOperationId();
  const before = snapshotOf(target, linked);
  const occurrence: RecurringOccurrence = {
    ...target,
    status: 'needs_confirmation',
    transactionId: null,
    // The last confirmed amount survives the undo (PRD §6 "완료 취소 시 ...
    // 최종 확정 금액은 유지").
    plannedAmount: linked ? Math.round(linked.amount) : target.plannedAmount ?? target.actualAmount ?? null,
    amountStatus: 'confirmed',
    amountSource: 'manual',
    updatedAt: now,
    revision: revisionOf(target) + 1,
    lastOperationId: operationId,
  };
  return {
    operationId,
    occurrence,
    removeTransactionId: transactionId,
    record: {
      id: operationId,
      kind: 'undo_post',
      occurrenceId: target.id,
      templateId: target.templateId,
      scheduledDate: target.scheduledDate,
      transactionId,
      before,
      after: snapshotOf(occurrence, null),
      expectedOccurrenceRevision: revisionOf(target),
      expectedTransactionRevision: linked ? revisionOf(linked) : null,
      undoOf: null,
      createdAt: now,
    },
  };
}

/**
 * Reverse of a plan/correction record, built only when the current state still
 * matches what that record produced. Returns null when something else moved
 * the amount since, so an undo never silently overwrites a newer change.
 */
export function buildReverseOperation(
  record: AmountChangeRecord,
  current: RecurringOccurrence,
  linked: Transaction | null,
  now: string,
): AmountOperation | null {
  if (record.kind !== 'plan_amount' && record.kind !== 'posted_correction') return null;
  if (record.before.amount == null) return null;
  const state = snapshotOf(current, linked);
  if (state.amount !== record.after.amount || state.status !== record.after.status) return null;
  if (record.kind === 'posted_correction' && (!linked || linked.id !== record.transactionId)) return null;
  const reversed = buildPlanAmountOperation(current, linked, { amount: record.before.amount }, now, record.id);
  // A reversed plan edit goes back to the amount the user had before; the
  // status returns to what it was too, so a suggestion undone stays a suggestion.
  if (record.before.amountStatus !== 'confirmed') {
    reversed.occurrence.amountStatus = record.before.amountStatus;
    reversed.occurrence.amountSource = current.amountSource === 'manual' ? 'previous_cycle' : current.amountSource;
    reversed.occurrence.amountConfirmedAt = null;
    reversed.record.after = snapshotOf(reversed.occurrence, reversed.transaction ?? null);
  }
  return reversed;
}
