import type {
  BankAccount,
  Budget,
  Category,
  CycleBaseline,
  MerchantRule,
  PaymentCard,
  QuickEntry,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
  UserProfile,
} from '../types';
import type { BudgetCalculationInput, BudgetSettings, BudgetTransaction } from '../types/budget';
import {
  getAccountingPeriod,
  getCurrentYearMonth,
  getLocalDateString,
  getYearMonthForDate,
} from '../utils/calculations';
import { resolveRecurringAmount } from '../utils/recurringAmounts';
import { getInstallmentCharge } from '../utils/installments';
import type { TransactionEdit } from './history';
import { getDuplicateManualCardSettlementTemplateIds } from '../utils/cardSettlementPlans';

export interface BudgetAccountData {
  merchantRules?: MerchantRule[];
  transactions: Transaction[];
  templates: RecurringTemplate[];
  occurrences: RecurringOccurrence[];
  profile: UserProfile;
  budget: Budget;
  categories: Category[];
  historyFloor: string;
  /** Locked living budget of the viewed cycle; stands in when no limit was typed. */
  cycleBaseline?: CycleBaseline | null;
  paymentCards?: PaymentCard[];
  bankAccounts?: BankAccount[];
  quickEntries?: QuickEntry[];
}

/** Manual "카드대금" templates the generated card bill already covers (counted once, as the classic view does). */
export function replacedCardSettlementTemplateIds(data: BudgetAccountData) {
  return getDuplicateManualCardSettlementTemplateIds(
    data.templates.filter((t) => !t.archivedAt),
    data.paymentCards || [],
    { bankAccounts: data.bankAccounts || [] },
  );
}

/** The typed limit wins; otherwise the cycle's locked living budget is used so the view never starts at 0원. */
export function effectiveVariableLimit(data: BudgetAccountData, periodKey: string) {
  if (data.budget.totalLimit > 0) return data.budget.totalLimit;
  const baseline = data.cycleBaseline;
  return baseline && baseline.yearMonth === periodKey && baseline.livingBudget > 0
    ? Math.floor(baseline.livingBudget)
    : 0;
}

/** True when there is neither a typed limit nor a living budget to fall back on. */
export function needsLimitSetup(data: BudgetAccountData, periodKey: string) {
  return effectiveVariableLimit(data, periodKey) === 0;
}

/**
 * `selectedKey` views another cycle. A finished cycle is evaluated as of its last
 * day, so its result and daily chart show the final outcome instead of "today".
 */
export function toBudgetInput(
  data: BudgetAccountData,
  now = new Date(),
  selectedKey?: string,
): BudgetCalculationInput {
  const day = Math.min(28, Math.max(1, data.profile.monthStartDay || 1));
  const key = selectedKey || getCurrentYearMonth(day, now);
  const period = getAccountingPeriod(key, day, now);
  const realToday = getLocalDateString(now);
  const today = realToday > period.endDate ? period.endDate : realToday;
  const replaced = replacedCardSettlementTemplateIds(data);
  const templateMap = new Map(data.templates.map((t) => [t.id, t]));
  const occurrenceMap = new Map(data.occurrences.map((o) => [o.occurrenceKey, o]));
  const nature = (template?: RecurringTemplate) =>
    template && template.expenseNature !== 'variable_estimate' ? ('fixed' as const) : ('variable' as const);
  const keyFor = (date: string) => getYearMonthForDate(date, day);
  const historyFloor =
    /^\d{4}-\d{2}-\d{2}$/.test(data.historyFloor) && data.historyFloor <= today ? data.historyFloor : today;
  const accountStart = data.profile.createdAt.slice(0, 10);
  const observationStartDate = data.transactions.some((t) => t.localDate < accountStart)
    ? historyFloor
    : [historyFloor, accountStart]
        .filter((date) => date <= today)
        .sort()
        .at(-1) || today;
  return {
    today,
    observationStartDate,
    period: { key, start: period.startDate, end: period.endDate },
    settings: {
      monthStartDay: day,
      variableExpenseLimit: effectiveVariableLimit(data, key),
      categoryAmountLimits: data.budget.categoryAmountLimits || data.profile.categoryAmountLimits || {},
      categoryCountLimits: data.budget.categoryCountLimits || data.profile.categoryCountLimits || {},
    },
    transactions: data.transactions
      .filter(
        (t) =>
          (!t.role || t.role === 'normal') &&
          !templateMap.get(t.recurringTemplateId)?.cardSettlementCardId &&
          !(t.recurringTemplateId && replaced.has(t.recurringTemplateId)),
      )
      .flatMap<BudgetTransaction>((t) => {
        if (t.installment && t.type === 'expense') {
          const charge = getInstallmentCharge(t.amount, t.installment, key);
          return charge
            ? [
                {
                  id: `${t.id}_${key}`,
                  localDate: period.startDate,
                  budgetPeriodKey: key,
                  type: t.type,
                  amount: charge.amount,
                  expenseNature: 'variable' as const,
                  isOneOff: true,
                  merchant: t.merchant,
                  memo: '이번 주기 할부금',
                },
              ]
            : [];
        }
        const occurrence = occurrenceMap.get(t.recurringOccurrenceKey);
        return [
          {
            id: t.id,
            localDate: t.localDate,
            budgetPeriodKey:
              t.budgetPeriodKey || occurrence?.budgetPeriodKey || keyFor(occurrence?.scheduledDate || t.localDate),
            type: t.type,
            amount: t.amount,
            expenseNature: t.expenseNature || nature(templateMap.get(t.recurringTemplateId)),
            isOneOff: t.isOneOff === true,
            categoryId: t.categoryId,
            merchant: templateMap.get(t.recurringTemplateId)?.name || t.merchant,
            memo: t.memo,
          },
        ];
      }),
    templates: data.templates
      .filter((t) => !t.archivedAt && !t.cardSettlementCardId && !replaced.has(t.id))
      .map((t) => ({ id: t.id, active: t.active, type: t.type, expenseNature: nature(t), amount: t.defaultAmount })),
    occurrences: data.occurrences
      .filter((o) => {
        const template = templateMap.get(o.templateId);
        return (
          template &&
          !template.cardSettlementCardId &&
          !replaced.has(template.id) &&
          (o.status === 'posted' || (template.active && !template.archivedAt))
        );
      })
      .map((o) => {
        const template = templateMap.get(o.templateId)!;
        return {
          id: o.id,
          templateId: o.templateId,
          localDate: o.scheduledDate,
          budgetPeriodKey: o.budgetPeriodKey || keyFor(o.scheduledDate),
          type: o.typeSnapshot || template.type,
          expenseNature: nature(template),
          amount: resolveRecurringAmount(o, data.transactions).amount ?? 0,
          status: o.status === 'posted' ? 'posted' : o.status === 'skipped' ? 'skipped' : 'pending',
        };
      }),
  };
}

