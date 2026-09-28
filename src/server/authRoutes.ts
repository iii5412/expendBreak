import express from 'express';
import { classifyPinInput } from './authConfig';
import { checkPinAgainstSecret, type ConfiguredAccount } from './accounts';
import type { PinGuard } from './pinGuard';

type IssuedSession = { token: string; firebaseToken: string };
type IssueSession = (account: ConfiguredAccount, options: { remember: boolean }) => Promise<IssuedSession>;

function verifyConfiguredPin(accounts: ConfiguredAccount[], pin: string): ConfiguredAccount | null {
  const matches = accounts.filter(account => checkPinAgainstSecret(pin, account.pinHash));
  return matches.length === 1 ? matches[0] : null;
}

export function createAuthRouter({
  accounts,
  guard,
  minPinLength,
  issueSession,
  requireAccount,
  revokeSessions,
}: {
  accounts: ConfiguredAccount[];
  guard: PinGuard;
  minPinLength: number;
  issueSession: IssueSession;
  requireAccount: express.RequestHandler;
  /** Raises the account's session epoch and revokes its Firebase refresh tokens. */
  revokeSessions: (uid: string) => Promise<void>;
}) {
  const router = express.Router();

  // Verifies the PIN and issues a session token.
  router.post('/verify-key', async (req, res) => {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const remember = req.body?.remember === true;
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
      const { token, firebaseToken } = await issueSession(account, { remember });
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

  // Signs out every other device: older tokens fail with session_revoked, and
  // the Firebase refresh tokens stop working once their ID token (<= 1h) expires.
  // Revocation also covers this device, so it receives a fresh session.
  router.post('/revoke-others', requireAccount, async (req, res) => {
    const account = accounts.find(candidate => candidate.uid === res.locals.userUid);
    if (!account) return res.status(403).json({ error: 'account_unknown' });
    try {
      await revokeSessions(account.uid);
      const { token, firebaseToken } = await issueSession(account, { remember: req.body?.remember === true });
      return res.json({ token, firebaseToken });
    } catch (error) {
      console.error('Session revocation failed:', error instanceof Error ? error.message : error);
      return res.status(500).json({
        error: 'Revocation failed',
        message: '다른 기기 로그아웃을 처리하지 못했습니다. 다시 로그인한 뒤 시도해 주세요.',
      });
    }
  });

  return router;
}
