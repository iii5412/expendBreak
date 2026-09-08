import { describe, expect, it } from 'vitest';
import { findCancellationTarget, matchPaymentCard, parseFinancialSms, prepareSmsReviewQueue, resolveSmsCategory } from './smsImport';
import { PaymentCard, Transaction } from '../types';

const message = (body: string, receivedAt = new Date(2026, 8, 6, 13, 10).getTime()) => ({
  id: 'native-1', sender: '01000000000', body, receivedAt,
});

describe('parseFinancialSms', () => {
  it('extracts a Korean card approval without reading notification data', () => {
    const parsed = parseFinancialSms(message([
      '[Web발신]',
      '신한카드 *1234 승인',
      '15,900원 일시불',
      '09/06 13:08 스타벅스 강남점',
      '승인번호 827361',
    ].join('\n')));

    expect(parsed).toMatchObject({
      kind: 'approval', amount: 15900, issuer: '신한카드', cardLast4: '1234',
      merchant: '스타벅스 강남점', localDate: '2026-09-06', approvalCode: '827361',
    });
  });

  it('recognizes cancellation messages', () => {
    const parsed = parseFinancialSms(message('KB국민카드 *9876 승인취소\n8,000원\n09/06 12:01 이마트24'));
    expect(parsed?.kind).toBe('cancellation');
    expect(parsed?.amount).toBe(8000);
  });

  it('ignores statement and benefit messages', () => {
    expect(parseFinancialSms(message('삼성카드 결제예정 금액 120,000원 안내'))).toBeNull();
    expect(parseFinancialSms(message('신한카드 포인트 혜택 5,000원 이벤트'))).toBeNull();
  });

  it('uses the transaction amount instead of balance or cumulative totals', () => {
    const parsed = parseFinancialSms(message('현대카드 승인\n4,500원\n09/06 09:12 메가커피\n누적 103,200원'));
    expect(parsed?.amount).toBe(4500);
    expect(parsed?.merchant).toBe('메가커피');
  });
});

describe('SMS transaction enrichment', () => {
  const cards: PaymentCard[] = [
    { id: 'card-1', cardName: '생활', cardCompany: '신한카드', cardType: 'credit', cardLast4: '1234', createdAt: '', updatedAt: '' },
    { id: 'card-2', cardName: '쇼핑', cardCompany: '신한카드', cardType: 'credit', cardLast4: '5678', createdAt: '', updatedAt: '' },
  ];

  it('matches registered cards by last four digits', () => {
    const parsed = parseFinancialSms(message('신한카드 *5678 승인\n9,000원\n09/06 13:08 상점'))!;
    expect(matchPaymentCard(parsed, cards)?.id).toBe('card-2');
  });

  it('uses merchant rules before heuristics', () => {
    const categories = [
      { id: 'dining_out', name: '외식', type: 'expense' as const, icon: '', color: '', active: true },
      { id: 'shopping', name: '쇼핑', type: 'expense' as const, icon: '', color: '', active: true },
      { id: 'etc_expense', name: '기타', type: 'expense' as const, icon: '', color: '', active: true },
    ];
    expect(resolveSmsCategory('스타벅스 강남점', categories, [
      { id: 'rule', pattern: '스타벅스', categoryId: 'shopping', createdAt: '' },
    ])).toBe('shopping');
  });

  it('only auto-cancels a unique matching SMS transaction', () => {
    const parsed = parseFinancialSms(message('신한카드 *1234 승인취소\n15,900원\n09/06 13:09 스타벅스 강남점'))!;
    const approval: Transaction = {
      id: 'tx-1', type: 'expense', amount: 15900, occurredAt: new Date(2026, 8, 6, 13, 8).toISOString(),
      localDate: '2026-09-06', categoryId: 'dining_out', merchant: '스타벅스 강남점', memo: '', source: 'sms',
      paymentMethodType: 'card', cardId: 'card-1', createdAt: '', updatedAt: '',
    };
    expect(findCancellationTarget(parsed, [approval], 'card-1')?.id).toBe('tx-1');
    expect(findCancellationTarget(parsed, [approval, { ...approval, id: 'tx-2' }], 'card-1')).toBeNull();
  });

  it('prepares approvals for review without creating a transaction', () => {
    const categories = [
      { id: 'dining_out', name: '외식', type: 'expense' as const, icon: '', color: '', active: true },
      { id: 'etc_expense', name: '기타', type: 'expense' as const, icon: '', color: '', active: true },
    ];
    const pending = message('신한카드 *1234 승인\n15,900원\n09/06 13:08 스타벅스 강남점');
    const result = prepareSmsReviewQueue([pending], [], cards, categories, []);

    expect(result.ignoredMessageIds).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: 'approval', amount: 15900, matchedCardId: 'card-1', suggestedCategoryId: 'dining_out',
      messageIds: ['native-1'],
    });
  });

  it('does not offer an already-recorded SMS approval again', () => {
    const pending = message('신한카드 *1234 승인\n15,900원\n09/06 13:08 스타벅스 강남점');
    const parsed = parseFinancialSms(pending)!;
    const existing: Transaction = {
      id: 'tx-existing', type: 'expense', amount: parsed.amount, occurredAt: parsed.occurredAt,
      localDate: parsed.localDate, categoryId: 'dining_out', merchant: parsed.merchant, memo: '', source: 'sms',
      sourceFingerprint: parsed.fingerprint, createdAt: '', updatedAt: '',
    };
    const result = prepareSmsReviewQueue([pending], [existing], cards, [], []);

    expect(result.candidates).toEqual([]);
    expect(result.ignoredMessageIds).toEqual(['native-1']);
  });
});
