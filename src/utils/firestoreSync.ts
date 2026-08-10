import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase';
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

/**
 * Initialize Firestore Listeners to sync cloud DB data with local state in real-time
 */
export function initFirestoreSync(onNotify: SyncNotifyCallback) {
  if (isSyncInitialized) return;
  isSyncInitialized = true;

  try {
    // 1. App Settings / User Profile (including access PIN)
    const settingsDocRef = doc(db, COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS);
    onSnapshot(settingsDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const cloudProfile = snapshot.data() as UserProfile;
        const localRaw = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
        const localProfile = localRaw ? JSON.parse(localRaw) : {};
        const merged = { ...localProfile, ...cloudProfile };
        localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(merged));
        onNotify();
      }
    });

    // 2. Categories
    onSnapshot(collection(db, COLLECTION_CATEGORIES), (snapshot) => {
      if (!snapshot.empty) {
        const cloudCats: Category[] = [];
        snapshot.forEach((docSnap) => {
          cloudCats.push({ id: docSnap.id, ...docSnap.data() } as Category);
        });
        localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cloudCats));
        onNotify();
      }
    });

    // 3. Transactions
    onSnapshot(collection(db, COLLECTION_TRANSACTIONS), (snapshot) => {
      const cloudTxs: Transaction[] = [];
      snapshot.forEach((docSnap) => {
        cloudTxs.push({ id: docSnap.id, ...docSnap.data() } as Transaction);
      });
      // Sort newest first
      cloudTxs.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(cloudTxs));
      onNotify();
    });

    // 4. Budgets
    onSnapshot(collection(db, COLLECTION_BUDGETS), (snapshot) => {
      const budgetMap: Record<string, Budget> = {};
      snapshot.forEach((docSnap) => {
        budgetMap[docSnap.id] = docSnap.data() as Budget;
      });
      if (Object.keys(budgetMap).length > 0) {
        localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgetMap));
        onNotify();
      }
    });

    // 5. Recurring Templates
    onSnapshot(collection(db, COLLECTION_RECURRING_TEMPLATES), (snapshot) => {
      const tmpls: RecurringTemplate[] = [];
      snapshot.forEach((docSnap) => {
        tmpls.push({ id: docSnap.id, ...docSnap.data() } as RecurringTemplate);
      });
      localStorage.setItem(STORAGE_KEYS.RECURRING_TEMPLATES, JSON.stringify(tmpls));
      onNotify();
    });

    // 6. Recurring Occurrences
    onSnapshot(collection(db, COLLECTION_RECURRING_OCCURRENCES), (snapshot) => {
      const occs: RecurringOccurrence[] = [];
      snapshot.forEach((docSnap) => {
        occs.push({ id: docSnap.id, ...docSnap.data() } as RecurringOccurrence);
      });
      localStorage.setItem(STORAGE_KEYS.RECURRING_OCCURRENCES, JSON.stringify(occs));
      onNotify();
    });

    // 7. Merchant Rules
    onSnapshot(collection(db, COLLECTION_MERCHANT_RULES), (snapshot) => {
      const rules: MerchantRule[] = [];
      snapshot.forEach((docSnap) => {
        rules.push({ id: docSnap.id, ...docSnap.data() } as MerchantRule);
      });
      localStorage.setItem(STORAGE_KEYS.MERCHANT_RULES, JSON.stringify(rules));
      onNotify();
    });

    // 8. Bank Accounts
    onSnapshot(collection(db, COLLECTION_BANK_ACCOUNTS), (snapshot) => {
      const accounts: BankAccount[] = [];
      snapshot.forEach((docSnap) => {
        accounts.push({ id: docSnap.id, ...docSnap.data() } as BankAccount);
      });
      localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify(accounts));
      onNotify();
    });

    // 9. Payment Cards
    onSnapshot(collection(db, COLLECTION_PAYMENT_CARDS), (snapshot) => {
      const cards: PaymentCard[] = [];
      snapshot.forEach((docSnap) => {
        cards.push({ id: docSnap.id, ...docSnap.data() } as PaymentCard);
      });
      localStorage.setItem(STORAGE_KEYS.PAYMENT_CARDS, JSON.stringify(cards));
      onNotify();
    });
  } catch (err) {
    console.error('Firestore sync error:', err);
  }
}

/* Helper functions to save / update / delete items in Firestore */

