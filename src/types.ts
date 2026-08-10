export type TransactionType = 'income' | 'expense';
export type ExpenseNature = 'fixed' | 'variable_estimate';
export type RecurringFrequency = 'monthly' | 'weekly';
export type HolidayPolicy = 'previous_business_day' | 'next_business_day' | 'fixed_date';
export type PostingMode = 'auto' | 'confirm';
export type OccurrenceStatus = 'scheduled' | 'needs_confirmation' | 'posted' | 'skipped' | 'overdue';
export type PaymentMethodType = 'account' | 'card' | 'cash' | 'other';

export interface ReceiptLineItem {
  name: string;
  quantity?: number | null;
  unitPrice?: number | null;
  amount: number;
}

export interface ReceiptRecord {
  id: string;
  storagePath?: string | null;
  mimeType?: string | null;
  imageSize?: number | null;
  receiptNumber?: string | null;
  businessNumber?: string | null;
  purchasedTime?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  paymentMethodText?: string | null;
  cardLast4?: string | null;
  lineItems: ReceiptLineItem[];
  rawText?: string | null;
  ocrConfidence: number;
  scannedAt: string;
}

export interface BankAccount {
  id: string;
  bankName: string; // 은행명 (e.g. KB국민, 신한, 카카오뱅크, 토스뱅크, NH농협 등)
  accountName: string; // 계좌 별칭 (e.g. 월급 통장, 생활비 통장)
  accountNumber: string; // 계좌번호
  accountHolder: string; // 예금주
  balance: number; // 사용자가 직접 입력하는 잔액 스냅샷
  balanceAsOf?: string; // YYYY-MM-DD, 잔액 기준일
  balanceUpdatedAt?: string; // ISO String, 잔액 마지막 수정 시각
  memo?: string; // 비고
  createdAt: string;
  updatedAt: string;
}

export interface PaymentCard {
  id: string;
  cardName: string; // 카드명 (e.g. 신한 딥드림 카드)
  cardCompany: string; // 카드사 (e.g. 신한카드, 삼성카드)
  cardType: 'credit' | 'debit'; // 신용카드 / 체크카드
  linkedAccountId?: string | null; // 출금 계좌 ID (BankAccount ID)
  billingDay?: number | null; // 결제일 (1~31)
  memo?: string; // 비고
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
  isSystem?: boolean;
  isCustom?: boolean;
  active: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number; // KRW Integer
  occurredAt: string; // ISO String
  localDate: string; // YYYY-MM-DD
  categoryId: string;
  merchant: string;
  memo: string;
  source: 'manual' | 'ai' | 'receipt';
  aiConfidence?: number | null;
  aiReviewed?: boolean;
  recurringTemplateId?: string | null;
  recurringOccurrenceKey?: string | null;
  paymentMethodType?: PaymentMethodType;
  accountId?: string | null;
  cardId?: string | null;
  tags?: string[];
  receipt?: ReceiptRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  yearMonth: string; // YYYY-MM
  totalLimit: number;
  categoryLimits: Record<string, number>; // categoryId -> amount
  thresholds: number[]; // e.g. [0.70, 0.85, 1.00]
  createdAt: string;
  updatedAt: string;
}

export interface RecurringTemplate {
  id: string;
  type: TransactionType;
  name: string;
  defaultAmount: number;
  categoryId: string;
  counterparty: string;
  expenseNature?: ExpenseNature | null; // fixed or variable_estimate
  frequency: RecurringFrequency;
  dayOfMonth: number; // 1-31
  holidayPolicy: HolidayPolicy;
  postingMode: PostingMode;
  allowAmountChange: boolean;
  bankName?: string; // e.g. "KB국민", "신한", "카카오뱅크"
  accountNumber?: string; // e.g. "110-123-456789"
  accountHolder?: string; // e.g. "홍길동"
  paymentMethodType?: PaymentMethodType;
  accountId?: string | null;
  cardId?: string | null;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  nextDueDate: string; // YYYY-MM-DD
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringOccurrence {
  id: string;
  templateId: string;
  occurrenceKey: string; // templateId + YYYY-MM-DD
  scheduledDate: string; // YYYY-MM-DD
  expectedAmount: number;
  actualAmount?: number | null;
  status: OccurrenceStatus;
  transactionId?: string | null;
  paymentMethodType?: PaymentMethodType;
  accountId?: string | null;
  cardId?: string | null;
  typeSnapshot?: TransactionType;
  categoryIdSnapshot?: string;
  templateRevision?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantRule {
  id: string;
  pattern: string; // e.g. "배민", "카카오택시"
  categoryId: string;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  currency: string;
  timezone: string;
  monthStartDay: number; // default 1
  aiClassificationEnabled: boolean;
  aiInsightsEnabled: boolean;
  aiConsentAt: string | null;
  securityPinEnabled?: boolean;
  accessPin?: string; // Legacy only. New PIN authentication never stores this field.
  createdAt: string;
  updatedAt: string;
}

export interface AIClassifyResult {
  type: TransactionType;
  amount: number;
  date: string; // YYYY-MM-DD
  merchant: string;
  memo: string;
  suggestedCategoryId: string;
  suggestedNewCategoryName?: string | null;
  confidence: number;
  reason: string;
  needsConfirmation: boolean;
}

export interface AIReceiptResult {
  merchant: string;
  amount: number;
  date: string;
  purchasedTime?: string | null;
  memo: string;
  suggestedCategoryId: string;
  confidence: number;
  reason: string;
  receiptNumber?: string | null;
  businessNumber?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  paymentMethodText?: string | null;
  cardLast4?: string | null;
  lineItems: ReceiptLineItem[];
  rawText: string;
  needsConfirmation: boolean;
}

export interface AIFeedbackResult {
  oneLiner: string;
  positivePoint: string;
  riskFactors: string[];
  weeklyActions: { action: string; estimatedSavings: string }[];
  generatedAt: string;
}

export interface AICategorySuggestion {
  suggestedName: string;
  description: string;
  existingMatchId?: string;
}

export type BudgetAlertLevel = 'safe' | 'caution' | 'warning' | 'danger';
