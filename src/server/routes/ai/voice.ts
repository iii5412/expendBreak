import express from 'express';
import { ThinkingLevel, Type } from '@google/genai';
import { shouldTriggerVoiceFallback, sanitizeVoiceResult } from '../../../utils/voice';
import { largeJsonBody } from '../../httpSecurity';
import { isCategoryInput, parseModelObject, type Loose, type LooseObject } from '../../lib/inputs';
import { logger } from '../../lib/logger';
import type { RouteDeps } from '../types';

export function createVoiceRouter(deps: RouteDeps) {
  const router = express.Router();

  // Authenticated voice input transaction analysis endpoint
  router.post('/voice', largeJsonBody, async (req, res) => {
    try {
      if (!deps.limiters.voice.consume(res.locals.ownerUid)) {
        return res.status(429).json({ message: '요청 제한을 초과했습니다. 잠시 후 다시 시도해주세요.' });
      }

      const {
        audioBase64,
        mimeType,
        durationMs,
        categories = [],
        merchantRules = [],
        bankAccounts = [],
        paymentCards = [],
        defaultDate,
        timezone,
      } = req.body || {};

      if (typeof audioBase64 !== 'string' || !audioBase64.trim()) {
        return res.status(400).json({ message: '음성 데이터가 필요합니다.' });
      }

      const audioBuffer = Buffer.from(audioBase64, 'base64');
      if (audioBuffer.length === 0) {
        return res.status(400).json({ message: '녹음된 음성이 없거나 올바르지 않습니다.' });
      }
      if (audioBuffer.length > 2 * 1024 * 1024) {
        return res.status(413).json({ message: '음성 파일 크기가 2MB를 초과했습니다.' });
      }

      const numDuration = Number(durationMs);
      if (!Number.isFinite(numDuration) || numDuration < 300) {
        return res.status(400).json({ message: '녹음된 음성이 없거나 너무 짧습니다.' });
      }
      if (numDuration > 8000) {
        return res.status(400).json({ message: '음성 녹음 시간은 최대 8초까지 지원됩니다.' });
      }

      if (!Array.isArray(categories) || categories.length === 0 || categories.length > 100) {
        return res.status(400).json({ message: '카테고리 정보가 올바르지 않습니다.' });
      }

      const ai = deps.getGeminiClient();
      if (!ai) {
        return res.status(503).json({ message: 'AI 기능이 비활성화되어 있습니다. GEMINI_API_KEY를 설정해주세요.' });
      }

      const voiceModel = process.env.GEMINI_VOICE_MODEL?.trim() || 'gemini-3.5-flash-lite';
      const voiceFallbackModel = process.env.GEMINI_VOICE_FALLBACK_MODEL?.trim() || 'gemini-3.6-flash';

      const safeCategories = categories.filter((category: Loose) =>
        typeof category?.id === 'string'
        && typeof category?.name === 'string'
        && (category?.type === 'income' || category?.type === 'expense'),
      );

      const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(String(defaultDate || ''))
        ? String(defaultDate)
        : new Date().toISOString().slice(0, 10);

      const catListStr = safeCategories
        .map((c: Loose) => `ID: "${c.id}", Name: "${c.name}", Type: "${c.type}"`)
        .join('\n');

      const rulesListStr = (merchantRules || [])
        .slice(0, 100)
        .map((r: Loose) => `Pattern: "${r.pattern}", CategoryId: "${r.categoryId}"`)
        .join('\n');

      // Never log full account or card numbers
      const safeCardsStr = (paymentCards || [])
        .slice(0, 30)
        .map((c: Loose) => `ID: "${c.id}", CardName: "${c.cardName}", Company: "${c.cardCompany}"`)
        .join('\n');

      const safeAccountsStr = (bankAccounts || [])
        .slice(0, 30)
        .map((a: Loose) => `ID: "${a.id}", Bank: "${a.bankName}", AccountName: "${a.accountName}"`)
        .join('\n');

      const prompt = `You are a precise Korean financial transaction voice analyzer.
Analyze the provided spoken Korean audio clip and return a structured JSON object.

Current Reference Date: "${todayStr}"
Current Timezone: "${timezone || 'Asia/Seoul'}"

Available Categories:
${catListStr}

Available Merchant Auto-Rules:
${rulesListStr || 'None'}

Available Payment Cards:
${safeCardsStr || 'None'}

Available Bank Accounts:
${safeAccountsStr || 'None'}

Instructions:
1. Recognize the exact spoken Korean words and set "transcript" to the accurate Korean sentence.
2. Determine "type": "income" or "expense".
3. Extract "amount": integer in KRW (Korean Won). Convert spoken number phrases accurately (e.g., "5만 2천 원" -> 52000, "2만 4천 9백 원" -> 24900, "350만 원" -> 3500000, "13,500원" -> 13500).
4. Parse relative date terms ("오늘", "어제", "지난 금요일" 등) relative to ${todayStr} in ${timezone || 'Asia/Seoul'}. Format "date" strictly as YYYY-MM-DD.
5. "merchant": The vendor, merchant, or payee name (e.g., "이마트", "배달의민족", "카카오택시").
6. "suggestedCategoryId": MUST select an ID from Available Categories matching the "type".
7. "paymentMethodType": "card", "account", "cash", or "other". If a card or bank is mentioned (e.g. "신한카드", "국민카드", "현금"), map paymentMethodType and if it matches an ID in Available Payment Cards or Available Bank Accounts, set "suggestedCardId" or "suggestedAccountId".
8. "tags": Extract up to 5 clean Korean tags without hashes (e.g. ["장보기", "외식"]).
9. "confidence": A float from 0.0 to 1.0 representing analysis confidence.
10. "multipleTransactionsDetected": Set to true if the audio contains MORE THAN ONE transaction sentence (e.g., "이마트에서 5만원 사고 커피 5천원 마셨어"). Otherwise false.
11. "reason": Brief Korean explanation of the analysis.`;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          transcript: { type: Type.STRING },
          type: { type: Type.STRING, description: 'income or expense' },
          amount: { type: Type.INTEGER, description: 'Amount in KRW integer' },
          date: { type: Type.STRING, description: 'YYYY-MM-DD' },
          merchant: { type: Type.STRING, description: 'Merchant or source' },
          memo: { type: Type.STRING, description: 'Memo or note' },
          suggestedCategoryId: { type: Type.STRING },
          paymentMethodType: { type: Type.STRING, description: 'card, account, cash, or other' },
          paymentMethodHint: { type: Type.STRING },
          suggestedAccountId: { type: Type.STRING },
          suggestedCardId: { type: Type.STRING },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.NUMBER },
          reason: { type: Type.STRING },
          multipleTransactionsDetected: { type: Type.BOOLEAN },
        },
        required: [
          'transcript',
          'type',
          'amount',
          'date',
          'merchant',
          'suggestedCategoryId',
          'confidence',
          'reason',
          'multipleTransactionsDetected',
        ],
      };

      let activeModel = voiceModel;
      let fallbackUsed = false;
      let parsedResult: LooseObject | null = null;

      // Call 1: Primary Model (gemini-3.5-flash-lite)
      try {
        const response1 = await ai.models.generateContent({
          model: activeModel,
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { data: audioBase64, mimeType: mimeType || 'audio/webm' } },
            ],
          }],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            maxOutputTokens: 512,
            responseMimeType: 'application/json',
            responseSchema,
          },
        });

        if (response1.text) {
          parsedResult = parseModelObject(response1.text.trim());
        }
      } catch {
        parsedResult = null;
      }

      // Check if fallback to gemini-3.6-flash is required
      const needsFallback = !parsedResult || shouldTriggerVoiceFallback(parsedResult);

      if (needsFallback) {
        fallbackUsed = true;
        activeModel = voiceFallbackModel;

        try {
          const response2 = await ai.models.generateContent({
            model: activeModel,
            contents: [{
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { data: audioBase64, mimeType: mimeType || 'audio/webm' } },
              ],
            }],
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              maxOutputTokens: 512,
              responseMimeType: 'application/json',
              responseSchema,
            },
          });

          if (response2.text) {
            parsedResult = parseModelObject(response2.text.trim());
          }
        } catch {
          // Model 2 failed
        }
      }

      if (!parsedResult) {
        return res.status(422).json({
          message: '음성 분석 결과가 불충분합니다. 직접 입력 화면을 이용해보세요.',
          fallbackFailed: true,
        });
      }

      const sanitized = sanitizeVoiceResult(
        parsedResult,
        safeCategories,
        todayStr,
        activeModel,
        fallbackUsed,
      );

      return res.json(sanitized);
    } catch (error) {
      logger.error('Voice AI analysis error:', error instanceof Error ? error.message : 'Unknown error');
      return res.status(500).json({ message: '음성 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
    }
  });

  return router;
}
