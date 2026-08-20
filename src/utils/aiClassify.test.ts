import { describe, expect, it } from 'vitest';
import { extractExplicitKrwAmount, needsAiDateResolution } from './aiClassify';

describe('AI sentence fast path', () => {
  it.each([
    ['이마트 5만 2천 원', 52_000],
    ['배민 2만 4천 9백 원', 24_900],
    ['월급 350만 원', 3_500_000],
    ['택시 13,500원', 13_500],
    ['금액이 없는 문장', 0],
  ])('extracts explicit Korean won amounts from %s', (text, expected) => {
    expect(extractExplicitKrwAmount(text)).toBe(expected);
  });

  it('keeps relative dates on the AI path', () => {
    expect(needsAiDateResolution('어제 배민 2만원')).toBe(true);
    expect(needsAiDateResolution('오늘 배민 2만원')).toBe(false);
  });
});
