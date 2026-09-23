import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MigrationFailedScreen } from './MigrationFailedScreen';

describe('MigrationFailedScreen', () => {
  const markup = renderToStaticMarkup(<MigrationFailedScreen onRetry={() => undefined} />);

  it('explains that verification failed and the original data is untouched', () => {
    expect(markup).toContain('기존 데이터 이전 검증에 실패했습니다');
    expect(markup).toContain('원본은 그대로 있습니다');
    expect(markup).toContain('관리자에게 알려 주세요');
  });

  it('offers only a retry action', () => {
    const buttons = markup.match(/<button\b/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(markup).toContain('다시 시도');
  });

  it('is announced as an alert', () => {
    expect(markup).toContain('role="alert"');
  });
});
