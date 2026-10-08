import type { Transaction } from '../types';

export interface StatementRow {
  line: number;
  localDate: string;
  merchant: string;
  amount: number;
  suggestedTransactionId?: string;
  matchReason?: string;
}

export interface StatementIssue {
  line: number;
  reason: string;
}

export interface StatementParseResult {
  rows: StatementRow[];
  issues: StatementIssue[];
}

export interface StatementMatch {
  row: StatementRow;
  kind: 'existing' | 'correction' | 'new' | 'review';
  transaction?: Transaction;
  reason?: string;
}

const MAX_ROWS = 100;

function parseDate(value: string): string | null {
  const match = value.trim().match(/^(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:\D|$)/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function cleanMerchant(value: string): string {
  return value
    .replace(/(?:\d[ -]?){13,19}/g, '[번호 삭제]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 100);
}

/** Treat model output as untrusted data before it can enter the ledger preview. */
export function validateExtractedStatement(value: unknown): StatementParseResult {
  const rows: StatementRow[] = [];
  const issues: StatementIssue[] = [];
  const rawRows = value && typeof value === 'object' && 'rows' in value && Array.isArray(value.rows)
    ? value.rows : [];
  rawRows.slice(0, MAX_ROWS).forEach((item: unknown, index: number) => {
    const line = index + 1;
    if (!item || typeof item !== 'object') { issues.push({ line, reason: 'AI가 읽은 행이 올바르지 않습니다.' }); return; }
    const row = item as Record<string, unknown>;
    if (row.kind !== 'purchase') {
      issues.push({ line, reason: '취소·환불 또는 거래가 아닌 행은 반영하지 않습니다.' });
      return;
    }
    const localDate = typeof row.localDate === 'string' ? parseDate(row.localDate) : null;
    const merchant = typeof row.merchant === 'string' ? cleanMerchant(row.merchant) : '';
    const amount = typeof row.amount === 'number' && Number.isSafeInteger(row.amount) && row.amount > 0
      ? row.amount : null;
    if (!localDate || !merchant || !amount) {
      issues.push({ line, reason: '날짜·사용처·금액이 불확실하여 제외했습니다.' });
      return;
    }
    rows.push({
      line, localDate, merchant, amount,
      suggestedTransactionId: typeof row.matchedTransactionId === 'string' ? row.matchedTransactionId.slice(0, 100) : '',
      matchReason: typeof row.matchReason === 'string' ? row.matchReason.slice(0, 100) : '',
    });
  });
  if (rawRows.length > MAX_ROWS) issues.push({ line: MAX_ROWS + 1, reason: '처음 100건만 확인했습니다.' });
  return { rows, issues };
}

function merchantKey(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣]/g, '');
}

export function reconcileCardStatement(rows: StatementRow[], transactions: Transaction[], cardId: string | null): StatementMatch[] {
  const seen = new Set<string>();
  const usedTransactionIds = new Set<string>();
  const eligible = transactions.filter(transaction => transaction.type === 'expense'
    && (!transaction.role || transaction.role === 'normal')
    && (!transaction.paymentMethodType || transaction.paymentMethodType === 'card')
    && (!cardId || !transaction.cardId || transaction.cardId === cardId));

  return rows.map(row => {
    const key = `${row.localDate}|${row.amount}|${merchantKey(row.merchant)}`;
    if (seen.has(key)) return { row, kind: 'review', reason: '붙여넣은 내역에 같은 날짜·사용처·금액이 반복됩니다.' };
    seen.add(key);
    const available = eligible.filter(transaction => !usedTransactionIds.has(transaction.id));
    const exact = available.filter(transaction => transaction.localDate === row.localDate
      && transaction.amount === row.amount && merchantKey(transaction.merchant) === merchantKey(row.merchant));
    if (exact.length === 1) {
      usedTransactionIds.add(exact[0].id);
      return { row, kind: 'existing', transaction: exact[0] };
    }
    if (exact.length > 1) return { row, kind: 'review', reason: '동일한 기존 거래가 여러 건입니다.' };

    const sameMerchant = available.filter(transaction => transaction.localDate === row.localDate
      && merchantKey(transaction.merchant) === merchantKey(row.merchant));
    if (sameMerchant.length === 1) {
      usedTransactionIds.add(sameMerchant[0].id);
      return { row, kind: 'correction', transaction: sameMerchant[0], reason: '금액이 다릅니다.' };
    }
    if (sameMerchant.length > 1) return { row, kind: 'review', reason: '수정할 기존 거래를 한 건으로 정할 수 없습니다.' };

    if (row.suggestedTransactionId) {
      const suggested = available.find(transaction => transaction.id === row.suggestedTransactionId);
      if (suggested) {
        const daysApart = Math.abs(Date.parse(`${suggested.localDate}T00:00:00Z`) - Date.parse(`${row.localDate}T00:00:00Z`)) / 86_400_000;
        if (daysApart <= 7) {
          usedTransactionIds.add(suggested.id);
          const unchanged = suggested.localDate === row.localDate && suggested.amount === row.amount
            && merchantKey(suggested.merchant) === merchantKey(row.merchant);
          return { row, kind: unchanged ? 'existing' : 'correction', transaction: suggested,
            reason: row.matchReason || 'AI가 같은 거래 후보로 연결했습니다.' };
        }
      }
      return { row, kind: 'review', reason: 'AI의 기존 거래 후보를 확인할 수 없어 자동 연결하지 않았습니다.' };
    }
    return { row, kind: 'new' };
  });
}
