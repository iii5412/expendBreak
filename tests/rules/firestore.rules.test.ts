import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createRulesEnvironment } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createRulesEnvironment();
});
afterAll(async () => {
  await env?.cleanup();
});

const owner = () => env.authenticatedContext('owner').firestore();
const wife = () => env.authenticatedContext('wife').firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

const transaction = (overrides: Record<string, unknown> = {}) => ({
  type: 'expense',
  amount: 12_000,
  source: 'manual',
  categoryId: 'food',
  localDate: '2026-09-20',
  ...overrides,
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/owner/categories/food'), { name: '식비', type: 'expense' });
    await setDoc(doc(db, 'users/owner/categories/salary'), { name: '급여', type: 'income' });
    await setDoc(doc(db, 'users/wife/transactions/w1'), transaction());
    await setDoc(doc(db, 'transactions/legacy1'), transaction());
  });
});

describe('account isolation', () => {
  it('lets an account read and write its own documents', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'users/owner/transactions/t1'), transaction()));
    await assertSucceeds(getDoc(doc(owner(), 'users/owner/transactions/t1')));
  });

  it("denies reading another account's data", async () => {
    await assertFails(getDoc(doc(owner(), 'users/wife/transactions/w1')));
    await assertFails(getDoc(doc(wife(), 'users/owner/categories/food')));
  });

  it("denies writing into another account's data", async () => {
    await assertFails(setDoc(doc(wife(), 'users/owner/transactions/t1'), transaction()));
  });

  it('denies signed-out access', async () => {
    await assertFails(getDoc(doc(anonymous(), 'users/owner/categories/food')));
  });

  it('denies the old root collections', async () => {
    await assertFails(getDoc(doc(owner(), 'transactions/legacy1')));
    await assertFails(setDoc(doc(owner(), 'transactions/new1'), transaction()));
  });

  it('denies server-only collections to every client', async () => {
    await assertFails(getDoc(doc(owner(), 'sessionEpochs/owner')));
    await assertFails(setDoc(doc(owner(), 'sessionEpochs/owner'), { epoch: 0 }));
    await assertFails(getDoc(doc(owner(), 'system/pinGuard')));
    await assertFails(setDoc(doc(owner(), 'system/pinGuard'), { ips: {} }));
  });
});

describe('transactions', () => {
  const create = (data: Record<string, unknown>) => setDoc(doc(owner(), 'users/owner/transactions/t1'), data);

  it('accepts a valid transaction', async () => {
    await assertSucceeds(create(transaction()));
  });

  it.each([
    ['zero', 0],
    ['negative', -500],
    ['a string', '12000'],
  ])('rejects an amount that is %s', async (_label, amount) => {
    await assertFails(create(transaction({ amount })));
  });

  it("rejects a category whose type differs from the transaction's", async () => {
    await assertFails(create(transaction({ type: 'income', categoryId: 'food' })));
    await assertFails(create(transaction({ type: 'expense', categoryId: 'salary' })));
  });

  it('rejects an unknown category and an unknown source', async () => {
    await assertFails(create(transaction({ categoryId: 'missing' })));
    await assertFails(create(transaction({ source: 'hacked' })));
  });
});

