import type { Category } from '../types';
import { authenticatedFetch } from './auth';
import type { SmsReviewCandidate } from './smsImport';

/**
 * Better category guesses for SMS candidates that the merchant rules and
 * keyword heuristics could not place. Only merchant names parsed on the
 * device are sent (OpenAI Decisions via /api/ai/agent/categorize); the SMS
 * text, sender, amount and card stay on the phone, as the SMS consent says.
 */

const MIN_CONFIDENCE = 0.6;
const MAX_PER_REQUEST = 25;
// Per app session: the same merchant is not asked twice.
const cache = new Map<string, { categoryId: string | null; confidence: number }>();

export function fallbackExpenseCategoryId(categories: Category[]): string {
  return categories.find(category => category.id === 'etc_expense')?.id
    || categories.find(category => category.type === 'expense' && category.active)?.id
    || '';
}

/** Applies cached suggestions only to candidates still on the fallback category. */
export function applySmsCategorySuggestions(
  candidates: SmsReviewCandidate[],
  categories: Category[],
  suggestions: Map<string, { categoryId: string | null; confidence: number }> = cache,
): SmsReviewCandidate[] {
  const fallback = fallbackExpenseCategoryId(categories);
  const usable = new Set(categories.filter(category => category.type === 'expense' && category.active).map(category => category.id));
  return candidates.map(candidate => {
    if (candidate.kind !== 'approval' || candidate.suggestedCategoryId !== fallback) return candidate;
    const suggestion = suggestions.get(candidate.merchant);
    if (!suggestion?.categoryId || suggestion.confidence < MIN_CONFIDENCE || !usable.has(suggestion.categoryId)) return candidate;
    return { ...candidate, suggestedCategoryId: suggestion.categoryId };
  });
}

export async function suggestSmsCategories(candidates: SmsReviewCandidate[], categories: Category[]): Promise<SmsReviewCandidate[]> {
  const fallback = fallbackExpenseCategoryId(categories);
  const merchants = [...new Set(candidates
    .filter(candidate => candidate.kind === 'approval' && candidate.suggestedCategoryId === fallback)
    .map(candidate => candidate.merchant)
    .filter(merchant => merchant && !cache.has(merchant)))]
    .slice(0, MAX_PER_REQUEST);
  if (merchants.length > 0) {
    const expenseCategories = categories
      .filter(category => category.type === 'expense' && category.active)
      .map(category => ({ id: category.id, name: category.name }));
    try {
      const response = await authenticatedFetch('/api/ai/agent/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchants, categories: expenseCategories }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.available && Array.isArray(data.results)) {
        for (const result of data.results as Array<{ merchant: string; categoryId: string | null; confidence: number }>) {
          cache.set(result.merchant, { categoryId: result.categoryId, confidence: Number(result.confidence) || 0 });
        }
      }
    } catch {
      // Keeps the heuristic suggestion; the user picks the category on approval anyway.
    }
  }
  return applySmsCategorySuggestions(candidates, categories);
}
