import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT, formatAmountInput, formatKoreanAmountUnits, parseAmountInput } from './amount';

describe('amount input helpers', () => {
  it('keeps only digits so pasted values still work', () => {
    expect(parseAmountInput('24,900원')).toBe(24900);
    expect(parseAmountInput('1 250 000')).toBe(1250000);
    expect(parseAmountInput('')).toBe(0);
    expect(parseAmountInput('abc')).toBe(0);
  });

  it('rejects negatives and decimals by construction', () => {
    expect(parseAmountInput('-5000')).toBe(5000);
    expect(parseAmountInput('1234.56')).toBe(123456);
  });

  it('caps absurd values instead of overflowing', () => {
    expect(parseAmountInput('9'.repeat(20))).toBe(MAX_AMOUNT);
  });

  it('formats with thousands separators and blanks out zero', () => {
    expect(formatAmountInput(1250000)).toBe('1,250,000');
    expect(formatAmountInput(0)).toBe('');
    expect(formatAmountInput('24900')).toBe('24,900');
  });

  it('reads amounts back in Korean units', () => {
    expect(formatKoreanAmountUnits(0)).toBe('');
    expect(formatKoreanAmountUnits(9900)).toBe('9,900원');
    expect(formatKoreanAmountUnits(1_250_000)).toBe('125만원');
    expect(formatKoreanAmountUnits(3_500_000)).toBe('350만원');
    expect(formatKoreanAmountUnits(123_456_789)).toBe('1억 2345만 6789원');
  });
});
