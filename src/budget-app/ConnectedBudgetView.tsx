import { transactionsCsv } from '../utils/transactionCsv';
import { useMemo, useState, useEffect, useRef } from 'react';
import { AccountBudgetView, type BudgetAccountActions } from './AccountBudgetView';
import {
  budgetWithSettings,
  buildTransactionUpdates,
  transactionForStorage,
  type BudgetAccountData,
} from './adapter';
import type { BudgetPeriodNav } from './BudgetApp';
import type { BudgetSmsBridge } from './BudgetSmsPanel';
import {
  createOccurrenceForPeriod,
  deleteQuickEntry,
  deleteRecurringTemplate,
  deleteTransaction,
  ensureBudget,
  ensureRecurringOccurrences,
  ensureTransactionHistoryFor,
  finalizeTransactionDeletion,
  getCyclePlanState,
  getAllRecurringOccurrences,
  getBankAccounts,
  getBudget,
  getCategories,
  getCycleBaseline,
  getMerchantRules,
  getPaymentCards,
  getQuickEntries,
  getRecurringTemplates,
  getTransactions,
  getUserProfile,
  postOccurrenceToTransaction,
  restoreTransaction,
  saveQuickEntry,
  saveRecurringTemplate,
  resetAllData,
  saveTransaction,
  saveMerchantRule,
  subscribeToStorage,
  updateBudget,
  updateOccurrenceStatus,
  updateQuickEntry,
  updateRecurringTemplate,
  updateTransaction,
  updateUserProfile,
} from '../utils/storage';
import { getCurrentYearMonth, getLocalDateString, shiftYearMonth } from '../utils/calculations';
import { fetchAllTransactionsForExport, getLoadedTransactionHistoryFloor } from '../utils/cloudSync';
import { authenticatedFetch, getSignedInAccount, isOwnerLoggedIn } from '../utils/auth';
import { aiRequest } from './aiClient';
import { StartViewSetting } from './StartViewSetting';
import { BudgetMerchantRule } from '../lib/budgetAi';
import { auth } from '../lib/firebase';
import { OfflineBanner, SyncStatusIndicator, StorageFullBanner } from '../components/SyncStatusIndicator';
import { SyncConflictBanner } from '../components/SyncConflictBanner';
import { SmsImportSettingsCard } from '../components/SmsImportSettingsCard';
import { useConfirm, useToast } from '../components/ui/FeedbackProvider';
import './styles.css';

/** How long a deleted transaction can still be brought back. */
const UNDO_WINDOW_MS = 6000;
/** Farthest back the cycle selector goes; older cycles load from the cloud on demand. */
const MAX_CYCLES_BACK = 36;

function readAccount(selectedYM?: string): BudgetAccountData {
  // Reading the profile first applies the payday schedule and early-start
  // overrides, which every cycle boundary below depends on.
  const profile = getUserProfile();
  const key = selectedYM || getCurrentYearMonth(profile.monthStartDay);
  return {
    profile,
    transactions: getTransactions(),
    templates: getRecurringTemplates(),
    occurrences: getAllRecurringOccurrences(),
    budget: getBudget(key),
    categories: getCategories(),
    historyFloor: getLoadedTransactionHistoryFloor(),
    merchantRules: getMerchantRules(),
    cycleBaseline: getCycleBaseline(key),
    paymentCards: getPaymentCards(),
    bankAccounts: getBankAccounts(),
    quickEntries: getQuickEntries(),
  };
}

