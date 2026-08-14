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
import { PaydaySetupSheet } from './components/PaydaySetupSheet';
import { CashflowModelNotice } from './components/CashflowModelNotice';
import { CycleClosingCard } from './components/CycleClosingCard';

import {
  subscribeToStorage,
  getTransactions,
  getCategories,
  getBudget,
  ensureBudget,
  getRecurringTemplates,
  getRecurringOccurrences,
  getAllRecurringOccurrences,
  createOccurrenceForPeriod,
  ensureRecurringOccurrences,
  getMerchantRules,
  getUserProfile,
  getBankAccounts,
  saveBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getPaymentCards,
  getCycleBaseline,
  getQuickEntries,
  saveQuickEntry,
  updateQuickEntry,
  deleteQuickEntry,
  reorderQuickEntry,
  postQuickEntry,
  saveCycleBaseline,
  setCardSettlementPaid,
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
  updateOccurrencePlan,
  reloadRecurringOccurrences,
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
  ensureTransactionHistoryFor,
  shutdownStorage,
  shutdownStorageAndForgetCache,
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
  shiftYearMonth,
  formatKRW,
  normalizeMonthStartDay,
} from './utils/calculations';
import { calculateCardPaymentSummary, calculateMonthlyCardSettlementSummary } from './utils/cardPayments';
import { INITIAL_USER_PROFILE, getSampleBudget } from './data/initialData';
import { BankAccount, Budget, Category, CycleBaseline, MerchantRule, PaymentCard, QuickEntry, RecurringOccurrence, RecurringTemplate, Transaction, UserProfile } from './types';
import { logoutOwner, onSessionStateChanged } from './utils/auth';
import { startNetworkWatch } from './utils/syncStatus';
import { normalizeIdleLockMinutes } from './utils/lockPolicy';
import { OfflineBanner, SyncStatusIndicator } from './components/SyncStatusIndicator';
import { useConfirm, useToast } from './components/ui/FeedbackProvider';
import { PeriodSelector } from './components/PeriodSelector';
import { QuickEntryBar } from './components/QuickEntryBar';
import { QuickEntrySuggestion, suggestQuickEntryCandidates } from './utils/quickEntrySuggestions';
import { OnboardingResult, OnboardingSheet } from './components/OnboardingSheet';
import { findManualCardSettlementCandidates } from './utils/cardSettlementPlans';
import { calculateFutureCommitments } from './utils/futureCommitments';
import { findHiddenRecurringItems } from './utils/hiddenRecurring';
import { buildCycleClosingReport } from './utils/cycleClosing';
import { buildCashflowTimeline } from './utils/cashflowTimeline';
import {
  buildWidgetSnapshot,
  NativeDestination,
  publishWidgetSnapshot,
  setWidgetLocked,
  subscribeToNativeDestinations,
} from './utils/widget';

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
  const [allRecurringOccurrences, setAllRecurringOccurrences] = useState<RecurringOccurrence[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [paymentCards, setPaymentCards] = useState<PaymentCard[]>([]);
  const [cycleBaseline, setCycleBaseline] = useState<CycleBaseline | null>(null);
  const [isPaydaySheetOpen, setIsPaydaySheetOpen] = useState<boolean>(false);
  /** Reset whenever the drift changes, so "그대로 두기" hides one notice, not all of them. */
  const [dismissedDelta, setDismissedDelta] = useState<number | null>(null);
  const [dismissedClosingYM, setDismissedClosingYM] = useState<string | null>(null);
  const [quickEntries, setQuickEntries] = useState<QuickEntry[]>([]);
  /** Suggestions turned down in this session, keyed by merchant + category. */
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  /** Variable-amount chip tapped on the home-screen widget, awaiting its amount. */
  const [pendingWidgetQuickEntryId, setPendingWidgetQuickEntryId] = useState<string | null>(null);
  const [nativeDestination, setNativeDestination] = useState<NativeDestination | null>(null);

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
    setAllRecurringOccurrences(getAllRecurringOccurrences());
    setMerchantRules(getMerchantRules());
    setBankAccounts(getBankAccounts());
    setPaymentCards(getPaymentCards());
    setCycleBaseline(getCycleBaseline(currentYM));
    setQuickEntries(getQuickEntries());
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
          // A boot that failed may have left a half-written cache behind, so
          // this path drops it rather than trusting it on the next unlock.
          shutdownStorageAndForgetCache();
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

  // Boot only loads the recent accounting periods, so moving the selector far
  // enough back has to fetch the rest before this month's figures mean anything.
  useEffect(() => {
    if (bootState !== 'ready') return;
    void ensureTransactionHistoryFor(currentYM);
  }, [bootState, currentYM, userProfile.monthStartDay]);

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
    setAllRecurringOccurrences([]);
    setMerchantRules([]);
    setBankAccounts([]);
    setPaymentCards([]);
    setCycleBaseline(null);
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
  const recurringTemplateSignature = useMemo(
    () => recurringTemplates
      .map(template => `${template.id}:${template.updatedAt}:${template.active ? 1 : 0}`)
      .sort()
      .join('|'),
    [recurringTemplates],
  );
  // Detection needs the generated bill amounts, which in turn need the card list
  // only — no dependency on planning, so this stays above the planning memos.
  const rawCardSettlementSummary = useMemo(
    () => calculateMonthlyCardSettlementSummary(currentYM, transactions, paymentCards, monthStartDay),
    [currentYM, transactions, paymentCards, monthStartDay],
  );
  const cardSettlementCandidates = useMemo(
    () => findManualCardSettlementCandidates(recurringTemplates, paymentCards, {
      cardSettlementAmounts: Object.fromEntries(
        rawCardSettlementSummary.cards.map(card => [card.cardId, card.amount]),
      ),
    }),
    [recurringTemplates, paymentCards, rawCardSettlementSummary],
  );
  const duplicateCardSettlementTemplateIds = useMemo(
    () => new Set(cardSettlementCandidates
      .filter(candidate => candidate.status === 'replaced')
      .map(candidate => candidate.templateId)),
    [cardSettlementCandidates],
  );
  const cardSettlementReviewItems = useMemo(
    () => cardSettlementCandidates.filter(candidate => candidate.status === 'needs_review'),
    [cardSettlementCandidates],
  );
  const planningRecurringTemplates = useMemo(
    () => recurringTemplates.filter(template => !duplicateCardSettlementTemplateIds.has(template.id)),
    [recurringTemplates, duplicateCardSettlementTemplateIds],
  );
  const planningRecurringOccurrences = useMemo(
    () => recurringOccurrences.filter(occurrence => !duplicateCardSettlementTemplateIds.has(occurrence.templateId)),
    [recurringOccurrences, duplicateCardSettlementTemplateIds],
  );
  const planningAllRecurringOccurrences = useMemo(
    () => allRecurringOccurrences.filter(occurrence => !duplicateCardSettlementTemplateIds.has(occurrence.templateId)),
    [allRecurringOccurrences, duplicateCardSettlementTemplateIds],
  );
  const planningTransactions = useMemo(
    () => transactions.filter(transaction => !transaction.recurringTemplateId
      || !duplicateCardSettlementTemplateIds.has(transaction.recurringTemplateId)),
    [transactions, duplicateCardSettlementTemplateIds],
  );

  // Generate or normalize the selected planning period only when its inputs
  // change. Realtime snapshots merely refresh local state and never write back.
  useEffect(() => {
    if (bootState !== 'ready') return;
    void ensureBudget(currentYM);
    ensureRecurringOccurrences(currentYM, monthStartDay);
  }, [bootState, currentYM, monthStartDay, recurringTemplateSignature]);

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

  // Calculations. The card bill is part of the cash track, so it has to be
  // resolved before the month summary that spends against it.
  const cardSettlementSummary = useMemo(
    () => calculateMonthlyCardSettlementSummary(
      currentYM,
      transactions,
      paymentCards,
      monthStartDay,
      planningAllRecurringOccurrences,
      planningRecurringTemplates,
    ),
    [currentYM, transactions, paymentCards, monthStartDay, planningAllRecurringOccurrences, planningRecurringTemplates],
  );

  const summary = useMemo(() => {
    return calculateMonthSummary(
      currentYM,
      planningTransactions,
      planningRecurringOccurrences,
      budget,
      planningRecurringTemplates,
      new Date(),
      monthStartDay,
      { cardSettlementOutflow: cardSettlementSummary.totalAmount, baseline: cycleBaseline },
    );
  }, [currentYM, planningTransactions, planningRecurringOccurrences, budget, planningRecurringTemplates, monthStartDay, cardSettlementSummary, cycleBaseline]);

  const categoryMap = useMemo(() => {
    return Object.fromEntries(categories.map(c => [c.id, { name: c.name, color: c.color, icon: c.icon, type: c.type }]));
  }, [categories]);

  // Living-expense spending is bucketed by calendar month (see calculateMonthSummary),
  // so the category mix has to use the same window or the two disagree.
  const categoryBreakdown = useMemo(() => {
    return getCategoryBreakdown(currentYM, transactions, categoryMap, { variableOnly: true, monthStartDay: 1 });
  }, [currentYM, transactions, categoryMap]);

  const cardPaymentSummary = useMemo(
    () => calculateCardPaymentSummary(
      currentYM,
      transactions,
      paymentCards,
      monthStartDay,
      planningAllRecurringOccurrences,
      planningRecurringTemplates,
    ),
    [currentYM, transactions, paymentCards, monthStartDay, planningAllRecurringOccurrences, planningRecurringTemplates],
  );

  const futureCommitments = useMemo(
    () => calculateFutureCommitments(
      currentYM,
      transactions,
      planningRecurringTemplates,
      planningAllRecurringOccurrences,
      paymentCards,
      monthStartDay,
    ),
    [currentYM, transactions, planningRecurringTemplates, planningAllRecurringOccurrences, paymentCards, monthStartDay],
  );

  // The report only makes sense once the cycle it covers is over and the user
  // has moved on to the next one.
  const previousYearMonth = useMemo(() => shiftYearMonth(currentYM, -1), [currentYM]);
  const cycleClosingReport = useMemo(() => {
    if (currentYM !== currentPeriodYM || dismissedClosingYM === previousYearMonth) return null;
    return buildCycleClosingReport(
      previousYearMonth,
      getCycleBaseline(previousYearMonth),
      planningTransactions,
      planningAllRecurringOccurrences,
      categories,
      monthStartDay,
    );
  }, [currentYM, currentPeriodYM, previousYearMonth, dismissedClosingYM, planningTransactions,
    planningAllRecurringOccurrences, categories, monthStartDay, cycleBaseline]);

  const cashflowTimeline = useMemo(
    () => buildCashflowTimeline(
      period,
      planningTransactions,
      planningRecurringOccurrences,
      planningRecurringTemplates,
      bankAccounts,
      cardSettlementSummary,
      summary.forecastAverageDailyVariable,
    ),
    [period, planningTransactions, planningRecurringOccurrences, planningRecurringTemplates,
      bankAccounts, cardSettlementSummary, summary.forecastAverageDailyVariable],
  );

  // Registered fixed expenses that produce no row this cycle. The settings screen
  // counts templates and the recurring screen counts occurrences, so the two
  // disagree for good reasons; this names each one instead of leaving a gap.
  const hiddenExpenseItems = useMemo(
    () => findHiddenRecurringItems(recurringTemplates, planningRecurringOccurrences, period, {
      type: 'expense',
      replacedTemplateIds: duplicateCardSettlementTemplateIds,
    }),
    [recurringTemplates, planningRecurringOccurrences, period, duplicateCardSettlementTemplateIds],
  );

  const classificationIssues = useMemo(
    () => getClassificationIssueSummary(),
    [transactions, categories, recurringTemplates, recurringOccurrences],
  );

  const showCashflowNotice = bootState === 'ready'
    && !userProfile.cashflowModelNoticeSeenAt
    && summary.cardSettlementOutflow > 0;

  // Prompt for the payday routine only once the cycle has actually begun and
  // there is something to plan with. A future cycle has nothing to confirm yet.
  const showPaydayPrompt = !cycleBaseline
    && currentYM <= currentPeriodYM
    && (summary.planningIncome > 0 || summary.accountFixedOutflow > 0 || summary.cardSettlementOutflow > 0);

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

  useEffect(() => {
    let unsubscribe = () => undefined;
    let cancelled = false;
    void subscribeToNativeDestinations(destination => setNativeDestination(destination))
      .then(remove => {
        if (cancelled) remove();
        else unsubscribe = remove;
      })
      .catch(error => console.error('Native deep-link subscription failed:', error));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!nativeDestination || bootState !== 'ready') return;
    if (nativeDestination.kind === 'transaction/new') {
      setIsAddModalOpen(true);
    } else if (nativeDestination.kind === 'settings/widget') {
      handleNavigateTab('management', 'settings');
    } else if (nativeDestination.kind === 'quick-entry') {
      handleNavigateTab('home');
      // A widget chip with a fixed amount records straight away; a variable one
      // has nothing to record yet, so the home bar opens its amount prompt.
      const entry = getQuickEntries().find(candidate => candidate.id === nativeDestination.quickEntryId);
      if (!entry) {
        showToast({ message: '퀵등록 항목을 찾지 못했습니다.', tone: 'error' });
      } else if (entry.amount === null) {
        setPendingWidgetQuickEntryId(entry.id);
      } else {
        handlePostQuickEntry(entry.id);
      }
    } else {
      handleNavigateTab('home');
    }
    setNativeDestination(null);
  }, [nativeDestination, bootState]);

  useEffect(() => {
    if (bootState === 'locked') {
      void setWidgetLocked(true).catch(error => console.error('Widget lock update failed:', error));
      return;
    }
    if (bootState !== 'ready') return;
    const snapshot = buildWidgetSnapshot(
      currentYM,
      period.endDate,
      summary,
      userProfile,
      new Date(),
      // Most-used first: the widget shows only a handful, so they should be the
      // ones actually worth a home-screen slot.
      [...quickEntries]
        .sort((left, right) => right.useCount - left.useCount || left.sortOrder - right.sortOrder)
        .map(entry => ({ id: entry.id, label: entry.label, amount: entry.amount })),
    );
    void publishWidgetSnapshot(snapshot).catch(error => console.error('Widget snapshot update failed:', error));
  }, [
    bootState,
    currentYM,
    period.endDate,
    summary.remainingAllowance,
    summary.confirmedVariableExpenses,
    summary.spendableLimit,
    summary.dailySafeAllowance,
    summary.daysRemaining,
    summary.alertLevel,
    userProfile.idleLockMinutes,
    userProfile.widgetPrivacyMode,
    quickEntries,
  ]);

  const handlePostOccurrence = async (occId: string) => {
    await postOccurrenceToTransaction(occId);
    refreshAppData();
  };

  const handleCardSettlementStatus = (cardId: string, status: 'scheduled' | 'paid') => {
    const card = paymentCards.find(candidate => candidate.id === cardId);
    const settlement = cardSettlementSummary.cards.find(candidate => candidate.cardId === cardId);
    if (!card || !settlement) return;

    setCardSettlementPaid(
      cardId,
      currentYM,
      settlement.amount,
      settlement.paymentDate || getLocalDateString(),
      status === 'paid',
    );
    refreshAppData();
    showToast({
      message: status === 'paid'
        ? `${card.cardName} 카드대금을 납부 완료로 표시했습니다.`
        : `${card.cardName} 카드대금을 미납부 상태로 되돌렸습니다.`,
      description: status === 'paid'
        ? `${formatKRW(settlement.amount)} 출금 기록을 남겼습니다. 이미 쓴 돈이라 생활비 사용에는 더하지 않습니다.`
        : '출금 기록을 되돌렸습니다.',
      tone: 'success',
    });
  };

  /** Records the user's answer on a suspected duplicate card bill, either way. */
  const handleResolveCardSettlementReview = (templateId: string, cardId: string | null) => {
    updateRecurringTemplate(templateId, {
      cardSettlementCardId: cardId,
      cardSettlementReviewedAt: new Date().toISOString(),
    });
    refreshAppData();
    showToast({
      message: cardId
        ? '자동 생성 카드대금으로 대체했습니다.'
        : '별개 고정지출로 유지합니다.',
      description: cardId ? '고정 이체 합계에서 제외되어 중복 계산이 사라집니다.' : undefined,
      tone: 'success',
    });
  };

  /** Locks (or re-locks) the cycle's living budget. */
  const handleConfirmBaseline = async (savingsReserve: number) => {
    const livingBudget = Math.max(
      0,
      summary.planningIncome - summary.accountFixedOutflow - summary.cardSettlementOutflow - savingsReserve,
    );
    try {
      await saveCycleBaseline(currentYM, {
        confirmedIncome: summary.planningIncome,
        accountFixedOutflow: summary.accountFixedOutflow,
        cardSettlement: summary.cardSettlementOutflow,
        savingsReserve,
        livingBudget,
      });
      setDismissedDelta(null);
      refreshAppData();
      showToast({
        message: `${currentYM} 주기 생활비를 확정했습니다.`,
        description: `${formatKRW(livingBudget)} · 하루 ${formatKRW(Math.floor(livingBudget / Math.max(1, period.daysInMonth)))}`,
        tone: 'success',
      });
    } catch (error) {
      refreshAppData();
      showToast({
        message: '생활비 계획을 DB에 저장하지 못했습니다.',
        description: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  };

  const handleSaveCardSettlementAmount = (cardId: string, amount: number) => {
    const card = paymentCards.find(candidate => candidate.id === cardId);
    if (!card) return;
    updatePaymentCard(cardId, {
      monthlyPaymentAmounts: { ...(card.monthlyPaymentAmounts || {}), [currentYM]: Math.max(0, Math.round(amount)) },
    });
    refreshAppData();
    showToast({ message: `${card.cardName} 카드대금을 저장했습니다.`, tone: 'success' });
  };

  const handleReloadRecurringPlan = async () => {
    const accepted = await confirm({
      title: `${currentYM} 정기 항목을 새로 불러올까요?`,
      description: '납부일 변경으로 남은 중복 건을 정리하고, 미처리 일정만 현재 정기/고정 설정에서 다시 만듭니다. 이미 확정된 거래와 납부 완료 기록은 유지됩니다.',
      details: [
        { label: '대상 기간', value: `${period.startDate} ~ ${period.endDate}` },
        { label: '카드 결제계좌', value: '전월 현재까지 등록된 신용카드 사용액으로 다시 계산' },
      ],
      confirmLabel: '새로 불러오기',
    });
    if (!accepted) return;

    const result = await reloadRecurringOccurrences(currentYM, monthStartDay);
    refreshAppData();
    showToast({
      message: '정기 항목을 현재 설정으로 새로 불러왔습니다.',
      description: `기존 미처리 ${result.removedCount}건 정리 · 현재 일정 ${result.loadedCount}건`,
      tone: 'success',
    });
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

  const suggestionKey = (suggestion: QuickEntrySuggestion) =>
    `${suggestion.merchant.trim().toLowerCase()}::${suggestion.categoryId}`;

  const quickEntrySuggestions = useMemo(
    () => suggestQuickEntryCandidates(transactions, quickEntries)
      .filter(suggestion => !dismissedSuggestions.includes(suggestionKey(suggestion))),
    [transactions, quickEntries, dismissedSuggestions],
  );

  const handlePostQuickEntry = (id: string, amountOverride?: number) => {
    let result;
    try {
      result = postQuickEntry(id, amountOverride);
    } catch (error) {
      // The saved category can be deleted or merged after the chip was made.
      console.error('Failed to record quick entry:', error);
      showToast({
        message: '퀵등록 항목을 기록하지 못했습니다.',
        description: '카테고리가 바뀌었을 수 있습니다. 관리에서 항목을 확인해 주세요.',
        tone: 'error',
      });
      return;
    }
    if (!result) {
      showToast({ message: '퀵등록 항목을 기록하지 못했습니다.', tone: 'error' });
      return;
    }
    const { transaction, synced } = result;
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
  };

  const handleAcceptQuickEntrySuggestion = (suggestion: QuickEntrySuggestion) => {
    saveQuickEntry({
      label: suggestion.merchant,
      type: suggestion.type,
      amount: suggestion.fixedAmount,
      categoryId: suggestion.categoryId,
      merchant: suggestion.merchant,
      memo: '',
      paymentMethodType: 'card',
      accountId: null,
      cardId: null,
    });
    showToast({
      message: '퀵등록에 추가했습니다.',
      description: suggestion.fixedAmount === null
        ? `${suggestion.merchant} · 누를 때 금액을 입력합니다.`
        : `${suggestion.merchant} ${formatKRW(suggestion.fixedAmount)}`,
      tone: 'success',
    });
  };

  const handleDeleteQuickEntry = async (entry: QuickEntry) => {
    const accepted = await confirm({
      title: '이 퀵등록 항목을 삭제할까요?',
      description: '이미 기록한 거래는 그대로 남습니다.',
      details: [
        { label: '이름', value: entry.label },
        { label: '사용처', value: entry.merchant || '사용처 미입력' },
        { label: '금액', value: entry.amount === null ? '누를 때 입력' : formatKRW(entry.amount) },
      ],
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!accepted) return;
    deleteQuickEntry(entry.id);
    showToast({ message: '퀵등록 항목을 삭제했습니다.', description: entry.label, tone: 'success' });
  };

  const handleDismissQuickEntrySuggestion = (suggestion: QuickEntrySuggestion) => {
    setDismissedSuggestions(previous => [...previous, suggestionKey(suggestion)]);
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
            upcomingOccurrences={planningRecurringOccurrences}
            recurringTemplates={planningRecurringTemplates}
            categories={categories}
            categoryBreakdown={categoryBreakdown}
            cardPaymentSummary={cardPaymentSummary}
            cardSettlementSummary={cardSettlementSummary}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onNavigateTab={(tab, sub) => handleNavigateTab(tab as NavTab, sub)}
            onConfirmOccurrence={handlePostOccurrence}
            showSetupPrompt={recurringTemplates.length === 0 && !userProfile.onboardingCompletedAt}
            onStartSetup={() => setIsOnboardingOpen(true)}
            showPaydayPrompt={showPaydayPrompt}
            onStartPayday={() => setIsPaydaySheetOpen(true)}
            onRefreshBaseline={() => void handleConfirmBaseline(summary.savingsReserve)}
            onDismissBaselineChange={() => setDismissedDelta(summary.unplannedDelta)}
            baselineChangeDismissed={dismissedDelta === summary.unplannedDelta}
            cycleClosingSlot={cycleClosingReport && (
              <CycleClosingCard
                report={cycleClosingReport}
                onDismiss={() => setDismissedClosingYM(cycleClosingReport.yearMonth)}
                onReviewUnresolved={() => {
                  setCurrentYM(cycleClosingReport.yearMonth);
                  handleNavigateTab('recurring_payment');
                }}
                onCarryLeftoverToSavings={amount => void handleConfirmBaseline(amount)}
              />
            )}
            quickEntrySlot={(
              <QuickEntryBar
                entries={quickEntries}
                categories={categories}
                suggestions={quickEntrySuggestions}
                onPost={handlePostQuickEntry}
                onAcceptSuggestion={handleAcceptQuickEntrySuggestion}
                onDismissSuggestion={handleDismissQuickEntrySuggestion}
                onManage={() => handleNavigateTab('management', 'quick_entries')}
                pendingAmountPromptId={pendingWidgetQuickEntryId}
                onPendingAmountPromptHandled={() => setPendingWidgetQuickEntryId(null)}
              />
            )}
          />
        )}

        {activeTab === 'recurring_payment' && (
          <RecurringPaymentView
            period={period}
            summary={summary}
            recurringOccurrences={planningRecurringOccurrences}
            recurringTemplates={planningRecurringTemplates}
            categories={categories}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            cardSettlementSummary={cardSettlementSummary}
            hiddenExpenseItems={hiddenExpenseItems}
            onCreateOccurrence={templateId => {
              const created = createOccurrenceForPeriod(templateId, currentYM, monthStartDay);
              refreshAppData();
              showToast(created
                ? { message: `${created.scheduledDate} 일정을 만들었습니다.`, tone: 'success' }
                : { message: '이번 주기에 만들 일정이 없습니다.', tone: 'warning' });
            }}
            onReloadRecurringPlan={handleReloadRecurringPlan}
            duplicateManualCardSettlementCount={duplicateCardSettlementTemplateIds.size}
            cardSettlementReviewItems={cardSettlementReviewItems}
            onResolveCardSettlementReview={handleResolveCardSettlementReview}
            onUpdateCardSettlementStatus={handleCardSettlementStatus}
            onPostOccurrence={async (occId, amt, pType, accId, cId) => {
              await postOccurrenceToTransaction(occId, amt, pType, accId, cId);
              refreshAppData();
            }}
            onUpdateOccurrenceStatus={(occId, status) => {
              updateOccurrenceStatus(occId, status);
              refreshAppData();
            }}
            onUpdateOccurrencePlan={(occId, amount, pType, accId, cId) => {
              updateOccurrencePlan(occId, {
                amount,
                paymentMethodType: pType,
                accountId: accId,
                cardId: cId,
              });
              refreshAppData();
            }}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsView
            currentYM={currentYM}
            monthStartDay={monthStartDay}
            transactions={transactions}
            recurringOccurrences={allRecurringOccurrences}
            recurringTemplates={recurringTemplates}
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
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            period={period}
            onDeleteTransaction={handleDeleteTransaction}
            onUpdateTransaction={updateTransaction}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView
            summary={summary}
            futureCommitments={futureCommitments}
            cashflowTimeline={cashflowTimeline}
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
            recurringOccurrences={planningRecurringOccurrences}
            ignoredCardSettlementTemplateIds={[...duplicateCardSettlementTemplateIds]}
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
            quickEntries={quickEntries}
            onCreateQuickEntry={draft => {
              saveQuickEntry(draft);
              showToast({ message: '퀵등록에 추가했습니다.', description: draft.label, tone: 'success' });
            }}
            onUpdateQuickEntry={(id, draft) => {
              updateQuickEntry(id, draft);
              showToast({ message: '퀵등록 항목을 수정했습니다.', description: draft.label, tone: 'success' });
            }}
            onDeleteQuickEntry={entry => void handleDeleteQuickEntry(entry)}
            onReorderQuickEntry={(id, direction) => reorderQuickEntry(id, direction)}
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
        onPostOccurrence={async (occId, amount, pType, accId, cardId) => {
          await postOccurrenceToTransaction(occId, amount, pType, accId, cardId);
          refreshAppData();
          showToast({ message: '정기 항목을 확정했습니다.', tone: 'success' });
        }}
      />

      {/* One-time explanation of why the numbers moved. Only for users who
          actually have a card bill to reconcile. */}
      <CashflowModelNotice
        isOpen={showCashflowNotice}
        summary={summary}
        onAcknowledge={() => {
          updateUserProfile({ cashflowModelNoticeSeenAt: new Date().toISOString() });
          refreshAppData();
        }}
      />

      <PaydaySetupSheet
        isOpen={isPaydaySheetOpen}
        onClose={() => setIsPaydaySheetOpen(false)}
        period={period}
        summary={summary}
        recurringOccurrences={planningRecurringOccurrences}
        recurringTemplates={planningRecurringTemplates}
        bankAccounts={bankAccounts}
        paymentCards={paymentCards}
        cardSettlementSummary={cardSettlementSummary}
        replacedCardSettlementCount={duplicateCardSettlementTemplateIds.size}
        onPostOccurrence={async (occId, amount, pType, accId, cardId) => {
          await postOccurrenceToTransaction(occId, amount, pType, accId, cardId);
          refreshAppData();
        }}
        onSaveCardSettlementAmount={handleSaveCardSettlementAmount}
        onConfirmBaseline={handleConfirmBaseline}
        onCopyText={(text, message) => {
          void navigator.clipboard.writeText(text);
          showToast({ message, tone: 'success' });
        }}
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
