import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBudgetAiRouter } from './budgetAi';
import { createBudgetAiRuntime } from '../../lib/budgetAiRuntime';
import { listen } from '../../testServer';
import type { RouteDeps } from '../types';

const categories = [
  { id: 'delivery', name: '배달음식', type: 'expense' },
  { id: 'books', name: '도서', type: 'expense' },
];
const input = {
  contract: 'budget-v1',
  text: '동네서점 19,000원',
  defaultDate: '2026-10-19',
  categories,
  merchantRules: [],
};
const candidate = {
  type: 'expense',
  amount: 19000,
  date: '2026-10-19',
  merchant: '동네서점',
  memo: '책',
  suggestedCategoryId: 'books',
  confidence: 0.9,
  reason: '도서 구매',
  needsConfirmation: false,
};
const summary = {
  budgetPeriodKey: '2026-10',
  variableExpenseLimit: 600000,
  spentVariable: 100000,
  fixedExpense: 500000,
  pendingVariable: 20000,
  remainingToday: 24000,
  currentSafeBalance: 480000,
  remainingDays: 13,
  dailyBurnRate: 10000,
  projectedExpense: 700000,
  categoryTotals: [{ categoryId: 'delivery', categoryName: '배달음식', amount: 100000, count: 5 }],
};
const feedback = {
  oneLiner: '예산 안에서 소비하고 있어요.',
  positivePoint: '기록을 잘 유지했어요.',
  riskFactors: ['배달 횟수를 살펴보세요.'],
  weeklyActions: [{ action: '배달 한 번을 집밥으로 바꿔보세요.', savingsMin: 10000, savingsMax: 20000 }],
};
const servers: Array<Awaited<ReturnType<typeof listen>>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function start(output: unknown = candidate, quota = true, provider: 'on' | 'off' | 'broken' = 'on') {
  const generateContent = vi.fn(async (_request: { contents: string }) => ({ text: JSON.stringify(output) }));
  const consume = vi.fn(async () => quota);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (!req.headers['x-test-user']) return res.sendStatus(401);
    res.locals.userUid = req.headers['x-test-user'];
    next();
  });
  app.use(
    '/api/ai',
    createBudgetAiRouter(
      {
        getGeminiClient: () => {
          if (provider === 'broken') throw new Error('unavailable');
          return provider === 'off' ? null : { models: { generateContent } };
        },
      } as unknown as RouteDeps,
      createBudgetAiRuntime({ consume }),
    ),
  );
  const server = await listen(app);
  servers.push(server);
  const post = async (body: unknown = input, path = '/classify', uid = 'user-a') => {
    const response = await fetch(server.url(`/api/ai${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': uid },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { post, generateContent, consume };
}

describe('strict budget AI routes', () => {
  it('runs saved rules before keywords and skips all model/quota work', async () => {
    const { post, generateContent, consume } = await start();
    expect(
      (await post({ ...input, text: '배민 저녁 24,900원', merchantRules: [{ pattern: '배민', categoryId: 'books' }] }))
        .body,
    ).toMatchObject({ amount: 24900, suggestedCategoryId: 'books', source: 'merchant_rule', needsConfirmation: true });
    expect((await post({ ...input, text: '배민 저녁 24,900원' })).body.source).toBe('keyword');
    expect(generateContent).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });
  it('rejects raw context and sensitive text without contacting the provider', async () => {
    const { post, generateContent } = await start();
    expect((await post({ ...input, bankAccounts: [] })).status).toBe(400);
    expect((await post({ ...input, contract: 'unknown-version' })).status).toBe(400);
    expect((await post({ ...input, text: '[Web발신] 승인 19,000원' })).body.error).toBe('sensitive_input');
    expect((await post({ contract: 'budget-v1', summary: { ...summary, transactions: [] } }, '/feedback')).status).toBe(
      400,
    );
    expect(generateContent).not.toHaveBeenCalled();
  });
  it('returns a manual-entry response when the provider is off or fails during initialization', async () => {
    const off = await start(candidate, true, 'off');
    expect((await off.post()).status).toBe(503);
    expect(off.consume).not.toHaveBeenCalled();
    const broken = await start(candidate, true, 'broken');
    expect((await broken.post()).status).toBe(502);
    expect(broken.generateContent).not.toHaveBeenCalled();
  });
  it.each([
    { amount: 0 },
    { amount: 1.5 },
    { amount: '19000' },
    { suggestedCategoryId: 'missing' },
    { date: '2026-02-30' },
    { confidence: 1.1 },
    { type: 'income' },
  ])('rejects invalid AI output %j instead of coercing it', async (invalid) => {
    const { post } = await start({ ...candidate, ...invalid });
    expect((await post()).status).toBe(502);
  });
  it('keeps candidates review-only and caches them per account', async () => {
    const { post, generateContent, consume } = await start();
    expect((await post()).body).toMatchObject({ needsConfirmation: true, source: 'ai', amount: 19000 });
    await post();
    await post(input, '/classify', 'user-b');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenCalledTimes(2);
  });
  it('returns 429 when the shared daily quota is exhausted', async () => {
    const { post, generateContent } = await start(candidate, false);
    expect((await post()).body.error).toBe('ai_daily_limit');
    expect(generateContent).not.toHaveBeenCalled();
  });
  it('sends only strict aggregates and validates feedback limits and savings ranges', async () => {
    const { post, generateContent } = await start(feedback);
    expect((await post({ contract: 'budget-v1', summary }, '/feedback')).status).toBe(200);
    expect(JSON.parse(generateContent.mock.calls[0][0].contents)).toEqual({ contract: 'budget-v1', summary });
    const broken = await start({ ...feedback, riskFactors: ['a', 'b', 'c'] });
    expect((await broken.post({ contract: 'budget-v1', summary }, '/feedback')).status).toBe(502);
    const unsupported = await start({
      ...feedback,
      weeklyActions: [{ action: '절약', savingsMin: 0, savingsMax: 999999 }],
    });
    expect((await unsupported.post({ contract: 'budget-v1', summary }, '/feedback')).status).toBe(502);
  });
});
