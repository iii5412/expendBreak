import type express from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { GeminiClient } from '../lib/gemini';
import type { AiLimiters } from '../lib/rateLimiter';

/**
 * Everything a route needs from the outside world. `createApp` builds the real
 * ones; tests pass fakes, so no route touches Firebase, Gemini or OpenAI directly.
 */
export interface RouteDeps {
  getGeminiClient(): GeminiClient | null;
  getAdminServices(): { adminDb: Firestore; adminAuth: Auth };
  fetchImpl: typeof fetch;
  sessionSecret: string;
  requireAccount: express.RequestHandler;
  limiters: AiLimiters;
}