/** Mounted only after the existing App's PIN/session/migration gates have passed. */
export function ConnectedBudgetView({
  onLock,
  sms,
  entryRequested,
  onEntryRequestHandled,
}: {
  onLock: () => void;
  sms?: BudgetSmsBridge;
  entryRequested?: boolean;
  onEntryRequestHandled?: () => void;
}) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  /** null follows today's cycle; a label pins a past one. */
  const [pinnedYM, setPinnedYM] = useState<string | null>(null);
  const pinnedRef = useRef<string | null>(null);
  pinnedRef.current = pinnedYM;
  const [account, setAccount] = useState(() => readAccount());
  const currentYM = getCurrentYearMonth(account.profile.monthStartDay);
  const selectedYM = pinnedYM && pinnedYM < currentYM ? pinnedYM : currentYM;
  useEffect(() => {
    const refresh = () => setAccount(readAccount(pinnedYM || undefined));
    refresh();
    // Past cycles may not be on this device yet; load them before the figures are trusted.
    if (pinnedYM) {
      void ensureBudget(pinnedYM).catch(() => undefined);
      ensureRecurringOccurrences(pinnedYM, getUserProfile().monthStartDay);
      void ensureTransactionHistoryFor(pinnedYM)
        .then(refresh)
        .catch(() => undefined);
    }
    const unsubscribe = subscribeToStorage(refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [pinnedYM]);
  const agent = useMemo(
    () => ({
      deps: {
        // Storage writes already notify the subscription above; this keeps the view current even when they do not.
        refresh: () => setAccount(readAccount(pinnedRef.current || undefined)),
        isCyclePlanSaved: () => {
          const profile = getUserProfile();
          return (
            getCyclePlanState(pinnedRef.current || getCurrentYearMonth(profile.monthStartDay), profile.monthStartDay) ===
            'saved'
          );
        },
      },
      onEnable: async () => {
        if (getUserProfile().aiClassificationEnabled) return true;
        const accepted = await confirm({
          title: 'AI 지출·재무 기능을 사용할까요?',
          description:
            '입력한 내용과 계좌·카드 번호를 제외한 재무 요약 및 거래 정보만 선택한 AI API로 전송됩니다. AI가 만든 거래와 변경은 확인 카드에서 승인해야 반영됩니다.',
          confirmLabel: '동의하고 사용',
        });
        if (!accepted) return false;
        updateUserProfile({ aiClassificationEnabled: true, aiConsentAt: getUserProfile().aiConsentAt || new Date().toISOString() });
        return true;
      },
    }),
    [confirm],
  );
  const periodNav = useMemo<BudgetPeriodNav>(
    () => ({
      isCurrent: selectedYM === currentYM,
      canGoPrev: selectedYM > shiftYearMonth(currentYM, -MAX_CYCLES_BACK),
      onPrev: () => setPinnedYM(shiftYearMonth(selectedYM, -1)),
      onNext: () => {
        const next = shiftYearMonth(selectedYM, 1);
        setPinnedYM(next >= currentYM ? null : next);
      },
      onToday: () => setPinnedYM(null),
    }),
    [selectedYM, currentYM],
  );
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
      updateTransaction: async (id, edit) => {
        guard();
        const existing = getTransactions().find((t) => t.id === id);
        if (!existing) throw new Error('이 내역은 여기서 수정할 수 없어요. (할부 환산 내역 등)');
        const updates = buildTransactionUpdates(existing, edit, getUserProfile().monthStartDay);
        // updateTransaction applies the revision protocol for amount, date and linked-occurrence changes.
        if (Object.keys(updates).length > 0 && !updateTransaction(id, updates))
          throw new Error('거래를 찾지 못했습니다. 목록을 새로고침해 주세요.');
        if (edit.saveRule && edit.categoryId && edit.merchant) {
          if (!getCategories().some((c) => c.id === edit.categoryId && c.active))
            throw new Error('카테고리를 확인해 주세요.');
          saveMerchantRule(edit.merchant, edit.categoryId);
        }
      },
      deleteTransaction: async (id) => {
        guard();
        const target = getTransactions().find((t) => t.id === id);
        const snapshot = deleteTransaction(id);
        if (!snapshot) throw new Error('이미 삭제된 거래입니다.');
        let undone = false;
        const finalizeTimer = window.setTimeout(() => {
          if (!undone) finalizeTransactionDeletion(snapshot);
        }, UNDO_WINDOW_MS);
        toastRef.current({
          message: '거래를 삭제했습니다.',
          description: `${target?.merchant || '사용처 미입력'} ${(target?.amount ?? 0).toLocaleString('ko-KR')}원`,
          tone: 'info',
          durationMs: UNDO_WINDOW_MS,
          action: {
            label: '실행 취소',
            onAction: () => {
              undone = true;
              window.clearTimeout(finalizeTimer);
              restoreTransaction(snapshot.transaction, snapshot.restoredOccurrenceIds);
              toastRef.current({ message: '삭제를 취소했습니다.', tone: 'success' });
            },
          },
        });
      },
      saveQuickEntry: async (entry) => {
        guard();
        saveQuickEntry(entry);
      },
      updateQuickEntry: async (id, patch) => {
        guard();
        if (!updateQuickEntry(id, patch)) throw new Error('단골 항목을 찾을 수 없습니다.');
      },
      deleteQuickEntry: async (id) => {
        guard();
        if (!deleteQuickEntry(id)) throw new Error('단골 항목을 찾을 수 없습니다.');
      },
      saveSettings: async (settings) => {
        guard();
        const profile = getUserProfile();
        const key = pinnedRef.current || getCurrentYearMonth(profile.monthStartDay);
        await updateBudget(budgetWithSettings(getBudget(key), settings));
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
          window.location.href = '/?view=classic';
        }}
      />
      <AccountBudgetView
        account={account}
        actions={actions}
        isDemo={false}
        selectedKey={selectedYM}
        periodNav={periodNav}
        sms={sms}
        agent={agent}
        entryRequested={entryRequested}
        onEntryRequestHandled={onEntryRequestHandled}
        aiRequest={aiRequest(authenticatedFetch)}
        accountContent={
          <>
            <section className="bb-card">
              <div className="bb-section-heading">
                <h2>{getSignedInAccount().name}의 가계부</h2>
                <SyncStatusIndicator />
              </div>
              <div className="bb-button-row">
                <button type="button" className="bb-small-button" onClick={onLock}>
                  잠그기
                </button>
              </div>
            </section>
            <div className="bb-dark-embed bb-dark-card">
              <SmsImportSettingsCard
                userProfile={account.profile}
                onUpdateUserProfile={updateUserProfile}
                onScanComplete={sms?.onScanComplete}
              />
            </div>
            <StartViewSetting />
          </>
        }
      />
    </>
  );
}
