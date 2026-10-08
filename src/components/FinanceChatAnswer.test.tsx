import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinanceChatAnswer } from './FinanceChatAnswer';

describe('FinanceChatAnswer', () => {
  it('renders the finance response hierarchy without injecting raw HTML', () => {
    const markup = renderToStaticMarkup(
      <FinanceChatAnswer
        text={`## 한눈에 보기
이번 달 지출은 **123,000원**입니다.

## 근거
- 식비 70,000원
- 교통비 53,000원

## 다음 행동
1. 이번 주 외식을 한 번 줄이기
2. 교통비 예산을 확인하기

<script>alert('x')</script>`}
      />,
    );

    expect(markup).toContain('<h4');
    expect(markup).toContain('<strong');
    expect(markup).toContain('<ul');
    expect(markup).toContain('<ol');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).not.toContain('<script>');
  });
});
