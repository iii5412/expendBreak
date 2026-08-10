import express from 'express';
import path from 'path';
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { applicationDefault, getApps as getAdminApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OWNER_UID = process.env.OWNER_UID?.trim() || 'owner';

// A compressed receipt image is sent as base64 only for the authenticated OCR request.
app.use(express.json({ limit: '12mb' }));

function getAdminServices() {
  const adminApp = getAdminApps()[0] || initializeAdminApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
  const adminAuth = getAdminAuth(adminApp);
  const adminDb = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getAdminFirestore(adminApp, firebaseConfig.firestoreDatabaseId)
    : getAdminFirestore(adminApp);
  return { adminAuth, adminDb };
}

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyConfiguredPin(pin: string) {
  const encodedHash = process.env.APP_PIN_HASH?.trim();
  if (encodedHash) {
    const [scheme, iterationText, saltText, digestText] = encodedHash.split('$');
    const iterations = Number(iterationText);
    if (scheme !== 'pbkdf2' || !Number.isSafeInteger(iterations) || iterations < 100_000 || !saltText || !digestText) {
      throw new Error('APP_PIN_HASH 형식이 올바르지 않습니다. `npm run pin:hash -- <PIN>`으로 다시 생성하세요.');
    }
    const expected = Buffer.from(digestText, 'base64');
    const actual = pbkdf2Sync(pin, Buffer.from(saltText, 'base64'), iterations, expected.length, 'sha256');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  // Compatibility bridge for the existing AI Studio deployment. Remove after APP_PIN_HASH is configured.
  const legacyKey = process.env.APP_ACCESS_KEY?.trim();
  if (legacyKey) return safeEqualText(pin, legacyKey);
  throw new Error('운영 PIN이 설정되지 않았습니다. APP_PIN_HASH secret을 먼저 구성하세요.');
}

type PinAttempt = { failures: number; blockedUntil: number };
const pinAttempts = new Map<string, PinAttempt>();

async function requireOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { adminAuth } = getAdminServices();
    const decoded = await adminAuth.verifyIdToken(token);
    if (decoded.uid !== OWNER_UID) return res.status(403).json({ error: 'Forbidden' });
    res.locals.ownerUid = decoded.uid;
    return next();
  } catch (error) {
    console.error('Owner authentication failed:', error instanceof Error ? error.message : error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Gemini endpoints require the Firebase owner session, never the raw PIN.
app.use('/api/ai/*', requireOwner);

// Auth endpoint to check status
app.get('/api/auth/status', (req, res) => {
  const isPinConfigured = Boolean(process.env.APP_PIN_HASH?.trim() || process.env.APP_ACCESS_KEY?.trim());
  return res.json({ isPinConfigured });
});

// PIN endpoint issues a Firebase custom token for the single fixed owner.
app.post('/api/auth/verify-key', async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  const clientId = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = pinAttempts.get(clientId) || { failures: 0, blockedUntil: 0 };

  if (attempt.blockedUntil > now) {
    return res.status(429).json({
      error: 'Too many attempts',
      retryAfterMs: attempt.blockedUntil - now,
    });
  }

  if (!/^\d{4,12}$/.test(key)) {
    return res.status(400).json({ error: 'PIN은 4~12자리 숫자여야 합니다.' });
  }

  try {
    const isValid = verifyConfiguredPin(key);
    if (!isValid) {
      const failures = attempt.failures + 1;
      const delayMs = failures >= 5 ? Math.min(60_000, 1_000 * (2 ** (failures - 5))) : 0;
      pinAttempts.set(clientId, { failures, blockedUntil: now + delayMs });
      return res.status(401).json({ isValid: false, retryAfterMs: delayMs });
    }

    pinAttempts.delete(clientId);
    const { adminAuth } = getAdminServices();
    const customToken = await adminAuth.createCustomToken(OWNER_UID, { role: 'owner' });
    return res.json({ isValid: true, customToken });
  } catch (error) {
    console.error('PIN authentication configuration error:', error instanceof Error ? error.message : error);
    return res.status(503).json({
      error: 'Authentication unavailable',
      message: '운영 PIN 또는 Firebase Admin 인증 설정을 확인해 주세요.',
    });
  }
});

const LEGACY_COLLECTIONS = [
  'appSettings',
  'transactions',
  'categories',
  'budgets',
  'recurringTemplates',
  'recurringOccurrences',
  'merchantRules',
  'bankAccounts',
  'paymentCards',
] as const;

async function ensureLegacyDataMigration(ownerUid: string) {
  const { adminDb } = getAdminServices();
  const ownerRef = adminDb.collection('users').doc(ownerUid);
  const markerRef = ownerRef.collection('migrations').doc('legacy-root-v1');
  const existingMarker = await markerRef.get();
  if (existingMarker.exists) return existingMarker.data();

  const collectionReports: Record<string, {
    sourceCount: number;
    destinationCount: number;
    sourceAmountTotal?: number;
    destinationAmountTotal?: number;
  }> = {};
  const sourceDataByCollection = new Map<string, Array<Record<string, any>>>();

  for (const collectionName of LEGACY_COLLECTIONS) {
    const sourceSnapshot = await adminDb.collection(collectionName).get();
    const sourceDocs = sourceSnapshot.docs;
    sourceDataByCollection.set(collectionName, sourceDocs.map(document => ({ id: document.id, ...document.data() })));

    for (let offset = 0; offset < sourceDocs.length; offset += 400) {
      const batch = adminDb.batch();
      for (const sourceDoc of sourceDocs.slice(offset, offset + 400)) {
        const destinationRef = ownerRef.collection(collectionName).doc(sourceDoc.id);
        const sourceData = { ...sourceDoc.data() };
        if (collectionName === 'appSettings') {
          delete sourceData.accessPin;
          sourceData.aiClassificationEnabled = false;
          sourceData.aiInsightsEnabled = false;
          sourceData.aiConsentAt = null;
        }
        batch.set(destinationRef, sourceData, { merge: false });
      }
      await batch.commit();
    }

    const destinationSnapshot = await ownerRef.collection(collectionName).get();
    const destinationById = new Map(destinationSnapshot.docs.map(document => [document.id, document.data()]));
    const missingIds = sourceDocs.filter(document => !destinationById.has(document.id)).map(document => document.id);
    if (missingIds.length > 0) {
      throw new Error(`${collectionName} migration verification failed: ${missingIds.length} document(s) missing`);
    }

    const report: {
      sourceCount: number;
      destinationCount: number;
      sourceAmountTotal?: number;
      destinationAmountTotal?: number;
    } = {
      sourceCount: sourceDocs.length,
      destinationCount: destinationSnapshot.size,
    };

    if (collectionName === 'transactions') {
      report.sourceAmountTotal = sourceDocs.reduce((sum, document) => sum + Number(document.data().amount || 0), 0);
      report.destinationAmountTotal = sourceDocs.reduce(
        (sum, document) => sum + Number(destinationById.get(document.id)?.amount || 0),
        0,
      );
      if (report.sourceAmountTotal !== report.destinationAmountTotal) {
        throw new Error('transactions migration verification failed: amount totals differ');
      }
    }

    collectionReports[collectionName] = report;
  }

  const completedAt = new Date().toISOString();
  const categoryTypeById = new Map(
    (sourceDataByCollection.get('categories') || []).map(category => [category.id, category.type]),
  );
  const invalidTransactions = (sourceDataByCollection.get('transactions') || []).filter(
    transaction => categoryTypeById.get(transaction.categoryId) !== transaction.type,
  );
  const invalidTemplates = (sourceDataByCollection.get('recurringTemplates') || []).filter(
    template => categoryTypeById.get(template.categoryId) !== template.type,
  );
  const report = {
    version: 'legacy-root-v1',
    ownerUid,
    completedAt,
    sourceDeleted: false,
    collections: collectionReports,
    classificationIssues: {
      transactionCount: invalidTransactions.length,
      transactionAmount: invalidTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0),
      recurringTemplateCount: invalidTemplates.length,
    },
  };
  await markerRef.set(report);
  return report;
}

// Copies existing global collections into the fixed owner path. It never deletes the source data.
app.post('/api/migration/ensure', requireOwner, async (req, res) => {
  try {
    const report = await ensureLegacyDataMigration(res.locals.ownerUid);
    return res.json({ ok: true, report });
  } catch (error) {
    console.error('Legacy data migration failed:', error);
    return res.status(500).json({
      error: 'Migration failed',
      message: '기존 데이터 복사 검증에 실패했습니다. 원본 데이터는 변경되지 않았습니다.',
    });
  }
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

type OcrRateWindow = { startedAt: number; count: number };
const ocrRateWindows = new Map<string, OcrRateWindow>();

function consumeOcrQuota(ownerUid: string) {
  const now = Date.now();
  const current = ocrRateWindows.get(ownerUid);
  if (!current || now - current.startedAt >= 10 * 60_000) {
    ocrRateWindows.set(ownerUid, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 20) return false;
  current.count += 1;
  return true;
}

function safeOcrText(value: unknown, maxLength: number) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

function redactPaymentNumbers(value: unknown) {
  return safeOcrText(value, 5_000).replace(/(?:\d[ -]?){13,19}/g, matched => {
    const digits = matched.replace(/\D/g, '');
    return digits.length >= 13 ? `****-****-****-${digits.slice(-4)}` : matched;
  });
}

// Authenticated multimodal receipt OCR. The image is not persisted by this endpoint.
app.post('/api/ai/receipt', async (req, res) => {
  try {
    if (!consumeOcrQuota(res.locals.ownerUid)) {
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

    const expenseCategories = categories.filter((category: any) =>
      typeof category?.id === 'string'
      && typeof category?.name === 'string'
      && category.type === 'expense'
      && category.active !== false,
    );
    if (expenseCategories.length === 0) return res.status(400).json({ message: '사용 가능한 지출 카테고리가 없습니다.' });

    const ai = getGeminiClient();
    if (!ai) return res.status(503).json({ message: '영수증 OCR을 사용하려면 GEMINI_API_KEY를 설정해야 합니다.' });
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(defaultDate || '')) ? String(defaultDate) : new Date().toISOString().slice(0, 10);
    const categoryList = expenseCategories.map((category: any) => `ID: "${category.id}", 이름: "${category.name}"`).join('\n');

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
    const parsed = JSON.parse(response.text.trim());
    const category = expenseCategories.find((candidate: any) => candidate.id === parsed.suggestedCategoryId);
    const fallbackCategoryId = expenseCategories.find((candidate: any) => candidate.id === 'etc_expense')?.id || expenseCategories[0].id;
    const positiveInteger = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1_000_000_000_000, Math.round(Number(value)))) : 0;
    const rawText = redactPaymentNumbers(parsed.rawText);
    const cardDigits = String(parsed.cardLast4 || '').replace(/\D/g, '').slice(-4);
    const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems.slice(0, 50).map((item: any) => ({
      name: safeOcrText(item?.name, 120),
      quantity: Number.isFinite(Number(item?.quantity)) ? Math.max(0, Math.min(10_000, Number(item.quantity))) : null,
      unitPrice: positiveInteger(item?.unitPrice),
      amount: positiveInteger(item?.amount),
    })).filter((item: any) => item.name) : [];

    return res.json({
      merchant: safeOcrText(parsed.merchant, 120) || '사용처 미확인',
      amount: positiveInteger(parsed.amount),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || '')) ? parsed.date : today,
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
    console.error('Receipt OCR error:', error instanceof Error ? error.message : error);
    return res.status(500).json({ message: '영수증 인식에 실패했습니다. 더 선명하게 촬영하거나 직접 입력해 주세요.' });
  }
});

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
    amount: amount || 10000,
    date: defaultDate,
    merchant,
    memo: text,
    suggestedCategoryId,
    suggestedNewCategoryName: null,
    confidence: merchantRules?.some((rule: any) => {
      const category = categories.find(candidate => candidate.id === rule.categoryId);
      return category?.type === type && rule.pattern && textLower.includes(rule.pattern.toLowerCase());
    }) ? 0.95 : 0.65,
    reason: '규칙 및 키워드 기반 분류',
    needsConfirmation: true,
  };
}

