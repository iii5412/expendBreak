import {
  Transaction,
  Category,
  Budget,
  RecurringTemplate,
  RecurringOccurrence,
  MerchantRule,
  UserProfile,
  AIFeedbackResult,
  CycleBaseline,
  CycleBaselineFigures,
} from '../types';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_MERCHANT_RULES,
  INITIAL_USER_PROFILE,
  getSampleRecurringTemplates,
  getSampleBudget,
} from '../data/initialData';
import {
  getAccountingPeriod,
  getCurrentYearMonth,
  getLocalDateString,
  getYearMonthForDate,
  getYearMonthString,
  isDateInPeriod,
  normalizeMonthStartDay,
} from './calculations';
import {
  initFirestoreSync,
  syncUserProfileToFirestore,
  syncTransactionToFirestore,
  deleteTransactionFromFirestore,
  syncCategoriesToFirestore,
  deleteCategoryFromFirestore,
  syncBudgetToFirestore,
  syncRecurringTemplateToFirestore,
  deleteRecurringTemplateFromFirestore,
  syncRecurringOccurrencesToFirestore,
  deleteRecurringOccurrencesFromFirestore,
  commitRecurringPosting,
  syncMerchantRuleToFirestore,
  syncBankAccountToFirestore,
  deleteBankAccountFromFirestore,
  syncPaymentCardToFirestore,
  deletePaymentCardFromFirestore,
  syncCycleBaselineToFirestore,
  deleteCycleBaselineFromFirestore,
  clearFirestoreAllData,
  hydrateFirestoreFromCloud,
  stopFirestoreSync,
  flushFirestoreOutbox,
  clearFirestoreOutbox,
} from './firestoreSync';
import { BankAccount, PaymentCard, PaymentMethodType } from '../types';
import { authenticatedFetch } from './auth';
import { getDefaultCategoryIdForType } from './categoryIntegrity';
import { clearAllReceiptImages, deleteReceiptImage } from './receiptStorage';
import { getCarriedRecurringAmount } from './recurringPlans';
import { resolveInheritedAllowanceLimit } from './budgetPlans';
import { getScheduledDatesForMonth, normalizeRecurringOccurrencesForMonth } from './recurringNormalization';

const STORAGE_KEYS = {
  TRANSACTIONS: 'brake_transactions',
  CATEGORIES: 'brake_categories',
  BUDGETS: 'brake_budgets',
  RECURRING_TEMPLATES: 'brake_recurring_templates',
  RECURRING_OCCURRENCES: 'brake_recurring_occurrences',
  MERCHANT_RULES: 'brake_merchant_rules',
  USER_PROFILE: 'brake_user_profile',
  BANK_ACCOUNTS: 'brake_bank_accounts',
  PAYMENT_CARDS: 'brake_payment_cards',
  CYCLE_BASELINES: 'brake_cycle_baselines',
  AI_INSIGHTS: 'brake_ai_insights',
};

let storageReady = false;
let initializationPromise: Promise<void> | null = null;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch (error) {
    console.error(`Invalid local cache for ${key}:`, error);
    return fallback;
  }
}

export function clearLocalAppData() {
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}

// Event listener mechanism for reactive state updates
type StorageChangeListener = () => void;
const listeners: Set<StorageChangeListener> = new Set();

export function subscribeToStorage(listener: StorageChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  listeners.forEach(l => l());
}

/**
 * Authenticated boot sequence: migrate legacy root data, hydrate cloud state, then start listeners.
 * No caller should invoke this before Firebase PIN authentication succeeds.
 */
export function initializeStorageAfterLogin() {
  if (storageReady) return Promise.resolve();
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const migrationResponse = await authenticatedFetch('/api/migration/ensure', { method: 'POST' });
    if (!migrationResponse.ok) {
      const payload = await migrationResponse.json().catch(() => ({}));
      throw new Error(payload.message || '기존 운영 데이터 확인에 실패했습니다.');
    }

    const pendingWritesSaved = await flushFirestoreOutbox();
    if (!pendingWritesSaved) {
      throw new Error('이전에 저장하지 못한 변경사항을 DB에 반영하지 못했습니다. 네트워크 연결 후 다시 시도해 주세요.');
    }

    const { hasCloudData } = await hydrateFirestoreFromCloud();
    if (!hasCloudData) {
      const currentYM = getYearMonthString();
      const categories = [...DEFAULT_INCOME_CATEGORIES, ...DEFAULT_EXPENSE_CATEGORIES];
      const budget = getSampleBudget(currentYM);
      const templates = getSampleRecurringTemplates();

      localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
      localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(INITIAL_USER_PROFILE));
      localStorage.setItem(STORAGE_KEYS.MERCHANT_RULES, JSON.stringify(DEFAULT_MERCHANT_RULES));
      localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify({ [currentYM]: budget }));
      localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(templates));
      localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(generateSampleTransactionsForMonth(currentYM)));
      localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.PAYMENT_CARDS, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.CYCLE_BASELINES, JSON.stringify({}));

      const initializationWrites = await Promise.all([
        syncCategoriesToFirestore(categories),
        syncUserProfileToFirestore(INITIAL_USER_PROFILE),
        syncBudgetToFirestore(budget),
        ...DEFAULT_MERCHANT_RULES.map(rule => syncMerchantRuleToFirestore(rule)),
      ]);
      if (initializationWrites.some(result => !result)) {
        throw new Error('초기 설정을 DB에 저장하지 못했습니다. 네트워크 연결 후 다시 시도해 주세요.');
      }
    }

    // This app plans spending from salary day (10th) through the day before
    // the next salary. Persist the migration once so an existing cloud profile
    // does not keep using the old calendar-month default after refresh.
    const profile = readJson<UserProfile>(STORAGE_KEYS.USER_PROFILE, INITIAL_USER_PROFILE);
    if (profile.paydayPlanningVersion !== 1) {
      const migratedProfile: UserProfile = {
        ...profile,
        monthStartDay: 10,
        paydayPlanningVersion: 1,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(migratedProfile));
      const saved = await syncUserProfileToFirestore(migratedProfile);
      if (!saved) {
        throw new Error('급여일 10일 기준 예산 주기를 DB에 저장하지 못했습니다.');
      }
    }

    storageReady = true;
    initFirestoreSync(notifyListeners);
    notifyListeners();
  })().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
}

