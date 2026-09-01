import { describe, expect, it } from 'vitest';
import type { BankAccount, PaymentCard } from '../types';
import {
  extractDetailTags,
  findMentionedPaymentSource,
  normalizePaymentAlias,
  sanitizeSuggestedTags,
} from './transactionEnrichment';

const salaryAccount = {
  id: 'account-salary',
  bankName: '카카오뱅크',
  accountName: '급여통장',
} as BankAccount;

const livingCard = {
  id: 'card-living',
  cardName: '생활 체크',
  cardCompany: '신한카드',
} as PaymentCard;

describe('transaction enrichment', () => {
  it('normalizes common Korean account alias synonyms', () => {
    expect(normalizePaymentAlias('월급 통장')).toBe('급여계좌');
    expect(normalizePaymentAlias('급여계좌')).toBe('급여계좌');
  });

  it('matches 급여계좌 to a registered 급여통장 alias', () => {
    expect(findMentionedPaymentSource(
      '36000원 쿠팡 아이신발 구매 급여계좌',
      [salaryAccount],
      [livingCard],
    )).toEqual({ type: 'account', id: 'account-salary' });
  });

  it('still matches a registered card name', () => {
    expect(findMentionedPaymentSource('쿠팡 36000원 생활체크 결제', [salaryAccount], [livingCard]))
      .toEqual({ type: 'card', id: 'card-living' });
  });

  it('extracts the purchase detail as a 생활 tag', () => {
    expect(extractDetailTags(
      '36000원 쿠팡 아이신발 구매 급여계좌',
      ['쿠팡', '장보기', '급여통장'],
    )).toEqual(['아이신발']);
  });

  it('cleans model-suggested tags and excludes category or merchant terms', () => {
    expect(sanitizeSuggestedTags(['#아이신발', '쿠팡', '장보기'], ['쿠팡', '장보기']))
      .toEqual(['아이신발']);
  });
});
