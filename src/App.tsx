import React, { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { BottomNav, NavTab } from './components/BottomNav';
import { DashboardView } from './components/DashboardView';
import { AppLockModal } from './components/AppLockModal';
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
  getBankAccountUsage,
  mergeBankAccount,
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
  undoPostedOccurrence,
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
import { getSignedInAccount, logoutOwner, onSessionStateChanged } from './utils/auth';
import { startNetworkWatch } from './utils/syncStatus';
import { normalizeIdleLockMinutes } from './utils/lockPolicy';
import { OfflineBanner, SyncStatusIndicator } from './components/SyncStatusIndicator';
import { useConfirm, useToast } from './components/ui/FeedbackProvider';
import { PeriodSelector } from './components/PeriodSelector';
import { QuickEntryBar } from './components/QuickEntryBar';
import { SmsReviewCard } from './components/SmsReviewCard';
import { QuickEntrySuggestion, suggestQuickEntryCandidates } from './utils/quickEntrySuggestions';
import type { OnboardingResult } from './components/OnboardingSheet';

const HistoryView = lazy(() => import('./components/HistoryView').then(module => ({ default: module.HistoryView })));
const AnalyticsView = lazy(() => import('./components/AnalyticsView').then(module => ({ default: module.AnalyticsView })));
const ManagementView = lazy(() => import('./components/ManagementView').then(module => ({ default: module.ManagementView })));
const AccountsView = lazy(() => import('./components/AccountsView').then(module => ({ default: module.AccountsView })));
const RecurringPaymentView = lazy(() => import('./components/RecurringPaymentView').then(module => ({ default: module.RecurringPaymentView })));
const AddTransactionModal = lazy(() => import('./components/AddTransactionModal').then(module => ({ default: module.AddTransactionModal })));
const PaydaySetupSheet = lazy(() => import('./components/PaydaySetupSheet').then(module => ({ default: module.PaydaySetupSheet })));
const OnboardingSheet = lazy(() => import('./components/OnboardingSheet').then(module => ({ default: module.OnboardingSheet })));

const ViewLoading = () => (
  <div className="eb-panel flex min-h-40 items-center justify-center rounded-xl text-sm text-slate-400" role="status">
    화면을 준비하고 있습니다…
  </div>
);
import { findManualCardSettlementCandidates } from './utils/cardSettlementPlans';
import { calculateFutureCommitments } from './utils/futureCommitments';
import { findHiddenRecurringItems } from './utils/hiddenRecurring';
import { buildCycleClosingReport } from './utils/cycleClosing';
import { buildCashflowTimeline } from './utils/cashflowTimeline';
import { applyAppTheme } from './utils/theme';
import { getDiagnosticRuntime } from './utils/diagnosticRuntime';
import { serializeDiagnosticExport } from './utils/diagnosticExport';
import { saveJsonWithNativePicker } from './utils/fileExport';
import {
  buildWidgetSnapshot,
  NativeDestination,
  publishWidgetSnapshot,
  setWidgetLocked,
  subscribeToNativeDestinations,
} from './utils/widget';
import {
  acknowledgePendingSms,
  clearPendingSms,
  configureSmsImport,
  findCancellationTarget,
  isDuplicateSmsTransaction,
  prepareSmsReviewQueue,
  readPendingSms,
  SmsReviewCandidate,
  subscribeToPendingSms,
} from './utils/smsImport';

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
  const [dateKey, setDateKey] = useState(getLocalDateString);
  useEffect(() => {
    const updateDate = () => setDateKey(getLocalDateString());
    const timer = window.setInterval(updateDate, 30_000);
    window.addEventListener('focus', updateDate);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', updateDate); };
  }, []);
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
  const [smsCandidates, setSmsCandidates] = useState<SmsReviewCandidate[]>([]);
  const smsImportBusy = useRef(false);
  const smsImportRerunRequested = useRef(false);
  const announcedSmsCandidateIds = useRef(new Set<string>());

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
    applyAppTheme(userProfile.theme);
  }, [userProfile.theme]);

  useEffect(() => {
    const unsubscribeAuth = onSessionStateChanged(isLoggedIn => {
      if (!isLoggedIn) {
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

  useEffect(() => {
    if (bootState !== 'ready' || !userProfile.uid) return;
    if (!userProfile.smsAutoImportEnabled) {
      setSmsCandidates([]);
      announcedSmsCandidateIds.current.clear();
      return;
    }
    let cancelled = false;
    let unsubscribe = () => undefined;

    const importPending = async () => {
      if (cancelled) return;
      if (smsImportBusy.current) {
        smsImportRerunRequested.current = true;
        return;
      }
      smsImportBusy.current = true;
      try {
        const messages = await readPendingSms(userProfile.uid);
        const prepared = prepareSmsReviewQueue(
          messages,
          getTransactions(),
          getPaymentCards(),
          getCategories(),
          getMerchantRules(),
        );
        await acknowledgePendingSms(userProfile.uid, prepared.ignoredMessageIds);
        if (cancelled) return;
        setSmsCandidates(prepared.candidates);

        const newCandidates = prepared.candidates.filter(candidate => !announcedSmsCandidateIds.current.has(candidate.fingerprint));
        prepared.candidates.forEach(candidate => announcedSmsCandidateIds.current.add(candidate.fingerprint));
        if (newCandidates.length) {
          showToast({
            message: `SMS 확인 대기 ${prepared.candidates.length}건`,
            description: '승인하기 전에는 지출에 반영되지 않습니다.',
            tone: 'info',
            durationMs: 12000,
          });
        }
      } catch (error) {
        console.error('SMS import failed:', error);
        showToast({ message: 'SMS 지출을 불러오지 못했습니다.', tone: 'error' });
      } finally {
        smsImportBusy.current = false;
        if (smsImportRerunRequested.current && !cancelled) {
          smsImportRerunRequested.current = false;
          void importPending();
        }
      }
    };

    void configureSmsImport(userProfile.uid, Boolean(userProfile.smsAutoImportEnabled))
      .then(importPending)
      .catch(error => console.error('SMS import configuration failed:', error));
    void subscribeToPendingSms(() => void importPending())
      .then(remove => {
        if (cancelled) remove();
        else unsubscribe = remove;
      })
      .catch(error => console.error('SMS listener subscription failed:', error));

    return () => {
      cancelled = true;
      smsImportRerunRequested.current = false;
      unsubscribe();
    };
  }, [bootState, userProfile.uid, userProfile.smsAutoImportEnabled]);

  const removeSmsCandidate = (candidate: SmsReviewCandidate) => {
    setSmsCandidates(current => current.filter(item => item.fingerprint !== candidate.fingerprint));
    announcedSmsCandidateIds.current.delete(candidate.fingerprint);
  };

  const handleApproveSmsCandidate = async (candidate: SmsReviewCandidate) => {
    if (candidate.kind === 'cancellation') {
      const target = findCancellationTarget(candidate, getTransactions(), candidate.matchedCardId);
      if (!target) {
        showToast({
          message: '연결할 승인 내역을 하나로 특정할 수 없습니다.',
          description: '같은 금액과 사용처의 SMS 승인 내역을 거래 내역에서 직접 확인해 주세요.',
          tone: 'warning',
          durationMs: 12000,
        });
        return;
      }
      const snapshot = deleteTransaction(target.id);
      if (!snapshot) return;
      finalizeTransactionDeletion(snapshot);
      await acknowledgePendingSms(userProfile.uid, candidate.messageIds);
      removeSmsCandidate(candidate);
      refreshAppData();
      showToast({ message: 'SMS 승인취소를 반영했습니다.', tone: 'success' });
      return;
    }

    if (isDuplicateSmsTransaction(candidate, getTransactions())) {
      await acknowledgePendingSms(userProfile.uid, candidate.messageIds);
      removeSmsCandidate(candidate);
      showToast({ message: '이미 등록된 SMS 지출이라 후보에서 제외했습니다.', tone: 'info' });
      return;
    }
    if (!candidate.suggestedCategoryId) {
      showToast({ message: '사용 가능한 지출 카테고리가 없습니다.', tone: 'warning' });
      return;
    }

    saveTransaction({
      type: 'expense',
      amount: candidate.amount,
      occurredAt: candidate.occurredAt,
      localDate: candidate.localDate,
      categoryId: candidate.suggestedCategoryId,
      merchant: candidate.merchant,
      memo: `[SMS 승인 등록] ${candidate.issuer || '카드'}${candidate.cardLast4 ? ` 끝 ${candidate.cardLast4}` : ''}`,
      source: 'sms',
      sourceFingerprint: candidate.fingerprint,
      sourceReference: candidate.approvalCode,
      paymentMethodType: 'card',
      accountId: null,
      cardId: candidate.matchedCardId,
      installment: candidate.installmentMonths && candidate.installmentMonths > 1 ? {
        totalMonths: candidate.installmentMonths,
        currentRound: 1,
        baseYearMonth: candidate.localDate.slice(0, 7),
      } : null,
    });
    await acknowledgePendingSms(userProfile.uid, candidate.messageIds);
    removeSmsCandidate(candidate);
    refreshAppData();
    showToast({
      message: 'SMS 지출을 등록했습니다.',
      description: `${candidate.merchant} · ${formatKRW(candidate.amount)}`,
      tone: 'success',
    });
  };

  const handleDismissSmsCandidate = async (candidate: SmsReviewCandidate) => {
    await acknowledgePendingSms(userProfile.uid, candidate.messageIds);
    removeSmsCandidate(candidate);
    showToast({ message: 'SMS 후보에서 제외했습니다.', tone: 'info' });
  };

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
    if (userProfile.wipeCacheOnLock && userProfile.uid) {
      await configureSmsImport(userProfile.uid, false).catch(error => {
        console.error('Unable to pause SMS import while wiping device data:', error);
      });
      await clearPendingSms(userProfile.uid).catch(error => {
        console.error('Unable to clear pending SMS while wiping device data:', error);
      });
    }
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

  const handleEnableTransactionAi = async () => {
    if (userProfile.aiClassificationEnabled) return true;
    const accepted = await confirm({
      title: 'AI 지출·재무 기능을 사용할까요?',
      description: 'GPT Live, Gemini 음성, AI 문장 입력, 영수증 분석, 재무 채팅을 이 계정에서도 사용할 수 있습니다. 입력한 내용과 계좌·카드 번호를 제외한 재무 요약 및 거래 정보만 선택한 AI API로 전송됩니다.',
      confirmLabel: '동의하고 사용',
    });
    if (!accepted) return false;

    updateUserProfile({
      aiClassificationEnabled: true,
      aiConsentAt: userProfile.aiConsentAt || new Date().toISOString(),
    });
    showToast({ message: '이 계정에서도 AI 지출·재무 기능을 사용할 수 있습니다.', tone: 'success' });
    return true;
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
    [currentYM, monthStartDay, dateKey],
  );
  const currentPeriodYM = useMemo(() => getCurrentYearMonth(monthStartDay), [monthStartDay, dateKey]);
  // Detection needs the generated bill amounts, which in turn need the card list
  // only — no dependency on planning, so this stays above the planning memos.
  const rawCardSettlementSummary = useMemo(
    () => calculateMonthlyCardSettlementSummary(currentYM, transactions, paymentCards, monthStartDay),
    [currentYM, transactions, paymentCards, monthStartDay],
  );
  const cardSettlementCandidates = useMemo(
    () => findManualCardSettlementCandidates(recurringTemplates.filter(template => !template.archivedAt), paymentCards, {
      cardSettlementAmounts: Object.fromEntries(
        rawCardSettlementSummary.cards.map(card => [card.cardId, card.amount]),
      ),
      bankAccounts,
    }),
    [recurringTemplates, paymentCards, bankAccounts, rawCardSettlementSummary],
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
    // Keep metadata for every loaded plan, including archived masters. Selecting
    // another month must never turn a retained occurrence into an orphan.
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
  }, [bootState, currentYM, monthStartDay]);

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
      {
        cardSettlementOutflow: cardSettlementSummary.totalAmount,
        baseline: cycleBaseline,
        reserveUnmaterializedTemplates: false,
      },
    );
  }, [currentYM, planningTransactions, planningRecurringOccurrences, budget, planningRecurringTemplates, monthStartDay, cardSettlementSummary, cycleBaseline, dateKey]);

  const categoryMap = useMemo(() => {
    return Object.fromEntries(categories.map(c => [c.id, { name: c.name, color: c.color, icon: c.icon, type: c.type }]));
  }, [categories]);

  // Category totals follow the same payday cycle as the living budget.
  const categoryBreakdown = useMemo(() => {
    return getCategoryBreakdown(currentYM, transactions, categoryMap, { variableOnly: true, monthStartDay });
  }, [currentYM, transactions, categoryMap, monthStartDay]);

  const cardPaymentSummary = useMemo(
    () => calculateCardPaymentSummary(
      currentYM,
      transactions,
      paymentCards,
      1, // Card usage is a calendar month; the living budget follows payday.
      planningAllRecurringOccurrences,
      planningRecurringTemplates,
    ),
    [currentYM, transactions, paymentCards, monthStartDay, planningAllRecurringOccurrences, planningRecurringTemplates],
  );

  const futureCommitments = useMemo(
    () => calculateFutureCommitments(
      currentYM,
      planningTransactions,
      planningRecurringTemplates,
      planningAllRecurringOccurrences,
      paymentCards,
      monthStartDay,
    ),
    [currentYM, planningTransactions, planningRecurringTemplates, planningAllRecurringOccurrences, paymentCards, monthStartDay],
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
    () => findHiddenRecurringItems(recurringTemplates.filter(template => !template.archivedAt), planningRecurringOccurrences, period, {
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
    const salaryTmpl = recurringTemplates.find(t => t.type === 'income' && t.active && !t.archivedAt);
    if (!salaryTmpl) return '';
    return `다음 월급일: 매월 ${salaryTmpl.dayOfMonth}일`;
  }, [recurringTemplates]);

  // Handlers
  const [historyView, setHistoryView] = useState<string | undefined>();
  const handleNavigateTab = (tab: NavTab, subTab?: string) => {
    if (tab === 'history') setHistoryView(subTab);
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
      summary.spendPeriodEndDate,
      { ...summary, daysRemaining: summary.spendDaysRemaining },
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
    summary.spendDaysRemaining,
    summary.spendPeriodEndDate,
    summary.alertLevel,
    userProfile.idleLockMinutes,
    userProfile.widgetPrivacyMode,
    quickEntries,
  ]);

  const handlePostOccurrence = async (occId: string) => {
    await postOccurrenceToTransaction(occId);
    refreshAppData();
  };

  const handleUndoPostedOccurrence = async (occurrenceId: string) => {
    const occurrence = allRecurringOccurrences.find(item => item.id === occurrenceId);
    if (!occurrence || occurrence.status !== 'posted') {
      showToast({ message: '이미 완료 취소된 항목입니다.', tone: 'info' });
      return;
    }
    const template = recurringTemplates.find(item => item.id === occurrence.templateId);
    const isIncome = (occurrence.typeSnapshot ?? template?.type) === 'income';
    const accepted = await confirm({
      title: `${isIncome ? '입금' : '납부'} 완료를 취소할까요?`,
      description: '완료 처리할 때 생성된 거래를 삭제하고 미처리 상태로 되돌립니다. 정기 항목 자체는 삭제되지 않습니다.',
      details: [
        { label: '항목', value: template?.name || '정기 항목' },
        { label: '금액', value: formatKRW(occurrence.actualAmount ?? occurrence.expectedAmount) },
        { label: '예정일', value: occurrence.scheduledDate },
      ],
      confirmLabel: '완료 취소',
      tone: 'danger',
    });
    if (!accepted) return;

    const reopened = undoPostedOccurrence(occurrenceId);
    refreshAppData();
    showToast(reopened
      ? {
          message: `${isIncome ? '입금' : '납부'} 완료를 취소했습니다.`,
          description: '생성됐던 거래를 삭제하고 미처리 항목으로 되돌렸습니다.',
          tone: 'success',
        }
      : { message: '완료 상태를 되돌리지 못했습니다.', tone: 'error' });
  };

  const handleExcludeRecurringOccurrence = async (occurrenceId: string) => {
    const occurrence = allRecurringOccurrences.find(item => item.id === occurrenceId);
    if (!occurrence || occurrence.status === 'posted' || occurrence.status === 'skipped') {
      showToast({ message: '이미 처리되었거나 제외된 항목입니다.', tone: 'info' });
      return;
    }
    const template = recurringTemplates.find(item => item.id === occurrence.templateId);
    const isIncome = (occurrence.typeSnapshot ?? template?.type) === 'income';
    const accepted = await confirm({
      title: `${template?.name || '정기 항목'}을 이번 달에서 제외할까요?`,
      description: '고정 항목 원본과 다른 달의 일정은 유지됩니다. 고정 지출을 새로 불러와도 이 달에는 다시 생성되지 않습니다.',
      details: [
        { label: '구분', value: isIncome ? '고정 수입' : '고정 지출' },
        { label: '예정 금액', value: formatKRW(occurrence.actualAmount ?? occurrence.expectedAmount) },
        { label: '예정일', value: occurrence.scheduledDate },
      ],
      confirmLabel: '이번 달 제외',
      tone: 'danger',
    });
    if (!accepted) return;

    updateOccurrenceStatus(occurrenceId, 'skipped');
    refreshAppData();
    showToast({
      message: `${template?.name || '정기 항목'}을 이번 달에서 제외했습니다.`,
      description: '고정 항목 원본은 그대로 유지됩니다.',
      tone: 'success',
    });
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
    const pending = recurringOccurrences.filter(row => row.status !== 'posted' && row.status !== 'skipped');
    const overrides = pending.filter(row => row.actualAmount != null);
    const retired = pending.filter(row => recurringTemplates.some(template => template.id === row.templateId && template.archivedAt));
    const accepted = await confirm({
      title: `${currentYM} 정기 항목을 새로 불러올까요?`,
      description: '납부일 변경으로 남은 중복 건을 정리하고, 미처리 일정만 현재 정기/고정 설정에서 다시 만듭니다. 이미 확정된 거래와 납부 완료 기록은 유지됩니다.',
      details: [
        { label: '대상 기간', value: `${period.startDate} ~ ${period.endDate}` },
        { label: '다시 만드는 미처리 일정', value: pending.length + '건' },
        { label: '삭제 원본에서 제외될 일정', value: retired.length + '건' },
        { label: '월별 직접 수정액 초기화', value: overrides.length + '건 · 이전 월 기록 또는 원본 금액으로 재산정' },
        ...overrides.map(row => ({ label: (recurringTemplates.find(template => template.id === row.templateId)?.name || '정기 항목') + ' ' + row.scheduledDate, value: formatKRW(row.actualAmount!) + ' → 이전 월 기록/원본 기준' })),
        { label: '납부 완료·건너뜀', value: '변경하지 않음' },
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

  const handleOpenPaydaySetup = async () => {
    try {
      // Payday confirmation must always start from the latest master list.
      // Posted and explicitly skipped rows survive this refresh by design.
      await reloadRecurringOccurrences(currentYM, monthStartDay);
      refreshAppData();
      setIsPaydaySheetOpen(true);
    } catch (error) {
      showToast({
        message: '급여일 고정지출을 새로 불러오지 못했습니다.',
        description: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
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
      return false;
    }
    if (!result) {
      showToast({ message: '퀵등록 항목을 기록하지 못했습니다.', tone: 'error' });
      return false;
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
    return true;
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
    URL.revokeObjectURL(url);
  };

  const handleExportDiagnostic = async () => {
    try {
      const runtime = await getDiagnosticRuntime();
      const json = serializeDiagnosticExport({
        runtime,
        selectedYearMonth: currentYM,
        userProfile,
        bankAccounts,
        paymentCards,
        recurringTemplates,
        recurringOccurrences: allRecurringOccurrences,
        transactions,
        categories,
        budget,
        cycleBaseline,
        monthSummary: summary,
        cardSettlementSummary,
        futureCommitments,
        cardSettlementCandidates,
        excludedCardSettlementTemplateIds: [...duplicateCardSettlementTemplateIds],
        planningTemplateIds: planningRecurringTemplates.map(template => template.id),
        planningOccurrenceIds: planningAllRecurringOccurrences.map(occurrence => occurrence.id),
        planningTransactionIds: planningTransactions.map(transaction => transaction.id),
      });
      const fileName = `지출브레이크_진단데이터_${currentYM}.json`;

      const nativeResult = await saveJsonWithNativePicker(fileName, json);
      if (nativeResult && !nativeResult.saved) return;

      if (!nativeResult) {
        const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }

      showToast({
        message: '진단 데이터 파일을 저장했습니다.',
        description: '저장한 JSON 파일을 대화에 첨부해 주세요.',
        tone: 'success',
      });
    } catch (error) {
      console.error('Diagnostic export failed', error);
      showToast({
        message: '진단 데이터 파일을 저장하지 못했습니다.',
        description: '저장 위치를 다시 선택한 뒤 재시도해 주세요.',
        tone: 'error',
      });
    }
  };

  if (bootState === 'checking' || bootState === 'loading') {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-slate-100 flex items-center justify-center p-6">
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
    <div className="eb-app-shell min-h-[100dvh] bg-slate-950 text-slate-100 antialiased selection:bg-rose-500 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        userProfile={userProfile}
        accountName={getSignedInAccount().name}
        nextPaydayText={nextPaydayText}
        onOpenSettings={() => handleNavigateTab('management', 'settings')}
        onLock={handleLock}
        syncStatusSlot={<SyncStatusIndicator />}
      />
      <OfflineBanner />

      {/* Main View Area */}
      <main
        className="mx-auto w-full max-w-6xl px-[clamp(0.75rem,3vw,2rem)] py-4 sm:py-5"
        style={{ paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* One period control for every screen that shows period-scoped amounts. */}
        <div className="mb-4">
          <PeriodSelector
            period={period}
            currentYearMonth={currentPeriodYM}
            onChange={setCurrentYM}
          />
        </div>

        <SmsReviewCard
          candidates={smsCandidates}
          categories={categories}
          paymentCards={paymentCards}
          onApprove={handleApproveSmsCandidate}
          onDismiss={handleDismissSmsCandidate}
        />

        {cardSettlementSummary.cards.some(card => card.source === 'estimated') && <details className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          <summary className="cursor-pointer font-bold">카드 청구액 {cardSettlementSummary.cards.filter(card => card.source === 'estimated').length}건 확인 필요</summary>
          <p className="mt-2">기록 기반 추정액입니다. 사용 기록이 없다는 이유로 실제 청구액이 0원이 되는 것은 아닙니다.</p>
          {cardSettlementSummary.cards.filter(card => card.source === 'estimated').map(card => {
            const replaced = cardSettlementCandidates.filter(candidate => candidate.cardId === card.cardId && candidate.status === 'replaced');
            const previous = replaced.reduce((sum, candidate) => sum + (recurringTemplates.find(template => template.id === candidate.templateId)?.defaultAmount || 0), 0);
            return <p key={card.cardId} className="mt-1">{card.cardName}: {card.estimatedAmount === 0 ? '사용 기록 없음 · 청구액 미확인' : formatKRW(card.estimatedAmount) + ' 추정'}{previous > 0 && ' · 대체된 정기 원본 ' + formatKRW(previous)}{!card.hasStatementWindow && ' · 이용기간 미설정'}</p>;
          })}
          <button className="mt-2 min-h-10 rounded border border-amber-500/40 px-3" onClick={() => handleNavigateTab('accounts')}>청구액·이용기간 확인</button>
        </details>}
        <Suspense fallback={<ViewLoading />}>
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
            showSetupPrompt={recurringTemplates.every(template => Boolean(template.archivedAt)) && !userProfile.onboardingCompletedAt}
            onStartSetup={() => setIsOnboardingOpen(true)}
            showPaydayPrompt={showPaydayPrompt}
            onStartPayday={() => void handleOpenPaydaySetup()}
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
            onUndoPostedOccurrence={occurrenceId => void handleUndoPostedOccurrence(occurrenceId)}
            onExcludeOccurrence={occurrenceId => void handleExcludeRecurringOccurrence(occurrenceId)}
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
            getBankAccountUsage={getBankAccountUsage}
            onMergeBankAccount={async (sourceId, targetId) => {
              const target = bankAccounts.find(account => account.id === targetId);
              const count = await mergeBankAccount(sourceId, targetId);
              refreshAppData();
              showToast({ message: '연결 내역을 옮기고 중복 계좌를 삭제했습니다.', description: (target?.accountName || '선택 계좌') + ' · ' + count + '건 변경', tone: 'success' });
            }}
            onDeleteBankAccount={(id) => {
              const deleted = deleteBankAccount(id);
              if (deleted) {
                showToast({ message: '계좌를 삭제했습니다.', tone: 'success' });
              } else {
                showToast({
                  message: '사용 중인 계좌는 삭제할 수 없습니다.',
                  description: '계좌 사용 내역에서 연결된 항목을 확인해 주세요.',
                  tone: 'error',
                });
              }
              refreshAppData();
              return deleted;
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
            key={`${currentYM}:${historyView || 'spending'}`}
            initialView={historyView}
            replacedTemplateIds={[...duplicateCardSettlementTemplateIds]}
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
            transactions={planningTransactions}
            categories={categories}
            aiInsightsEnabled={userProfile.aiInsightsEnabled}
          />
        )}

        {activeTab === 'management' && (
          <ManagementView
            allRecurringOccurrences={allRecurringOccurrences}
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
            onExportDiagnostic={handleExportDiagnostic}
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
        </Suspense>
      </main>

      {/* Central Add Transaction Modal */}
      <Suspense fallback={null}>
      {isAddModalOpen && <AddTransactionModal
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
        onEnableAI={handleEnableTransactionAi}
        onSaveTransaction={handleSaveTransaction}
        onSaveMerchantRule={saveMerchantRule}
        quickEntries={quickEntries}
        onPostQuickEntry={handlePostQuickEntry}
        onManageQuickEntries={() => {
          setIsAddModalOpen(false);
          handleNavigateTab('management', 'quick_entries');
        }}
        onPostOccurrence={async (occId, amount, pType, accId, cardId) => {
          await postOccurrenceToTransaction(occId, amount, pType, accId, cardId);
          refreshAppData();
          showToast({ message: '정기 항목을 확정했습니다.', tone: 'success' });
        }}
      />}

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

      {isPaydaySheetOpen && <PaydaySetupSheet
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
      />}

      {isOnboardingOpen && <OnboardingSheet
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onSkip={handleSkipOnboarding}
        onComplete={handleCompleteOnboarding}
      />}
      </Suspense>

      {/* Fixed Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={tab => handleNavigateTab(tab)}
        onOpenAddModal={() => setIsAddModalOpen(true)}
      />
    </div>
  );
}
