import { authenticatedFetch } from '../utils/auth';
import { executeAgentTool, type AgentDataContext, type AgentProposal } from './executor';
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
}

const MAX_STEPS = 8;
const REQUEST_TIMEOUT_MS = 70_000;
const MAX_REQUEST_CHARS = 450_000;

const TOOL_ACTIVITY: Record<string, string> = {
  get_overview: '이번 주기 현황 확인',
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
    if (candidate.length <= 150 && JSON.stringify(candidate).length <= MAX_REQUEST_CHARS) return candidate;
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
      throw new Error('응답이 늦어 중단했습니다. 잠시 후 다시 시도해 주세요.', { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function sendAgentMessage(text: string, hooks: AgentRunHooks) {
  const message = text.trim().slice(0, 4_000);
  if (!message || state.busy) return;
  const run = generation;
  const alive = () => run === generation;

  set({
    busy: true,
    error: null,
    items: [...state.items, { type: 'message', role: 'user', content: message }],
    entries: [...state.entries, { id: entryId(), kind: 'user', text: message }],
  });

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
          result = executeAgentTool(call.name, call.arguments, hooks.getContext());
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
