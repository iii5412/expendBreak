/** Shared parsing/formatting for KRW amount inputs. */

export const MAX_AMOUNT = 999_999_999_999;

/** Keeps only digits, so paste of "24,900원" still works. */
export function parseAmountInput(raw: string): number {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  return Math.min(MAX_AMOUNT, Number(digits));
}

/** Thousands-separated display used while typing. */
export function formatAmountInput(value: number | string): string {
  const amount = typeof value === 'number' ? value : parseAmountInput(value);
  if (!amount) return '';
  return amount.toLocaleString('ko-KR');
}

const UNITS: Array<{ value: number; label: string }> = [
  { value: 1_0000_0000_0000, label: '조' },
  { value: 1_0000_0000, label: '억' },
  { value: 1_0000, label: '만' },
];

/**
 * Korean unit readout so a long number can be checked at a glance:
 * 1250000 -> "125만원", 123456789 -> "1억 2345만 6789원".
 */
export function formatKoreanAmountUnits(value: number): string {
  const amount = Math.trunc(Math.abs(value));
  if (!Number.isFinite(amount) || amount === 0) return '';
  if (amount < 10_000) return `${amount.toLocaleString('ko-KR')}원`;

  const parts: string[] = [];
  let remainder = amount;
  for (const unit of UNITS) {
    const count = Math.floor(remainder / unit.value);
    if (count > 0) {
      // Each group is under 10,000, so separators inside a unit would only add noise.
      parts.push(`${count}${unit.label}`);
      remainder -= count * unit.value;
    }
  }
  if (remainder > 0) parts.push(String(remainder));

  return `${parts.join(' ')}원`;
}
