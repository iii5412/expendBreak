/** Returns an amount only when the sentence contains an explicit KRW expression. */
export function extractExplicitKrwAmount(text: string): number {
  const normalized = text.replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const koreanUnits = normalized.match(/((?:\d+(?:\.\d+)?\s*(?:억|만|천|백|십)\s*)+)원?/);
  if (koreanUnits) {
    const unitValue: Record<string, number> = {
      억: 100_000_000,
      만: 10_000,
      천: 1_000,
      백: 100,
      십: 10,
    };
    let amount = 0;
    for (const match of koreanUnits[1].matchAll(/(\d+(?:\.\d+)?)\s*(억|만|천|백|십)/g)) {
      amount += Number(match[1]) * unitValue[match[2]];
    }
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount);
  }

  const plainWon = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
  if (!plainWon) return 0;
  const amount = Number(plainWon[1].replace(/,/g, ''));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

/** Relative or explicit dates still need the model's date normalization. */
export function needsAiDateResolution(text: string): boolean {
  return /(어제|그제|엊그제|지난|전날|내일|모레|\d{1,2}\s*월\s*\d{1,2}\s*일|월요일|화요일|수요일|목요일|금요일|토요일|일요일)/.test(text);
}
