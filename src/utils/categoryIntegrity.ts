import { Category, TransactionType } from '../types';

export function normalizeCategoryName(name: string) {
  return String(name || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/g, '');
}

export function findDuplicateCategory(categories: Category[], name: string, excludeId?: string) {
  const normalizedName = normalizeCategoryName(name);
  if (!normalizedName) return undefined;
  return categories.find(category => (
    category.id !== excludeId && normalizeCategoryName(category.name) === normalizedName
  ));
}

export function validateCategoryRemoval(
  categories: Category[],
  removeId: string,
  replaceWithId: string | undefined,
  isInUse: boolean,
) {
  const removeCategory = categories.find(category => category.id === removeId);
  if (!removeCategory) throw new Error('삭제할 카테고리를 찾을 수 없습니다.');
  if (removeCategory.isSystem) throw new Error('기본 카테고리는 삭제할 수 없습니다. 비활성화를 이용해주세요.');

  const replacementCategory = replaceWithId
    ? categories.find(category => category.id === replaceWithId)
    : undefined;
  if (isInUse && !replacementCategory) {
    throw new Error('사용 중인 카테고리는 전환할 카테고리를 선택해야 삭제할 수 있습니다.');
  }
  if (replacementCategory && (
    replacementCategory.id === removeId
    || replacementCategory.type !== removeCategory.type
    || replacementCategory.active === false
  )) {
    throw new Error('같은 유형의 활성 카테고리로만 전환할 수 있습니다.');
  }

  return { removeCategory, replacementCategory };
}

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
