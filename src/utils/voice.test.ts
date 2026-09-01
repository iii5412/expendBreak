import { describe, it, expect } from 'vitest';
import { validateAudioInput, shouldTriggerVoiceFallback, sanitizeVoiceResult } from './voice';
import { Category } from '../types';

const mockCategories: Category[] = [
  { id: 'food', name: '식비', type: 'expense', icon: 'utensils', color: '#ff0000', active: true },
  { id: 'transport', name: '교통비', type: 'expense', icon: 'bus', color: '#00ff00', active: true },
  { id: 'etc_expense', name: '기타지출', type: 'expense', icon: 'more', color: '#888888', active: true },
  { id: 'salary', name: '월급', type: 'income', icon: 'wallet', color: '#0000ff', active: true },
  { id: 'etc_income', name: '기타수입', type: 'income', icon: 'plus', color: '#999999', active: true },
];

describe('Voice Input Utilities', () => {
  describe('validateAudioInput', () => {
    it('should pass valid audio recording within limits', () => {
      const res = validateAudioInput(3000, 500000);
      expect(res.isValid).toBe(true);
      expect(res.errorMessage).toBeUndefined();
    });

    it('should reject audio shorter than 300ms', () => {
      const res = validateAudioInput(150, 10000);
      expect(res.isValid).toBe(false);
      expect(res.errorMessage).toContain('너무 짧습니다');
    });

    it('should reject audio longer than 8000ms', () => {
      const res = validateAudioInput(8500, 500000);
      expect(res.isValid).toBe(false);
      expect(res.errorMessage).toContain('최대 8초');
    });

    it('should reject audio exceeding 2MB', () => {
      const res = validateAudioInput(5000, 2.5 * 1024 * 1024);
      expect(res.isValid).toBe(false);
      expect(res.errorMessage).toContain('2MB');
    });
  });

  describe('shouldTriggerVoiceFallback', () => {
    it('should return false for valid high-confidence single transaction', () => {
      const result = shouldTriggerVoiceFallback({
        transcript: '오늘 배민에서 2만 4천 9백원 결제함',
        amount: 24900,
        type: 'expense',
        suggestedCategoryId: 'food',
        date: '2026-08-10',
        confidence: 0.92,
        multipleTransactionsDetected: false,
      });
      expect(result).toBe(false);
    });

    it('should trigger fallback if transcript is missing or empty', () => {
      expect(shouldTriggerVoiceFallback({ transcript: '', amount: 10000, type: 'expense', suggestedCategoryId: 'food', date: '2026-08-10', confidence: 0.9 })).toBe(true);
    });

    it('should trigger fallback if amount is zero or negative', () => {
      expect(shouldTriggerVoiceFallback({ transcript: '장보기', amount: 0, type: 'expense', suggestedCategoryId: 'food', date: '2026-08-10', confidence: 0.9 })).toBe(true);
    });

    it('keeps low-confidence output on the fast confirmation path', () => {
      expect(shouldTriggerVoiceFallback({ transcript: '무언가 구매', amount: 5000, type: 'expense', suggestedCategoryId: 'food', date: '2026-08-10', confidence: 0.60 })).toBe(false);
    });

    it('keeps multiple-transaction warnings on the confirmation path instead of retrying', () => {
      expect(shouldTriggerVoiceFallback({ transcript: '이마트에서 5만원 결제하고 택시비 1만원 냄', amount: 50000, type: 'expense', suggestedCategoryId: 'food', date: '2026-08-10', confidence: 0.9, multipleTransactionsDetected: true })).toBe(false);
    });
  });

  describe('sanitizeVoiceResult', () => {
    it('should properly format and sanitize voice output', () => {
      const raw = {
        transcript: ' 오늘 배민에서 24,900원 결제 ',
        type: 'expense',
        amount: '24900',
        date: '2026-08-10',
        merchant: '배달의민족',
        suggestedCategoryId: 'food',
        confidence: '0.88',
        reason: '배달 관련 키워드 감지',
        tags: ['#식사', '배달'],
      };

      const sanitized = sanitizeVoiceResult(raw, mockCategories, '2026-08-10', 'gemini-3.5-flash-lite', false);

      expect(sanitized.transcript).toBe('오늘 배민에서 24,900원 결제');
      expect(sanitized.amount).toBe(24900);
      expect(sanitized.suggestedCategoryId).toBe('food');
      expect(sanitized.confidence).toBe(0.88);
      expect(sanitized.modelUsed).toBe('gemini-3.5-flash-lite');
      expect(sanitized.fallbackUsed).toBe(false);
      expect(sanitized.tags).toEqual(['식사', '배달']);
    });

    it('should fallback to default category if suggested category is not matching type', () => {
      const raw = {
        transcript: '월급 350만원 들어옴',
        type: 'income',
        amount: 3500000,
        suggestedCategoryId: 'food', // Food is an expense category!
      };

      const sanitized = sanitizeVoiceResult(raw, mockCategories, '2026-08-10', 'gemini-3.5-flash-lite', false);

      expect(sanitized.type).toBe('income');
      expect(sanitized.suggestedCategoryId).toBe('etc_income'); // Correctly mapped to income fallback category
    });
  });
});
