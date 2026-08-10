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
  syncBudgetToFirestore,
  syncRecurringTemplateToFirestore,
  deleteRecurringTemplateFromFirestore,
  syncRecurringOccurrencesToFirestore,
  syncMerchantRuleToFirestore,
  syncBankAccountToFirestore,
  deleteBankAccountFromFirestore,
  syncPaymentCardToFirestore,
  deletePaymentCardFromFirestore,
  clearFirestoreAllData,
} from './firestoreSync';
import { BankAccount, PaymentCard, PaymentMethodType } from '../types';

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
 * Initialize storage with clean sample data if empty
 */
export function initializeStorageIfEmpty() {
  initFirestoreSync(notifyListeners);

  if (!localStorage.getItem(STORAGE_KEYS.CATEGORIES)) {
    const allCategories = [...DEFAULT_INCOME_CATEGORIES, ...DEFAULT_EXPENSE_CATEGORIES];
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(allCategories));
    syncCategoriesToFirestore(allCategories);
  }

  if (!localStorage.getItem(STORAGE_KEYS.USER_PROFILE)) {
    localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(INITIAL_USER_PROFILE));
    syncUserProfileToFirestore(INITIAL_USER_PROFILE);
  }

  if (!localStorage.getItem(STORAGE_KEYS.MERCHANT_RULES)) {
    localStorage.setItem(STORAGE_KEYS.MERCHANT_RULES, JSON.stringify(DEFAULT_MERCHANT_RULES));
  }

  const currentYM = getYearMonthString();
  if (!localStorage.getItem(STORAGE_KEYS.BUDGETS)) {
    const budgetMap: Record<string, Budget> = {
      [currentYM]: getSampleBudget(currentYM),
    };
    localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgetMap));
  }

  if (!localStorage.getItem(STORAGE_KEYS.RECURRING_TEMPLATES)) {
    const templates = getSampleRecurringTemplates();
    localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(templates));
    generateOccurrencesForMonth(currentYM, templates);
  }

  if (!localStorage.getItem(STORAGE_KEYS.TRANSACTIONS)) {
    const sampleTransactions = generateSampleTransactionsForMonth(currentYM);
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(sampleTransactions));
  }
}

/**
 * Generate recurring occurrences for a given YYYY-MM based on templates
 */
