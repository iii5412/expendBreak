import { BankAccount, RecurringOccurrence, Transaction } from '../types';
import { getCurrentYearMonth } from './calculations';
import { resolveRecurringAmount } from './recurringAmounts';

export function findDuplicateTransactionGroups(transactions: Transaction[]): Transaction[][] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.recurringTemplateId || (tx.role ?? 'normal') !== 'normal' || !tx.merchant.trim()) continue;
    const key = JSON.stringify([tx.type, tx.localDate, tx.amount, tx.merchant.trim().toLowerCase(), tx.paymentMethodType, tx.cardId, tx.accountId]);
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

export function findDuplicateAccountGroups(accounts: BankAccount[]): BankAccount[][] {
  const groups = new Map<string, BankAccount[]>();
  for (const account of accounts) {
    const number = (account.accountNumber ?? '').replace(/[^0-9]/g, '');
    const key = `${account.bankName}|${number || account.accountName.trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

export function retainedPlanSummary(occurrences: RecurringOccurrence[], monthStartDay: number, templateId?: string) {
  const rows = occurrences.filter(row => (!templateId || row.templateId === templateId) && row.status !== 'posted' && row.status !== 'skipped');
  const months = [...new Set(rows.map(row => getCurrentYearMonth(monthStartDay, new Date(`${row.scheduledDate}T12:00:00`))))].sort();
  return { count: rows.length, months, amount: rows.reduce((sum, row) => sum + (resolveRecurringAmount(row).amount ?? 0), 0) };
}
