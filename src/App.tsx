import React, { useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Navbar } from './components/Navbar';
import { BottomNav, NavTab } from './components/BottomNav';
import { DashboardView } from './components/DashboardView';
import { HistoryView } from './components/HistoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { ManagementView } from './components/ManagementView';
import { AccountsView } from './components/AccountsView';
import { RecurringPaymentView } from './components/RecurringPaymentView';
import { AddTransactionModal } from './components/AddTransactionModal';
import { AppLockModal } from './components/AppLockModal';

import {
  subscribeToStorage,
  getTransactions,
  getCategories,
  getBudget,
  getRecurringTemplates,
  getRecurringOccurrences,
  getMerchantRules,
  getUserProfile,
  getBankAccounts,
  saveBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getPaymentCards,
  savePaymentCard,
  updatePaymentCard,
  deletePaymentCard,
  saveTransaction,
  updateTransaction,
  deleteTransaction,
  postOccurrenceToTransaction,
  updateOccurrenceStatus,
  updateBudget,
  saveCategory,
  toggleCategoryActive,
  mergeAndRemoveCategory,
  updateUserProfile,
  saveMerchantRule,
  saveRecurringTemplate,
  updateRecurringTemplate,
  deleteRecurringTemplate,
  exportTransactionsCSV,
  resetAllData,
  initializeStorageAfterLogin,
  shutdownStorage,
  getClassificationIssueSummary,
  repairClassificationIssues,
} from './utils/storage';
import {
  calculateMonthSummary,
  getCategoryBreakdown,
  getYearMonthString,
  getLocalDateString,
  formatKRW,
} from './utils/calculations';
import { INITIAL_USER_PROFILE, getSampleBudget } from './data/initialData';
import { BankAccount, Budget, Category, MerchantRule, PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction, UserProfile } from './types';
import { auth } from './lib/firebase';
import { logoutOwner } from './utils/auth';

