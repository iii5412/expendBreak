import { PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { getAccountingPeriod, getMonthlyDueDateInPeriod, shiftYearMonth } from './calculations';
import { calculateMonthlyCardSettlementSummary } from './cardPayments';
import { getInstallmentCharge } from './installments';

/**
 * Money already committed for cycles that have not started yet.
 *
 * Answers "how much of next month is already spoken for", and in particular when
 * an installment ends and that amount comes back. Only obligations that exist
 * today are projected — no spending forecast.
 */

export interface FutureCommitmentMonth {
  yearMonth: string;
  /** Recurring expenses transferred from an account. */
  accountFixed: number;
  /** Installment rounds due, excluded from `cardSettlement` to be shown separately. */
  installments: number;
  /** Card bills due, net of the installment rounds inside them. */
  cardSettlement: number;
  total: number;
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

    // Account transfers, from the template schedule: future cycles have no
    // occurrences generated yet, so the template is the only source.
    const accountFixed = recurringTemplates
      .filter(template => {
        if (!template.active || template.type !== 'expense') return false;
        if (template.paymentMethodType === 'card') return false;
        if (template.frequency !== 'monthly') return false;
        const dueDate = getMonthlyDueDateInPeriod(template.dayOfMonth, period);
        return Boolean(
          dueDate
          && dueDate >= template.startDate
          && (!template.endDate || dueDate <= template.endDate),
        );
      })
      .reduce((sum, template) => sum + Math.round(template.defaultAmount), 0);

    const settlement = calculateMonthlyCardSettlementSummary(
      yearMonth,
      transactions,
      paymentCards,
      monthStartDay,
      recurringOccurrences,
      recurringTemplates,
    );

    // Installment rounds sit inside the card bill; split them out so the bar can
    // show what is a one-off month versus a standing commitment.
    const usageMonths = new Set(settlement.cards.map(card => card.usageYearMonth));
    const endingInstallments: FutureCommitmentMonth['endingInstallments'] = [];
    let installments = 0;

    transactions.forEach(transaction => {
      if (transaction.type !== 'expense' || !transaction.installment) return;
      usageMonths.forEach(usageYearMonth => {
        const charge = getInstallmentCharge(transaction.amount, transaction.installment, usageYearMonth);
        if (!charge) return;
        installments += charge.amount;
        if (charge.round === transaction.installment?.totalMonths) {
          endingInstallments.push({
            merchant: transaction.merchant || '할부',
            amount: charge.amount,
            totalMonths: transaction.installment.totalMonths,
          });
        }
      });
    });

    const cardSettlement = Math.max(0, settlement.totalAmount - installments);
    months.push({
      yearMonth,
      accountFixed,
      installments,
      cardSettlement,
      total: accountFixed + installments + cardSettlement,
      endingInstallments,
    });
  }

  return { months, peak: months.reduce((max, month) => Math.max(max, month.total), 0) };
}
