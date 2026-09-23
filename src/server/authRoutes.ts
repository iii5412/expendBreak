import express from 'express';
import { classifyPinInput } from './authConfig';
import { checkPinAgainstSecret, type ConfiguredAccount } from './accounts';
import type { PinGuard } from './pinGuard';

type IssuedSession = { token: string; firebaseToken: string };

function verifyConfiguredPin(accounts: ConfiguredAccount[], pin: string): ConfiguredAccount | null {
  const matches = accounts.filter(account => checkPinAgainstSecret(pin, account.pinHash));
  return matches.length === 1 ? matches[0] : null;
}

export function createAuthRouter({
  accounts,
  guard,
  minPinLength,
  issueSession,
}: {
  accounts: ConfiguredAccount[];
  guard: PinGuard;
  minPinLength: number;
  issueSession: (account: ConfiguredAccount) => Promise<IssuedSession>;
}) {
  const router = express.Router();

  // Verifies the PIN and issues a session token.
  router.post('/verify-key', async (req, res) => {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    const pinInput = classifyPinInput(key, minPinLength);
    if ('error' in pinInput) return res.status(400).json({ error: pinInput.error });

    try {
      const gate = await guard.check(clientIp);
      if ('retryAfterMs' in gate) {
        return res.status(429).json({ isValid: false, retryAfterMs: gate.retryAfterMs });
      }

      const account = verifyConfiguredPin(accounts, key);
      if (!account) {
        const { retryAfterMs } = await guard.recordFailure(clientIp);
        return res.status(401).json({ isValid: false, retryAfterMs });
      }

      await guard.recordSuccess(clientIp);
      const { token, firebaseToken } = await issueSession(account);
      return res.json({
        isValid: true,
        token,
        firebaseToken,
        account: { uid: account.uid, name: account.name, isOwner: account.isOwner },
        pinUpgradeRequired: pinInput.upgradeRequired,
      });
    } catch (error) {
      console.error('PIN authentication error:', error instanceof Error ? error.message : error);
      return res.status(500).json({
        error: 'Authentication failed',
        message: 'PIN 인증 처리 중 오류가 발생했습니다.',
      });
    }
  });

  return router;
}
