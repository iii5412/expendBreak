import { describe, expect, it } from 'vitest';
import { Category } from '../types';
import {
  categoryMatchesType,
  findDuplicateCategory,
  getDefaultCategoryIdForType,
  normalizeCategoryId,
  normalizeCategoryName,
  validateCategoryRemoval,
} from './categoryIntegrity';

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

  it('detects duplicate category names regardless of spaces, case, or unicode width', () => {
    const customCategories: Category[] = [
      ...categories,
      { id: 'living', name: '생활 비', type: 'expense', icon: 'Tag', color: '#fff', active: true },
    ];

    expect(normalizeCategoryName('  Ａ BC ')).toBe('abc');
    expect(findDuplicateCategory(customCategories, '생활비')?.id).toBe('living');
  });

  it('requires a same-type active replacement when deleting a category in use', () => {
    expect(() => validateCategoryRemoval(categories, 'housing', undefined, true)).toThrow('전환할 카테고리');
    expect(() => validateCategoryRemoval(categories, 'housing', 'salary', true)).toThrow('같은 유형');
    expect(validateCategoryRemoval(categories, 'housing', 'etc_expense', true).replacementCategory?.id)
      .toBe('etc_expense');
  });

  it('allows an unused custom category to be deleted without replacement but protects system categories', () => {
    const customCategories: Category[] = [
      ...categories,
      { id: 'custom', name: '사용자 정의', type: 'expense', icon: 'Tag', color: '#fff', active: true, isCustom: true },
      { id: 'system', name: '기본', type: 'expense', icon: 'Tag', color: '#fff', active: true, isSystem: true },
    ];
    expect(validateCategoryRemoval(customCategories, 'custom', undefined, false).replacementCategory).toBeUndefined();
    expect(() => validateCategoryRemoval(customCategories, 'system', undefined, false)).toThrow('기본 카테고리');
  });
});
