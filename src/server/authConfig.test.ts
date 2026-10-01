import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertProductionConfig,
  classifyPinInput,
  resolveOwnerPinSecret,
  resolvePinMinLength,
  resolveSessionSecrets,
  validateProductionConfig,
} from './authConfig';

const STRONG_SECRET = 'x'.repeat(48);
const PIN_HASH = 'pbkdf2$210000$c2FsdA==$ZGlnZXN0';
const validProductionEnv = {
  NODE_ENV: 'production',
  APP_SESSION_SECRET: STRONG_SECRET,
  APP_PIN_HASH: PIN_HASH,
};

describe('validateProductionConfig', () => {
  it('accepts a complete production configuration', () => {
    expect(validateProductionConfig(validProductionEnv)).toEqual([]);
  });

  it('names APP_SESSION_SECRET when it is missing', () => {
    const problems = validateProductionConfig({ ...validProductionEnv, APP_SESSION_SECRET: undefined });
    expect(problems.join('\n')).toContain('APP_SESSION_SECRET');
  });

  it('rejects a session secret shorter than 32 bytes', () => {
    const problems = validateProductionConfig({ ...validProductionEnv, APP_SESSION_SECRET: 'short-secret' });
    expect(problems.join('\n')).toContain('APP_SESSION_SECRET');
  });

  it('measures the secret length in bytes, not characters', () => {
    // 11 Hangul syllables are 33 UTF-8 bytes.
    const problems = validateProductionConfig({ ...validProductionEnv, APP_SESSION_SECRET: '가'.repeat(11) });
    expect(problems).toEqual([]);
  });

  it.each([undefined, '', '1234', 'sha256$abc'])('rejects APP_PIN_HASH=%s', value => {
    const problems = validateProductionConfig({ ...validProductionEnv, APP_PIN_HASH: value });
    expect(problems.join('\n')).toContain('APP_PIN_HASH');
  });

  it('rejects the plaintext APP_ACCESS_KEY compatibility path', () => {
    const problems = validateProductionConfig({
      ...validProductionEnv,
      APP_PIN_HASH: undefined,
      APP_ACCESS_KEY: '1234',
    });
    expect(problems.join('\n')).toContain('APP_ACCESS_KEY');
  });

  it('reports every problem at once so one deploy fixes them all', () => {
    const problems = validateProductionConfig({ NODE_ENV: 'production' });
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe('assertProductionConfig', () => {
  it('exits with code 1 and logs the missing variable name in production', () => {
    const exit = vi.fn();
    const log = vi.fn();
    assertProductionConfig({ NODE_ENV: 'production', APP_PIN_HASH: PIN_HASH }, { exit, log });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls.flat().join('\n')).toContain('APP_SESSION_SECRET');
  });

  it('does not exit for a valid production configuration', () => {
    const exit = vi.fn();
    assertProductionConfig(validProductionEnv, { exit, log: vi.fn() });
    expect(exit).not.toHaveBeenCalled();
  });

  it('does not exit in development even when nothing is configured', () => {
    const exit = vi.fn();
    assertProductionConfig({ NODE_ENV: 'development' }, { exit, log: vi.fn() });
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('resolveSessionSecrets', () => {
  it('uses APP_SESSION_SECRET as the only signing key', () => {
    const secrets = resolveSessionSecrets({ APP_SESSION_SECRET: STRONG_SECRET, APP_PIN_HASH: PIN_HASH });
    expect(secrets.current).toBe(STRONG_SECRET);
    expect(secrets.ephemeral).toBe(false);
  });

  it('never falls back to the PIN hash or the legacy access key', () => {
    const warn = vi.fn();
    const secrets = resolveSessionSecrets({ APP_PIN_HASH: PIN_HASH, APP_ACCESS_KEY: '1234' }, { warn });
    expect(secrets.current).not.toBe(PIN_HASH);
    expect(secrets.current).not.toBe('1234');
  });

  it('generates a random ephemeral secret with a warning in development', () => {
    const warn = vi.fn();
    const first = resolveSessionSecrets({}, { warn });
    const second = resolveSessionSecrets({}, { warn: vi.fn() });
    expect(first.ephemeral).toBe(true);
    expect(Buffer.byteLength(first.current)).toBeGreaterThanOrEqual(32);
    expect(first.current).not.toBe(second.current);
    expect(warn).toHaveBeenCalled();
  });

  it('accepts APP_SESSION_SECRET_PREVIOUS for one rotation window', () => {
    const secrets = resolveSessionSecrets({
      APP_SESSION_SECRET: STRONG_SECRET,
      APP_SESSION_SECRET_PREVIOUS: PIN_HASH,
    });
    expect(secrets.previous).toBe(PIN_HASH);
  });
});

describe('resolveOwnerPinSecret', () => {
  it('prefers APP_PIN_HASH', () => {
    expect(resolveOwnerPinSecret({ APP_PIN_HASH: PIN_HASH, APP_ACCESS_KEY: '1234' })).toEqual({
      secret: PIN_HASH,
      usingDevDefault: false,
    });
  });

  it('flags the 0000 development default so startup can warn about it', () => {
    expect(resolveOwnerPinSecret({})).toEqual({ secret: '0000', usingDevDefault: true });
  });
});

describe('PIN length policy', () => {
  it('keeps 4-digit PINs working until PIN_MIN_LENGTH is raised', () => {
    expect(resolvePinMinLength({})).toBe(4);
    expect(resolvePinMinLength({ PIN_MIN_LENGTH: '6' })).toBe(6);
  });

  it.each(['', 'abc', '2', '99'])('ignores an unusable PIN_MIN_LENGTH=%s', value => {
    const length = resolvePinMinLength({ PIN_MIN_LENGTH: value });
    expect(length).toBeGreaterThanOrEqual(4);
    expect(length).toBeLessThanOrEqual(12);
  });

  it('asks 4~5 digit PINs to upgrade while still accepting them', () => {
    expect(classifyPinInput('1234', 4)).toEqual({ ok: true, upgradeRequired: true });
    expect(classifyPinInput('12345', 4)).toEqual({ ok: true, upgradeRequired: true });
    expect(classifyPinInput('123456', 4)).toEqual({ ok: true, upgradeRequired: false });
    expect(classifyPinInput('123456789012', 4)).toEqual({ ok: true, upgradeRequired: false });
  });

  it('rejects PINs shorter than the configured minimum', () => {
    expect(classifyPinInput('12345', 6).ok).toBe(false);
    expect(classifyPinInput('123456', 6)).toEqual({ ok: true, upgradeRequired: false });
  });

  it.each(['', '123', '1234567890123', '12a4', ' 1234'])('rejects malformed PIN %j', value => {
    expect(classifyPinInput(value, 4).ok).toBe(false);
  });
});

describe('repository hygiene', () => {
  const forbidden = ['expendbreak', 'secret', 'key', '2026'].join('_');
  const root = path.resolve(__dirname, '../..');

  function codeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return codeFiles(full);
      return /\.(ts|tsx|mjs|js|json)$/.test(name) ? [full] : [];
    });
  }

  it('contains no hard-coded session signing key in server or app code', () => {
    const files = [
      path.join(root, '.env.example'),
      ...codeFiles(path.join(root, 'src')),
      ...codeFiles(path.join(root, 'scripts')),
    ];
    const offenders = files.filter(file => readFileSync(file, 'utf8').includes(forbidden));
    expect(offenders).toEqual([]);
  });
});
