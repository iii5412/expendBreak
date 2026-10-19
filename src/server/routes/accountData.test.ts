import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createSessionToken } from '../session';
import { listen } from '../testServer';
import { setLogSink } from '../lib/logger';

const secret = 'synthetic-test-signing-material'.repeat(2);
const confirmation = { confirmation: '내 가계부 초기화' };
let running: Awaited<ReturnType<typeof listen>> | undefined;
let restore: (() => void) | undefined;
beforeEach(() => {
  restore = setLogSink(() => undefined);
});
afterEach(async () => {
  await running?.close();
  restore?.();
});

async function start(seed: Record<string, object>) {
  const records = new Map(Object.entries(seed));
  let commits = 0;
  let fail = false;
  const adminDb = {
    collection: (root: string) => ({
      doc: (uid: string) => ({
        collection: (name: string) => ({
          limit: (count: number) => ({
            get: async () => {
              const prefix = `${root}/${uid}/${name}/`;
              const docs = [...records.keys()]
                .filter((path) => path.startsWith(prefix))
                .slice(0, count)
                .map((path) => ({ ref: { path } }));
              return { docs, empty: docs.length === 0 };
            },
          }),
        }),
      }),
    }),
    batch: () => {
      const paths: string[] = [];
      return {
        delete: (ref: { path: string }) => {
          paths.push(ref.path);
        },
        commit: async () => {
          if (fail) throw new Error('database down');
          commits++;
          paths.forEach((path) => records.delete(path));
        },
      };
    },
  };
  const { app } = createApp({
    env: { OWNER_UID: 'alice', APP_SESSION_SECRET: secret },
    deps: {
      getAdminServices: () => ({ adminDb, adminAuth: {} }) as never,
      getGeminiClient: () => null,
    },
  });
  running = await listen(app);
  const request = (
    body: unknown = confirmation,
    token: string | null = createSessionToken('alice', 0, { current: secret }),
  ) =>
    fetch(running!.url('/api/account/reset-data'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  return {
    records,
    request,
    commits: () => commits,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

describe('account data reset HTTP API', () => {
  it('requires a signed, configured account session before any deletion', async () => {
    const test = await start({ 'users/alice/transactions/t': {} });
    expect((await test.request(confirmation, null)).status).toBe(401);
    expect((await test.request(confirmation, 'invalid')).status).toBe(401);
    expect((await test.request(confirmation, createSessionToken('mallory', 0, { current: secret }))).status).toBe(403);
    expect(test.commits()).toBe(0);
  });
  it('requires exact confirmation and rejects user-controlled target paths', async () => {
    const test = await start({ 'users/alice/transactions/t': {} });
    for (const body of [
      {},
      { confirmation: '삭제' },
      { ...confirmation, uid: 'bob' },
      { ...confirmation, collection: 'migrations' },
    ])
      expect((await test.request(body)).status).toBe(400);
    expect(test.commits()).toBe(0);
  });
  it('deletes immutable audit rows and payday data only for the session account; preserves operational metadata', async () => {
    const test = await start({
      ...Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`users/alice/transactions/t${i}`, {}])),
      'users/alice/amountChanges/a': {},
      'users/alice/paydayFunding/f': {},
      'users/alice/paydayPaymentBatches/p': {},
      'users/alice/appSettings/global': {},
      'users/alice/accountMerges/merged': {},
      'users/alice/migrations/completed': {},
      'users/alice/aiUsage/day': {},
      'users/alice/sessionEpochs/current': {},
      'users/bob/transactions/t': {},
    });
    const response = await test.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect([...test.records.keys()].sort()).toEqual([
      'users/alice/aiUsage/day',
      'users/alice/migrations/completed',
      'users/alice/sessionEpochs/current',
      'users/bob/transactions/t',
    ]);
    expect(test.commits()).toBe(7);
    expect((await test.request()).status).toBe(200);
    expect(test.commits()).toBe(7);
  });
  it('reports failures without claiming completion and permits retry', async () => {
    const test = await start({ 'users/alice/transactions/t': {}, 'users/bob/transactions/t': {} });
    test.fail(true);
    const response = await test.request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'reset_incomplete' });
    expect(test.records.size).toBe(2);
    test.fail(false);
    expect((await test.request()).status).toBe(200);
    expect([...test.records.keys()]).toEqual(['users/bob/transactions/t']);
  });
});
