import type { ReceiptRecord, Transaction } from '../types';

/**
 * The OCR text of a receipt can reach 5,000 characters and is read only in the
 * receipt detail screen, so the local cache leaves it out. The copy in the
 * cache is marked, and writing such a transaction back must not erase the
 * original text in Firestore (see {@link toCloudTransactionWrite}).
 */
export function stripReceiptBulk<T extends Transaction>(transaction: T): T {
  const receipt = transaction.receipt;
  if (!receipt || receipt.rawText == null) return transaction;
  const { rawText: _rawText, ...rest } = receipt;
  return { ...transaction, receipt: { ...rest, rawTextOmitted: true } };
}

/**
 * Prepares a transaction for Firestore. A cached copy without its OCR text is
 * written with `merge` and without the bookkeeping flag, so the stored
 * `receipt.rawText` survives an edit made from the cache.
 */
export function toCloudTransactionWrite(data: Record<string, unknown>): { data: Record<string, unknown>; merge: boolean } {
  const receipt = data.receipt as (ReceiptRecord & { rawTextOmitted?: boolean }) | null | undefined;
  if (!receipt || typeof receipt !== 'object' || !receipt.rawTextOmitted) return { data, merge: false };
  const { rawTextOmitted: _flag, ...cleanReceipt } = receipt;
  return { data: { ...data, receipt: cleanReceipt }, merge: true };
}
