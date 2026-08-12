import { describe, expect, it } from 'vitest';
import { Budget } from '../types';
import { resolveInheritedAllowanceLimit } from './budgetPlans';

const budget = (yearMonth: string, totalLimit: number): Budget => ({
  yearMonth, totalLimit, thresholds: [0.7, 0.85, 1], createdAt: '', updatedAt: '',
});

describe('allowance persistence', () => {
  it('seeds a new month from the nearest previous DB-saved limit', () => {
    expect(resolveInheritedAllowanceLimit('2026-10', [
      budget('2026-08', 1_200_000), budget('2026-09', 1_350_000),
    ], 900_000)).toBe(1_350_000);
  });

  it('uses the profile value instead of a deployment constant when no previous month exists', () => {
    expect(resolveInheritedAllowanceLimit('2026-01', [], 770_000)).toBe(770_000);
    expect(resolveInheritedAllowanceLimit('2026-01', [], undefined)).toBe(0);
  });
});
