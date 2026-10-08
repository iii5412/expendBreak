import { authenticatedFetch } from '../utils/auth';
import {
  executeAgentTool, finishCriterionLookup, prepareCriterionLookup,
  type AgentDataContext, type AgentProposal, type AgentToolResult,
} from './executor';
import { APP_NOTICE_PREFIX, type AgentItem, type AgentScreen } from './tools';

export type { AgentItem };

/**
 * The Agent conversation lives outside React: open_screen switches tabs, which
 * unmounts the AI screen, and the conversation (and a request in flight) must
 * survive that. It is memory-only and cleared on lock, so nothing about the
 * conversation is written to the device or the server.
 */


export type ProposalStatus = 'pending' | 'running' | 'approved' | 'rejected' | 'failed' | 'undone';

export type AgentEntry =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'proposal'; proposal: AgentProposal; status: ProposalStatus; message?: string }
  | { id: string; kind: 'activity'; text: string };

export interface AgentSessionState {
  items: AgentItem[];
  entries: AgentEntry[];
  busy: boolean;
  error: string | null;
}

export interface AgentRunHooks {
  getContext(): AgentDataContext;
  navigate(screen: AgentScreen): void;
  /** Opens the entry form with the sentence already analysed (fast path for plain entries). */
  quickAdd?(text: string): void;
}

const MAX_STEPS = 8;
const REQUEST_TIMEOUT_MS = 70_000;
// UTF-8 bytes; the server accepts up to 1mb on this path, so leave headroom.
const MAX_REQUEST_BYTES = 800_000;
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const TOOL_ACTIVITY: Record<string, string> = {
  get_overview: '이번 주기 현황 확인',
  find_by_criterion: '가맹점별로 기준 판단',
  get_reference_data: '카테고리·계좌·카드 확인',
  search_transactions: '거래 찾는 중',
  summarize_transactions: '합계 계산 중',
  list_recurring: '고정지출 확인',
  open_screen: '화면 이동',
};

let state: AgentSessionState = { items: [], entries: [], busy: false, error: null };
const listeners = new Set<() => void>();
let generation = 0;
let counter = 0;
const entryId = () => `e${Date.now().toString(36)}${(counter++).toString(36)}`;

function set(next: Partial<AgentSessionState>) {
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
}

export const agentSession = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

/** Forgets the conversation; an in-flight request finishes into the void. */
export function clearAgentSession() {
  generation += 1;
  set({ items: [], entries: [], busy: false, error: null });
}

export function updateProposalEntry(proposalId: string, status: ProposalStatus, message?: string) {
  set({
    entries: state.entries.map(entry => entry.kind === 'proposal' && entry.proposal.id === proposalId
      ? { ...entry, status, message }
      : entry),
  });
}

/** Tells the model, on its next step, what the user did with a proposal card. */
export function recordProposalOutcome(proposal: AgentProposal, outcome: string) {
  set({
    items: [...state.items, {
      type: 'message',
      role: 'developer',
      content: `${APP_NOTICE_PREFIX} 제안 ${proposal.id}(${proposal.title}): ${outcome}`,
    }],
  });
}

/**
 * Trims what is sent so long conversations stay under the request limit:
 * whole turns are dropped from the oldest, and reasoning from earlier turns is
 * omitted because the model only needs it within the current turn.
 */
export function itemsForRequest(items: AgentItem[]): AgentItem[] {
  const userStarts = items
    .map((item, index) => (item.type === 'message' && item.role === 'user' ? index : -1))
    .filter(index => index >= 0);
  const lastUser = userStarts[userStarts.length - 1] ?? 0;
  const slim = (from: number) => items
    .slice(from)
    .filter((item, offset) => item.type !== 'reasoning' || from + offset > lastUser);
  for (const start of userStarts) {
    const candidate = slim(start);
    if (candidate.length <= 150 && byteLength(candidate) <= MAX_REQUEST_BYTES) return candidate;
  }
  return slim(lastUser);
}

