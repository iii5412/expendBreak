import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionToken, sessionTtlMs, verifySessionToken } from './session';

const CURRENT = 'c'.repeat(48);
const PREVIOUS = 'p'.repeat(48);
const NOW = Date.UTC(2026, 8, 23);

function forge(uid: string, secret: string, expiresAt = NOW + 60_000) {
  const payload = `${uid}:${expiresAt}`;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

describe('session tokens', () => {
  const secrets = { current: CURRENT };

  it('round-trips a v2 token with its epoch', () => {
    const token = createSessionToken('owner', 3, secrets, { now: NOW });
    expect(Buffer.from(token, 'base64url').toString('utf8')).toMatch(/^v2:owner:3:\d+:[0-9a-f]{64}$/);
    expect(verifySessionToken(token, secrets, NOW + 1_000)).toEqual({ ok: true, uid: 'owner', epoch: 3, legacy: false });
  });

  it('keeps sessions signed with the previous secret valid during rotation', () => {
    const token = createSessionToken('owner', 0, { current: PREVIOUS }, { now: NOW });
    expect(verifySessionToken(token, { current: CURRENT, previous: PREVIOUS }, NOW)).toMatchObject({ ok: true, uid: 'owner' });
    expect(verifySessionToken(token, secrets, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('accepts a legacy uid:expiresAt:hmac token as epoch 0 for this release', () => {
    expect(verifySessionToken(forge('owner', CURRENT), secrets, NOW)).toEqual({ ok: true, uid: 'owner', epoch: 0, legacy: true });
  });

  it('rejects a token forged with the formerly hard-coded default key', () => {
    const legacyDefault = ['expendbreak', 'secret', 'key', '2026'].join('_');
    expect(verifySessionToken(forge('owner', legacyDefault), secrets, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a tampered epoch', () => {
    const token = createSessionToken('owner', 1, secrets, { now: NOW });
    const tampered = Buffer.from(Buffer.from(token, 'base64url').toString('utf8').replace(':1:', ':9:')).toString('base64url');
    expect(verifySessionToken(tampered, secrets, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('lives 12 hours without "remember" and 30 days with it', () => {
    const shortToken = createSessionToken('owner', 0, secrets, { ttlMs: sessionTtlMs(false), now: NOW });
    expect(verifySessionToken(shortToken, secrets, NOW + 12 * 60 * 60 * 1000 - 1).ok).toBe(true);
    expect(verifySessionToken(shortToken, secrets, NOW + 12 * 60 * 60 * 1000 + 1)).toEqual({ ok: false, reason: 'expired' });

    const longToken = createSessionToken('owner', 0, secrets, { ttlMs: sessionTtlMs(true), now: NOW });
    expect(verifySessionToken(longToken, secrets, NOW + 29 * 24 * 60 * 60 * 1000).ok).toBe(true);
    expect(verifySessionToken(longToken, secrets, NOW + 31 * 24 * 60 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports an expired forgery as invalid, not expired', () => {
    expect(verifySessionToken(forge('owner', 'x'.repeat(48), NOW - 1), secrets, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('not-a-token', secrets, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifySessionToken('', secrets, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('PIN hashing scripts', () => {
  const root = path.resolve(__dirname, '../..');
  const run = (script: string, ...args: string[]) =>
    spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' });

  it.each(['1234', '12345'])('hash-pin refuses a %s-length PIN', pin => {
    expect(run('hash-pin.mjs', pin).status).toBe(1);
  });

  it('hash-pin produces a pbkdf2 hash for a 6-digit PIN', () => {
    const result = run('hash-pin.mjs', '123456');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^pbkdf2\$\d+\$/);
  });

  it('hash-account refuses a 4-digit PIN and accepts a 6-digit one', () => {
    expect(run('hash-account.mjs', 'wife', '와이프', '1234').status).toBe(1);
    const result = run('hash-account.mjs', 'wife', '와이프', '654321');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)[0].pinHash).toMatch(/^pbkdf2\$/);
  });
});