/** Legacy name retained for internal callers; it never starts network access. */
export function initializeStorageIfEmpty() {
  return storageReady;
}

export function shutdownStorage() {
  stopFirestoreSync();
  storageReady = false;
  initializationPromise = null;
  clearLocalAppData();
  notifyListeners();
}

/**
 * Generate recurring occurrences for a given YYYY-MM based on templates
 */
function generateOccurrencesForMonth(
  yearMonth: string,
  templates: RecurringTemplate[],
  monthStartDay: number = 1,
) {
  let occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  const changedOccurrences: RecurringOccurrence[] = [];

  const normalized = normalizeRecurringOccurrencesForMonth(
    occurrences,
    getRecurringTemplates(),
    yearMonth,
    monthStartDay,
  );
  occurrences = normalized.occurrences;

  for (const tmpl of templates) {
    if (!tmpl.active) continue;

    // A monthly item is paid once per salary cycle, not once per calendar month.
    // Scoping this to the calendar month silently swallowed the new cycle: an
    // item paid on the 5th blocked the one due on the 10th, the first day of the
    // cycle that follows it, and the payment never appeared anywhere.
    const postedCycles = tmpl.frequency === 'monthly'
      ? new Set(occurrences
        .filter(occurrence => occurrence.templateId === tmpl.id && occurrence.status === 'posted')
        .map(occurrence => getYearMonthForDate(occurrence.scheduledDate, monthStartDay)))
      : new Set<string>();

    for (const scheduledDate of getScheduledDatesForMonth(tmpl, yearMonth, monthStartDay)) {
      if (postedCycles.has(getYearMonthForDate(scheduledDate, monthStartDay))) continue;
      const occurrenceKey = `${tmpl.id}_${scheduledDate}`;
      const existingOccurrence = occurrences.find(o => o.occurrenceKey === occurrenceKey);
      if (!existingOccurrence) {
        const now = new Date().toISOString();
        // A recurring item is a monthly plan, not one immutable template
        // amount. Seed the new month from the latest saved month so utilities
        // and other variable fixed expenses carry forward until edited.
        const carriedAmount = getCarriedRecurringAmount(
          tmpl.id,
          tmpl.defaultAmount,
          scheduledDate,
          occurrences,
        );
        const newOccurrence: RecurringOccurrence = {
          id: `occ_${occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          templateId: tmpl.id,
          occurrenceKey,
          scheduledDate,
          expectedAmount: carriedAmount,
          actualAmount: null,
          status: tmpl.postingMode === 'auto' ? 'scheduled' : 'needs_confirmation',
          typeSnapshot: tmpl.type,
          categoryIdSnapshot: tmpl.categoryId,
          paymentMethodType: tmpl.paymentMethodType,
          accountId: tmpl.accountId,
          cardId: tmpl.cardId,
          templateRevision: tmpl.updatedAt,
          templateAmountSnapshot: tmpl.defaultAmount,
          createdAt: now,
          updatedAt: now,
        };
        occurrences.push(newOccurrence);
        changedOccurrences.push(newOccurrence);
      } else if (
        (existingOccurrence.status === 'scheduled'
          || existingOccurrence.status === 'needs_confirmation'
          || existingOccurrence.status === 'overdue')
        && existingOccurrence.templateRevision !== tmpl.updatedAt
      ) {
        // Any template edit bumps `updatedAt`, so only adopt the template amount
        // when the amount itself moved. Renaming an item or switching its card
        // must not wipe the amount carried forward or set for this month.
        const previousTemplateAmount = existingOccurrence.templateAmountSnapshot;
        if (previousTemplateAmount === undefined || previousTemplateAmount !== tmpl.defaultAmount) {
          existingOccurrence.expectedAmount = tmpl.defaultAmount;
        }
        existingOccurrence.templateAmountSnapshot = tmpl.defaultAmount;
        existingOccurrence.typeSnapshot = tmpl.type;
        existingOccurrence.categoryIdSnapshot = tmpl.categoryId;
        existingOccurrence.paymentMethodType = tmpl.paymentMethodType;
        existingOccurrence.accountId = tmpl.accountId;
        existingOccurrence.cardId = tmpl.cardId;
        existingOccurrence.templateRevision = tmpl.updatedAt;
        existingOccurrence.updatedAt = new Date().toISOString();
        changedOccurrences.push(existingOccurrence);
      }
    }
  }

  const changed = normalized.removedIds.length > 0 || changedOccurrences.length > 0;
  if (changed) localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
  if (storageReady) {
    if (normalized.removedIds.length > 0) void deleteRecurringOccurrencesFromFirestore(normalized.removedIds);
    // Persist only documents that actually changed. Rewriting the entire
    // occurrence history makes every realtime snapshot fan out into many writes.
    if (changedOccurrences.length > 0) void syncRecurringOccurrencesToFirestore(changedOccurrences);
  }
  return {
    changed,
    removedCount: normalized.removedIds.length,
    upsertedCount: changedOccurrences.length,
  };
}

/**
 * Generate starter sample transactions for immediate dashboard visualization
 */
function generateSampleTransactionsForMonth(_yearMonth: string): Transaction[] {
  return [];
}

// Getters & Setters
export function getTransactions(): Transaction[] {
  initializeStorageIfEmpty();
  return readJson<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, []);
}

export function getDefaultCategoryId(type: Transaction['type'], categories = getCategories()) {
  return getDefaultCategoryIdForType(categories, type);
}

export function getClassificationIssueSummary() {
  const categories = getCategories();
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const transactions = getTransactions();
  const templates = getRecurringTemplates();
  const templateIds = new Set(templates.map(template => template.id));
  const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);

  const invalidTransactions = transactions.filter(transaction => categoryMap.get(transaction.categoryId)?.type !== transaction.type);
  const invalidTemplates = templates.filter(template => categoryMap.get(template.categoryId)?.type !== template.type);
  const orphanOccurrences = occurrences.filter(occurrence => !templateIds.has(occurrence.templateId) && !occurrence.typeSnapshot);

  return {
    transactionCount: invalidTransactions.length,
    transactionAmount: invalidTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
    templateCount: invalidTemplates.length,
    orphanOccurrenceCount: orphanOccurrences.length,
    totalCount: invalidTransactions.length + invalidTemplates.length + orphanOccurrences.length,
  };
}

export function repairClassificationIssues() {
  const categories = getCategories();
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const transactions = getTransactions();
  const templates = getRecurringTemplates();
  const now = new Date().toISOString();
  let repairedTransactions = 0;
  let repairedTemplates = 0;

  transactions.forEach(transaction => {
    if (categoryMap.get(transaction.categoryId)?.type === transaction.type) return;
    const categoryId = getDefaultCategoryIdForType(categories, transaction.type);
    if (!categoryId) return;
    transaction.categoryId = categoryId;
    transaction.updatedAt = now;
    syncTransactionToFirestore(transaction);
    repairedTransactions += 1;
  });

  templates.forEach(template => {
    if (categoryMap.get(template.categoryId)?.type === template.type) return;
    const categoryId = getDefaultCategoryIdForType(categories, template.type);
    if (!categoryId) return;
    template.categoryId = categoryId;
    template.updatedAt = now;
    syncRecurringTemplateToFirestore(template);
    repairedTemplates += 1;
  });

  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(templates));
  notifyListeners();
  return { repairedTransactions, repairedTemplates };
}

function assertCategoryMatchesType(type: Transaction['type'], categoryId: string) {
  const category = getCategories().find(item => item.id === categoryId);
  if (!category) throw new Error('선택한 카테고리를 찾을 수 없습니다.');
  if (category.type !== type) {
    throw new Error(`${type === 'expense' ? '지출' : '수입'} 항목에는 같은 유형의 카테고리만 사용할 수 있습니다.`);
  }
}

export interface TransactionSaveResult {
  transaction: Transaction;
  /** Resolves false when the write stayed in the outbox instead of reaching Firestore. */
  synced: Promise<boolean>;
}

export function saveTransaction(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): TransactionSaveResult {
  assertCategoryMatchesType(tx.type, tx.categoryId);
  const txs = getTransactions();
  const now = new Date().toISOString();
  const newTx: Transaction = {
    ...tx,
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };

  txs.unshift(newTx);
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs));
  const synced = syncTransactionToFirestore(newTx);
  notifyListeners();
  return { transaction: newTx, synced };
}

/**
 * Re-inserts a transaction removed by {@link deleteTransaction} and re-links any
 * recurring occurrence that was reverted to `needs_confirmation` by the delete.
 */
export function restoreTransaction(transaction: Transaction, linkedOccurrenceIds: string[] = []): Transaction {
  const txs = getTransactions().filter(existing => existing.id !== transaction.id);
  txs.unshift(transaction);
  txs.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs));
  syncTransactionToFirestore(transaction);

  if (linkedOccurrenceIds.length > 0) {
    const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
    const now = new Date().toISOString();
    const changedOccurrences: RecurringOccurrence[] = [];
    occurrences.forEach(occurrence => {
      if (!linkedOccurrenceIds.includes(occurrence.id)) return;
      occurrence.status = 'posted';
      occurrence.transactionId = transaction.id;
      occurrence.updatedAt = now;
      changedOccurrences.push(occurrence);
    });
    if (changedOccurrences.length > 0) {
      localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
      syncRecurringOccurrencesToFirestore(changedOccurrences);
    }
  }

  notifyListeners();
  return transaction;
}

export function updateTransaction(id: string, updates: Partial<Transaction>): Transaction | null {
  const txs = getTransactions();
  const idx = txs.findIndex(t => t.id === id);
  if (idx === -1) return null;

  const nextType = updates.type ?? txs[idx].type;
  const nextCategoryId = updates.categoryId ?? txs[idx].categoryId;
  assertCategoryMatchesType(nextType, nextCategoryId);

  txs[idx] = {
    ...txs[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs));
  syncTransactionToFirestore(txs[idx]);
  notifyListeners();
  return txs[idx];
}

export interface DeletedTransactionSnapshot {
  transaction: Transaction;
  /** Occurrences reverted to `needs_confirmation` so undo can re-link them. */
  restoredOccurrenceIds: string[];
  /** Receipt image kept until the undo window closes. */
  receiptStoragePath: string | null;
}

/**
 * Removes a transaction and returns everything needed to undo it.
 * The receipt image is intentionally left in Storage; call
 * {@link finalizeTransactionDeletion} once the undo window expires.
 */
export function deleteTransaction(id: string): DeletedTransactionSnapshot | null {
  const txs = getTransactions();
  const deletedTransaction = txs.find(transaction => transaction.id === id);
  if (!deletedTransaction) return null;

  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs.filter(t => t.id !== id)));
  deleteTransactionFromFirestore(id);

  const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  const restoredOccurrenceIds: string[] = [];
  occurrences.forEach(occurrence => {
    if (occurrence.transactionId !== id) return;
    occurrence.status = 'needs_confirmation';
    occurrence.transactionId = null;
    occurrence.updatedAt = new Date().toISOString();
    restoredOccurrenceIds.push(occurrence.id);
  });
  if (restoredOccurrenceIds.length > 0) {
    localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
    syncRecurringOccurrencesToFirestore(
      occurrences.filter(occurrence => restoredOccurrenceIds.includes(occurrence.id)),
    );
  }

  notifyListeners();
  return {
    transaction: deletedTransaction,
    restoredOccurrenceIds,
    receiptStoragePath: deletedTransaction.receipt?.storagePath || null,
  };
}

/** Confirms a deletion after the undo window: removes the retained receipt image. */
export function finalizeTransactionDeletion(snapshot: DeletedTransactionSnapshot) {
  if (!snapshot.receiptStoragePath) return;
  deleteReceiptImage(snapshot.receiptStoragePath).catch(error => {
    console.error('Failed to delete receipt image:', error);
  });
}

export function getCategories(): Category[] {
  initializeStorageIfEmpty();
  return readJson<Category[]>(STORAGE_KEYS.CATEGORIES, []);
}

export function saveCategory(cat: Omit<Category, 'id'>): Category {
  const cats = getCategories();
  const newCat: Category = {
    ...cat,
    id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  };
  cats.push(newCat);
  localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cats));
  syncCategoriesToFirestore(cats);
  notifyListeners();
  return newCat;
}

export function toggleCategoryActive(id: string): boolean {
  const cats = getCategories();
  const target = cats.find(c => c.id === id);
  if (target) {
    target.active = !target.active;
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cats));
    syncCategoriesToFirestore(cats);
    notifyListeners();
    return true;
  }
  return false;
}

export function mergeAndRemoveCategory(removeId: string, replaceWithId: string): boolean {
  const categoryList = getCategories();
  const removeCategory = categoryList.find(category => category.id === removeId);
  const replacementCategory = categoryList.find(category => category.id === replaceWithId);
  if (!removeCategory || !replacementCategory || removeCategory.type !== replacementCategory.type) {
    throw new Error('같은 유형의 카테고리끼리만 병합할 수 있습니다.');
  }
  // Move all transactions using removeId to replaceWithId
  const txs = getTransactions();
  let modified = false;
  for (const t of txs) {
    if (t.categoryId === removeId) {
      t.categoryId = replaceWithId;
      syncTransactionToFirestore(t);
      modified = true;
    }
  }
  if (modified) {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs));
  }

  const templates = getRecurringTemplates();
  let templatesModified = false;
  templates.forEach(template => {
    if (template.categoryId !== removeId) return;
    template.categoryId = replaceWithId;
    template.updatedAt = new Date().toISOString();
    syncRecurringTemplateToFirestore(template);
    templatesModified = true;
  });
  if (templatesModified) localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(templates));

  const rules = getMerchantRules();
  let rulesModified = false;
  rules.forEach(rule => {
    if (rule.categoryId !== removeId) return;
    rule.categoryId = replaceWithId;
    syncMerchantRuleToFirestore(rule);
    rulesModified = true;
  });
  if (rulesModified) localStorage.setItem(STORAGE_KEYS.MERCHANT_RULES, JSON.stringify(rules));

  const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  const changedOccurrences: RecurringOccurrence[] = [];
  occurrences.forEach(occurrence => {
    if (occurrence.categoryIdSnapshot !== removeId) return;
    occurrence.categoryIdSnapshot = replaceWithId;
    occurrence.updatedAt = new Date().toISOString();
    changedOccurrences.push(occurrence);
  });
  if (changedOccurrences.length > 0) {
    localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
    syncRecurringOccurrencesToFirestore(changedOccurrences);
  }

  // Remove category
  const cats = getCategories().filter(c => c.id !== removeId);
  localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cats));
  syncCategoriesToFirestore(cats);
  deleteCategoryFromFirestore(removeId);
  notifyListeners();
  return true;
}

export function getBudget(yearMonth: string): Budget {
  initializeStorageIfEmpty();
  const map = readJson<Record<string, Budget>>(STORAGE_KEYS.BUDGETS, {});
  if (map[yearMonth]) return map[yearMonth];
  const profile = readJson<UserProfile>(STORAGE_KEYS.USER_PROFILE, INITIAL_USER_PROFILE);
  const inheritedLimit = resolveInheritedAllowanceLimit(
    yearMonth,
    Object.values(map),
    profile.defaultAllowanceLimit,
  );
  return {
    ...getSampleBudget(yearMonth),
    totalLimit: Math.max(0, Math.round(inheritedLimit)),
  };
}

const budgetEnsures = new Map<string, Promise<Budget>>();

/** Creates a missing monthly budget once; getBudget itself remains read-only. */
export function ensureBudget(yearMonth: string): Promise<Budget> {
  const existing = readJson<Record<string, Budget>>(STORAGE_KEYS.BUDGETS, {})[yearMonth];
  if (existing) return Promise.resolve(existing);
  const inFlight = budgetEnsures.get(yearMonth);
  if (inFlight) return inFlight;

  const budget = getBudget(yearMonth);
  const operation = (async () => {
    const map = readJson<Record<string, Budget>>(STORAGE_KEYS.BUDGETS, {});
    if (map[yearMonth]) return map[yearMonth];
    map[yearMonth] = budget;
    localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(map));
    notifyListeners();
    if (storageReady) await syncBudgetToFirestore(budget);
    return budget;
  })().finally(() => budgetEnsures.delete(yearMonth));
  budgetEnsures.set(yearMonth, operation);
  return operation;
}

export async function updateBudget(budget: Budget): Promise<Budget> {
  const raw = localStorage.getItem(STORAGE_KEYS.BUDGETS);
  const map: Record<string, Budget> = raw ? JSON.parse(raw) : {};
  const { categoryLimits: _legacyCategoryLimits, ...normalizedBudget } = budget as Budget & {
    categoryLimits?: Record<string, number>;
  };
  const updatedBudget = {
    ...normalizedBudget,
    updatedAt: new Date().toISOString(),
  };
  map[budget.yearMonth] = updatedBudget;
  localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(map));
  notifyListeners();
  const saved = await syncBudgetToFirestore(updatedBudget);
  if (!saved) {
    throw new Error('월 용돈 한도를 로컬에 보관했지만 DB 저장은 완료하지 못했습니다. 새로고침 시 자동으로 다시 저장합니다.');
  }
  const profile = getUserProfile();
  if (profile.defaultAllowanceLimit !== updatedBudget.totalLimit) {
    const updatedProfile = updateUserProfile({ defaultAllowanceLimit: updatedBudget.totalLimit });
    const profileSaved = await syncUserProfileToFirestore(updatedProfile);
    if (!profileSaved) {
      throw new Error('월 용돈 한도는 저장했지만 다음 달 승계용 기본값을 DB에 저장하지 못했습니다.');
    }
  }
  return updatedBudget;
}

export interface ReloadRecurringOccurrencesResult {
  removedCount: number;
  loadedCount: number;
}

/** Rebuilds only the selected period's unposted plan from the current templates. */
export async function reloadRecurringOccurrences(
  yearMonth: string,
  monthStartDay: number = 1,
): Promise<ReloadRecurringOccurrencesResult> {
  initializeStorageIfEmpty();
  const period = getAccountingPeriod(yearMonth, monthStartDay);
  const all = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  const resetIds = all
    .filter(occurrence => isDateInPeriod(occurrence.scheduledDate, period) && occurrence.status !== 'posted')
    .map(occurrence => occurrence.id);
  const resetIdSet = new Set(resetIds);
  const preserved = all.filter(occurrence => !resetIdSet.has(occurrence.id));

  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(preserved));
  if (resetIds.length > 0) await deleteRecurringOccurrencesFromFirestore(resetIds);

  const templates = getRecurringTemplates();
  generateOccurrencesForMonth(period.startDate.slice(0, 7), templates, period.monthStartDay);
  if (period.endDate.slice(0, 7) !== period.startDate.slice(0, 7)) {
    generateOccurrencesForMonth(period.endDate.slice(0, 7), templates, period.monthStartDay);
  }

  const loadedCount = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, [])
    .filter(occurrence => isDateInPeriod(occurrence.scheduledDate, period) && occurrence.status !== 'posted')
    .length;
  notifyListeners();
  return { removedCount: resetIds.length, loadedCount };
}

export function getRecurringTemplates(): RecurringTemplate[] {
  initializeStorageIfEmpty();
  return readJson<RecurringTemplate[]>(STORAGE_KEYS.RECURRING_TEMPLATES, []);
}

/**
 * Pushes a template edit onto the monthly plans that have not happened yet.
 *
 * The lists show the occurrence amount, not `defaultAmount`, so without this an
 * edited price stayed invisible: the occurrence kept whatever it carried
 * forward. A changed amount therefore also drops the month-specific override —
 * the user just said what this item costs now. Past cycles and posted items are
 * history and stay untouched.
 */
function applyTemplateToPendingOccurrences(
  template: RecurringTemplate,
  previousAmount: number,
  monthStartDay: number,
) {
  const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  const fromDate = getAccountingPeriod(getCurrentYearMonth(monthStartDay), monthStartDay).startDate;
  const amountChanged = Math.round(previousAmount) !== Math.round(template.defaultAmount);
  const now = new Date().toISOString();
  const changed: RecurringOccurrence[] = [];

  occurrences.forEach(occurrence => {
    if (occurrence.templateId !== template.id) return;
    if (occurrence.status === 'posted' || occurrence.status === 'skipped') return;
    if (occurrence.scheduledDate < fromDate) return;

    if (amountChanged) {
      occurrence.expectedAmount = Math.round(template.defaultAmount);
      occurrence.actualAmount = null;
    }
    occurrence.templateAmountSnapshot = template.defaultAmount;
    occurrence.typeSnapshot = template.type;
    occurrence.categoryIdSnapshot = template.categoryId;
    occurrence.paymentMethodType = template.paymentMethodType;
    occurrence.accountId = template.accountId;
    occurrence.cardId = template.cardId;
    occurrence.templateRevision = template.updatedAt;
    occurrence.updatedAt = now;
    changed.push(occurrence);
  });

  if (changed.length === 0) return;
  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
  void syncRecurringOccurrencesToFirestore(changed);
}

export function saveRecurringTemplate(tmpl: Omit<RecurringTemplate, 'id' | 'createdAt' | 'updatedAt'>): RecurringTemplate {
  assertCategoryMatchesType(tmpl.type, tmpl.categoryId);
  const tmpls = getRecurringTemplates();
  const now = new Date().toISOString();
  const newTmpl: RecurringTemplate = {
    ...tmpl,
    id: `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };
  tmpls.push(newTmpl);
  localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(tmpls));
  syncRecurringTemplateToFirestore(newTmpl);

  // Materialize the plan for the salary cycle in progress. That cycle can span
  // two calendar months, and a due date early in the month belongs to the later
  // one, so both are generated.
  const monthStartDay = normalizeMonthStartDay(getUserProfile().monthStartDay);
  const period = getAccountingPeriod(getCurrentYearMonth(monthStartDay), monthStartDay);
  generateOccurrencesForMonth(period.startDate.slice(0, 7), [newTmpl], monthStartDay);
  if (period.endDate.slice(0, 7) !== period.startDate.slice(0, 7)) {
    generateOccurrencesForMonth(period.endDate.slice(0, 7), [newTmpl], monthStartDay);
  }

  notifyListeners();
  return newTmpl;
}

export function updateRecurringTemplate(id: string, updates: Partial<RecurringTemplate>): RecurringTemplate | null {
  const tmpls = getRecurringTemplates();
  const idx = tmpls.findIndex(t => t.id === id);
  if (idx === -1) return null;

  const nextType = updates.type ?? tmpls[idx].type;
  const nextCategoryId = updates.categoryId ?? tmpls[idx].categoryId;
  assertCategoryMatchesType(nextType, nextCategoryId);

  const previousAmount = tmpls[idx].defaultAmount;
  tmpls[idx] = {
    ...tmpls[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(tmpls));
  syncRecurringTemplateToFirestore(tmpls[idx]);
  applyTemplateToPendingOccurrences(
    tmpls[idx],
    previousAmount,
    normalizeMonthStartDay(getUserProfile().monthStartDay),
  );
  notifyListeners();
  return tmpls[idx];
}

export function deleteRecurringTemplate(id: string): boolean {
  let tmpls = getRecurringTemplates();
  const initialLen = tmpls.length;
  tmpls = tmpls.filter(t => t.id !== id);

  if (tmpls.length !== initialLen) {
    localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(tmpls));
    deleteRecurringTemplateFromFirestore(id);

    const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
    const changedOccurrences: RecurringOccurrence[] = [];
    occurrences.forEach(occurrence => {
      if (occurrence.templateId !== id || occurrence.status === 'posted') return;
      occurrence.status = 'skipped';
      occurrence.updatedAt = new Date().toISOString();
      changedOccurrences.push(occurrence);
    });
    if (changedOccurrences.length > 0) {
      localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
      syncRecurringOccurrencesToFirestore(changedOccurrences);
    }
    notifyListeners();
    return true;
  }
  return false;
}

export function getRecurringOccurrences(yearMonth: string, monthStartDay: number = 1): RecurringOccurrence[] {
  initializeStorageIfEmpty();
  const period = getAccountingPeriod(yearMonth, monthStartDay);
  const all = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  return all.filter(o => isDateInPeriod(o.scheduledDate, period));
}

/** All generated months, used when a card bill needs the prior month's plans. */
export function getAllRecurringOccurrences(): RecurringOccurrence[] {
  initializeStorageIfEmpty();
  return readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
}

/**
 * Explicit mutation boundary for period generation/normalization. Realtime
 * snapshot callbacks may call the getters freely without causing DB writes.
 */
export function ensureRecurringOccurrences(yearMonth: string, monthStartDay: number = 1) {
  initializeStorageIfEmpty();
  const period = getAccountingPeriod(yearMonth, monthStartDay);
  const templates = getRecurringTemplates();
  const startResult = generateOccurrencesForMonth(
    period.startDate.slice(0, 7), templates, period.monthStartDay,
  );
  const endResult = period.endDate.slice(0, 7) !== period.startDate.slice(0, 7)
    ? generateOccurrencesForMonth(period.endDate.slice(0, 7), templates, period.monthStartDay)
    : { changed: false, removedCount: 0, upsertedCount: 0 };
  if (startResult.changed || endResult.changed) notifyListeners();
  return {
    removedCount: startResult.removedCount + endResult.removedCount,
    upsertedCount: startResult.upsertedCount + endResult.upsertedCount,
  };
}

export function updateOccurrenceStatus(
  occurrenceId: string,
  status: RecurringOccurrence['status'],
  actualAmount?: number
): void {
  const raw = localStorage.getItem(STORAGE_KEYS.RECURRING_OCCURRENCES);
  if (!raw) return;
  const all: RecurringOccurrence[] = JSON.parse(raw);
  const target = all.find(o => o.id === occurrenceId);
  
  if (target) {
    target.status = status;
    if (actualAmount !== undefined) {
      target.actualAmount = actualAmount;
    }
    target.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(all));
    syncRecurringOccurrencesToFirestore([target]);
    notifyListeners();
  }
}

/** Saves a month-specific recurring plan without posting a transaction. */
export function updateOccurrencePlan(
  occurrenceId: string,
  updates: {
    amount: number;
    paymentMethodType?: PaymentMethodType;
    accountId?: string | null;
    cardId?: string | null;
  },
): RecurringOccurrence | null {
  const raw = localStorage.getItem(STORAGE_KEYS.RECURRING_OCCURRENCES);
  if (!raw) return null;
  const all: RecurringOccurrence[] = JSON.parse(raw);
  const target = all.find(occurrence => occurrence.id === occurrenceId);
  const amount = Math.round(Number(updates.amount));
  if (!target || target.status === 'posted' || !Number.isFinite(amount) || amount < 0) return null;

  target.actualAmount = amount;
  if (updates.paymentMethodType) target.paymentMethodType = updates.paymentMethodType;
  target.accountId = updates.paymentMethodType === 'account' ? updates.accountId ?? null : null;
  target.cardId = updates.paymentMethodType === 'card' ? updates.cardId ?? null : null;
  target.updatedAt = new Date().toISOString();
  const changedOccurrences = [target];

  // If future months were already opened/generated, keep carrying this value
  // through months that have not received their own override yet.
  all.forEach(occurrence => {
    if (occurrence.templateId !== target.templateId
      || occurrence.scheduledDate <= target.scheduledDate
      || occurrence.actualAmount !== null
      || occurrence.status === 'posted'
      || occurrence.status === 'skipped') return;
    occurrence.expectedAmount = amount;
    occurrence.updatedAt = target.updatedAt;
    changedOccurrences.push(occurrence);
  });
  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(all));
  syncRecurringOccurrencesToFirestore(changedOccurrences);
  notifyListeners();
  return target;
}

