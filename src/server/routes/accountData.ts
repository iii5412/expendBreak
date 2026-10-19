import express from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger';
import type { RouteDeps } from './types';

// Explicit allowlist: never touch another user, authentication, migration markers
// or the daily AI quota. The audit collection is client-immutable by design.
const collections = [
  'transactions',
  'categories',
  'budgets',
  'recurringTemplates',
  'recurringOccurrences',
  'merchantRules',
  'bankAccounts',
  'paymentCards',
  'cycleBaselines',
  'quickEntries',
  'amountChanges',
  'paydayFunding',
  'paydayPaymentBatches',
  'appSettings',
  'accountMerges',
] as const;
const confirmation = z.object({ confirmation: z.literal('내 가계부 초기화') }).strict();

export function createAccountDataRouter(deps: Pick<RouteDeps, 'getAdminServices' | 'requireAccount'>) {
  const router = express.Router();
  router.post('/reset-data', deps.requireAccount, async (req, res) => {
    if (!confirmation.safeParse(req.body).success)
      return res.status(400).json({ error: 'reset_confirmation_required' });
    const uid: unknown = res.locals.userUid;
    if (typeof uid !== 'string' || !uid || uid.includes('/')) return res.sendStatus(401);
    try {
      const { adminDb } = deps.getAdminServices();
      const user = adminDb.collection('users').doc(uid);
      for (const name of collections) {
        // Bounded batches also make a partially failed reset safely retryable.
        for (;;) {
          const snapshot = await user.collection(name).limit(400).get();
          if (snapshot.empty) break;
          const batch = adminDb.batch();
          snapshot.docs.forEach((document) => batch.delete(document.ref));
          await batch.commit();
        }
      }
      return res.json({ ok: true });
    } catch {
      logger.error('Account data reset incomplete');
      return res
        .status(503)
        .json({ error: 'reset_incomplete', message: '초기화가 완료되지 않았습니다. 연결 후 다시 시도해 주세요.' });
    }
  });
  return router;
}
