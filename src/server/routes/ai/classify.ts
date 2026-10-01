import express from 'express';
import { ThinkingLevel, Type } from '@google/genai';
import { extractExplicitKrwAmount, needsAiDateResolution } from '../../../utils/aiClassify';
import {
  isCategoryInput,
  isMerchantRuleInput,
  parseModelObject,
  type BankAccountInput,
  type Loose,
  type PaymentCardInput,
} from '../../lib/inputs';
import { logger } from '../../lib/logger';
import type { RouteDeps } from '../types';

// Local heuristic keyword matcher as instant fallback or pre-processor
function fallbackClassify(text: string, rawCategories: Loose[], rawMerchantRules: Loose[], defaultDate: string) {
  // This also runs after a failure with the raw request body, so it re-checks the shapes it reads.
  const categories = rawCategories.filter(isCategoryInput);
  const merchantRules = rawMerchantRules.filter(isMerchantRuleInput);
  const textLower = text.toLowerCase().trim();
  const amount = extractExplicitKrwAmount(text);

  // Check merchant rules
  let suggestedCategoryId = 'etc_expense';
  let merchant = '';
  const memo = text;
  let type: 'income' | 'expense' = 'expense';

  if (text.includes('월급') || text.includes('급여') || text.includes('들어옴') || text.includes('수입')) {
    type = 'income';
    suggestedCategoryId = 'salary';
  }

  for (const rule of merchantRules) {
    const ruleCategory = categories.find(category => category.id === rule.categoryId);
    if (rule.pattern && textLower.includes(rule.pattern.toLowerCase()) && ruleCategory?.type === type) {
      suggestedCategoryId = rule.categoryId;
      merchant = rule.pattern;
      break;
    }
  }

  if (!merchant) {
    const tokens = text.split(/\s+/);
    merchant = tokens[0] || '기타 사용처';
  }

  return {
    type,
    amount,
    date: defaultDate,
    merchant,
    memo: text,
    suggestedCategoryId,
    suggestedNewCategoryName: null,
    confidence: merchantRules.some(rule => {
      const category = categories.find(candidate => candidate.id === rule.categoryId);
      return category?.type === type && rule.pattern && textLower.includes(rule.pattern.toLowerCase());
    }) ? 0.95 : 0.65,
    reason: '규칙 및 키워드 기반 분류',
    needsConfirmation: true,
  };
}

