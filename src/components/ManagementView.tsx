import React, { useEffect, useState } from 'react';
import {
  Calendar,
  DollarSign,
  Layers,
  Settings as SettingsIcon,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Download,
  Sparkles,
  RefreshCw,
  Zap,
  Check,
  X,
  Lock,
  Building2,
  CreditCard,
  Copy,
  Edit2,
  ExternalLink,
  Wallet,
  CheckCheck,
  ArrowRight,
  CalendarRange,
} from 'lucide-react';
import {
  RecurringTemplate,
  RecurringOccurrence,
  Budget,
  Category,
  UserProfile,
  MerchantRule,
  BankAccount,
  PaymentCard,
  PaymentMethodType,
} from '../types';
import {
  formatKRW,
  getAccountingPeriod,
  getCurrentYearMonth,
  getMonthlyDueDateInPeriod,
  MonthSummary,
  normalizeMonthStartDay,
} from '../utils/calculations';
import { authenticatedFetch } from '../utils/auth';
import { MonthlyCardSettlementSummary } from '../utils/cardPayments';
import { useConfirm, useToast } from './ui/FeedbackProvider';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';
import { parseAmountInput } from '../utils/amount';
import { IDLE_LOCK_OPTIONS, describeIdleLockMinutes, normalizeIdleLockMinutes } from '../utils/lockPolicy';
import { InstallAppCard } from './InstallAppCard';

const POPULAR_KOREAN_BANKS = [
  'KB국민',
  '신한은행',
  '카카오뱅크',
  '토스뱅크',
  'NH농협',
  '우리은행',
  '하나은행',
  'IBK기업',
  '케이뱅크',
  '우체국',
  '새마을금고',
  '신협',
  'SC제일',
  '기타',
];

interface ManagementViewProps {
  initialSubTab?: string;
  recurringTemplates: RecurringTemplate[];
  recurringOccurrences: RecurringOccurrence[];
  ignoredCardSettlementTemplateIds?: string[];
  budget: Budget;
  summary: MonthSummary;
  categories: Category[];
  userProfile: UserProfile;
  merchantRules: MerchantRule[];
  bankAccounts?: BankAccount[];
  paymentCards?: PaymentCard[];
  cardSettlementSummary: MonthlyCardSettlementSummary;
  classificationIssues?: {
    transactionCount: number;
    transactionAmount: number;
    templateCount: number;
    orphanOccurrenceCount: number;
    totalCount: number;
  };
  onSaveRecurringTemplate: (tmpl: Omit<RecurringTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateRecurringTemplate?: (id: string, updates: Partial<RecurringTemplate>) => void;
  onDeleteRecurringTemplate?: (id: string) => void;
  onPostOccurrence: (occId: string, customAmount?: number) => void;
  onUpdateOccurrenceStatus: (occId: string, status: RecurringOccurrence['status']) => void;
  onUpdateBudget: (budget: Budget) => Promise<Budget>;
  onSaveCategory: (cat: Omit<Category, 'id'>) => void;
  onToggleCategoryActive: (id: string) => void;
  onMergeCategory: (removeId: string, replaceId: string) => void;
  onUpdateUserProfile: (updates: Partial<UserProfile>) => void;
  onExportCSV: () => void;
  onResetData: () => void | Promise<void>;
  onRepairClassificationIssues?: () => { repairedTransactions: number; repairedTemplates: number };
}

export const ManagementView: React.FC<ManagementViewProps> = ({
  initialSubTab = 'recurring',
  recurringTemplates,
  recurringOccurrences,
  ignoredCardSettlementTemplateIds = [],
  budget,
  summary,
  categories,
  userProfile,
  merchantRules,
  bankAccounts = [],
  paymentCards = [],
  cardSettlementSummary,
  classificationIssues = { transactionCount: 0, transactionAmount: 0, templateCount: 0, orphanOccurrenceCount: 0, totalCount: 0 },
  onSaveRecurringTemplate,
  onUpdateRecurringTemplate,
  onDeleteRecurringTemplate,
  onPostOccurrence,
  onUpdateOccurrenceStatus,
  onUpdateBudget,
  onSaveCategory,
  onToggleCategoryActive,
  onMergeCategory,
  onUpdateUserProfile,
  onExportCSV,
  onResetData,
  onRepairClassificationIssues,
}) => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [subTab, setSubTab] = useState<'recurring' | 'budget' | 'category' | 'settings'>(
    (initialSubTab as any) || 'recurring'
  );

  // Sub-view inside Recurring items: 'schedule' (일정 목록) vs 'bank_accounts' (계좌/은행별 이체 모아보기)
  const [recurringViewMode, setRecurringViewMode] = useState<'schedule' | 'bank_accounts'>('bank_accounts');

  // Modal State for Adding / Editing Recurring Item
  const [isAddRecurringOpen, setIsAddRecurringOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const [recType, setRecType] = useState<'income' | 'expense'>('expense');
  const [recName, setRecName] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recCategoryId, setRecCategoryId] = useState(
    categories.find(category => category.id === 'etc_expense')?.id
      || categories.find(category => category.type === 'expense' && category.active)?.id
      || '',
  );
  const [recDay, setRecDay] = useState('25');
  const [recPostingMode, setRecPostingMode] = useState<'confirm' | 'auto'>('confirm');
  const [recBankName, setRecBankName] = useState('신한은행');
  const [recAccountNumber, setRecAccountNumber] = useState('');
  const [recAccountHolder, setRecAccountHolder] = useState('');

  const [recPaymentMethodType, setRecPaymentMethodType] = useState<PaymentMethodType>('account');
  const [recAccountId, setRecAccountId] = useState<string>('');
  const [recCardId, setRecCardId] = useState<string>('');

  // Toast notification for copy action
  const [recurringError, setRecurringError] = useState<string | null>(null);

  // Modal State for Budget Edit
  const [tempTotalBudget, setTempTotalBudget] = useState(budget.totalLimit.toString());
  const [isBudgetSaving, setIsBudgetSaving] = useState(false);
  const tempAllowanceLimit = Math.max(0, Number.parseInt(tempTotalBudget, 10) || 0);
  const tempPlannedSavings = summary.livingBudget - tempAllowanceLimit;

  useEffect(() => {
    setTempTotalBudget(budget.totalLimit.toString());
  }, [budget.yearMonth, budget.totalLimit]);

  // Category Creator
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'income' | 'expense'>('expense');

  // AI Category Suggestion
  const [aiCatPrompt, setAiCatPrompt] = useState('');
  const [aiCatSuggestions, setAiCatSuggestions] = useState<any[]>([]);
  const [isAiCatLoading, setIsAiCatLoading] = useState(false);

