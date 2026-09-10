import type {
  BankAccount,
  RecurringOccurrence,
  RecurringTemplate,
} from '../types';
import type { MonthlyCardSettlement } from './cardPayments';

export type PaydayTransferItem = {
  id: string;
  kind: 'recurring' | 'card_settlement';
  referenceId: string;
  label: string;
  amount: number;
  dueDate: string | null;
  accountId: string | null;
  completed: boolean;
  selectable: boolean;
  detail: string;
};

export type PaydayTransferGroup = {
  key: string;
  accountId: string | null;
  label: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  items: PaydayTransferItem[];
  /** Whole-cycle amount. It stays stable after an item is paid. */
  totalAmount: number;
  /** Amount that still needs to be paid for this account. */
  pendingAmount: number;
};

interface BuildPaydayTransferGroupsInput {
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  bankAccounts: BankAccount[];
  cardSettlements: MonthlyCardSettlement[];
}

/**
 * Builds the account-funding checklist used on payday. Card-paid fixed costs are
 * intentionally absent here because their amount is already included in the
 * card settlement for the linked withdrawal account.
 */
export function buildPaydayTransferGroups({
  recurringOccurrences,
  recurringTemplates,
  bankAccounts,
  cardSettlements,
}: BuildPaydayTransferGroupsInput): PaydayTransferGroup[] {
  const templateMap = new Map(recurringTemplates.map(template => [template.id, template]));
  const accountMap = new Map(bankAccounts.map(account => [account.id, account]));
  const groups = new Map<string, PaydayTransferGroup>();

  const groupFor = (
    accountId: string | null,
    fallback: { bankName?: string; accountNumber?: string; accountHolder?: string } = {},
  ) => {
    const account = accountId ? accountMap.get(accountId) : undefined;
    const bankName = account?.bankName || fallback.bankName || '계좌 미지정';
    const accountNumber = account?.accountNumber || fallback.accountNumber || '';
    const accountHolder = account?.accountHolder || fallback.accountHolder || '';
    const label = account
      ? `${account.accountName} · ${account.bankName}`
      : bankName;
    const key = account
      ? `account:${account.id}`
      : `manual:${bankName}___${accountNumber}___${accountHolder}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const created: PaydayTransferGroup = {
      key,
      accountId: account?.id || null,
      label,
      bankName,
      accountNumber,
      accountHolder,
      items: [],
      totalAmount: 0,
      pendingAmount: 0,
    };
    groups.set(key, created);
    return created;
  };

  recurringOccurrences
    .filter(occurrence => occurrence.status !== 'skipped')
    .forEach(occurrence => {
      const template = templateMap.get(occurrence.templateId);
      const type = occurrence.typeSnapshot ?? template?.type ?? 'expense';
      const method = occurrence.paymentMethodType ?? template?.paymentMethodType;
      if (type !== 'expense' || method === 'card') return;

      const amount = Math.max(0, Math.round(occurrence.actualAmount ?? occurrence.expectedAmount));
      const accountId = occurrence.accountId || template?.accountId || null;
      const group = groupFor(accountId, {
        bankName: template?.bankName,
        accountNumber: template?.accountNumber,
        accountHolder: template?.accountHolder || template?.counterparty,
      });
      const completed = occurrence.status === 'posted';
      const hasTransferAccount = Boolean(group.accountId || group.accountNumber);
      const item: PaydayTransferItem = {
        id: `recurring:${occurrence.id}`,
        kind: 'recurring',
        referenceId: occurrence.id,
        label: template?.name || '고정지출',
        amount,
        dueDate: occurrence.scheduledDate,
        accountId,
        completed,
        selectable: !completed && amount > 0 && hasTransferAccount,
        detail: '계좌 고정지출',
      };
      group.items.push(item);
      group.totalAmount += amount;
      if (!completed) group.pendingAmount += amount;
    });

  cardSettlements.forEach(card => {
    const amount = Math.max(0, Math.round(card.amount));
    const group = groupFor(card.linkedAccountId);
    const completed = card.status === 'paid';
    const item: PaydayTransferItem = {
      id: `card:${card.cardId}`,
      kind: 'card_settlement',
      referenceId: card.cardId,
      label: `${card.cardName} 카드대금`,
      amount,
      dueDate: card.paymentDate,
      accountId: card.linkedAccountId,
      completed,
      selectable: !completed && amount > 0 && Boolean(card.linkedAccountId),
      detail: card.source === 'confirmed' ? '확정 카드대금' : '추정 카드대금',
    };
    group.items.push(item);
    group.totalAmount += amount;
    if (!completed) group.pendingAmount += amount;
  });

  return [...groups.values()]
    .map(group => ({
      ...group,
      items: group.items.sort((left, right) =>
        Number(left.completed) - Number(right.completed)
        || (left.dueDate || '').localeCompare(right.dueDate || '')
        || right.amount - left.amount),
    }))
    .sort((left, right) => right.pendingAmount - left.pendingAmount || left.label.localeCompare(right.label));
}
