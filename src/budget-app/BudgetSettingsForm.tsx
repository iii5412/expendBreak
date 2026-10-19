import { useState } from 'react';
import type { BudgetSettings } from '../types/budget';
import type { BudgetCategory } from './catalog';

export function BudgetSettingsForm({
  settings,
  categories,
  onSave,
  isDemo,
}: {
  settings: BudgetSettings;
  categories: BudgetCategory[];
  onSave: (settings: BudgetSettings) => Promise<void> | void;
  isDemo: boolean;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const change = (value: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
  return (
    <section className="bb-card">
      <p className="bb-kicker">내가 정하는 소비 기준</p>
      <h2>예산과 쿠폰 기준</h2>
      <p className="bb-caption">
        {isDemo
          ? '체험용 설정은 실제 계정에 영향을 주지 않습니다.'
          : '저장 버튼을 누르면 내 계정의 이번 주기에 적용됩니다.'}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setMessage('');
          try {
            await onSave(draft);
            setMessage('예산 기준을 저장했습니다.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="bb-setting">
          월 변동지출 목표 한도 (원)
          <input
            type="number"
            min="0"
            max="999999999"
            step="1"
            required
            value={draft.variableExpenseLimit}
            onChange={(event) =>
              setDraft((value) => ({ ...value, variableExpenseLimit: change(event.target.value, 999999999) }))
            }
          />
        </label>
        {categories
          .filter(
            (category) =>
              Object.hasOwn(draft.categoryCountLimits || {}, category.id) || /배달|택시|교통/.test(category.label),
          )
          .map((category) => (
            <label className="bb-setting" key={category.id}>
              {category.label} 월 쿠폰 횟수
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                required
                value={draft.categoryCountLimits?.[category.id] ?? 0}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    categoryCountLimits: {
                      ...value.categoryCountLimits,
                      [category.id]: change(event.target.value, 100),
                    },
                  }))
                }
              />
            </label>
          ))}
        <details className="bb-category-limits">
          <summary>카테고리별 변동지출 한도 (선택)</summary>
          <p className="bb-caption">0원은 별도 한도 없음입니다. 전체 변동지출 한도는 따로 유지됩니다.</p>
          {categories.map((category) => (
            <label className="bb-setting" key={category.id}>
              {category.label} 한도 (원)
              <input
                type="number"
                min="0"
                max="999999999"
                step="1"
                required
                value={draft.categoryAmountLimits?.[category.id] ?? 0}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    categoryAmountLimits: {
                      ...value.categoryAmountLimits,
                      [category.id]: change(event.target.value, 999999999),
                    },
                  }))
                }
              />
            </label>
          ))}
        </details>
        <button className="bb-primary" disabled={busy} type="submit">
          {busy ? '저장 중…' : '예산 기준 저장'}
        </button>
        <p role="status" className="bb-caption">
          {message}
        </p>
      </form>
    </section>
  );
}
