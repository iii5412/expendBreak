import express from 'express';
import { createHmac } from 'node:crypto';
import { isObject, type Loose } from '../../lib/inputs';
import { logger } from '../../lib/logger';
import { AGENT_INSTRUCTIONS } from '../../prompts/agent';
import { AGENT_TOOL_KINDS, APP_NOTICE_PREFIX, toOpenAITools, type AgentItem } from '../../../agent/tools';
import type { RouteDeps } from '../types';

/**
 * One model step of the finance Agent. The app owns the loop: it sends the
 * conversation so far, runs any tool calls against its own data, appends the
 * results and calls again. The server only relays to the model, so it never
 * needs the user's ledger and never writes data itself.
 *
 * Nothing is stored (store: false). Reasoning comes back encrypted so the app
 * can pass it into the next step without the server keeping state.
 */


const MAX_ITEMS = 160;
const MAX_BODY_BYTES = 600_000;

const text = (value: unknown, max: number) => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
  .slice(0, max);
const id = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null);

/** Rebuilds each item from allowed fields only; anything else is dropped. */
export function sanitizeAgentItems(raw: unknown): AgentItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return null;
  const items: AgentItem[] = [];
  for (const entry of raw as Loose[]) {
    if (!isObject(entry)) return null;
    if (entry.type === 'message') {
      const role = entry.role;
      const content = text(entry.content, 20_000).trim();
      if (!content) continue;
      if (role === 'user' || role === 'assistant') items.push({ type: 'message', role, content });
      // The app reports approvals this way; free-form developer text is refused.
      else if (role === 'developer' && content.startsWith(APP_NOTICE_PREFIX)) items.push({ type: 'message', role, content: content.slice(0, 2_000) });
      else return null;
    } else if (entry.type === 'reasoning') {
      const itemId = id(entry.id);
      const encrypted = typeof entry.encrypted_content === 'string' ? entry.encrypted_content : '';
      if (itemId && encrypted && encrypted.length < 200_000) items.push({ type: 'reasoning', id: itemId, encrypted_content: encrypted, summary: [] });
    } else if (entry.type === 'function_call') {
      const callId = id(entry.call_id);
      const name = String(entry.name ?? '');
      if (!callId || !AGENT_TOOL_KINDS[name]) return null;
      const itemId = id(entry.id);
      items.push({ type: 'function_call', call_id: callId, name, arguments: text(entry.arguments, 20_000), ...(itemId ? { id: itemId } : {}) });
    } else if (entry.type === 'function_call_output') {
      const callId = id(entry.call_id);
      if (!callId) return null;
      items.push({ type: 'function_call_output', call_id: callId, output: text(entry.output, 60_000) });
    } else {
      return null;
    }
  }
  return items.some(item => item.type === 'message' && item.role === 'user') ? items : null;
}

function toModelInput(items: AgentItem[]) {
  return items.map(item => item.type === 'message' ? { role: item.role, content: item.content } : item);
}

/** Keeps only the output kinds the app understands. */
export function readAgentOutput(payload: Loose): AgentItem[] {
  if (!Array.isArray(payload?.output)) return [];
  const items: AgentItem[] = [];
  for (const item of payload.output as Loose[]) {
    if (!isObject(item)) continue;
    const itemId = id(item.id);
    if (item.type === 'message') {
      const content = (Array.isArray(item.content) ? item.content : [])
        .filter((part: Loose) => part?.type === 'output_text')
        .map((part: Loose) => text(part.text, 12_000))
        .join('\n')
        .trim();
      if (content) items.push({ type: 'message', role: 'assistant', content });
    } else if (item.type === 'reasoning' && itemId && typeof item.encrypted_content === 'string') {
      items.push({ type: 'reasoning', id: itemId, encrypted_content: item.encrypted_content, summary: [] });
    } else if (item.type === 'function_call') {
      const callId = id(item.call_id);
      const name = String(item.name ?? '');
      if (!callId || !AGENT_TOOL_KINDS[name]) continue;
      items.push({ type: 'function_call', call_id: callId, name, arguments: text(item.arguments, 20_000), ...(itemId ? { id: itemId } : {}) });
    }
  }
  return items;
}

export function createAgentRouter(deps: RouteDeps) {
  const router = express.Router();

  router.post('/agent', async (req, res) => {
    try {
      if (!deps.limiters.agent.consume(res.locals.ownerUid)) {
        return res.status(429).json({ message: 'Agent는 10분에 150단계까지 사용할 수 있습니다. 잠시 후 다시 시도해 주세요.' });
      }
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) return res.status(503).json({ message: 'Agent를 사용하려면 OPENAI_API_KEY를 설정해야 합니다.' });

      if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > MAX_BODY_BYTES) {
        return res.status(413).json({ message: '대화가 너무 길어졌습니다. 대화를 지우고 다시 시작해 주세요.' });
      }
      const items = sanitizeAgentItems(req.body?.items);
      if (!items) return res.status(400).json({ message: 'Agent 대화 형식이 올바르지 않습니다.' });

      const model = process.env.OPENAI_AGENT_MODEL?.trim() || process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-6-luna';
      const safetyIdentifier = createHmac('sha256', deps.sessionSecret).update(String(res.locals.ownerUid)).digest('hex');
      const response = await deps.fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': safetyIdentifier,
        },
        body: JSON.stringify({
          model,
          instructions: AGENT_INSTRUCTIONS,
          input: toModelInput(items),
          tools: toOpenAITools(),
          tool_choice: 'auto',
          parallel_tool_calls: true,
          reasoning: { effort: 'low' },
          text: { verbosity: 'low' },
          max_output_tokens: 6_000,
          store: false,
          include: ['reasoning.encrypted_content'],
        }),
      });
      const raw = await response.text();
      let payload: Loose = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        // Handled as a gateway failure below.
      }
      if (!response.ok) {
        logger.error('OpenAI agent error:', response.status, raw.slice(0, 500));
        return res.status(response.status === 429 ? 429 : 502).json({
          message: response.status === 429
            ? 'GPT 사용량이 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.'
            : text(isObject(payload?.error) ? payload.error.message : undefined, 300) || 'Agent 서버 연결에 실패했습니다.',
        });
      }

      const output = readAgentOutput(payload);
      if (!output.some(item => item.type === 'message' || item.type === 'function_call')) {
        const reason = isObject(payload.incomplete_details) ? payload.incomplete_details.reason : undefined;
        logger.warn('Agent returned no usable output:', { model, status: payload.status, reason });
        return res.status(502).json({ message: reason === 'max_output_tokens'
          ? '답변 생성 한도에 도달했습니다. 요청을 나눠서 다시 보내 주세요.'
          : 'Agent가 빈 답변을 반환했습니다. 다시 시도해 주세요.' });
      }
      return res.json({
        output,
        modelUsed: model,
        usage: isObject(payload.usage)
          ? { input: Number(payload.usage.input_tokens) || 0, output: Number(payload.usage.output_tokens) || 0 }
          : undefined,
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      logger.error('Agent route error:', error instanceof Error ? error.message : error);
      return res.status(timedOut ? 504 : 500).json({ message: timedOut ? 'Agent 응답이 늦어 중단했습니다. 다시 시도해 주세요.' : 'Agent 처리 중 오류가 발생했습니다.' });
    }
  });

  return router;
}
