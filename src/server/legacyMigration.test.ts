import express from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMigrationHandler,
  ensureLegacyDataMigration,
  MigrationVerificationError,
} from './legacyMigration';
import { listen } from './testServer';

type Records = Record<string, Record<string, unknown>>;
type WriteHook = (path: string, data: Record<string, unknown>) => Record<string, unknown> | null;

// In-memory Admin Firestore double covering the calls the migration makes.
function database(seed: Records, hook: WriteHook = (_path, data) => data) {
  const records: Records = structuredClone(seed);
  const directChildren = (path: string) => Object.keys(records)
    .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
    .sort();
  const snapshotOf = (path: string) => ({
    id: path.split('/').pop()!,
    ref: docRef(path),
    exists: path in records,
    data: () => (path in records ? structuredClone(records[path]) : undefined),
  });
  const write = (path: string, data: Record<string, unknown>) => {
    const stored = hook(path, structuredClone(data));
    if (stored) records[path] = stored;
  };
  function docRef(path: string): any {
    return {
      path,
      id: path.split('/').pop(),
      collection: (name: string) => collectionRef(`${path}/${name}`),
      get: async () => snapshotOf(path),
      set: async (data: Record<string, unknown>) => { records[path] = structuredClone(data); },
    };
  }
  function collectionRef(path: string): any {
    return {
      path,
      doc: (id: string) => docRef(`${path}/${id}`),
      get: async () => {
        const docs = directChildren(path).map(snapshotOf);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  const db = {
    collection: (name: string) => collectionRef(name),
    doc: (path: string) => docRef(path),
    batch: () => {
      const operations: Array<{ kind: 'set' | 'create'; path: string; data: Record<string, unknown> }> = [];
      return {
        set: (reference: any, data: Record<string, unknown>) => { operations.push({ kind: 'set', path: reference.path, data }); },
        create: (reference: any, data: Record<string, unknown>) => { operations.push({ kind: 'create', path: reference.path, data }); },
        commit: async () => {
          const conflict = operations.find(operation => operation.kind === 'create' && operation.path in records);
          if (conflict) throw Object.assign(new Error(`ALREADY_EXISTS: ${conflict.path}`), { code: 6 });
          operations.forEach(operation => write(operation.path, operation.data));
        },
      };
    },
  };
  return { db: db as unknown as Firestore, records };
}

const legacySeed: Records = {
  'appSettings/main': { accessPin: '1234', aiClassificationEnabled: true, theme: 'dark' },
  'categories/food': { name: '식비', type: 'expense' },
  'categories/salary': { name: '급여', type: 'income' },
  'transactions/t1': { amount: 12_000, categoryId: 'food', type: 'expense' },
  'transactions/t2': { amount: 3_000_000, categoryId: 'salary', type: 'income' },
  'transactions/t3': { amount: 8_000, categoryId: 'food', type: 'expense' },
};
const owner = 'users/owner';
const markerPath = `${owner}/migrations/legacy-root-v1`;
const failurePath = `${owner}/migrations/legacy-root-v1-failed`;
const NOW = new Date('2026-09-23T00:00:00.000Z');

describe('ensureLegacyDataMigration', () => {
  it('returns the existing marker without touching any data', async () => {
    const { db, records } = database({ ...legacySeed, [markerPath]: { version: 'legacy-root-v1', completedAt: 'earlier' } });
    const before = structuredClone(records);
    const report = await ensureLegacyDataMigration(() => db, 'owner', { now: () => NOW });
    expect(report).toEqual({ version: 'legacy-root-v1', completedAt: 'earlier' });
    expect(records).toEqual(before);
  });

  it('copies legacy collections, strips the stored PIN and records a completion marker', async () => {
    const { db, records } = database(legacySeed);
    const report: any = await ensureLegacyDataMigration(() => db, 'owner', { now: () => NOW });

    expect(records[`${owner}/transactions/t1`]).toEqual(legacySeed['transactions/t1']);
    expect(records[`${owner}/transactions/t2`]).toEqual(legacySeed['transactions/t2']);
    expect(records[`${owner}/appSettings/main`]).toMatchObject({ theme: 'dark', aiClassificationEnabled: false });
    expect(records[`${owner}/appSettings/main`]).not.toHaveProperty('accessPin');
    expect(records[markerPath]).toMatchObject({ version: 'legacy-root-v1', sourceDeleted: false });
    expect(report.collections.transactions).toMatchObject({ sourceCount: 3, copied: 3, skippedExisting: 0 });
    // The legacy source is never deleted.
    expect(records['transactions/t1']).toEqual(legacySeed['transactions/t1']);
  });

  it('never overwrites a document the user already edited under their own path', async () => {
    const edited = { amount: 15_000, categoryId: 'food', type: 'expense', memo: '사용자가 수정' };
    const { db, records } = database({ ...legacySeed, [`${owner}/transactions/t1`]: edited });
    const report: any = await ensureLegacyDataMigration(() => db, 'owner', { now: () => NOW });

    expect(records[`${owner}/transactions/t1`]).toEqual(edited);
    expect(records[`${owner}/transactions/t2`]).toEqual(legacySeed['transactions/t2']);
    expect(report.collections.transactions).toMatchObject({ sourceCount: 3, copied: 2, skippedExisting: 1 });
    // A differing amount on a pre-existing document is a user edit, not a failure.
    expect(records[markerPath]).toBeTruthy();
    expect(records[failurePath]).toBeUndefined();
  });

  it('keeps edits intact when the marker was deleted and the migration runs again', async () => {
    const { db, records } = database(legacySeed);
    await ensureLegacyDataMigration(() => db, 'owner', { now: () => NOW });
    records[`${owner}/transactions/t1`] = { ...records[`${owner}/transactions/t1`], amount: 99_000 };
    delete records[markerPath];

    await ensureLegacyDataMigration(() => db, 'owner', { now: () => NOW });
    expect(records[`${owner}/transactions/t1`].amount).toBe(99_000);
  });

  it('fails verification when copied amounts differ, recording why without writing the success marker', async () => {
    const { db, records } = database(legacySeed, (path, data) => (
      path === `${owner}/transactions/t2` ? { ...data, amount: 1 } : data
    ));

    const error = await ensureLegacyDataMigration(() => db, 'owner', { now: () => NOW }).catch(caught => caught);
    expect(error).toBeInstanceOf(MigrationVerificationError);
    expect(error.failure).toMatchObject({ collection: 'transactions', reason: 'amount_mismatch' });
    expect(records[markerPath]).toBeUndefined();
    expect(records[failurePath]).toMatchObject({
      version: 'legacy-root-v1',
      failedAt: NOW.toISOString(),
      failure: { collection: 'transactions', reason: 'amount_mismatch' },
    });
    expect((records[failurePath] as any).collections.transactions).toMatchObject({ sourceCount: 3 });
  });

  it('fails verification when a copied document is missing afterwards', async () => {
    const { db, records } = database(legacySeed, (path, data) => (
      path === `${owner}/categories/salary` ? null : data
    ));
    const error = await ensureLegacyDataMigration(() => db, 'owner', { now: () => NOW }).catch(caught => caught);
    expect(error).toBeInstanceOf(MigrationVerificationError);
    expect(error.failure).toMatchObject({ collection: 'categories', reason: 'missing_documents', missingIds: ['salary'] });
    expect(records[markerPath]).toBeUndefined();
  });

  it('reports skipped only when the Admin SDK cannot be initialised', async () => {
    const report = await ensureLegacyDataMigration(() => { throw new Error('no credentials'); }, 'owner', { now: () => NOW });
    expect(report).toMatchObject({ skipped: true, reason: 'admin_db_unavailable' });
  });

  it('propagates Firestore errors that happen after initialisation instead of skipping', async () => {
    const brokenDb = {
      collection: (name: string) => (name === 'users'
        ? { doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) }
        : { get: async () => { throw new Error('deadline exceeded'); } }),
    } as unknown as Firestore;
    await expect(ensureLegacyDataMigration(() => brokenDb, 'owner', { now: () => NOW })).rejects.toThrow('deadline exceeded');
  });
});

describe('POST /api/migration/ensure handler', () => {
  let running: Awaited<ReturnType<typeof listen>> | null = null;
  afterEach(async () => {
    await running?.close();
    running = null;
  });

  async function call(run: (uid: string) => Promise<unknown>, userUid = 'owner') {
    const app = express();
    app.post('/api/migration/ensure', (_req, res, next) => {
      res.locals.userUid = userUid;
      res.locals.ownerUid = userUid;
      next();
    }, createMigrationHandler({ ownerUid: 'owner', run, log: vi.fn() }));
    running = await listen(app);
    const response = await fetch(running.url('/api/migration/ensure'), { method: 'POST' });
    return { status: response.status, body: await response.json() };
  }

  it('returns 200 with the report on success', async () => {
    const { status, body } = await call(async () => ({ version: 'legacy-root-v1' }));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, report: { version: 'legacy-root-v1' } });
  });

  it('returns 200 for a skipped run so development without Admin credentials keeps working', async () => {
    const { status, body } = await call(async () => ({ skipped: true, reason: 'admin_db_unavailable' }));
    expect(status).toBe(200);
    expect(body.report).toMatchObject({ skipped: true });
  });

  it('turns a verification failure into 500 with the failure details', async () => {
    const failure = { collection: 'transactions', reason: 'amount_mismatch' };
    const { status, body } = await call(async () => { throw new MigrationVerificationError('amount totals differ', failure as any); });
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: 'Migration failed', failure });
    expect(body.message).toBeTruthy();
    expect(body.ok).toBeUndefined();
  });

  it('returns 500 for unexpected errors too', async () => {
    const { status, body } = await call(async () => { throw new Error('deadline exceeded'); });
    expect(status).toBe(500);
    expect(body.error).toBe('Migration failed');
  });

  it('skips non-owner accounts without running the migration', async () => {
    const run = vi.fn();
    const { status, body } = await call(run, 'wife');
    expect(status).toBe(200);
    expect(body.report).toMatchObject({ skipped: true, reason: 'not_owner_account' });
    expect(run).not.toHaveBeenCalled();
  });
});
