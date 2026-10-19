import { describe, expect, it } from 'vitest';
import { categoryCoupon, savedYesterday, spendingSignal, waterfallSegments } from './dashboard';
import { mockBudget } from './mock';

describe('daily budget dashboard', () => {
  it('assigns all signal boundary values and handles a zero budget', () => {
    for (const [spent, label] of [
      [0, '안정'],
      [69, '안정'],
      [70, '주의'],
      [84, '주의'],
      [85, '위험'],
      [99, '위험'],
      [100, '초과'],
      [150, '초과'],
    ] as const)
      expect(spendingSignal(spent, 100).label).toBe(label);
    expect(spendingSignal(0, 0).label).toBe('안정');
    expect(spendingSignal(1, 0).label).toBe('초과');
  });
  it('keeps waterfall proportions bounded when commitments exceed the limit', () => {
    expect(waterfallSegments(100, 20, 600)).toMatchObject({ safeAmount: 480, over: 0 });
    const over = waterfallSegments(120, 30, 100);
    expect(over.spent + over.pending + over.safe).toBe(100);
    expect(over).toMatchObject({ safe: 0, over: 50 });
    expect(waterfallSegments(0, 0, 0)).toMatchObject({ spent: 0, pending: 0, safe: 0 });
  });
  it('counts only actual current-period expenses for coupon use and preserves overage', () => {
    expect(categoryCoupon(mockBudget, 'delivery', 6)).toEqual({ used: 4, remaining: 2, over: 0 });
    const input = {
      ...mockBudget,
      transactions: [
        ...mockBudget.transactions,
        { ...mockBudget.transactions[2], id: 'future', localDate: '2026-10-25' },
        { ...mockBudget.transactions[2], id: 'old', budgetPeriodKey: '2026-09' },
        { ...mockBudget.transactions[2], id: 'income', type: 'income' as const },
      ],
    };
    expect(categoryCoupon(input, 'delivery', 3)).toEqual({ used: 4, remaining: 0, over: 1 });
  });
  it('shows the savings badge only with prior-day coverage and an increased allowance', () => {
    expect(savedYesterday(mockBudget)).toBe(true);
    expect(savedYesterday({ ...mockBudget, observationStartDate: mockBudget.today })).toBe(false);
    expect(savedYesterday({ ...mockBudget, today: '2026-10-01' })).toBe(false);
  });
});
