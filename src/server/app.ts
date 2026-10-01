import express, { type Express } from 'express';
import { applicationDefault, getApps as getAdminApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import packageInfo from '../../package.json';
import type { ServerEnv } from './authConfig';
import { createAuthRouter } from './authRoutes';
import { loadServerConfig, type ServerConfig } from './config';
import { applySecurityBaseline } from './httpSecurity';
import { createGeminiClient } from './lib/gemini';
import { logger, requestLogging } from './lib/logger';
import { createAiLimiters } from './lib/rateLimiter';
import { createMigrationHandler, ensureLegacyDataMigration } from './legacyMigration';
import { createFirestorePinGuardStore, createMemoryPinGuardStore, createPinGuard } from './pinGuard';
import { createRequireAccount } from './requireAccount';
import { createSessionToken, sessionTtlMs } from './session';
import {
  createFirestoreSessionEpochStore,
  createMemorySessionEpochStore,
  createSessionEpochs,
} from './sessionEpochs';
import { createAppUpdateRouter } from './routes/appUpdate';
import { createBankAccountsRouter } from './routes/bankAccounts';
import { createCategoryRecommendRouter } from './routes/ai/categoryRecommend';
import { createClassifyRouter } from './routes/ai/classify';
import { createFeedbackRouter } from './routes/ai/feedback';
import { createFinanceChatRouter } from './routes/ai/financeChat';
import { createRealtimeRouter } from './routes/ai/realtime';
import { createReceiptRouter } from './routes/ai/receipt';
import { createVoiceRouter } from './routes/ai/voice';
import type { RouteDeps } from './routes/types';

export interface CreateAppOptions {
  env: ServerEnv;
  /** Replace the outside world (Firebase Admin, Gemini, OpenAI) — used by tests. */
  deps?: Partial<Pick<RouteDeps, 'getGeminiClient' | 'getAdminServices' | 'fetchImpl'>>;
}

export interface CreatedApp {
  app: Express;
  config: ServerConfig;
}

function defaultAdminServices(): ReturnType<RouteDeps['getAdminServices']> {
  const adminApp = getAdminApps()[0] || initializeAdminApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
  const adminDb = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getAdminFirestore(adminApp, firebaseConfig.firestoreDatabaseId)
    : getAdminFirestore(adminApp);
  return { adminDb, adminAuth: getAdminAuth(adminApp) };
}

/**
 * Builds the API server without listening, so tests can drive it over HTTP.
 * Serving the web app (Vite in development, static files in production) is
 * added by the entry point after the API routes, keeping /api first.
 */
export function createApp({ env, deps = {} }: CreateAppOptions): CreatedApp {
  const config = loadServerConfig(env);
  config.warnings.forEach(warning => logger.warn(warning));

  const app = express();
  // Outermost, so every line logged while handling a request carries its id.
  app.use(requestLogging());
  // Small JSON bodies by default; only the receipt and voice routes accept 12MB (see largeJsonBody).
  applySecurityBaseline(app, { production: config.production, trustProxyHops: config.trustProxyHops });

  // Same-origin web requests need no CORS headers. The bundled Capacitor WebView
  // has the exact origin https://localhost, so only configured native origins get
  // an explicit cross-origin grant.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    const allowed = Boolean(origin && config.nativeOrigins.has(origin));
    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      return allowed ? res.sendStatus(204) : res.sendStatus(403);
    }
    return next();
  });

  // Liveness only: no authentication and no Firestore round trip.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, version: env.APP_VERSION?.trim() || packageInfo.version });
  });

  const getAdminServices = deps.getAdminServices ?? defaultAdminServices;
  const sessionEpochs = createSessionEpochs({
    store: config.hasAdminCredentials
      ? {
        read: uid => createFirestoreSessionEpochStore(getAdminServices().adminDb).read(uid),
        increment: uid => createFirestoreSessionEpochStore(getAdminServices().adminDb).increment(uid),
      }
      : createMemorySessionEpochStore(),
    log: logger.error,
  });

  const requireAccount = createRequireAccount({
    secrets: config.sessionSecrets,
    accountUids: config.accountUids,
    epochs: sessionEpochs,
  });

  const routeDeps: RouteDeps = {
    getGeminiClient: deps.getGeminiClient ?? (() => createGeminiClient(env)),
    getAdminServices,
    fetchImpl: deps.fetchImpl ?? fetch,
    sessionSecret: config.sessionSecrets.current,
    requireAccount,
    limiters: createAiLimiters(),
  };

  // Gemini endpoints require an app account session, never the raw PIN.
  app.use('/api/ai/*', requireAccount);

  app.use('/api', createAppUpdateRouter());
  app.use('/api/ai', createRealtimeRouter(routeDeps));
  app.use('/api/ai', createFinanceChatRouter(routeDeps));
  app.use('/api/ai', createReceiptRouter(routeDeps));
  app.use('/api/ai', createVoiceRouter(routeDeps));
  app.use('/api/ai', createClassifyRouter(routeDeps));
  app.use('/api/ai', createCategoryRecommendRouter(routeDeps));
  app.use('/api/ai', createFeedbackRouter(routeDeps));
  app.use('/api/bank-accounts', createBankAccountsRouter(routeDeps));

  // Auth endpoint to check status
  app.get('/api/auth/status', (_req, res) => {
    const isPinConfigured = Boolean(env.APP_PIN_HASH?.trim() || env.APP_ACCESS_KEY?.trim());
    return res.json({ isPinConfigured, accountCount: config.accounts.length });
  });

  const pinGuard = createPinGuard({
    store: config.hasAdminCredentials
      // Resolved per call so a failing Firestore call falls back to in-memory counters.
      ? { transact: update => createFirestorePinGuardStore(getAdminServices().adminDb).transact(update) }
      : createMemoryPinGuardStore(),
    onGlobalLock: ({ failures, lockedUntil }) => logger.error(
      `[ALERT] PIN brute-force lock engaged: ${failures} failures in the last hour; `
        + `all PIN checks refused until ${new Date(lockedUntil).toISOString()}.`,
    ),
    log: logger.error,
  });

  app.use('/api/auth', createAuthRouter({
    accounts: config.accounts,
    guard: pinGuard,
    minPinLength: config.pinMinLength,
    requireAccount,
    issueSession: async (account, { remember }) => ({
      token: createSessionToken(account.uid, await sessionEpochs.fresh(account.uid), config.sessionSecrets, {
        ttlMs: sessionTtlMs(remember),
      }),
      firebaseToken: await getAdminServices().adminAuth.createCustomToken(account.uid),
    }),
    revokeSessions: async uid => {
      await sessionEpochs.revoke(uid);
      if (config.hasAdminCredentials) await getAdminServices().adminAuth.revokeRefreshTokens(uid);
    },
  }));

  // Copies existing global collections into the fixed owner path. It never deletes the source data.
  app.post('/api/migration/ensure', requireAccount, createMigrationHandler({
    ownerUid: config.ownerUid,
    run: ownerUid => ensureLegacyDataMigration(() => {
      if (!config.hasAdminCredentials) throw new Error('No Google credentials in development');
      return getAdminServices().adminDb;
    }, ownerUid),
  }));

  return { app, config };
}