export async function postOccurrenceToTransaction(
  occurrenceId: string,
  customAmount?: number,
  customPaymentMethodType?: PaymentMethodType,
  customAccountId?: string | null,
  customCardId?: string | null
): Promise<Transaction | null> {
  const raw = localStorage.getItem(STORAGE_KEYS.RECURRING_OCCURRENCES);
  if (!raw) return null;
  const all: RecurringOccurrence[] = JSON.parse(raw);
  const target = all.find(o => o.id === occurrenceId);
  if (!target || target.status === 'posted') return null;

  const templates = getRecurringTemplates();
  const template = templates.find(t => t.id === target.templateId);
  if (!template) return null;

  const amount = customAmount ?? target.actualAmount ?? target.expectedAmount;
  const paymentMethodType = customPaymentMethodType ?? target.paymentMethodType ?? template.paymentMethodType;
  const accountId = customAccountId ?? target.accountId ?? template.accountId;
  const cardId = customCardId ?? target.cardId ?? template.cardId;
  const occurrenceType = target.typeSnapshot ?? template.type;
  const occurrenceCategoryId = target.categoryIdSnapshot ?? template.categoryId;

  try {
    assertCategoryMatchesType(occurrenceType, occurrenceCategoryId);
  } catch (error) {
    console.error('Recurring occurrence requires category review:', error);
    return null;
  }

  const now = new Date().toISOString();
  const transactionId = `tx_recurring_${target.occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const newTx: Transaction = {
    id: transactionId,
    type: occurrenceType,
    amount,
    occurredAt: `${target.scheduledDate}T10:00:00.000Z`,
    localDate: target.scheduledDate,
    categoryId: occurrenceCategoryId,
    merchant: template.counterparty || template.name,
    memo: `[정기] ${template.name}`,
    source: 'manual',
    recurringTemplateId: template.id,
    recurringOccurrenceKey: target.occurrenceKey,
    paymentMethodType,
    accountId,
    cardId,
    createdAt: now,
    updatedAt: now,
  };

  // Mark occurrence as posted
  target.status = 'posted';
  target.actualAmount = amount;
  target.paymentMethodType = paymentMethodType;
  target.accountId = accountId;
  target.cardId = cardId;
  target.transactionId = newTx.id;
  target.updatedAt = now;

  try {
    await commitRecurringPosting(newTx, target);
  } catch (error) {
    console.error('Atomic recurring posting failed:', error);
    return null;
  }

  const transactions = getTransactions().filter(transaction => transaction.id !== newTx.id);
  transactions.unshift(newTx);
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(all));

  notifyListeners();
  return newTx;
}

/**
 * Records a card bill as paid: a `card_settlement` transaction plus the card's
 * status for that cycle.
 *
 * The transaction exists so the withdrawal appears in history and in the account
 * ledger, but it carries `role: 'card_settlement'` and is therefore excluded
 * from every spend total — the purchases behind it were already counted in the
 * cycle they happened (INV-2). Un-marking removes it again.
 */
export function setCardSettlementPaid(
  cardId: string,
  yearMonth: string,
  amount: number,
  paymentDate: string,
  paid: boolean,
): Transaction | null {
  const card = getPaymentCards().find(candidate => candidate.id === cardId);
  if (!card) return null;

  const transactionId = `tx_card_settlement_${cardId}_${yearMonth}`;
  const transactions = getTransactions().filter(transaction => transaction.id !== transactionId);
  const paidAmount = Math.max(0, Math.round(amount));

  updatePaymentCard(cardId, {
    monthlyPaymentStatuses: {
      ...(card.monthlyPaymentStatuses || {}),
      [yearMonth]: paid ? 'paid' : 'scheduled',
    },
    // A paid bill is a fact, not a forecast. Without pinning the amount the
    // screens keep re-estimating it from card usage, so the recorded withdrawal
    // and the bill shown for that cycle drift apart.
    ...(paid
      ? {
          monthlyPaymentAmounts: {
            ...(card.monthlyPaymentAmounts || {}),
            [yearMonth]: paidAmount,
          },
        }
      : {}),
  });

  if (!paid) {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
    deleteTransactionFromFirestore(transactionId);
    notifyListeners();
    return null;
  }

  const now = new Date().toISOString();
  const settlement: Transaction = {
    id: transactionId,
    type: 'expense',
    amount: paidAmount,
    occurredAt: `${paymentDate}T12:00:00.000Z`,
    localDate: paymentDate,
    categoryId: getDefaultCategoryIdForType(getCategories(), 'expense') || 'etc_expense',
    merchant: `${card.cardName} 카드대금`,
    memo: `[카드대금] ${yearMonth} 결제분`,
    source: 'manual',
    role: 'card_settlement',
    settlementYearMonth: yearMonth,
    paymentMethodType: 'account',
    accountId: card.linkedAccountId ?? null,
    cardId,
    createdAt: now,
    updatedAt: now,
  };

  transactions.unshift(settlement);
  transactions.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  syncTransactionToFirestore(settlement);
  notifyListeners();
  return settlement;
}

// Cycle baseline: the living budget frozen on payday (INV-4).
export function getCycleBaselines(): Record<string, CycleBaseline> {
  initializeStorageIfEmpty();
  return readJson<Record<string, CycleBaseline>>(STORAGE_KEYS.CYCLE_BASELINES, {});
}

export function getCycleBaseline(yearMonth: string): CycleBaseline | null {
  return getCycleBaselines()[yearMonth] || null;
}

/**
 * Locks a cycle's plan. Re-locking keeps the previous figures as a revision so
 * the user can see what changed and when, rather than the number silently moving.
 */
export async function saveCycleBaseline(
  yearMonth: string,
  figures: Omit<CycleBaselineFigures, 'lockedAt'>,
): Promise<CycleBaseline> {
  const baselines = getCycleBaselines();
  const existing = baselines[yearMonth];
  const now = new Date().toISOString();
  const baseline: CycleBaseline = {
    yearMonth,
    ...figures,
    lockedAt: now,
    revisions: existing
      ? [...(existing.revisions || []), {
          confirmedIncome: existing.confirmedIncome,
          accountFixedOutflow: existing.accountFixedOutflow,
          cardSettlement: existing.cardSettlement,
          savingsReserve: existing.savingsReserve,
          livingBudget: existing.livingBudget,
          lockedAt: existing.lockedAt,
        }]
      : [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  baselines[yearMonth] = baseline;
  localStorage.setItem(STORAGE_KEYS.CYCLE_BASELINES, JSON.stringify(baselines));
  notifyListeners();

  const saved = await syncCycleBaselineToFirestore(baseline);
  if (!saved) {
    throw new Error('이번 주기 생활비 계획을 이 기기에 저장했지만 DB 반영은 완료하지 못했습니다. 연결이 복구되면 자동으로 다시 저장합니다.');
  }
  return baseline;
}

/** Reopens a cycle so the payday flow can run again. */
export async function clearCycleBaseline(yearMonth: string): Promise<void> {
  const baselines = getCycleBaselines();
  if (!baselines[yearMonth]) return;
  delete baselines[yearMonth];
  localStorage.setItem(STORAGE_KEYS.CYCLE_BASELINES, JSON.stringify(baselines));
  notifyListeners();
  await deleteCycleBaselineFromFirestore(yearMonth);
}

export function getMerchantRules(): MerchantRule[] {
  initializeStorageIfEmpty();
  return readJson<MerchantRule[]>(STORAGE_KEYS.MERCHANT_RULES, []);
}

export function saveMerchantRule(pattern: string, categoryId: string): MerchantRule {
  const rules = getMerchantRules();
  const existing = rules.find(r => r.pattern.toLowerCase() === pattern.toLowerCase());
  if (existing) {
    existing.categoryId = categoryId;
    localStorage.setItem(STORAGE_KEYS.MERCHANT_RULES, JSON.stringify(rules));
    syncMerchantRuleToFirestore(existing);
    notifyListeners();
    return existing;
  }

  const newRule: MerchantRule = {
    id: `rule_${Date.now()}`,
    pattern,
    categoryId,
    createdAt: new Date().toISOString(),
  };
  rules.unshift(newRule);
  localStorage.setItem(STORAGE_KEYS.MERCHANT_RULES, JSON.stringify(rules));
  syncMerchantRuleToFirestore(newRule);
  notifyListeners();
  return newRule;
}

export function getUserProfile(): UserProfile {
  initializeStorageIfEmpty();
  const profile = readJson<UserProfile>(STORAGE_KEYS.USER_PROFILE, INITIAL_USER_PROFILE);
  const { accessPin: _legacyPin, ...safeProfile } = profile;
  return { ...safeProfile, securityPinEnabled: true } as UserProfile;
}

export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const current = getUserProfile();
  const { accessPin: _ignoredPin, ...safeUpdates } = updates;
  const updated = {
    ...current,
    ...safeUpdates,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(updated));
  syncUserProfileToFirestore(updated);
  notifyListeners();
  return updated;
}

export function getCachedAIFeedback(periodId: string): AIFeedbackResult | null {
  const map = readJson<Record<string, AIFeedbackResult>>(STORAGE_KEYS.AI_INSIGHTS, {});
  return map[periodId] || null;
}

export function saveCachedAIFeedback(periodId: string, feedback: AIFeedbackResult) {
  const raw = localStorage.getItem(STORAGE_KEYS.AI_INSIGHTS);
  const map: Record<string, AIFeedbackResult> = raw ? JSON.parse(raw) : {};
  map[periodId] = feedback;
  localStorage.setItem(STORAGE_KEYS.AI_INSIGHTS, JSON.stringify(map));
}

export function exportTransactionsCSV(yearMonth?: string, monthStartDay: number = 1): string {
  const period = yearMonth ? getAccountingPeriod(yearMonth, monthStartDay) : null;
  const txs = getTransactions().filter(transaction => !period || isDateInPeriod(transaction.localDate, period));
  const cats = getCategories();
  const catMap = new Map(cats.map(c => [c.id, c.name]));
  const csvCell = (value: string | number) => {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const headers = ['날짜', '유형', '금액(KRW)', '카테고리', '사용처/거래처', '메모', '생활태그', '입력방식', '영수증번호', '영수증품목'];
  const rows = txs.map(t => [
    csvCell(t.localDate),
    csvCell(t.type === 'income' ? '수입' : '지출'),
    csvCell(t.amount),
    csvCell(catMap.get(t.categoryId) || '기타'),
    csvCell(t.merchant || ''),
    csvCell(t.memo || ''),
    csvCell((t.tags || []).join('|')),
    csvCell(t.source === 'receipt' ? '영수증OCR' : t.source === 'ai' ? 'AI자동' : '직접입력'),
    csvCell(t.receipt?.receiptNumber || ''),
    csvCell((t.receipt?.lineItems || []).map(item => item.name).join('|')),
  ]);

  return '\uFEFF' + [headers.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\n');
}

// Bank Account CRUD
export function getBankAccounts(): BankAccount[] {
  initializeStorageIfEmpty();
  return readJson<BankAccount[]>(STORAGE_KEYS.BANK_ACCOUNTS, []);
}

export function saveBankAccount(acc: Omit<BankAccount, 'id' | 'createdAt' | 'updatedAt'>): BankAccount {
  const accounts = getBankAccounts();
  const now = new Date().toISOString();
  const newAcc: BankAccount = {
    ...acc,
    balanceAsOf: acc.balanceAsOf || getLocalDateString(),
    balanceUpdatedAt: now,
    id: `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };
  accounts.push(newAcc);
  localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify(accounts));
  syncBankAccountToFirestore(newAcc);
  notifyListeners();
  return newAcc;
}