async function requestStep(items: AgentItem[]) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await authenticatedFetch('/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ items: itemsForRequest(items) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Agent 응답을 받지 못했습니다.');
    return Array.isArray(data.output) ? data.output as AgentItem[] : [];
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('응답이 늦어 중단했습니다. 다시 시도해 주세요.', { cause: error });
    }
    // fetch rejects with a TypeError only when no response arrived at all.
    if (error instanceof TypeError) {
      throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function sendAgentMessage(text: string, hooks: AgentRunHooks) {
  const message = text.trim().slice(0, 4_000);
  if (!message || state.busy) return;
  if (hooks.quickAdd && await routeToEntryForm(message, hooks.quickAdd)) return;
  set({
    items: [...state.items, { type: 'message', role: 'user', content: message }],
    entries: [...state.entries, { id: entryId(), kind: 'user', text: message }],
  });
  await runAgentLoop(hooks);
}

const QUICK_ADD_CONFIDENCE = 0.85;

/**
 * A plain entry such as "스타벅스 5800 신한카드" goes straight to the existing
 * AI 문장 entry form: one fast analysis instead of several Agent steps. Only
 * clear cases qualify (an amount in the text, high confidence, nothing
 * waiting for approval); anything else, or any failure, goes to the Agent.
 */
async function routeToEntryForm(message: string, quickAdd: (text: string) => void): Promise<boolean> {
  if (!/\d/.test(message)) return false;
  if (state.entries.some(entry => entry.kind === 'proposal' && entry.status === 'pending')) return false;
  set({ busy: true, error: null });
  let intent: { available?: boolean; intent?: string; confidence?: number } = {};
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await authenticatedFetch('/api/ai/agent/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ text: message }),
      });
      if (response.ok) intent = await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  } catch {
    // Routing is an optimisation; the Agent handles the message instead.
  } finally {
    set({ busy: false });
  }
  if (!intent.available || intent.intent !== 'add' || (intent.confidence ?? 0) < QUICK_ADD_CONFIDENCE) return false;
  set({
    entries: [
      ...state.entries,
      { id: entryId(), kind: 'user', text: message },
      { id: entryId(), kind: 'activity', text: '새 기록으로 판단해 입력 화면에서 분석했습니다' },
    ],
  });
  quickAdd(message);
  return true;
}

/** Asks the server about each distinct merchant name; only names are sent. */
async function runCriterionTool(rawArgs: string, ctx: AgentDataContext): Promise<AgentToolResult> {
  const lookup = prepareCriterionLookup(rawArgs, ctx);
  if (typeof lookup === 'string') return { output: { error: lookup } };
  const unavailable = { output: { error: '가맹점 판단 서비스를 지금 쓸 수 없습니다. search_transactions로 후보를 찾아 직접 판단하세요.' } };
  try {
    const response = await authenticatedFetch('/api/ai/agent/criterion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ criterion: lookup.criterion, merchants: lookup.merchants }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.available || !Array.isArray(data.results)) return unavailable;
    const probabilities = new Map<string, number | null>(
      (data.results as Array<{ merchant: string; probability: number | null }>).map(item => [item.merchant, item.probability]),
    );
    return { output: finishCriterionLookup(lookup, probabilities, ctx) };
  } catch {
    return unavailable;
  }
}

/**
 * Picks up where a failed step stopped. The conversation always ends at a
 * point the model can continue from (the user message or the last tool
 * results), so retrying just asks for the next step again.
 */
export async function retryAgent(hooks: AgentRunHooks) {
  if (state.busy || !state.error) return;
  await runAgentLoop(hooks);
}

async function runAgentLoop(hooks: AgentRunHooks) {
  const run = generation;
  const alive = () => run === generation;
  set({ busy: true, error: null });

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const output = await requestStep(state.items);
      if (!alive()) return;
      const calls = output.filter((item): item is Extract<AgentItem, { type: 'function_call' }> => item.type === 'function_call');
      const replies = output.filter((item): item is Extract<AgentItem, { type: 'message' }> => item.type === 'message');
      set({
        items: [...state.items, ...output],
        entries: [...state.entries, ...replies.map(reply => ({ id: entryId(), kind: 'assistant' as const, text: reply.content }))],
      });
      if (calls.length === 0) return;

      const outputs: AgentItem[] = [];
      const newEntries: AgentEntry[] = [];
      for (const call of calls) {
        let result;
        try {
          result = call.name === 'find_by_criterion'
            ? await runCriterionTool(call.arguments, hooks.getContext())
            : executeAgentTool(call.name, call.arguments, hooks.getContext());
        } catch (error) {
          result = { output: { error: error instanceof Error ? error.message : '도구 실행 중 오류가 발생했습니다.' } };
        }
        if (result.navigate) hooks.navigate(result.navigate);
        if (result.proposal) {
          newEntries.push({ id: entryId(), kind: 'proposal', proposal: result.proposal, status: 'pending' });
        } else if (TOOL_ACTIVITY[call.name]) {
          newEntries.push({ id: entryId(), kind: 'activity', text: TOOL_ACTIVITY[call.name] });
        }
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result.output) });
      }
      set({ items: [...state.items, ...outputs], entries: [...state.entries, ...newEntries] });
    }
    if (alive()) {
      set({ entries: [...state.entries, { id: entryId(), kind: 'assistant', text: '확인할 내용이 많아 여기서 멈췄습니다. 범위를 좁혀 다시 요청해 주세요.' }] });
    }
  } catch (error) {
    if (alive()) set({ error: error instanceof Error ? error.message : 'Agent 처리 중 오류가 발생했습니다.' });
  } finally {
    if (alive()) set({ busy: false });
  }
}
