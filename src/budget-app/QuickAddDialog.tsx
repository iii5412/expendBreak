import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentScreen } from '../agent/tools';
import { ArrowLeft, Delete, X } from 'lucide-react';
import { calculateBudget, getBudgetPeriodKey } from '../lib/calculator';
import type { BudgetCalculationInput, BudgetTransaction } from '../types/budget';
import type { BudgetCategory, BudgetQuickEntry } from './catalog';
import { NaturalEntry } from './NaturalEntry';
import type { BudgetAiUi } from './aiClient';
import type { BudgetClassification, BudgetMerchantRule } from '../lib/budgetAi';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export function QuickAddDialog({
  input,
  onSave,
  onClose,
  categories,
  quickEntries,
  isDemo,
  ai,
  periodKeyForDate,
  pendingSmsCount = 0,
  onReviewSms,
  agentSlot,
  onNavigate,
}: {
  input: BudgetCalculationInput;
  onSave: (transaction: BudgetTransaction, rule?: BudgetMerchantRule) => Promise<void> | void;
  onClose: () => void;
  categories: BudgetCategory[];
  quickEntries: BudgetQuickEntry[];
  isDemo: boolean;
  ai?: BudgetAiUi;
  periodKeyForDate?: (date: string) => string;
  /** Payment texts found on the phone and still waiting for the user's approval. */
  pendingSmsCount?: number;
  onReviewSms?: () => void;
  /**
   * Renders the AI agent at the top of the dialog in place of the one-sentence box.
   * `onQuickAdd` fills the form below with a sentence the agent recognised as a plain
   * entry, and `onNavigate` closes the dialog and opens the screen the agent chose.
   */
  agentSlot?: (hooks: { onQuickAdd: (text: string) => void; onNavigate: (screen: AgentScreen) => void }) => ReactNode;
  onNavigate?: (screen: AgentScreen) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [digits, setDigits] = useState('');
  const [oneOff, setOneOff] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [localDate, setLocalDate] = useState(input.today);
  const [transactionType, setTransactionType] = useState<'income' | 'expense'>('expense');
  const [applied, setApplied] = useState<BudgetClassification | null>(null);
  const [saveRule, setSaveRule] = useState(false);
  const availableCategories =
    ai?.categories || categories.map((c) => ({ id: c.id, name: c.label, type: 'expense' as const }));
  const amount = Number(digits);
  const baseline = calculateBudget(input);
  const draft: BudgetTransaction = {
    id: 'preview',
    localDate,
    budgetPeriodKey:
      periodKeyForDate?.(localDate) ||
      (input.period && localDate >= input.period.start && localDate <= input.period.end
        ? input.period.key
        : getBudgetPeriodKey(localDate, input.settings.monthStartDay)),
    type: transactionType,
    expenseNature: 'variable',
    amount,
    isOneOff: oneOff,
    categoryId,
    merchant: merchant.trim(),
    memo: applied?.memo || '',
    source: applied?.source === 'ai' ? 'ai' : 'manual',
    aiConfidence: applied?.confidence,
    aiReviewed: Boolean(applied),
  };
  const preview = calculateBudget({ ...input, transactions: [...input.transactions, draft] });

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    element.showModal();
    amountInput.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const applyClassification = (result: BudgetClassification, selectedCategoryId: string) => {
    setApplied(result);
    setDigits(String(result.amount));
    setMerchant(result.merchant);
    setLocalDate(result.date);
    setTransactionType(result.type);
    setCategoryId(selectedCategoryId);
    setSaveRule(false);
    amountInput.current?.focus();
  };
  // Nothing is saved here: the sentence only pre-fills the form for the user to check.
  const quickAddFromAgent = (text: string) => {
    if (!ai) return;
    void ai
      .classify(text, new AbortController().signal)
      .then((result) => {
        const fallback = ai.categories.find((c) => c.type === result.type)?.id || '';
        applyClassification(result, result.suggestedCategoryId || fallback);
      })
      .catch((failure) => setError(failure instanceof Error ? failure.message : '문장을 해석하지 못했습니다. 직접 입력해 주세요.'));
  };

  const updateDigits = (value: string) =>
    setDigits(
      value
        .replace(/[^0-9]/g, '')
        .replace(/^0+/, '')
        .slice(0, 9),
    );
  const save = async (quick?: BudgetQuickEntry) => {
    const finalAmount = quick?.defaultAmount || amount;
    if (finalAmount < 1 || saving.current || !categoryId) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(
        {
          ...draft,
          id: crypto.randomUUID(),
          ...(quick
            ? {
                amount: finalAmount,
                merchant: quick.merchant,
                categoryId: quick.categoryId,
                source: 'manual' as const,
                ...(quick.paymentMethodType
                  ? {
                      paymentMethodType: quick.paymentMethodType,
                      cardId: quick.cardId ?? null,
                      accountId: quick.accountId ?? null,
                    }
                  : {}),
              }
            : {}),
        },
        !quick && saveRule && applied && categoryId !== applied.suggestedCategoryId
          ? { pattern: merchant.trim(), categoryId }
          : undefined,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : '저장하지 못했습니다.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="bb-dialog"
      aria-labelledby="quick-add-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving.current) onClose();
      }}
    >
      <div className="bb-dialog-header">
        <div>
          <p className="bb-kicker">빠르게 기록하기</p>
          <h2 id="quick-add-title">잠깐, 얼마를 쓰시나요?</h2>
        </div>
        <button type="button" className="bb-icon-button" aria-label="입력 닫기" disabled={busy} onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      <div className="bb-dialog-content">
        {pendingSmsCount > 0 && onReviewSms && (
          <button type="button" className="bb-sms-shortcut" disabled={busy} onClick={onReviewSms}>
            인식된 결제 문자 {pendingSmsCount}건 검토하기
          </button>
        )}
        {agentSlot ? (
          agentSlot({
            onQuickAdd: quickAddFromAgent,
            onNavigate: (screen) => onNavigate?.(screen),
          })
        ) : (
          ai && (
            <NaturalEntry
              ai={ai}
              onManual={() => amountInput.current?.focus()}
              onApply={applyClassification}
            />
          )
        )}
        <label className="bb-field-label" htmlFor="quick-amount">
          지출 금액
        </label>
        <div className="bb-amount-field">
          <input
            ref={amountInput}
            id="quick-amount"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={digits}
            onChange={(event) => updateDigits(event.target.value)}
            placeholder="0"
          />
          <span>원</span>
        </div>
        <p className="bb-field-hint">금액이 정해진 단골은 바로 저장되고, 아닌 단골은 금액 입력 후 누르면 저장돼요.</p>
        <div className="bb-quick-chips" aria-label="단골 원탭 저장">
          {quickEntries.map((quick) => (
            <button
              key={quick.key || quick.merchant}
              type="button"
              disabled={(!quick.defaultAmount && amount < 1) || busy || transactionType === 'income'}
              onClick={() => void save(quick)}
            >
              <span aria-hidden="true">{quick.icon}</span>
              {quick.label}
            </button>
          ))}
        </div>
        <div className="bb-keypad" aria-label="금액 숫자 패드">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'backspace'].map((key) => (
            <button
              key={key}
              type="button"
              aria-label={key === 'backspace' ? '마지막 숫자 지우기' : key}
              onClick={() =>
                key === 'backspace' ? setDigits((value) => value.slice(0, -1)) : updateDigits(digits + key)
              }
            >
              {key === 'backspace' ? <Delete size={21} /> : key}
            </button>
          ))}
        </div>
        <div className="bb-entry-fields">
          <label>
            카테고리
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {availableCategories
                .filter((c) => c.type === transactionType)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            가맹점 <span className="bb-muted">선택</span>
            <input
              value={merchant}
              maxLength={80}
              placeholder="어디에 쓰셨나요?"
              onChange={(event) => setMerchant(event.target.value)}
            />
          </label>
        </div>
        <div className="bb-entry-fields">
          <label>
            거래 유형
            <select
              value={transactionType}
              onChange={(event) => {
                const type = event.target.value as 'income' | 'expense';
                setTransactionType(type);
                setCategoryId(availableCategories.find((c) => c.type === type)?.id || '');
              }}
            >
              <option value="expense">지출</option>
              <option value="income">수입</option>
            </select>
          </label>
          <label>
            거래 날짜
            <input
              type="date"
              value={localDate}
              onChange={(event) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value) && Number.isFinite(Date.parse(event.target.value)))
                  setLocalDate(event.target.value);
              }}
            />
          </label>
        </div>
        {applied && categoryId !== applied.suggestedCategoryId && ai && (
          <label className="bb-toggle">
            <input type="checkbox" checked={saveRule} onChange={(event) => setSaveRule(event.target.checked)} />
            <span>
              앞으로 ‘{merchant || applied.merchant}’ 가맹점을 ‘
              {availableCategories.find((c) => c.id === categoryId)?.name}’로 자동 분류할까요?
            </span>
          </label>
        )}
        <label className="bb-toggle">
          <input type="checkbox" checked={oneOff} onChange={(event) => setOneOff(event.target.checked)} />
          <span>
            병원비·경조사 등 일회성 지출<small>월말 예측 속도에서 제외</small>
          </span>
        </label>
        <div className="bb-brake-preview" role="status" aria-live="polite">
          <span aria-hidden="true">💡</span>
          <div>
            <strong>결제 전, 3초 브레이크</strong>
            {transactionType === 'income' ? (
              <p>
                수입으로 기록합니다. 변동지출 한도를 자동으로 늘리지 않으며, 오늘 남은 가능액은{' '}
                <b>{won(preview.remainingToday)}</b>입니다.
              </p>
            ) : (
              <p>
                {localDate === input.today ? '이 금액을 결제하면' : '이 날짜로 거래를 기록하면'} 오늘 남은 가능액은{' '}
                <b>{won(preview.remainingToday)}</b>이 되고,{' '}
                {baseline.projectedTomorrowAllowance === null ? (
                  '오늘이 주기의 마지막 날이에요.'
                ) : (
                  <>
                    내일부터 일일 예산이{' '}
                    <b>
                      {won(baseline.projectedTomorrowAllowance)} → {won(preview.projectedTomorrowAllowance!)}
                    </b>
                    으로{' '}
                    {amount > 0 && preview.projectedTomorrowAllowance! < baseline.projectedTomorrowAllowance
                      ? '줄어듭니다.'
                      : '유지됩니다.'}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <p role="alert" className="bb-over-note">
          {error}
        </p>
        <button
          className="bb-primary"
          type="button"
          disabled={amount < 1 || busy || !categoryId}
          onClick={() => void save()}
        >
          {amount > 0 ? `${won(amount)} 저장하기` : '금액을 입력해 주세요'}
          <ArrowLeft className="bb-arrow-forward" size={18} />
        </button>
        <p className="bb-local-note">
          {isDemo ? '체험용 기록 · 실제 계정으로 전송하지 않습니다.' : '내 계정에 기록하고 연결되면 동기화합니다.'}
        </p>
      </div>
    </dialog>
  );
}
