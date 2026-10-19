import { describe, expect, it } from 'vitest';
import { isQueuedIncomeDateCandidate, queuedIncomeDateRetry } from './queuedIncomeDate';
import type { PendingFirestoreWrite } from './firestoreOutbox';

const current = {
  id: 'salary',
  type: 'income',
  amount: 3000000,
  source: 'manual',
  categoryId: 'salary',
  localDate: '2026-10-10',
  occurredAt: '2026-10-10T10:00:00.000Z',
  revision: 1,
  lastOperationId: 'posted',
  recurringOccurrenceKey: 'salary_2026-10-10',
  memo: '',
  createdAt: '2026-10-10T10:00:00Z',
};
const entry = (): PendingFirestoreWrite => ({
  id: 'date-edit',
  collectionName: 'transactions',
  documentId: 'salary',
  operation: 'set',
  queuedAt: '2026-10-19T00:00:00Z',
  data: {
    ...current,
    localDate: '2026-10-11',
    occurredAt: '2026-10-11T12:00:00.000Z',
    paymentMethodType: 'other',
    tags: [],
    accountId: null,
    installment: null,
  },
});

describe('retry of an old rejected income date write', () => {
  it('patches only the actual date and advances the unchanged server revision once', () => {
    const retry = queuedIncomeDateRetry(entry(), current);
    expect(retry.changed).toBe(true);
    expect(retry.data).toMatchObject({
      amount: 3000000,
      localDate: '2026-10-11',
      revision: 2,
      lastOperationId: 'date_retry_date-edit',
      recurringOccurrenceKey: 'salary_2026-10-10',
    });
    expect(current.revision).toBe(1);
  });
  it('recognizes a retry after a committed write with a lost response', () => {
    const first = queuedIncomeDateRetry(entry(), current);
    expect(queuedIncomeDateRetry(entry(), first.data)).toEqual({ data: first.data, changed: false });
  });
  it.each([
    { revision: 2 },
    { amount: 4000000 },
    { memo: '다른 기기의 메모' },
    { categoryId: 'other-income' },
    { recurringOccurrenceKey: 'another' },
  ])('refuses to rebase a changed server record: %j', (patch) => {
    expect(() => queuedIncomeDateRetry(entry(), { ...current, ...patch })).toThrow();
  });
  it('keeps an amount change or a missing record for manual review', () => {
    const queued = entry();
    queued.data!.amount = 4000000;
    expect(() => queuedIncomeDateRetry(queued, current)).toThrow();
    expect(() => queuedIncomeDateRetry(entry(), null)).toThrow();
  });
  it('refuses metadata changes instead of silently dropping them', () => {
    const queued = entry();
    queued.data!.memo = '같이 변경한 메모';
    expect(() => queuedIncomeDateRetry(queued, current)).toThrow();
  });
  it('does not claim to fix a rejection when the server date is already identical', () => {
    expect(() => queuedIncomeDateRetry(entry(), { ...current, localDate: '2026-10-11' })).toThrow();
  });
  it('excludes invalid dates, non-income writes and receipt/voice payloads', () => {
    for (const patch of [
      { localDate: '2026-02-30' },
      { type: 'expense' },
      { receipt: {} },
      { revision: 0 },
      { voiceRecord: {} },
    ]) {
      const queued = entry();
      queued.data = { ...queued.data, ...patch };
      expect(isQueuedIncomeDateCandidate(queued)).toBe(false);
    }
    const queued = entry();
    queued.data!.occurredAt = '2026-10-12T12:00:00Z';
    expect(() => queuedIncomeDateRetry(queued, current)).toThrow();
  });
});
