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
  query,
  where,
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
  CycleBaseline,
  QuickEntry,
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
import { mergeFetchedHistory, mergeTransactionWindow } from './transactionWindow';
import { getAccountStorageKey, getSignedInAccount } from './auth';

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
const COLLECTION_CYCLE_BASELINES = 'cycleBaselines';
const COLLECTION_QUICK_ENTRIES = 'quickEntries';
const ACCOUNT_KEYS = {
  get firestoreOutbox() { return getAccountStorageKey('brake_firestore_outbox'); },
  get transactionHistoryFloor() { return getAccountStorageKey('brake_transaction_history_floor'); },
};

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
    const raw = localStorage.getItem(ACCOUNT_KEYS.firestoreOutbox);
    return raw ? JSON.parse(raw) as PendingFirestoreWrite[] : [];
  } catch (error) {
    console.error('Failed to read Firestore persistence outbox:', error);
    return [];
  }
}

function writeFirestoreOutbox(entries: PendingFirestoreWrite[]) {
  if (entries.length === 0) {
    localStorage.removeItem(ACCOUNT_KEYS.firestoreOutbox);
  } else {
    localStorage.setItem(ACCOUNT_KEYS.firestoreOutbox, JSON.stringify(entries));
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
  cycleBaselines: '주기 생활비 계획',
  quickEntries: '퀵등록',
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

export function clearTransactionHistoryFloor() {
  localStorage.removeItem(ACCOUNT_KEYS.transactionHistoryFloor);
  liveTransactionWindowStart = '';
}

export function clearFirestoreOutbox() {
  localStorage.removeItem(ACCOUNT_KEYS.firestoreOutbox);
  resetSyncStatus();
}

const STORAGE_KEYS = {
  get TRANSACTIONS() { return getAccountStorageKey('brake_transactions'); },
  get CATEGORIES() { return getAccountStorageKey('brake_categories'); },
  get BUDGETS() { return getAccountStorageKey('brake_budgets'); },
  get RECURRING_TEMPLATES() { return getAccountStorageKey('brake_recurring_templates'); },
  get RECURRING_OCCURRENCES() { return getAccountStorageKey('brake_recurring_occurrences'); },
  get MERCHANT_RULES() { return getAccountStorageKey('brake_merchant_rules'); },
  get USER_PROFILE() { return getAccountStorageKey('brake_user_profile'); },
  get BANK_ACCOUNTS() { return getAccountStorageKey('brake_bank_accounts'); },
  get PAYMENT_CARDS() { return getAccountStorageKey('brake_payment_cards'); },
  get CYCLE_BASELINES() { return getAccountStorageKey('brake_cycle_baselines'); },
  get QUICK_ENTRIES() { return getAccountStorageKey('brake_quick_entries'); },
};

type SyncNotifyCallback = () => void;

let isSyncInitialized = false;
let activeUnsubscribers: Array<() => void> = [];

function requireOwnerUid() {
  return getSignedInAccount().uid;
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

/**
 * Oldest `localDate` currently present in the local transaction cache. Anything
 * before this has to be fetched before a screen can summarise it truthfully.
 */
let liveTransactionWindowStart = '';

function readHistoryFloor(fallback: string): string {
  const stored = localStorage.getItem(ACCOUNT_KEYS.transactionHistoryFloor);
  return stored && stored < fallback ? stored : fallback;
}

/** The earliest date the local transaction cache can be trusted to be complete from. */
export function getLoadedTransactionHistoryFloor(): string {
  return readHistoryFloor(liveTransactionWindowStart);
}

/**
 * Pulls transaction history older than what the live subscription covers, for
 * when the user navigates to a period outside the boot window. A one-shot read
 * rather than another subscription: old periods do not change under the user,
 * and a second live query would fight the first one over the same cache entry.
 */
export async function loadTransactionHistoryFrom(startDate: string, onNotify: SyncNotifyCallback) {
  const floor = getLoadedTransactionHistoryFloor();
  if (startDate >= floor) return;

  const snapshot = await getDocs(query(
    scopedCollection(COLLECTION_TRANSACTIONS),
    where('localDate', '>=', startDate),
    where('localDate', '<', floor),
  ));
  const fetched = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as Transaction);

  const cached = parseStoredObject<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, []);
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(mergeFetchedHistory(cached, fetched)));
  localStorage.setItem(ACCOUNT_KEYS.transactionHistoryFloor, startDate);
  onNotify();
}

