import { Category, MerchantRule, RecurringTemplate, Budget, UserProfile } from '../types';

export const DEFAULT_EXPENSE_CATEGORIES: Category[] = [
  { id: 'child_education', name: '아이/교육', type: 'expense', icon: 'GraduationCap', color: '#8B5CF6', isSystem: true, active: true },
  { id: 'delivery_food', name: '배달음식', type: 'expense', icon: 'UtensilsCrossed', color: '#F97316', isSystem: true, active: true },
  { id: 'dining_out', name: '외식', type: 'expense', icon: 'Utensils', color: '#FB923C', isSystem: true, active: true },
  { id: 'groceries', name: '장보기', type: 'expense', icon: 'ShoppingBag', color: '#10B981', isSystem: true, active: true },
  { id: 'family_allowance', name: '가족 생활비(배우자 전달)', type: 'expense', icon: 'HeartHandshake', color: '#EC4899', isSystem: true, active: true },
  { id: 'family_other', name: '가족 기타', type: 'expense', icon: 'Users', color: '#F43F5E', isSystem: true, active: true },
  { id: 'transportation', name: '택시/교통', type: 'expense', icon: 'Car', color: '#3B82F6', isSystem: true, active: true },
  { id: 'housing_utilities', name: '주거/관리비', type: 'expense', icon: 'Home', color: '#6366F1', isSystem: true, active: true },
  { id: 'telecom', name: '통신', type: 'expense', icon: 'Smartphone', color: '#06B6D4', isSystem: true, active: true },
  { id: 'medical_health', name: '의료/건강', type: 'expense', icon: 'Stethoscope', color: '#14B8A6', isSystem: true, active: true },
  { id: 'shopping', name: '쇼핑', type: 'expense', icon: 'Tag', color: '#A855F7', isSystem: true, active: true },
  { id: 'leisure', name: '여가', type: 'expense', icon: 'Palmtree', color: '#EAB308', isSystem: true, active: true },
  { id: 'subscriptions', name: '구독', type: 'expense', icon: 'Tv', color: '#64748B', isSystem: true, active: true },
  { id: 'etc_expense', name: '기타', type: 'expense', icon: 'MoreHorizontal', color: '#94A3B8', isSystem: true, active: true },
];

export const DEFAULT_INCOME_CATEGORIES: Category[] = [
  { id: 'salary', name: '급여', type: 'income', icon: 'Briefcase', color: '#10B981', isSystem: true, active: true },
  { id: 'side_income', name: '부수입', type: 'income', icon: 'TrendingUp', color: '#059669', isSystem: true, active: true },
  { id: 'pocket_money', name: '용돈', type: 'income', icon: 'Gift', color: '#34D399', isSystem: true, active: true },
  { id: 'refund', name: '환급', type: 'income', icon: 'RotateCcw', color: '#2DD4BF', isSystem: true, active: true },
  { id: 'etc_income', name: '기타 수입', type: 'income', icon: 'Coins', color: '#0D9488', isSystem: true, active: true },
];

export const DEFAULT_MERCHANT_RULES: MerchantRule[] = [
  { id: 'rule_1', pattern: '배민', categoryId: 'delivery_food', createdAt: new Date().toISOString() },
  { id: 'rule_2', pattern: '쿠팡이츠', categoryId: 'delivery_food', createdAt: new Date().toISOString() },
  { id: 'rule_3', pattern: '카카오택시', categoryId: 'transportation', createdAt: new Date().toISOString() },
  { id: 'rule_4', pattern: '쿠팡', categoryId: 'groceries', createdAt: new Date().toISOString() },
  { id: 'rule_5', pattern: '이마트', categoryId: 'groceries', createdAt: new Date().toISOString() },
  { id: 'rule_6', pattern: '스타벅스', categoryId: 'dining_out', createdAt: new Date().toISOString() },
];

export const INITIAL_USER_PROFILE: UserProfile = {
  uid: 'user_master',
  displayName: '사용자',
  email: 'user@brake.kr',
  currency: 'KRW',
  timezone: 'Asia/Seoul',
  monthStartDay: 1,
  aiClassificationEnabled: true,
  aiInsightsEnabled: true,
  securityPinEnabled: true,
  accessPin: '1234',
  aiConsentAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function getSampleRecurringTemplates(): RecurringTemplate[] {
  return [];
}

export function getSampleBudget(yearMonth: string): Budget {
  return {
    yearMonth,
    totalLimit: 1800000, // Monthly spending limit
    categoryLimits: {
      delivery_food: 250000,
      dining_out: 300000,
      groceries: 400000,
      child_education: 350000,
      transportation: 150000,
      shopping: 200000,
    },
    thresholds: [0.70, 0.85, 1.00],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
