import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  deleteDoc,
  writeBatch,
  runTransaction,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import {
  BankAccount,
  PaymentCard,
  Transaction,
  Category,
  Budget,
  RecurringTemplate,
  RecurringOccurrence,
  MerchantRule,
  UserProfile
} from '../types';
import {
  PendingWriteSummary,
  registerOutboxFlusher,
  reportPendingCount,
  reportWriteFailed,
  reportWriteStarted,
  reportWriteSucceeded,
  resetSyncStatus,
} from './syncStatus';
import { stripUndefined } from './firestorePayload';

const COLLECTION_APP_SETTINGS = 'appSettings';
const DOC_GLOBAL_SETTINGS = 'global';
const COLLECTION_TRANSACTIONS = 'transactions';
const COLLECTION_CATEGORIES = 'categories';
const COLLECTION_BUDGETS = 'budgets';
const COLLECTION_RECURRING_TEMPLATES = 'recurringTemplates';
const COLLECTION_RECURRING_OCCURRENCES = 'recurringOccurrences';
const COLLECTION_MERCHANT_RULES = 'merchantRules';
const COLLECTION_BANK_ACCOUNTS = 'bankAccounts';
const COLLECTION_PAYMENT_CARDS = 'paymentCards';
const FIRESTORE_OUTBOX_KEY = 'brake_firestore_outbox';

interface PendingFirestoreWrite {
  id: string;
  operation: 'set' | 'delete';
  collectionName: string;
  documentId: string;
  data?: Record<string, unknown>;
  merge?: boolean;
  queuedAt: string;
}

let persistenceChain: Promise<void> = Promise.resolve();

function readFirestoreOutbox(): PendingFirestoreWrite[] {
  try {
    const raw = localStorage.getItem(FIRESTORE_OUTBOX_KEY);
    return raw ? JSON.parse(raw) as PendingFirestoreWrite[] : [];
  } catch (error) {
    console.error('Failed to read Firestore persistence outbox:', error);
    return [];
  }
}

function writeFirestoreOutbox(entries: PendingFirestoreWrite[]) {
  if (entries.length === 0) {
    localStorage.removeItem(FIRESTORE_OUTBOX_KEY);
  } else {
    localStorage.setItem(FIRESTORE_OUTBOX_KEY, JSON.stringify(entries));
  }
  reportPendingCount(entries.length);
}

/** Human-readable label for the pending-changes screen. */
const COLLECTION_LABELS: Record<string, string> = {
  transactions: '거래',
  categories: '카테고리',
  budgets: '용돈 한도',
  recurringTemplates: '정기 항목',
  recurringOccurrences: '정기 발생 건',
  merchantRules: '분류 규칙',
  bankAccounts: '계좌',
  paymentCards: '카드',
  appSettings: '앱 설정',
};

export function describePendingCollection(collectionName: string): string {
  return COLLECTION_LABELS[collectionName] || collectionName;
}

export function getPendingFirestoreWrites(): PendingWriteSummary[] {
  return readFirestoreOutbox()
    .map(({ id, operation, collectionName, documentId, queuedAt }) => ({
      id,
      operation,
      collectionName,
      documentId,
      queuedAt,
    }))
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
}