function generateOccurrencesForMonth(yearMonth: string, templates: RecurringTemplate[]) {
  const existingStr = localStorage.getItem(STORAGE_KEYS.RECURRING_OCCURRENCES);
  let occurrences: RecurringOccurrence[] = existingStr ? JSON.parse(existingStr) : [];

  for (const tmpl of templates) {
    if (!tmpl.active) continue;

    // e.g. occurrenceKey = tmpl.id + '_' + yearMonth + '-' + day
    const day = String(tmpl.dayOfMonth).padStart(2, '0');
    const scheduledDate = `${yearMonth}-${day}`;
    const occurrenceKey = `${tmpl.id}_${scheduledDate}`;

    if (!occurrences.some(o => o.occurrenceKey === occurrenceKey)) {
      occurrences.push({
        id: `occ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        templateId: tmpl.id,
        occurrenceKey,
        scheduledDate,
        expectedAmount: tmpl.defaultAmount,
        actualAmount: null,
        status: tmpl.postingMode === 'auto' ? 'scheduled' : 'needs_confirmation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
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
  const raw = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
  return raw ? JSON.parse(raw) : [];
}

export function saveTransaction(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Transaction {
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
  const initialLen = txs.length;
  txs = txs.filter(t => t.id !== id);

  if (txs.length !== initialLen) {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs));
    deleteTransactionFromFirestore(id);
    notifyListeners();
    return true;
  }
  return false;
}

export function getCategories(): Category[] {
  initializeStorageIfEmpty();
  const raw = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
  return raw ? JSON.parse(raw) : [];
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

  // Remove category
  const cats = getCategories().filter(c => c.id !== removeId);
  localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cats));
  syncCategoriesToFirestore(cats);
  notifyListeners();
  return true;
}

export function getBudget(yearMonth: string): Budget {
  initializeStorageIfEmpty();
  const raw = localStorage.getItem(STORAGE_KEYS.BUDGETS);
  const map: Record<string, Budget> = raw ? JSON.parse(raw) : {};
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
  const raw = localStorage.getItem(STORAGE_KEYS.RECURRING_TEMPLATES);
  return raw ? JSON.parse(raw) : [];
}

export function saveRecurringTemplate(tmpl: Omit<RecurringTemplate, 'id' | 'createdAt' | 'updatedAt'>): RecurringTemplate {
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
    notifyListeners();
    return true;
  }
  return false;
}

export function getRecurringOccurrences(yearMonth: string): RecurringOccurrence[] {
  initializeStorageIfEmpty();
  const raw = localStorage.getItem(STORAGE_KEYS.RECURRING_OCCURRENCES);
  let all: RecurringOccurrence[] = raw ? JSON.parse(raw) : [];
  
  // Ensure occurrences generated for requested month
  generateOccurrencesForMonth(yearMonth, getRecurringTemplates());
  
  const rawUpdated = localStorage.getItem(STORAGE_KEYS.RECURRING_OCCURRENCES);
  all = rawUpdated ? JSON.parse(rawUpdated) : [];
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

export function postOccurrenceToTransaction(
  occurrenceId: string,
  customAmount?: number,
  customPaymentMethodType?: PaymentMethodType,
  customAccountId?: string | null,
  customCardId?: string | null
): Transaction | null {
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

  // Create Transaction
  const newTx = saveTransaction({
    type: template.type,
    amount,
    occurredAt: `${target.scheduledDate}T10:00:00.000Z`,
    localDate: target.scheduledDate,
    categoryId: template.categoryId,
    merchant: template.counterparty || template.name,
    memo: `[정기] ${template.name}`,
    source: 'manual',
    recurringTemplateId: template.id,
    recurringOccurrenceKey: target.occurrenceKey,
    paymentMethodType,
    accountId,
    cardId,
  });

  // Mark occurrence as posted
  target.status = 'posted';
  target.actualAmount = amount;
  target.paymentMethodType = paymentMethodType;
  target.accountId = accountId;
  target.cardId = cardId;
  target.transactionId = newTx.id;
  target.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(all));
  syncRecurringOccurrencesToFirestore(all);

  notifyListeners();
  return newTx;
}

export function getMerchantRules(): MerchantRule[] {
  initializeStorageIfEmpty();
  const raw = localStorage.getItem(STORAGE_KEYS.MERCHANT_RULES);
  return raw ? JSON.parse(raw) : [];
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
  const raw = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
  const profile: UserProfile = raw ? JSON.parse(raw) : INITIAL_USER_PROFILE;
  if (profile.securityPinEnabled === undefined) {
    profile.securityPinEnabled = true;
  }
  if (!profile.accessPin) {
    profile.accessPin = '1234';
  }
  return profile;
}

export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const current = getUserProfile();
  const updated = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(updated));
  syncUserProfileToFirestore(updated);
  notifyListeners();
  return updated;
}

export function getCachedAIFeedback(periodId: string): AIFeedbackResult | null {
  const raw = localStorage.getItem(STORAGE_KEYS.AI_INSIGHTS);
  if (!raw) return null;
  const map: Record<string, AIFeedbackResult> = JSON.parse(raw);
  return map[periodId] || null;
}

export function saveCachedAIFeedback(periodId: string, feedback: AIFeedbackResult) {
  const raw = localStorage.getItem(STORAGE_KEYS.AI_INSIGHTS);
  const map: Record<string, AIFeedbackResult> = raw ? JSON.parse(raw) : {};
  map[periodId] = feedback;
  localStorage.setItem(STORAGE_KEYS.AI_INSIGHTS, JSON.stringify(map));
}

export function exportTransactionsCSV(): string {
  const txs = getTransactions();
  const cats = getCategories();
  const catMap = new Map(cats.map(c => [c.id, c.name]));

  const headers = ['날짜', '유형', '금액(KRW)', '카테고리', '사용처/거래처', '메모', '입력방식'];
  const rows = txs.map(t => [
    t.localDate,
    t.type === 'income' ? '수입' : '지출',
    t.amount,
    catMap.get(t.categoryId) || '기타',
    `"${(t.merchant || '').replace(/"/g, '""')}"`,
    `"${(t.memo || '').replace(/"/g, '""')}"`,
    t.source === 'ai' ? 'AI자동' : '직접입력',
  ]);

  return '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// Bank Account CRUD
export function getBankAccounts(): BankAccount[] {
  initializeStorageIfEmpty();
  const raw = localStorage.getItem(STORAGE_KEYS.BANK_ACCOUNTS);
  return raw ? JSON.parse(raw) : [];
}

export function saveBankAccount(acc: Omit<BankAccount, 'id' | 'createdAt' | 'updatedAt'>): BankAccount {
  const accounts = getBankAccounts();
  const now = new Date().toISOString();
  const newAcc: BankAccount = {
    ...acc,
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
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify(accounts));
  syncBankAccountToFirestore(accounts[idx]);
  notifyListeners();
  return accounts[idx];
}

export function deleteBankAccount(id: string): boolean {
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
  const raw = localStorage.getItem(STORAGE_KEYS.PAYMENT_CARDS);
  return raw ? JSON.parse(raw) : [];
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

export function resetAllData(): void {
  localStorage.clear();
  clearFirestoreAllData();
  initializeStorageIfEmpty();
  notifyListeners();
}