describe('revision protocol', () => {
  const transactionRef = () => doc(owner(), 'users/owner/transactions/posted1');
  const occurrenceRef = () => doc(owner(), 'users/owner/recurringOccurrences/occ1');

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/owner/transactions/posted1'), transaction({
        revision: 1,
        lastOperationId: 'op0',
        recurringOccurrenceKey: 'rent:2026-09',
      }));
      await setDoc(doc(db, 'users/owner/recurringOccurrences/occ1'), {
        revision: 3,
        status: 'planned',
        plannedAmount: 500_000,
        amountStatus: 'confirmed',
      });
      await setDoc(doc(db, 'users/owner/recurringOccurrences/occPosted'), {
        revision: 3,
        status: 'posted',
        plannedAmount: 500_000,
        transactionId: 'posted1',
      });
    });
  });

  it('rejects a stale amount change that does not advance the revision', async () => {
    await assertFails(updateDoc(transactionRef(), { amount: 99_000 }));
    await assertFails(updateDoc(transactionRef(), { amount: 99_000, revision: 1 }));
  });

  it('accepts an amount change that advances the revision by one and names its operation', async () => {
    await assertSucceeds(updateDoc(transactionRef(), { amount: 99_000, revision: 2, lastOperationId: 'op1' }));
  });

  it('rejects skipping a revision or omitting the operation id', async () => {
    await assertFails(updateDoc(transactionRef(), { amount: 99_000, revision: 3, lastOperationId: 'op1' }));
    await assertFails(updateDoc(transactionRef(), { amount: 99_000, revision: 2, lastOperationId: null }));
  });

  it('accepts a metadata-only write that keeps the revision', async () => {
    await assertSucceeds(updateDoc(transactionRef(), { memo: '메모', revision: 1 }));
  });

  it('rejects an occurrence update that moves the revision backwards', async () => {
    await assertFails(updateDoc(occurrenceRef(), { revision: 2, lastOperationId: 'op1' }));
    await assertFails(updateDoc(occurrenceRef(), { revision: 1 }));
  });

  it('rejects changing an occurrence amount while keeping the revision', async () => {
    await assertFails(updateDoc(occurrenceRef(), { plannedAmount: 1, revision: 3 }));
    await assertSucceeds(updateDoc(occurrenceRef(), { note: 'ok', revision: 3 }));
  });

  it('accepts a revision-advancing amount change', async () => {
    await assertSucceeds(updateDoc(occurrenceRef(), { plannedAmount: 550_000, revision: 4, lastOperationId: 'op2' }));
  });

  it('lets an unposted row be regenerated without a revision, but never a posted one', async () => {
    await assertSucceeds(setDoc(occurrenceRef(), { status: 'planned', plannedAmount: 510_000 }));
    await assertFails(setDoc(doc(owner(), 'users/owner/recurringOccurrences/occPosted'), { status: 'planned', plannedAmount: 1 }));
  });
});

describe('amountChanges audit trail', () => {
  const change = (overrides: Record<string, unknown> = {}) => ({
    id: 'op1',
    kind: 'plan_amount',
    occurrenceId: 'occ1',
    expectedOccurrenceRevision: 3,
    ...overrides,
  });
  const ref = (id = 'op1') => doc(owner(), `users/owner/amountChanges/${id}`);

  it('allows creating a record whose id matches its document id', async () => {
    await assertSucceeds(setDoc(ref(), change()));
  });

  it('rejects an id that differs from the document id, or an unknown kind', async () => {
    await assertFails(setDoc(ref('op1'), change({ id: 'other' })));
    await assertFails(setDoc(ref('op1'), change({ kind: 'edit_history' })));
  });

  it('is append-only: no edits and no deletes', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/owner/amountChanges/op1'), change());
    });
    await assertFails(updateDoc(ref(), { expectedOccurrenceRevision: 9 }));
    await assertFails(deleteDoc(ref()));
    await assertSucceeds(getDoc(ref()));
  });
});

describe('settings and migrations', () => {
  it('rejects an accessPin field in appSettings', async () => {
    const ref = doc(owner(), 'users/owner/appSettings/global');
    await assertFails(setDoc(ref, { accessPin: '1234' }));
    await assertSucceeds(setDoc(ref, { monthStartDay: 25 }));
  });

  it('lets clients read migration markers but never write them', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/owner/migrations/legacy-root-v1'), { ok: true });
    });
    await assertSucceeds(getDoc(doc(owner(), 'users/owner/migrations/legacy-root-v1')));
    await assertFails(setDoc(doc(owner(), 'users/owner/migrations/legacy-root-v1'), { ok: false }));
    await assertFails(setDoc(doc(owner(), 'users/owner/migrations/new'), { ok: true }));
    await assertFails(deleteDoc(doc(owner(), 'users/owner/migrations/legacy-root-v1')));
  });
});
