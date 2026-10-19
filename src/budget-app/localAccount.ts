import type { BudgetAccountData } from './adapter';
import type { TemplateInput } from './RecurringManager';
import type { BudgetSetup } from './SetupDialog';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  INITIAL_USER_PROFILE,
  getSampleBudget,
} from '../data/initialData';
import {
  getAccountingPeriod,
  getCurrentYearMonth,
  getLocalDateString,
  getScheduledDatesInPeriod,
} from '../utils/calculations';
import { buildPostOperation } from '../utils/amountOperations';
import type { Transaction } from '../types';

export function emptyLocalAccount(now = new Date()): BudgetAccountData {
  const today = getLocalDateString(now);
  return {
    profile: { ...INITIAL_USER_PROFILE, uid: 'local-budget-preview', monthStartDay: 1, createdAt: now.toISOString() },
    budget: getSampleBudget(getCurrentYearMonth(1, now)),
    categories: [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES],
    templates: [],
    occurrences: [],
    transactions: [],
    merchantRules: [],
    historyFloor: today,
  };
}

export function ensureLocalOccurrences(data: BudgetAccountData, now = new Date()): BudgetAccountData {
  const key = getCurrentYearMonth(data.profile.monthStartDay, now);
  const period = getAccountingPeriod(key, data.profile.monthStartDay, now);
  const occurrences = [...data.occurrences];
  for (const template of data.templates.filter((t) => t.active && !t.archivedAt)) {
    if (occurrences.some((o) => o.templateId === template.id && o.budgetPeriodKey === key)) continue;
    for (const date of getScheduledDatesInPeriod(template, period)) {
      const occurrenceKey = `${template.id}_${date}`;
      if (occurrences.some((o) => o.occurrenceKey === occurrenceKey)) continue;
      occurrences.push({
        id: `occ_${occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        occurrenceKey,
        templateId: template.id,
        scheduledDate: date,
        budgetPeriodKey: key,
        expectedAmount: template.defaultAmount,
        plannedAmount: template.defaultAmount,
        amountStatus: 'suggested',
        amountSource: 'legacy_template',
        status: template.postingMode === 'auto' ? 'scheduled' : 'needs_confirmation',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
  }
  return { ...data, occurrences, budget: { ...data.budget, yearMonth: key } };
}

export function putLocalTemplate(
  data: BudgetAccountData,
  template: TemplateInput,
  id: string = crypto.randomUUID(),
  now = new Date(),
) {
  const previous = data.templates.find((t) => t.id === id);
  const saved = { ...template, id, createdAt: previous?.createdAt || now.toISOString(), updatedAt: now.toISOString() };
  return ensureLocalOccurrences({ ...data, templates: [...data.templates.filter((t) => t.id !== id), saved] }, now);
}

export function postLocalOccurrence(
  data: BudgetAccountData,
  id: string,
  amount: number,
  now = new Date(),
): BudgetAccountData {
  const target = data.occurrences.find((o) => o.id === id);
  const template = data.templates.find((t) => t.id === target?.templateId);
  if (!target || !template || !Number.isSafeInteger(amount) || amount < 1)
    throw new Error('항목과 금액을 확인해 주세요.');
  const transactionId = `tx_recurring_${target.occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  if (
    target.status === 'posted' ||
    target.status === 'skipped' ||
    data.transactions.some((t) => t.id === transactionId)
  )
    return data;
  const date = target.scheduledDate > getLocalDateString(now) ? getLocalDateString(now) : target.scheduledDate;
  const transaction: Transaction = {
    id: transactionId,
    type: template.type,
    amount,
    categoryId: template.categoryId,
    merchant: template.counterparty || template.name,
    memo: `[정기] ${template.name}`,
    occurredAt: `${date}T03:00:00.000Z`,
    localDate: date,
    source: 'manual',
    recurringTemplateId: template.id,
    recurringOccurrenceKey: target.occurrenceKey,
    budgetPeriodKey: target.budgetPeriodKey,
    expenseNature: template.expenseNature === 'variable_estimate' ? 'variable' : 'fixed',
    isOneOff: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const operation = buildPostOperation(target, transaction, now.toISOString());
  return {
    ...data,
    occurrences: data.occurrences.map((o) => (o.id === id ? operation.occurrence : o)),
    transactions: [...data.transactions, operation.transaction],
  };
}

export function setupLocalAccount(data: BudgetAccountData, setup: BudgetSetup, now = new Date()) {
  const today = getLocalDateString(now);
  let next = {
    ...data,
    profile: { ...data.profile, monthStartDay: setup.salaryDay, onboardingCompletedAt: now.toISOString() },
    budget: { ...data.budget, totalLimit: setup.limit, categoryCountLimits: { delivery_food: setup.deliveryCount } },
  };
  const base: TemplateInput = {
    name: '월급',
    type: 'income',
    categoryId: 'salary',
    counterparty: '월급',
    defaultAmount: setup.salary,
    frequency: 'monthly',
    dayOfMonth: setup.salaryDay,
    holidayPolicy: 'previous_business_day',
    postingMode: 'confirm',
    allowAmountChange: false,
    startDate: today,
    nextDueDate: today,
    active: true,
    budgetSetupRole: 'salary',
  };
  if (!next.templates.some((t) => t.budgetSetupRole === 'salary'))
    next = putLocalTemplate(next, base, 'local-setup-salary', now) as typeof next;
  if (setup.fixed > 0 && !next.templates.some((t) => t.budgetSetupRole === 'fixed'))
    next = putLocalTemplate(
      next,
      {
        ...base,
        name: '배우자 생활비·주거비',
        counterparty: '월 고정비',
        type: 'expense',
        categoryId: 'housing_utilities',
        expenseNature: 'fixed',
        defaultAmount: setup.fixed,
        dayOfMonth: setup.fixedDay,
        holidayPolicy: 'fixed_date',
        budgetSetupRole: 'fixed',
      },
      'local-setup-fixed',
      now,
    ) as typeof next;
  return next;
}
