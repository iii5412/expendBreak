/**
 * Request bodies and model replies arrive as untyped JSON. These aliases let
 * the routes read them without `any`: every property is `unknown` until it has
 * been checked, exactly as the hand-written validation already does.
 */
export type LooseObject = Record<string, unknown>;

/** An element of untrusted JSON: possibly null or a primitive, so reads use `?.`. */
export type Loose = LooseObject | null | undefined;

export const isObject = (value: unknown): value is LooseObject => typeof value === 'object' && value !== null;

/** The parsed JSON body as an object; anything else reads as an empty body. */
export const bodyObject = (body: unknown): LooseObject => (isObject(body) ? body : {});

export type CategoryInput = { id: string; name: string; type: 'income' | 'expense' };
export type MerchantRuleInput = { pattern: string; categoryId: string };
export type BankAccountInput = { id: string; bankName: string; accountName: string };
export type PaymentCardInput = { id: string; cardName: string; cardCompany: string };

export const isCategoryInput = (value: Loose): value is CategoryInput =>
  typeof value?.id === 'string'
  && typeof value?.name === 'string'
  && (value?.type === 'income' || value?.type === 'expense');

export const isMerchantRuleInput = (value: Loose): value is MerchantRuleInput =>
  typeof value?.pattern === 'string' && typeof value?.categoryId === 'string';

import { z } from 'zod';

const jsonObject = z.record(z.string(), z.unknown());
const jsonObjectList = z.array(z.record(z.string(), z.unknown()));

/** Parses a model reply that must be a JSON object; anything else throws, like malformed JSON always did. */
export function parseModelObject(text: string): LooseObject {
  return jsonObject.parse(JSON.parse(text));
}

/** Parses a model reply that must be a JSON array of objects. */
export function parseModelObjectList(text: string): LooseObject[] {
  return jsonObjectList.parse(JSON.parse(text));
}
