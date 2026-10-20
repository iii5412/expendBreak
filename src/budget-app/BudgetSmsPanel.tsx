import { useState } from 'react';
import type { BankAccount, Category, PaymentCard } from '../types';
import type { SmsReviewCandidate } from '../utils/smsImport';
import { SmsFoundBanner } from '../components/SmsFoundBanner';
import { SmsReviewCard } from '../components/SmsReviewCard';

/** What the app shell hands the budget view so SMS candidates are reviewed in the same place. */
export interface BudgetSmsBridge {
  candidates: SmsReviewCandidate[];
  onApprove: (candidate: SmsReviewCandidate) => Promise<void>;
  onDismiss: (candidate: SmsReviewCandidate) => Promise<void>;
  onUpdate: (candidate: SmsReviewCandidate) => void;
  /** Re-reads the native queue right after a manual scan. */
  onScanComplete: () => void;
}

export const SMS_REVIEW_ANCHOR = 'sms-review';

export function scrollToSmsReview() {
  document.getElementById(SMS_REVIEW_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * The existing review components are dark-themed; `bb-dark-embed` keeps their own
 * colours from being overridden by the budget view's light theme.
 */
export function BudgetSmsPanel({
  sms,
  categories,
  paymentCards,
  bankAccounts,
}: {
  sms: BudgetSmsBridge;
  categories: Category[];
  paymentCards: PaymentCard[];
  bankAccounts: BankAccount[];
}) {
  const [dismissedFor, setDismissedFor] = useState('');
  if (sms.candidates.length === 0) return null;
  const key = sms.candidates
    .map((candidate) => candidate.fingerprint)
    .sort()
    .join('|');
  return (
    <div className="bb-dark-embed">
      {key !== dismissedFor && (
        <SmsFoundBanner
          count={sms.candidates.length}
          onReview={() => {
            setDismissedFor(key);
            scrollToSmsReview();
          }}
          onDismiss={() => setDismissedFor(key)}
        />
      )}
      <SmsReviewCard
        candidates={sms.candidates}
        categories={categories}
        paymentCards={paymentCards}
        bankAccounts={bankAccounts}
        onApprove={sms.onApprove}
        onDismiss={sms.onDismiss}
        onUpdate={sms.onUpdate}
      />
    </div>
  );
}
