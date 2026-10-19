import { calculateBudget } from '../lib/calculator';
import type { BudgetCalculationInput } from '../types/budget';

export function spendingSignal(spent: number, allowance: number) {
  const ratio = allowance > 0 ? spent / allowance : spent > 0 ? Infinity : 0;
  if (ratio >= 1)
    return { tone: 'exceeded', label: '초과', icon: '!', advice: '오늘은 잠깐 멈추고, 꼭 필요한 지출만 살펴봐요.' };
  if (ratio >= 0.85)
    return {
      tone: 'danger',
      label: '위험',
      icon: '!',
      advice: '오늘 예산이 얼마 남지 않았어요. 결제 전 한 번 더 생각해요.',
    };
  if (ratio >= 0.7)
    return { tone: 'caution', label: '주의', icon: '△', advice: '조금만 천천히. 남은 예산을 확인하며 써요.' };
  return { tone: 'safe', label: '안정', icon: '✓', advice: '좋은 흐름이에요. 오늘도 내 속도에 맞게 써요.' };
}

export function waterfallSegments(spent: number, pending: number, limit: number) {
  const safe = Math.max(0, limit - spent - pending);
  const total = Math.max(1, spent + pending + safe);
  return {
    spent: (spent / total) * 100,
    pending: (pending / total) * 100,
    safe: (safe / total) * 100,
    safeAmount: safe,
    over: Math.max(0, spent + pending - limit),
  };
}

export function categoryCoupon(input: BudgetCalculationInput, categoryId: string, limit: number) {
  const key = calculateBudget(input).budgetPeriodKey;
  const used = input.transactions.filter(
    (t) =>
      t.type === 'expense' && t.categoryId === categoryId && t.budgetPeriodKey === key && t.localDate <= input.today,
  ).length;
  return { used, remaining: Math.max(0, limit - used), over: Math.max(0, used - limit) };
}

export function savedYesterday(input: BudgetCalculationInput) {
  const yesterday = new Date(`${input.today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const date = yesterday.toISOString().slice(0, 10);
  if (input.period && date < input.period.start) return false;
  if (date < input.observationStartDate) return false;
  const previous = calculateBudget({ ...input, today: date });
  const current = calculateBudget(input);
  return (
    previous.budgetPeriodKey === current.budgetPeriodKey &&
    previous.actualVariableToday < previous.todayAllowance &&
    current.todayAllowance > previous.todayAllowance
  );
}
