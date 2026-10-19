import type { Category, Transaction } from '../types';

/** Always quote fields, preserve Korean in Excel, and neutralize spreadsheet formulas. */
export function transactionsCsv(transactions: readonly Transaction[], categories: readonly Category[]): string {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    const trimmed = text.replace(/^[\s]+/, '');
    const firstPrintable = [...trimmed].find((char) => char.charCodeAt(0) > 32 && !/\s/u.test(char)) || '';
    if (/^[=+\-@]$/.test(firstPrintable) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const headers = [
    '날짜',
    '유형',
    '금액(KRW)',
    '카테고리',
    '사용처/거래처',
    '메모',
    '생활태그',
    '입력방식',
    '영수증번호',
    '영수증품목',
    '거래ID',
    '거래역할',
    '예산주기',
    '지출성격',
    '일회성',
  ];
  const rows = [...transactions]
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.id.localeCompare(b.id))
    .map((t) => [
      t.localDate,
      t.type === 'income' ? '수입' : '지출',
      t.amount,
      names.get(t.categoryId) || t.categoryId || '기타',
      t.merchant,
      t.memo,
      (t.tags || []).join('|'),
      t.source,
      t.receipt?.receiptNumber,
      (t.receipt?.lineItems || []).map((item) => item.name).join('|'),
      t.id,
      t.role || 'normal',
      t.budgetPeriodKey,
      t.expenseNature,
      t.isOneOff ? '예' : '아니요',
    ]);
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
