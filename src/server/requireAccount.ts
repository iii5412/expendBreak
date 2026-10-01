import type express from 'express';
import { setRequestUid } from './lib/logger';
import { verifySessionToken } from './session';
import type { SessionEpochs } from './sessionEpochs';

/** Error codes the client treats as "ask for the PIN again". */
export type SessionErrorCode = 'session_missing' | 'session_invalid' | 'session_expired' | 'session_revoked';

/**
 * Every session problem answers 401 so the client shows the lock screen; only a
 * valid token for an account that is no longer configured answers 403.
 */
export function createRequireAccount({
  secrets,
  accountUids,
  epochs,
  now = Date.now,
}: {
  secrets: { current: string; previous?: string };
  accountUids: ReadonlySet<string>;
  epochs: SessionEpochs;
  now?: () => number;
}): express.RequestHandler {
  const unauthorized = (res: express.Response, error: SessionErrorCode) => res.status(401).json({ error });

  return async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return unauthorized(res, 'session_missing');

    const session = verifySessionToken(token, secrets, now());
    if ('reason' in session) return unauthorized(res, session.reason === 'expired' ? 'session_expired' : 'session_invalid');
    if (!accountUids.has(session.uid)) return res.status(403).json({ error: 'account_unknown' });

    let currentEpoch: number;
    try {
      currentEpoch = await epochs.current(session.uid);
    } catch (error) {
      console.error('Session epoch lookup failed:', error instanceof Error ? error.message : error);
      return res.status(503).json({ error: 'session_check_unavailable', message: '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
    if (session.epoch < currentEpoch) return unauthorized(res, 'session_revoked');

    res.locals.userUid = session.uid;
    setRequestUid(session.uid);
    res.locals.ownerUid = session.uid;
    res.locals.sessionEpoch = session.epoch;
    return next();
  };
}
