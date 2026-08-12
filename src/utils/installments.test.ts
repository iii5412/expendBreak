import { describe, expect, it } from 'vitest';
import { getInstallmentCharge, normalizeInstallmentPlan } from './installments';

describe('card installments', () => {
  it('projects the current and remaining rounds into later months', () => {
    const plan = normalizeInstallmentPlan(3, 2, '2026-08');
    expect(getInstallmentCharge(100_000, plan, '2026-08')).toEqual({ amount: 33_333, round: 2 });
    expect(getInstallmentCharge(100_000, plan, '2026-09')).toEqual({ amount: 33_334, round: 3 });
    expect(getInstallmentCharge(100_000, plan, '2026-10')).toBeNull();
  });

  it('does not create an installment plan for a lump-sum payment', () => {
    expect(normalizeInstallmentPlan(1, 1, '2026-08')).toBeNull();
  });
});
