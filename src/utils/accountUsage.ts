import type { PaymentCard, QuickEntry, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';

export interface AccountUsageItem {
  id: string;
  name: string;
  date?: string;
  amount?: number | null;
  status: string;
}
export interface AccountUsageGroup {
  kind: 'cards' | 'templates' | 'occurrences' | 'transactions' | 'quickEntries';
  label: string;
  guidance: string;
  items: AccountUsageItem[];
}
export interface AccountUsage {
  total: number;
  groups: AccountUsageGroup[];
}

/** Direct references by ID, including archived and historical records. Shared by deletion and its explanation. */
export function collectAccountUsage(accountId: string, data: {
  paymentCards: PaymentCard[];
  recurringTemplates: RecurringTemplate[];
  recurringOccurrences: RecurringOccurrence[];
  transactions: Transaction[];
  quickEntries: QuickEntry[];
}): AccountUsage {
  const templates = new Map(data.recurringTemplates.map(item => [item.id, item]));
  const statuses: Record<RecurringOccurrence['status'], string> = {
    scheduled: '예정', needs_confirmation: '확인 필요', overdue: '기한 지남', posted: '완료', skipped: '건너뜀',
  };
  const groups: AccountUsageGroup[] = [
    { kind: 'cards', label: '연결 카드', guidance: '계좌·카드에서 해당 카드의 출금 계좌를 변경하세요.', items: data.paymentCards.filter(item => item.linkedAccountId === accountId).map(item => ({ id: item.id, name: item.cardName, status: `${item.cardCompany} · ${item.cardType === 'credit' ? '신용카드' : '체크카드'}` })) },
    { kind: 'templates', label: '정기 항목 원본', guidance: '관리 → 정기 항목에서 계좌 연결을 확인하세요. 삭제·비활성 원본의 연결도 포함됩니다.', items: data.recurringTemplates.filter(item => item.accountId === accountId).map(item => ({ id: item.id, name: item.name, amount: item.defaultAmount, status: item.archivedAt ? '삭제된 원본' : item.active ? '사용 중' : '비활성' })) },
    { kind: 'occurrences', label: '월별 정기 일정', guidance: '정기납부에서 표시된 날짜의 일정을 확인하세요. 원본과 월별 일정의 계좌 연결은 별도로 저장됩니다.', items: data.recurringOccurrences.filter(item => item.accountId === accountId).map(item => ({ id: item.id, name: templates.get(item.templateId)?.name || '원본을 찾을 수 없는 정기 일정', date: item.scheduledDate, amount: item.actualAmount ?? item.expectedAmount, status: statuses[item.status] })) },
    { kind: 'transactions', label: '거래 내역', guidance: '거래내역에서 해당 날짜·사용처의 거래를 수정해 계좌를 변경하세요.', items: data.transactions.filter(item => item.accountId === accountId).map(item => ({ id: item.id, name: item.merchant || templates.get(item.recurringTemplateId || '')?.name || '사용처 미입력', date: item.localDate, amount: item.amount, status: item.role === 'card_settlement' ? '카드대금 납부' : item.role === 'transfer' ? '이체' : item.type === 'income' ? '수입' : '지출' })) },
    { kind: 'quickEntries', label: '퀵등록', guidance: '관리 → 퀵등록에서 해당 항목의 계좌를 변경하세요.', items: data.quickEntries.filter(item => item.accountId === accountId).map(item => ({ id: item.id, name: item.label, amount: item.amount, status: item.type === 'income' ? '수입' : '지출' })) },
  ];
  groups.forEach(group => group.items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)));
  return { total: groups.reduce((sum, group) => sum + group.items.length, 0), groups: groups.filter(group => group.items.length > 0) };
}
