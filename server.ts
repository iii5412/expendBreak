import express from 'express';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Security Middleware to prevent unauthorized Gemini API consumption
app.use('/api/ai/*', (req, res, next) => {
  const masterKey = process.env.APP_ACCESS_KEY;
  const providedKey = (req.headers['x-app-access-key'] || req.headers['x-app-pin'] || req.query.accessKey) as string | undefined;

  // If APP_ACCESS_KEY is configured in server environment, strictly enforce matching
  if (masterKey && masterKey.trim() !== '') {
    if (!providedKey || providedKey !== masterKey) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '보안 접근 암호가 일치하지 않습니다. 타인의 Gemini API 무단 사용을 방지하고 있습니다.',
      });
    }
  }

  next();
});

// Auth endpoint to check status
app.get('/api/auth/status', (req, res) => {
  const masterKey = process.env.APP_ACCESS_KEY;
  const isProtectedByServerEnv = Boolean(masterKey && masterKey.trim() !== '');
  return res.json({ isProtectedByServerEnv });
});

// Auth endpoint to verify access key / PIN
app.post('/api/auth/verify-key', (req, res) => {
  const { key } = req.body;
  const masterKey = process.env.APP_ACCESS_KEY;

  if (masterKey && masterKey.trim() !== '') {
    const isValid = key === masterKey;
    return res.json({ isValid, isProtectedByServerEnv: true });
  }

  return res.json({ isValid: true, isProtectedByServerEnv: false });
});

// Initialize Gemini Client server-side
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Local heuristic keyword matcher as instant fallback or pre-processor
function fallbackClassify(text: string, categories: any[], merchantRules: any[], defaultDate: string) {
  const textLower = text.toLowerCase().trim();

  // Extract amount using regex
  const numberMatches = text.match(/(\d{1,3}(?:,\d{3})*|\d+)(?:\s*원|\s*만원)?/g);
  let amount = 0;

  if (numberMatches && numberMatches.length > 0) {
    // Look for numbers in text
    for (const match of numberMatches) {
      if (match.includes('만원')) {
        const num = parseFloat(match.replace(/[^\d.]/g, ''));
        amount = Math.round(num * 10000);
        break;
      } else {
        const cleanNum = parseInt(match.replace(/[^\d]/g, ''), 10);
        if (cleanNum > 0) {
          amount = cleanNum;
          break;
        }
      }
    }
  }

  // Check merchant rules
  let suggestedCategoryId = 'etc_expense';
  let merchant = '';
  let memo = text;
  let type: 'income' | 'expense' = 'expense';

  if (text.includes('월급') || text.includes('급여') || text.includes('들어옴') || text.includes('수입')) {
    type = 'income';
    suggestedCategoryId = 'salary';
  }

  for (const rule of merchantRules || []) {
    if (rule.pattern && textLower.includes(rule.pattern.toLowerCase())) {
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
    amount: amount || 10000,
    date: defaultDate,
    merchant,
    memo: text,
    suggestedCategoryId,
    suggestedNewCategoryName: null,
    confidence: merchantRules?.some((r: any) => textLower.includes(r.pattern.toLowerCase())) ? 0.95 : 0.65,
    reason: '규칙 및 키워드 기반 분류',
    needsConfirmation: true,
  };
}

// Endpoint 1: Natural Language Transaction Classifier
app.post('/api/ai/classify', async (req, res) => {
  try {
    const { text, categories = [], merchantRules = [], defaultDate } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text prompt is required' });
    }

    const todayStr = defaultDate || new Date().toISOString().split('T')[0];

    // First check exact merchant rules
    const textLower = text.toLowerCase();
    const matchedRule = merchantRules.find((r: any) => r.pattern && textLower.includes(r.pattern.toLowerCase()));

    const ai = getGeminiClient();
    if (!ai) {
      // Fallback response if API key not present
      const fallback = fallbackClassify(text, categories, merchantRules, todayStr);
      return res.json({ ...fallback, isFallback: true });
    }

    const catListStr = categories
      .map((c: any) => `ID: "${c.id}", Name: "${c.name}", Type: "${c.type}"`)
      .join('\n');

    const prompt = `Analyze this Korean transaction text and return a JSON object with classification details:
Transaction Text: "${text}"
Current Date: "${todayStr}"

Available Categories:
${catListStr}

Rules:
1. "amount" MUST be an integer representing KRW (e.g. 24,900 -> 24900, 18만원 -> 180000). If no amount is found or ambiguous, set amount to 0.
2. "type" MUST be "income" or "expense".
3. "suggestedCategoryId" MUST be selected from the available category IDs listed above that best matches the merchant/memo.
4. "confidence" MUST be a float between 0.0 and 1.0.
5. Do NOT invent new category IDs. If no existing category fits well, suggest a short name in "suggestedNewCategoryName", but put the closest existing category ID in "suggestedCategoryId".`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
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

    const result = JSON.parse(response.text.trim());

    // Validation
    if (matchedRule) {
      result.suggestedCategoryId = matchedRule.categoryId;
      result.confidence = 0.95;
    }

    if (!result.date) result.date = todayStr;
    result.needsConfirmation = result.confidence < 0.8 || result.amount <= 0;

    return res.json(result);
  } catch (error: any) {
    console.error('AI Classification Error:', error);
    const fallback = fallbackClassify(req.body.text || '', req.body.categories || [], req.body.merchantRules || [], req.body.defaultDate || new Date().toISOString().split('T')[0]);
    return res.json({ ...fallback, isFallback: true });
  }
});

