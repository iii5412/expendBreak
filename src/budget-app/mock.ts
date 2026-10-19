import type { BudgetCalculationInput, BudgetTransaction } from '../types/budget';

const expense = (id: string, day: string, amount: number, merchant: string, categoryId: string): BudgetTransaction => ({
  id,
  localDate: `2026-10-${day}`,
  budgetPeriodKey: '2026-10',
  type: 'expense',
  expenseNature: 'variable',
  isOneOff: false,
  amount,
  merchant,
  categoryId,
});
export const mockBudget: BudgetCalculationInput = {
  today: '2026-10-19',
  observationStartDate: '2026-10-01',
  settings: { monthStartDay: 1, variableExpenseLimit: 600_000, categoryCountLimits: { delivery: 6, taxi: 4 } },
  templates: [
    { id: 'rent', active: true, type: 'expense', expenseNature: 'fixed', amount: 500_000 },
    { id: 'maintenance', active: true, type: 'expense', expenseNature: 'fixed', amount: 50_000 },
  ],
  transactions: [
    { ...expense('salary', '01', 3_000_000, '월급', 'income'), type: 'income' },
    { ...expense('rent', '01', 500_000, '월세', 'housing'), expenseNature: 'fixed' },
    expense('delivery1', '10', 14_500, '배민', 'delivery'),
    expense('delivery2', '12', 19_000, '배민', 'delivery'),
    expense('delivery3', '15', 18_000, '배민', 'delivery'),
    expense('delivery4', '17', 16_500, '배민', 'delivery'),
    expense('groceries', '16', 32_000, '동네 마트', 'groceries'),
    expense('today', '19', 12_500, '편의점', 'groceries'),
  ],
  occurrences: [
    {
      id: 'subscription',
      templateId: 'subscription',
      localDate: '2026-10-25',
      budgetPeriodKey: '2026-10',
      type: 'expense',
      expenseNature: 'variable',
      amount: 20_000,
      status: 'pending',
    },
    {
      id: 'maintenance',
      templateId: 'maintenance',
      localDate: '2026-10-25',
      budgetPeriodKey: '2026-10',
      type: 'expense',
      expenseNature: 'fixed',
      amount: 50_000,
      status: 'pending',
    },
    {
      id: 'income',
      templateId: 'income',
      localDate: '2026-10-25',
      budgetPeriodKey: '2026-10',
      type: 'income',
      expenseNature: 'fixed',
      amount: 200_000,
      status: 'pending',
    },
  ],
};

export const categories = [
  { id: 'delivery', label: '배달음식', icon: '🛵' },
  { id: 'transport', label: '교통', icon: '🚇' },
  { id: 'groceries', label: '장보기', icon: '🛒' },
  { id: 'cafe', label: '카페', icon: '☕' },
  { id: 'taxi', label: '택시', icon: '🚕' },
  { id: 'other', label: '기타', icon: '🧾' },
];
export const quickEntries = [
  { merchant: '배민', categoryId: 'delivery', label: '배민 · 배달음식', icon: '🛵' },
  { merchant: '카카오택시', categoryId: 'taxi', label: '카카오택시 · 교통', icon: '🚕' },
  { merchant: '편의점', categoryId: 'groceries', label: '편의점 · 장보기', icon: '🛒' },
  { merchant: '스타벅스', categoryId: 'cafe', label: '스타벅스 · 카페', icon: '☕' },
  { merchant: '지하철', categoryId: 'transport', label: '지하철 · 교통', icon: '🚇' },
];