  const triggerToast = (msg: string) => showToast({ message: msg, tone: 'success' });

  const activeMonthStartDay = normalizeMonthStartDay(userProfile.monthStartDay);
  const currentPeriodPreview = getAccountingPeriod(
    getCurrentYearMonth(activeMonthStartDay),
    activeMonthStartDay,
  );

  const copyToClipboard = (text: string, toastMessage: string) => {
    navigator.clipboard.writeText(text);
    triggerToast(toastMessage);
  };

  const openNewRecurringModal = () => {
    setRecurringError(null);
    setEditingTemplateId(null);
    setRecType('expense');
    setRecName('');
    setRecAmount('');
    setRecCategoryId(
      categories.find(category => category.id === 'etc_expense')?.id
        || categories.find(category => category.type === 'expense' && category.active)?.id
        || '',
    );
    setRecDay('25');
    setRecPostingMode('confirm');
    setRecPaymentMethodType('account');

    if (bankAccounts && bankAccounts.length > 0) {
      const firstAcc = bankAccounts[0];
      setRecAccountId(firstAcc.id);
      setRecCardId('');
      setRecBankName(firstAcc.bankName || 'KB국민');
      setRecAccountNumber(firstAcc.accountNumber || '');
      setRecAccountHolder(firstAcc.accountHolder || '');
    } else {
      setRecAccountId('');
      setRecCardId('');
      setRecBankName('KB국민');
      setRecAccountNumber('');
      setRecAccountHolder('');
    }
    setIsAddRecurringOpen(true);
  };

  const openEditRecurringModal = (tmpl: RecurringTemplate) => {
    setRecurringError(null);
    setEditingTemplateId(tmpl.id);
    setRecType(tmpl.type);
    setRecName(tmpl.name);
    setRecAmount(tmpl.defaultAmount.toString());
    const templateCategory = categories.find(category => category.id === tmpl.categoryId);
    setRecCategoryId(
      templateCategory?.type === tmpl.type
        ? tmpl.categoryId
        : categories.find(category => category.id === (tmpl.type === 'expense' ? 'etc_expense' : 'etc_income'))?.id
          || categories.find(category => category.type === tmpl.type && category.active)?.id
          || '',
    );
    if (templateCategory && templateCategory.type !== tmpl.type) {
      triggerToast('기존 분류가 유형과 달라 호환되는 기타 카테고리로 보정했습니다.');
    }
    setRecDay(tmpl.dayOfMonth.toString());
    setRecPostingMode(tmpl.postingMode);
    setRecPaymentMethodType(tmpl.paymentMethodType || 'account');
    setRecAccountId(tmpl.accountId || '');
    setRecCardId(tmpl.cardId || '');
    setRecBankName(tmpl.bankName || 'KB국민');
    setRecAccountNumber(tmpl.accountNumber || '');
    setRecAccountHolder(tmpl.accountHolder || tmpl.counterparty || '');
    setIsAddRecurringOpen(true);
  };

  const handleSaveRecurringSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseInt(recAmount, 10);
    const dayNum = parseInt(recDay, 10);

