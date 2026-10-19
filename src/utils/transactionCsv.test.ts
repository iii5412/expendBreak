import { describe, expect, it } from 'vitest';
import { transactionsCsv } from './transactionCsv';
import type { Category, Transaction } from '../types';

const tx = (patch: Partial<Transaction>): Transaction =>
  ({
    id: 't',
    localDate: '2026-10-19',
    type: 'expense',
    amount: 24900,
    categoryId: 'delivery',
    merchant: '배민',
    ...patch,
  }) as Transaction;
const categories = [{ id: 'delivery', name: '배달음식' }] as Category[];
describe('full transaction CSV', () => {
  it('writes UTF-8 BOM, Korean names, numeric KRW and CRLF records', () => {
    const csv = transactionsCsv([tx({})], categories);
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([239, 187, 191]);
    expect(csv).toContain('"24900","배달음식","배민"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
  it('quotes commas, quotes and embedded newlines', () => {
    expect(transactionsCsv([tx({ memo: '한,글 "메모"\n다음 줄' })], categories)).toContain('"한,글 ""메모""\n다음 줄"');
  });
  it.each(['=HYPERLINK("x")', ' +SUM(1)', ' \u0001 =SUM(1)', '\t@SUM(1)', '-1+1', '\nformula'])(
    'neutralizes spreadsheet injection: %j',
    (merchant) => {
      expect(transactionsCsv([tx({ merchant })], categories)).toContain(`"'${merchant.replace(/"/g, '""')}"`);
    },
  );
  it('exports old dates and transfers with roles distinguished', () => {
    const csv = transactionsCsv(
      [tx({ id: 'new' }), tx({ id: 'old', localDate: '2020-01-01', role: 'transfer' })],
      categories,
    );
    expect(csv).toContain('"transfer"');
    expect(csv.indexOf('2020-01-01')).toBeLessThan(csv.indexOf('2026-10-19'));
    expect(csv.split('\r\n')).toHaveLength(3);
  });
});
