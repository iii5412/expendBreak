import { transactionsCsv } from '../utils/transactionCsv';
import { useMemo, useState, useEffect } from 'react';
import { AccountBudgetView, type BudgetAccountActions } from './AccountBudgetView';
import { budgetWithSettings, transactionForStorage, type BudgetAccountData } from './adapter';
import {
  createOccurrenceForPeriod,
  deleteRecurringTemplate,
  getAllRecurringOccurrences,
  getBudget,
  getCategories,
  getMerchantRules,
  getRecurringTemplates,
  getTransactions,
  getUserProfile,
  postOccurrenceToTransaction,
  saveRecurringTemplate,
  resetAllData,
  saveTransaction,
  saveMerchantRule,
  subscribeToStorage,
  updateBudget,
  updateOccurrenceStatus,
  updateRecurringTemplate,
  updateUserProfile,
} from '../utils/storage';
import { getCurrentYearMonth, getLocalDateString } from '../utils/calculations';
import { fetchAllTransactionsForExport, getLoadedTransactionHistoryFloor } from '../utils/cloudSync';
import { authenticatedFetch, getSignedInAccount, isOwnerLoggedIn } from '../utils/auth';
import { aiRequest } from './aiClient';
import { BudgetMerchantRule } from '../lib/budgetAi';
import { auth } from '../lib/firebase';
import { OfflineBanner, SyncStatusIndicator, StorageFullBanner } from '../components/SyncStatusIndicator';
import { SyncConflictBanner } from '../components/SyncConflictBanner';
import './styles.css';

function readAccount(): BudgetAccountData {
  const profile = getUserProfile();
  return {
    profile,
    transactions: getTransactions(),
    templates: getRecurringTemplates(),
    occurrences: getAllRecurringOccurrences(),
    budget: getBudget(getCurrentYearMonth(profile.monthStartDay)),
    categories: getCategories(),
    historyFloor: getLoadedTransactionHistoryFloor(),
    merchantRules: getMerchantRules(),
  };
}

