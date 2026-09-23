import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SigningSecrets = { current: string; previous?: string };

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('hex');

export function createSessionToken(uid: string, secrets: SigningSecrets, now = Date.now()): string {
  const payload = `${uid}:${now + SESSION_TTL_MS}`;
  return Buffer.from(`${payload}:${sign(payload, secrets.current)}`).toString('base64url');
}

/** Returns the uid for a valid token. The previous secret is accepted during a key rotation. */
export function verifySessionToken(token: string, secrets: SigningSecrets, now = Date.now()): string | null {
  try {
    const parts = Buffer.from(token, 'base64url').toString('utf8').split(':');
    if (parts.length !== 3) return null;
    const [uid, expiresAtText, hmac] = parts;
    const expiresAt = Number(expiresAtText);
    if (!uid || !Number.isFinite(expiresAt) || now > expiresAt) return null;

    const payload = `${uid}:${expiresAtText}`;
    const candidates = [secrets.current, secrets.previous].filter((secret): secret is string => Boolean(secret));
    const matches = candidates.some(secret => {
      const expected = sign(payload, secret);
      return hmac.length === expected.length && timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
    });
    return matches ? uid : null;
  } catch {
    return null;
  }
}
