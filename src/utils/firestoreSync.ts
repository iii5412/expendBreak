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
import { db } from '../lib/firestore';
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
  UserProfile,
  AmountChangeRecord,
} from '../types';
import { AmountConflictError, isAmountConflict } from './amountOperations';
import {
  registerOutboxFlusher,
  reportPendingCount,
  reportWriteFailed,
  reportWriteStarted,
  reportWriteSucceeded,
} from './syncStatus';
import { describeFirestoreWriteError, sanitizeUserProfileForFirestore, stripUndefined } from './firestorePayload';
import { mergeFetchedHistory, mergeTransactionWindow } from './transactionWindow';
import { getAccountStorageKey, getSignedInAccount } from './auth';
import { safeSetItem } from './safeStorage';
import { overlayDocument, overlayList, overlayMap } from './outboxOverlay';
import { stripReceiptBulk, toCloudTransactionWrite } from './receiptCache';
import {
  ACCOUNT_KEYS,
  COLLECTION_AMOUNT_CHANGES,
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
  enqueueFirestoreWrite,
  getLiveTransactionWindowStart,
  getLoadedTransactionHistoryFloor,
  pendingChanges,
  readFirestoreOutbox,
  readHistoryFloor,
  recordFirestoreWriteError,
  recordSyncConflict,
  removeFirestoreWrite,
  setLiveTransactionWindowStart,
  writeFirestoreOutbox,
  type ConditionalDocumentWrite,
  type PendingFirestoreWrite,
} from './firestoreOutbox';
import * as writes from './firestoreWrites';
import { normalizeBudget } from './firestoreWrites';
import type { WriteSpec } from './firestoreWrites';

// The offline outbox, conflicts and history floor live in firestoreOutbox.ts so they
// work before this (lazily loaded) module has arrived; re-exported for existing callers.
export {
  AMOUNT_CHANGES_COLLECTION,
  RECURRING_OCCURRENCES_COLLECTION,
  TRANSACTIONS_COLLECTION,
  clearFirestoreOutbox,
  clearTransactionHistoryFloor,
  describePendingCollection,
  dismissSyncConflict,
  getLoadedTransactionHistoryFloor,
  getPendingFirestoreWrites,
  getSyncConflicts,
  subscribeSyncConflicts,
  syncPendingCountFromStorage,
  type ConditionalDocumentWrite,
  type SyncConflict,
} from './firestoreOutbox';

let persistenceChain: Promise<void> = Promise.resolve();

/**
 * Applies every document of one operation in a single Firestore transaction,
 * refusing when any document's revision is not the one the operation was
 * built on. A document already carrying this operation id means a retry of an
 * applied operation, which is a no-op rather than a second application.
 */
async function executeConditionalWrite(entry: PendingFirestoreWrite) {
  const documents = entry.documents || [];
  const operationId = entry.operationId || entry.id;
  await runTransaction(db, async firestoreTransaction => {
    const snapshots = await Promise.all(documents.map(document => firestoreTransaction.get(
      scopedDoc(document.collectionName, document.documentId),
    )));
    if (snapshots.some(snapshot => snapshot.exists() && snapshot.data().lastOperationId === operationId)) {
      return; // already applied by an earlier attempt
    }
    documents.forEach((document, index) => {
      const snapshot = snapshots[index];
      const currentRevision = snapshot.exists() ? Number(snapshot.data().revision ?? 0) : 0;
      if (document.expectedRevision === 0 && snapshot.exists() && !document.remove && document.collectionName === COLLECTION_TRANSACTIONS) {
        throw new AmountConflictError('이미 다른 기기에서 납부 완료된 항목입니다.');
      }
      if (currentRevision !== document.expectedRevision) {
        throw new AmountConflictError();
      }
    });
    documents.forEach((document, index) => {
      const reference = scopedDoc(document.collectionName, document.documentId);
      if (document.remove) {
        if (snapshots[index].exists()) firestoreTransaction.delete(reference);
        return;
      }
      if (document.collectionName === COLLECTION_TRANSACTIONS) {
        const write = toCloudTransactionWrite(document.data || {});
        if (write.merge) firestoreTransaction.set(reference, stripUndefined(write.data), { merge: true });
        else firestoreTransaction.set(reference, stripUndefined(write.data));
        return;
      }
      firestoreTransaction.set(reference, stripUndefined(document.data || {}));
    });
    if (entry.changeRecord) {
      firestoreTransaction.set(
        scopedDoc(COLLECTION_AMOUNT_CHANGES, entry.changeRecord.id),
        stripUndefined(entry.changeRecord as unknown as Record<string, unknown>),
      );
    }
  });
}

