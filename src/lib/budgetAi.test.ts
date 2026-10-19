import { describe, expect, it } from 'vitest';
import { classifyLocally, confidenceMode, hasSensitiveFinancialText, validateClassification } from './budgetAi';

const categories = [{ id: 'delivery', name: '배달음식', type: 'expense' as const }, { id: 'groceries', name: '장보기', type: 'expense' as const }];
describe('budget natural language safety and ordering', () => {
  it('gives personal rules priority over built-in keywords without a model', () => {
    expect(classifyLocally('배민 저녁 24,900원', categories, [{ pattern: '배민', categoryId: 'groceries' }], '2026-10-19')).toMatchObject({ amount: 24900, suggestedCategoryId: 'groceries', source: 'merchant_rule', needsConfirmation: true });
    expect(classifyLocally('배민 저녁 24,900원', categories, [], '2026-10-19')).toMatchObject({ suggestedCategoryId: 'delivery', source: 'keyword' });
  });
  it('does not guess absent, fractional, multiple amounts or relative dates on the local fast path', () => {
    for (const text of ['배민 저녁', '배민 0.9원', '배민 1000원 택시 2000원', '어제 배민 1000원', '2026-10-18 배민 1000원']) expect(classifyLocally(text, categories, [], '2026-10-19')).toBeNull();
  });
  it.each(['[Web발신] 결제 1,000원', '계좌번호는 생략', '발신번호는 생략', '010-0000-0000', '123-456-789012', '1234567890123'])('blocks sensitive text: %s', text => expect(hasSensitiveFinancialText(text)).toBe(true));
  it('allows direct amounts and calendar dates', () => {
    expect(hasSensitiveFinancialText('배민 24,900원')).toBe(false);
    expect(hasSensitiveFinancialText('2026-10-19 서점 12000000원')).toBe(false);
  });
  it('uses exact confidence boundaries and always requires user confirmation', () => {
    expect([.8, .799, .55, .549].map(confidenceMode)).toEqual(['confirm', 'choose', 'choose', 'question']);
    const candidate = classifyLocally('배민 1000원', categories, [], '2026-10-19');
    expect(validateClassification({ ...candidate, needsConfirmation: false }, categories).needsConfirmation).toBe(true);
  });
});
