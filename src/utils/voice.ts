import { Category, TransactionType, VoiceAnalysisResult } from '../types';

export const MAX_VOICE_DURATION_MS = 8000;
export const MAX_VOICE_BYTE_SIZE = 2 * 1024 * 1024; // 2MB

export interface AudioValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

export function validateAudioInput(durationMs: number, bufferByteLength: number): AudioValidationResult {
  if (durationMs < 300) {
    return {
      isValid: false,
      errorMessage: '녹음된 음성이 없거나 너무 짧습니다.',
    };
  }

  if (durationMs > MAX_VOICE_DURATION_MS) {
    return {
      isValid: false,
      errorMessage: '음성 녹음 시간은 최대 8초까지 지원됩니다.',
    };
  }

  if (bufferByteLength > MAX_VOICE_BYTE_SIZE) {
    return {
      isValid: false,
      errorMessage: '음성 파일 크기가 2MB를 초과했습니다.',
    };
  }

  return { isValid: true };
}

export function shouldTriggerVoiceFallback(data: Partial<VoiceAnalysisResult> | null | undefined): boolean {
  if (!data) return true;

  // 1. Transcript checks
  const transcript = String(data.transcript || '').trim();
  if (!transcript || transcript.length < 1) return true;

  // 2. Amount checks
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return true;

  // 3. Transaction type checks
  if (data.type !== 'income' && data.type !== 'expense') return true;

  // 4. Category checks
  if (!data.suggestedCategoryId || typeof data.suggestedCategoryId !== 'string') return true;

  // 5. Date format checks (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ''))) return true;

  // 6. Confidence threshold (must be >= 0.75)
  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence) || confidence < 0.75) return true;

  // 7. Multiple transactions detected
  if (data.multipleTransactionsDetected === true) return true;

  return false;
}

export function sanitizeVoiceResult(
  raw: any,
  categories: Category[],
  defaultDate: string,
  modelUsed: string,
  fallbackUsed: boolean,
): VoiceAnalysisResult {
  const safeTranscript = String(raw?.transcript || '').slice(0, 500).trim();
  const safeType: TransactionType = raw?.type === 'income' ? 'income' : 'expense';

  const rawAmount = Number(raw?.amount);
  const safeAmount = Number.isFinite(rawAmount)
    ? Math.max(0, Math.min(1_000_000_000_000, Math.round(rawAmount)))
    : 0;

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const safeDate = datePattern.test(String(raw?.date || '')) ? String(raw.date) : defaultDate;

  const safeMerchant = String(raw?.merchant || '기타 사용처').slice(0, 120).trim();
  const safeMemo = String(raw?.memo || safeTranscript).slice(0, 500).trim();

  // Category matching
  const matchingCategories = categories.filter((c) => c.type === safeType && c.active !== false);
  const foundCategory = matchingCategories.find((c) => c.id === raw?.suggestedCategoryId);
  const defaultCategory = categories.find((c) => c.id === (safeType === 'expense' ? 'etc_expense' : 'etc_income'))
    || matchingCategories[0]
    || categories[0];

  const safeCategoryId = foundCategory ? foundCategory.id : (defaultCategory?.id || '');

  // Confidence
  const rawConfidence = Number(raw?.confidence);
  const safeConfidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : 0.7;

  // Payment method
  const allowedPaymentMethods = ['card', 'account', 'cash', 'other'] as const;
  const safePaymentMethod = allowedPaymentMethods.includes(raw?.paymentMethodType)
    ? raw.paymentMethodType
    : 'other';

  // Tags
  const safeTags = Array.isArray(raw?.tags)
    ? raw.tags
        .map((t: any) => String(t || '').trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const multipleTransactionsDetected = Boolean(raw?.multipleTransactionsDetected);

  return {
    transcript: safeTranscript,
    type: safeType,
    amount: safeAmount,
    date: safeDate,
    merchant: safeMerchant,
    memo: safeMemo,
    suggestedCategoryId: safeCategoryId,
    paymentMethodType: safePaymentMethod,
    paymentMethodHint: String(raw?.paymentMethodHint || '').slice(0, 100),
    suggestedAccountId: typeof raw?.suggestedAccountId === 'string' ? raw.suggestedAccountId : null,
    suggestedCardId: typeof raw?.suggestedCardId === 'string' ? raw.suggestedCardId : null,
    tags: safeTags,
    confidence: safeConfidence,
    reason: String(raw?.reason || '음성 인식 결과 분석').slice(0, 300),
    multipleTransactionsDetected,
    needsConfirmation: true,
    modelUsed,
    fallbackUsed,
  };
}
