import type { BankAccount, RecurringOccurrence, Transaction } from '../types';
import { hasConfirmedBalance } from './accountBalances';
import type { MonthSummary } from './calculations';
import type { MonthlyCardSettlementSummary } from './cardPayments';
import { resolveRecurringAmount } from './recurringAmounts';

/**
 * "확인할 일" for the home screen (PRD-ui-renewal §5): at most three things
 * the user should look at now, ordered by how much they distort the numbers
 * on screen. Data-quality items come first because every figure below them
 * is provisional until they are resolved.
 */

export type HomeActionTarget = 'recurring_payment' | 'accounts' | 'history' | 'payday';

export interface HomeAction {
  id: string;
  label: string;
  detail: string;
  target: HomeActionTarget;
  tone: 'warning' | 'info';
}

interface HomeActionInput {
  summary: MonthSummary;
  occurrences: RecurringOccurrence[];
  transactions: Transaction[];
  bankAccounts: BankAccount[];
  cardSettlementSummary: MonthlyCardSettlementSummary;
  /** True while the cycle has started but its living budget was never locked. */
  showPaydayPrompt: boolean;
  today: string;
  limit?: number;
}

export function buildHomeActions({
  summary, occurrences, transactions, bankAccounts, cardSettlementSummary, showPaydayPrompt, today, limit = 3,
}: HomeActionInput): HomeAction[] {
  const actions: HomeAction[] = [];
  const isClosed = summary.spendPeriodStatus === 'closed';

  if (!isClosed && summary.missingAmountCount > 0) {
    actions.push({
      id: 'missing-amounts', target: 'recurring_payment', tone: 'warning',
      label: `금액 입력 필요 ${summary.missingAmountCount}건`,
      detail: '금액이 없는 고정 항목이 있어 사용 가능액을 계산하지 않았습니다.',
    });
  }

  const mismatched = occurrences.filter(occurrence => occurrence.status === 'posted'
    && resolveRecurringAmount(occurrence, transactions).integrityIssue);
  if (mismatched.length > 0) {
    actions.push({
      id: 'integrity', target: 'recurring_payment', tone: 'warning',
      label: `기록 불일치 ${mismatched.length}건`,
      detail: '완료 기록과 연결 거래의 금액이 다릅니다. 어느 값이 맞는지 정해 주세요.',
    });
  }

  if (!isClosed && summary.suggestedAmountCount > 0) {
    actions.push({
      id: 'suggested-amounts', target: 'recurring_payment', tone: 'info',
      label: `전 주기 제안 금액 확인 ${summary.suggestedAmountCount}건`,
      detail: '그대로 확정하거나 달라진 금액만 고치면 예상치가 확정치가 됩니다.',
    });
  }

  const overdue = occurrences.filter(occurrence => (occurrence.status === 'needs_confirmation' || occurrence.status === 'overdue' || occurrence.status === 'scheduled')
    && occurrence.scheduledDate <= today
    && (resolveRecurringAmount(occurrence, transactions).amount ?? 0) > 0);
  if (overdue.length > 0) {
    actions.push({
      id: 'due', target: 'recurring_payment', tone: 'info',
      label: `납부 확인 대기 ${overdue.length}건`,
      detail: '예정일이 지났거나 오늘인 고정지출입니다. 실제로 냈다면 완료 처리하세요.',
    });
  }

  const estimatedCards = cardSettlementSummary.cards.filter(card => card.source === 'estimated' && card.amount > 0);
  if (!isClosed && estimatedCards.length > 0) {
    actions.push({
      id: 'card-estimate', target: 'accounts', tone: 'info',
      label: `카드 청구액 확정 ${estimatedCards.length}장`,
      detail: `${estimatedCards.map(card => card.cardName).join(', ')}의 청구액이 추정치입니다.`,
    });
  }

  if (!isClosed && showPaydayPrompt) {
    actions.push({
      id: 'payday', target: 'payday', tone: 'info',
      label: '이번 주기 생활비 확정',
      detail: '급여 입금과 이체를 확인하고 이번 주기 계획을 비교 기준으로 남깁니다.',
    });
  }

  const unconfirmedAccounts = bankAccounts.filter(account => !hasConfirmedBalance(account));
  if (unconfirmedAccounts.length > 0) {
    actions.push({
      id: 'balances', target: 'accounts', tone: 'info',
      label: `잔액 미입력 · ${unconfirmedAccounts.length}개 계좌`,
      detail: '잔액이 없는 계좌는 합계에서 0원이 아니라 미입력으로 다룹니다.',
    });
  }

  return actions.slice(0, limit);
}
