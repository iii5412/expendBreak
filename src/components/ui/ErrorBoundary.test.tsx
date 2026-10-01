import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// The repo has no DOM test environment, so the boundary is exercised through
// its state transitions and the markup of each state.
const markup = (props: React.ComponentProps<typeof ErrorBoundary>, error: Error | null) => {
  class Seeded extends ErrorBoundary {
    state = { error };
  }
  return renderToStaticMarkup(<Seeded {...props} />);
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: new Map<string, string>(),
      getItem(key: string) { return this.store.get(key) ?? null; },
      setItem(key: string, value: string) { this.store.set(key, value); },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('renders children until something throws', () => {
    expect(markup({ scope: 'analytics', children: <p>chart</p> }, null)).toContain('chart');
  });

  it('turns a thrown error into state, not a crash', () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error('corrupt cache'));
    expect(state.error?.message).toBe('corrupt cache');
    expect(ErrorBoundary.getDerivedStateFromError('plain').error).toBeInstanceOf(Error);
  });

  it('shows the screen fallback with a retry button and hides the failed children', () => {
    const html = markup({ scope: 'analytics', children: <p>chart</p> }, new Error('x'));
    expect(html).toContain('이 화면을 표시하지 못했습니다.');
    expect(html).toContain('입력한 데이터는 안전합니다');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('chart');
  });

  it('offers reload and cache reset only at app level', () => {
    const html = markup({ scope: 'app', level: 'app', children: null }, new Error('x'));
    expect(html).toContain('다시 불러오기');
    expect(html).toContain('캐시 비우고 다시 시작');
  });

  it('offers a close button for a modal when it can be closed', () => {
    const html = markup({ scope: 'add', level: 'modal', onClose: () => undefined, children: null }, new Error('x'));
    expect(html).toContain('닫기');
  });

  it('records the error with its component stack', () => {
    const boundary = new ErrorBoundary({ scope: 'analytics', children: null });
    boundary.componentDidCatch(new Error('boom'), { componentStack: '\n    at Chart' } as React.ErrorInfo);
    const stored = JSON.parse(localStorage.getItem('eb_render_errors')!);
    expect(stored[0]).toMatchObject({ scope: 'analytics', message: 'boom', componentStack: 'at Chart' });
  });
});