export async function syncUserProfileToFirestore(profile: UserProfile) {
  try {
    const settingsDocRef = doc(db, COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS);
    await setDoc(settingsDocRef, profile, { merge: true });
  } catch (err) {
    console.error('Failed to sync user profile to Firestore:', err);
  }
}

export async function fetchUserProfileFromFirestore(): Promise<UserProfile | null> {
  try {
    const settingsDocRef = doc(db, COLLECTION_APP_SETTINGS, DOC_GLOBAL_SETTINGS);
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
    await setDoc(doc(db, COLLECTION_TRANSACTIONS, tx.id), tx);
  } catch (err) {
    console.error('Failed to sync transaction to Firestore:', err);
  }
}

export async function deleteTransactionFromFirestore(id: string) {
  try {
    await deleteDoc(doc(db, COLLECTION_TRANSACTIONS, id));
  } catch (err) {
    console.error('Failed to delete transaction from Firestore:', err);
  }
}

export async function syncCategoriesToFirestore(categories: Category[]) {
  try {
    const batch = writeBatch(db);
    categories.forEach((cat) => {
      batch.set(doc(db, COLLECTION_CATEGORIES, cat.id), cat);
    });
    await batch.commit();
  } catch (err) {
    console.error('Failed to sync categories to Firestore:', err);
  }
}

export async function syncBudgetToFirestore(budget: Budget) {
  try {
    await setDoc(doc(db, COLLECTION_BUDGETS, budget.yearMonth), budget);
  } catch (err) {
    console.error('Failed to sync budget to Firestore:', err);
  }
}

export async function syncRecurringTemplateToFirestore(tmpl: RecurringTemplate) {
  try {
    await setDoc(doc(db, COLLECTION_RECURRING_TEMPLATES, tmpl.id), tmpl);
  } catch (err) {
    console.error('Failed to sync recurring template to Firestore:', err);
  }
}

export async function deleteRecurringTemplateFromFirestore(id: string) {
  try {
    await deleteDoc(doc(db, COLLECTION_RECURRING_TEMPLATES, id));
  } catch (err) {
    console.error('Failed to delete recurring template from Firestore:', err);
  }
}

export async function syncRecurringOccurrencesToFirestore(occs: RecurringOccurrence[]) {
  try {
    const batch = writeBatch(db);
    occs.forEach((occ) => {
      batch.set(doc(db, COLLECTION_RECURRING_OCCURRENCES, occ.id), occ);
    });
    await batch.commit();
  } catch (err) {
    console.error('Failed to sync recurring occurrences to Firestore:', err);
  }
}

export async function syncMerchantRuleToFirestore(rule: MerchantRule) {
  try {
    await setDoc(doc(db, COLLECTION_MERCHANT_RULES, rule.id), rule);
  } catch (err) {
    console.error('Failed to sync merchant rule to Firestore:', err);
  }
}

export async function syncBankAccountToFirestore(account: BankAccount) {
  try {
    await setDoc(doc(db, COLLECTION_BANK_ACCOUNTS, account.id), account);
  } catch (err) {
    console.error('Failed to sync bank account to Firestore:', err);
  }
}

export async function deleteBankAccountFromFirestore(id: string) {
  try {
    await deleteDoc(doc(db, COLLECTION_BANK_ACCOUNTS, id));
  } catch (err) {
    console.error('Failed to delete bank account from Firestore:', err);
  }
}

export async function syncPaymentCardToFirestore(card: PaymentCard) {
  try {
    await setDoc(doc(db, COLLECTION_PAYMENT_CARDS, card.id), card);
  } catch (err) {
    console.error('Failed to sync payment card to Firestore:', err);
  }
}

export async function deletePaymentCardFromFirestore(id: string) {
  try {
    await deleteDoc(doc(db, COLLECTION_PAYMENT_CARDS, id));
  } catch (err) {
    console.error('Failed to delete payment card from Firestore:', err);
  }
}

export async function clearFirestoreAllData() {
  try {
    const collectionsToClear = [
      COLLECTION_TRANSACTIONS,
      COLLECTION_BUDGETS,
      COLLECTION_RECURRING_TEMPLATES,
      COLLECTION_RECURRING_OCCURRENCES,
      COLLECTION_MERCHANT_RULES,
      COLLECTION_BANK_ACCOUNTS,
      COLLECTION_PAYMENT_CARDS,
    ];

    for (const colName of collectionsToClear) {
      const snap = await getDocs(collection(db, colName));
      const batch = writeBatch(db);
      snap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
    }
  } catch (err) {
    console.error('Failed to clear Firestore collections:', err);
  }
}

