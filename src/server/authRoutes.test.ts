import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthRouter } from './authRoutes';
import { applySecurityBaseline } from './httpSecurity';
import { createMemoryPinGuardStore, createPinGuard, PIN_GUARD_LIMITS } from './pinGuard';
import { createRequireAccount } from './requireAccount';
import { createSessionToken, verifySessionToken } from './session';
import { createMemorySessionEpochStore, createSessionEpochs } from './sessionEpochs';
import { listen } from './testServer';

// Plain secrets keep these tests fast; PBKDF2 verification is covered by checkPinAgainstSecret.
const accounts = [
  { uid: 'owner', name: '내 계정', pinHash: '1234', isOwner: true },
  { uid: 'wife', name: '와이프', pinHash: '654321', isOwner: false },
];

let running: Awaited<ReturnType<typeof listen>> | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

const secrets = { current: 's'.repeat(48) };

type Epochs = ReturnType<typeof createSessionEpochs>;

async function start(options: { minPinLength?: number; issueSession?: any; epochs?: Epochs } = {}) {
  const guard = createPinGuard({ store: createMemoryPinGuardStore() });
  const epochs = options.epochs ?? createSessionEpochs({ store: createMemorySessionEpochStore() });
  const issueSession = options.issueSession ?? vi.fn(async (account: { uid: string }) => ({
    token: `session-${account.uid}`,
    firebaseToken: `firebase-${account.uid}`,
  }));
  const revokeSessions = vi.fn(async (uid: string) => {
    await epochs.revoke(uid);
  });
  const app = express();
  applySecurityBaseline(app, { production: true, trustProxyHops: 1 });
  app.use('/api/auth', createAuthRouter({
    accounts,
    guard,
    minPinLength: options.minPinLength ?? 4,
    issueSession,
    requireAccount: createRequireAccount({ secrets, accountUids: new Set(accounts.map(account => account.uid)), epochs }),
    revokeSessions,
  }));
  running = await listen(app);
  const login = (key: string, ip = '198.51.100.1', remember?: boolean) => fetch(running!.url('/api/auth/verify-key'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ key, remember }),
  });
  const revokeOthers = (token: string, remember = true) => fetch(running!.url('/api/auth/revoke-others'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ remember }),
  });
  return { login, revokeOthers, issueSession, revokeSessions, epochs };
}

describe('POST /api/auth/verify-key', () => {
  it('issues a session for a correct PIN', async () => {
    const { login } = await start();
    const response = await login('654321');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isValid: true,
      token: 'session-wife',
      firebaseToken: 'firebase-wife',
      account: { uid: 'wife', name: '와이프', isOwner: false },
      pinUpgradeRequired: false,
    });
  });

  it('flags a 4-digit PIN login for upgrade while still allowing it', async () => {
    const { login } = await start();
    const response = await login('1234');
    expect(response.status).toBe(200);
    expect((await response.json()).pinUpgradeRequired).toBe(true);
  });

  it('rejects 4-digit PINs once PIN_MIN_LENGTH is 6', async () => {
    const { login } = await start({ minPinLength: 6 });
    expect((await login('1234')).status).toBe(400);
    expect((await login('654321')).status).toBe(200);
  });

  it('returns 401 for a wrong PIN', async () => {
    const { login } = await start();
    const response = await login('999999');
    expect(response.status).toBe(401);
    expect((await response.json()).isValid).toBe(false);
  });

  it('keeps lockouts of different forwarded client IPs independent', async () => {
    const { login } = await start();
    for (let index = 0; index < 5; index += 1) await login('999999', '203.0.113.1');
    expect((await login('654321', '203.0.113.1')).status).toBe(429);
    expect((await login('654321', '203.0.113.2')).status).toBe(200);
  });

  it('rejects even the correct PIN with 429 from the 31st failure in an hour', async () => {
    const { login, issueSession } = await start();
    for (let index = 0; index < PIN_GUARD_LIMITS.globalMaxFailures; index += 1) {
      expect((await login('999999', `192.0.2.${index + 1}`)).status).toBe(401);
    }
    const response = await login('654321', '198.51.100.200');
    expect(response.status).toBe(429);
    expect((await response.json()).retryAfterMs).toBeGreaterThan(0);
    expect(issueSession).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking internals when issuing the session fails', async () => {
    const { login } = await start({ issueSession: vi.fn().mockRejectedValue(new Error('admin down')) });
    const response = await login('654321');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('admin down');
  });
});

describe('session lifetime', () => {
  it('passes the "remember" choice to the session issuer', async () => {
    const { login, issueSession } = await start();
    await login('654321', '198.51.100.1', true);
    await login('654321', '198.51.100.1');
    expect(issueSession.mock.calls.map((call: any[]) => call[1])).toEqual([{ remember: true }, { remember: false }]);
  });
});

describe('POST /api/auth/revoke-others', () => {
  // Issues real tokens under the account's current epoch, like server.ts does.
  async function startWithRealTokens() {
    const epochs = createSessionEpochs({ store: createMemorySessionEpochStore() });
    const issueSession = vi.fn(async (account: { uid: string }) => ({
      token: createSessionToken(account.uid, await epochs.fresh(account.uid), secrets),
      firebaseToken: `firebase-${account.uid}`,
    }));
    return start({ issueSession, epochs });
  }

  it('revokes older sessions and hands this device a new one', async () => {
    const { revokeOthers, revokeSessions } = await startWithRealTokens();
    const oldToken = createSessionToken('wife', 0, secrets);

    const response = await revokeOthers(oldToken);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(revokeSessions).toHaveBeenCalledWith('wife');
    expect(body.firebaseToken).toBe('firebase-wife');
    expect(verifySessionToken(body.token, secrets)).toMatchObject({ ok: true, uid: 'wife', epoch: 1 });

    const reused = await revokeOthers(oldToken);
    expect(reused.status).toBe(401);
    expect(await reused.json()).toEqual({ error: 'session_revoked' });
  });

  it('requires a session', async () => {
    const { revokeOthers, revokeSessions } = await start();
    expect((await revokeOthers('garbage')).status).toBe(401);
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});
