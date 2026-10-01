import express from 'express';
import { AccountMergeError, mergeBankAccountRecords } from '../accountMerge';
import { logger } from '../lib/logger';
import type { RouteDeps } from './types';

export function createBankAccountsRouter(deps: RouteDeps) {
  const router = express.Router();

  router.post('/merge', deps.requireAccount, async (req, res) => {
    try {
      const { sourceId, targetId } = req.body || {};
      const { adminDb } = deps.getAdminServices();
      const result = await mergeBankAccountRecords(adminDb, res.locals.userUid, sourceId, targetId);
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof AccountMergeError) return res.status(error.status).json({ message: error.message });
      logger.error('Account merge failed:', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: '계좌 일괄 변경 결과를 확인하지 못했습니다. 연결을 확인하고 같은 계좌로 다시 시도해 주세요.' });
    }
  });

  return router;
}
