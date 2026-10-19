import { z } from 'zod';
import { extractExplicitKrwAmount, needsAiDateResolution } from '../utils/aiClassify';

export const BUDGET_AI_CONTRACT = 'budget-v1';
export const BudgetAiCategory = z
  .object({ id: z.string().min(1).max(100), name: z.string().min(1).max(60), type: z.enum(['income', 'expense']) })
  .strict();
export type BudgetAiCategory = z.infer<typeof BudgetAiCategory>;
export const BudgetMerchantRule = z
  .object({ pattern: z.string().min(1).max(80), categoryId: z.string().min(1).max(100) })
  .strict();
export type BudgetMerchantRule = z.infer<typeof BudgetMerchantRule>;
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
  });

/** Never forward notification bodies, phone numbers or account-number-like sequences. */
export function hasSensitiveFinancialText(text: string): boolean {
  if (
    /계좌\s*번호|발신\s*번호|승인\s*번호|\[(?:web|국제|외부)\s*발신\]|잔액\s*[\d,]+\s*원|카드\s*승인|입출금\s*알림/i.test(
      text,
    )
  )
    return true;
  if (/(?:\+82[ -]?)?0?1[016789][ -]?\d{3,4}[ -]?\d{4}/.test(text)) return true;
  const withoutDates = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
  if (/\d{2,6}[ -]\d{2,6}[ -]\d{2,8}/.test(withoutDates)) return true;
  for (const match of text.matchAll(/\d{7,}/g)) {
    const tail = text.slice(match.index + match[0].length);
    if (match[0].length > 12 || !/^\s*원/.test(tail)) return true;
  }
  return false;
}

export const ClassificationRequest = z
  .object({
    contract: z.literal(BUDGET_AI_CONTRACT),
    text: z.string().trim().min(1).max(500),
    defaultDate: calendarDate,
    categories: z.array(BudgetAiCategory).min(1).max(100),
    merchantRules: z.array(BudgetMerchantRule).max(200),
  })
  .strict();

export const ClassificationResult = z
  .object({
    type: z.enum(['income', 'expense']),
    amount: z.number().int().min(1).max(999_999_999),
    date: calendarDate,
    merchant: z.string().trim().min(1).max(120),
    memo: z.string().max(500),
    suggestedCategoryId: z.string().min(1).max(100),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(300),
    needsConfirmation: z.boolean(),
    source: z.enum(['merchant_rule', 'keyword', 'ai']).optional(),
  })
  .strict();
export type BudgetClassification = z.infer<typeof ClassificationResult>;

export function validateClassification(value: unknown, categories: BudgetAiCategory[]): BudgetClassification {
  const result = ClassificationResult.parse(value);
  if (!categories.some((category) => category.id === result.suggestedCategoryId && category.type === result.type))
    throw new Error('카테고리를 확인해 주세요.');
  if (
    hasSensitiveFinancialText(result.merchant) ||
    hasSensitiveFinancialText(result.memo) ||
    hasSensitiveFinancialText(result.reason)
  )
    throw new Error('민감한 내용이 포함된 결과입니다.');
  return { ...result, needsConfirmation: true };
}

export function confidenceMode(confidence: number): 'confirm' | 'choose' | 'question' {
  return confidence >= 0.8 ? 'confirm' : confidence >= 0.55 ? 'choose' : 'question';
}

/** No provider call is needed for a known merchant and an unambiguous amount/date. */
export function classifyLocally(
  text: string,
  categories: BudgetAiCategory[],
  rules: BudgetMerchantRule[],
  defaultDate: string,
): BudgetClassification | null {
  if (hasSensitiveFinancialText(text) || needsAiDateResolution(text) || /\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const amount = extractExplicitKrwAmount(text);
  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 999_999_999 ||
    /\d[.,]\d+\s*원/.test(text.replace(/\d{1,3}(?:,\d{3})+/g, '1000'))
  )
    return null;
  if (/[-−]\s*\d/.test(text)) return null;
  if (/\d[\d.]*\s*(?:천|백|십)\s*만/.test(text)) return null;
  const amounts = [...text.matchAll(/\d[\d,.]*\s*(?:억|만|천|백|십)?\s*원/g)];
  if (amounts.length > 1) return null;
  const normalized = text.toLocaleLowerCase('ko-KR');
  const personal = rules
    .filter((rule) => rule.pattern.trim() && categories.some((category) => category.id === rule.categoryId))
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .find((rule) => normalized.includes(rule.pattern.toLocaleLowerCase('ko-KR')));
  const keywordGroups = [
    { words: ['배민', '배달의민족', '쿠팡이츠', '요기요'], category: ['배달'] },
    { words: ['카카오택시', '택시', '지하철', '버스'], category: ['교통', '택시'] },
    { words: ['편의점', '이마트', '마트', '쿠팡'], category: ['장보기'] },
    { words: ['스타벅스', '커피', '카페'], category: ['카페', '외식'] },
    { words: ['월급', '급여'], category: ['급여', '월급'], type: 'income' },
  ];
  let merchant = personal?.pattern;
  let category = categories.find((category) => category.id === personal?.categoryId);
  if (!category)
    for (const group of keywordGroups) {
      const keyword = group.words.find((word) => normalized.includes(word));
      const found = categories.find(
        (category) =>
          category.type === (group.type || 'expense') && group.category.some((name) => category.name.includes(name)),
      );
      if (keyword && found) {
        merchant = keyword;
        category = found;
        break;
      }
    }
  if (!category || !merchant) return null;
  return validateClassification(
    {
      type: category.type,
      amount,
      date: defaultDate,
      merchant,
      memo: text,
      suggestedCategoryId: category.id,
      confidence: personal ? 0.98 : 0.9,
      reason: personal ? '저장한 가맹점 규칙으로 분류했어요.' : '기본 가맹점 사전으로 분류했어요.',
      needsConfirmation: true,
      source: personal ? 'merchant_rule' : 'keyword',
    },
    categories,
  );
}

const nonnegativeKrw = z.number().int().min(0).max(1_000_000_000_000);
export const FeedbackSummary = z
  .object({
    budgetPeriodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    variableExpenseLimit: nonnegativeKrw,
    spentVariable: nonnegativeKrw,
    fixedExpense: nonnegativeKrw,
    pendingVariable: nonnegativeKrw,
    remainingToday: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
    currentSafeBalance: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
    remainingDays: z.number().int().min(1).max(100),
    dailyBurnRate: nonnegativeKrw.nullable(),
    projectedExpense: nonnegativeKrw.nullable(),
    categoryTotals: z
      .array(
        z
          .object({
            categoryId: z.string().min(1).max(100),
            categoryName: z.string().min(1).max(60),
            amount: nonnegativeKrw,
            count: z.number().int().min(0).max(1_000_000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type BudgetFeedbackSummary = z.infer<typeof FeedbackSummary>;
export const FeedbackRequest = z.object({ contract: z.literal(BUDGET_AI_CONTRACT), summary: FeedbackSummary }).strict();
export const FeedbackResult = z
  .object({
    oneLiner: z.string().trim().min(1).max(240),
    positivePoint: z.string().trim().min(1).max(240),
    riskFactors: z.array(z.string().trim().min(1).max(240)).max(2),
    weeklyActions: z
      .array(
        z
          .object({ action: z.string().trim().min(1).max(240), savingsMin: nonnegativeKrw, savingsMax: nonnegativeKrw })
          .strict()
          .refine((action) => action.savingsMax >= action.savingsMin),
      )
      .max(3),
  })
  .strict();
export type BudgetFeedback = z.infer<typeof FeedbackResult>;
