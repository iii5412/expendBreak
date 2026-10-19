import { describe, expect, it, vi } from 'vitest';
import { buildFeedbackSummary, classifyBudgetText, withAiDeadline } from './aiClient';
import { mockBudget } from './mock';

const categories = [{ id: 'delivery', name: '배달음식', type: 'expense' as const }];
describe('budget AI client boundaries', () => {
  it('works from keywords even when AI is disabled and never calls the network', async () => {
    const request = vi.fn();
    expect(await classifyBudgetText('배민 저녁 24,900원', categories, [], '2026-10-19', false, request, new AbortController().signal)).toMatchObject({ amount: 24900, source: 'keyword' });
    expect(request).not.toHaveBeenCalled();
  });
  it('blocks private input and disabled unknown merchants before network access', async () => {
    const request = vi.fn();
    await expect(classifyBudgetText('[Web발신] 결제 1000원', categories, [], '2026-10-19', true, request, new AbortController().signal)).rejects.toThrow('문자 원문');
    await expect(classifyBudgetText('처음 가본 곳 1000원', categories, [], '2026-10-19', false, request, new AbortController().signal)).rejects.toThrow('꺼져');
    expect(request).not.toHaveBeenCalled();
  });
  it('aborts slow providers so manual entry is available by the deadline', async () => {
    let signal: AbortSignal;
    await expect(withAiDeadline(async received => { signal = received; return new Promise(() => undefined); }, undefined, 15)).rejects.toThrow('수동 입력');
    expect(signal.aborted).toBe(true);
  });
  it('builds feedback without transaction text, merchant names or account details', () => {
    const input = { ...mockBudget, transactions: mockBudget.transactions.map(t => ({ ...t, merchant: 'PRIVATE_MERCHANT', memo: 'PRIVATE_MEMO' })) };
    const value = buildFeedbackSummary(input, categories);
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('PRIVATE_'); expect(serialized).not.toContain('transactions');
    expect(value).toMatchObject({ spentVariable: 112500, variableExpenseLimit: 600000 });
  });
});
