import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecurringOccurrence, Transaction } from '../types';

const cloud = vi.hoisted(() => ({
  sync: vi.fn(async (_transaction: unknown) => true),
  conditional: vi.fn(async (_operation: unknown) => true),
}));
vi.mock('./auth', () => ({
  getAccountStorageKey: (key: string) => key,
  getSignedInAccount: () => ({ uid: 'owner' }),
  // Keep background reconciliation pending; this test only exercises local edit dispatch.
  authenticatedFetch: () => new Promise(() => undefined),
}));
vi.mock('../lib/firebase', () => ({ firebaseApp: {}, auth: {} }));
vi.mock('./cloudSync', () => ({
  syncTransactionToFirestore: cloud.sync,
  commitConditionalOperation: cloud.conditional,
  TRANSACTIONS_COLLECTION: 'transactions',
  RECURRING_OCCURRENCES_COLLECTION: 'recurringOccurrences',
  syncPendingCountFromStorage: () => undefined,
}));

const income = (patch: Partial<Transaction> = {}): Transaction => ({
  id: 'salary',
  type: 'income',
  amount: 3000000,
  source: 'manual',
  categoryId: 'salary',
  localDate: '2026-10-10',
  occurredAt: '2026-10-10T10:00:00Z',
  merchant: '급여',
  memo: '',
  revision: 1,
  lastOperationId: 'posted',
  recurringOccurrenceKey: 'salary_2026-10-10',
  createdAt: '2026-10-10T10:00:00Z',
  updatedAt: '2026-10-10T10:00:00Z',
  ...patch,
});
const posted = {
  id: 'occ',
  templateId: 'salary',
  occurrenceKey: 'salary_2026-10-10',
  scheduledDate: '2026-10-10',
  status: 'posted',
  plannedAmount: 3000000,
  actualAmount: 3000000,
  expectedAmount: 3000000,
  transactionId: 'salary',
  revision: 2,
  amountStatus: 'confirmed',
} as RecurringOccurrence;

async function boot(transaction = income(), occurrence: RecurringOccurrence | null = posted) {
  const values = new Map<string, string>([
    ['brake_transactions', JSON.stringify([transaction])],
    ['brake_recurring_occurrences', JSON.stringify(occurrence ? [occurrence] : [])],
    ['brake_categories', JSON.stringify([{ id: 'salary', name: '급여', type: 'income', active: true }])],
    ['brake_user_profile', JSON.stringify({ monthStartDay: 10, createdAt: '2026-01-01' })],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  const storage = await import('./storage');
  await storage.initializeStorageAfterLogin();
  return storage;
}
beforeEach(() => {
  vi.resetModules();
  cloud.sync.mockClear();
  cloud.conditional.mockClear();
});

describe('history edits of posted income', () => {
  it('advances the revision for a date-only edit, keeping the linked cycle and amount', async () => {
    const storage = await boot();
    storage.updateTransaction('salary', { localDate: '2026-10-11', memo: '수정' });
    expect(cloud.sync).not.toHaveBeenCalled();
    expect(cloud.conditional).toHaveBeenCalledTimes(1);
    expect(cloud.conditional.mock.calls[0][0]).toMatchObject({
      documents: [
        { documentId: 'occ', expectedRevision: 2, data: { revision: 3, scheduledDate: '2026-10-10' } },
        {
          documentId: 'salary',
          expectedRevision: 1,
          data: { revision: 2, localDate: '2026-10-11', amount: 3000000, memo: '수정' },
        },
      ],
    });
  });
  it('sends amount, date and metadata together in a single revision operation', async () => {
    const storage = await boot();
    const saved = storage.updateTransaction('salary', { amount: 3200000, localDate: '2026-10-11', memo: '확정' });
    expect(saved).toMatchObject({ amount: 3200000, revision: 2, localDate: '2026-10-11' });
    expect(cloud.sync).not.toHaveBeenCalled();
    expect(cloud.conditional).toHaveBeenCalledTimes(1);
    expect(cloud.conditional.mock.calls[0][0]).toMatchObject({
      documents: [
        { data: { actualAmount: 3200000, revision: 3 } },
        { data: { amount: 3200000, localDate: '2026-10-11', memo: '확정', revision: 2 } },
      ],
    });
  });
  it('uses a revision-checked write for a stamped transaction without a loaded occurrence', async () => {
    const storage = await boot(income(), null);
    storage.updateTransaction('salary', { localDate: '2026-10-11' });
    expect(cloud.sync).not.toHaveBeenCalled();
    expect(cloud.conditional).toHaveBeenCalledTimes(1);
    expect(cloud.conditional.mock.calls[0][0]).toMatchObject({
      documents: [{ documentId: 'salary', expectedRevision: 1, data: { revision: 2 } }],
    });
  });
  it('keeps memo-only edits on the existing metadata path', async () => {
    const storage = await boot();
    storage.updateTransaction('salary', { memo: '메모만' });
    expect(cloud.conditional).not.toHaveBeenCalled();
    expect(cloud.sync).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, memo: '메모만' }));
  });

  it('does not detach a recurring amount correction when its occurrence is missing', async () => {
    const storage = await boot(income(), null);
    expect(() => storage.updateTransaction('salary', { amount: 3200000 })).toThrow('연결된 정기 항목');
    expect(storage.getTransactions()[0].amount).toBe(3000000);
    expect(cloud.sync).not.toHaveBeenCalled();
    expect(cloud.conditional).not.toHaveBeenCalled();
  });
});
