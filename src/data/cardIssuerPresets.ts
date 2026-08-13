/**
 * Common Korean issuer billing-day → statement-window pairs.
 *
 * A starting point only. Issuers publish several billing days and let customers
 * change them, and the window can differ by product, so every value here is
 * editable and the payday flow always prefers the amount on the real statement.
 * Verify against the issuer before trusting a figure derived purely from these.
 *
 * `statementClosingDay` is the last day of usage the bill covers. Shinhan's 25th
 * payment closes on the 11th, i.e. it bills the previous month's 12th through
 * this month's 11th.
 */

export interface CardIssuerPreset {
  cardCompany: string;
  options: Array<{ billingDay: number; statementClosingDay: number }>;
}

export const CARD_ISSUER_PRESETS: CardIssuerPreset[] = [
  { cardCompany: '신한카드', options: [{ billingDay: 25, statementClosingDay: 11 }, { billingDay: 13, statementClosingDay: 29 }, { billingDay: 5, statementClosingDay: 21 }] },
  { cardCompany: '삼성카드', options: [{ billingDay: 25, statementClosingDay: 12 }, { billingDay: 13, statementClosingDay: 30 }, { billingDay: 5, statementClosingDay: 22 }] },
  { cardCompany: 'KB국민카드', options: [{ billingDay: 25, statementClosingDay: 12 }, { billingDay: 14, statementClosingDay: 1 }, { billingDay: 5, statementClosingDay: 22 }] },
  { cardCompany: '현대카드', options: [{ billingDay: 25, statementClosingDay: 11 }, { billingDay: 12, statementClosingDay: 28 }, { billingDay: 5, statementClosingDay: 21 }] },
  { cardCompany: '롯데카드', options: [{ billingDay: 25, statementClosingDay: 11 }, { billingDay: 13, statementClosingDay: 29 }, { billingDay: 5, statementClosingDay: 21 }] },
  { cardCompany: '하나카드', options: [{ billingDay: 25, statementClosingDay: 11 }, { billingDay: 13, statementClosingDay: 29 }] },
  { cardCompany: '우리카드', options: [{ billingDay: 25, statementClosingDay: 11 }, { billingDay: 13, statementClosingDay: 29 }] },
  { cardCompany: 'NH농협카드', options: [{ billingDay: 25, statementClosingDay: 12 }, { billingDay: 13, statementClosingDay: 30 }] },
  { cardCompany: 'BC카드', options: [{ billingDay: 25, statementClosingDay: 11 }, { billingDay: 15, statementClosingDay: 1 }] },
];

/** Preset window for an issuer's billing day, or null when nothing matches. */
export function findCardIssuerPreset(
  cardCompany: string,
  billingDay: number | null | undefined,
): { billingDay: number; statementClosingDay: number } | null {
  if (!billingDay) return null;
  const normalized = cardCompany.replace(/\s/g, '');
  const issuer = CARD_ISSUER_PRESETS.find(preset =>
    normalized.includes(preset.cardCompany.replace('카드', ''))
    || preset.cardCompany.includes(normalized));
  return issuer?.options.find(option => option.billingDay === billingDay) || null;
}