/** Every source the first snapshot round has to cover before the cache is whole. */
const SYNC_SOURCES = [
  'profile',
  'categories',
  'transactions',
  'budgets',
  'recurringTemplates',
  'recurringOccurrences',
  'merchantRules',
  'bankAccounts',
  'paymentCards',
  'cycleBaselines',
  'quickEntries',
] as const;

function localCacheHasAnyData(): boolean {
  if (localStorage.getItem(STORAGE_KEYS.USER_PROFILE)) return true;
  const arrayKeys = [
    STORAGE_KEYS.CATEGORIES,
    STORAGE_KEYS.TRANSACTIONS,
    STORAGE_KEYS.RECURRING_TEMPLATES,
    STORAGE_KEYS.RECURRING_OCCURRENCES,
    STORAGE_KEYS.MERCHANT_RULES,
    STORAGE_KEYS.BANK_ACCOUNTS,
    STORAGE_KEYS.PAYMENT_CARDS,
    STORAGE_KEYS.QUICK_ENTRIES,
  ];
  if (arrayKeys.some(key => parseStoredObject<unknown[]>(key, []).length > 0)) return true;
  const mapKeys = [STORAGE_KEYS.BUDGETS, STORAGE_KEYS.CYCLE_BASELINES];
  return mapKeys.some(key => Object.keys(parseStoredObject<Record<string, unknown>>(key, {})).length > 0);
}

/**
 * Starts the scoped realtime listeners and resolves once every one of them has
 * delivered its first snapshot.
 *
 * That first round *is* the hydration. This used to be preceded by a separate
 * `getDocs` pass over the same ten collections, which meant every boot
 * downloaded the whole account twice before the app would render.
 */
