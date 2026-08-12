import { InstallmentPlan } from '../types';

export function normalizeInstallmentPlan(
  totalMonths: number,
  currentRound: number,
  baseYearMonth: string,
): InstallmentPlan | null {
  const months = Math.min(60, Math.max(1, Math.trunc(Number(totalMonths))));
  if (months <= 1 || !/^\d{4}-\d{2}$/.test(baseYearMonth)) return null;
  return {
    totalMonths: months,
    currentRound: Math.min(months, Math.max(1, Math.trunc(Number(currentRound)))),
    baseYearMonth,
  };
}

function monthOffset(fromYearMonth: string, toYearMonth: string): number {
  const [fromYear, fromMonth] = fromYearMonth.split('-').map(Number);
  const [toYear, toMonth] = toYearMonth.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** Monthly card charge for a purchase whose total amount is split into installments. */
export function getInstallmentCharge(
  totalAmount: number,
  plan: InstallmentPlan | null | undefined,
  targetYearMonth: string,
): { amount: number; round: number } | null {
  if (!plan) return null;
  const normalized = normalizeInstallmentPlan(plan.totalMonths, plan.currentRound, plan.baseYearMonth);
  if (!normalized) return null;
  const round = normalized.currentRound + monthOffset(normalized.baseYearMonth, targetYearMonth);
  if (round < 1 || round > normalized.totalMonths) return null;

  const roundedTotal = Math.max(0, Math.round(totalAmount));
  const baseAmount = Math.floor(roundedTotal / normalized.totalMonths);
  const remainder = roundedTotal - baseAmount * normalized.totalMonths;
  return {
    amount: round === normalized.totalMonths ? baseAmount + remainder : baseAmount,
    round,
  };
}
