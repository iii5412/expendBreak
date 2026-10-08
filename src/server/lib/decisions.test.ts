import { describe, expect, it } from 'vitest';
import { DecisionUnavailableError, parseDecisionAnswers, type DecisionQuestion } from './decisions';

const questions: DecisionQuestion[] = [
  { type: 'predicate', name: 'm0', instructions: '배달?' },
  { type: 'choice', name: 'intent', instructions: '의도?', choices: [{ value: 'add', description: '기록' }, { value: 'edit', description: '수정' }] },
];

describe('decision answers', () => {
  it('reads predicate probabilities and choice distributions in question order', () => {
    expect(parseDecisionAnswers({
      answers: [
        { type: 'predicate', name: 'm0', probability: 0.9 },
        { type: 'choice', name: 'intent', choice: 'add', confidence: 0.97, probabilities: [{ value: 'add', probability: 0.97 }, { value: 'edit', probability: 0.03 }] },
      ],
    }, questions)).toEqual([
      { type: 'predicate', name: 'm0', probability: 0.9 },
      { type: 'choice', name: 'intent', choice: 'add', confidence: 0.97, probabilities: { add: 0.97, edit: 0.03 } },
    ]);
  });

  it('keeps a refusal as its own answer instead of reading it as no', () => {
    expect(parseDecisionAnswers({ answers: [{ type: 'refusal' }, { type: 'refusal' }] }, questions)[0]).toEqual({ type: 'refusal', name: 'm0' });
  });

  it('rejects missing answers, unknown choices and impossible probabilities', () => {
    expect(() => parseDecisionAnswers({ answers: [] }, questions)).toThrow(DecisionUnavailableError);
    expect(() => parseDecisionAnswers({ answers: [{ type: 'predicate', probability: 1.4 }, { type: 'refusal' }] }, questions)).toThrow(DecisionUnavailableError);
    expect(() => parseDecisionAnswers({
      answers: [{ type: 'predicate', probability: 0.2 }, { type: 'choice', choice: 'delete_all', confidence: 0.9, probabilities: [] }],
    }, questions)).toThrow(DecisionUnavailableError);
  });
});
