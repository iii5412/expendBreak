import { loadConfiguredAccounts, type ConfiguredAccount } from './accounts';
import { resolveSessionSecrets, resolveOwnerPinSecret, resolvePinMinLength, type ServerEnv } from './authConfig';
import { resolveTrustProxyHops } from './httpSecurity';

export interface ServerConfig {
  production: boolean;
  port: number;
  ownerUid: string;
  sessionSecrets: ReturnType<typeof resolveSessionSecrets>;
  accounts: ConfiguredAccount[];
  accountUids: ReadonlySet<string>;
  pinMinLength: number;
  trustProxyHops: number;
  usingDevPin: boolean;
  /**
   * Without Google credentials the Admin SDK leaks unhandled rejections that
   * crash the process, so local development without credentials keeps PIN
   * counters and session epochs in memory and skips the legacy migration.
   */
  hasAdminCredentials: boolean;
  nativeOrigins: ReadonlySet<string>;
  /** Warnings found while reading the environment, for the caller to log. */
  warnings: string[];
}

/** Reads and validates everything the server needs from the environment, once. */
export function loadServerConfig(env: ServerEnv): ServerConfig {
  const warnings: string[] = [];
  const ownerUid = env.OWNER_UID?.trim() || env.APP_OWNER_UID?.trim() || 'owner';
  const accounts = loadConfiguredAccounts(env, ownerUid);

  const nativeOrigins = new Set(
    String(env.NATIVE_ALLOWED_ORIGINS || 'https://localhost')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
  try {
    if (env.APP_URL) nativeOrigins.add(new URL(env.APP_URL).origin);
  } catch {
    warnings.push('APP_URL is not a valid absolute URL; it was not added to the CORS allowlist.');
  }

  const production = env.NODE_ENV === 'production';
  const hasAdminCredentials = production || Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!hasAdminCredentials) {
    warnings.push('No Google credentials in development: PIN failure counters and session epochs stay in memory and the legacy migration is skipped.');
  }
  const usingDevPin = resolveOwnerPinSecret(env).usingDevDefault;
  if (usingDevPin) warnings.push('No PIN configured; the development PIN 0000 is accepted. Never deploy like this.');

  return {
    production,
    port: Number(env.PORT) || 3000,
    ownerUid,
    sessionSecrets: resolveSessionSecrets(env, { warn: message => warnings.push(String(message)) }),
    accounts,
    accountUids: new Set(accounts.map(account => account.uid)),
    pinMinLength: resolvePinMinLength(env),
    trustProxyHops: resolveTrustProxyHops(env),
    usingDevPin,
    hasAdminCredentials,
    nativeOrigins,
    warnings,
  };
}