export function updateBankAccount(id: string, updates: Partial<BankAccount>): BankAccount | null {
  const accounts = getBankAccounts();
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) return null;

  accounts[idx] = {
    ...accounts[idx],
    ...updates,
    ...(updates.balance !== undefined && updates.balance !== accounts[idx].balance
      ? { balanceAsOf: updates.balanceAsOf || getLocalDateString(), balanceUpdatedAt: new Date().toISOString() }
      : {}),
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify(accounts));
  syncBankAccountToFirestore(accounts[idx]);
  notifyListeners();
  return accounts[idx];
}

export function deleteBankAccount(id: string): boolean {
  const isReferenced = getPaymentCards().some(card => card.linkedAccountId === id)
    || getRecurringTemplates().some(template => template.accountId === id)
    || getTransactions().some(transaction => transaction.accountId === id);
  if (isReferenced) return false;

  let accounts = getBankAccounts();
  const initialLen = accounts.length;
  accounts = accounts.filter(a => a.id !== id);

  if (accounts.length !== initialLen) {
    localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify(accounts));
    deleteBankAccountFromFirestore(id);
    notifyListeners();
    return true;
  }
  return false;
}

// Payment Card CRUD
export function getPaymentCards(): PaymentCard[] {
  initializeStorageIfEmpty();
  return readJson<PaymentCard[]>(STORAGE_KEYS.PAYMENT_CARDS, []);
}

