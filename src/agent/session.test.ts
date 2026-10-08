import { describe, expect, it } from 'vitest';
import { itemsForRequest, type AgentItem } from './session';

const user = (content: string): AgentItem => ({ type: 'message', role: 'user', content });
const reasoning = (id: string): AgentItem => ({ type: 'reasoning', id, encrypted_content: 'x'.repeat(10), summary: [] });

describe('agent request trimming', () => {
  it('drops reasoning from earlier turns but keeps it in the current one', () => {
    const items: AgentItem[] = [user('a'), reasoning('r1'), { type: 'message', role: 'assistant', content: 'A' }, user('b'), reasoning('r2')];
    expect(itemsForRequest(items)).toEqual([user('a'), { type: 'message', role: 'assistant', content: 'A' }, user('b'), reasoning('r2')]);
  });

  it('drops whole old turns when the conversation is too large', () => {
    const big = 'y'.repeat(300_000);
    const items: AgentItem[] = [user(big), { type: 'message', role: 'assistant', content: big }, user('최근 질문')];
    expect(itemsForRequest(items)).toEqual([user('최근 질문')]);
  });
});