// Endpoint 1: Natural Language Transaction Classifier
app.post('/api/ai/classify', async (req, res) => {
  try {
    const { text, categories = [], merchantRules = [], defaultDate } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length > 500) {
      return res.status(400).json({ error: 'Text prompt is required' });
    }
    if (!Array.isArray(categories) || categories.length === 0 || categories.length > 100 || !Array.isArray(merchantRules) || merchantRules.length > 200) {
      return res.status(400).json({ error: 'Invalid classification context' });
    }

    const safeCategories = categories.filter((category: any) =>
      typeof category?.id === 'string'
      && typeof category?.name === 'string'
      && (category?.type === 'income' || category?.type === 'expense'),
    );
    const safeMerchantRules = merchantRules.filter((rule: any) =>
      typeof rule?.pattern === 'string'
      && rule.pattern.length <= 100
      && typeof rule?.categoryId === 'string',
    );

    const todayStr = defaultDate || new Date().toISOString().split('T')[0];

    // First check exact merchant rules
    const textLower = text.toLowerCase();
    const matchedRule = safeMerchantRules.find((r: any) => r.pattern && textLower.includes(r.pattern.toLowerCase()));

    const ai = getGeminiClient();
    if (!ai) {
      // Fallback response if API key not present
      const fallback = fallbackClassify(text, safeCategories, safeMerchantRules, todayStr);
      return res.json({ ...fallback, isFallback: true });
    }

    const catListStr = safeCategories
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

    result.type = result.type === 'income' ? 'income' : 'expense';
    result.amount = Number.isFinite(Number(result.amount)) ? Math.max(0, Math.min(1_000_000_000_000, Math.round(Number(result.amount)))) : 0;
    result.confidence = Number.isFinite(Number(result.confidence)) ? Math.max(0, Math.min(1, Number(result.confidence))) : 0;
    result.date = /^\d{4}-\d{2}-\d{2}$/.test(String(result.date || '')) ? result.date : todayStr;
    result.merchant = String(result.merchant || '').slice(0, 120);
    result.memo = String(result.memo || '').slice(0, 500);

    let forcedReview = false;
    const selectedCategory = safeCategories.find((category: any) => category.id === result.suggestedCategoryId);
    if (!selectedCategory || selectedCategory.type !== result.type) {
      result.suggestedCategoryId = safeCategories.find((category: any) =>
        category.id === (result.type === 'expense' ? 'etc_expense' : 'etc_income'),
      )?.id || safeCategories.find((category: any) => category.type === result.type)?.id || '';
      forcedReview = true;
    }

    // Validation
    if (matchedRule) {
      const ruleCategory = safeCategories.find((category: any) => category.id === matchedRule.categoryId);
      if (ruleCategory?.type === result.type) {
        result.suggestedCategoryId = matchedRule.categoryId;
        result.confidence = 0.95;
      }
    }

    if (!result.date) result.date = todayStr;
    result.needsConfirmation = forcedReview || result.confidence < 0.8 || result.amount <= 0;

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
    if (typeof description !== 'string' || description.trim().length === 0 || description.length > 500 || !Array.isArray(existingCategories) || existingCategories.length > 100) {
      return res.status(400).json({ error: 'Invalid category request' });
    }
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
    if (!monthSummary || typeof monthSummary !== 'object' || !Array.isArray(categoryBreakdown) || categoryBreakdown.length > 100) {
      return res.status(400).json({ error: 'Invalid feedback request' });
    }
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
