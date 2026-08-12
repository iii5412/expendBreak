import { PaymentCard, RecurringTemplate } from '../types';

const normalizeText = (value: string) => value.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const CARD_BILL_PATTERN = /(카드대금|카드값|카드결제금액|신용카드결제)/;

/**
 * Finds legacy manual templates that duplicate an automatically generated
 * credit-card settlement for the same linked account.
 */
export function getDuplicateManualCardSettlementTemplateIds(
  templates: RecurringTemplate[],
  cards: PaymentCard[],
): Set<string> {
  const creditCards = cards.filter(card => card.cardType === 'credit' && card.linkedAccountId);
  return new Set(templates.filter(template => {
    if (!template.active || template.type !== 'expense' || template.paymentMethodType !== 'account' || !template.accountId) {
      return false;
    }
    const description = normalizeText(`${template.name} ${template.counterparty}`);
    if (!CARD_BILL_PATTERN.test(description)) return false;

    return creditCards.some(card => {
      if (card.linkedAccountId !== template.accountId) return false;
      const cardName = normalizeText(card.cardName);
      const cardCompany = normalizeText(card.cardCompany);
      return (cardName.length >= 2 && description.includes(cardName))
        || (cardCompany.length >= 2 && description.includes(cardCompany));
    });
  }).map(template => template.id));
}
