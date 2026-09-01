export type TransactionType = 'income' | 'expense';
export type ExpenseNature = 'fixed' | 'variable_estimate';
export type RecurringFrequency = 'monthly' | 'weekly';
export type HolidayPolicy = 'previous_business_day' | 'next_business_day' | 'fixed_date';
export type PostingMode = 'auto' | 'confirm';
export type OccurrenceStatus = 'scheduled' | 'needs_confirmation' | 'posted' | 'skipped' | 'overdue';
export type PaymentMethodType = 'account' | 'card' | 'cash' | 'other';
export type CardPaymentStatus = 'scheduled' | 'paid';
/**
 * What a transaction represents. `normal` is spending or income; the others are
 * money moving between places the user already owns or owes, so they must never
 * reach the spend track (INV-2).
 */
export type TransactionRole = 'normal' | 'card_settlement' | 'transfer';

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
  /** 이용기간 마감일 (1~31). 예: 25일 결제 · 마감 11일 → 전월 12일~당월 11일 사용분 청구.
   *  미설정 시 결제월 직전 달 사용분으로 추정한다. */
  statementClosingDay?: number | null;
  monthlyPaymentAmounts?: Record<string, number>; // 결제월(YYYY-MM)별 확정 카드대금
  monthlyPaymentStatuses?: Record<string, CardPaymentStatus>; // 결제월별 납부 상태(금액 산식과 분리)
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

export interface VoiceRecord {
  transcript: string;
  durationMs: number;
  mimeType: string;
  confidence: number;
  modelUsed: string;
  fallbackUsed: boolean;
  recordedAt: string;
}

export interface InstallmentPlan {
  totalMonths: number;
  /** Installment round that applies in baseYearMonth. */
  currentRound: number;
  /** Accounting period label (YYYY-MM) used as the projection anchor. */
  baseYearMonth: string;
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
  source: 'manual' | 'ai' | 'receipt' | 'voice';
  /** Defaults to 'normal' when absent. */
  role?: TransactionRole;
  /** Payment cycle (YYYY-MM) a card settlement transaction pays off. */
  settlementYearMonth?: string | null;
  aiConfidence?: number | null;
  aiReviewed?: boolean;
  recurringTemplateId?: string | null;
  recurringOccurrenceKey?: string | null;
  paymentMethodType?: PaymentMethodType;
  accountId?: string | null;
  cardId?: string | null;
  installment?: InstallmentPlan | null;
  tags?: string[];
  receipt?: ReceiptRecord | null;
  voiceRecord?: VoiceRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  yearMonth: string; // YYYY-MM
  totalLimit: number; // Persisted legacy field used as the user-set monthly allowance limit
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
  /** Soft deletion keeps already-loaded monthly plans usable until that month is
   *  explicitly reloaded, while hiding the item from the normalized master list. */
  archivedAt?: string | null;
  /** Set when the user confirms this manual item is card X's bill. The generated
   *  card settlement then stands in for it and planning skips this template. */
  cardSettlementCardId?: string | null;
  /** Set when the user has classified this item, either way, so the suggestion stops. */
  cardSettlementReviewedAt?: string | null;
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
  /** Template amount when this occurrence last synced, so unrelated template
   *  edits do not overwrite a carried-forward or month-specific amount. */
  templateAmountSnapshot?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The living budget a user commits to on payday, frozen for that cycle.
 *
 * Without this snapshot the remaining balance drifts whenever a fixed amount is
 * edited or a card estimate moves, so yesterday's number stops matching what was
 * actually spent since. Once locked, the plan changes only when the user accepts
 * a change (see `docs/PRD-payday-cashflow-model.md` P0-3, INV-4).
 */
export interface CycleBaselineFigures {
  confirmedIncome: number;
  accountFixedOutflow: number;
  cardSettlement: number;
  savingsReserve: number;
  /** confirmedIncome - accountFixedOutflow - cardSettlement - savingsReserve */
  livingBudget: number;
  lockedAt: string;
}

export interface CycleBaseline extends CycleBaselineFigures {
  /** Payday cycle label (YYYY-MM). Also the document id: one active plan per cycle. */
  yearMonth: string;
  /** Plans this one replaced, newest last. Kept so a cycle's changes stay auditable. */
  revisions: CycleBaselineFigures[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A saved shape for a transaction the user records over and over, so the
 * repeat costs one tap instead of a full trip through the entry modal.
 */
export interface QuickEntry {
  id: string;
  /** What the chip reads, e.g. "점심" or "출근 교통비". */
  label: string;
  type: TransactionType;
  /** `null` asks for the amount on use; a number saves straight away. */
  amount: number | null;
  categoryId: string;
  merchant: string;
  memo: string;
  paymentMethodType: PaymentMethodType;
  accountId?: string | null;
  cardId?: string | null;
  /** Manual ordering of the chip row; lower comes first. */
  sortOrder: number;
  useCount: number;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantRule {
  id: string;
  pattern: string; // e.g. "배민", "카카오택시"
  categoryId: string;
  createdAt: string;
}

export type WidgetPrivacyMode = 'unlock_required' | 'always_show' | 'amounts_hidden';
export type AppTheme = 'dark' | 'light';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  currency: string;
  timezone: string;
  monthStartDay: number; // Salary/payday accounting cycle start (default 10)
  /** One-time persisted migration marker for the salary-day planning model. */
  paydayPlanningVersion?: number;
  /** Set once the user has seen why the card bill changed their figures. */
  cashflowModelNoticeSeenAt?: string | null;
  /** Last DB-saved allowance limit, used to seed a month that has no budget document yet. */
  defaultAllowanceLimit?: number;
  aiClassificationEnabled: boolean;
  aiInsightsEnabled: boolean;
  aiConsentAt: string | null;
  /** Set once the setup sheet is finished or skipped, so it stops prompting. */
  onboardingCompletedAt?: string | null;
  /** Idle minutes before the app locks. 0 disables the idle lock. */
  idleLockMinutes?: number;
  /**
   * Clear the on-device cache every time the app locks. Off by default: keeping
   * the cache is what makes unlocking instant, and the PIN screen still gates
   * access. Turn it on to leave nothing readable on a shared or at-risk device.
   */
  wipeCacheOnLock?: boolean;
  /** Android home-screen widget disclosure policy. */
  widgetPrivacyMode?: WidgetPrivacyMode;
  /** Account-scoped visual preference. Defaults to the original dark theme. */
  theme?: AppTheme;
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
  paymentMethodType?: PaymentMethodType;
  suggestedAccountId?: string | null;
  suggestedCardId?: string | null;
  tags?: string[];
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

export interface VoiceAnalysisResult {
  transcript: string;
  type: TransactionType;
  amount: number;
  date: string;
  merchant: string;
  memo: string;
  suggestedCategoryId: string;
  paymentMethodType?: PaymentMethodType;
  paymentMethodHint?: string;
  suggestedAccountId?: string | null;
  suggestedCardId?: string | null;
  installmentMonths?: number;
  installmentCurrentRound?: number;
  tags?: string[];
  confidence: number;
  reason: string;
  multipleTransactionsDetected: boolean;
  needsConfirmation: boolean;
  modelUsed: string;
  fallbackUsed: boolean;
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
