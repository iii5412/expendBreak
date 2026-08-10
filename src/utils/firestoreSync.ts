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
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('PIN 로그인 후에만 Firestore에 접근할 수 있습니다.');
  return uid;
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
  const budgetMap = Object.fromEntries(budgets.filter(budget => budget.yearMonth).map(budget => [budget.yearMonth, budget]));

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
        budgetMap[budget.yearMonth || document.id] = budget;
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
  try {
    const settingsDocRef = scopedDoc(COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS);
    await setDoc(settingsDocRef, profile, { merge: true });
  } catch (err) {
    console.error('Failed to sync user profile to Firestore:', err);
  }
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
  try {
    await setDoc(scopedDoc(COLLECTION_TRANSACTIONS, tx.id), tx);
  } catch (err) {
    console.error('Failed to sync transaction to Firestore:', err);
  }
}

export async function deleteTransactionFromFirestore(id: string) {
  try {
    await deleteDoc(scopedDoc(COLLECTION_TRANSACTIONS, id));
  } catch (err) {
    console.error('Failed to delete transaction from Firestore:', err);
  }
}

export async function syncCategoriesToFirestore(categories: Category[]) {
  try {
    for (let offset = 0; offset < categories.length; offset += 400) {
      const batch = writeBatch(db);
      categories.slice(offset, offset + 400).forEach(cat => {
        batch.set(scopedDoc(COLLECTION_CATEGORIES, cat.id), cat);
      });
      await batch.commit();
    }
  } catch (err) {
    console.error('Failed to sync categories to Firestore:', err);
  }
}

export async function deleteCategoryFromFirestore(id: string) {
  try {
    await deleteDoc(scopedDoc(COLLECTION_CATEGORIES, id));
  } catch (err) {
    console.error('Failed to delete category from Firestore:', err);
  }
}

export async function syncBudgetToFirestore(budget: Budget) {
  try {
    await setDoc(scopedDoc(COLLECTION_BUDGETS, budget.yearMonth), budget);
  } catch (err) {
    console.error('Failed to sync budget to Firestore:', err);
  }
}

export async function syncRecurringTemplateToFirestore(tmpl: RecurringTemplate) {
  try {
    await setDoc(scopedDoc(COLLECTION_RECURRING_TEMPLATES, tmpl.id), tmpl);
  } catch (err) {
    console.error('Failed to sync recurring template to Firestore:', err);
  }
}

export async function deleteRecurringTemplateFromFirestore(id: string) {
  try {
    await deleteDoc(scopedDoc(COLLECTION_RECURRING_TEMPLATES, id));
  } catch (err) {
    console.error('Failed to delete recurring template from Firestore:', err);
  }
}

export async function syncRecurringOccurrencesToFirestore(occs: RecurringOccurrence[]) {
  try {
    for (let offset = 0; offset < occs.length; offset += 400) {
      const batch = writeBatch(db);
      occs.slice(offset, offset + 400).forEach(occ => {
        batch.set(scopedDoc(COLLECTION_RECURRING_OCCURRENCES, occ.id), occ);
      });
      await batch.commit();
    }
  } catch (err) {
    console.error('Failed to sync recurring occurrences to Firestore:', err);
  }
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
  try {
    await setDoc(scopedDoc(COLLECTION_MERCHANT_RULES, rule.id), rule);
  } catch (err) {
    console.error('Failed to sync merchant rule to Firestore:', err);
  }
}

export async function syncBankAccountToFirestore(account: BankAccount) {
  try {
    await setDoc(scopedDoc(COLLECTION_BANK_ACCOUNTS, account.id), account);
  } catch (err) {
    console.error('Failed to sync bank account to Firestore:', err);
  }
}

export async function deleteBankAccountFromFirestore(id: string) {
  try {
    await deleteDoc(scopedDoc(COLLECTION_BANK_ACCOUNTS, id));
  } catch (err) {
    console.error('Failed to delete bank account from Firestore:', err);
  }
}

export async function syncPaymentCardToFirestore(card: PaymentCard) {
  try {
    await setDoc(scopedDoc(COLLECTION_PAYMENT_CARDS, card.id), card);
  } catch (err) {
    console.error('Failed to sync payment card to Firestore:', err);
  }
}

export async function deletePaymentCardFromFirestore(id: string) {
  try {
    await deleteDoc(scopedDoc(COLLECTION_PAYMENT_CARDS, id));
  } catch (err) {
    console.error('Failed to delete payment card from Firestore:', err);
  }
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

