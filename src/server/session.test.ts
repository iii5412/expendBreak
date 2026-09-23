import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from './session';

const CURRENT = 'c'.repeat(48);
const PREVIOUS = 'p'.repeat(48);
const NOW = Date.UTC(2026, 8, 23);

function forge(uid: string, secret: string, expiresAt = NOW + 60_000) {
  const payload = `${uid}:${expiresAt}`;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

describe('session tokens', () => {
  it('round-trips a token signed with the current secret', () => {
    const token = createSessionToken('owner', { current: CURRENT }, NOW);
    expect(verifySessionToken(token, { current: CURRENT }, NOW + 1_000)).toBe('owner');
  });

  it('keeps sessions signed with the previous secret valid during rotation', () => {
    const token = forge('owner', PREVIOUS);
    expect(verifySessionToken(token, { current: CURRENT, previous: PREVIOUS }, NOW)).toBe('owner');
    expect(verifySessionToken(token, { current: CURRENT }, NOW)).toBeNull();
  });

  it('rejects a token forged with the formerly hard-coded default key', () => {
    const legacyDefault = ['expendbreak', 'secret', 'key', '2026'].join('_');
    expect(verifySessionToken(forge('owner', legacyDefault), { current: CURRENT }, NOW)).toBeNull();
  });

  it('rejects expired and malformed tokens', () => {
    const token = createSessionToken('owner', { current: CURRENT }, NOW);
    expect(verifySessionToken(token, { current: CURRENT }, NOW + 31 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(verifySessionToken('not-a-token', { current: CURRENT }, NOW)).toBeNull();
    expect(verifySessionToken('', { current: CURRENT }, NOW)).toBeNull();
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