async function executeFirestoreWrite(entry: PendingFirestoreWrite) {
  if (entry.operation === 'conditional') {
    await executeConditionalWrite(entry);
    return;
  }
  const reference = scopedDoc(entry.collectionName, entry.documentId);
  if (entry.operation === 'delete') {
    await deleteDoc(reference);
    return;
  }
  // Old global documents can still contain the prohibited legacy accessPin.
  // A merge keeps that field in request.resource.data and Firestore rejects the
  // update forever. Replace the complete sanitized profile so old queued writes
  // repair the document on their very next retry.
  if (entry.collectionName === COLLECTION_APP_SETTINGS && entry.documentId === DOC_GLOBAL_SETTINGS) {
    await setDoc(reference, sanitizeUserProfileForFirestore(entry.data || {}));
    return;
  }
  if (entry.merge) {
    await setDoc(reference, stripUndefined(entry.data || {}), { merge: true });
    return;
  }
  if (entry.collectionName === COLLECTION_TRANSACTIONS) {
    // A cached copy without its OCR text must not erase the stored text.
    const write = toCloudTransactionWrite(entry.data || {});
    if (write.merge) await setDoc(reference, stripUndefined(write.data), { merge: true });
    else await setDoc(reference, stripUndefined(write.data));
    return;
  }
  await setDoc(reference, stripUndefined(entry.data || {}));
}

/**
 * Runs one write. The lazy facade queues the entry in the outbox itself (so it
 * is safe even if this module fails to load) and passes it as `alreadyQueued`.
 */
