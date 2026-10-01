import express from 'express';
import { Type } from '@google/genai';
import type { Loose } from '../../lib/inputs';
import { logger } from '../../lib/logger';
import type { RouteDeps } from '../types';

export function createCategoryRecommendRouter(deps: RouteDeps) {
  const router = express.Router();

  // Endpoint 2: AI Category Name Recommendations
  router.post('/category-recommend', async (req, res) => {
    try {
      const { description, existingCategories = [] } = req.body;
      if (typeof description !== 'string' || description.trim().length === 0 || description.length > 500 || !Array.isArray(existingCategories) || existingCategories.length > 100) {
        return res.status(400).json({ error: 'Invalid category request' });
      }
      const ai = deps.getGeminiClient();

      if (!ai) return res.status(503).json({ error: 'ai_disabled', message: 'AI 추천을 사용하려면 GEMINI_API_KEY를 설정해야 합니다.' });

      const existingNames = existingCategories.map((c: Loose) => c.name).join(', ');

      const prompt = `User wants to group their expenses: "${description}".
Existing categories: [${existingNames}].
Suggest up to 5 concise Korean category names with brief descriptions. If an existing category already covers it, note that.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                suggestedName: { type: Type.STRING },
                description: { type: Type.STRING },
                existingMatchId: { type: Type.STRING },
              },
              required: ['suggestedName', 'description'],
            },
          },
        },
      });

      if (!response.text) throw new Error('Empty AI response');
      const suggestions = JSON.parse(response.text.trim());
      if (!Array.isArray(suggestions)) throw new Error('AI suggestions were not a list');
      return res.json({ suggestions });
    } catch (error) {
      logger.error('Category recommendation error:', error instanceof Error ? error.message : error);
      return res.status(502).json({ error: 'ai_category_failed', message: 'AI 카테고리 추천을 불러오지 못했습니다.' });
    }
  });

  return router;
}
