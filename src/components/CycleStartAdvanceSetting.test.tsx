import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CycleStartAdvanceSetting } from './CycleStartAdvanceSetting';
import { FeedbackProvider } from './ui/FeedbackProvider';
import { configurePaydaySchedule } from '../utils/paydaySchedule';
import { UserProfile } from '../types';

afterEach(() => {
  configurePaydaySchedule(null);
  vi.useRealTimers();
});

const render = (profile: Partial<UserProfile>) => renderToStaticMarkup(
  <FeedbackProvider>
    <CycleStartAdvanceSetting
      userProfile={{ monthStartDay: 10, ...profile } as UserProfile}
      onUpdateUserProfile={() => undefined}
    />
  </FeedbackProvider>,
);

describe('CycleStartAdvanceSetting', () => {
  it('offers the next cycle up to a week before a weekend payday', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 9, 12) });
    const markup = render({});
    expect(markup).toContain('2026년 9월 주기');
    expect(markup).toContain('2026년 10월 주기');
    expect(markup).toContain('급여일 10/10(토)이 주말입니다');
    expect(markup).toContain('10/9(금)');
    expect(markup).toContain('10/3(토)');
    expect(markup).not.toContain('10/2(금)');
  });

  it('shows the saved early start as the current cycle', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 9, 12) });
    const overrides = { '2026-10': '2026-10-09' };
    configurePaydaySchedule(null, { monthStartDay: 10, cycleStartOverrides: overrides });
    const markup = render({ cycleStartOverrides: overrides });
    expect(markup).toContain('2026년 10월 주기<span class="text-slate-500"> (진행 중)</span>');
    expect(markup).toMatch(/<option value="2026-10-09" selected="">/);
    expect(markup).toContain('2026년 11월 주기');
  });
});
