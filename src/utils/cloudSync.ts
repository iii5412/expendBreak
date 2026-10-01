import type { AmountChangeRecord, Budget, BankAccount, Category, CycleBaseline, MerchantRule, PaymentCard, QuickEntry, RecurringOccurrence, RecurringTemplate, Transaction, UserProfile } from '../types';
import {
  enqueueFirestoreWrite,
  type ConditionalDocumentWrite,
  type PendingFirestoreWrite,
} from './firestoreOutbox';
import * as writes from './firestoreWrites';
import type { WriteSpec } from './firestoreWrites';
import { registerOutboxFlusher, reportWriteFailed } from './syncStatus';

/*
 * The Firestore code is about 117KB gzipped and is only needed once someone is
 * signed in, so it is a separate chunk fetched on first use instead of part of
 * the first-screen bundle. This facade keeps the old API:
 *
 *  - Anything that only reads the local outbox (pending list, conflicts, the
 *    history floor) is re-exported from firestoreOutbox and works immediately.
 *  - Writes are put in the outbox *before* the chunk is requested, so a change
 *    made while the chunk is still loading (or cannot be fetched offline) is
 *    never lost: it is sent when the chunk arrives or on the next retry.
 */
type FirestoreSyncModule = typeof import('./firestoreSync');

let loadedModule: FirestoreSyncModule | null = null;
let loading: Promise<FirestoreSyncModule> | null = null;

export function loadFirestoreSync(): Promise<FirestoreSyncModule> {
  loading ??= import('./firestoreSync')
    .then(module => {
      loadedModule = module;
      return module;
    })
    .catch(error => {
      loading = null; // offline now, maybe online later
      throw error;
    });
  return loading;
}

function persistLazy(spec: WriteSpec): Promise<boolean> {
  if (loadedModule) return loadedModule.persistFirestoreWrite(spec);

  let queued: PendingFirestoreWrite | undefined;
  try {
    queued = enqueueFirestoreWrite(spec.entry);
  } catch {
    // No room for the outbox entry: the Firestore module retries the enqueue and
    // falls back to sending the change directly.
    queued = undefined;
  }
  return loadFirestoreSync()
    .then(module => module.persistFirestoreWrite(spec, queued))
    .catch(error => {
      console.error(`${spec.label}: Firestore code could not be loaded:`, error);
      reportWriteFailed('저장 모듈을 불러오지 못했습니다. 연결되면 자동으로 다시 시도합니다.');
      return false;
    });
}

const persistLazyAll = async (specs: WriteSpec[]) => (await Promise.all(specs.map(persistLazy))).every(Boolean);

/** Wraps a Firestore-module function so it loads the module first. */
function lazy<Args extends unknown[], Result>(pick: (module: FirestoreSyncModule) => (...args: Args) => Promise<Result>) {
  return (...args: Args): Promise<Result> => loadFirestoreSync().then(module => pick(module)(...args));
}

// The retry button and the "back online" handler flush through the status module.
registerOutboxFlusher(() => loadFirestoreSync().then(module => module.flushFirestoreOutbox()).catch(error => {
  console.error('Firestore code could not be loaded to flush the outbox:', error);
  return false;
}));

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

export const initFirestoreSync = lazy(module => module.initFirestoreSync);
export const flushFirestoreOutbox = lazy(module => module.flushFirestoreOutbox);
export const loadTransactionHistoryFrom = lazy(module => module.loadTransactionHistoryFrom);
export const clearFirestoreAllData = lazy(module => module.clearFirestoreAllData);
export const fetchUserProfileFromFirestore = lazy(module => module.fetchUserProfileFromFirestore);
export const fetchTransactionReceiptText = lazy(module => module.fetchTransactionReceiptText);

/** Nothing to stop until the module has loaded; a start that is still in flight is stopped by its caller's check. */
export function stopFirestoreSync() {
  loadedModule?.stopFirestoreSync();
}

export const syncUserProfileToFirestore = (profile: UserProfile) => persistLazy(writes.userProfileWrite(profile));
export const syncTransactionToFirestore = (tx: Transaction) => persistLazy(writes.transactionWrite(tx));
export const deleteTransactionFromFirestore = (id: string) => persistLazy(writes.transactionDelete(id));
export const syncQuickEntryToFirestore = (entry: QuickEntry) => persistLazy(writes.quickEntryWrite(entry));
export const deleteQuickEntryFromFirestore = (id: string) => persistLazy(writes.quickEntryDelete(id));
export const syncCategoriesToFirestore = (categories: Category[]) => persistLazyAll(writes.categoryWrites(categories));
export const deleteCategoryFromFirestore = (id: string) => persistLazy(writes.categoryDelete(id));
export const syncBudgetToFirestore = (budget: Budget) => persistLazy(writes.budgetWrite(writes.normalizeBudget(budget)));
export const syncRecurringTemplateToFirestore = (template: RecurringTemplate) => persistLazy(writes.recurringTemplateWrite(template));
export const deleteRecurringTemplateFromFirestore = (id: string) => persistLazy(writes.recurringTemplateDelete(id));
export const syncRecurringOccurrencesToFirestore = (occurrences: RecurringOccurrence[]) => persistLazyAll(writes.recurringOccurrenceWrites(occurrences));
export const deleteRecurringOccurrencesFromFirestore = (ids: string[]) => persistLazyAll(writes.recurringOccurrenceDeletes(ids));
export const syncCycleBaselineToFirestore = (baseline: CycleBaseline) => persistLazy(writes.cycleBaselineWrite(baseline));
export const deleteCycleBaselineFromFirestore = (yearMonth: string) => persistLazy(writes.cycleBaselineDelete(yearMonth));
export const syncMerchantRuleToFirestore = (rule: MerchantRule) => persistLazy(writes.merchantRuleWrite(rule));
export const syncBankAccountToFirestore = (account: BankAccount) => persistLazy(writes.bankAccountWrite(account));
export const deleteBankAccountFromFirestore = (id: string) => persistLazy(writes.bankAccountDelete(id));
export const syncPaymentCardToFirestore = (card: PaymentCard) => persistLazy(writes.paymentCardWrite(card));
export const deletePaymentCardFromFirestore = (id: string) => persistLazy(writes.paymentCardDelete(id));

export const commitConditionalOperation = (input: {
  operationId: string;
  documents: ConditionalDocumentWrite[];
  changeRecord?: AmountChangeRecord;
}) => persistLazy(writes.conditionalOperationWrite(input));