export function createClassifyRouter(deps: RouteDeps) {
  const router = express.Router();

  // Endpoint 1: Natural Language Transaction Classifier
  router.post('/classify', async (req, res) => {
    try {
      const {
        text,
        categories = [],
        merchantRules = [],
        bankAccounts = [],
        paymentCards = [],
        defaultDate,
      } = req.body;
      if (!text || typeof text !== 'string' || text.trim().length > 500) {
        return res.status(400).json({ error: 'Text prompt is required' });
      }
      if (
        !Array.isArray(categories)
        || categories.length === 0
        || categories.length > 100
        || !Array.isArray(merchantRules)
        || merchantRules.length > 200
        || !Array.isArray(bankAccounts)
        || bankAccounts.length > 30
        || !Array.isArray(paymentCards)
        || paymentCards.length > 30
      ) {
        return res.status(400).json({ error: 'Invalid classification context' });
      }

      const safeCategories = (categories as Loose[]).filter(isCategoryInput);
      const safeMerchantRules = (merchantRules as Loose[]).filter(isMerchantRuleInput)
        .filter(rule => rule.pattern.length <= 100);
      const safeBankAccounts = (bankAccounts as Loose[]).filter((account): account is BankAccountInput =>
        typeof account?.id === 'string'
        && typeof account?.bankName === 'string'
        && typeof account?.accountName === 'string'
        && account.id.length <= 100
        && account.bankName.length <= 100
        && account.accountName.length <= 100,
      );
      const safePaymentCards = (paymentCards as Loose[]).filter((card): card is PaymentCardInput =>
        typeof card?.id === 'string'
        && typeof card?.cardName === 'string'
        && typeof card?.cardCompany === 'string'
        && card.id.length <= 100
        && card.cardName.length <= 100
        && card.cardCompany.length <= 100,
      );

      const todayStr = defaultDate || new Date().toISOString().split('T')[0];

      // First check exact merchant rules
      const textLower = text.toLowerCase();
      const matchedRule = safeMerchantRules.find(r => r.pattern && textLower.includes(r.pattern.toLowerCase()));

      // Repeated merchants with an explicit amount are deterministic. Returning
      // them before creating a Gemini client makes the common path effectively
      // instant while relative dates and unknown merchants retain AI handling.
      if (matchedRule && !needsAiDateResolution(text)) {
        const matchedCategory = safeCategories.find(category => category.id === matchedRule.categoryId);
        const explicitAmount = extractExplicitKrwAmount(text);
        if (matchedCategory && explicitAmount > 0) {
          return res.json({
            type: matchedCategory.type,
            amount: explicitAmount,
            date: todayStr,
            merchant: matchedRule.pattern,
            memo: text,
            suggestedCategoryId: matchedRule.categoryId,
            suggestedNewCategoryName: null,
            confidence: 0.98,
            reason: '저장된 사용처 규칙으로 즉시 분류',
            needsConfirmation: true,
          });
        }
      }

      const ai = deps.getGeminiClient();
      if (!ai) {
        // Fallback response if API key not present
        const fallback = fallbackClassify(text, safeCategories, safeMerchantRules, todayStr);
        return res.json({ ...fallback, reason: 'AI가 꺼져 있어 규칙·키워드로만 추정했습니다. 내용을 확인해 주세요.', isFallback: true });
      }

      const catListStr = safeCategories
        .map(c => `${c.id}|${c.name}|${c.type}`)
        .join('\n');
      const accountListStr = safeBankAccounts
        .map(account => `${account.id}|${account.bankName}|${account.accountName}`)
        .join('\n');
      const cardListStr = safePaymentCards
        .map(card => `${card.id}|${card.cardCompany}|${card.cardName}`)
        .join('\n');

      const prompt = `Analyze this Korean transaction text and return a JSON object with classification details:
Transaction Text: "${text}"
Current Date: "${todayStr}"

Available Categories:
${catListStr}

Available Bank Accounts (ID|bank|registered alias):
${accountListStr || 'None'}

Available Payment Cards (ID|company|registered name):
${cardListStr || 'None'}

Rules:
1. "amount" MUST be an integer representing KRW (e.g. 24,900 -> 24900, 18만원 -> 180000). If no amount is found or ambiguous, set amount to 0.
2. "type" MUST be "income" or "expense".
3. "suggestedCategoryId" MUST be selected from the available category IDs listed above that best matches the merchant/memo.
4. "confidence" MUST be a float between 0.0 and 1.0.
5. Do NOT invent new category IDs. If no existing category fits well, suggest a short name in "suggestedNewCategoryName", but put the closest existing category ID in "suggestedCategoryId".
6. Set "paymentMethodType" to "account", "card", "cash", or "other". Match a mentioned registered alias to its exact ID. Treat Korean "계좌" and "통장", and "급여" and "월급", as equivalent alias words.
7. "tags" contains up to 5 short Korean purchase-detail tags. Exclude the merchant, category, amount, payment source, and generic verbs. Example: "36000원 쿠팡 아이신발 구매 급여계좌" -> ["아이신발"].`;

      const response = await ai.models.generateContent({
        model: process.env.GEMINI_CLASSIFY_MODEL?.trim() || 'gemini-3.5-flash-lite',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, description: 'income or expense' },
              amount: { type: Type.INTEGER, description: 'Amount in KRW integer' },
              date: { type: Type.STRING, description: 'YYYY-MM-DD' },
              merchant: { type: Type.STRING, description: 'Merchant or source name' },
              memo: { type: Type.STRING, description: 'Brief note or description' },
              suggestedCategoryId: { type: Type.STRING, description: 'Existing category ID' },
              suggestedNewCategoryName: { type: Type.STRING, description: 'Optional new category name' },
              paymentMethodType: { type: Type.STRING, description: 'account, card, cash, or other' },
              suggestedAccountId: { type: Type.STRING, description: 'Existing bank account ID when matched' },
              suggestedCardId: { type: Type.STRING, description: 'Existing payment card ID when matched' },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              confidence: { type: Type.NUMBER, description: 'Confidence score from 0.0 to 1.0' },
              reason: { type: Type.STRING, description: 'Brief Korean explanation' },
              needsConfirmation: { type: Type.BOOLEAN },
            },
            required: ['type', 'amount', 'date', 'merchant', 'suggestedCategoryId', 'confidence', 'reason'],
          },
        },
      });

      if (!response.text) {
        throw new Error('Empty AI response');
      }

      const result = parseModelObject(response.text.trim());

      result.type = result.type === 'income' ? 'income' : 'expense';
      result.amount = Number.isFinite(Number(result.amount)) ? Math.max(0, Math.min(1_000_000_000_000, Math.round(Number(result.amount)))) : 0;
      result.confidence = Number.isFinite(Number(result.confidence)) ? Math.max(0, Math.min(1, Number(result.confidence))) : 0;
      result.date = /^\d{4}-\d{2}-\d{2}$/.test(String(result.date || '')) ? result.date : todayStr;
      result.merchant = String(result.merchant || '').slice(0, 120);
      result.memo = String(result.memo || '').slice(0, 500);
      result.paymentMethodType = typeof result.paymentMethodType === 'string' && ['account', 'card', 'cash', 'other'].includes(result.paymentMethodType)
        ? result.paymentMethodType
        : undefined;
      result.suggestedAccountId = safeBankAccounts.some(account => account.id === result.suggestedAccountId)
        ? result.suggestedAccountId
        : null;
      result.suggestedCardId = safePaymentCards.some(card => card.id === result.suggestedCardId)
        ? result.suggestedCardId
        : null;
      result.tags = Array.isArray(result.tags)
        ? result.tags.map((tag: unknown) => String(tag || '').replace(/^#/, '').trim()).filter(Boolean).slice(0, 5)
        : [];

      let forcedReview = false;
      const selectedCategory = safeCategories.find(category => category.id === result.suggestedCategoryId);
      if (!selectedCategory || selectedCategory.type !== result.type) {
        result.suggestedCategoryId = safeCategories.find(category =>
          category.id === (result.type === 'expense' ? 'etc_expense' : 'etc_income'),
        )?.id || safeCategories.find(category => category.type === result.type)?.id || '';
        forcedReview = true;
      }

      // Validation
      if (matchedRule) {
        const ruleCategory = safeCategories.find(category => category.id === matchedRule.categoryId);
        if (ruleCategory?.type === result.type) {
          result.suggestedCategoryId = matchedRule.categoryId;
          result.confidence = 0.95;
        }
      }

      if (!result.date) result.date = todayStr;
      // Both were normalised to numbers above.
      result.needsConfirmation = forcedReview || Number(result.confidence) < 0.8 || Number(result.amount) <= 0;

      return res.json(result);
    } catch (error) {
      logger.error('AI Classification Error:', error);
      const fallback = fallbackClassify(req.body.text || '', req.body.categories || [], req.body.merchantRules || [], req.body.defaultDate || new Date().toISOString().split('T')[0]);
      return res.json({ ...fallback, reason: 'AI 연결에 실패해 규칙·키워드로만 추정했습니다. 내용을 확인해 주세요.', isFallback: true });
    }
  });

  return router;
}
