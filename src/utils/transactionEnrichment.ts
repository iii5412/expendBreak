import type { BankAccount, PaymentCard, PaymentMethodType } from '../types';

export interface MentionedPaymentSource {
  type: Extract<PaymentMethodType, 'account' | 'card'>;
  id: string;
}

/**
 * Normalizes the words people commonly use interchangeably for a bank account.
 * This intentionally keeps the rest of the alias intact so a generic bank name
 * cannot beat a more specific registered nickname.
 */
export function normalizePaymentAlias(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/월급/g, '급여')
    .replace(/통장/g, '계좌')
    .replace(/[^0-9a-z가-힣]/g, '');
}

function findLongestMention(
  text: string,
  sources: Array<{ id: string; aliases: string[] }>,
): { id: string; aliasLength: number } | null {
  let best: { id: string; aliasLength: number } | null = null;

  for (const source of sources) {
    for (const rawAlias of source.aliases) {
      const alias = normalizePaymentAlias(rawAlias);
      if (alias.length < 2 || !text.includes(alias)) continue;
      if (!best || alias.length > best.aliasLength) {
        best = { id: source.id, aliasLength: alias.length };
      }
    }
  }

  return best;
}

/** Matches registered aliases, including 급여계좌 ↔ 급여통장 and 급여 ↔ 월급. */
export function findMentionedPaymentSource(
  text: string,
  bankAccounts: BankAccount[],
  paymentCards: PaymentCard[],
): MentionedPaymentSource | null {
  const normalizedText = normalizePaymentAlias(text);
  const accountMatch = findLongestMention(normalizedText, bankAccounts.map(account => ({
    id: account.id,
    aliases: [account.accountName, account.bankName],
  })));
  const cardMatch = findLongestMention(normalizedText, paymentCards.map(card => ({
    id: card.id,
    aliases: [card.cardName, card.cardCompany],
  })));

  if (!accountMatch && !cardMatch) return null;
  if (accountMatch && (!cardMatch || accountMatch.aliasLength >= cardMatch.aliasLength)) {
    return { type: 'account', id: accountMatch.id };
  }
  return { type: 'card', id: cardMatch!.id };
}

const TAG_STOP_WORDS = new Set([
  '구매', '결제', '사용', '지출', '수입', '송금', '이체', '출금', '입금',
  '샀어', '샀음', '샀다', '구입', '썼어', '썼음', '씀', '내역',
  '오늘', '어제', '그제', '내일', '현금', '카드', '계좌', '통장',
]);

function cleanTagToken(value: string): string {
  return value
    .replace(/^#+/, '')
    .replace(/^["'([{]+|["')\]}.,!?]+$/g, '')
    .replace(/(?:에서|에게|한테|으로|로|을|를|은|는|이|가)$/u, '')
    .trim();
}

/**
 * Produces a useful 생활 태그 when the model omitted one. It removes the
 * amount, merchant, category, and payment source, leaving purchase details such
 * as "아이신발" from "36000원 쿠팡 아이신발 구매 급여계좌".
 */
export function extractDetailTags(
  text: string,
  excludedTerms: string[] = [],
  limit = 5,
): string[] {
  const excluded = new Set(excludedTerms.map(normalizePaymentAlias).filter(Boolean));
  const seen = new Set<string>();
  const tags: string[] = [];
  const withoutAmounts = String(text || '')
    .replace(/\d[\d,]*(?:\.\d+)?\s*(?:억|만|천|백|십)?\s*원?/g, ' ')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ');

  for (const rawToken of withoutAmounts.split(/[\s,/#]+/)) {
    const token = cleanTagToken(rawToken);
    const normalized = normalizePaymentAlias(token);
    if (
      token.length < 2
      || token.length > 30
      || TAG_STOP_WORDS.has(token)
      || excluded.has(normalized)
      || /(?:카드|계좌|통장)$/.test(token)
      || seen.has(normalized)
    ) continue;

    seen.add(normalized);
    tags.push(token);
    if (tags.length >= limit) break;
  }

  return tags;
}

export function sanitizeSuggestedTags(tags: unknown, excludedTerms: string[] = []): string[] {
  if (!Array.isArray(tags)) return [];
  return extractDetailTags(tags.map(tag => String(tag || '')).join(' '), excludedTerms);
}
