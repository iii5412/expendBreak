import { Category, TransactionType } from '../types';

export function getDefaultCategoryIdForType(categories: Category[], type: TransactionType) {
  const preferredId = type === 'expense' ? 'etc_expense' : 'etc_income';
  return categories.find(category => category.id === preferredId && category.type === type && category.active)?.id
    || categories.find(category => category.type === type && category.active)?.id
    || '';
}

export function categoryMatchesType(categories: Category[], categoryId: string, type: TransactionType) {
  return categories.some(category => category.id === categoryId && category.type === type);
}

export function normalizeCategoryId(categories: Category[], categoryId: string, type: TransactionType) {
  return categoryMatchesType(categories, categoryId, type)
    ? categoryId
    : getDefaultCategoryIdForType(categories, type);
}