export function initFirestoreSync(
  onNotify: SyncNotifyCallback,
  transactionWindowStart: string,
): Promise<{ hasCloudData: boolean }> {
  if (isSyncInitialized) return Promise.resolve({ hasCloudData: localCacheHasAnyData() });
  requireOwnerUid();
  isSyncInitialized = true;
  liveTransactionWindowStart = transactionWindowStart;
  localStorage.setItem(ACCOUNT_KEYS.transactionHistoryFloor, readHistoryFloor(transactionWindowStart));

  const pending = new Set<string>(SYNC_SOURCES);
  let settle: (() => void) | null = null;
  let fail: ((error: unknown) => void) | null = null;
  const firstRound = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const markDelivered = (source: string) => {
    pending.delete(source);
    if (pending.size === 0) settle?.();
  };

  /** A listener that never attaches must not leave the boot waiting forever. */
  const markFailed = (error: unknown) => {
    snapshotError(error);
    fail?.(error);
  };

  const subscribeArray = <T,>(
    source: string,
    collectionName: string,
    storageKey: string,
    sort?: (values: T[]) => void,
  ) =>
    onSnapshot(scopedCollection(collectionName), snapshot => {
      const values = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as T);
      sort?.(values);
      localStorage.setItem(storageKey, JSON.stringify(values));
      markDelivered(source);
      onNotify();
    }, markFailed);

  activeUnsubscribers = [
    onSnapshot(scopedDoc(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS), snapshot => {
      if (snapshot.exists()) {
        const cloudProfile = snapshot.data() as UserProfile;
        const localProfile = parseStoredObject<Partial<UserProfile>>(STORAGE_KEYS.USER_PROFILE, {});
        localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify({ ...localProfile, ...cloudProfile }));
      } else {
        localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
      }
      markDelivered('profile');
      onNotify();
    }, markFailed),
    subscribeArray<Category>('categories', COLLECTION_CATEGORIES, STORAGE_KEYS.CATEGORIES),
    // Bounded to the recent accounting periods: subscribing to every
    // transaction ever recorded made boot time grow with the ledger. Older
    // history arrives through loadTransactionHistoryFrom on demand.
    onSnapshot(
      query(scopedCollection(COLLECTION_TRANSACTIONS), where('localDate', '>=', transactionWindowStart)),
      snapshot => {
        const live = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as Transaction);
        const cached = parseStoredObject<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, []);
        const merged = mergeTransactionWindow(cached, live, transactionWindowStart);
        localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(merged));
        markDelivered('transactions');
        onNotify();
      },
      markFailed,
    ),
    onSnapshot(scopedCollection(COLLECTION_BUDGETS), snapshot => {
      const budgetMap: Record<string, Budget> = {};
      snapshot.docs.forEach(document => {
        const budget = { id: document.id, ...document.data() } as Budget & { id?: string };
        budgetMap[budget.yearMonth || document.id] = normalizeBudget(budget);
      });
      localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgetMap));
      markDelivered('budgets');
      onNotify();
    }, markFailed),
    subscribeArray<RecurringTemplate>(
      'recurringTemplates', COLLECTION_RECURRING_TEMPLATES, STORAGE_KEYS.RECURRING_TEMPLATES,
    ),
    subscribeArray<RecurringOccurrence>(
      'recurringOccurrences', COLLECTION_RECURRING_OCCURRENCES, STORAGE_KEYS.RECURRING_OCCURRENCES,
    ),
    subscribeArray<MerchantRule>('merchantRules', COLLECTION_MERCHANT_RULES, STORAGE_KEYS.MERCHANT_RULES),
    subscribeArray<BankAccount>('bankAccounts', COLLECTION_BANK_ACCOUNTS, STORAGE_KEYS.BANK_ACCOUNTS),
    subscribeArray<PaymentCard>('paymentCards', COLLECTION_PAYMENT_CARDS, STORAGE_KEYS.PAYMENT_CARDS),
    subscribeArray<QuickEntry>('quickEntries', COLLECTION_QUICK_ENTRIES, STORAGE_KEYS.QUICK_ENTRIES, values => {
      values.sort((a, b) => a.sortOrder - b.sortOrder);
    }),
    onSnapshot(scopedCollection(COLLECTION_CYCLE_BASELINES), snapshot => {
      const baselineMap: Record<string, CycleBaseline> = {};
      snapshot.docs.forEach(document => {
        const baseline = { ...document.data() } as CycleBaseline;
        baselineMap[baseline.yearMonth || document.id] = baseline;
      });
      localStorage.setItem(STORAGE_KEYS.CYCLE_BASELINES, JSON.stringify(baselineMap));
      markDelivered('cycleBaselines');
      onNotify();
    }, markFailed),
  ];

  return firstRound.then(() => ({ hasCloudData: localCacheHasAnyData() }));
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

export async function syncQuickEntryToFirestore(entry: QuickEntry) {
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_QUICK_ENTRIES, documentId: entry.id,
    data: entry as unknown as Record<string, unknown>,
  }, 'Failed to sync quick entry to Firestore');
}

export async function deleteQuickEntryFromFirestore(id: string) {
  return persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_QUICK_ENTRIES, documentId: id,
  }, 'Failed to delete quick entry from Firestore');
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

export async function syncCycleBaselineToFirestore(baseline: CycleBaseline) {
  return persistFirestoreWrite({
    operation: 'set', collectionName: COLLECTION_CYCLE_BASELINES, documentId: baseline.yearMonth,
    data: baseline as unknown as Record<string, unknown>,
  }, 'Failed to sync cycle baseline to Firestore');
}

export async function deleteCycleBaselineFromFirestore(yearMonth: string) {
  return persistFirestoreWrite({
    operation: 'delete', collectionName: COLLECTION_CYCLE_BASELINES, documentId: yearMonth,
  }, 'Failed to delete cycle baseline from Firestore');
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
      COLLECTION_CYCLE_BASELINES,
      COLLECTION_QUICK_ENTRIES,
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

