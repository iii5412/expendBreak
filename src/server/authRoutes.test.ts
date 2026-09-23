import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthRouter } from './authRoutes';
import { applySecurityBaseline } from './httpSecurity';
import { createMemoryPinGuardStore, createPinGuard, PIN_GUARD_LIMITS } from './pinGuard';
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

async function start(options: { minPinLength?: number; issueSession?: any } = {}) {
  const guard = createPinGuard({ store: createMemoryPinGuardStore() });
  const issueSession = options.issueSession ?? vi.fn(async (account: { uid: string }) => ({
    token: `session-${account.uid}`,
    firebaseToken: `firebase-${account.uid}`,
  }));
  const app = express();
  applySecurityBaseline(app, { production: true, trustProxyHops: 1 });
  app.use('/api/auth', createAuthRouter({
    accounts,
    guard,
    minPinLength: options.minPinLength ?? 4,
    issueSession,
  }));
  running = await listen(app);
  const login = (key: string, ip = '198.51.100.1') => fetch(running!.url('/api/auth/verify-key'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ key }),
  });
  return { login, issueSession };
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