export function persistFirestoreWrite(spec: WriteSpec, alreadyQueued?: PendingFirestoreWrite): Promise<boolean> {
  const { entry, label: errorLabel } = spec;
  let queued: PendingFirestoreWrite;
  let storedInOutbox = true;
  if (alreadyQueued) {
    queued = alreadyQueued;
  } else {
    try {
      queued = enqueueFirestoreWrite(entry);
    } catch (error) {
      // The device has no room for the outbox entry. The change is still sent
      // straight to Firestore so it is not lost; only offline protection is gone,
      // which the storage-full banner already tells the user about.
      console.error(`${errorLabel}: could not queue the write locally:`, error);
      storedInOutbox = false;
      queued = {
        ...stripUndefined(entry),
        id: `write_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        queuedAt: new Date().toISOString(),
      };
    }
  }
  const settled = queued;
  reportWriteStarted();
  const operation = persistenceChain.then(async () => {
    await executeFirestoreWrite(settled);
    if (storedInOutbox) removeFirestoreWrite(settled.id);
  });
  persistenceChain = operation.catch(() => undefined);
  return operation.then(() => {
    reportWriteSucceeded();
    return true;
  }).catch(error => {
    console.error(`${errorLabel}:`, error);
    if (isAmountConflict(error)) {
      // Retrying cannot succeed and must not block later writes; park it for review.
      recordSyncConflict(settled, error);
      if (storedInOutbox) removeFirestoreWrite(settled.id);
      reportWriteFailed(error.message);
      return false;
    }
    reportWriteFailed(storedInOutbox
      ? recordFirestoreWriteError(settled.id, error)
      : describeFirestoreWriteError(error));
    return false;
  });
}

const persistAll = async (specs: WriteSpec[]) => (await Promise.all(specs.map(spec => persistFirestoreWrite(spec)))).every(Boolean);

/**
 * Queues one revision-checked operation. Local state is expected to be updated
 * first; the result only says whether the cloud accepted it now. A conflict is
 * recorded through {@link getSyncConflicts} instead of being retried.
 */
export function commitConditionalOperation(input: {
  operationId: string;
  documents: ConditionalDocumentWrite[];
  changeRecord?: AmountChangeRecord;
}): Promise<boolean> {
  return persistFirestoreWrite(writes.conditionalOperationWrite(input));
}

export function flushFirestoreOutbox(): Promise<boolean> {
  reportWriteStarted();
  let failedMessage = '';
  const operation = persistenceChain.then(async () => {
    const pending = [...new Map(
      readFirestoreOutbox()
        .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
        .map(entry => [entry.operation === 'conditional' ? `op/${entry.operationId || entry.id}` : `${entry.collectionName}/${entry.documentId}`, entry]),
    ).values()];
    writeFirestoreOutbox(pending);
    for (const entry of pending) {
      try {
        await executeFirestoreWrite(entry);
      } catch (error) {
        if (isAmountConflict(error)) {
          recordSyncConflict(entry, error);
          removeFirestoreWrite(entry.id);
          continue;
        }
        failedMessage = recordFirestoreWriteError(entry.id, error);
        throw error;
      }
      removeFirestoreWrite(entry.id);
    }
  });
  persistenceChain = operation.catch(() => undefined);
  return operation.then(() => {
    reportWriteSucceeded();
    return true;
  }).catch(error => {
    console.error('Failed to flush Firestore persistence outbox:', error);
    reportWriteFailed(failedMessage || describeFirestoreWriteError(error));
    return false;
  });
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

async function readCollection<T>(collectionName: string): Promise<T[]> {
  const snapshot = await getDocs(scopedCollection(collectionName));
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as T);
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
  const fetched = snapshot.docs.map(document => stripReceiptBulk({ id: document.id, ...document.data() } as Transaction));

  const cached = parseStoredObject<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, []);
  // Lower the floor only when the history really was stored; otherwise the next
  // visit fetches it again instead of trusting a cache that is missing it.
  const stored = safeSetItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(mergeFetchedHistory(cached, fetched)));
  if (stored) safeSetItem(ACCOUNT_KEYS.transactionHistoryFloor, startDate);
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
  setLiveTransactionWindowStart(transactionWindowStart);
  safeSetItem(ACCOUNT_KEYS.transactionHistoryFloor, readHistoryFloor(transactionWindowStart));

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
      const fromServer = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as T & { id: string });
      const values = overlayList(fromServer, pendingChanges(collectionName)) as T[];
      sort?.(values);
      safeSetItem(storageKey, JSON.stringify(values));
      markDelivered(source);
      onNotify();
    }, markFailed);

  activeUnsubscribers = [
    onSnapshot(scopedDoc(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS), snapshot => {
      const localProfile = parseStoredObject<Partial<UserProfile>>(STORAGE_KEYS.USER_PROFILE, {});
      const cloudProfile = snapshot.exists() ? { ...localProfile, ...(snapshot.data() as UserProfile) } : null;
      const profile = overlayDocument<Record<string, unknown>>(
        cloudProfile as Record<string, unknown> | null,
        pendingChanges(COLLECTION_APP_SETTINGS)
          .filter(change => change.id === DOC_GLOBAL_SETTINGS)
          .map(change => ({ ...change, merge: true })),
      );
      if (profile) safeSetItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(profile));
      else localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
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
        const live = snapshot.docs.map(document => stripReceiptBulk({ id: document.id, ...document.data() } as Transaction));
        const cached = parseStoredObject<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, []);
        const merged = overlayList(
          mergeTransactionWindow(cached, live, transactionWindowStart),
          pendingChanges(COLLECTION_TRANSACTIONS),
        ).map(stripReceiptBulk);
        safeSetItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(merged));
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
      safeSetItem(STORAGE_KEYS.BUDGETS, JSON.stringify(overlayMap(
        budgetMap,
        pendingChanges(COLLECTION_BUDGETS),
        (id, data) => String(data?.yearMonth || id),
        value => normalizeBudget(value as Budget),
      )));
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
      safeSetItem(STORAGE_KEYS.CYCLE_BASELINES, JSON.stringify(overlayMap(
        baselineMap,
        pendingChanges(COLLECTION_CYCLE_BASELINES),
        (id, data) => String(data?.yearMonth || id),
      )));
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

export const syncUserProfileToFirestore = (profile: UserProfile) => persistFirestoreWrite(writes.userProfileWrite(profile));

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

export const syncTransactionToFirestore = (tx: Transaction) => persistFirestoreWrite(writes.transactionWrite(tx));
export const deleteTransactionFromFirestore = (id: string) => persistFirestoreWrite(writes.transactionDelete(id));
export const syncQuickEntryToFirestore = (entry: QuickEntry) => persistFirestoreWrite(writes.quickEntryWrite(entry));
export const deleteQuickEntryFromFirestore = (id: string) => persistFirestoreWrite(writes.quickEntryDelete(id));
export const syncCategoriesToFirestore = (categories: Category[]) => persistAll(writes.categoryWrites(categories));
export const deleteCategoryFromFirestore = (id: string) => persistFirestoreWrite(writes.categoryDelete(id));
export const syncBudgetToFirestore = (budget: Budget) => persistFirestoreWrite(writes.budgetWrite(normalizeBudget(budget)));
export const syncRecurringTemplateToFirestore = (template: RecurringTemplate) => persistFirestoreWrite(writes.recurringTemplateWrite(template));
export const deleteRecurringTemplateFromFirestore = (id: string) => persistFirestoreWrite(writes.recurringTemplateDelete(id));
export const syncRecurringOccurrencesToFirestore = (occurrences: RecurringOccurrence[]) => persistAll(writes.recurringOccurrenceWrites(occurrences));
export const deleteRecurringOccurrencesFromFirestore = (ids: string[]) => persistAll(writes.recurringOccurrenceDeletes(ids));
export const syncCycleBaselineToFirestore = (baseline: CycleBaseline) => persistFirestoreWrite(writes.cycleBaselineWrite(baseline));
export const deleteCycleBaselineFromFirestore = (yearMonth: string) => persistFirestoreWrite(writes.cycleBaselineDelete(yearMonth));
export const syncMerchantRuleToFirestore = (rule: MerchantRule) => persistFirestoreWrite(writes.merchantRuleWrite(rule));
export const syncBankAccountToFirestore = (account: BankAccount) => persistFirestoreWrite(writes.bankAccountWrite(account));
export const deleteBankAccountFromFirestore = (id: string) => persistFirestoreWrite(writes.bankAccountDelete(id));
export const syncPaymentCardToFirestore = (card: PaymentCard) => persistFirestoreWrite(writes.paymentCardWrite(card));
export const deletePaymentCardFromFirestore = (id: string) => persistFirestoreWrite(writes.paymentCardDelete(id));

/**
 * Deletes every document of the account. Any failure is thrown so the caller
 * can tell the user the reset is incomplete; running it again deletes only
 * what is left.
 */
export async function clearFirestoreAllData() {
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
    COLLECTION_AMOUNT_CHANGES,
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
}

/** The receipt's OCR text, which the local cache leaves out. */
export async function fetchTransactionReceiptText(transactionId: string): Promise<string | null> {
  const snapshot = await getDoc(scopedDoc(COLLECTION_TRANSACTIONS, transactionId));
  const receipt = snapshot.exists() ? (snapshot.data() as Partial<Transaction>).receipt : null;
  return receipt?.rawText ?? null;
}

registerOutboxFlusher(flushFirestoreOutbox);
