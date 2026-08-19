import {
  BankAccount,
  Budget,
  Category,
  CycleBaseline,
  PaymentCard,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
  UserProfile,
} from '../types';
import { MonthSummary } from './calculations';
import { MonthlyCardSettlementSummary } from './cardPayments';
import { ManualCardSettlementCandidate } from './cardSettlementPlans';
import { FutureCommitmentSummary } from './futureCommitments';

export interface DiagnosticExportInput {
  selectedYearMonth: string;
  userProfile: UserProfile;
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  recurringTemplates: RecurringTemplate[];
  recurringOccurrences: RecurringOccurrence[];
  transactions: Transaction[];
  categories: Category[];
  budget: Budget;
  cycleBaseline: CycleBaseline | null;
  monthSummary: MonthSummary;
  cardSettlementSummary: MonthlyCardSettlementSummary;
  futureCommitments: FutureCommitmentSummary;
  cardSettlementCandidates: ManualCardSettlementCandidate[];
  excludedCardSettlementTemplateIds: string[];
  planningTemplateIds: string[];
  planningOccurrenceIds: string[];
  planningTransactionIds: string[];
}

const sanitizeAccount = (account: BankAccount) => ({
  id: account.id,
  bankName: account.bankName,
  accountName: account.accountName,
  balance: account.balance,
  balanceAsOf: account.balanceAsOf ?? null,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

const sanitizeTemplate = (template: RecurringTemplate) => {
  const { accountNumber: _accountNumber, accountHolder: _accountHolder, ...safe } = template;
  return safe;
};

const sanitizeTransaction = (transaction: Transaction) => ({
  id: transaction.id,
  type: transaction.type,
  amount: transaction.amount,
  localDate: transaction.localDate,
  categoryId: transaction.categoryId,
  merchant: transaction.merchant,
  source: transaction.source,
  role: transaction.role ?? 'normal',
  settlementYearMonth: transaction.settlementYearMonth ?? null,
  recurringTemplateId: transaction.recurringTemplateId ?? null,
  recurringOccurrenceKey: transaction.recurringOccurrenceKey ?? null,
  paymentMethodType: transaction.paymentMethodType ?? null,
  accountId: transaction.accountId ?? null,
  cardId: transaction.cardId ?? null,
  installment: transaction.installment ?? null,
  createdAt: transaction.createdAt,
  updatedAt: transaction.updatedAt,
});

/**
 * A support snapshot that keeps calculation inputs and ID relationships while
 * omitting authentication, account-number, memo, receipt, and voice data.
 */
export function buildDiagnosticExport(
  input: DiagnosticExportInput,
  exportedAt: Date = new Date(),
) {
  return {
    schema: 'expendbreak-diagnostic-v1',
    exportedAt: exportedAt.toISOString(),
    privacy: {
      omitted: [
        'user uid, name, email and PIN',
        'account number and holder',
        'transaction memo and tags',
        'receipt and voice data',
      ],
      retained: 'amounts, dates, display labels and internal IDs needed to reproduce calculations',
    },
    context: {
      selectedYearMonth: input.selectedYearMonth,
      currency: input.userProfile.currency,
      timezone: input.userProfile.timezone,
      monthStartDay: input.userProfile.monthStartDay,
    },
    counts: {
      bankAccounts: input.bankAccounts.length,
      paymentCards: input.paymentCards.length,
      recurringTemplates: input.recurringTemplates.length,
      recurringOccurrences: input.recurringOccurrences.length,
      transactions: input.transactions.length,
    },
    records: {
      bankAccounts: input.bankAccounts.map(sanitizeAccount),
      paymentCards: input.paymentCards,
      recurringTemplates: input.recurringTemplates.map(sanitizeTemplate),
      recurringOccurrences: input.recurringOccurrences,
      transactions: input.transactions.map(sanitizeTransaction),
      categories: input.categories.map(category => ({
        id: category.id,
        name: category.name,
        type: category.type,
        active: category.active,
      })),
      budget: input.budget,
      cycleBaseline: input.cycleBaseline,
    },
    classification: {
      cardSettlementCandidates: input.cardSettlementCandidates,
      excludedCardSettlementTemplateIds: input.excludedCardSettlementTemplateIds,
      planningTemplateIds: input.planningTemplateIds,
      planningOccurrenceIds: input.planningOccurrenceIds,
      planningTransactionIds: input.planningTransactionIds,
    },
    calculations: {
      monthSummary: input.monthSummary,
      cardSettlementSummary: input.cardSettlementSummary,
      futureCommitments: input.futureCommitments,
    },
  };
}

export function serializeDiagnosticExport(
  input: DiagnosticExportInput,
  exportedAt: Date = new Date(),
): string {
  return JSON.stringify(buildDiagnosticExport(input, exportedAt), null, 2);
}
