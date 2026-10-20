import { useState } from 'react';
import type { PaymentCard, QuickEntry } from '../types';
import type { QuickEntrySuggestion } from '../utils/quickEntrySuggestions';
import type { BudgetCategory } from './catalog';

export type NewQuickEntry = Omit<QuickEntry, 'id' | 'sortOrder' | 'useCount' | 'lastUsedAt' | 'createdAt' | 'updatedAt'>;

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** Add, adjust and remove the one-tap entries shown in the add dialog. */
export function QuickEntryManager({
  entries,
  categories,
  paymentCards,
  suggestions,
  onSave,
  onUpdate,
  onDelete,
}: {
  entries: QuickEntry[];
  categories: BudgetCategory[];
  paymentCards: PaymentCard[];
  suggestions: Array<Pick<QuickEntrySuggestion, 'merchant' | 'categoryId' | 'fixedAmount'>>;
  onSave: (entry: NewQuickEntry) => Promise<void>;
  onUpdate: (id: string, patch: Partial<QuickEntry>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const expenseEntries = entries.filter((entry) => entry.type === 'expense');
  const [merchant, setMerchant] = useState('');
  const [digits, setDigits] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [cardId, setCardId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDigits, setEditDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (action: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const newEntry = (name: string, category: string, amount: number | null): NewQuickEntry => ({
    label: name,
    type: 'expense',
    amount,
    categoryId: category,
    merchant: name,
    memo: '',
    paymentMethodType: cardId ? 'card' : 'other',
    accountId: null,
    cardId: cardId || null,
  });
  const amount = digits ? Number(digits) : null;
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.label || '';

  return (
    <section className="bb-card" aria-labelledby="quick-entry-title">
      <p className="bb-kicker">자주 쓰는 곳</p>
      <h2 id="quick-entry-title">단골 원탭 저장</h2>
      <p className="bb-caption">금액을 정해 두면 추가 화면에서 한 번만 눌러도 기록돼요.</p>
      {expenseEntries.length === 0 && <p className="bb-caption">저장한 단골이 없어요. 아래에서 추가해 보세요.</p>}
      <ul className="bb-history">
        {expenseEntries.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{entry.label}</strong>
              <small>
                {nameOf(entry.categoryId) || '카테고리 확인 필요'} · {entry.amount ? won(entry.amount) : '누를 때 금액 입력'}
              </small>
            </div>
            {editingId === entry.id ? (
              <span className="bb-button-row" style={{ marginTop: 0, marginLeft: 'auto' }}>
                <input
                  className="bb-inline-input"
                  inputMode="numeric"
                  aria-label={`${entry.label} 금액`}
                  placeholder="비우면 매번 입력"
                  value={editDigits}
                  onChange={(event) => setEditDigits(event.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
                />
                <button
                  type="button"
                  className="bb-small-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onUpdate(entry.id, { amount: editDigits ? Number(editDigits) : null });
                      setEditingId(null);
                    }, '단골을 고쳤어요.')
                  }
                >
                  저장
                </button>
              </span>
            ) : (
              <span className="bb-button-row" style={{ marginTop: 0, marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="bb-small-button"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(entry.id);
                    setEditDigits(entry.amount ? String(entry.amount) : '');
                  }}
                >
                  금액 수정
                </button>
                <button
                  type="button"
                  className="bb-small-button"
                  disabled={busy}
                  onClick={() => void run(() => onDelete(entry.id), '단골을 삭제했어요. 기록한 거래는 그대로예요.')}
                >
                  삭제
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {suggestions.length > 0 && (
        <div className="bb-filter-chips" role="group" aria-label="추천 단골">
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.merchant}:${suggestion.categoryId}`}
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => onSave(newEntry(suggestion.merchant, suggestion.categoryId, suggestion.fixedAmount)),
                  `${suggestion.merchant}을(를) 단골에 추가했어요.`,
                )
              }
            >
              + {suggestion.merchant}
              {suggestion.fixedAmount ? ` ${won(suggestion.fixedAmount)}` : ''}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!merchant.trim() || !categoryId) return;
          void run(async () => {
            await onSave(newEntry(merchant.trim(), categoryId, amount));
            setMerchant('');
            setDigits('');
          }, '단골에 추가했어요.');
        }}
      >
        <div className="bb-entry-fields">
          <label>
            이름·사용처
            <input value={merchant} maxLength={40} onChange={(event) => setMerchant(event.target.value)} />
          </label>
          <label>
            금액 (선택)
            <input
              inputMode="numeric"
              placeholder="예: 2000"
              value={digits}
              onChange={(event) => setDigits(event.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
            />
          </label>
        </div>
        <div className="bb-entry-fields">
          <label>
            카테고리
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            결제 카드 (선택)
            <select value={cardId} onChange={(event) => setCardId(event.target.value)}>
              <option value="">지정 안 함</option>
              {paymentCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.cardName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="bb-primary" type="submit" disabled={busy || !merchant.trim() || !categoryId}>
          단골 추가
        </button>
        <p role="status" className="bb-caption">
          {message}
        </p>
      </form>
    </section>
  );
}
