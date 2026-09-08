import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { mergeBankAccountRecords } from './accountMerge';

// A transactional in-memory adapter: writes become visible only on commit.
function database(seed: Record<string, Record<string, unknown>>) {
  let records = structuredClone(seed);
  let failCommit = false;
  const ref = (path: string): any => ({ path, collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`), where: (field: string, op: string, value: string) => ({ path, field, value }) });
  const snapshot = (reference: any) => ({ ref: reference, exists: Boolean(records[reference.path]), data: () => structuredClone(records[reference.path]) });
  const db = {
    collection: (name: string) => ref(name),
    runTransaction: async (callback: any) => {
      const writes: Array<() => void> = [];
      let startedWriting = false;
      const tx = {
        getAll: async (...references: any[]) => references.map(snapshot),
        get: async (query: any) => {
          if (startedWriting) throw Error('read after write');
          const docs = Object.entries(records).filter(([path, data]) => path.startsWith(query.path + '/') && data[query.field] === query.value).map(([path]) => snapshot(ref(path)));
          return { docs, size: docs.length };
        },
        update: (reference: any, patch: any) => { startedWriting = true; writes.push(() => { records[reference.path] = { ...records[reference.path], ...patch }; }); },
        delete: (reference: any) => { startedWriting = true; writes.push(() => { delete records[reference.path]; }); },
        set: (reference: any, data: any) => { startedWriting = true; writes.push(() => { records[reference.path] = data; }); },
      };
      const result = await callback(tx);
      if (failCommit) throw Error('commit failed');
      writes.forEach(write => write());
      return result;
    },
  };
  return { db: db as unknown as Firestore, records: () => records, failNextCommit: () => { failCommit = true; } };
}
const base = 'users/alice/';
const seed = {
  [base + 'bankAccounts/source']: { balance: 300, accountName: '중복' },
  [base + 'bankAccounts/target']: { balance: 900, balanceAsOf: '2026-09-01', accountName: '남김' },
  [base + 'transactions/old']: { accountId: 'source', amount: 123, localDate: '2020-01-01', categoryId: 'food', memo: '기존 메모', receipt: { id: 'r' }, role: 'normal' },
  [base + 'transactions/unrelated']: { accountId: 'elsewhere', amount: 555 },
  [base + 'paymentCards/card']: { linkedAccountId: 'source', monthlyPaymentAmounts: { '2026-09': 100 } },
  [base + 'recurringTemplates/retired']: { accountId: 'source', archivedAt: '2025-01-01', active: false },
  [base + 'recurringOccurrences/done']: { accountId: 'source', status: 'posted', actualAmount: 0 },
  [base + 'quickEntries/quick']: { accountId: 'source', amount: null },
  ['users/bob/transactions/other-user']: { accountId: 'source', amount: 777 },
};

describe('atomic account merge', () => {
  it('moves all five reference types across the complete history and deletes only the source account', async () => {
    const store = database(seed);
    const result = await mergeBankAccountRecords(store.db, 'alice', 'source', 'target');
    expect(result.total).toBe(5);
    expect(store.records()[base + 'bankAccounts/source']).toBeUndefined();
    expect(store.records()[base + 'bankAccounts/target']).toEqual(seed[base + 'bankAccounts/target']);
    for (const [collection, id, field] of [['transactions','old','accountId'], ['paymentCards','card','linkedAccountId'], ['recurringTemplates','retired','accountId'], ['recurringOccurrences','done','accountId'], ['quickEntries','quick','accountId']]) {
      const path = base + collection + '/' + id;
      expect(store.records()[path]).toEqual({ ...seed[path], [field]: 'target', updatedAt: result.updatedAt });
    }
    expect(store.records()['users/bob/transactions/other-user']).toEqual(seed['users/bob/transactions/other-user']);
    expect(store.records()[base + 'transactions/unrelated']).toEqual(seed[base + 'transactions/unrelated']);
  });
  it('keeps all original records when the transaction commit fails', async () => {
    const store = database(seed);
    store.failNextCommit();
    await expect(mergeBankAccountRecords(store.db, 'alice', 'source', 'target')).rejects.toThrow('commit failed');
    expect(store.records()).toEqual(seed);
  });
  it('returns the original result on retry without applying amounts or changes twice', async () => {
    const store = database(seed);
    const first = await mergeBankAccountRecords(store.db, 'alice', 'source', 'target');
    const after = structuredClone(store.records());
    expect(await mergeBankAccountRecords(store.db, 'alice', 'source', 'target')).toEqual(first);
    expect(store.records()).toEqual(after);
    await expect(mergeBankAccountRecords(store.db, 'alice', 'source', 'different')).rejects.toThrow('이미 다른 계좌');
  });
  it.each([['source', 'source'], ['source', 'missing'], ['missing', 'target'], ['../bob', 'target'], ['', 'target']])('rejects invalid or missing account selection %s → %s', async (source, target) => {
    const store = database(seed);
    await expect(mergeBankAccountRecords(store.db, 'alice', source, target)).rejects.toThrow();
    expect(store.records()).toEqual(seed);
  });
  it('refuses oversized histories without applying a partial merge', async () => {
    const extra = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [base + 'transactions/history-' + index, { accountId: 'source', amount: index + 1 }]));
    const store = database({ ...seed, ...extra });
    const before = structuredClone(store.records());
    await expect(mergeBankAccountRecords(store.db, 'alice', 'source', 'target')).rejects.toThrow('605건');
    expect(store.records()).toEqual(before);
  });
});
