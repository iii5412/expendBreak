import type {
  BankAccount,
  Budget,
  Category,
  CycleBaseline,
  MerchantRule,
  PaymentCard,
  QuickEntry,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
  UserProfile,
  AmountChangeRecord,
} from '../types';
import {
  COLLECTION_APP_SETTINGS,
  COLLECTION_BANK_ACCOUNTS,
  COLLECTION_BUDGETS,
  COLLECTION_CATEGORIES,
  COLLECTION_CYCLE_BASELINES,
  COLLECTION_MERCHANT_RULES,
  COLLECTION_PAYMENT_CARDS,
  COLLECTION_QUICK_ENTRIES,
  COLLECTION_RECURRING_OCCURRENCES,
  COLLECTION_RECURRING_TEMPLATES,
  COLLECTION_TRANSACTIONS,
  DOC_GLOBAL_SETTINGS,
  type ConditionalDocumentWrite,
  type PendingFirestoreWrite,
} from './firestoreOutbox';
import { sanitizeUserProfileForFirestore } from './firestorePayload';

/**
 * What each cloud write looks like, as plain data. Both the Firestore module
 * and the lazy facade build their writes from these, so a change can be queued
 * in the outbox before the Firestore code has even loaded.
 */
export interface WriteSpec {
  entry: Omit<PendingFirestoreWrite, 'id' | 'queuedAt'>;
  /** Logged when the write fails. */
  label: string;
}

type Doc = Record<string, unknown>;

const setSpec = (collectionName: string, documentId: string, data: object, label: string): WriteSpec => ({
  entry: { operation: 'set', collectionName, documentId, data: data as Doc },
  label,
});

const deleteSpec = (collectionName: string, documentId: string, label: string): WriteSpec => ({
  entry: { operation: 'delete', collectionName, documentId },
  label,
});

export function normalizeBudget(budget: Budget & { categoryLimits?: Record<string, number> }): Budget {
  const { categoryLimits: _legacyCategoryLimits, ...normalized } = budget;
  return normalized;
}

export const userProfileWrite = (profile: UserProfile) =>
  setSpec(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS, sanitizeUserProfileForFirestore(profile), 'Failed to sync user profile to Firestore');

export const transactionWrite = (tx: Transaction) =>
  setSpec(COLLECTION_TRANSACTIONS, tx.id, tx, 'Failed to sync transaction to Firestore');
export const transactionDelete = (id: string) =>
  deleteSpec(COLLECTION_TRANSACTIONS, id, 'Failed to delete transaction from Firestore');

export const quickEntryWrite = (entry: QuickEntry) =>
  setSpec(COLLECTION_QUICK_ENTRIES, entry.id, entry, 'Failed to sync quick entry to Firestore');
export const quickEntryDelete = (id: string) =>
  deleteSpec(COLLECTION_QUICK_ENTRIES, id, 'Failed to delete quick entry from Firestore');

export const categoryWrites = (categories: Category[]) =>
  categories.map(category => setSpec(COLLECTION_CATEGORIES, category.id, category, 'Failed to sync category to Firestore'));
export const categoryDelete = (id: string) =>
  deleteSpec(COLLECTION_CATEGORIES, id, 'Failed to delete category from Firestore');

export const budgetWrite = (normalizedBudget: Budget) =>
  setSpec(COLLECTION_BUDGETS, normalizedBudget.yearMonth, normalizedBudget, 'Failed to sync budget to Firestore');

export const recurringTemplateWrite = (template: RecurringTemplate) =>
  setSpec(COLLECTION_RECURRING_TEMPLATES, template.id, template, 'Failed to sync recurring template to Firestore');
export const recurringTemplateDelete = (id: string) =>
  deleteSpec(COLLECTION_RECURRING_TEMPLATES, id, 'Failed to delete recurring template from Firestore');

export const recurringOccurrenceWrites = (occurrences: RecurringOccurrence[]) =>
  occurrences.map(occurrence => setSpec(COLLECTION_RECURRING_OCCURRENCES, occurrence.id, occurrence, 'Failed to sync recurring occurrence to Firestore'));
export const recurringOccurrenceDeletes = (ids: string[]) =>
  ids.map(id => deleteSpec(COLLECTION_RECURRING_OCCURRENCES, id, 'Failed to delete recurring occurrence from Firestore'));

export const cycleBaselineWrite = (baseline: CycleBaseline) =>
  setSpec(COLLECTION_CYCLE_BASELINES, baseline.yearMonth, baseline, 'Failed to sync cycle baseline to Firestore');
export const cycleBaselineDelete = (yearMonth: string) =>
  deleteSpec(COLLECTION_CYCLE_BASELINES, yearMonth, 'Failed to delete cycle baseline from Firestore');

export const merchantRuleWrite = (rule: MerchantRule) =>
  setSpec(COLLECTION_MERCHANT_RULES, rule.id, rule, 'Failed to sync merchant rule to Firestore');

export const bankAccountWrite = (account: BankAccount) =>
  setSpec(COLLECTION_BANK_ACCOUNTS, account.id, account, 'Failed to sync bank account to Firestore');
export const bankAccountDelete = (id: string) =>
  deleteSpec(COLLECTION_BANK_ACCOUNTS, id, 'Failed to delete bank account from Firestore');

export const paymentCardWrite = (card: PaymentCard) =>
  setSpec(COLLECTION_PAYMENT_CARDS, card.id, card, 'Failed to sync payment card to Firestore');
export const paymentCardDelete = (id: string) =>
  deleteSpec(COLLECTION_PAYMENT_CARDS, id, 'Failed to delete payment card from Firestore');

export const conditionalOperationWrite = (input: {
  operationId: string;
  documents: ConditionalDocumentWrite[];
  changeRecord?: AmountChangeRecord;
}): WriteSpec => {
  const primary = input.documents[0];
  return {
    entry: {
      operation: 'conditional',
      collectionName: primary.collectionName,
      documentId: primary.documentId,
      operationId: input.operationId,
      documents: input.documents,
      changeRecord: input.changeRecord,
    },
    label: 'Conditional amount operation failed',
  };
};
