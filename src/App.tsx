import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  restoreTransaction,
  finalizeTransactionDeletion,
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
  getAccountingPeriod,
  getCategoryBreakdown,
  getCurrentYearMonth,
  getYearMonthString,
  getLocalDateString,
  formatKRW,
  normalizeMonthStartDay,
} from './utils/calculations';
import { calculateCardPaymentSummary, calculateMonthlyCardSettlementSummary } from './utils/cardPayments';
import { INITIAL_USER_PROFILE, getSampleBudget } from './data/initialData';
import { BankAccount, Budget, Category, MerchantRule, PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction, UserProfile } from './types';
import { logoutOwner, onSessionStateChanged } from './utils/auth';
import { startNetworkWatch } from './utils/syncStatus';
import { normalizeIdleLockMinutes } from './utils/lockPolicy';
import { OfflineBanner, SyncStatusIndicator } from './components/SyncStatusIndicator';
import { useConfirm, useToast } from './components/ui/FeedbackProvider';
import { PeriodSelector } from './components/PeriodSelector';
import { OnboardingResult, OnboardingSheet } from './components/OnboardingSheet';

type BootState = 'checking' | 'locked' | 'loading' | 'ready';

const UNDO_WINDOW_MS = 10000;
const LOCK_WARNING_MS = 60000;

