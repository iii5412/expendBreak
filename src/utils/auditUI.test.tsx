import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardView } from '../components/DashboardView';
import { HistoryView } from '../components/HistoryView';
import { FeedbackProvider } from '../components/ui/FeedbackProvider';
import { calculateMonthSummary, getAccountingPeriod } from './calculations';
import { calculateCardPaymentSummary, calculateMonthlyCardSettlementSummary } from './cardPayments';
import type { Transaction } from '../types';
const now = new Date('2026-09-07T14:13:00+09:00');
const tx: Transaction = { id: 'tx', type: 'expense', amount: 447660, localDate: '2026-09-07', occurredAt: '', categoryId: 'etc', merchant: '테스트상점', memo: '', source: 'manual', createdAt: '', updatedAt: '' };
const budget = { yearMonth: '2026-09', totalLimit: 1800000, thresholds: [.7,.85,1], createdAt: '', updatedAt: '' };
const noop = () => {};
function dashboard(month: string, calculationDate = now) {
 const summary = calculateMonthSummary(month, [tx], [], budget, [], calculationDate, 10);
 return renderToStaticMarkup(<DashboardView summary={summary} upcomingOccurrences={[]} recurringTemplates={[]} categories={[]} categoryBreakdown={[]} cardPaymentSummary={calculateCardPaymentSummary(month, [], [], 10)} cardSettlementSummary={calculateMonthlyCardSettlementSummary(month, [], [], 10)} bankAccounts={[]} paymentCards={[]} onOpenAddModal={noop} onNavigateTab={noop} onConfirmOccurrence={noop} showSetupPrompt={false} onStartSetup={noop} showPaydayPrompt={false} onStartPayday={noop} onRefreshBaseline={noop} onDismissBaselineChange={noop} baselineChangeDismissed={false} />);
}
describe('audit UI rendering', () => {
 it('renders no-capacity and the configured cap separately', () => {
  const html=dashboard('2026-08');
  expect(html).toContain('가용 재원 없음');
  expect(html).toContain('24.9');
  expect(html).not.toContain('999%');
  expect(html).toContain('생활비 사용 내역 보기');
 });
 it('renders closed-month results without a remaining-day forecast', () => {
  const html=dashboard('2026-08', new Date(2026, 8, 10));
  expect(html).toContain('마감');
  expect(html).not.toContain('남은 1일');
  expect(html).not.toContain('지금 속도면');
 });
 it('opens history on the payday cycle including the next calendar month', () => {
  const html=renderToStaticMarkup(<FeedbackProvider><HistoryView transactions={[tx]} categories={[]} bankAccounts={[]} paymentCards={[]} period={getAccountingPeriod('2026-08',10,now)} initialView="spending" onDeleteTransaction={noop} onUpdateTransaction={noop}/></FeedbackProvider>);
  expect(html).toContain('테스트상점');
  expect(html).toContain('447,660');
  expect(html).toContain('소비 지출');
 });
});