    const selectedCategory = categories.find(category => category.id === recCategoryId);
    if (!recName.trim()) {
      setRecurringError('항목 명칭을 입력해 주세요.');
      return;
    }
    if (isNaN(amountNum) || amountNum <= 0) {
      setRecurringError('1원 이상의 정수 금액을 입력해 주세요.');
      return;
    }
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      setRecurringError('결제일은 1일부터 31일 사이로 입력해 주세요.');
      return;
    }
    if (!selectedCategory || selectedCategory.type !== recType) {
      setRecurringError(`${recType === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }
    setRecurringError(null);

    const existingTemplate = editingTemplateId
      ? recurringTemplates.find(template => template.id === editingTemplateId)
      : null;
    const dueDateInCurrentPeriod = getMonthlyDueDateInPeriod(dayNum, currentPeriodPreview)
      || currentPeriodPreview.startDate;
    const payload = {
      type: recType,
      name: recName,
      defaultAmount: amountNum,
      categoryId: recCategoryId,
      counterparty: recAccountHolder || recName,
      expenseNature: 'fixed' as const,
      frequency: 'monthly' as const,
      dayOfMonth: dayNum,
      holidayPolicy: 'next_business_day' as const,
      postingMode: recPostingMode,
      allowAmountChange: true,
      bankName: recBankName,
      accountNumber: recAccountNumber,
      accountHolder: recAccountHolder,
      paymentMethodType: recPaymentMethodType,
      accountId: recPaymentMethodType === 'account' ? (recAccountId || null) : (recPaymentMethodType === 'card' ? (recAccountId || null) : null),
      cardId: recPaymentMethodType === 'card' ? (recCardId || null) : null,
      // A new commitment belongs to the full salary cycle even when its due
      // date is before the day it was entered. Editing must not reset its term.
      startDate: existingTemplate?.startDate || currentPeriodPreview.startDate,
      nextDueDate: dueDateInCurrentPeriod,
      active: true,
    };

    if (editingTemplateId && onUpdateRecurringTemplate) {
      onUpdateRecurringTemplate(editingTemplateId, payload);
      triggerToast(`'${recName}' 정기 항목을 수정했습니다.`);
    } else {
      onSaveRecurringTemplate(payload);
      triggerToast(`'${recName}' 정기 항목을 등록했습니다.`);
    }

    setIsAddRecurringOpen(false);
    setEditingTemplateId(null);
  };

  const handleDeleteTemplate = async (id: string, name: string) => {
    const template = recurringTemplates.find(item => item.id === id);
    const accepted = await confirm({
      title: '이 정기 항목을 삭제할까요?',
      description: '아직 처리하지 않은 이번 달 발생 건은 건너뜀으로 정리됩니다. 이미 확정된 거래는 그대로 남습니다.',
      details: [
        { label: '항목', value: name },
        ...(template
          ? [
              { label: '금액', value: formatKRW(template.defaultAmount) },
              { label: '주기', value: `매월 ${template.dayOfMonth}일` },
            ]
          : []),
      ],
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!accepted) return;
    onDeleteRecurringTemplate?.(id);
    showToast({ message: `'${name}' 정기 항목을 삭제했습니다.`, tone: 'info' });
  };

  const handleSaveBudgetLimit = async () => {
    const val = parseInt(tempTotalBudget, 10);
    if (isNaN(val) || val < 0) return;
    setIsBudgetSaving(true);
    try {
      await onUpdateBudget({
        ...budget,
        totalLimit: val,
      });
      triggerToast('월 용돈 한도를 DB에 저장했습니다.');
    } catch (error) {
      showToast({
        message: '월 용돈 한도를 DB에 저장하지 못했습니다.',
        description: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    } finally {
      setIsBudgetSaving(false);
    }
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    onSaveCategory({
      name: newCatName.trim(),
      type: newCatType,
      icon: 'Tag',
      color: '#8B5CF6',
      active: true,
      isCustom: true,
    });
    setNewCatName('');
  };

  const handleRunAiCategorySuggest = async () => {
    if (!aiCatPrompt.trim()) return;
    setIsAiCatLoading(true);
    try {
      const res = await authenticatedFetch('/api/ai/category-recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: aiCatPrompt,
          existingCategories: categories,
        }),
      });
      const data = await res.json();
      setAiCatSuggestions(data.suggestions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAiCatLoading(false);
    }
  };

  // Fixed cash-flow figures come from the shared cash-track model so this
  // screen cannot drift from the dashboard or the recurring centre.
  const monthlyFixedIncome = summary.totalExpectedRecurringIncome;
  const cardPaidFixedExpense = summary.cardFixedExpenses;
  const nonCardFixedExpense = summary.accountFixedOutflow;
  const totalFixedOutflow = summary.accountFixedOutflow + summary.cardSettlementOutflow;

  // Grouping Recurring Items by Bank & Account Number for Transfer Assistance
  const accountGroups = React.useMemo(() => {
    const groupsMap = new Map<
      string,
      {
        key: string;
        bankName: string;
        accountNumber: string;
        accountHolder: string;
        templates: RecurringTemplate[];
        occurrences: { occ: RecurringOccurrence; tmpl: RecurringTemplate }[];
        totalExpectedAmount: number;
        hasUnpostedItems: boolean;
      }
    >();

  const activeExpenseTemplates = recurringTemplates.filter(template => {
      if (ignoredCardSettlementTemplateIds.includes(template.id)) return false;
      if (!template.active || template.type !== 'expense') return false;
      const occurrence = recurringOccurrences.find(item => item.templateId === template.id);
      return (occurrence?.paymentMethodType ?? template.paymentMethodType) !== 'card';
    });

    for (const tmpl of activeExpenseTemplates) {
      const bank = tmpl.bankName || '은행 미지정';
      const account = tmpl.accountNumber || '계좌 미등록';
      const holder = tmpl.accountHolder || tmpl.counterparty || '';
      const groupKey = `${bank}___${account}___${holder}`;

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          key: groupKey,
          bankName: bank,
          accountNumber: account,
          accountHolder: holder,
          templates: [],
          occurrences: [],
          totalExpectedAmount: 0,
          hasUnpostedItems: false,
        });
      }

      const group = groupsMap.get(groupKey)!;
      group.templates.push(tmpl);

      // Find occurrences for this template in the current month
      const tmplOccs = recurringOccurrences.filter(o => o.templateId === tmpl.id && o.status !== 'skipped');
      for (const occ of tmplOccs) {
        group.occurrences.push({ occ, tmpl });
        if (occ.status !== 'posted') {
          group.totalExpectedAmount += occ.actualAmount ?? occ.expectedAmount;
          group.hasUnpostedItems = true;
        }
      }

      // If no occurrences exist for current month yet, use defaultAmount
      if (tmplOccs.length === 0) {
        group.totalExpectedAmount += tmpl.defaultAmount;
        group.hasUnpostedItems = true;
      }
    }

    return Array.from(groupsMap.values()).sort((a, b) => b.totalExpectedAmount - a.totalExpectedAmount);
  }, [recurringTemplates, recurringOccurrences, ignoredCardSettlementTemplateIds]);

  // Total transfer required for registered accounts
  const totalTransferNeeded = accountGroups.reduce((acc, g) => acc + g.totalExpectedAmount, 0);

  return (
    <div className="space-y-5 pb-24 relative">
      {/* Top Sub-Navigation Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-1.5 flex items-center justify-between text-xs">
        <button
          onClick={() => setSubTab('recurring')}
          className={`flex-1 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1.5 ${
            subTab === 'recurring'
              ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>정기/고정 지출</span>
        </button>

        <button
          onClick={() => setSubTab('budget')}
          className={`flex-1 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1.5 ${
            subTab === 'budget'
              ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>예산 설정</span>
        </button>

        <button
          onClick={() => setSubTab('category')}
          className={`flex-1 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1.5 ${
            subTab === 'category'
              ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>카테고리</span>
        </button>

        <button
          onClick={() => setSubTab('settings')}
          className={`flex-1 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1.5 ${
            subTab === 'settings'
              ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          <span>설정 & AI</span>
        </button>
      </div>

      {/* SUBTAB 1: 정기 항목 (RECURRING ITEMS & BANK TRANSFER) */}
      {subTab === 'recurring' && (
        <div className="space-y-4">
          {/* Summary Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span>월 고정 현금흐름 요약</span>
              </h3>

              <button
                onClick={openNewRecurringModal}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>정기 항목 추가</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-center">
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-xs block mb-0.5">이번 달 고정 수입</span>
                <span className="font-extrabold text-emerald-400">{formatKRW(monthlyFixedIncome)}</span>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-xs block mb-0.5">계좌 고정 이체</span>
                <span className="font-extrabold text-rose-400">{formatKRW(nonCardFixedExpense)}</span>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-indigo-500/20">
                <span className="text-slate-400 text-xs block mb-0.5">이번 주기 카드대금</span>
                <span className="font-extrabold text-indigo-300">{formatKRW(summary.cardSettlementOutflow)}</span>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-xs block mb-0.5">총 고정 출금</span>
                <span className="font-extrabold text-rose-300">{formatKRW(totalFixedOutflow)}</span>
              </div>
            </div>
          </div>

          {/* View Mode Toggle: 계좌/은행별 이체 모아보기 vs 전체 일정 목록 */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              onClick={() => setRecurringViewMode('bank_accounts')}
              className={`flex-1 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1.5 ${
                recurringViewMode === 'bank_accounts'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>🏦 계좌/은행별 이체 모아보기</span>
            </button>

            <button
              onClick={() => setRecurringViewMode('schedule')}
              className={`flex-1 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1.5 ${
                recurringViewMode === 'schedule'
                  ? 'bg-slate-800 text-rose-400 border border-slate-700 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>📅 월간 일정 목록 ({recurringTemplates.length}건)</span>
            </button>
          </div>

          {/* VIEW MODE 1: 계좌/은행별 이체 편의 모아보기 (BANK TRANSFER HELPER) */}
          {recurringViewMode === 'bank_accounts' && (
            <div className="space-y-3">
              {/* Transfer Helper Banner */}
              <div className="bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/30 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="bg-emerald-500/20 p-2 rounded-lg border border-emerald-500/30">
                      <Wallet className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-emerald-300 block">이달 계좌 이체 예정 합계</span>
                      <span className="text-slate-400 text-xs">
                        등록된 은행 계좌 {accountGroups.length}곳 / 총 {formatKRW(totalTransferNeeded)}
                      </span>
                    </div>
                  </div>

                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-extrabold px-2.5 py-1 rounded-lg">
                    원클릭 복사 지원
                  </span>
                </div>
              </div>

              {/* Account Cards */}
              <div className="space-y-3">
                {accountGroups.map((group, idx) => {
                  const hasRealAccount = group.accountNumber !== '계좌 미등록';

                  return (
                    <div
                      key={group.key || idx}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-sm hover:border-slate-700 transition-colors"
                    >
                      {/* Account Card Header */}
                      <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-extrabold px-2 py-0.5 rounded">
                              {group.bankName}
                            </span>
                            <span className="font-extrabold text-sm text-slate-100 tracking-wide font-mono">
                              {group.accountNumber}
                            </span>
                          </div>
                          {group.accountHolder && (
                            <div className="text-xs text-slate-400 flex items-center gap-1">
                              <span>예금주:</span>
                              <span className="font-semibold text-slate-200">{group.accountHolder}</span>
                            </div>
                          )}
                        </div>

                        <div className="text-right">
                          <span className="text-xs text-slate-400 block">이체 필요 합계</span>
                          <span className="text-base font-black text-emerald-400">
                            {formatKRW(group.totalExpectedAmount)}
                          </span>
                        </div>
                      </div>

                      {/* Items in this Account */}
                      <div className="space-y-2">
                        {group.templates.map(tmpl => {
                          const occ = group.occurrences.find(o => o.tmpl.id === tmpl.id)?.occ;
                          const isPosted = occ?.status === 'posted';

                          return (
                            <div
                              key={tmpl.id}
                              className="bg-slate-950 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="bg-slate-800 text-slate-300 text-xs px-2 py-0.5 rounded font-bold">
                                  매월 {tmpl.dayOfMonth}일
                                </span>
                                <div>
                                  <span className="font-bold text-slate-200 block">{tmpl.name}</span>
                                  <span className="text-xs text-slate-400">
                                    {tmpl.postingMode === 'auto' ? '자동이체/출금' : '확인후 이체'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="font-bold text-slate-100">
                                  {formatKRW(occ ? (occ.actualAmount ?? occ.expectedAmount) : tmpl.defaultAmount)}
                                </span>

                                {occ && occ.status !== 'posted' ? (
                                  <button
                                    onClick={() => onPostOccurrence(occ.id)}
                                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-bold text-xs px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>이체완료</span>
                                  </button>
                                ) : (
                                  <span className="text-emerald-400 font-extrabold text-xs flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>완료</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* One-click Action Buttons */}
                      <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-2 text-xs">
                        {hasRealAccount && (
                          <button
                            onClick={() =>
                              copyToClipboard(group.accountNumber, `${group.bankName} 계좌번호가 복사되었습니다.`)
                            }
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-1.5 px-2.5 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5 text-emerald-400" />
                            <span>계좌번호 복사</span>
                          </button>
                        )}

                        <button
                          onClick={() =>
                            copyToClipboard(
                              group.totalExpectedAmount.toString(),
                              `이체 금액(${formatKRW(group.totalExpectedAmount)})이 복사되었습니다.`
                            )
                          }
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-1.5 px-2.5 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <CreditCard className="w-3.5 h-3.5 text-rose-400" />
                          <span>금액 복사</span>
                        </button>

                        <button
                          onClick={() => {
                            const info = `[${group.bankName}] ${group.accountNumber} ${
                              group.accountHolder ? `(예금주: ${group.accountHolder})` : ''
                            } - ${formatKRW(group.totalExpectedAmount)} (${group.templates.map(t => t.name).join(', ')})`;
                            copyToClipboard(info, '전체 이체 정보가 복사되었습니다.');
                          }}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-1.5 px-2.5 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                          title="이체 정보 전체 복사"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                          <span>전체 정보 복사</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {accountGroups.length === 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400 space-y-2">
                    <p>등록된 정기 지출 항목이 없습니다.</p>
                    <button
                      onClick={openNewRecurringModal}
                      className="bg-emerald-500 text-slate-950 font-bold px-3 py-1.5 rounded-lg"
                    >
                      + 정기 항목 등록하기
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW MODE 2: 월간 일정 목록 (SCHEDULE TIMELINE & TEMPLATES EDIT) */}
          {recurringViewMode === 'schedule' && (
            <div className="space-y-3">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span>등록된 정기 고정 항목 관리 ({recurringTemplates.length}건)</span>
                  <button
                    onClick={openNewRecurringModal}
                    className="text-emerald-400 text-xs hover:underline font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> 항목 추가
                  </button>
                </h4>

                <div className="space-y-2">
                  {recurringTemplates.map(tmpl => {
                    const cat = categories.find(c => c.id === tmpl.categoryId);
                    const monthOccurrence = recurringOccurrences.find(occurrence => occurrence.templateId === tmpl.id);
                    const monthAmount = monthOccurrence
                      ? monthOccurrence.actualAmount ?? monthOccurrence.expectedAmount
                      : tmpl.defaultAmount;

                    return (
                      <div
                        key={tmpl.id}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded font-extrabold ${
                                tmpl.type === 'income'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {tmpl.type === 'income' ? '수입' : '고정지출'}
                            </span>

                            <span className="font-bold text-slate-100">{tmpl.name}</span>

                            <span className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                              매월 {tmpl.dayOfMonth}일
                            </span>
                          </div>

                          <div className="text-slate-400 text-xs flex items-center gap-2">
                            <span>카테고리: {cat?.name || '미지정'}</span>
                            {tmpl.bankName && tmpl.accountNumber && (
                              <span className="text-emerald-400 font-medium">
                                🏦 {tmpl.bankName} {tmpl.accountNumber}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="block font-black text-slate-100">{formatKRW(monthAmount)}</span>
                            <span className="text-xs text-slate-400">
                              {monthOccurrence?.actualAmount !== null && monthOccurrence?.actualAmount !== undefined
                                ? '이번 달 별도 금액'
                                : '직전 달 승계·기본값'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEditRecurringModal(tmpl)}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                              title="수정"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(tmpl.id, tmpl.name)}
                              className="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-lg transition-colors"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: 예산 설정 (BUDGET LIMITS) */}
      {subTab === 'budget' && (
        <div className="space-y-4 text-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-rose-400" />
              <span>월 용돈 한도 설정</span>
            </h3>

            <p className="text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              💡 <span className="font-bold text-amber-300">핵심 원칙:</span> 고정비는 용돈에서 차감하지 않습니다. 수입에서 고정비와 직접 정한 용돈 한도를 빼고 남는 금액을 저축 예정액으로 관리합니다.
            </p>

            <div className="space-y-2 pt-2">
              <label className="text-slate-300 font-semibold block">이번 달 내 용돈 한도 (KRW)</label>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <AmountInput
                    value={parseAmountInput(tempTotalBudget)}
                    onChange={next => setTempTotalBudget(next ? String(next) : '')}
                    showQuickAdd
                    className="text-base text-rose-400"
                  />
                </div>
                <button
                  onClick={handleSaveBudgetLimit}
                  disabled={isBudgetSaving}
                  className="bg-rose-600 hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-lg transition-colors"
                >
                  {isBudgetSaving ? 'DB 저장 중...' : '저장'}
                </button>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              일반 고정지출은 직전 월 금액을 승계하고 월별로 수정합니다. 카드대금은 승계하지 않고 카드별 지출에서 다시 계산합니다.
            </p>
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs leading-relaxed text-emerald-200">
              저장한 용돈 한도는 현재 월 DB 문서와 사용자 기본 설정에 함께 저장됩니다. 다음 달 예산이 없으면 직전 달의 DB 금액을 자동 승계합니다.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                <div className="text-xs text-slate-400">이번 주기 생활비</div>
                <div className="mt-1 font-bold text-slate-200">{formatKRW(summary.livingBudget)}</div>
              </div>
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5">
                <div className="text-xs text-slate-400">설정할 생활비 한도</div>
                <div className="mt-1 font-bold text-rose-300">{formatKRW(tempAllowanceLimit)}</div>
              </div>
              <div className={`rounded-lg border p-2.5 ${
                tempPlannedSavings >= 0
                  ? 'border-emerald-500/20 bg-emerald-500/5'
                  : 'border-amber-500/30 bg-amber-500/5'
              }`}>
                <div className="text-xs text-slate-400">
                  {tempPlannedSavings >= 0 ? '저축 예정액' : '가용자금 초과'}
                </div>
                <div className={`mt-1 font-bold ${tempPlannedSavings >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {formatKRW(Math.abs(tempPlannedSavings))}
                </div>
              </div>
            </div>

            {tempPlannedSavings < 0 && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                이번 주기 생활비보다 한도가 {formatKRW(-tempPlannedSavings)} 높습니다. 저장은 가능하지만 저축 예정액이 부족해집니다.
              </p>
            )}
          </div>

        </div>
      )}

      {/* SUBTAB 3: 카테고리 (CATEGORIES) */}
      {subTab === 'category' && (
        <div className="space-y-4 text-xs">
          <div className={`border rounded-2xl p-4 ${
            classificationIssues.totalCount > 0
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-emerald-500/10 border-emerald-500/30'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`font-bold flex items-center gap-1.5 ${classificationIssues.totalCount > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {classificationIssues.totalCount > 0 ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  분류 무결성 점검
                </h3>
                {classificationIssues.totalCount > 0 ? (
                  <p className="text-slate-300 mt-1.5 leading-relaxed">
                    유형과 카테고리가 다른 거래 {classificationIssues.transactionCount}건({formatKRW(classificationIssues.transactionAmount)}),
                    정기 항목 {classificationIssues.templateCount}건, 고아 예정 건 {classificationIssues.orphanOccurrenceCount}건을 찾았습니다.
                  </p>
                ) : (
                  <p className="text-slate-300 mt-1.5">수입·지출 유형과 카테고리가 모두 일치합니다.</p>
                )}
              </div>
              {classificationIssues.transactionCount + classificationIssues.templateCount > 0 && onRepairClassificationIssues && (
                <button
                  onClick={async () => {
                    const accepted = await confirm({
                      title: '분류를 정리할까요?',
                      description: '금액과 수입·지출 유형은 그대로 두고, 유형과 맞지 않는 카테고리만 유형별 기타 카테고리로 바꿉니다.',
                      details: [
                        { label: '대상 거래', value: `${classificationIssues.transactionCount}건 (${formatKRW(classificationIssues.transactionAmount)})` },
                        { label: '대상 정기 항목', value: `${classificationIssues.templateCount}건` },
                      ],
                      confirmLabel: '정리 실행',
                      tone: 'danger',
                    });
                    if (!accepted) return;
                    const result = onRepairClassificationIssues();
                    triggerToast(`거래 ${result.repairedTransactions}건, 정기 항목 ${result.repairedTemplates}건의 분류를 정리했습니다.`);
                  }}
                  className="shrink-0 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black px-3 py-2 rounded-lg"
                >
                  분류 정리
                </button>
              )}
            </div>
            {classificationIssues.orphanOccurrenceCount > 0 && (
              <p className="text-xs text-amber-200/80 mt-2">고아 예정 건은 금액 계산에서 제외되며 원본 확인 후 별도로 정리해야 합니다.</p>
            )}
          </div>

          {/* AI Category Name Recommendation */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>AI 카테고리 이름 추천</span>
            </h3>

            <p className="text-slate-400">
              "아이 관련 학원, 장난감, 병원비를 묶고 싶어"처럼 설명하면 AI가 최적의 카테고리명을 제안합니다.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={aiCatPrompt}
                onChange={e => setAiCatPrompt(e.target.value)}
                placeholder="어떤 지출 항목들을 묶고 싶으신가요?"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 placeholder-slate-500"
              />
              <button
                onClick={handleRunAiCategorySuggest}
                disabled={isAiCatLoading}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-3 py-2.5 rounded-lg transition-colors"
              >
                {isAiCatLoading ? '분석중...' : '추천받기'}
              </button>
            </div>

            {aiCatSuggestions.length > 0 && (
              <div className="space-y-2 pt-2">
                {aiCatSuggestions.map((sug, idx) => (
                  <div key={idx} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-amber-300">{sug.suggestedName}</div>
                      <div className="text-xs text-slate-400">{sug.description}</div>
                    </div>
                    <button
                      onClick={() => {
                        onSaveCategory({
                          name: sug.suggestedName,
                          type: 'expense',
                          icon: 'Tag',
                          color: '#A855F7',
                          active: true,
                          isCustom: true,
                        });
                        triggerToast(`'${sug.suggestedName}' 카테고리를 추가했습니다.`);
                      }}
                      className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded"
                    >
                      추가
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create Custom Category */}
          <form onSubmit={handleCreateCategory} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h4 className="font-bold text-slate-200">새 사용자 정의 카테고리 직접 추가</h4>

            <div className="flex gap-2">
              <select
                value={newCatType}
                onChange={e => setNewCatType(e.target.value as 'income' | 'expense')}
                className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-bold"
              >
                <option value="expense">지출</option>
                <option value="income">수입</option>
              </select>

              <input
                type="text"
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder="카테고리 이름 입력..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                required
              />

              <button type="submit" className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 rounded-lg">
                추가
              </button>
            </div>
          </form>

          {/* Category List */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <h4 className="font-bold text-slate-200 mb-2">카테고리 활성 / 비활성 관리</h4>
            <div className="space-y-1.5">
              {categories.map(c => (
                <div key={c.id} className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className={`font-semibold ${c.active ? 'text-slate-100' : 'text-slate-400 line-through'}`}>
                      {c.name}
                    </span>
                    <span className="text-xs text-slate-400">({c.type === 'income' ? '수입' : '지출'})</span>
                  </div>

                  <button
                    onClick={() => onToggleCategoryActive(c.id)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors ${
                      c.active ? 'bg-slate-800 text-slate-300' : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {c.active ? '비활성화' : '다시 사용'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 4: 설정 & AI (SETTINGS & AI) */}
      {subTab === 'settings' && (
        <div className="space-y-4 text-xs">
          {/* Accounting cycle */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-rose-300" />
              <span>급여 사용 주기</span>
            </h3>
            <p className="text-xs leading-relaxed text-slate-400">
              급여일을 주기의 첫날로 삼습니다. 10일로 설정하면 10일부터 다음 달 9일까지가 한 기간입니다.
              이 기간의 활성 고정지출은 실제 납부일이 25일이라도 급여가 들어온 시점에 먼저 전액 확보합니다.
            </p>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <span className="font-bold text-slate-200">매월 급여일</span>
              <select
                value={normalizeMonthStartDay(userProfile.monthStartDay)}
                onChange={async event => {
                  const nextStartDay = normalizeMonthStartDay(Number(event.target.value));
                  if (nextStartDay === normalizeMonthStartDay(userProfile.monthStartDay)) return;
                  const preview = getAccountingPeriod(
                    getCurrentYearMonth(nextStartDay),
                    nextStartDay,
                  );
                  const accepted = await confirm({
                    title: '예산 주기를 바꿀까요?',
                    description: '기록된 거래는 바뀌지 않지만, 각 기간에 어떤 거래가 포함되는지가 달라집니다.',
                    details: [
                      { label: '새 시작일', value: `매월 ${nextStartDay}일` },
                      { label: '현재 기간', value: `${preview.startDate} ~ ${preview.endDate}` },
                      { label: '영향 범위', value: '홈 요약 · 분석 · 카드 정산 · CSV' },
                    ],
                    confirmLabel: '주기 변경',
                  });
                  if (!accepted) return;
                  onUpdateUserProfile({ monthStartDay: nextStartDay });
                  triggerToast(`예산 주기를 매월 ${nextStartDay}일 시작으로 변경했습니다.`);
                }}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-bold text-slate-100 focus:border-rose-500 focus:outline-none"
              >
                {Array.from({ length: 28 }, (_, index) => index + 1).map(day => (
                  <option key={day} value={day}>{day}일</option>
                ))}
              </select>
            </label>

            <p className="text-xs text-slate-400">
              현재 기간: <span className="font-semibold text-slate-200">
                {currentPeriodPreview.startDate} ~ {currentPeriodPreview.endDate}
              </span>
              {normalizeMonthStartDay(userProfile.monthStartDay) === 1 && ' (달력 월과 동일)'}
            </p>
            <p className="text-xs text-slate-400">
              매월 29~31일은 없는 달이 있어 시작일은 28일까지만 선택할 수 있습니다.
            </p>
          </div>

          <InstallAppCard />

          {/* AI Settings Toggles */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>AI 기능 및 데이터 설정</span>
            </h3>

            <div className="space-y-3 pt-1">
              <label className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800 cursor-pointer">
                <div>
                  <span className="font-bold text-slate-200 block">AI 자연어 거래 자동분류</span>
                  <span className="text-xs text-slate-400">문장 입력을 분석해 유형, 금액, 카테고리를 자동 추출합니다.</span>
                </div>
                <input
                  type="checkbox"
                  checked={userProfile.aiClassificationEnabled}
                  onChange={async e => {
                    const enabled = e.target.checked;
                    if (enabled && !userProfile.aiConsentAt) {
                      const accepted = await confirm({
                        title: 'AI 자동분류를 사용할까요?',
                        description: '입력한 문장과 카테고리 목록이 Gemini API로 전송됩니다. 금액과 사용처가 포함될 수 있습니다.',
                        confirmLabel: '동의하고 사용',
                      });
                      if (!accepted) return;
                    }
                    onUpdateUserProfile({
                      aiClassificationEnabled: enabled,
                      aiConsentAt: enabled ? (userProfile.aiConsentAt || new Date().toISOString()) : userProfile.aiConsentAt,
                    });
                  }}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                />
              </label>

              <label className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800 cursor-pointer">
                <div>
                  <span className="font-bold text-slate-200 block">AI 월간 맞춤 피드백 리포트</span>
                  <span className="text-xs text-slate-400">집계 수치를 바탕으로 실행 가능한 절약 행동 팁을 제공합니다.</span>
                </div>
                <input
                  type="checkbox"
                  checked={userProfile.aiInsightsEnabled}
                  onChange={async e => {
                    const enabled = e.target.checked;
                    if (enabled && !userProfile.aiConsentAt) {
                      const accepted = await confirm({
                        title: 'AI 리포트를 사용할까요?',
                        description: '월별 수입·지출 집계와 카테고리 요약이 Gemini API로 전송됩니다.',
                        confirmLabel: '동의하고 사용',
                      });
                      if (!accepted) return;
                    }
                    onUpdateUserProfile({
                      aiInsightsEnabled: enabled,
                      aiConsentAt: enabled ? (userProfile.aiConsentAt || new Date().toISOString()) : userProfile.aiConsentAt,
                    });
                  }}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                />
              </label>
            </div>
          </div>

          {/* PIN Security Status */}
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4 space-y-3.5 relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span>PIN 로그인 보안</span>
              </h3>
              <span className="text-xs font-extrabold px-2 py-0.5 rounded border bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                활성화됨
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              PIN 확인 후 고정 소유자 세션을 발급하며, 확인 전에는 Firestore 데이터와 Gemini API를 불러오지 않습니다.
            </p>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <span className="min-w-0">
                <span className="block font-bold text-slate-200">자동 잠금 시간</span>
                <span className="block text-xs text-slate-400">
                  아무 조작이 없을 때 잠깁니다. 잠기기 1분 전에 알려드립니다.
                </span>
              </span>
              <select
                value={normalizeIdleLockMinutes(userProfile.idleLockMinutes)}
                onChange={event => {
                  const minutes = normalizeIdleLockMinutes(Number(event.target.value));
                  onUpdateUserProfile({ idleLockMinutes: minutes });
                  triggerToast(
                    minutes === 0
                      ? '자동 잠금을 사용하지 않습니다.'
                      : `자동 잠금 시간을 ${describeIdleLockMinutes(minutes)}으로 변경했습니다.`,
                  );
                }}
                className="shrink-0 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-bold text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {IDLE_LOCK_OPTIONS.map(minutes => (
                  <option key={minutes} value={minutes}>{describeIdleLockMinutes(minutes)}</option>
                ))}
              </select>
            </label>

            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 text-xs text-slate-400 space-y-1">
              <span className="font-bold text-emerald-300 block">PIN 변경 방법</span>
              <p className="leading-normal">
                PIN은 앱 데이터에 저장되지 않습니다. 새 PIN hash를 생성한 뒤 배포 환경의 <code className="bg-slate-900 text-emerald-400 px-1 py-0.5 rounded border border-slate-800">APP_PIN_HASH</code> secret을 교체하세요.
              </p>
            </div>
          </div>

          {/* AI Merchant Rules List */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h4 className="font-bold text-slate-200">학습된 개인 가맹점 분류 규칙 목록</h4>
            <p className="text-slate-400 text-xs">
              동일한 패턴은 AI를 호출하지 않고 규칙을 우선 적용해 속도를 높이고 API 비용을 절감합니다.
            </p>

            <div className="space-y-1.5">
              {merchantRules.map(r => {
                const cat = categories.find(c => c.id === r.categoryId);
                return (
                  <div key={r.id} className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="font-bold text-amber-300">'{r.pattern}'</span>
                    <span className="text-slate-300 font-semibold">➔ {cat?.name || '카테고리'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CSV Export & Data Reset */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h4 className="font-bold text-slate-200">데이터 내보내기 및 초기화</h4>

            <div className="flex gap-3">
              <button
                onClick={onExportCSV}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>CSV 거래 내역 내보내기</span>
              </button>

              <button
                onClick={async () => {
                  const accepted = await confirm({
                    title: '운영 데이터를 전체 초기화할까요?',
                    description: '거래, 정기 항목, 계좌, 카드, 카테고리가 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
                    confirmLabel: '전체 초기화',
                    tone: 'danger',
                    requireText: '전체 초기화',
                  });
                  if (!accepted) return;
                  await onResetData();
                  showToast({ message: '데이터 초기화가 완료되었습니다.', tone: 'info' });
                }}
                className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold px-4 py-2.5 rounded-xl transition-colors"
              >
                전체 초기화
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for Adding / Editing Recurring Template */}
      <Modal
        isOpen={isAddRecurringOpen}
        onClose={() => setIsAddRecurringOpen(false)}
        labelledById="recurring-modal-title"
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="recurring-modal-title" className="text-sm font-bold text-white">
                {editingTemplateId ? '정기 항목 및 은행 계좌 수정' : '신규 정기 항목 & 계좌 등록'}
              </h3>
              <button
                onClick={() => setIsAddRecurringOpen(false)}
                aria-label="정기 항목 창 닫기"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div aria-live="polite">
              {recurringError && (
                <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300">
                  {recurringError}
                </p>
              )}
            </div>

            <form onSubmit={handleSaveRecurringSubmit} className="space-y-3 text-xs" noValidate>
              <div>
                <label className="text-slate-400 block mb-1">유형</label>
                <select
                  value={recType}
                  onChange={e => {
                    const newType = e.target.value as 'income' | 'expense';
                    setRecType(newType);
                    // auto select category matching new type if current category type doesn't match
                    const currentCat = categories.find(c => c.id === recCategoryId);
                    if (!currentCat || currentCat.type !== newType) {
                      const defaultId = newType === 'expense' ? 'etc_expense' : 'etc_income';
                      const matchedCat = categories.find(c => c.id === defaultId)
                        || categories.find(c => c.type === newType && c.active);
                      if (matchedCat) {
                        setRecCategoryId(matchedCat.id);
                        triggerToast(`${newType === 'expense' ? '지출' : '수입'} 유형에 맞춰 '${matchedCat.name}' 카테고리로 변경했습니다.`);
                      }
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 font-bold"
                >
                  <option value="expense">반복 고정지출 (예: 월세, 생활비, 관리비)</option>
                  <option value="income">고정 수입 (예: 월급, 부수입)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">항목 이름</label>
                <input
                  type="text"
                  value={recName}
                  onChange={e => {
                    setRecurringError(null);
                    setRecName(e.target.value);
                  }}
                  placeholder="예: 배우자 생활비, 아파트 관리비, 월급"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">기본 예상 금액 (KRW)</label>
                <AmountInput
                  value={parseAmountInput(recAmount)}
                  onChange={next => {
                    setRecurringError(null);
                    setRecAmount(next ? String(next) : '');
                  }}
                  placeholder="예: 1,200,000"
                  showQuickAdd
                  invalid={Boolean(recurringError)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">매월 이체/결제 예정일</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={recDay}
                    onChange={e => {
                      setRecurringError(null);
                      setRecDay(e.target.value);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">카테고리</label>
                  <select
                    value={recCategoryId}
                    onChange={e => setRecCategoryId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 font-medium"
                  >
                    {categories.filter(c => c.type === recType && c.active).map(c => (
                      <option key={c.id} value={c.id}>
                        {recType === 'expense' ? '[지출]' : '[수입]'} {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Bank & Account / Payment Method Section */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5 text-xs">
                    <Building2 className="w-3.5 h-3.5" />
                    <span>이체용 은행 / 계좌 / 카드 선택</span>
                  </span>
                  {(bankAccounts.length > 0 || paymentCards.length > 0) && (
                    <span className="text-xs text-slate-400 font-medium">
                      등록 계좌 {bankAccounts.length}개 / 카드 {paymentCards.length}개
                    </span>
                  )}
                </div>

                {/* Method Type Selector */}
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setRecPaymentMethodType('account');
                      if (bankAccounts.length > 0 && !recAccountId) {
                        const acc = bankAccounts[0];
                        setRecAccountId(acc.id);
                        setRecBankName(acc.bankName);
                        setRecAccountNumber(acc.accountNumber);
                        setRecAccountHolder(acc.accountHolder || '');
                      }
                    }}
                    className={`py-1.5 px-2 rounded-lg font-bold border transition-colors flex items-center justify-center gap-1 ${
                      recPaymentMethodType === 'account'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    <span>은행 계좌</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRecPaymentMethodType('card');
                      if (paymentCards.length > 0 && !recCardId) {
                        const card = paymentCards[0];
                        setRecCardId(card.id);
                        setRecBankName(card.cardCompany);
                        if (card.linkedAccountId) {
                          setRecAccountId(card.linkedAccountId);
                          const linkedAcc = bankAccounts.find(a => a.id === card.linkedAccountId);
                          if (linkedAcc) {
                            setRecAccountNumber(linkedAcc.accountNumber);
                            setRecAccountHolder(linkedAcc.accountHolder || '');
                          }
                        }
                      }
                    }}
                    className={`py-1.5 px-2 rounded-lg font-bold border transition-colors flex items-center justify-center gap-1 ${
                      recPaymentMethodType === 'card'
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>결제 카드</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRecPaymentMethodType('cash');
                      setRecAccountId('');
                      setRecCardId('');
                    }}
                    className={`py-1.5 px-2 rounded-lg font-bold border transition-colors flex items-center justify-center gap-1 ${
                      recPaymentMethodType === 'cash'
                        ? 'bg-slate-800 text-slate-200 border-slate-700 shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <span>직접 입력 / 기타</span>
                  </button>
                </div>

                {/* If 'account' selected */}
                {recPaymentMethodType === 'account' && (
                  <div className="space-y-2">
                    {bankAccounts.length > 0 && (
                      <div>
                        <label className="text-slate-400 block mb-1">등록된 계좌 불러오기</label>
                        <select
                          value={recAccountId}
                          onChange={e => {
                            const accId = e.target.value;
                            setRecAccountId(accId);
                            const found = bankAccounts.find(a => a.id === accId);
                            if (found) {
                              setRecBankName(found.bankName);
                              setRecAccountNumber(found.accountNumber);
                              if (found.accountHolder) setRecAccountHolder(found.accountHolder);
                            }
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 font-semibold"
                        >
                          <option value="">-- 직접 입력 / 등록 계좌 선택 --</option>
                          {bankAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              [{acc.bankName}] {acc.accountName} ({acc.accountNumber}) {acc.accountHolder ? `- ${acc.accountHolder}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-slate-400 block mb-1">은행 선택</label>
                        <select
                          value={recBankName}
                          onChange={e => setRecBankName(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 font-semibold"
                        >
                          {POPULAR_KOREAN_BANKS.map(b => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-slate-400 block mb-1">예금주 / 수령인</label>
                        <input
                          type="text"
                          value={recAccountHolder}
                          onChange={e => setRecAccountHolder(e.target.value)}
                          placeholder="예: 홍길동, 관리사무소"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-slate-400 block mb-1">계좌번호</label>
                      <input
                        type="text"
                        value={recAccountNumber}
                        onChange={e => setRecAccountNumber(e.target.value)}
                        placeholder="예: 110-482-918234 ('-' 구분기호 포함 가능)"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* If 'card' selected */}
                {recPaymentMethodType === 'card' && (
                  <div className="space-y-2">
                    {paymentCards.length > 0 && (
                      <div>
                        <label className="text-slate-400 block mb-1">등록된 카드 불러오기</label>
                        <select
                          value={recCardId}
                          onChange={e => {
                            const cId = e.target.value;
                            setRecCardId(cId);
                            const foundCard = paymentCards.find(c => c.id === cId);
                            if (foundCard) {
                              setRecBankName(foundCard.cardCompany);
                              if (foundCard.linkedAccountId) {
                                setRecAccountId(foundCard.linkedAccountId);
                                const linkedAcc = bankAccounts.find(a => a.id === foundCard.linkedAccountId);
                                if (linkedAcc) {
                                  setRecAccountNumber(linkedAcc.accountNumber);
                                  setRecAccountHolder(linkedAcc.accountHolder || '');
                                }
                              }
                            }
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 font-semibold"
                        >
                          <option value="">-- 등록 카드 선택 --</option>
                          {paymentCards.map(c => {
                            const linkedAcc = bankAccounts.find(a => a.id === c.linkedAccountId);
                            return (
                              <option key={c.id} value={c.id}>
                                {c.cardName} ({c.cardCompany}) {linkedAcc ? `[출금: ${linkedAcc.bankName}]` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-slate-400 block mb-1">카드 회사 / 이름</label>
                        <input
                          type="text"
                          value={recBankName}
                          onChange={e => setRecBankName(e.target.value)}
                          placeholder="예: 신한카드, 현대카드"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="text-slate-400 block mb-1">수령인 / 비고</label>
                        <input
                          type="text"
                          value={recAccountHolder}
                          onChange={e => setRecAccountHolder(e.target.value)}
                          placeholder="예: 자동이체"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* If 'cash' selected */}
                {recPaymentMethodType === 'cash' && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-slate-400 block mb-1">결제수단 / 비고 메모</label>
                      <input
                        type="text"
                        value={recBankName}
                        onChange={e => setRecBankName(e.target.value)}
                        placeholder="예: 현금 지불, 제로페이 등"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-slate-400 block mb-1">반영 방식</label>
                <select
                  value={recPostingMode}
                  onChange={e => setRecPostingMode(e.target.value as 'confirm' | 'auto')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                >
                  <option value="confirm">확인 후 이체 완료 반영 (권장)</option>
                  <option value="auto">자동 출금 및 거래 반영 (통신비 등)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddRecurringOpen(false)}
                  className="bg-slate-800 text-slate-300 px-4 py-2 rounded-lg font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold px-4 py-2 rounded-lg shadow"
                >
                  {editingTemplateId ? '수정 완료' : '저장하기'}
                </button>
              </div>
            </form>
        </>
      </Modal>
    </div>
  );
};
