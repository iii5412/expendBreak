import { PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { getAccountingPeriod, getScheduledDatesInPeriod, isDateInPeriod, isSpendingTransaction, shiftYearMonth } from './calculations';
import { calculateMonthlyCardSettlementSummary } from './cardPayments';
import { getInstallmentCharge } from './installments';
import { resolveRecurringAmount } from './recurringAmounts';
import { getRecurringAmountSuggestion } from './recurringPlans';

/**
 * Money already committed for cycles that have not started yet.
 *
 * Answers "how much of next month is already spoken for", and in particular when
 * an installment ends and that amount comes back. Only obligations that exist
 * today are projected — no spending forecast.
 */

export interface FutureCommitmentMonth {
  yearMonth: string;
  /** Recurring expenses transferred from an account, excluding card settlements. */
  accountFixed: number;
  /** Installment rounds due, excluded from `cardSettlement` to be shown separately. */
  installments: number;
  /** Card bills due, net of the installment rounds inside them. */
  cardSettlement: number;
  total: number;
  /**
   * True when part of `accountFixed` rests on a suggestion (a copied previous
   * cycle amount or an ungenerated cycle) rather than a confirmed figure.
   */
  isEstimated: boolean;
  /** Fixed items with no amount evidence at all; left out of `total` on purpose. */
  excludedCount: number;
  /** Installment plans whose final round lands in this cycle. */
  endingInstallments: Array<{ merchant: string; amount: number; totalMonths: number }>;
}

export interface FutureCommitmentSummary {
  months: FutureCommitmentMonth[];
  /** Largest `total` across the range, for bar scaling. */
  peak: number;
}

export function calculateFutureCommitments(
  startYearMonth: string,
  transactions: Transaction[],
  recurringTemplates: RecurringTemplate[],
  recurringOccurrences: RecurringOccurrence[],
  paymentCards: PaymentCard[],
  monthStartDay: number = 1,
  monthCount: number = 6,
): FutureCommitmentSummary {
  const months: FutureCommitmentMonth[] = [];

  for (let offset = 0; offset < monthCount; offset += 1) {
    const yearMonth = shiftYearMonth(startYearMonth, offset);
    const period = getAccountingPeriod(yearMonth, monthStartDay);

    const templateMap = new Map(recurringTemplates.map(template => [template.id, template]));
    const periodOccurrences = recurringOccurrences.filter(row => isDateInPeriod(row.scheduledDate, period));
    const periodTransactions = transactions.filter(row => row.recurringTemplateId && isDateInPeriod(row.localDate, period));
    // Actual postings and saved month-specific plans take priority over defaults.
    // Skipped rows also block fallback; weekly rows only block their own date.
    let accountFixed = periodTransactions.reduce((sum, row) => {
      const template = templateMap.get(row.recurringTemplateId!);
      if (row.type !== 'expense' || !isSpendingTransaction(row) || template?.cardSettlementCardId
        || (row.paymentMethodType ?? template?.paymentMethodType) === 'card') return sum;
      return sum + Math.round(row.amount);
    }, 0);
    let isEstimated = false;
    let excludedCount = 0;
    for (const row of periodOccurrences) {
      const template = templateMap.get(row.templateId);
      if (!template?.active || template.cardSettlementCardId || row.status === 'posted' || row.status === 'skipped'
        || (row.typeSnapshot ?? template.type) !== 'expense'
        || (row.paymentMethodType ?? template.paymentMethodType) === 'card'
        || periodTransactions.some(tx => tx.recurringOccurrenceKey === row.occurrenceKey)) continue;
      // A saved cycle keeps its own amount state; a suggestion stays an estimate
      // and a missing amount is reported instead of silently counted as zero.
      const resolved = resolveRecurringAmount(row, transactions);
      if (resolved.amount == null) { excludedCount += 1; continue; }
      if (resolved.status !== 'confirmed') isEstimated = true;
      accountFixed += resolved.amount;
    }
    for (const template of recurringTemplates) {
      if (!template.active || template.archivedAt || template.type !== 'expense'
        || template.paymentMethodType === 'card' || template.cardSettlementCardId) continue;
      const rows = periodOccurrences.filter(row => row.templateId === template.id);
      const posted = periodTransactions.filter(row => row.recurringTemplateId === template.id);
      if (template.frequency === 'monthly' && (rows.length > 0 || posted.length > 0)) continue;
      for (const date of getScheduledDatesInPeriod(template, period)) {
        if (rows.some(row => row.scheduledDate === date) || posted.some(row => row.localDate === date)) continue;
        // Ungenerated cycle: project from the latest confirmed amount, never
        // from the template. Nothing is written; this is a read-only preview.
        const suggestion = getRecurringAmountSuggestion(template.id, template.defaultAmount, date, recurringOccurrences);
        if (suggestion.amount == null) { excludedCount += 1; continue; }
        isEstimated = true;
        accountFixed += suggestion.amount;
      }
    }

    const settlement = calculateMonthlyCardSettlementSummary(
      yearMonth,
      transactions,
      paymentCards,
      monthStartDay,
      recurringOccurrences,
      recurringTemplates,
      {
        usageBasis: 'previous_calendar_month',
        reserveUnmaterializedCardTemplates: true,
      },
    );

    // Installment rounds sit inside the card bill; split them out so the bar can
    // show what is a one-off month versus a standing commitment.
    const endingInstallments: FutureCommitmentMonth['endingInstallments'] = [];
    let installments = 0;

    // Split installment rounds out of the exact card bill that contains them.
    // Walking every usage month for every transaction counted one card's plan
    // multiple times when cards in the same payday cycle had different windows.
    settlement.cards.forEach(card => {
      let cardInstallments = 0;
      transactions.forEach(transaction => {
        if (transaction.type !== 'expense'
          || transaction.paymentMethodType !== 'card'
          || transaction.cardId !== card.cardId
          || !transaction.installment
          || (transaction.role ?? 'normal') !== 'normal') return;

        const usageYearMonth = card.usageYearMonth;
        const charge = getInstallmentCharge(transaction.amount, transaction.installment, usageYearMonth);
        if (!charge) return;
        cardInstallments += charge.amount;
        if (charge.round === transaction.installment?.totalMonths) {
          endingInstallments.push({
            merchant: transaction.merchant || '할부',
            amount: charge.amount,
            totalMonths: transaction.installment.totalMonths,
          });
        }
      });
      installments += Math.min(card.amount, cardInstallments);
    });

    const cardSettlement = Math.max(0, settlement.totalAmount - installments);
    months.push({
      yearMonth,
      accountFixed,
      installments,
      cardSettlement,
      total: accountFixed + installments + cardSettlement,
      endingInstallments,
      isEstimated,
      excludedCount,
    });
  }

  return { months, peak: months.reduce((max, month) => Math.max(max, month.total), 0) };
}
