import express from 'express';
import { Type } from '@google/genai';
import { largeJsonBody } from '../../httpSecurity';
import { isObject, parseModelObject, type Loose } from '../../lib/inputs';
import { logger } from '../../lib/logger';
import type { RouteDeps } from '../types';

function safeOcrText(value: unknown, maxLength: number) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

function redactPaymentNumbers(value: unknown) {
  return safeOcrText(value, 5_000).replace(/(?:\d[ -]?){13,19}/g, matched => {
    const digits = matched.replace(/\D/g, '');
    return digits.length >= 13 ? `****-****-****-${digits.slice(-4)}` : matched;
  });
}

export function createReceiptRouter(deps: RouteDeps) {
  const router = express.Router();

  // Authenticated multimodal receipt OCR. The image is not persisted by this endpoint.
  router.post('/receipt', largeJsonBody, async (req, res) => {
    try {
      if (!deps.limiters.ocr.consume(res.locals.ownerUid)) {
        return res.status(429).json({ message: '영수증 OCR은 10분에 20회까지 사용할 수 있습니다. 잠시 후 다시 시도해 주세요.' });
      }

      const { imageBase64, mimeType, categories = [], defaultDate } = req.body || {};
      if (typeof imageBase64 !== 'string' || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        return res.status(400).json({ message: '지원하지 않는 영수증 이미지입니다.' });
      }
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      if (imageBuffer.length === 0 || imageBuffer.length > 8 * 1024 * 1024) {
        return res.status(413).json({ message: '영수증 이미지는 8MB 이하여야 합니다.' });
      }
      if (!Array.isArray(categories) || categories.length === 0 || categories.length > 100) {
        return res.status(400).json({ message: '카테고리 정보가 올바르지 않습니다.' });
      }

      const expenseCategories = categories.filter((category: Loose) =>
        typeof category?.id === 'string'
        && typeof category?.name === 'string'
        && category.type === 'expense'
        && category.active !== false,
      );
      if (expenseCategories.length === 0) return res.status(400).json({ message: '사용 가능한 지출 카테고리가 없습니다.' });

      const ai = deps.getGeminiClient();
      if (!ai) return res.status(503).json({ message: '영수증 OCR을 사용하려면 GEMINI_API_KEY를 설정해야 합니다.' });
      const today = /^\d{4}-\d{2}-\d{2}$/.test(String(defaultDate || '')) ? String(defaultDate) : new Date().toISOString().slice(0, 10);
      const categoryList = expenseCategories.map((category: Loose) => `ID: "${category.id}", 이름: "${category.name}"`).join('\n');

      const prompt = `이 이미지는 한국어 또는 영문 영수증이다. 보이는 정보만 추출해 JSON으로 반환하라.
기준 날짜: ${today}

지출 카테고리:
${categoryList}

규칙:
1. amount는 실제 최종 결제 총액의 원화 정수다. 확인할 수 없으면 0이다.
2. date는 YYYY-MM-DD다. 연도가 없으면 기준 날짜의 연도를 사용하고, 확인 불가하면 기준 날짜를 사용한다.
3. suggestedCategoryId는 위 목록의 ID 중 하나만 사용한다.
4. lineItems에는 영수증에 실제로 보이는 구매 항목만 최대 50개 반환한다.
5. 카드번호나 계좌번호 전체를 반환하지 말고 cardLast4에 마지막 4자리만 반환한다.
6. rawText는 검색에 필요한 핵심 OCR 텍스트이며 5,000자 이하로 제한한다.
7. 추정값은 confidence와 reason에 명시하고 사용자가 반드시 확인하도록 needsConfirmation은 true로 둔다.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { data: imageBase64, mimeType } },
          ],
        }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              merchant: { type: Type.STRING },
              amount: { type: Type.INTEGER },
              date: { type: Type.STRING },
              purchasedTime: { type: Type.STRING },
              memo: { type: Type.STRING },
              suggestedCategoryId: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              reason: { type: Type.STRING },
              receiptNumber: { type: Type.STRING },
              businessNumber: { type: Type.STRING },
              subtotal: { type: Type.INTEGER },
              tax: { type: Type.INTEGER },
              paymentMethodText: { type: Type.STRING },
              cardLast4: { type: Type.STRING },
              rawText: { type: Type.STRING },
              needsConfirmation: { type: Type.BOOLEAN },
              lineItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    unitPrice: { type: Type.INTEGER },
                    amount: { type: Type.INTEGER },
                  },
                  required: ['name', 'amount'],
                },
              },
            },
            required: ['merchant', 'amount', 'date', 'memo', 'suggestedCategoryId', 'confidence', 'reason', 'lineItems', 'rawText', 'needsConfirmation'],
          },
        },
      });

      if (!response.text) throw new Error('Gemini returned an empty receipt result');
      const parsed = parseModelObject(response.text.trim());
      const category = expenseCategories.find((candidate: Loose) => candidate.id === parsed.suggestedCategoryId);
      const fallbackCategoryId = expenseCategories.find((candidate: Loose) => candidate.id === 'etc_expense')?.id || expenseCategories[0].id;
      const positiveInteger = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1_000_000_000_000, Math.round(Number(value)))) : 0;
      const rawText = redactPaymentNumbers(parsed.rawText);
      const cardDigits = String(parsed.cardLast4 || '').replace(/\D/g, '').slice(-4);
      const lineItems = Array.isArray(parsed.lineItems) ? (parsed.lineItems as Loose[]).slice(0, 50).map((item: Loose) => ({
        name: safeOcrText(item?.name, 120),
        quantity: Number.isFinite(Number(item?.quantity)) ? Math.max(0, Math.min(10_000, Number(item?.quantity))) : null,
        unitPrice: positiveInteger(item?.unitPrice),
        amount: positiveInteger(item?.amount),
      })).filter((item: Loose) => item.name) : [];

      return res.json({
        merchant: safeOcrText(parsed.merchant, 120) || '사용처 미확인',
        amount: positiveInteger(parsed.amount),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || '')) ? String(parsed.date) : today,
        purchasedTime: /^\d{2}:\d{2}$/.test(String(parsed.purchasedTime || '')) ? parsed.purchasedTime : null,
        memo: safeOcrText(parsed.memo, 500) || '영수증 촬영 등록',
        suggestedCategoryId: category?.id || fallbackCategoryId,
        confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0,
        reason: safeOcrText(parsed.reason, 500),
        receiptNumber: safeOcrText(parsed.receiptNumber, 80) || null,
        businessNumber: safeOcrText(parsed.businessNumber, 20) || null,
        subtotal: positiveInteger(parsed.subtotal) || null,
        tax: positiveInteger(parsed.tax) || null,
        paymentMethodText: safeOcrText(parsed.paymentMethodText, 80) || null,
        cardLast4: cardDigits.length === 4 ? cardDigits : null,
        lineItems,
        rawText,
        needsConfirmation: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /timeout|timed out|abort/i.test(message);
      logger.error('Receipt OCR error:', message);
      return res.status(timedOut ? 504 : 500).json({
        message: timedOut
          ? 'OCR 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
          : '영수증 인식에 실패했습니다. 더 선명하게 촬영하거나 직접 입력해 주세요.',
      });
    }
  });

  return router;
}
