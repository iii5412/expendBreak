import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BankAccount, RecurringOccurrence, RecurringTemplate } from '../types';
import type { AccountingPeriod, MonthSummary } from '../utils/calculations';
import { FeedbackProvider } from './ui/FeedbackProvider';
import { matchesPaymentStatus, RecurringPaymentView } from './RecurringPaymentView';

describe('RecurringPaymentView', () => {
  it('shows one collapsed account row with its fixed cost and card bill combined', () => {
    const account: BankAccount = {
      id: 'account-1', bankName: '신한', accountName: '납부 통장', accountNumber: '123-456',
      accountHolder: '홍길동', balance: 0, createdAt: '', updatedAt: '',
    };
    const template: RecurringTemplate = {
      id: 'rent', type: 'expense', name: '월세', defaultAmount: 500_000, categoryId: 'housing',
      counterparty: '임대인', frequency: 'monthly', dayOfMonth: 10, holidayPolicy: 'fixed_date',
      postingMode: 'confirm', allowAmountChange: true, paymentMethodType: 'account', accountId: account.id,
      startDate: '2026-01-01', nextDueDate: '2026-09-10', active: true, createdAt: '', updatedAt: '',
    };
    const occurrence: RecurringOccurrence = {
      id: 'rent-09', templateId: 'rent', occurrenceKey: 'rent-2026-09', scheduledDate: '2026-09-10',
      expectedAmount: 500_000, status: 'scheduled', paymentMethodType: 'account', accountId: account.id,
      typeSnapshot: 'expense', createdAt: '', updatedAt: '',
    };
    const markup = renderToStaticMarkup(
      <FeedbackProvider>
        <RecurringPaymentView
          period={{ yearMonth: '2026-09', startDate: '2026-09-10', endDate: '2026-10-09' } as AccountingPeriod}
          summary={{ cardFixedExpenses: 0 } as MonthSummary}
          recurringOccurrences={[occurrence]}
          recurringTemplates={[template]}
          categories={[]}
          bankAccounts={[account]}
          paymentCards={[]}
          cardSettlementSummary={{
            yearMonth: '2026-09', totalAmount: 300_000, linkedAccountTotal: 300_000, unlinkedAmount: 0,
            cards: [{
              cardId: 'card-1', cardName: '생활 카드', cardCompany: '신한카드', linkedAccountId: account.id,
              paymentDate: '2026-09-15', usageYearMonth: '2026-08', usageStartDate: '2026-08-01',
              usageEndDate: '2026-08-31', hasStatementWindow: true, amount: 300_000,
              estimatedAmount: 300_000, source: 'confirmed', status: 'scheduled',
            }],
          }}
          hiddenExpenseItems={[]}
          initialView="accounts"
          onCreateOccurrence={() => undefined}
          onReloadRecurringPlan={async () => undefined}
          duplicateManualCardSettlementCount={0}
          cardSettlementReviewItems={[]}
          onResolveCardSettlementReview={() => undefined}
          onUpdateCardSettlementStatus={() => true}
          onSaveCardSettlementAmount={() => undefined}
          onPostOccurrence={() => true}
          onUndoPostedOccurrence={() => undefined}
          onUndoOccurrenceDirect={() => true}
          onExcludeOccurrence={() => undefined}
          onUpdateOccurrencePlan={() => undefined}
        />
      </FeedbackProvider>,
    );

    expect(markup).toContain('이번 주기 총 지출예정액');
    expect(markup).toContain('800,000원');
    expect(markup).toContain('납부 통장 · 신한');
    expect(markup).toContain('고정지출 1건 · 카드대금 1건');
    const accountSectionStart = markup.indexOf('<section class="space-y-3"');
    const accountSection = markup.slice(accountSectionStart, markup.indexOf('</section>', accountSectionStart));
    expect(accountSection).toContain('aria-expanded="false"');
    expect(accountSection).not.toContain('생활 카드 카드대금');
    expect(accountSection).not.toContain('월세</span>');
  });
  it('filters items by payment status and shows the counts on the chips', () => {
    const base = {
      expectedAmount: 10_000, paymentMethodType: 'cash', typeSnapshot: 'expense', createdAt: '', updatedAt: '',
    } as const;
    const make = (id: string, status: RecurringOccurrence['status']): RecurringOccurrence => ({
      ...base, id, templateId: id, occurrenceKey: id, scheduledDate: '2026-09-10', status,
    });
    const rows = [make('a', 'scheduled'), make('b', 'posted'), make('c', 'posted'), make('d', 'scheduled'), make('e', 'scheduled')];
    expect(rows.filter(row => matchesPaymentStatus(row, 'all')).length).toBe(5);
    expect(rows.filter(row => matchesPaymentStatus(row, 'pending')).map(row => row.id)).toEqual(['a', 'd', 'e']);
    expect(rows.filter(row => matchesPaymentStatus(row, 'posted')).map(row => row.id)).toEqual(['b', 'c']);

    const templates = rows.map(row => ({
      id: row.templateId, type: 'expense', name: `항목${row.id}`, defaultAmount: 10_000, categoryId: 'x', frequency: 'monthly',
      dayOfMonth: 10, holidayPolicy: 'fixed_date', postingMode: 'confirm', allowAmountChange: true, paymentMethodType: 'cash',
      startDate: '2026-01-01', nextDueDate: '2026-09-10', active: true, createdAt: '', updatedAt: '',
    })) as unknown as RecurringTemplate[];
    const markup = renderToStaticMarkup(
      <FeedbackProvider>
        <RecurringPaymentView
          period={{ yearMonth: '2026-09', startDate: '2026-09-10', endDate: '2026-10-09' } as AccountingPeriod}
          summary={{ cardFixedExpenses: 0 } as MonthSummary}
          recurringOccurrences={rows}
          recurringTemplates={templates}
          categories={[]}
          bankAccounts={[]}
          paymentCards={[]}
          cardSettlementSummary={{ yearMonth: '2026-09', totalAmount: 0, linkedAccountTotal: 0, unlinkedAmount: 0, cards: [] }}
          hiddenExpenseItems={[]}
          initialView="items"
          onCreateOccurrence={() => undefined}
          onReloadRecurringPlan={async () => undefined}
          duplicateManualCardSettlementCount={0}
          cardSettlementReviewItems={[]}
          onResolveCardSettlementReview={() => undefined}
          onUpdateCardSettlementStatus={() => true}
          onSaveCardSettlementAmount={() => undefined}
          onPostOccurrence={() => true}
          onUndoPostedOccurrence={() => undefined}
          onUndoOccurrenceDirect={() => true}
          onExcludeOccurrence={() => undefined}
          onUpdateOccurrencePlan={() => undefined}
        />
      </FeedbackProvider>,
    );
    expect(markup).toContain('전체 5');
    expect(markup).toContain('미납 3');
    expect(markup).toContain('납부 완료 2');
  });
});
