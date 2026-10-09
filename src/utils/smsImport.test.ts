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

  it('reads one-line and long (LMS) formats that mention 한도, 누적 or 포인트', () => {
    const at = new Date(2026, 9, 8, 12, 40).getTime();
    const cases: Array<[string, Partial<ReturnType<typeof parseFinancialSms>>]> = [
      ['[Web발신]\n신한카드(1234)승인 홍*동 12,000원(일시불)10/08 12:30 스타벅스 누적1,234,567원', { amount: 12000, merchant: '스타벅스', issuer: '신한카드', cardLast4: '1234' }],
      ['[Web발신]\n삼성1234승인 홍*동\n38,500원 일시불\n10/08 12:30 교촌치킨\n잔여한도 2,345,000원', { amount: 38500, merchant: '교촌치킨', issuer: '삼성카드', cardLast4: '1234' }],
      ['[Web발신]\n하나카드(1234) 홍*동 승인 21,400원 일시불 10/08 12:30 배달의민족 하나머니 210P 적립', { amount: 21400, merchant: '배달의민족', issuer: '하나카드', cardLast4: '1234' }],
      ['[Web발신]\nNH카드1*2*승인 홍*동 4,500원 일시불 10/08 12:30 메가커피 총누적 512,300원', { amount: 4500, merchant: '메가커피', issuer: 'NH농협카드' }],
      ['[Web발신]\nKB국민카드1234승인\n홍*동님\n5,800원 일시불\n10/08 12:30\n쿠팡이츠\n누적 345,000원', { amount: 5800, merchant: '쿠팡이츠', issuer: 'KB국민카드' }],
    ];
    for (const [body, expected] of cases) {
      expect(parseFinancialSms(message(body, at))).toMatchObject({ kind: 'approval', localDate: '2026-10-08', ...expected });
    }
  });

  it('reads the time written right after (일시불) and a merchant wrapped onto the next line', () => {
    const at = new Date(2026, 9, 9, 18, 0).getTime();
    expect(parseFinancialSms(message('알림\n\n신한카드(8068)승인 최*철\n6,500원(일시불)10/09 10:54 씨유(CU)대전\n누적435,845원', at)))
      .toMatchObject({ amount: 6500, merchant: '씨유(CU)대전', cardLast4: '8068', localDate: '2026-10-09' });
    const wrapped = parseFinancialSms(message('신한카드(8068)승인 최*철\n2,000원(일시불)10/08 08:55\n메가MGC커피( 누적2,070,907원', at));
    expect(wrapped).toMatchObject({ amount: 2000, merchant: '메가MGC커피', localDate: '2026-10-08' });
    expect(new Date(wrapped!.occurredAt).getHours()).toBe(8);
    expect(new Date(wrapped!.occurredAt).getMinutes()).toBe(55);
  });

  it('drops advertising that happens to mention 승인 and an amount', () => {
    expect(parseFinancialSms(message('(광고)[신한카드] 이벤트 응모하고 5,000원 받으세요 승인 시 적립 무료수신거부 080'))).toBeNull();
  });

  it('keeps two real same-minute purchases separate when their message ids differ', () => {
    const body = '현대카드 승인\n4,500원\n09/06 09:12 메가커피';
    const first = parseFinancialSms({ ...message(body), id: 'provider-1' });
    const second = parseFinancialSms({ ...message(body), id: 'provider-2' });
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
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