export default function App() {
  const { showToast, dismissToast } = useToast();
  const confirm = useConfirm();

  // Navigation State
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [managementSubTab, setManagementSubTab] = useState<string>('recurring');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
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
    // Read the profile first: the accounting period depends on monthStartDay.
    const profile = getUserProfile();
    const startDay = normalizeMonthStartDay(profile.monthStartDay);
    setUserProfile(profile);
    setTransactions(getTransactions());
    setCategories(getCategories());
    setBudget(getBudget(currentYM));
    setRecurringTemplates(getRecurringTemplates());
    setRecurringOccurrences(getRecurringOccurrences(currentYM, startDay));
    setMerchantRules(getMerchantRules());
    setBankAccounts(getBankAccounts());
    setPaymentCards(getPaymentCards());
  };

  useEffect(() => startNetworkWatch(), []);

  useEffect(() => {
    const unsubscribeAuth = onSessionStateChanged(isLoggedIn => {
      if (!isLoggedIn) {
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

  /** Idle auto-lock. 0 disables it; a warning lands LOCK_WARNING_MS before locking. */
  const idleLockMinutes = normalizeIdleLockMinutes(userProfile.idleLockMinutes);

  useEffect(() => {
    if (bootState !== 'ready' || idleLockMinutes <= 0) return;

    const idleMs = idleLockMinutes * 60 * 1000;
    const warningMs = Math.max(0, idleMs - LOCK_WARNING_MS);
    let lockTimer = 0;
    let warningTimer = 0;
    let warningToastId: string | null = null;

    const schedule = () => {
      window.clearTimeout(lockTimer);
      window.clearTimeout(warningTimer);
      warningTimer = window.setTimeout(() => {
        warningToastId = showToast({
          message: '잠시 후 자동 잠금됩니다.',
          description: `${Math.round(LOCK_WARNING_MS / 1000)}초 안에 화면을 누르면 계속 사용할 수 있습니다.`,
          tone: 'warning',
          durationMs: LOCK_WARNING_MS,
          action: { label: '계속 사용', onAction: () => schedule() },
        });
      }, warningMs);
      lockTimer = window.setTimeout(() => void handleLock(), idleMs);
    };

    const resetIdleTimer = () => {
      if (warningToastId) {
        dismissToast(warningToastId);
        warningToastId = null;
      }
      schedule();
    };

    schedule();
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach(event => window.addEventListener(event, resetIdleTimer, { passive: true }));
    return () => {
      window.clearTimeout(lockTimer);
      window.clearTimeout(warningTimer);
      events.forEach(event => window.removeEventListener(event, resetIdleTimer));
    };
  }, [bootState, idleLockMinutes]);

  // Accounting period. monthStartDay lets a salaried user align the cycle with payday.
  const monthStartDay = useMemo(
    () => normalizeMonthStartDay(userProfile.monthStartDay),
    [userProfile.monthStartDay],
  );
  const period = useMemo(
    () => getAccountingPeriod(currentYM, monthStartDay),
    [currentYM, monthStartDay],
  );
  const currentPeriodYM = useMemo(() => getCurrentYearMonth(monthStartDay), [monthStartDay]);

  // Realign the selected period after login or a monthStartDay change so the app
  // never opens on a period that no longer contains today.
  const alignedStartDay = useRef<number | null>(null);
  useEffect(() => {
    if (bootState !== 'ready') {
      alignedStartDay.current = null;
      return;
    }
    if (alignedStartDay.current === monthStartDay) return;
    alignedStartDay.current = monthStartDay;
    setCurrentYM(getCurrentYearMonth(monthStartDay));
  }, [bootState, monthStartDay]);

  // Calculations
  const summary = useMemo(() => {
    return calculateMonthSummary(
      currentYM,
      transactions,
      recurringOccurrences,
      budget,
      recurringTemplates,
      new Date(),
      monthStartDay,
    );
  }, [currentYM, transactions, recurringOccurrences, budget, recurringTemplates, monthStartDay]);

  const categoryMap = useMemo(() => {
    return Object.fromEntries(categories.map(c => [c.id, { name: c.name, color: c.color, icon: c.icon, type: c.type }]));
  }, [categories]);

  const categoryBreakdown = useMemo(() => {
    return getCategoryBreakdown(currentYM, transactions, categoryMap, { variableOnly: true, monthStartDay });
  }, [currentYM, transactions, categoryMap, monthStartDay]);

  const cardPaymentSummary = useMemo(
    () => calculateCardPaymentSummary(currentYM, transactions, paymentCards, monthStartDay),
    [currentYM, transactions, paymentCards, monthStartDay],
  );

  const cardSettlementSummary = useMemo(
    () => calculateMonthlyCardSettlementSummary(currentYM, transactions, paymentCards, monthStartDay),
    [currentYM, transactions, paymentCards, monthStartDay],
  );

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

  const handleSaveTransaction = (tx: Parameters<typeof saveTransaction>[0]) => {
    const { transaction, synced } = saveTransaction(tx);
    const label = `${transaction.merchant || '거래'} ${formatKRW(transaction.amount)}`;
    void synced.then(ok => {
      showToast(
        ok
          ? { message: '거래를 저장했습니다.', description: label, tone: 'success' }
          : {
              message: '이 기기에 저장했습니다.',
              description: `${label} · DB 반영은 연결이 복구되면 자동으로 재시도합니다.`,
              tone: 'warning',
            },
      );
    });
    return transaction;
  };

  const handleDeleteTransaction = async (transaction: Transaction) => {
    const category = categories.find(item => item.id === transaction.categoryId);
    const accepted = await confirm({
      title: '이 거래를 삭제할까요?',
      description: '삭제 후 10초 안에는 실행 취소할 수 있습니다.',
      details: [
        { label: '사용처', value: transaction.merchant || '사용처 미입력' },
        { label: '금액', value: `${transaction.type === 'income' ? '+' : '-'}${formatKRW(transaction.amount)}` },
        { label: '날짜', value: transaction.localDate },
        { label: '카테고리', value: category?.name || '기타' },
      ],
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!accepted) return;

    const snapshot = deleteTransaction(transaction.id);
    if (!snapshot) {
      showToast({ message: '이미 삭제된 거래입니다.', tone: 'info' });
      return;
    }
    refreshAppData();

    let undone = false;
    const finalizeTimer = window.setTimeout(() => {
      if (!undone) finalizeTransactionDeletion(snapshot);
    }, UNDO_WINDOW_MS);

    showToast({
      message: '거래를 삭제했습니다.',
      description: `${transaction.merchant || '사용처 미입력'} ${formatKRW(transaction.amount)}`,
      tone: 'info',
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: '실행 취소',
        onAction: () => {
          undone = true;
          window.clearTimeout(finalizeTimer);
          restoreTransaction(snapshot.transaction, snapshot.restoredOccurrenceIds);
          refreshAppData();
          showToast({ message: '삭제를 취소했습니다.', tone: 'success' });
        },
      },
    });
  };

  const handleCompleteOnboarding = (result: OnboardingResult) => {
    const yearMonth = getYearMonthString();
    const padDay = (day: number) => String(Math.min(28, Math.max(1, day))).padStart(2, '0');

    saveRecurringTemplate({
      type: 'income',
      name: '월 수입',
      defaultAmount: result.monthlyIncome,
      categoryId: 'salary',
      counterparty: '급여 계좌',
      frequency: 'monthly',
      dayOfMonth: result.incomeDay,
      holidayPolicy: 'previous_business_day',
      postingMode: 'confirm',
      allowAmountChange: true,
      startDate: `${yearMonth}-01`,
      nextDueDate: `${yearMonth}-${padDay(result.incomeDay)}`,
      active: true,
    });

    if (result.fixedExpense > 0) {
      saveRecurringTemplate({
        type: 'expense',
        name: '월 고정비',
        defaultAmount: result.fixedExpense,
        categoryId: 'housing_utilities',
        counterparty: '고정 출금',
        expenseNature: 'fixed',
        frequency: 'monthly',
        dayOfMonth: result.fixedExpenseDay,
        holidayPolicy: 'next_business_day',
        postingMode: 'confirm',
        allowAmountChange: true,
        startDate: `${yearMonth}-01`,
        nextDueDate: `${yearMonth}-${padDay(result.fixedExpenseDay)}`,
        active: true,
      });
    }

    void updateBudget({ ...getBudget(currentYM), totalLimit: result.allowanceLimit })
      .catch(error => showToast({
        message: '용돈 한도를 DB에 저장하지 못했습니다.',
        description: error instanceof Error ? error.message : undefined,
        tone: 'error',
      }));

    updateUserProfile({ onboardingCompletedAt: new Date().toISOString() });
    setIsOnboardingOpen(false);
    refreshAppData();
    showToast({
      message: '초기 설정을 저장했습니다.',
      description: '설정 > 정기 항목에서 이름과 카테고리를 바꿀 수 있습니다.',
      tone: 'success',
    });
  };

  const handleSkipOnboarding = () => {
    updateUserProfile({ onboardingCompletedAt: new Date().toISOString() });
    setIsOnboardingOpen(false);
    refreshAppData();
  };

  const handleExportCSV = () => {
    const csvContent = exportTransactionsCSV(currentYM, monthStartDay);
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
        syncStatusSlot={<SyncStatusIndicator />}
      />
      <OfflineBanner />

      {/* Main View Area */}
      <main
        className="max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-4xl mx-auto px-4 py-5"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* One period control for every screen that shows period-scoped amounts. */}
        <div className="mb-4">
          <PeriodSelector
            period={period}
            currentYearMonth={currentPeriodYM}
            onChange={setCurrentYM}
          />
        </div>

        {activeTab === 'home' && (
          <DashboardView
            summary={summary}
            upcomingOccurrences={recurringOccurrences}
            categories={categories}
            categoryBreakdown={categoryBreakdown}
            cardPaymentSummary={cardPaymentSummary}
            cardSettlementSummary={cardSettlementSummary}
            bankAccounts={bankAccounts}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onNavigateTab={(tab, sub) => handleNavigateTab(tab as NavTab, sub)}
            onConfirmOccurrence={handlePostOccurrence}
            showSetupPrompt={recurringTemplates.length === 0 && !userProfile.onboardingCompletedAt}
            onStartSetup={() => setIsOnboardingOpen(true)}
          />
        )}

        {activeTab === 'recurring_payment' && (
          <RecurringPaymentView
            period={period}
            recurringOccurrences={recurringOccurrences}
            recurringTemplates={recurringTemplates}
            categories={categories}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
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
            currentYM={currentYM}
            monthStartDay={monthStartDay}
            transactions={transactions}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            cardSettlementSummary={cardSettlementSummary}
            onSaveBankAccount={(acc) => {
              saveBankAccount(acc);
              refreshAppData();
            }}
            onUpdateBankAccount={(id, updates) => {
              updateBankAccount(id, updates);
              refreshAppData();
            }}
            onDeleteBankAccount={(id) => {
              if (deleteBankAccount(id)) {
                showToast({ message: '계좌를 삭제했습니다.', tone: 'success' });
              } else {
                showToast({
                  message: '사용 중인 계좌는 삭제할 수 없습니다.',
                  description: '카드, 정기 항목 또는 거래에서 이 계좌를 참조하고 있습니다. 연결을 먼저 변경해 주세요.',
                  tone: 'error',
                });
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
              if (deletePaymentCard(id)) {
                showToast({ message: '카드를 삭제했습니다.', tone: 'success' });
              } else {
                showToast({
                  message: '사용 중인 카드는 삭제할 수 없습니다.',
                  description: '정기 항목 또는 거래에서 이 카드를 참조하고 있습니다. 연결을 먼저 변경해 주세요.',
                  tone: 'error',
                });
              }
              refreshAppData();
            }}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            transactions={transactions}
            categories={categories}
            period={period}
            onDeleteTransaction={handleDeleteTransaction}
            onUpdateTransaction={updateTransaction}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView
            summary={summary}
            period={period}
            transactions={transactions}
            categories={categories}
            aiInsightsEnabled={userProfile.aiInsightsEnabled}
          />
        )}

        {activeTab === 'management' && (
          <ManagementView
            initialSubTab={managementSubTab}
            recurringTemplates={recurringTemplates}
            recurringOccurrences={recurringOccurrences}
            budget={budget}
            summary={summary}
            categories={categories}
            userProfile={userProfile}
            merchantRules={merchantRules}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            cardSettlementSummary={cardSettlementSummary}
            classificationIssues={classificationIssues}
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
        transactions={transactions}
        budget={budget}
        recurringOccurrences={recurringOccurrences}
        recurringTemplates={recurringTemplates}
        monthStartDay={monthStartDay}
        aiClassificationEnabled={userProfile.aiClassificationEnabled}
        onSaveTransaction={handleSaveTransaction}
        onSaveMerchantRule={saveMerchantRule}
      />

      <OnboardingSheet
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onSkip={handleSkipOnboarding}
        onComplete={handleCompleteOnboarding}
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
