import { isObject, type Loose } from './inputs';
import { logger } from './logger';

/**
 * OpenAI Decisions API (POST /v1/decisions, public beta since 2026-10-06):
 * typed answers with probabilities for predefined questions. Used for fast
 * routing and per-merchant yes/no checks. Every caller has a fallback, so a
 * beta change or a key without access only makes those features slower.
 */

export type DecisionQuestion =
  | { type: 'predicate'; name: string; instructions: string }
  | { type: 'choice'; name: string; instructions: string; choices: Array<{ value: string; description: string }> };

export type DecisionAnswer =
  | { type: 'predicate'; name: string; probability: number }
  | { type: 'choice'; name: string; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'refusal'; name: string };

export class DecisionUnavailableError extends Error {}

const finite01 = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Validates answers against the questions; anything inconsistent is rejected as a whole. */
export function parseDecisionAnswers(payload: Loose, questions: DecisionQuestion[]): DecisionAnswer[] {
  const raw = Array.isArray(payload?.answers) ? payload.answers : null;
  if (!raw || raw.length !== questions.length) throw new DecisionUnavailableError('answer count mismatch');
  return questions.map((question, index) => {
    const answer = raw[index];
    if (!isObject(answer)) throw new DecisionUnavailableError('answer is not an object');
    if (answer.type === 'refusal') return { type: 'refusal', name: question.name };
    if (answer.type !== question.type) throw new DecisionUnavailableError('answer type mismatch');
    if (question.type === 'predicate') {
      if (!finite01(answer.probability)) throw new DecisionUnavailableError('invalid probability');
      return { type: 'predicate', name: question.name, probability: answer.probability as number };
    }
    const allowed = new Set(question.choices.map(choice => choice.value));
    const choice = String(answer.choice);
    if (!allowed.has(choice) || !finite01(answer.confidence) || !Array.isArray(answer.probabilities)) {
      throw new DecisionUnavailableError('invalid choice answer');
    }
    const probabilities: Record<string, number> = {};
    for (const entry of answer.probabilities as Loose[]) {
      if (isObject(entry) && allowed.has(String(entry.value)) && finite01(entry.probability)) {
        probabilities[String(entry.value)] = entry.probability as number;
      }
    }
    return { type: 'choice', name: question.name, choice, confidence: answer.confidence as number, probabilities };
  });
}

export async function requestDecisions(
  fetchImpl: typeof fetch,
  input: string,
  questions: DecisionQuestion[],
  { timeoutMs = 8_000 }: { timeoutMs?: number } = {},
): Promise<DecisionAnswer[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new DecisionUnavailableError('OPENAI_API_KEY missing');
  const model = process.env.OPENAI_DECISION_MODEL?.trim() || 'gpt-6-luna';
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/decisions', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, questions }),
    });
  } catch (error) {
    logger.warn('Decisions API unreachable:', error instanceof Error ? error.message : error);
    throw new DecisionUnavailableError('unreachable');
  }
  const raw = await response.text();
  if (!response.ok) {
    // 403 "not enabled" during the beta is expected; the log shows whether access arrived.
    logger.warn('Decisions API error:', { status: response.status, body: raw.slice(0, 300) });
    throw new DecisionUnavailableError(`HTTP ${response.status}`);
  }
  let payload: Loose;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new DecisionUnavailableError('invalid JSON');
  }
  const answers = parseDecisionAnswers(payload, questions);
  logger.info('Decisions API ok', { questions: questions.length, latencyMs: Date.now() - started });
  return answers;
}
