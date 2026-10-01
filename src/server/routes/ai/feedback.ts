import express from 'express';
import { Type } from '@google/genai';
import { logger } from '../../lib/logger';
import type { RouteDeps } from '../types';

export function createFeedbackRouter(deps: RouteDeps) {
  const router = express.Router();

  // Endpoint 3: Monthly AI Spend Feedback Report
  router.post('/feedback', async (req, res) => {
    try {
      const { monthSummary, categoryBreakdown } = req.body;
      if (!monthSummary || typeof monthSummary !== 'object' || !Array.isArray(categoryBreakdown) || categoryBreakdown.length > 100) {
        return res.status(400).json({ error: 'Invalid feedback request' });
      }
      const ai = deps.getGeminiClient();

      if (!ai) return res.status(503).json({ error: 'ai_disabled', message: 'AI 분석을 사용하려면 GEMINI_API_KEY를 설정해야 합니다.' });

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
- Available-budget usage: ${monthSummary.budgetUsagePercent == null ? "unavailable: no spending capacity" : `${monthSummary.budgetUsagePercent}%`}
- Configured-limit usage: ${monthSummary.configuredLimitUsagePercent ?? "not set"}
- Spending period status: ${monthSummary.spendPeriodStatus ?? "unknown"} (do not forecast a closed month)
- Alert Level: ${monthSummary.alertLevel}
- Top Spending Category Breakdown: ${JSON.stringify(categoryBreakdown?.slice(0, 5) || [])}

Provide empathetic, actionable, non-shaming financial feedback strictly in Korean in JSON format.
Rules:
1. "oneLiner": 1 sharp diagnostic sentence.
2. "positivePoint": 1 praised item or habit.
3. "riskFactors": array of up to 2 danger factors.
4. "weeklyActions": array of up to 3 concrete actions with realistic estimated KRW savings ranges strictly supported by the numbers.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: summaryPrompt,
        config: {
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

      if (!response.text) throw new Error('Empty AI response');
      const feedback = JSON.parse(response.text.trim());
      if (typeof feedback?.oneLiner !== 'string' || !feedback.oneLiner.trim()) throw new Error('AI feedback had no conclusion');
      return res.json(feedback);
    } catch (error) {
      logger.error('Feedback AI error:', error instanceof Error ? error.message : error);
      return res.status(502).json({ error: 'ai_feedback_failed', message: 'AI 분석을 불러오지 못했습니다.' });
    }
  });

  return router;
}
