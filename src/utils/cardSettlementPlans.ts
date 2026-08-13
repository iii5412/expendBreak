import { PaymentCard, RecurringTemplate } from '../types';

const normalizeText = (value: string) => value.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const CARD_BILL_PATTERN = /(카드대금|카드값|카드결제금액|신용카드결제|카드결제)/;
const CARD_WORD_PATTERN = /(카드|card)/;
/** A manual bill and the generated one rarely match to the won, but they stay close. */
const AMOUNT_SIMILARITY_TOLERANCE = 0.2;

export type CardSettlementLinkStatus =
  /** Confirmed by the user, or a confident name match: the generated bill replaces it. */
  | 'replaced'
  /** Looks like a card bill but is not confident enough to hide. Still counted, so the
   *  user is warned it may be charged twice. */
  | 'needs_review';

export interface ManualCardSettlementCandidate {
  templateId: string;
  templateName: string;
  cardId: string;
  cardName: string;
  status: CardSettlementLinkStatus;
  /** Why it was flagged, shown to the user so the suggestion is checkable. */
  reason: 'user_confirmed' | 'name_match' | 'account_and_amount_match';
}

interface DetectOptions {
  /** Generated bill per card for the cycle, used for the amount heuristic. */
  cardSettlementAmounts?: Record<string, number>;
}

/**
 * Manual "카드대금" recurring items that overlap the generated credit-card bill.
 *
 * These used to be hidden purely on a name pattern. Hiding is the safe direction
 * — the generated bill already covers the money — but the pattern is narrow, and
 * an item named just "신한카드" slipped through to be charged twice: once as an
 * account transfer, once as the generated bill. So detection now reports two
 * confidence levels and the ambiguous ones surface for the user to classify
 * instead of being silently resolved either way.
 */
export function findManualCardSettlementCandidates(
  templates: RecurringTemplate[],
  cards: PaymentCard[],
  options: DetectOptions = {},
): ManualCardSettlementCandidate[] {
  const creditCards = cards.filter(card => card.cardType === 'credit');
  const cardById = new Map(creditCards.map(card => [card.id, card]));
  const candidates: ManualCardSettlementCandidate[] = [];

  for (const template of templates) {
    if (!template.active || template.type !== 'expense') continue;

    // An explicit decision always wins over any heuristic.
    if (template.cardSettlementCardId) {
      const card = cardById.get(template.cardSettlementCardId);
      if (card) {
        candidates.push({
          templateId: template.id,
          templateName: template.name,
          cardId: card.id,
          cardName: card.cardName,
          status: 'replaced',
          reason: 'user_confirmed',
        });
      }
      continue;
    }
    if (template.cardSettlementReviewedAt) continue; // user said it is a separate expense

    if (template.paymentMethodType !== 'account' || !template.accountId) continue;
    const description = normalizeText(`${template.name} ${template.counterparty}`);
    const linkedCards = creditCards.filter(card => card.linkedAccountId === template.accountId);
    if (linkedCards.length === 0) continue;

    // Confident: says "카드대금" and names the card or its issuer.
    const namedCard = CARD_BILL_PATTERN.test(description)
      ? linkedCards.find(card => {
          const cardName = normalizeText(card.cardName);
          const cardCompany = normalizeText(card.cardCompany);
          return (cardName.length >= 2 && description.includes(cardName))
            || (cardCompany.length >= 2 && description.includes(cardCompany));
        })
      : undefined;

    if (namedCard) {
      candidates.push({
        templateId: template.id,
        templateName: template.name,
        cardId: namedCard.id,
        cardName: namedCard.cardName,
        status: 'replaced',
        reason: 'name_match',
      });
      continue;
    }

    // Weaker: paid from a card's settlement account, mentions a card, and its
    // amount is close to that card's generated bill. Requiring all three keeps
    // ordinary fixed expenses drawn from the same account out of the warning.
    if (!CARD_WORD_PATTERN.test(description)) continue;
    const settlementAmounts = options.cardSettlementAmounts || {};
    const similarCard = linkedCards.find(card => {
      const billed = settlementAmounts[card.id];
      if (!billed || billed <= 0 || template.defaultAmount <= 0) return false;
      return Math.abs(template.defaultAmount - billed) / billed <= AMOUNT_SIMILARITY_TOLERANCE;
    });
    if (!similarCard) continue;

    candidates.push({
      templateId: template.id,
      templateName: template.name,
      cardId: similarCard.id,
      cardName: similarCard.cardName,
      status: 'needs_review',
      reason: 'account_and_amount_match',
    });
  }

  return candidates;
}

/** Templates the generated card bill stands in for, so planning must skip them. */
export function getDuplicateManualCardSettlementTemplateIds(
  templates: RecurringTemplate[],
  cards: PaymentCard[],
  options: DetectOptions = {},
): Set<string> {
  return new Set(
    findManualCardSettlementCandidates(templates, cards, options)
      .filter(candidate => candidate.status === 'replaced')
      .map(candidate => candidate.templateId),
  );
}
