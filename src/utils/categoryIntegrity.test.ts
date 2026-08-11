import { describe, expect, it } from 'vitest';
import { Category } from '../types';
import { categoryMatchesType, getDefaultCategoryIdForType, normalizeCategoryId } from './categoryIntegrity';

const categories: Category[] = [
  { id: 'salary', name: '급여', type: 'income', icon: 'Briefcase', color: '#0f0', active: true },
  { id: 'etc_income', name: '기타 수입', type: 'income', icon: 'Coins', color: '#0f0', active: true },
  { id: 'housing', name: '주거', type: 'expense', icon: 'Home', color: '#f00', active: true },
  { id: 'etc_expense', name: '기타', type: 'expense', icon: 'More', color: '#f00', active: true },
];

describe('category integrity', () => {
  it('does not use the first income category as the default expense category', () => {
    expect(getDefaultCategoryIdForType(categories, 'expense')).toBe('etc_expense');
  });

  it('selects the type-specific income fallback', () => {
    expect(getDefaultCategoryIdForType(categories, 'income')).toBe('etc_income');
  });

  it('normalizes an incompatible category without changing the transaction type', () => {
    expect(categoryMatchesType(categories, 'salary', 'expense')).toBe(false);
    expect(normalizeCategoryId(categories, 'salary', 'expense')).toBe('etc_expense');
  });
});
