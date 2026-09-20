import { describe, expect, it } from 'vitest';
import { RecurringOccurrence, Transaction } from '../types';
import {
  buildPlanAmountOperation,
  buildPostOperation,
  buildReverseOperation,
  buildUndoPostOperation,
  revisionOf,
} from './amountOperations';

const NOW = '2026-09-21T09:00:00.000Z';

const occurrence = (overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence => ({
  id: 'occ_maintenance_2026-09-25',
  templateId: 'maintenance',
  occurrenceKey: 'maintenance_2026-09-25',
  scheduledDate: '2026-09-25',
  expectedAmount: 250_000,
  actualAmount: null,
  plannedAmount: 250_000,
  amountStatus: 'suggested',
  amountSource: 'previous_cycle',
  sourceCycle: '2026-08',
  status: 'needs_confirmation',
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx_recurring_maintenance_2026-09-25',
  type: 'expense',
  amount: 250_000,
  localDate: '2026-09-25',
  categoryId: 'housing',
  merchant: '관리비',
  recurringOccurrenceKey: 'maintenance_2026-09-25',
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
} as Transaction);

describe('plan amount operation', () => {
  it('confirms the cycle amount, bumps the revision and records before/after', () => {
    const op = buildPlanAmountOperation(occurrence(), null, { amount: 325_280 }, NOW);

    expect(op.occurrence).toMatchObject({
      plannedAmount: 325_280, amountStatus: 'confirmed', amountSource: 'manual', revision: 1, lastOperationId: op.operationId,
    });
    expect(op.transaction).toBeUndefined();
    expect(op.record).toMatchObject({
      id: op.operationId, kind: 'plan_amount', expectedOccurrenceRevision: 0, expectedTransactionRevision: null,
      before: { amount: 250_000, amountStatus: 'suggested' }, after: { amount: 325_280, amountStatus: 'confirmed' },
    });
  });

  it('is based on the revision it read, so a moved row is detectable', () => {
    const op = buildPlanAmountOperation(occurrence({ revision: 4 }), null, { amount: 1 }, NOW);
    expect(op.record.expectedOccurrenceRevision).toBe(4);
    expect(op.occurrence.revision).toBe(5);
  });

  it('corrects a posted amount together with its transaction under one operation id', () => {
    const posted = occurrence({ status: 'posted', actualAmount: 250_000, transactionId: 'tx_recurring_maintenance_2026-09-25', revision: 2 });
    const linked = transaction({ revision: 1 });
    const op = buildPlanAmountOperation(posted, linked, { amount: 325_280 }, NOW);

    expect(op.record.kind).toBe('posted_correction');
    expect(op.transaction).toMatchObject({ id: linked.id, amount: 325_280, revision: 2, lastOperationId: op.operationId });
    expect(op.occurrence).toMatchObject({ status: 'posted', amountSource: 'transaction', amountIntegrityIssue: false, revision: 3 });
    expect(op.record.expectedTransactionRevision).toBe(1);
    // The transaction keeps its actual payment date (PRD §6 완료 기록 수정).
    expect(op.transaction?.localDate).toBe('2026-09-25');
  });

  it('gives every operation a distinct id', () => {
    const first = buildPlanAmountOperation(occurrence(), null, { amount: 1 }, NOW);
    const second = buildPlanAmountOperation(occurrence(), null, { amount: 1 }, NOW);
    expect(first.operationId).not.toBe(second.operationId);
  });
});

describe('post and undo operations', () => {
  it('posting requires the transaction not to exist yet', () => {
    const op = buildPostOperation(occurrence(), transaction(), NOW);
    expect(op.record.expectedTransactionRevision).toBe(0);
    expect(op.transaction).toMatchObject({ revision: 1, lastOperationId: op.operationId });
    expect(op.occurrence).toMatchObject({ status: 'posted', amountStatus: 'confirmed', transactionId: 'tx_recurring_maintenance_2026-09-25' });
  });

  it('undoing a posting removes the transaction but keeps the confirmed amount', () => {
    const posted = occurrence({ status: 'posted', transactionId: 'tx_recurring_maintenance_2026-09-25', revision: 1 });
    const op = buildUndoPostOperation(posted, transaction({ amount: 325_280, revision: 1 }), 'tx_recurring_maintenance_2026-09-25', NOW);
    expect(op.removeTransactionId).toBe('tx_recurring_maintenance_2026-09-25');
    expect(op.occurrence).toMatchObject({ status: 'needs_confirmation', transactionId: null, plannedAmount: 325_280, amountStatus: 'confirmed', revision: 2 });
    expect(op.record.expectedTransactionRevision).toBe(1);
  });
});

describe('reverse (undo) of an amount change', () => {
  it('restores the previous amount and status when nothing moved since', () => {
    const edit = buildPlanAmountOperation(occurrence(), null, { amount: 325_280 }, NOW);
    const reverse = buildReverseOperation(edit.record, edit.occurrence, null, NOW);

    expect(reverse).not.toBeNull();
    expect(reverse!.occurrence).toMatchObject({ plannedAmount: 250_000, amountStatus: 'suggested', revision: 2 });
    expect(reverse!.record).toMatchObject({ undoOf: edit.operationId, expectedOccurrenceRevision: 1 });
  });

  it('refuses when the row changed after the operation being undone', () => {
    const edit = buildPlanAmountOperation(occurrence(), null, { amount: 325_280 }, NOW);
    const later = buildPlanAmountOperation(edit.occurrence, null, { amount: 300_000 }, NOW);
    expect(buildReverseOperation(edit.record, later.occurrence, null, NOW)).toBeNull();
  });

  it('refuses to reverse a posted correction whose transaction is gone', () => {
    const posted = occurrence({ status: 'posted', transactionId: 'tx_recurring_maintenance_2026-09-25' });
    const edit = buildPlanAmountOperation(posted, transaction(), { amount: 325_280 }, NOW);
    expect(buildReverseOperation(edit.record, edit.occurrence, null, NOW)).toBeNull();
  });

  it('never reverses a posting through the amount undo path', () => {
    const post = buildPostOperation(occurrence(), transaction(), NOW);
    expect(buildReverseOperation(post.record, post.occurrence, post.transaction!, NOW)).toBeNull();
  });
});

describe('revisionOf', () => {
  it('treats legacy rows without a revision as revision 0', () => {
    expect(revisionOf(undefined)).toBe(0);
    expect(revisionOf({})).toBe(0);
    expect(revisionOf({ revision: 3 })).toBe(3);
  });
});
