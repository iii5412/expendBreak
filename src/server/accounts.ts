import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { resolveOwnerPinSecret, type ServerEnv } from './authConfig';

export type ConfiguredAccount = {
  uid: string;
  name: string;
  pinHash: string;
  isOwner: boolean;
};

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function checkPinAgainstSecret(pin: string, secret: string): boolean {
  if (secret.startsWith('pbkdf2$')) {
    const parts = secret.split('$');
    if (parts.length === 4) {
      const [, iterationText, saltText, digestText] = parts;
      const iterations = Number(iterationText);
      if (Number.isSafeInteger(iterations) && iterations >= 100_000 && saltText && digestText) {
        try {
          const expected = Buffer.from(digestText, 'base64');
          const actual = pbkdf2Sync(pin, Buffer.from(saltText, 'base64'), iterations, expected.length, 'sha256');
          return actual.length === expected.length && timingSafeEqual(actual, expected);
        } catch {
          // If decoding or hashing fails, fallback to safe string comparison
        }
      }
    }
  }
  return safeEqualText(pin, secret);
}

export function loadConfiguredAccounts(env: ServerEnv, ownerUid: string): ConfiguredAccount[] {
  const accounts: ConfiguredAccount[] = [{
    uid: ownerUid,
    name: env.OWNER_NAME?.trim() || '내 계정',
    pinHash: resolveOwnerPinSecret(env).secret,
    isOwner: true,
  }];
  const raw = env.APP_ACCOUNTS_JSON?.trim();
  if (!raw) return accounts;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('APP_ACCOUNTS_JSON must be valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('APP_ACCOUNTS_JSON must be a JSON array.');
  }

  for (const candidate of parsed) {
    const uid = typeof candidate?.uid === 'string' ? candidate.uid.trim() : '';
    const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
    const pinHash = typeof candidate?.pinHash === 'string' ? candidate.pinHash.trim() : '';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(uid) || !name || name.length > 40 || !pinHash) {
      throw new Error('Each APP_ACCOUNTS_JSON entry needs a valid uid, name, and pinHash.');
    }
    if (accounts.some(account => account.uid === uid)) {
      throw new Error(`Duplicate account uid in APP_ACCOUNTS_JSON: ${uid}`);
    }
    if (accounts.some(account => account.pinHash === pinHash)) {
      throw new Error(`Each account must use a different PIN hash: ${uid}`);
    }
    accounts.push({ uid, name, pinHash, isOwner: false });
  }
  return accounts;
}