type BootState = 'checking' | 'locked' | 'loading' | 'ready';

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [managementSubTab, setManagementSubTab] = useState<string>('recurring');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [bootState, setBootState] = useState<BootState>('checking');

  // App Reactive State
  const [currentYM, setCurrentYM] = useState<string>(getYearMonthString());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budget, setBudget] = useState<Budget>(() => getSampleBudget(getYearMonthString()));
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([]);
  const [recurringOccurrences, setRecurringOccurrences] = useState<RecurringOccurrence[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [paymentCards, setPaymentCards] = useState<PaymentCard[]>([]);

  // Reload state from storage
  const refreshAppData = () => {
    setTransactions(getTransactions());
    setCategories(getCategories());
    setBudget(getBudget(currentYM));
    setRecurringTemplates(getRecurringTemplates());
    setRecurringOccurrences(getRecurringOccurrences(currentYM));
    setMerchantRules(getMerchantRules());
    setUserProfile(getUserProfile());
    setBankAccounts(getBankAccounts());
    setPaymentCards(getPaymentCards());
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      if (!user) {
        shutdownStorage();
        setBootState('locked');
        return;
      }

      setBootState('loading');
      initializeStorageAfterLogin()
        .then(() => {
          refreshAppData();
          setBootState('ready');
        })
        .catch(async error => {
          console.error('Authenticated data initialization failed:', error);
          shutdownStorage();
          await logoutOwner().catch(() => undefined);
          setBootState('locked');
        });
    });
    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (bootState !== 'ready') return;
    refreshAppData();
    return subscribeToStorage(refreshAppData);
  }, [bootState, currentYM]);

  const handleUnlockSuccess = async () => {
    setBootState('loading');
    await initializeStorageAfterLogin();
    refreshAppData();
    setBootState('ready');
  };

  const handleLock = async () => {
    setIsAddModalOpen(false);
    shutdownStorage();
    await logoutOwner();
    setTransactions([]);
    setCategories([]);
    setRecurringTemplates([]);
    setRecurringOccurrences([]);
    setMerchantRules([]);
    setBankAccounts([]);
    setPaymentCards([]);
    setUserProfile(INITIAL_USER_PROFILE);
    setBootState('locked');
  };

  useEffect(() => {
    if (bootState !== 'ready') return;
    let timer = window.setTimeout(() => void handleLock(), 30 * 60 * 1000);
    const resetIdleTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void handleLock(), 30 * 60 * 1000);
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach(event => window.addEventListener(event, resetIdleTimer, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach(event => window.removeEventListener(event, resetIdleTimer));
    };
  }, [bootState]);

  // Calculations
  const summary = useMemo(() => {
    return calculateMonthSummary(currentYM, transactions, recurringOccurrences, budget, recurringTemplates);
  }, [currentYM, transactions, recurringOccurrences, budget, recurringTemplates]);

  const categoryMap = useMemo(() => {
    return Object.fromEntries(categories.map(c => [c.id, { name: c.name, color: c.color, icon: c.icon, type: c.type }]));
  }, [categories]);

  const categoryBreakdown = useMemo(() => {
    return getCategoryBreakdown(currentYM, transactions, categoryMap);
  }, [currentYM, transactions, categoryMap]);

  const classificationIssues = useMemo(
    () => getClassificationIssueSummary(),
    [transactions, categories, recurringTemplates, recurringOccurrences],
  );

  // Next Payday badge
  const nextPaydayText = useMemo(() => {
    const salaryTmpl = recurringTemplates.find(t => t.type === 'income' && t.active);
    if (!salaryTmpl) return '';
    return `다음 월급일: 매월 ${salaryTmpl.dayOfMonth}일`;
  }, [recurringTemplates]);

  // Handlers
  const handleNavigateTab = (tab: NavTab, subTab?: string) => {
    setActiveTab(tab);
    if (subTab) {
      setManagementSubTab(subTab);
    }
  };

  const handlePostOccurrence = async (occId: string) => {
    await postOccurrenceToTransaction(occId);
    refreshAppData();
  };

  const handleApplyPresetOnboarding = () => {
    if (confirm('월급 350만, 생활비 120만, 주거/관리비 38만의 기본 예시 정기 항목을 생성하시겠습니까?')) {
      const yearMonth = getYearMonthString();
      saveRecurringTemplate({
        type: 'income',
        name: '월급',
        defaultAmount: 3500000,
        categoryId: 'salary',
        counterparty: '(주)지출브레이크',
        frequency: 'monthly',
        dayOfMonth: 25,
        holidayPolicy: 'previous_business_day',
        postingMode: 'confirm',
        allowAmountChange: true,
        startDate: `${yearMonth}-01`,
        nextDueDate: `${yearMonth}-25`,
        active: true,
      });

      saveRecurringTemplate({
        type: 'expense',
        name: '배우자 생활비',
        defaultAmount: 1200000,
        categoryId: 'family_allowance',
        counterparty: '배우자 계좌',
        expenseNature: 'fixed',
        frequency: 'monthly',
        dayOfMonth: 1,
        holidayPolicy: 'fixed_date',
        postingMode: 'confirm',
        allowAmountChange: false,
        startDate: `${yearMonth}-01`,
        nextDueDate: `${yearMonth}-01`,
        active: true,
      });

      saveRecurringTemplate({
        type: 'expense',
        name: '아파트 관리비 및 주거비',
        defaultAmount: 380000,
        categoryId: 'housing_utilities',
        counterparty: '관리사무소',
        expenseNature: 'fixed',
        frequency: 'monthly',
        dayOfMonth: 15,
        holidayPolicy: 'next_business_day',
        postingMode: 'confirm',
        allowAmountChange: true,
        startDate: `${yearMonth}-01`,
        nextDueDate: `${yearMonth}-15`,
        active: true,
      });

      alert('월급 생활자 추천 설정이 성공적으로 반영되었습니다!');
    }
  };

  const handleExportCSV = () => {
    const csvContent = exportTransactionsCSV(currentYM);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `지출브레이크_거래내역_${currentYM}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (bootState === 'checking' || bootState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 mx-auto rounded-full border-4 border-slate-800 border-t-emerald-400 animate-spin" />
          <p className="font-bold">운영 데이터를 안전하게 불러오는 중입니다.</p>
          <p className="text-xs text-slate-500">검증이 끝날 때까지 금융 정보는 표시되지 않습니다.</p>
        </div>
      </div>
    );
  }

  if (bootState === 'locked') {
    return <AppLockModal isOpen onUnlockSuccess={handleUnlockSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-rose-500 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        userProfile={userProfile}
        nextPaydayText={nextPaydayText}
        onOpenSettings={() => handleNavigateTab('management', 'settings')}
        onLock={handleLock}
      />

      {/* Main View Area */}
      <main className="max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-4xl mx-auto px-4 py-5">
        {activeTab === 'home' && (
          <DashboardView
            summary={summary}
            upcomingOccurrences={recurringOccurrences}
            categories={categories}
            categoryBreakdown={categoryBreakdown}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onNavigateTab={(tab, sub) => handleNavigateTab(tab as NavTab, sub)}
            onConfirmOccurrence={handlePostOccurrence}
            onApplyPresetOnboarding={handleApplyPresetOnboarding}
          />
        )}

        {activeTab === 'recurring_payment' && (
          <RecurringPaymentView
            currentYM={currentYM}
            onChangeYM={setCurrentYM}
            recurringOccurrences={recurringOccurrences}
            recurringTemplates={recurringTemplates}
            categories={categories}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            classificationIssues={classificationIssues}
            onPostOccurrence={async (occId, amt, pType, accId, cId) => {
              await postOccurrenceToTransaction(occId, amt, pType, accId, cId);
              refreshAppData();
            }}
            onUpdateOccurrenceStatus={(occId, status) => {
              updateOccurrenceStatus(occId, status);
              refreshAppData();
            }}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsView
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            onSaveBankAccount={(acc) => {
              saveBankAccount(acc);
              refreshAppData();
            }}
            onUpdateBankAccount={(id, updates) => {
              updateBankAccount(id, updates);
              refreshAppData();
            }}
            onDeleteBankAccount={(id) => {
              if (!deleteBankAccount(id)) {
                alert('카드, 정기 항목 또는 거래에서 사용 중인 계좌입니다. 연결을 변경한 뒤 삭제해 주세요.');
              }
              refreshAppData();
            }}
            onSavePaymentCard={(card) => {
              savePaymentCard(card);
              refreshAppData();
            }}
            onUpdatePaymentCard={(id, updates) => {
              updatePaymentCard(id, updates);
              refreshAppData();
            }}
            onDeletePaymentCard={(id) => {
              if (!deletePaymentCard(id)) {
                alert('정기 항목 또는 거래에서 사용 중인 카드입니다. 연결을 변경한 뒤 삭제해 주세요.');
              }
              refreshAppData();
            }}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            transactions={transactions}
            categories={categories}
            onDeleteTransaction={deleteTransaction}
            onUpdateTransaction={updateTransaction}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView
            summary={summary}
            transactions={transactions}
            categories={categories}
            budget={budget}
            aiInsightsEnabled={userProfile.aiInsightsEnabled}
          />
        )}

        {activeTab === 'management' && (
          <ManagementView
            initialSubTab={managementSubTab}
            recurringTemplates={recurringTemplates}
            recurringOccurrences={recurringOccurrences}
            budget={budget}
            categories={categories}
            userProfile={userProfile}
            merchantRules={merchantRules}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            onSaveRecurringTemplate={saveRecurringTemplate}
            onUpdateRecurringTemplate={updateRecurringTemplate}
            onDeleteRecurringTemplate={deleteRecurringTemplate}
            onPostOccurrence={handlePostOccurrence}
            onUpdateOccurrenceStatus={updateOccurrenceStatus}
            onUpdateBudget={updateBudget}
            onSaveCategory={saveCategory}
            onToggleCategoryActive={toggleCategoryActive}
            onMergeCategory={mergeAndRemoveCategory}
            onUpdateUserProfile={updateUserProfile}
            onExportCSV={handleExportCSV}
            onResetData={resetAllData}
            onRepairClassificationIssues={repairClassificationIssues}
          />
        )}
      </main>

      {/* Central Add Transaction Modal */}
      <AddTransactionModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        categories={categories}
        merchantRules={merchantRules}
        bankAccounts={bankAccounts}
        paymentCards={paymentCards}
        aiClassificationEnabled={userProfile.aiClassificationEnabled}
        onSaveTransaction={saveTransaction}
        onSaveMerchantRule={saveMerchantRule}
      />

      {/* Fixed Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={tab => handleNavigateTab(tab)}
        onOpenAddModal={() => setIsAddModalOpen(true)}
      />
    </div>
  );
}
