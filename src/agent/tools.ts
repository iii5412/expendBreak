/**
 * Tools the finance Agent may call. Shared by the server (sent to the model as
 * function definitions) and the app (which executes them on the data it
 * already holds). Schemas use OpenAI strict mode: every property is listed in
 * `required` and optional values are nullable.
 *
 * Kinds:
 * - read: answered immediately from local data.
 * - navigate: switches the app screen.
 * - write: never executed by the model. It only produces a proposal card the
 *   user must approve (AGENTS.md: AI-created changes go through confirmation).
 */

export type AgentToolKind = 'read' | 'navigate' | 'write';

export interface AgentToolDefinition {
  name: string;
  kind: AgentToolKind;
  description: string;
  parameters: Record<string, unknown>;
}

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra });
const date = (description: string) => nullable('string', { description: `${description} (YYYY-MM-DD)` });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

export const AGENT_SCREENS = ['home', 'recurring_payment', 'history', 'analytics', 'ai', 'accounts', 'management'] as const;
export type AgentScreen = typeof AGENT_SCREENS[number];

const paymentFields = {
  paymentMethodType: nullable('string', { enum: ['account', 'card', 'cash', 'other', null], description: '결제수단. 계좌/카드면 accountId/cardId도 지정' }),
  accountId: nullable('string', { description: 'get_reference_data의 계좌 id' }),
  cardId: nullable('string', { description: 'get_reference_data의 카드 id' }),
};

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    name: 'get_overview',
    kind: 'read',
    description: '오늘 날짜, 현재 급여 주기, 이번 주기 수입·지출·남은 생활비, 고정지출 처리 현황 요약을 조회한다. 대화 시작 시 먼저 호출하면 좋다.',
    parameters: object({}),
  },
  {
    name: 'get_reference_data',
    kind: 'read',
    description: '카테고리, 계좌, 카드 목록과 id를 조회한다. 거래를 추가·수정하기 전에 올바른 id를 찾을 때 사용한다.',
    parameters: object({}),
  },
  {
    name: 'search_transactions',
    kind: 'read',
    description: '조건에 맞는 거래를 최신순으로 찾는다. 수정·삭제할 거래의 id를 찾을 때도 사용한다.',
    parameters: object({
      from: date('시작일, 포함'),
      to: date('종료일, 포함'),
      text: nullable('string', { description: '사용처·메모·태그에 포함된 단어' }),
      type: nullable('string', { enum: ['income', 'expense', null] }),
      categoryId: nullable('string'),
      minAmount: nullable('integer'),
      maxAmount: nullable('integer'),
      limit: nullable('integer', { description: '최대 100, 기본 30' }),
    }),
  },
  {
    name: 'summarize_transactions',
    kind: 'read',
    description: '기간 안의 거래를 묶어서 합계와 건수를 계산한다. 비교나 분석 질문에 사용한다.',
    parameters: object({
      from: date('시작일, 포함'),
      to: date('종료일, 포함'),
      type: nullable('string', { enum: ['income', 'expense', null], description: '기본 expense' }),
      groupBy: { type: 'string', enum: ['category', 'merchant', 'cycle', 'day', 'payment'] },
    }),
  },
  {
    name: 'list_recurring',
    kind: 'read',
    description: '급여 주기 하나의 고정 수입·지출 일정과 금액, 처리 상태를 조회한다.',
    parameters: object({
      cycle: nullable('string', { description: '급여 주기 YYYY-MM. null이면 현재 주기' }),
    }),
  },
  {
    name: 'open_screen',
    kind: 'navigate',
    description: '앱 화면을 연다. 사용자가 화면을 보여달라고 하거나 직접 확인이 필요할 때 사용한다.',
    parameters: object({
      screen: { type: 'string', enum: [...AGENT_SCREENS], description: 'home 홈, recurring_payment 고정지출, history 내역, analytics 분석, ai AI, accounts 계좌·카드, management 설정' },
    }),
  },
  {
    name: 'propose_add_transaction',
    kind: 'write',
    description: '새 거래 추가를 제안한다. 사용자가 확인 카드에서 승인해야 저장된다.',
    parameters: object({
      type: { type: 'string', enum: ['income', 'expense'] },
      amount: { type: 'integer', description: '원 단위 양수' },
      localDate: { type: 'string', description: 'YYYY-MM-DD' },
      merchant: { type: 'string' },
      categoryId: { type: 'string', description: '거래 구분과 같은 유형의 카테고리 id' },
      memo: nullable('string'),
      ...paymentFields,
    }),
  },
  {
    name: 'propose_update_transaction',
    kind: 'write',
    description: '기존 거래 수정을 제안한다. 바꿀 항목만 값을 넣고 나머지는 null. 고정지출로 생긴 거래의 금액은 바꿀 수 없다.',
    parameters: object({
      transactionId: { type: 'string' },
      amount: nullable('integer'),
      localDate: nullable('string'),
      merchant: nullable('string'),
      categoryId: nullable('string'),
      memo: nullable('string'),
      ...paymentFields,
    }),
  },
  {
    name: 'propose_delete_transaction',
    kind: 'write',
    description: '거래 삭제를 제안한다. 고정지출 완료로 생긴 거래는 대신 고정지출 화면에서 완료를 취소해야 한다.',
    parameters: object({ transactionId: { type: 'string' } }),
  },
  {
    name: 'propose_set_recurring_amount',
    kind: 'write',
    description: '이번 주기 고정 항목의 금액 확정을 제안한다. 아직 완료되지 않은 항목만 가능하다.',
    parameters: object({
      occurrenceId: { type: 'string' },
      amount: { type: 'integer', description: '원 단위, 0 이상' },
    }),
  },
  {
    name: 'propose_complete_recurring',
    kind: 'write',
    description: '고정 항목을 납부·입금 완료로 처리하도록 제안한다. 승인되면 거래가 생성된다.',
    parameters: object({
      occurrenceId: { type: 'string' },
      amount: nullable('integer', { description: 'null이면 확정된 금액 사용' }),
      paidOn: date('실제 납부일. null이면 오늘'),
    }),
  },
  {
    name: 'propose_skip_recurring',
    kind: 'write',
    description: '고정 항목을 이번 주기에서 제외하도록 제안한다. 원본 항목과 다른 달 일정은 유지된다.',
    parameters: object({ occurrenceId: { type: 'string' } }),
  },
];

export const AGENT_TOOL_KINDS: Record<string, AgentToolKind> = Object.fromEntries(
  AGENT_TOOLS.map(tool => [tool.name, tool.kind]),
);

/** Function definitions in the OpenAI Responses API format. */
export function toOpenAITools() {
  return AGENT_TOOLS.map(tool => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }));
}

/**
 * One entry of the conversation the app sends to /api/ai/agent. Reasoning is
 * the model's encrypted state, passed back unchanged within a turn.
 */
export type AgentItem =
  | { type: 'message'; role: 'user' | 'assistant' | 'developer'; content: string }
  | { type: 'reasoning'; id: string; encrypted_content: string; summary: [] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string; id?: string }
  | { type: 'function_call_output'; call_id: string; output: string };

/** Prefix of developer messages reporting what the user did with a proposal. */
export const APP_NOTICE_PREFIX = '[앱 알림]';
