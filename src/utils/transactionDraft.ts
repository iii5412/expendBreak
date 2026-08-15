/**
 * Keeps an in-progress manual transaction so an auto-lock (or an accidental
 * close) does not throw away what the user typed.
 *
 * Uses sessionStorage: the draft must survive a lock, but not a closed tab, and
 * it is never written to the cloud.
 */
import { getAccountStorageKey } from './auth';

const draftKey = () => getAccountStorageKey('brake_transaction_draft');

export interface TransactionDraft {
  type: 'income' | 'expense';
  amount: string;
  localDate: string;
  categoryId: string;
  merchant: string;
  memo: string;
  tagsText: string;
  paymentMethodType?: 'account' | 'card' | 'cash' | 'other';
  accountId?: string;
  cardId?: string;
  installmentMonths?: number;
  installmentCurrentRound?: number;
  savedAt: string;
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A draft with no amount and no merchant is not worth restoring. */
export function isDraftWorthKeeping(draft: Omit<TransactionDraft, 'savedAt'>): boolean {
  return Boolean(draft.amount && Number(draft.amount) > 0) || Boolean(draft.merchant.trim());
}

export function saveTransactionDraft(draft: Omit<TransactionDraft, 'savedAt'>) {
  const store = session();
  if (!store) return;
  if (!isDraftWorthKeeping(draft)) {
    store.removeItem(draftKey());
    return;
  }
  try {
    store.setItem(draftKey(), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Storage can be unavailable in private modes; losing a draft is acceptable.
  }
}

export function readTransactionDraft(): TransactionDraft | null {
  const store = session();
  if (!store) return null;
  try {
    const raw = store.getItem(draftKey());
    return raw ? JSON.parse(raw) as TransactionDraft : null;
  } catch {
    return null;
  }
}

export function clearTransactionDraft() {
  session()?.removeItem(draftKey());
}