export function savePaymentCard(card: Omit<PaymentCard, 'id' | 'createdAt' | 'updatedAt'>): PaymentCard {
  const cards = getPaymentCards();
  const now = new Date().toISOString();
  const newCard: PaymentCard = {
    ...card,
    id: `card_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };
  cards.push(newCard);
  localStorage.setItem(STORAGE_KEYS.PAYMENT_CARDS, JSON.stringify(cards));
  syncPaymentCardToFirestore(newCard);
  notifyListeners();
  return newCard;
}

export function updatePaymentCard(id: string, updates: Partial<PaymentCard>): PaymentCard | null {
  const cards = getPaymentCards();
  const idx = cards.findIndex(c => c.id === id);
  if (idx === -1) return null;

  cards[idx] = {
    ...cards[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEYS.PAYMENT_CARDS, JSON.stringify(cards));
  syncPaymentCardToFirestore(cards[idx]);
  notifyListeners();
  return cards[idx];
}

export function deletePaymentCard(id: string): boolean {
  const isReferenced = getRecurringTemplates().some(template => template.cardId === id)
    || getTransactions().some(transaction => transaction.cardId === id);
  if (isReferenced) return false;

  let cards = getPaymentCards();
  const initialLen = cards.length;
  cards = cards.filter(c => c.id !== id);

  if (cards.length !== initialLen) {
    localStorage.setItem(STORAGE_KEYS.PAYMENT_CARDS, JSON.stringify(cards));
    deletePaymentCardFromFirestore(id);
    notifyListeners();
    return true;
  }
  return false;
}

export async function resetAllData(): Promise<void> {
  stopFirestoreSync();
  await flushFirestoreOutbox();
  await clearAllReceiptImages();
  await clearFirestoreAllData();
  clearFirestoreOutbox();
  clearLocalAppData();
  storageReady = false;
  await initializeStorageAfterLogin();
}