/** Mounted only after the existing App's PIN/session/migration gates have passed. */
export function ConnectedBudgetView({ onLock }: { onLock: () => void }) {
  const [account, setAccount] = useState(readAccount);
  useEffect(() => {
    const refresh = () => setAccount(readAccount());
    const unsubscribe = subscribeToStorage(refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  const actions = useMemo<BudgetAccountActions>(() => {
    const uid = getSignedInAccount().uid;
    const guard = () => {
      if (!isOwnerLoggedIn() || auth.currentUser?.uid !== uid || getSignedInAccount().uid !== uid)
        throw new Error('다시 로그인해 주세요.');
    };
    return {
      exportCsv: async () => {
        guard();
        const all = await fetchAllTransactionsForExport();
        guard();
        return transactionsCsv(all.transactions, all.categories);
      },
      resetData: async () => {
        guard();
        await resetAllData();
      },
      saveAiSettings: async (classification, insights) => {
        guard();
        updateUserProfile({
          aiClassificationEnabled: classification,
          aiInsightsEnabled: insights,
          aiConsentAt: classification || insights ? new Date().toISOString() : null,
        });
      },
      saveRule: async (pattern, categoryId) => {
        guard();
        const rule = BudgetMerchantRule.parse({ pattern, categoryId });
        if (!getCategories().some((c) => c.id === rule.categoryId && c.active))
          throw new Error('카테고리를 확인해 주세요.');
        saveMerchantRule(rule.pattern, rule.categoryId);
      },
      saveTransaction: async (transaction) => {
        guard();
        const saved = saveTransaction(transactionForStorage(transaction));
        void saved.synced;
      },
      saveSettings: async (settings) => {
        guard();
        const profile = getUserProfile();
        await updateBudget(budgetWithSettings(getBudget(getCurrentYearMonth(profile.monthStartDay)), settings));
        guard();
        updateUserProfile({
          categoryCountLimits: settings.categoryCountLimits || {},
          categoryAmountLimits: settings.categoryAmountLimits || {},
        });
      },
      saveTemplate: async (template, id) => {
        guard();
        if (id) {
          if (!updateRecurringTemplate(id, template)) throw new Error('항목을 찾을 수 없습니다.');
        } else {
          const created = saveRecurringTemplate(template);
          createOccurrenceForPeriod(
            created.id,
            getCurrentYearMonth(getUserProfile().monthStartDay),
            getUserProfile().monthStartDay,
          );
        }
      },
      archive: async (id) => {
        guard();
        if (!deleteRecurringTemplate(id)) throw new Error('항목을 찾을 수 없습니다.');
      },
      post: async (id, amount) => {
        guard();
        if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('금액을 확인해 주세요.');
        const posted = await postOccurrenceToTransaction(id, amount);
        if (!posted) throw new Error('이미 반영되었거나 상태가 변경됐습니다. 목록을 확인해 주세요.');
      },
      skip: async (id) => {
        guard();
        const target = getAllRecurringOccurrences().find((o) => o.id === id);
        if (!target || target.status === 'posted' || target.status === 'skipped')
          throw new Error('이미 처리된 회차입니다. 목록을 확인해 주세요.');
        updateOccurrenceStatus(id, 'skipped');
      },
      skipSetup: async () => {
        guard();
        updateUserProfile({ onboardingCompletedAt: new Date().toISOString() });
      },
      completeSetup: async (setup) => {
        guard();
        const existing = getRecurringTemplates();
        // Retry after a partial/offline save never creates duplicate setup templates.
        if (!existing.some((t) => t.budgetSetupRole === 'salary'))
          saveRecurringTemplate({
            budgetSetupRole: 'salary',
            type: 'income',
            name: '월급',
            categoryId: getCategories().find((c) => c.active && c.type === 'income')?.id || 'salary',
            counterparty: '월급',
            defaultAmount: setup.salary,
            frequency: 'monthly',
            dayOfMonth: setup.salaryDay,
            holidayPolicy: 'previous_business_day',
            postingMode: 'confirm',
            allowAmountChange: false,
            startDate: getLocalDateString(),
            nextDueDate: getLocalDateString(),
            active: true,
          });
        if (setup.fixed > 0 && !existing.some((t) => t.budgetSetupRole === 'fixed'))
          saveRecurringTemplate({
            budgetSetupRole: 'fixed',
            type: 'expense',
            name: '배우자 생활비·주거비',
            categoryId:
              getCategories().find((c) => c.id === 'housing_utilities' && c.active)?.id ||
              getCategories().find((c) => c.active && c.type === 'expense')?.id,
            counterparty: '월 고정비',
            expenseNature: 'fixed',
            defaultAmount: setup.fixed,
            frequency: 'monthly',
            dayOfMonth: setup.fixedDay,
            holidayPolicy: 'fixed_date',
            postingMode: 'confirm',
            allowAmountChange: false,
            startDate: getLocalDateString(),
            nextDueDate: getLocalDateString(),
            active: true,
          });
        updateUserProfile({
          monthStartDay: setup.salaryDay,
          paydaySchedule: [{ fromYearMonth: '', monthStartDay: setup.salaryDay }],
        });
        const key = getCurrentYearMonth(setup.salaryDay);
        const delivery = getCategories().find((c) => c.active && c.name.includes('배달'))?.id;
        await updateBudget({
          ...getBudget(key),
          totalLimit: setup.limit,
          categoryCountLimits: delivery ? { [delivery]: setup.deliveryCount } : {},
        });
        guard();
        getRecurringTemplates()
          .filter((t) => t.budgetSetupRole)
          .forEach((t) => createOccurrenceForPeriod(t.id, key, setup.salaryDay));
        updateUserProfile({
          onboardingCompletedAt: new Date().toISOString(),
          categoryCountLimits: delivery ? { [delivery]: setup.deliveryCount } : {},
        });
      },
    };
  }, []);
  return (
    <>
      <OfflineBanner />
      <StorageFullBanner />
      <SyncConflictBanner
        onReview={() => {
          window.location.href = '/';
        }}
      />
      <AccountBudgetView
        account={account}
        actions={actions}
        isDemo={false}
        aiRequest={aiRequest(authenticatedFetch)}
        accountContent={
          <section className="bb-card">
            <div className="bb-section-heading">
              <h2>{getSignedInAccount().name}의 가계부</h2>
              <SyncStatusIndicator />
            </div>
            <div className="bb-button-row">
              <a href="/">기존 화면으로</a>
              <button type="button" className="bb-small-button" onClick={onLock}>
                잠그기
              </button>
            </div>
          </section>
        }
      />
    </>
  );
}
