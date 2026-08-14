/**
 * Bounds how much transaction history the app loads up front.
 *
 * The realtime subscription used to cover every transaction ever recorded, so
 * boot time grew with the ledger. Only the periods the dashboard actually
 * summarises need to be live; older history is fetched on demand when the user
 * navigates to it.
 */

import { Transaction } from '../types';
import { getAccountingPeriod, shiftYearMonth } from './calculations';

/** Accounting periods the live subscription covers, counting the current one. */
export const LIVE_TRANSACTION_PERIODS = 2;

/**
 * First `localDate` the live subscription includes. The previous period stays
 * live because card settlements and cycle closing both reach back into it.
 */
export function getTransactionWindowStart(
  yearMonth: string,
  monthStartDay: number,
  periodsBack: number = LIVE_TRANSACTION_PERIODS,
): string {
  const earliest = shiftYearMonth(yearMonth, -(Math.max(1, periodsBack) - 1));
  return getAccountingPeriod(earliest, monthStartDay).startDate;
}

function sortByOccurredAtDesc(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
}

/**
 * Combines a live snapshot with history the query could not see.
 *
 * The subscription only returns transactions on or after `windowStart`, so
 * writing its payload straight to the cache would erase every older
 * transaction that an on-demand fetch had already merged in.
 */
export function mergeTransactionWindow(
  cached: Transaction[],
  live: Transaction[],
  windowStart: string,
): Transaction[] {
  const liveIds = new Set(live.map(transaction => transaction.id));
  const archived = cached.filter(
    transaction => transaction.localDate < windowStart && !liveIds.has(transaction.id),
  );
  return sortByOccurredAtDesc([...archived, ...live]);
}

/**
 * Adds fetched history to the cache, letting the newly fetched copy win so a
 * refetch picks up edits made on another device.
 */
export function mergeFetchedHistory(cached: Transaction[], fetched: Transaction[]): Transaction[] {
  const fetchedIds = new Set(fetched.map(transaction => transaction.id));
  const kept = cached.filter(transaction => !fetchedIds.has(transaction.id));
  return sortByOccurredAtDesc([...kept, ...fetched]);
}
