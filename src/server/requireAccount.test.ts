import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequireAccount } from './requireAccount';
import { createSessionToken, sessionTtlMs } from './session';
import { createMemorySessionEpochStore, createSessionEpochs, SESSION_EPOCH_CACHE_MS } from './sessionEpochs';
import { listen } from './testServer';

const secrets = { current: 's'.repeat(48) };
const NOW = Date.UTC(2026, 8, 28);

let running: Awaited<ReturnType<typeof listen>> | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

async function start() {
  let clock = NOW;
  const store = createMemorySessionEpochStore();
  const epochs = createSessionEpochs({ store, now: () => clock, log: () => undefined });
  const app = express();
  app.get('/api/ai/probe', createRequireAccount({
    secrets,
    accountUids: new Set(['owner', 'wife']),
    epochs,
    now: () => clock,
  }), (_req, res) => res.json({ uid: res.locals.userUid }));
  running = await listen(app);
  const call = async (token?: string) => {
    const response = await fetch(running!.url('/api/ai/probe'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json() };
  };
  return { call, store, epochs, advance: (ms: number) => { clock += ms; } };
}

const token = (uid: string, epoch = 0, remember = true) =>
  createSessionToken(uid, epoch, secrets, { ttlMs: sessionTtlMs(remember), now: NOW });

describe('requireAccount', () => {
  it('accepts a valid token', async () => {
    const { call } = await start();
    expect(await call(token('wife'))).toEqual({ status: 200, body: { uid: 'wife' } });
  });

  it('answers 401 session_missing / session_invalid / session_expired', async () => {
    const { call, advance } = await start();
    expect(await call()).toEqual({ status: 401, body: { error: 'session_missing' } });
    expect(await call('garbage')).toEqual({ status: 401, body: { error: 'session_invalid' } });
    const shortLived = token('owner', 0, false);
    advance(sessionTtlMs(false) + 1);
    expect(await call(shortLived)).toEqual({ status: 401, body: { error: 'session_expired' } });
  });

  it('answers 403 only for a valid token of an unknown account', async () => {
    const { call } = await start();
    expect(await call(token('stranger'))).toEqual({ status: 403, body: { error: 'account_unknown' } });
  });

  it('rejects older epochs with session_revoked within one cache period of a revoke elsewhere', async () => {
    const { call, store, advance } = await start();
    const old = token('owner', 0);
    expect((await call(old)).status).toBe(200);

    await store.increment('owner'); // e.g. `npm run session:revoke -- owner` on another machine
    advance(SESSION_EPOCH_CACHE_MS);
    expect(await call(old)).toEqual({ status: 401, body: { error: 'session_revoked' } });
    expect((await call(token('owner', 1))).status).toBe(200);
    // Revoking one account leaves the others signed in.
    expect((await call(token('wife', 0))).status).toBe(200);
  });

  it('keeps legacy tokens working until the account is revoked', async () => {
    const { createHmac } = await import('node:crypto');
    const payload = `owner:${NOW + 60_000}`;
    const legacy = Buffer.from(`${payload}:${createHmac('sha256', secrets.current).update(payload).digest('hex')}`).toString('base64url');
    const { call, epochs } = await start();
    expect((await call(legacy)).status).toBe(200);
    await epochs.revoke('owner');
    expect(await call(legacy)).toEqual({ status: 401, body: { error: 'session_revoked' } });
  });

  it('answers 503 when the epoch cannot be read at all', async () => {
    const { call, store } = await start();
    vi.spyOn(store, 'read').mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await call(token('owner'))).status).toBe(503);
  });
});
