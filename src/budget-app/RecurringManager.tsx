import { useState } from 'react';
import type { Category, RecurringOccurrence, RecurringTemplate } from '../types';
import { resolveRecurringAmount } from '../utils/recurringAmounts';

export type TemplateInput = Omit<RecurringTemplate, 'id' | 'createdAt' | 'updatedAt'>;
export interface RecurringActions {
  saveTemplate: (template: TemplateInput, id?: string) => Promise<void>;
  post: (id: string, amount: number) => Promise<void>;
  skip: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
}
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export function RecurringManager({
  templates,
  occurrences,
  categories,
  today,
  nextPeriodStart,
  actions,
}: {
  templates: RecurringTemplate[];
  occurrences: RecurringOccurrence[];
  categories: Category[];
  today: string;
  nextPeriodStart: string;
  actions: RecurringActions;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [draft, setDraft] = useState<TemplateInput>(() => blank());
  const pending = occurrences.filter(
    (o) =>
      o.status !== 'posted' &&
      o.status !== 'skipped' &&
      templates.some((t) => t.id === o.templateId && t.active && !t.archivedAt),
  );
  function blank(): TemplateInput {
    return {
      name: '',
      type: 'expense',
      defaultAmount: 0,
      categoryId: categories.find((c) => c.type === 'expense' && c.active)?.id || '',
      counterparty: '',
      expenseNature: 'fixed',
      frequency: 'monthly',
      dayOfMonth: 25,
      holidayPolicy: 'fixed_date',
      postingMode: 'confirm',
      allowAmountChange: false,
      startDate: today,
      nextDueDate: today,
      active: true,
    };
  }
  const run = async (work: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bb-card">
      <div className="bb-section-heading">
        <div>
          <p className="bb-kicker">매달 반복되는 일</p>
          <h2>정기 항목</h2>
        </div>
        <button
          className="bb-small-button"
          type="button"
          onClick={() => {
            setDraft(blank());
            setEditing(null);
            setOpen(true);
          }}
        >
          + 정기 항목 등록
        </button>
      </div>
      <p className="bb-caption">
        기본은 확인 후 반영입니다. 자동 반영을 선택한 고정 금액은 예정일 이후 앱을 열 때 한 번 기록합니다.
      </p>
      {open && (
        <form
          className="bb-recurring-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await actions.saveTemplate(
                {
                  ...draft,
                  defaultAmount: Math.floor(draft.defaultAmount),
                  budgetAutoPostingEnabled: draft.postingMode === 'auto',
                  budgetAutoPostingStartDate:
                    draft.postingMode === 'auto'
                      ? editing && !draft.budgetAutoPostingEnabled
                        ? nextPeriodStart
                        : draft.budgetAutoPostingStartDate || today
                      : draft.budgetAutoPostingStartDate,
                  allowAmountChange: draft.postingMode === 'auto' ? false : draft.allowAmountChange,
                },
                editing || undefined,
              );
              setOpen(false);
            }, '정기 항목을 저장했습니다.');
          }}
        >
          <label>
            이름
            <input
              required
              maxLength={80}
              value={draft.name}
              placeholder="월급, 월세, 배우자 생활비"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, counterparty: e.target.value }))}
            />
          </label>
          <div className="bb-form-grid">
            <label>
              유형
              <select
                value={draft.type}
                onChange={(e) => {
                  const type = e.target.value as 'income' | 'expense';
                  setDraft((d) => ({
                    ...d,
                    type,
                    categoryId: categories.find((c) => c.type === type && c.active)?.id || '',
                  }));
                }}
              >
                <option value="income">수입</option>
                <option value="expense">지출</option>
              </select>
            </label>
            <label>
              카테고리
              <select
                required
                value={draft.categoryId}
                onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}
              >
                {categories
                  .filter((c) => c.active && c.type === draft.type)
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="bb-form-grid">
            <label>
              금액 (원)
              <input
                type="number"
                min="1"
                max="999999999"
                step="1"
                required
                value={draft.defaultAmount || ''}
                onChange={(e) => setDraft((d) => ({ ...d, defaultAmount: Number(e.target.value) }))}
              />
            </label>
            <label>
              {draft.frequency === 'weekly' ? '예정일 (기존 주간 반복 유지)' : '매월 예정일'}
              <select
                value={draft.dayOfMonth}
                disabled={draft.frequency === 'weekly'}
                onChange={(e) => setDraft((d) => ({ ...d, dayOfMonth: Number(e.target.value) }))}
              >
                {Array.from({ length: 31 }, (_, i) => (
                  <option value={i + 1} key={i}>
                    {i + 1}일
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="bb-form-grid">
            <label>
              휴일 처리
              <select
                value={draft.holidayPolicy}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, holidayPolicy: e.target.value as RecurringTemplate['holidayPolicy'] }))
                }
              >
                <option value="previous_business_day">이전 영업일</option>
                <option value="next_business_day">다음 영업일</option>
                <option value="fixed_date">고정일</option>
              </select>
            </label>
            <label>
              반영 방식
              <select
                value={draft.postingMode}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, postingMode: e.target.value as RecurringTemplate['postingMode'] }))
                }
              >
                <option value="confirm">확인 후 반영</option>
                <option value="auto">자동 반영 (고정 금액)</option>
              </select>
            </label>
          </div>
          <label>
            추가 휴무일 · 공휴일
            <input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
          </label>
          <button
            className="bb-small-button"
            type="button"
            disabled={!holidayDate}
            onClick={() => {
              setDraft((d) => ({ ...d, nonBusinessDates: [...new Set([...(d.nonBusinessDates || []), holidayDate])] }));
              setHolidayDate('');
            }}
          >
            휴무일 추가
          </button>
          <div className="bb-button-row">
            {(draft.nonBusinessDates || []).map((date) => (
              <button
                className="bb-small-button"
                type="button"
                key={date}
                aria-label={`${date} 휴무일 제거`}
                onClick={() =>
                  setDraft((d) => ({ ...d, nonBusinessDates: d.nonBusinessDates.filter((value) => value !== date) }))
                }
              >
                {date} ×
              </button>
            ))}
          </div>
          <p className="bb-caption">
            주말은 자동 조정합니다. 공휴일·은행 휴무일은 여기에 추가해 주세요. 주기를 벗어나는 날짜는 기존 앱의 주기
            보존 규칙을 따릅니다.
          </p>
          {draft.type === 'expense' && (
            <label>
              지출 성격
              <select
                value={draft.expenseNature || 'fixed'}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, expenseNature: e.target.value as RecurringTemplate['expenseNature'] }))
                }
              >
                <option value="fixed">고정비</option>
                <option value="variable_estimate">반복 변동비</option>
              </select>
            </label>
          )}
          <p className="bb-caption">
            수정한 기준은 다음 회차부터 적용됩니다. 현재 회차는 아래 확인 금액으로 반영합니다.
          </p>
          <div className="bb-button-row">
            <button className="bb-primary" disabled={busy} type="submit">
              {busy ? '저장 중…' : '정기 항목 저장'}
            </button>
            <button className="bb-small-button" disabled={busy} type="button" onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </form>
      )}
      <div className="bb-template-list">
        {templates
          .filter((t) => !t.archivedAt)
          .map((t) => (
            <article className="bb-template-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.type === 'income' ? '수입' : t.expenseNature === 'variable_estimate' ? '반복 변동비' : '고정비'} ·
                  {t.frequency === 'weekly' ? '매주' : `매월 ${t.dayOfMonth}일`} · {won(t.defaultAmount)} ·{' '}
                  {t.postingMode === 'auto' && t.budgetAutoPostingEnabled ? '자동 반영' : '확인 후 반영'}
                  {!t.active ? ' · 일시 중지' : ''}
                </small>
              </div>
              <div className="bb-button-row">
                <button
                  className="bb-small-button"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setEditing(t.id);
                    setDraft({
                      ...t,
                      postingMode: t.postingMode === 'auto' && !t.budgetAutoPostingEnabled ? 'confirm' : t.postingMode,
                    });
                    setOpen(true);
                  }}
                >
                  수정
                </button>
                <button
                  className="bb-small-button"
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void run(() => actions.saveTemplate({ ...t, active: !t.active }, t.id), '사용 상태를 변경했습니다.')
                  }
                >
                  {t.active ? '중지' : '재개'}
                </button>
                <button
                  className="bb-small-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void run(() => actions.archive(t.id), '항목을 보관했습니다. 기존 거래는 유지됩니다.')}
                >
                  보관
                </button>
              </div>
            </article>
          ))}
      </div>
      {templates.some((t) => t.archivedAt) && (
        <details className="bb-archived">
          <summary>보관한 항목 보기</summary>
          {templates
            .filter((t) => t.archivedAt)
            .map((t) => (
              <div className="bb-template-row" key={t.id}>
                <span>{t.name}</span>
                <button
                  className="bb-small-button"
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void run(() => actions.saveTemplate({ ...t, archivedAt: null }, t.id), '항목을 복원했습니다.')
                  }
                >
                  복원
                </button>
              </div>
            ))}
        </details>
      )}
      <h3 className="bb-list-heading">이번 주기 확인할 회차</h3>
      {pending.map((o) => (
        <form
          className="bb-occurrence-row"
          key={o.id}
          onSubmit={(event) => {
            event.preventDefault();
            const amount = Number(new FormData(event.currentTarget).get('amount'));
            void run(() => actions.post(o.id, amount), '거래에 반영했습니다.');
          }}
        >
          <div>
            <strong>{templates.find((t) => t.id === o.templateId)?.name}</strong>
            <small>
              {o.scheduledDate} {o.scheduledDate > today ? '· 예정' : '· 확인 필요'}
            </small>
          </div>
          <label>
            확인 금액 (원)
            <input
              name="amount"
              aria-label={`${templates.find((t) => t.id === o.templateId)?.name} 확인 금액`}
              type="number"
              min="1"
              max="999999999"
              step="1"
              required
              defaultValue={resolveRecurringAmount(o).amount ?? ''}
            />
          </label>
          <div className="bb-button-row">
            <button className="bb-small-button" type="submit" disabled={busy}>
              확인 후 반영
            </button>
            <button
              className="bb-small-button"
              type="button"
              disabled={busy}
              onClick={() => void run(() => actions.skip(o.id), '이번 회차를 건너뛰었습니다.')}
            >
              이번 회차 건너뛰기
            </button>
          </div>
        </form>
      ))}
      {pending.length === 0 && <p className="bb-caption">이번 주기 확인할 회차가 없습니다.</p>}
      {templates.length === 0 && (
        <p className="bb-caption">등록한 정기 항목이 없습니다. 월급이나 고정비부터 추가해 보세요.</p>
      )}
      <p className="bb-caption" role="status">
        {message}
      </p>
    </section>
  );
}
