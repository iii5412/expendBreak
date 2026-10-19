import type { Category } from '../types';
import { quickEntries as defaults } from './mock';

export interface BudgetCategory {
  id: string;
  label: string;
  icon: string;
}
export interface BudgetQuickEntry {
  merchant: string;
  categoryId: string;
  label: string;
  icon: string;
}

export function accountCatalog(categories: Category[]) {
  const active = categories.filter((c) => c.active && c.type === 'expense');
  const aliases = {
    delivery: ['배달'],
    taxi: ['택시', '교통'],
    transport: ['교통'],
    groceries: ['장보기'],
    cafe: ['카페', '외식'],
  };
  const quickEntries: BudgetQuickEntry[] = defaults.flatMap((q) => {
    const category = active.find((c) => aliases[q.categoryId]?.some((name: string) => c.name.includes(name)));
    return category ? [{ ...q, categoryId: category.id, label: `${q.merchant} · ${category.name}` }] : [];
  });
  return {
    categories: active.map((c) => ({
      id: c.id,
      label: c.name,
      icon: quickEntries.find((q) => q.categoryId === c.id)?.icon || '🧾',
    })),
    quickEntries,
  };
}
