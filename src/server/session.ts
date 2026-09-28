import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_MS = {
  /** "로그인 유지" — the token lives in localStorage. */
  remember: 30 * 24 * 60 * 60 * 1000,
  /** Session-only login — the token lives in sessionStorage. */
  session: 12 * 60 * 60 * 1000,
} as const;

export const sessionTtlMs = (remember: boolean) => (remember ? SESSION_TTL_MS.remember : SESSION_TTL_MS.session);

type SigningSecrets = { current: string; previous?: string };

export type VerifiedSession =
  | { ok: true; uid: string; epoch: number; legacy: boolean }
  | { ok: false; reason: 'invalid' | 'expired' };

const TOKEN_VERSION = 'v2';

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('hex');

/** Token format: `v2:uid:epoch:expiresAt:hmac`, base64url-encoded. */
export function createSessionToken(
  uid: string,
  epoch: number,
  secrets: SigningSecrets,
  { ttlMs = SESSION_TTL_MS.remember, now = Date.now() }: { ttlMs?: number; now?: number } = {},
): string {
  const payload = `${TOKEN_VERSION}:${uid}:${epoch}:${now + ttlMs}`;
  return Buffer.from(`${payload}:${sign(payload, secrets.current)}`).toString('base64url');
}

/**
 * Checks the signature first and expiry second, so a forged token is never
 * reported as merely expired. The previous secret is accepted during a key
 * rotation. Legacy `uid:expiresAt:hmac` tokens are accepted as epoch 0 for one
 * release (T3); remove that branch in the next deployment.
 */
export function verifySessionToken(token: string, secrets: SigningSecrets, now = Date.now()): VerifiedSession {
  const invalid = { ok: false, reason: 'invalid' } as const;
  try {
    const parts = Buffer.from(token, 'base64url').toString('utf8').split(':');
    let uid: string;
    let epoch: number;
    let expiresAtText: string;
    let legacy = false;
    if (parts.length === 5 && parts[0] === TOKEN_VERSION) {
      [, uid, , expiresAtText] = parts;
      epoch = Number(parts[2]);
    } else if (parts.length === 3) {
      [uid, expiresAtText] = parts;
      epoch = 0;
      legacy = true;
    } else {
      return invalid;
    }
    const expiresAt = Number(expiresAtText);
    if (!uid || !Number.isSafeInteger(epoch) || epoch < 0 || !Number.isFinite(expiresAt)) return invalid;

    const hmac = parts[parts.length - 1];
    const payload = parts.slice(0, -1).join(':');
    const candidates = [secrets.current, secrets.previous].filter((secret): secret is string => Boolean(secret));
    const matches = candidates.some(secret => {
      const expected = sign(payload, secret);
      return hmac.length === expected.length && timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
    });
    if (!matches) return invalid;
    if (now > expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true, uid, epoch, legacy };
  } catch {
    return invalid;
  }
}
