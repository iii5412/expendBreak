import { describe, expect, it } from 'vitest';
import { normalizeTags } from './receipt';

describe('receipt record helpers', () => {
  it('normalizes comma and hash separated tags without duplicates', () => {
    expect(normalizeTags('식비, 가족 #식비, 주말')).toEqual(['식비', '가족', '주말']);
  });

  it('limits the number and length of tags', () => {
    const tags = normalizeTags(Array.from({ length: 12 }, (_, index) => `${index}-${'가'.repeat(40)}`));
    expect(tags).toHaveLength(10);
    expect(tags.every(tag => tag.length <= 30)).toBe(true);
  });
});
