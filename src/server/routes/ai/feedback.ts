import express from 'express';
import { Type } from '@google/genai';
import { logger } from '../../lib/logger';
import type { RouteDeps } from '../types';
import { BudgetAiLimitError, type BudgetAiRuntime } from '../../lib/budgetAiRuntime';
import { hasSensitiveFinancialText } from '../../../lib/budgetAi';

export function createFeedbackRouter(deps: RouteDeps, runtime?: BudgetAiRuntime) {
  const router = express.Router();

  // Endpoint 3: Monthly AI Spend Feedback Report
  router.post('/feedback', async (req, res) => {
    try {
      const { monthSummary: rawSummary, categoryBreakdown } = req.body;
      let monthSummary = rawSummary;
      if (
        !monthSummary ||
        typeof monthSummary !== 'object' ||
        !Array.isArray(categoryBreakdown) ||
        categoryBreakdown.length > 100
      ) {
        return res.status(400).json({ error: 'Invalid feedback request' });
      }
      // Keep the legacy request shape, but only whitelist aggregate numbers.
      const fields = [
        'planningIncome',
        'accountFixedOutflow',
        'cardSettlementOutflow',
        'savingsReserve',
        'livingBudget',
        'confirmedVariableExpenses',
        'remainingLivingBudget',
        'allowanceLimit',
        'plannedSavings',
        'dailySafeAllowance',
        'budgetUsagePercent',
        'configuredLimitUsagePercent',
      ];
      monthSummary = {
        ...Object.fromEntries(
          fields.map((field) => [
            field,
            typeof rawSummary[field] === 'number' && Number.isFinite(rawSummary[field]) ? rawSummary[field] : 0,
          ]),
        ),
        yearMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(rawSummary.yearMonth) ? rawSummary.yearMonth : '',
        isProjected: rawSummary.isProjected === true,
        spendPeriodStatus: ['upcoming', 'active', 'closed'].includes(rawSummary.spendPeriodStatus)
          ? rawSummary.spendPeriodStatus
          : 'unknown',
        alertLevel: ['safe', 'caution', 'warning', 'danger'].includes(rawSummary.alertLevel)
          ? rawSummary.alertLevel
          : 'unknown',
      };
      const safeBreakdown = categoryBreakdown
        .filter(
          (item) =>
            typeof item?.name === 'string' &&
            item.name.length <= 60 &&
            !hasSensitiveFinancialText(item.name) &&
            typeof item.value === 'number' &&
            Number.isFinite(item.value),
        )
        .map((item) => ({ name: item.name, value: item.value }));
      const ai = deps.getGeminiClient();

      if (!ai)
        return res
          .status(503)
          .json({ error: 'ai_disabled', message: 'AI 분석을 사용하려면 GEMINI_API_KEY를 설정해야 합니다.' });

      const summaryPrompt = `Analyze these deterministic financial stats for a Korean household app.
The app plans on a payday cycle with two separate tracks. Cash track: salary in,
account transfers and credit-card bills out, settled on payday. Spend track: what
the user actually spent this cycle. A card purchase belongs to the spend track of
the cycle it happened in; its bill belongs to the cash track of the cycle that pays
it. Never add the two together and never treat the card bill as new spending.
- Cycle: ${monthSummary.yearMonth}
- Income Used For Planning: ${monthSummary.planningIncome} KRW${monthSummary.isProjected ? ' (scheduled, not yet deposited)' : ' (deposited)'}
- Account Fixed Transfers: ${monthSummary.accountFixedOutflow} KRW
- Credit Card Bills Due This Cycle: ${monthSummary.cardSettlementOutflow} KRW (last cycle's purchases)
- Savings Reserve: ${monthSummary.savingsReserve} KRW
- Living Budget For This Cycle: ${monthSummary.livingBudget} KRW
- Spent So Far This Cycle: ${monthSummary.confirmedVariableExpenses} KRW
- Remaining Living Budget: ${monthSummary.remainingLivingBudget} KRW
- User-set Spending Cap (0 means none): ${monthSummary.allowanceLimit} KRW
- Planned Savings: ${monthSummary.plannedSavings} KRW
- Daily Safe Spend: ${monthSummary.dailySafeAllowance} KRW
- Available-budget usage: ${monthSummary.budgetUsagePercent == null ? 'unavailable: no spending capacity' : `${monthSummary.budgetUsagePercent}%`}
- Configured-limit usage: ${monthSummary.configuredLimitUsagePercent ?? 'not set'}
- Spending period status: ${monthSummary.spendPeriodStatus ?? 'unknown'} (do not forecast a closed month)
- Alert Level: ${monthSummary.alertLevel}
- Top Spending Category Breakdown: ${JSON.stringify(safeBreakdown.slice(0, 5))}

Provide empathetic, actionable, non-shaming financial feedback strictly in Korean in JSON format.
Rules:
1. "oneLiner": 1 sharp diagnostic sentence.
2. "positivePoint": 1 praised item or habit.
3. "riskFactors": array of up to 2 danger factors.
4. "weeklyActions": array of up to 3 concrete actions with realistic estimated KRW savings ranges strictly supported by the numbers.`;

      const generate = async (signal?: AbortSignal) => {
        const response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
          contents: summaryPrompt,
          config: {
            abortSignal: signal,
            httpOptions: { timeout: 4500 },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                oneLiner: { type: Type.STRING },
                positivePoint: { type: Type.STRING },
                riskFactors: { type: Type.ARRAY, items: { type: Type.STRING } },
                weeklyActions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      action: { type: Type.STRING },
                      estimatedSavings: { type: Type.STRING },
                    },
                    required: ['action', 'estimatedSavings'],
                  },
                },
              },
              required: ['oneLiner', 'positivePoint', 'riskFactors', 'weeklyActions'],
            },
          },
        });
        return { text: response.text };
      };
      const response = runtime
        ? await runtime.run(
            String(res.locals.userUid),
            'legacy-feedback',
            { monthSummary, categoryBreakdown: safeBreakdown },
            generate,
          )
        : await generate();

      if (!response.text) throw new Error('Empty AI response');
      const feedback = JSON.parse(response.text.trim());
      if (
        typeof feedback?.oneLiner !== 'string' ||
        !feedback.oneLiner.trim() ||
        typeof feedback.positivePoint !== 'string' ||
        !Array.isArray(feedback.riskFactors) ||
        feedback.riskFactors.length > 2 ||
        !feedback.riskFactors.every((item: unknown) => typeof item === 'string') ||
        !Array.isArray(feedback.weeklyActions) ||
        feedback.weeklyActions.length > 3 ||
        !feedback.weeklyActions.every(
          (item: { action?: unknown; estimatedSavings?: unknown }) =>
            typeof item?.action === 'string' && typeof item?.estimatedSavings === 'string',
        )
      )
        throw new Error('AI feedback did not match the schema');
      return res.json(feedback);
    } catch (error) {
      if (error instanceof BudgetAiLimitError)
        return res.status(429).json({ error: 'ai_daily_limit', message: error.message });
      logger.error('Feedback AI error');
      return res.status(502).json({ error: 'ai_feedback_failed', message: 'AI 분석을 불러오지 못했습니다.' });
    }
  });

  return router;
}