export function transactionForStorage(
  transaction: BudgetTransaction,
): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    type: transaction.type,
    amount: Math.floor(transaction.amount),
    localDate: transaction.localDate,
    occurredAt: `${transaction.localDate}T03:00:00.000Z`,
    categoryId: transaction.categoryId,
    merchant: transaction.merchant || '',
    memo: transaction.memo || '',
    source: transaction.source || 'manual',
    ...(transaction.source === 'ai'
      ? { aiConfidence: transaction.aiConfidence, aiReviewed: transaction.aiReviewed === true }
      : {}),
    role: 'normal',
    ...(transaction.paymentMethodType
      ? {
          paymentMethodType: transaction.paymentMethodType,
          cardId: transaction.cardId ?? null,
          accountId: transaction.accountId ?? null,
        }
      : {}),
    budgetPeriodKey: transaction.budgetPeriodKey,
    expenseNature: transaction.expenseNature,
    isOneOff: transaction.isOneOff,
  };
}

export function budgetWithSettings(budget: Budget, settings: BudgetSettings): Budget {
  return {
    ...budget,
    totalLimit: Math.floor(settings.variableExpenseLimit),
    categoryAmountLimits: settings.categoryAmountLimits || {},
    categoryCountLimits: settings.categoryCountLimits || {},
  };
}

export function shouldOnboard(data: BudgetAccountData) {
  return (
    !data.profile.onboardingCompletedAt &&
    data.transactions.length === 0 &&
    (data.templates.length > 0 ? data.templates.every((t) => Boolean(t.budgetSetupRole)) : data.budget.totalLimit === 0)
  );
}

export function autoPostingCandidates(data: BudgetAccountData, today: string) {
  const input = toBudgetInput(data, new Date(`${today}T12:00:00`));
  const replaced = replacedCardSettlementTemplateIds(data);
  return data.occurrences.flatMap((o) => {
    const t = data.templates.find((template) => template.id === o.templateId);
    if (
      !t?.active ||
      t.archivedAt ||
      !t.budgetAutoPostingEnabled ||
      t.postingMode !== 'auto' ||
      t.allowAmountChange ||
      t.cardSettlementCardId ||
      replaced.has(t.id) ||
      o.projected ||
      o.status === 'posted' ||
      o.status === 'skipped' ||
      o.scheduledDate > today ||
      o.scheduledDate < t.startDate ||
      o.scheduledDate < (t.budgetAutoPostingStartDate || t.startDate) ||
      (o.budgetPeriodKey || getYearMonthForDate(o.scheduledDate, input.settings.monthStartDay)) !== input.period.key
    )
      return [];
    const resolved = resolveRecurringAmount(o, data.transactions);
    if (
      resolved.integrityIssue ||
      data.transactions.some(
        (tx) =>
          tx.recurringOccurrenceKey === o.occurrenceKey ||
          tx.id === `tx_recurring_${o.occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      )
    )
      return [];
    const amount = resolved.status === 'confirmed' ? resolved.amount : t.defaultAmount;
    return Number.isSafeInteger(amount) && amount > 0 ? [{ id: o.id, amount }] : [];
  });
}

/**
 * Only what the user actually changed. Amount and date are protected fields, so an
 * untouched edit must not look like a protected change to the revision protocol.
 */
export function buildTransactionUpdates(
  existing: Transaction,
  edit: TransactionEdit,
  monthStartDay: number,
): Partial<Transaction> {
  const updates: Partial<Transaction> = {};
  if (edit.merchant !== existing.merchant) updates.merchant = edit.merchant;
  if (edit.memo !== (existing.memo || '')) updates.memo = edit.memo;
  if (edit.amount !== existing.amount) updates.amount = edit.amount;
  if (edit.localDate !== existing.localDate) {
    updates.localDate = edit.localDate;
    updates.occurredAt = new Date(`${edit.localDate}T12:00:00`).toISOString();
    // A bill paid for another cycle keeps the cycle its plan assigned.
    if (!existing.recurringOccurrenceKey) updates.budgetPeriodKey = getYearMonthForDate(edit.localDate, monthStartDay);
  }
  if (existing.type === 'expense') {
    if (edit.categoryId && edit.categoryId !== existing.categoryId) updates.categoryId = edit.categoryId;
    if (existing.expenseNature !== 'fixed' && edit.isOneOff !== (existing.isOneOff === true)) updates.isOneOff = edit.isOneOff;
  }
  return updates;
}
