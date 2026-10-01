/**
 * The server tags every response with `X-Request-Id`. Keeping the ids of recent
 * failed API calls lets a diagnostic export be matched to the server log line
 * of the same request.
 */
export interface FailedRequestRecord {
  at: string;
  method: string;
  path: string;
  status: number;
  requestId: string | null;
}

const MAX_RECORDS = 20;
let records: FailedRequestRecord[] = [];

export function recordFailedRequest(input: { method?: string; url: string; status: number; requestId: string | null }, now = new Date()) {
  let path = input.url;
  try {
    // Only the path is kept: query strings may carry user input.
    path = new URL(input.url, 'http://local').pathname;
  } catch {
    // A malformed URL is recorded as given.
  }
  records = [...records, { at: now.toISOString(), method: (input.method || 'GET').toUpperCase(), path, status: input.status, requestId: input.requestId }]
    .slice(-MAX_RECORDS);
}

export const getRecentFailedRequests = (): FailedRequestRecord[] => [...records];

export function clearFailedRequests() {
  records = [];
}
