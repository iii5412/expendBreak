import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { collectAccountUsage } from './accountUsage';
import { AccountUsageModal } from '../components/AccountUsageModal';
import type { BankAccount, PaymentCard, QuickEntry, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';

const account: BankAccount = { id: 'duplicate', bankName: '은행', accountName: '생활비', accountNumber: 'private-account-number', accountHolder: '', balance: 0, createdAt: '', updatedAt: '' };
const transaction: Transaction = { id: 'tx', accountId: account.id, localDate: '2025-01-02', amount: 12000, merchant: '오래된 식당', type: 'expense', categoryId: '', memo: '', source: 'manual', occurredAt: '', createdAt: '', updatedAt: '' };
const template: RecurringTemplate = { id: 'template', name: '보관된 월세', accountId: account.id, type: 'expense', categoryId: '', counterparty: '', defaultAmount: 300000, frequency: 'monthly', dayOfMonth: 10, holidayPolicy: 'fixed_date', postingMode: 'confirm', allowAmountChange: true, active: false, archivedAt: '2026-01-01', startDate: '2025-01-01', nextDueDate: '2026-01-10', createdAt: '', updatedAt: '' };
const occurrence: RecurringOccurrence = { id: 'occ', templateId: template.id, accountId: account.id, occurrenceKey: 'occ', scheduledDate: '2026-01-10', expectedAmount: 300000, actualAmount: 0, status: 'posted', createdAt: '', updatedAt: '' };
const card: PaymentCard = { id: 'card', cardName: '생활카드', cardCompany: '카드사', cardType: 'credit', linkedAccountId: account.id, createdAt: '', updatedAt: '' };
const quick: QuickEntry = { id: 'quick', label: '점심 퀵등록', type: 'expense', amount: null, categoryId: '', merchant: '', memo: '', paymentMethodType: 'account', accountId: account.id, sortOrder: 0, useCount: 0, createdAt: '', updatedAt: '' };
const data = { transactions: [transaction], recurringTemplates: [template], recurringOccurrences: [occurrence], paymentCards: [card], quickEntries: [quick] };

describe('account deletion usage', () => {
  it('lists all direct references, including old transactions, archived masters, completed plans and quick entries', () => {
    const usage = collectAccountUsage(account.id, data);
    expect(usage.total).toBe(5);
    expect(usage.groups.map(group => [group.kind, group.items.length])).toEqual([['cards',1],['templates',1],['occurrences',1],['transactions',1],['quickEntries',1]]);
    expect(usage.groups[1].items[0]).toMatchObject({ name: '보관된 월세', status: '삭제된 원본' });
    expect(usage.groups[2].items[0]).toMatchObject({ date: '2026-01-10', amount: 0, status: '완료' });
    expect(usage.groups[3].items[0]).toMatchObject({ name: '오래된 식당', date: '2025-01-02', amount: 12000 });
  });
  it('matches IDs rather than duplicate names and becomes empty when references change', () => {
    expect(collectAccountUsage('other-account-with-same-name', data)).toEqual({ total: 0, groups: [] });
    expect(collectAccountUsage(account.id, { paymentCards: [], recurringTemplates: [], recurringOccurrences: [], transactions: [], quickEntries: [] })).toEqual({ total: 0, groups: [] });
  });
  it('retains orphaned and skipped plans and sorts transactions newest first without mutating inputs', () => {
    const usage = collectAccountUsage(account.id, { ...data, recurringTemplates: [], recurringOccurrences: [{ ...occurrence, status: 'skipped' }], transactions: [transaction, { ...transaction, id: 'new', localDate: '2026-09-09', role: 'transfer' }] });
    expect(usage.groups.find(group => group.kind === 'occurrences')?.items[0]).toMatchObject({ name: '원본을 찾을 수 없는 정기 일정', status: '건너뜀' });
    expect(usage.groups.find(group => group.kind === 'transactions')?.items.map(item => item.id)).toEqual(['new', 'tx']);
    expect(data.transactions[0].id).toBe('tx');
  });
  it('renders actionable details without exposing the full account number', () => {
    const html = renderToStaticMarkup(<AccountUsageModal account={account} usage={collectAccountUsage(account.id, data)} accounts={[account, { ...account, id: "target", accountName: "남길 계좌" }]} onMerge={async () => {}} onClose={() => {}} />);
    for (const text of ['현재 확인된 연결 5건', '생활카드', '보관된 월세', '2025-01-02', '12,000', '삭제된 원본', '점심 퀵등록', '금액 직접 입력', '연결 일괄 변경 후 중복 계좌 삭제', '닫기']) expect(html).toContain(text);
    expect(html).not.toContain('private-account-number');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('두 계좌의 잔액을 합산하지 않습니다');
    expect(html).toContain('남길 계좌를 선택하세요');
    expect(html).not.toContain('value="duplicate"');
    expect(html).toContain('value="target"');
  });
});
