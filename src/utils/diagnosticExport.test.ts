import { describe, expect, it } from 'vitest';
import type { DiagnosticExportInput } from './diagnosticExport';
import { serializeDiagnosticExport } from './diagnosticExport';

const input = {
  selectedYearMonth: '2026-08',
  userProfile: {
    uid: 'private-uid', displayName: '홍길동', email: 'private@example.com', accessPin: '1234',
    currency: 'KRW', timezone: 'Asia/Seoul', monthStartDay: 10,
    aiClassificationEnabled: false, aiInsightsEnabled: false, aiConsentAt: null,
    createdAt: '', updatedAt: '',
  },
  bankAccounts: [{
    id: 'account-1', bankName: '은행', accountName: '생활비', accountNumber: '110-123-456789',
    accountHolder: '홍길동', balance: 1_000_000, memo: 'private account memo', createdAt: '', updatedAt: '',
  }],
  paymentCards: [{
    id: 'card-1', cardName: '생활카드', cardCompany: '카드사', cardType: 'credit',
    linkedAccountId: 'account-1', billingDay: 25, createdAt: '', updatedAt: '',
  }],
  recurringTemplates: [{
    id: 'template-1', type: 'expense', name: '카드대금', defaultAmount: 100_000,
    categoryId: 'etc', counterparty: '카드사', frequency: 'monthly', dayOfMonth: 25,
    holidayPolicy: 'fixed_date', postingMode: 'confirm', allowAmountChange: true,
    paymentMethodType: 'account', accountId: 'account-1', accountNumber: '110-123-456789',
    accountHolder: '홍길동', startDate: '2026-01-01', nextDueDate: '2026-08-25', active: true,
    createdAt: '', updatedAt: '',
  }],
  recurringOccurrences: [],
  transactions: [{
    id: 'transaction-1', type: 'expense', amount: 100_000, occurredAt: '', localDate: '2026-08-10',
    categoryId: 'etc', merchant: '가맹점', memo: 'private transaction memo', tags: ['private-tag'],
    source: 'manual', receipt: { lineItems: [], ocrConfidence: 1, scannedAt: '', rawText: 'private receipt' },
    voiceRecord: { transcript: 'private voice', durationMs: 1, mimeType: 'audio/webm', confidence: 1, modelUsed: 'x', fallbackUsed: false, recordedAt: '' },
    paymentMethodType: 'card', cardId: 'card-1', createdAt: '', updatedAt: '',
  }],
  categories: [{ id: 'etc', name: '기타', type: 'expense', icon: '', color: '', active: true }],
  budget: { yearMonth: '2026-08', totalLimit: 0, thresholds: [], createdAt: '', updatedAt: '' },
  cycleBaseline: null,
  monthSummary: { yearMonth: '2026-08' },
  cardSettlementSummary: { yearMonth: '2026-08', totalAmount: 0, linkedAccountTotal: 0, unlinkedAmount: 0, cards: [] },
  futureCommitments: { months: [], peak: 0 },
  cardSettlementCandidates: [],
  excludedCardSettlementTemplateIds: [],
  planningTemplateIds: [],
  planningOccurrenceIds: [],
  planningTransactionIds: [],
} as unknown as DiagnosticExportInput;

describe('diagnostic export', () => {
  it('keeps calculation relationships while removing private fields', () => {
    const json = serializeDiagnosticExport(input, new Date('2026-08-19T00:00:00.000Z'));
    const snapshot = JSON.parse(json);

    expect(snapshot.schema).toBe('expendbreak-diagnostic-v1');
    expect(snapshot.records.bankAccounts[0]).toMatchObject({ id: 'account-1', balance: 1_000_000 });
    expect(snapshot.records.transactions[0]).toMatchObject({ cardId: 'card-1', amount: 100_000 });
    expect(json).not.toContain('private-uid');
    expect(json).not.toContain('private@example.com');
    expect(json).not.toContain('110-123-456789');
    expect(json).not.toContain('private transaction memo');
    expect(json).not.toContain('private receipt');
    expect(json).not.toContain('private voice');
  });
});