function enqueueFirestoreWrite(entry: Omit<PendingFirestoreWrite, 'id' | 'queuedAt'>): PendingFirestoreWrite {
  const queued: PendingFirestoreWrite = {
    ...stripUndefined(entry),
    id: `write_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
  };
  // Only the latest pending operation for one document matters. This also
  // collapses queues produced by older clients that retried the same write.
  const pending = readFirestoreOutbox().filter(candidate => !(
    candidate.collectionName === queued.collectionName
    && candidate.documentId === queued.documentId
  ));
  writeFirestoreOutbox([...pending, queued]);
  return queued;
}

function removeFirestoreWrite(id: string) {
  writeFirestoreOutbox(readFirestoreOutbox().filter(entry => entry.id !== id));
}

async function executeFirestoreWrite(entry: PendingFirestoreWrite) {
  const reference = scopedDoc(entry.collectionName, entry.documentId);
  if (entry.operation === 'delete') {
    await deleteDoc(reference);
    return;
  }
  if (entry.merge) {
    await setDoc(reference, stripUndefined(entry.data || {}), { merge: true });
    return;
  }
  await setDoc(reference, stripUndefined(entry.data || {}));
}

function persistFirestoreWrite(
  entry: Omit<PendingFirestoreWrite, 'id' | 'queuedAt'>,
  errorLabel: string,
): Promise<boolean> {
  const queued = enqueueFirestoreWrite(entry);
  reportWriteStarted();
  const operation = persistenceChain.then(async () => {
    await executeFirestoreWrite(queued);
    removeFirestoreWrite(queued.id);
  });
  persistenceChain = operation.catch(() => undefined);
  return operation.then(() => {
    reportWriteSucceeded();
    return true;
  }).catch(error => {
    console.error(`${errorLabel}:`, error);
    reportWriteFailed(errorLabel);
    return false;
  });
}

export function flushFirestoreOutbox(): Promise<boolean> {
  reportWriteStarted();
  const operation = persistenceChain.then(async () => {
    const pending = [...new Map(
      readFirestoreOutbox()
        .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
        .map(entry => [`${entry.collectionName}/${entry.documentId}`, entry]),
    ).values()];
    writeFirestoreOutbox(pending);
    for (const entry of pending) {
      await executeFirestoreWrite(entry);
      removeFirestoreWrite(entry.id);
    }
  });
  persistenceChain = operation.catch(() => undefined);
  return operation.then(() => {
    reportWriteSucceeded();
    return true;
  }).catch(error => {
    console.error('Failed to flush Firestore persistence outbox:', error);
    reportWriteFailed('미반영 변경사항을 DB에 저장하지 못했습니다.');
    return false;
  });
}

registerOutboxFlusher(flushFirestoreOutbox);

/** Publishes the outbox length that already exists in this browser at boot. */
export function syncPendingCountFromStorage() {
  reportPendingCount(readFirestoreOutbox().length);
}

export function clearFirestoreOutbox() {
  localStorage.removeItem(FIRESTORE_OUTBOX_KEY);
  resetSyncStatus();
}

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
};

type SyncNotifyCallback = () => void;

let isSyncInitialized = false;
let activeUnsubscribers: Array<() => void> = [];

function requireOwnerUid() {
  return 'owner';
}

function scopedCollection(collectionName: string) {
  return collection(db, 'users', requireOwnerUid(), collectionName);
}

function scopedDoc(collectionName: string, documentId: string) {
  return doc(db, 'users', requireOwnerUid(), collectionName, documentId);
}

function parseStoredObject<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function snapshotError(error: unknown) {
  console.error('Firestore realtime sync error:', error);
}

function normalizeBudget(budget: Budget & { categoryLimits?: Record<string, number> }): Budget {
  const { categoryLimits: _legacyCategoryLimits, ...normalized } = budget;
  return normalized;
}

async function readCollection<T>(collectionName: string): Promise<T[]> {
  const snapshot = await getDocs(scopedCollection(collectionName));
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as T);
}

/** Loads the cloud source of truth only after PIN/Firebase authentication succeeds. */
export async function hydrateFirestoreFromCloud() {
  const [
    profileSnapshot,
    categories,
    transactions,
    budgets,
    templates,
    occurrences,
    merchantRules,
    bankAccounts,
    paymentCards,
  ] = await Promise.all([
    getDoc(scopedDoc(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS)),
    readCollection<Category>(COLLECTION_CATEGORIES),
    readCollection<Transaction>(COLLECTION_TRANSACTIONS),
    readCollection<Budget>(COLLECTION_BUDGETS),
    readCollection<RecurringTemplate>(COLLECTION_RECURRING_TEMPLATES),
    readCollection<RecurringOccurrence>(COLLECTION_RECURRING_OCCURRENCES),
    readCollection<MerchantRule>(COLLECTION_MERCHANT_RULES),
    readCollection<BankAccount>(COLLECTION_BANK_ACCOUNTS),
    readCollection<PaymentCard>(COLLECTION_PAYMENT_CARDS),
  ]);

  transactions.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const budgetMap = Object.fromEntries(
    budgets.filter(budget => budget.yearMonth).map(budget => [budget.yearMonth, normalizeBudget(budget)]),
  );

  localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgetMap));
  localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(templates));
  localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occurrences));
  localStorage.setItem(STORAGE_KEYS.MERCHANT_RULES, JSON.stringify(merchantRules));
  localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify(bankAccounts));
  localStorage.setItem(STORAGE_KEYS.PAYMENT_CARDS, JSON.stringify(paymentCards));
  if (profileSnapshot.exists()) {
    localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(profileSnapshot.data()));
  } else {
    localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
  }

  return {
    hasCloudData: profileSnapshot.exists()
      || categories.length + transactions.length + budgets.length + templates.length + occurrences.length
        + merchantRules.length + bankAccounts.length + paymentCards.length > 0,
  };
}

/** Initialize scoped realtime listeners after the initial cloud hydration. */
export function initFirestoreSync(onNotify: SyncNotifyCallback) {
  if (isSyncInitialized) return;
  requireOwnerUid();
  isSyncInitialized = true;

  const subscribeArray = <T,>(collectionName: string, storageKey: string, sort?: (values: T[]) => void) =>
    onSnapshot(scopedCollection(collectionName), snapshot => {
      const values = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as T);
      sort?.(values);
      localStorage.setItem(storageKey, JSON.stringify(values));
      onNotify();
    }, snapshotError);

  activeUnsubscribers = [
    onSnapshot(scopedDoc(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS), snapshot => {
      if (snapshot.exists()) {
        const cloudProfile = snapshot.data() as UserProfile;
        const localProfile = parseStoredObject<Partial<UserProfile>>(STORAGE_KEYS.USER_PROFILE, {});
        localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify({ ...localProfile, ...cloudProfile }));
      } else {
        localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
      }
      onNotify();
    }, snapshotError),
    subscribeArray<Category>(COLLECTION_CATEGORIES, STORAGE_KEYS.CATEGORIES),
    subscribeArray<Transaction>(COLLECTION_TRANSACTIONS, STORAGE_KEYS.TRANSACTIONS, values => {
      values.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    }),
    onSnapshot(scopedCollection(COLLECTION_BUDGETS), snapshot => {
      const budgetMap: Record<string, Budget> = {};
      snapshot.docs.forEach(document => {
        const budget = { id: document.id, ...document.data() } as Budget & { id?: string };
        budgetMap[budget.yearMonth || document.id] = normalizeBudget(budget);
      });
      localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgetMap));
      onNotify();
    }, snapshotError),
    subscribeArray<RecurringTemplate>(COLLECTION_RECURRING_TEMPLATES, STORAGE_KEYS.RECURRING_TEMPLATES),
    subscribeArray<RecurringOccurrence>(COLLECTION_RECURRING_OCCURRENCES, STORAGE_KEYS.RECURRING_OCCURRENCES),
    subscribeArray<MerchantRule>(COLLECTION_MERCHANT_RULES, STORAGE_KEYS.MERCHANT_RULES),
    subscribeArray<BankAccount>(COLLECTION_BANK_ACCOUNTS, STORAGE_KEYS.BANK_ACCOUNTS),
    subscribeArray<PaymentCard>(COLLECTION_PAYMENT_CARDS, STORAGE_KEYS.PAYMENT_CARDS),
  ];
}

export function stopFirestoreSync() {
  activeUnsubscribers.forEach(unsubscribe => unsubscribe());
  activeUnsubscribers = [];
  isSyncInitialized = false;
}

/* Helper functions to save / update / delete items in Firestore */

export async function syncUserProfileToFirestore(profile: UserProfile) {
  return persistFirestoreWrite({
    operation: 'set',
    collectionName: COLLECTION_APP_SETTINGS,
    documentId: DOC_GLOBAL_SETTINGS,
    data: profile as unknown as Record<string, unknown>,
    merge: true,
  }, 'Failed to sync user profile to Firestore');
}

export async function fetchUserProfileFromFirestore(): Promise<UserProfile | null> {
  try {
    const settingsDocRef = scopedDoc(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS);
    const snap = await getDoc(settingsDocRef);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
  } catch (err) {
    console.error('Failed to fetch user profile from Firestore:', err);
  }
  return null;
}

export async function syncTransactionToFirestore(tx: Transaction) {
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_TRANSACTIONS, documentId: tx.id,
    data: tx as unknown as Record<string, unknown>,
  }, 'Failed to sync transaction to Firestore');
}

export async function deleteTransactionFromFirestore(id: string) {
  return persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_TRANSACTIONS, documentId: id,
  }, 'Failed to delete transaction from Firestore');
}

export async function syncCategoriesToFirestore(categories: Category[]) {
  const results = await Promise.all(categories.map(category => persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_CATEGORIES, documentId: category.id,
    data: category as unknown as Record<string, unknown>,
  }, 'Failed to sync category to Firestore')));
  return results.every(Boolean);
}

export async function deleteCategoryFromFirestore(id: string) {
  return persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_CATEGORIES, documentId: id,
  }, 'Failed to delete category from Firestore');
}

export async function syncBudgetToFirestore(budget: Budget) {
  const normalizedBudget = normalizeBudget(budget);
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_BUDGETS, documentId: normalizedBudget.yearMonth,
    data: normalizedBudget as unknown as Record<string, unknown>,
  }, 'Failed to sync budget to Firestore');
}

export async function syncRecurringTemplateToFirestore(tmpl: RecurringTemplate) {
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_RECURRING_TEMPLATES, documentId: tmpl.id,
    data: tmpl as unknown as Record<string, unknown>,
  }, 'Failed to sync recurring template to Firestore');
}

export async function deleteRecurringTemplateFromFirestore(id: string) {
  return persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_RECURRING_TEMPLATES, documentId: id,
  }, 'Failed to delete recurring template from Firestore');
}

export async function syncRecurringOccurrencesToFirestore(occs: RecurringOccurrence[]) {
  const results = await Promise.all(occs.map(occurrence => persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_RECURRING_OCCURRENCES, documentId: occurrence.id,
    data: occurrence as unknown as Record<string, unknown>,
  }, 'Failed to sync recurring occurrence to Firestore')));
  return results.every(Boolean);
}

export async function deleteRecurringOccurrencesFromFirestore(ids: string[]) {
  const results = await Promise.all(ids.map(id => persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_RECURRING_OCCURRENCES, documentId: id,
  }, 'Failed to delete recurring occurrence from Firestore')));
  return results.every(Boolean);
}

export async function commitRecurringPosting(tx: Transaction, occurrence: RecurringOccurrence) {
  const transactionRef = scopedDoc(COLLECTION_TRANSACTIONS, tx.id);
  const occurrenceRef = scopedDoc(COLLECTION_RECURRING_OCCURRENCES, occurrence.id);

  await runTransaction(db, async firestoreTransaction => {
    const currentOccurrence = await firestoreTransaction.get(occurrenceRef);
    if (currentOccurrence.exists() && currentOccurrence.data().status === 'posted') {
      throw new Error('이미 처리된 정기 항목입니다.');
    }
    firestoreTransaction.set(transactionRef, tx);
    firestoreTransaction.set(occurrenceRef, occurrence);
  });
}

export async function syncMerchantRuleToFirestore(rule: MerchantRule) {
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_MERCHANT_RULES, documentId: rule.id,
    data: rule as unknown as Record<string, unknown>,
  }, 'Failed to sync merchant rule to Firestore');
}

export async function syncBankAccountToFirestore(account: BankAccount) {
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_BANK_ACCOUNTS, documentId: account.id,
    data: account as unknown as Record<string, unknown>,
  }, 'Failed to sync bank account to Firestore');
}

export async function deleteBankAccountFromFirestore(id: string) {
  return persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_BANK_ACCOUNTS, documentId: id,
  }, 'Failed to delete bank account from Firestore');
}

export async function syncPaymentCardToFirestore(card: PaymentCard) {
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_PAYMENT_CARDS, documentId: card.id,
    data: card as unknown as Record<string, unknown>,
  }, 'Failed to sync payment card to Firestore');
}

export async function deletePaymentCardFromFirestore(id: string) {
  return persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_PAYMENT_CARDS, documentId: id,
  }, 'Failed to delete payment card from Firestore');
}

export async function clearFirestoreAllData() {
  try {
    const collectionsToClear = [
      COLLECTION_TRANSACTIONS,
      COLLECTION_CATEGORIES,
      COLLECTION_BUDGETS,
      COLLECTION_RECURRING_TEMPLATES,
      COLLECTION_RECURRING_OCCURRENCES,
      COLLECTION_MERCHANT_RULES,
      COLLECTION_BANK_ACCOUNTS,
      COLLECTION_PAYMENT_CARDS,
    ];

    for (const colName of collectionsToClear) {
      const snap = await getDocs(scopedCollection(colName));
      for (let offset = 0; offset < snap.docs.length; offset += 400) {
        const batch = writeBatch(db);
        snap.docs.slice(offset, offset + 400).forEach(docSnap => batch.delete(docSnap.ref));
        await batch.commit();
      }
    }
    await deleteDoc(scopedDoc(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS));
  } catch (err) {
    console.error('Failed to clear Firestore collections:', err);
  }
}

