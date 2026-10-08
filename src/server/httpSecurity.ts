import express, { type Express, type RequestHandler } from 'express';
import type { ServerEnv } from './authConfig';

/** Only these authenticated routes carry base64 images or audio. */
export const LARGE_BODY_PATHS = ['/api/ai/receipt', '/api/ai/voice'];
export const MEDIUM_BODY_PATHS = ['/api/ai/finance-chat', '/api/ai/card-statement/parse'];

const DEFAULT_JSON_LIMIT = '100kb';
const MEDIUM_JSON_LIMIT = '1mb';
const LARGE_JSON_LIMIT = '12mb';

// Report-only until the Firebase and realtime voice origins are confirmed in production logs.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://firebasestorage.googleapis.com",
  "media-src 'self' blob:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasestorage.app",
  'frame-src https://*.firebaseapp.com',
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function resolveTrustProxyHops(env: ServerEnv): number {
  const value = Number(env.TRUST_PROXY_HOPS?.trim() || 1);
  return Number.isInteger(value) && value >= 0 ? value : 1;
}

/** A JSON parser that answers an oversized body with a JSON 413 instead of Express's HTML page. */
function jsonParser(limit: string): RequestHandler {
  const parse = express.json({ limit });
  return (req, res, next) => parse(req, res, error => {
    if ((error as { type?: string } | undefined)?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large', message: '요청 데이터가 너무 큽니다.' });
    }
    return next(error);
  });
}

export const largeJsonBody = jsonParser(LARGE_JSON_LIMIT);

export function applySecurityBaseline(app: Express, { production, trustProxyHops }: { production: boolean; trustProxyHops: number }) {
  app.disable('x-powered-by');
  // Behind Cloud Run the socket address is the proxy; the client is the last X-Forwarded-For hop.
  app.set('trust proxy', trustProxyHops);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (production) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      res.setHeader('Content-Security-Policy-Report-Only', CONTENT_SECURITY_POLICY);
    }
    next();
  });

  const defaultJsonBody = jsonParser(DEFAULT_JSON_LIMIT);
  const mediumJsonBody = jsonParser(MEDIUM_JSON_LIMIT);
  app.use((req, res, next) => {
    if (LARGE_BODY_PATHS.includes(req.path)) return next();
    if (MEDIUM_BODY_PATHS.includes(req.path)) return mediumJsonBody(req, res, next);
    return defaultJsonBody(req, res, next);
  });
}
