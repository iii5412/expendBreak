import {
  BUDGET_AI_CONTRACT,
  FeedbackResult,
  classifyLocally,
  confidenceMode,
  hasSensitiveFinancialText,
  validateClassification,
  type BudgetAiCategory,
  type BudgetClassification,
  type BudgetFeedback,
  type BudgetFeedbackSummary,
  type BudgetMerchantRule,
} from '../lib/budgetAi';
import { calculateBudget } from '../lib/calculator';
import type { BudgetCalculationInput } from '../types/budget';

export interface BudgetAiUi {
  categories: BudgetAiCategory[];
  classify: (text: string, signal: AbortSignal) => Promise<BudgetClassification>;
  saveRule: (pattern: string, categoryId: string) => Promise<void>;
}
export type BudgetAiRequest = (path: string, body: unknown, signal: AbortSignal) => Promise<unknown>;

export function aiRequest(fetcher: typeof fetch): BudgetAiRequest {
  return async (path, body, signal) => {
    const response = await fetcher(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value?.message === 'string'
          ? value.message
          : 'AI 요청을 처리하지 못했습니다. 수동 입력을 이용해 주세요.',
      );
    return value;
  };
}

export async function withAiDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal,
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  outer?.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout>;
  try {
    outer?.throwIfAborted();
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        const rejectOnAbort = () => reject(new Error('AI 요청을 멈췄습니다. 수동 입력을 이용해 주세요.'));
        controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
        timer = setTimeout(() => {
          reject(new Error('5초 안에 응답하지 않아 수동 입력으로 전환했습니다.'));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
    outer?.removeEventListener('abort', cancel);
  }
}

export async function classifyBudgetText(
  text: string,
  categories: BudgetAiCategory[],
  rules: BudgetMerchantRule[],
  today: string,
  enabled: boolean,
  request: BudgetAiRequest | undefined,
  signal: AbortSignal,
) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 500) throw new Error('500자 이내로 금액과 사용처를 입력해 주세요.');
  if (hasSensitiveFinancialText(trimmed)) throw new Error('계좌번호·발신번호·문자 원문을 제외하고 직접 입력해 주세요.');
  const local = classifyLocally(trimmed, categories, rules, today);
  if (local) return local;
  if (!enabled) throw new Error('AI 분류가 꺼져 있습니다. 금액과 카테고리를 직접 입력해 주세요.');
  if (!request) throw new Error('로컬 체험에서는 규칙·사전 분류만 지원합니다. 금액과 카테고리를 직접 입력해 주세요.');
  return withAiDeadline(
    async (boundedSignal) =>
      validateClassification(
        await request(
          '/api/ai/classify',
          { contract: BUDGET_AI_CONTRACT, text: trimmed, categories, merchantRules: rules, defaultDate: today },
          boundedSignal,
        ),
        categories,
      ),
    signal,
  );
}

export function buildFeedbackSummary(
  input: BudgetCalculationInput,
  categories: BudgetAiCategory[],
): BudgetFeedbackSummary {
  const result = calculateBudget(input);
  const grouped = new Map<string, { amount: number; count: number }>();
  for (const transaction of input.transactions) {
    if (
      transaction.type !== 'expense' ||
      transaction.budgetPeriodKey !== result.budgetPeriodKey ||
      transaction.localDate > input.today
    )
      continue;
    const key = transaction.categoryId || 'uncategorized';
    const previous = grouped.get(key) || { amount: 0, count: 0 };
    grouped.set(key, { amount: previous.amount + Math.floor(transaction.amount), count: previous.count + 1 });
  }
  return {
    budgetPeriodKey: result.budgetPeriodKey,
    variableExpenseLimit: result.variableExpenseLimit,
    spentVariable: result.actualVariableBeforeToday + result.actualVariableToday,
    fixedExpense: result.confirmedFixedExpense + result.pendingFixedExpense,
    pendingVariable: result.pendingVariableExpense,
    remainingToday: result.remainingToday,
    currentSafeBalance: result.currentSafeBalance,
    remainingDays: result.remainingDaysIncludingToday,
    dailyBurnRate: result.dailyBurnRate,
    projectedExpense: result.projectedPeriodEndExpense,
    categoryTotals: [...grouped]
      .map(([categoryId, value]) => ({
        categoryId,
        categoryName: categories.find((c) => c.id === categoryId)?.name || '기타',
        ...value,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 100),
  };
}

export async function requestFeedback(
  summary: BudgetFeedbackSummary,
  request: BudgetAiRequest | undefined,
  signal: AbortSignal,
): Promise<BudgetFeedback> {
  if (!request) throw new Error('로컬 체험에서는 외부 AI 분석을 호출하지 않습니다. 위의 계산 요약을 확인해 주세요.');
  return withAiDeadline(
    async (boundedSignal) =>
      FeedbackResult.parse(await request('/api/ai/feedback', { contract: BUDGET_AI_CONTRACT, summary }, boundedSignal)),
    signal,
  );
}

export { confidenceMode };
