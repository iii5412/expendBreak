import {
  Transaction,
  Category,
  Budget,
  RecurringTemplate,
  RecurringOccurrence,
  MerchantRule,
  UserProfile,
  AIFeedbackResult,
} from '../types';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_MERCHANT_RULES,
  INITIAL_USER_PROFILE,
  getSampleRecurringTemplates,
  getSampleBudget,
} from '../data/initialData';
import { getLocalDateString, getYearMonthString } from './calculations';
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
  commitRecurringPosting,
  syncMerchantRuleToFirestore,
  syncBankAccountToFirestore,
  deleteBankAccountFromFirestore,
  syncPaymentCardToFirestore,
  deletePaymentCardFromFirestore,
  clearFirestoreAllData,
  hydrateFirestoreFromCloud,
  stopFirestoreSync,
} from './firestoreSync';
import { BankAccount, PaymentCard, PaymentMethodType } from '../types';
import { authenticatedFetch } from './auth';
import { getDefaultCategoryIdForType } from './categoryIntegrity';
import { clearAllReceiptImages, deleteReceiptImage } from './receiptStorage';

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

      await Promise.all([
        syncCategoriesToFirestore(categories),
        syncUserProfileToFirestore(INITIAL_USER_PROFILE),
        syncBudgetToFirestore(budget),
        ...DEFAULT_MERCHANT_RULES.map(rule => syncMerchantRuleToFirestore(rule)),
      ]);
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
function generateOccurrencesForMonth(yearMonth: string, templates: RecurringTemplate[]) {
  const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  let added = false;

  const toLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const adjustForWeekend = (dateText: string, policy: RecurringTemplate['holidayPolicy']) => {
    if (policy === 'fixed_date') return dateText;
    const [year, month, day] = dateText.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const direction = policy === 'previous_business_day' ? -1 : 1;
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + direction);
    return toLocalDate(date);
  };

  const scheduledDatesFor = (template: RecurringTemplate) => {
    const [year, month] = yearMonth.split('-').map(Number);
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

    if (template.endDate && template.endDate < monthStart) return [];
    if (template.startDate > monthEnd) return [];

    if (template.frequency === 'weekly') {
      const [startYear, startMonth, startDay] = template.startDate.split('-').map(Number);
      const cursor = new Date(startYear, startMonth - 1, startDay);
      while (toLocalDate(cursor) < monthStart) cursor.setDate(cursor.getDate() + 7);
      const dates: string[] = [];
      while (toLocalDate(cursor) <= monthEnd) {
        const dateText = toLocalDate(cursor);
        if (!template.endDate || dateText <= template.endDate) dates.push(adjustForWeekend(dateText, template.holidayPolicy));
        cursor.setDate(cursor.getDate() + 7);
      }
      return dates;
    }

    const clampedDay = Math.min(Math.max(1, template.dayOfMonth), lastDay);
    const dateText = `${yearMonth}-${String(clampedDay).padStart(2, '0')}`;
    if (dateText < template.startDate || (template.endDate && dateText > template.endDate)) return [];
    return [adjustForWeekend(dateText, template.holidayPolicy)];
  };

  for (const tmpl of templates) {
    if (!tmpl.active) continue;

    for (const scheduledDate of scheduledDatesFor(tmpl)) {
      const occurrenceKey = `${tmpl.id}_${scheduledDate}`;
      if (!occurrences.some(o => o.occurrenceKey === occurrenceKey)) {
        const now = new Date().toISOString();
        occurrences.push({
          id: `occ_${occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          templateId: tmpl.id,
          occurrenceKey,
          scheduledDate,
          expectedAmount: tmpl.defaultAmount,
          actualAmount: null,
          status: tmpl.postingMode === 'auto' ? 'scheduled' : 'needs_confirmation',
          typeSnapshot: tmpl.type,
          categoryIdSnapshot: tmpl.categoryId,
          templateRevision: tmpl.updatedAt,
          createdAt: now,
          updatedAt: now,
        });
        added = true;
      }
    }
  }

  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
  if (added && storageReady) syncRecurringOccurrencesToFirestore(occurrences);
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

export function saveTransaction(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Transaction {
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
  syncTransactionToFirestore(newTx);
  notifyListeners();
  return newTx;
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

export function deleteTransaction(id: string): boolean {
  let txs = getTransactions();
  const deletedTransaction = txs.find(transaction => transaction.id === id);
  const initialLen = txs.length;
  txs = txs.filter(t => t.id !== id);

  if (txs.length !== initialLen) {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs));
    deleteTransactionFromFirestore(id);
    if (deletedTransaction?.receipt?.storagePath) {
      deleteReceiptImage(deletedTransaction.receipt.storagePath).catch(error => {
        console.error('Failed to delete receipt image:', error);
      });
    }

    const occurrences = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
    let restoredOccurrence = false;
    occurrences.forEach(occurrence => {
      if (occurrence.transactionId !== id) return;
      occurrence.status = 'needs_confirmation';
      occurrence.transactionId = null;
      occurrence.updatedAt = new Date().toISOString();
      restoredOccurrence = true;
    });
    if (restoredOccurrence) {
      localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
      syncRecurringOccurrencesToFirestore(occurrences);
    }
    notifyListeners();
    return true;
  }
  return false;
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
  let occurrencesModified = false;
  occurrences.forEach(occurrence => {
    if (occurrence.categoryIdSnapshot !== removeId) return;
    occurrence.categoryIdSnapshot = replaceWithId;
    occurrence.updatedAt = new Date().toISOString();
    occurrencesModified = true;
  });
  if (occurrencesModified) {
    localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
    syncRecurringOccurrencesToFirestore(occurrences);
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
  if (!map[yearMonth]) {
    map[yearMonth] = getSampleBudget(yearMonth);
    localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(map));
    syncBudgetToFirestore(map[yearMonth]);
  }
  return map[yearMonth];
}

export function updateBudget(budget: Budget): void {
  const raw = localStorage.getItem(STORAGE_KEYS.BUDGETS);
  const map: Record<string, Budget> = raw ? JSON.parse(raw) : {};
  map[budget.yearMonth] = {
    ...budget,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(map));
  syncBudgetToFirestore(map[budget.yearMonth]);
  notifyListeners();
}

export function getRecurringTemplates(): RecurringTemplate[] {
  initializeStorageIfEmpty();
  return readJson<RecurringTemplate[]>(STORAGE_KEYS.RECURRING_TEMPLATES, []);
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

  // Auto-generate occurrence for current month
  generateOccurrencesForMonth(getYearMonthString(), [newTmpl]);

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

  tmpls[idx] = {
    ...tmpls[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(tmpls));
  syncRecurringTemplateToFirestore(tmpls[idx]);
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
    let changedOccurrences = false;
    occurrences.forEach(occurrence => {
      if (occurrence.templateId !== id || occurrence.status === 'posted') return;
      occurrence.status = 'skipped';
      occurrence.updatedAt = new Date().toISOString();
      changedOccurrences = true;
    });
    if (changedOccurrences) {
      localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
      syncRecurringOccurrencesToFirestore(occurrences);
    }
    notifyListeners();
    return true;
  }
  return false;
}

export function getRecurringOccurrences(yearMonth: string): RecurringOccurrence[] {
  initializeStorageIfEmpty();
  let all = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  
  // Ensure occurrences generated for requested month
  generateOccurrencesForMonth(yearMonth, getRecurringTemplates());
  
  all = readJson<RecurringOccurrence[]>(STORAGE_KEYS.RECURRING_OCCURRENCES, []);
  return all.filter(o => o.scheduledDate.startsWith(yearMonth));
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
    syncRecurringOccurrencesToFirestore(all);
    notifyListeners();
  }
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

export function exportTransactionsCSV(yearMonth?: string): string {
  const txs = getTransactions().filter(transaction => !yearMonth || transaction.localDate.startsWith(yearMonth));
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
  await clearAllReceiptImages();
  await clearFirestoreAllData();
  clearLocalAppData();
  storageReady = false;
  await initializeStorageAfterLogin();
}
