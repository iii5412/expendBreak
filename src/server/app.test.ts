import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { setLogSink } from './lib/logger';
import { createSessionToken, sessionTtlMs } from './session';
import { listen } from './testServer';

const SECRET = 's'.repeat(48);
const env = {
  APP_SESSION_SECRET: SECRET,
  APP_ACCESS_KEY: '123456', // plain PIN is accepted outside production
  APP_URL: 'https://app.example.com',
};

interface FakeGemini {
  models: { generateContent: ReturnType<typeof vi.fn> };
}

let running: Awaited<ReturnType<typeof listen>> | null = null;
let restoreLog: (() => void) | null = null;

beforeEach(() => {
  restoreLog = setLogSink(() => undefined);
});
afterEach(async () => {
  restoreLog?.();
  await running?.close();
  running = null;
});

async function start({ gemini = null as FakeGemini | null, fetchImpl }: { gemini?: FakeGemini | null; fetchImpl?: typeof fetch } = {}) {
  const adminAuth = {
    createCustomToken: vi.fn(async (uid: string) => `firebase-${uid}`),
    revokeRefreshTokens: vi.fn(async () => undefined),
  };
  const { app } = createApp({
    env,
    deps: {
      getGeminiClient: () => gemini as never,
      getAdminServices: () => ({ adminAuth, adminDb: {} }) as never,
      fetchImpl,
    },
  });
  running = await listen(app);
  const url = running.url;

  const call = async (method: string, path: string, { token, body, headers = {} }: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const response = await fetch(url(path), {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON bodies are left as text.
    }
    return { status: response.status, json, text, headers: response.headers };
  };

  const login = async () => {
    const result = await call('POST', '/api/auth/verify-key', { body: { key: '123456', remember: true } });
    return result.json!.token as string;
  };
  return { call, login, adminAuth };
}

const geminiReturning = (text: string | undefined): FakeGemini => ({
  models: { generateContent: vi.fn(async () => ({ text })) },
});

const categories = [
  { id: 'food', name: '식비', type: 'expense', active: true },
  { id: 'etc_expense', name: '기타', type: 'expense', active: true },
];

describe('health and status', () => {
  it('answers /healthz without authentication and tags the response with a request id', async () => {
    const { call } = await start();
    const result = await call('GET', '/healthz');
    expect(result).toMatchObject({ status: 200, json: { ok: true } });
    expect(typeof result.json!.version).toBe('string');
    expect(result.headers.get('x-request-id')).toBeTruthy();
  });

  it('reports PIN setup without exposing it', async () => {
    const { call } = await start();
    expect((await call('GET', '/api/auth/status')).json).toEqual({ isPinConfigured: true, accountCount: 1 });
  });

  it('applies the CORS allowlist to preflight requests', async () => {
    const { call } = await start();
    const allowed = await call('OPTIONS', '/api/ai/classify', { headers: { Origin: 'https://app.example.com' } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect((await call('OPTIONS', '/api/ai/classify', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });
});

describe('authentication', () => {
  it('logs in with the PIN and issues sessions that open the AI routes', async () => {
    const { call, login } = await start({ gemini: geminiReturning(undefined) });
    const login1 = await call('POST', '/api/auth/verify-key', { body: { key: '123456' } });
    expect(login1.status).toBe(200);
    expect(login1.json).toMatchObject({ isValid: true, firebaseToken: 'firebase-owner', account: { uid: 'owner', isOwner: true } });

    const token = await login();
    const classify = await call('POST', '/api/ai/classify', { token, body: { text: '쿠팡 1000원' } });
    expect(classify.status).not.toBe(401);
  });

  it('rejects wrong and malformed PINs', async () => {
    const { call } = await start();
    expect((await call('POST', '/api/auth/verify-key', { body: { key: '999999' } })).status).toBe(401);
    expect((await call('POST', '/api/auth/verify-key', { body: { key: 'abcd' } })).status).toBe(400);
  });

  it('delays a client after repeated wrong PINs', async () => {
    const { call } = await start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await call('POST', '/api/auth/verify-key', { body: { key: '000000' } });
    }
    const blocked = await call('POST', '/api/auth/verify-key', { body: { key: '123456' } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.json!.retryAfterMs)).toBeGreaterThan(0);
  });

  it('protects AI routes: missing, forged, expired and revoked sessions are all 401', async () => {
    const { call, login } = await start();
    expect((await call('POST', '/api/ai/feedback', { body: {} })).json).toEqual({ error: 'session_missing' });
    expect((await call('POST', '/api/ai/feedback', { token: 'forged', body: {} })).json).toEqual({ error: 'session_invalid' });

    const expired = createSessionToken('owner', 0, { current: SECRET }, { ttlMs: sessionTtlMs(false), now: Date.now() - 13 * 60 * 60 * 1000 });
    expect((await call('POST', '/api/ai/feedback', { token: expired, body: {} })).json).toEqual({ error: 'session_expired' });

    const token = await login();
    const revoke = await call('POST', '/api/auth/revoke-others', { token, body: { remember: true } });
    expect(revoke.status).toBe(200);
    expect((await call('POST', '/api/ai/feedback', { token, body: {} })).json).toEqual({ error: 'session_revoked' });
    expect((await call('POST', '/api/ai/feedback', { token: revoke.json!.token as string, body: {} })).status).not.toBe(401);
  });
});

describe('migration and bank accounts', () => {
  it('reports a skipped migration when no Admin credentials exist, and needs a session', async () => {
    const { call, login } = await start();
    expect((await call('POST', '/api/migration/ensure')).status).toBe(401);
    const result = await call('POST', '/api/migration/ensure', { token: await login() });
    expect(result).toMatchObject({ status: 200, json: { ok: true, report: { skipped: true } } });
  });

  it('requires a session for account merges', async () => {
    const { call } = await start();
    expect((await call('POST', '/api/bank-accounts/merge', { body: {} })).status).toBe(401);
  });
});

describe('AI routes: input validation and failure handling', () => {
  it('classify rejects bad input with 400', async () => {
    const { call, login } = await start({ gemini: geminiReturning('{}') });
    const token = await login();
    expect((await call('POST', '/api/ai/classify', { token, body: {} })).json).toEqual({ error: 'Text prompt is required' });
    expect((await call('POST', '/api/ai/classify', { token, body: { text: 'x', categories: [] } })).json).toEqual({ error: 'Invalid classification context' });
  });

  it('classify answers from rules and says so when AI is off or fails', async () => {
    const withoutAi = await start();
    const token = await withoutAi.login();
    // No saved rule matches this text, so the instant path is skipped and AI would normally decide.
    const body = { text: '쿠팡 4500원', categories: [{ id: 'cafe', name: '카페', type: 'expense' }], merchantRules: [{ pattern: '스타벅스', categoryId: 'cafe' }] };
    const off = await withoutAi.call('POST', '/api/ai/classify', { token, body });
    expect(off.json).toMatchObject({ isFallback: true, merchant: '쿠팡', amount: 4500 });
    expect(String(off.json!.reason)).toContain('AI가 꺼져');
    await running!.close();
    running = null;

    const failing = await start({ gemini: { models: { generateContent: vi.fn(async () => { throw new Error('upstream'); }) } } });
    const failed = await failing.call('POST', '/api/ai/classify', { token: await failing.login(), body });
    expect(failed.json).toMatchObject({ isFallback: true });
    expect(String(failed.json!.reason)).toContain('연결에 실패');
  });

  it('classify uses a saved rule without calling the model', async () => {
    const gemini = geminiReturning('{}');
    const { call, login } = await start({ gemini });
    const result = await call('POST', '/api/ai/classify', {
      token: await login(),
      body: { text: '스타벅스 4500원', categories: [{ id: 'cafe', name: '카페', type: 'expense' }], merchantRules: [{ pattern: '스타벅스', categoryId: 'cafe' }] },
    });
    expect(result.json).toMatchObject({ suggestedCategoryId: 'cafe', amount: 4500, confidence: 0.98 });
    expect(gemini.models.generateContent).not.toHaveBeenCalled();
  });

  it('feedback: 400 for bad input, 503 without a key, 502 for an unusable model reply, 200 otherwise', async () => {
    const body = { monthSummary: { yearMonth: '2026-09' }, categoryBreakdown: [] };

    const off = await start();
    const offToken = await off.login();
    expect((await off.call('POST', '/api/ai/feedback', { token: offToken, body: {} })).status).toBe(400);
    expect((await off.call('POST', '/api/ai/feedback', { token: offToken, body })).json).toMatchObject({ error: 'ai_disabled' });
    await running!.close();

    const broken = await start({ gemini: geminiReturning('not json') });
    expect((await broken.call('POST', '/api/ai/feedback', { token: await broken.login(), body })).json).toMatchObject({ error: 'ai_feedback_failed' });
    await running!.close();

    const good = await start({ gemini: geminiReturning(JSON.stringify({ oneLiner: '결론', positivePoint: 'a', riskFactors: [], weeklyActions: [] })) });
    const ok = await good.call('POST', '/api/ai/feedback', { token: await good.login(), body });
    expect(ok).toMatchObject({ status: 200, json: { oneLiner: '결론' } });
  });

  it('category-recommend: 400, 503 and 502 instead of canned suggestions', async () => {
    const off = await start();
    const token = await off.login();
    expect((await off.call('POST', '/api/ai/category-recommend', { token, body: { description: '' } })).status).toBe(400);
    expect((await off.call('POST', '/api/ai/category-recommend', { token, body: { description: '학원' } })).json).toMatchObject({ error: 'ai_disabled' });
    await running!.close();

    const broken = await start({ gemini: geminiReturning('{"not":"a list"}') });
    expect((await broken.call('POST', '/api/ai/category-recommend', { token: await broken.login(), body: { description: '학원' } })).json)
      .toMatchObject({ error: 'ai_category_failed' });
  });

  it('receipt validates the image and categories before calling the model', async () => {
    const gemini = geminiReturning('{}');
    const { call, login } = await start({ gemini });
    const token = await login();
    expect((await call('POST', '/api/ai/receipt', { token, body: { imageBase64: 'AAAA', mimeType: 'text/plain', categories } })).status).toBe(400);
    expect((await call('POST', '/api/ai/receipt', { token, body: { imageBase64: '', mimeType: 'image/jpeg', categories } })).status).toBe(413);
    expect((await call('POST', '/api/ai/receipt', { token, body: { imageBase64: 'AAAA', mimeType: 'image/jpeg', categories: [] } })).status).toBe(400);
    expect(gemini.models.generateContent).not.toHaveBeenCalled();
  });

  it('receipt returns a sanitised result and redacts card numbers', async () => {
    const reply = JSON.stringify({
      merchant: '마트', amount: 12000, date: '2026-09-20', memo: '장보기', suggestedCategoryId: 'food', confidence: 0.9,
      reason: 'ok', needsConfirmation: false, cardLast4: '1234', rawText: '카드 1234-5678-9012-3456',
      lineItems: [{ name: '우유', amount: 3000, quantity: 1, unitPrice: 3000 }, { name: '', amount: 1 }],
    });
    const { call, login } = await start({ gemini: geminiReturning(reply) });
    const result = await call('POST', '/api/ai/receipt', { token: await login(), body: { imageBase64: 'AAAA', mimeType: 'image/jpeg', categories } });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ merchant: '마트', amount: 12000, suggestedCategoryId: 'food', needsConfirmation: true, cardLast4: '1234' });
    expect(result.json!.rawText).toBe('카드 ****-****-****-3456');
    expect(result.json!.lineItems).toHaveLength(1);
  });

  it('voice validates the recording before calling the model', async () => {
    const gemini = geminiReturning('{}');
    const { call, login } = await start({ gemini });
    const token = await login();
    const base = { audioBase64: 'AAAA', mimeType: 'audio/webm', categories };
    expect((await call('POST', '/api/ai/voice', { token, body: { ...base, audioBase64: '', durationMs: 1000 } })).status).toBe(400);
    expect((await call('POST', '/api/ai/voice', { token, body: { ...base, durationMs: 100 } })).status).toBe(400);
    expect((await call('POST', '/api/ai/voice', { token, body: { ...base, durationMs: 9000 } })).status).toBe(400);
    expect((await call('POST', '/api/ai/voice', { token, body: { ...base, durationMs: 1000, categories: [] } })).status).toBe(400);
    expect(gemini.models.generateContent).not.toHaveBeenCalled();
  });

  it('voice answers 422 when no model produces a result and 503 without a key', async () => {
    const off = await start();
    const body = { audioBase64: 'AAAA', mimeType: 'audio/webm', durationMs: 1000, categories };
    expect((await off.call('POST', '/api/ai/voice', { token: await off.login(), body })).status).toBe(503);
    await running!.close();

    const empty = await start({ gemini: geminiReturning(undefined) });
    expect((await empty.call('POST', '/api/ai/voice', { token: await empty.login(), body })).status).toBe(422);
  });

  it('finance chat checks provider and message, then answers', async () => {
    const { call, login } = await start({ gemini: geminiReturning('이번 달 지출은 10만원입니다.') });
    const token = await login();
    expect((await call('POST', '/api/ai/finance-chat', { token, body: { provider: 'x', message: 'hi' } })).status).toBe(400);
    const ok = await call('POST', '/api/ai/finance-chat', { token, body: { provider: 'gemini', message: '얼마 썼어?', context: { total: 100000 } } });
    expect(ok).toMatchObject({ status: 200, json: { answer: '이번 달 지출은 10만원입니다.', provider: 'gemini' } });
  });

  it('finance chat limits each account to 40 requests per 10 minutes', async () => {
    const { call, login } = await start({ gemini: geminiReturning('답변') });
    const token = await login();
    const ask = () => call('POST', '/api/ai/finance-chat', { token, body: { provider: 'gemini', message: 'q', context: {} } });
    for (let index = 0; index < 40; index += 1) expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
  });

  it('finance chat sends GPT requests through the injected fetch and passes upstream limits on', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 }));
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    try {
      const { call, login } = await start({ fetchImpl: fetchImpl as unknown as typeof fetch });
      const result = await call('POST', '/api/ai/finance-chat', { token: await login(), body: { provider: 'openai', message: 'q', context: {} } });
      expect(result.status).toBe(429);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('realtime session needs an OpenAI key and a WebRTC offer', async () => {
    const { call, login } = await start();
    const token = await login();
    delete process.env.OPENAI_API_KEY;
    expect((await call('POST', '/api/ai/realtime/session', { token })).status).toBe(503);
  });
});