// Endpoint 2: AI Category Name Recommendations
app.post('/api/ai/category-recommend', async (req, res) => {
  try {
    const { description, existingCategories = [] } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        suggestions: [
          { suggestedName: '학원/교육', description: '아이 학원 및 교재비' },
          { suggestedName: '육아용품', description: '장난감 및 아동용품' },
        ],
      });
    }

    const existingNames = existingCategories.map((c: any) => c.name).join(', ');

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

    const suggestions = JSON.parse(response.text?.trim() || '[]');
    return res.json({ suggestions });
  } catch (error) {
    console.error('Category recommendation error:', error);
    return res.json({ suggestions: [] });
  }
});

// Endpoint 3: Monthly AI Spend Feedback Report
app.post('/api/ai/feedback', async (req, res) => {
  try {
    const { monthSummary, categoryBreakdown } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        oneLiner: '이번 달 예산 한도 내에서 비교적 안정적으로 지출을 관리하고 있습니다.',
        positivePoint: '고정지출이 수입 대비 적절한 비율로 관리되고 있습니다.',
        riskFactors: ['배달음식 카테고리가 예산 한도의 80% 이상 소진되었습니다.'],
        weeklyActions: [
          { action: '주말 배달 2회를 집밥으로 변경하기', estimatedSavings: '약 30,000원 ~ 50,000원 절감' },
          { action: '택시 이용 줄이고 대중교통 이용하기', estimatedSavings: '약 15,000원 절감' },
        ],
      });
    }

    const summaryPrompt = `Analyze these deterministic financial stats for a Korean household app:
- Month: ${monthSummary.yearMonth}
- Monthly Budget Limit: ${monthSummary.monthlyBudgetLimit} KRW
- Confirmed Expenses: ${monthSummary.confirmedExpenses} KRW
- Safety Balance: ${monthSummary.safetyBalance} KRW
- Daily Safe Spending Allowance: ${monthSummary.dailySafeAllowance} KRW
- Budget Usage: ${monthSummary.budgetUsagePercent}%
- Alert Level: ${monthSummary.alertLevel}
- Top Category Breakdown: ${JSON.stringify(categoryBreakdown?.slice(0, 5) || [])}

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

    const feedback = JSON.parse(response.text?.trim() || '{}');
    return res.json(feedback);
  } catch (error) {
    console.error('Feedback AI error:', error);
    return res.json({
      oneLiner: '데이터를 기반으로 이번 달 지출 상태를 분석했습니다.',
      positivePoint: '수입과 고정 지출 기록이 정상 반영되어 있습니다.',
      riskFactors: ['일부 카테고리의 지출 속도가 빠릅니다.'],
      weeklyActions: [{ action: '외식 및 배달 횟수 1회 줄이기', estimatedSavings: '약 25,000원 절감' }],
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
