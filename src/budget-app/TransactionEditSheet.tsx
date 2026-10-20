import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { BudgetTransaction } from '../types/budget';
import type { BudgetCategory } from './catalog';
import { validateTransactionEdit, type TransactionEdit } from './history';

/** Edit or delete one budget-view transaction. Saving goes through the app's revision-checked writes. */
export function TransactionEditSheet({
  transaction,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  transaction: BudgetTransaction;
  categories: BudgetCategory[];
  onSave: (edit: TransactionEdit) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [merchant, setMerchant] = useState(transaction.merchant || '');
  const [digits, setDigits] = useState(String(Math.round(transaction.amount)));
  const [localDate, setLocalDate] = useState(transaction.localDate);
  const [categoryId, setCategoryId] = useState(transaction.categoryId || '');
  const [isOneOff, setIsOneOff] = useState(transaction.isOneOff);
  const [memo, setMemo] = useState(transaction.memo || '');
  const [saveRule, setSaveRule] = useState(false);
  const isExpense = transaction.type === 'expense';
  const isFixed = isExpense && transaction.expenseNature === 'fixed';
  const categoryChanged = categoryId !== (transaction.categoryId || '');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const run = async (action: () => Promise<void> | void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '처리하지 못했습니다.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const submit = () => {
    const edit: TransactionEdit = {
      merchant: merchant.trim(),
      amount: Number(digits),
      localDate,
      categoryId: categoryId || undefined,
      isOneOff,
      memo: memo.trim(),
      saveRule: saveRule && categoryChanged && Boolean(merchant.trim()),
    };
    const invalid = validateTransactionEdit(edit);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run(() => onSave(edit));
  };

  return (
    <dialog
      ref={dialog}
      className="bb-dialog"
      aria-labelledby="tx-edit-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busyRef.current) onClose();
      }}
    >
      <div className="bb-dialog-header">
        <div>
          <p className="bb-kicker">거래 수정</p>
          <h2 id="tx-edit-title">{isExpense ? '지출 내역 고치기' : '수입 내역 고치기'}</h2>
        </div>
        <button type="button" className="bb-icon-button" aria-label="수정 닫기" disabled={busy} onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      <div className="bb-dialog-content">
        <div className="bb-entry-fields">
          <label>
            사용처
            <input value={merchant} maxLength={80} onChange={(event) => setMerchant(event.target.value)} />
          </label>
          <label>
            금액 (원)
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={digits}
              onChange={(event) => setDigits(event.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
            />
          </label>
        </div>
        <div className="bb-entry-fields">
          <label>
            날짜
            <input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} />
          </label>
          {isExpense && (
            <label>
              카테고리
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                {!categories.some((c) => c.id === categoryId) && <option value={categoryId}>현재 카테고리</option>}
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="bb-entry-fields">
          <label>
            메모 <span className="bb-muted">선택</span>
            <input value={memo} maxLength={200} onChange={(event) => setMemo(event.target.value)} />
          </label>
        </div>
        {isExpense && !isFixed && (
          <label className="bb-toggle">
            <input type="checkbox" checked={isOneOff} onChange={(event) => setIsOneOff(event.target.checked)} />
            <span>
              일회성 지출<small>월말 예측 속도에서 제외</small>
            </span>
          </label>
        )}
        {isExpense && categoryChanged && merchant.trim() && (
          <label className="bb-toggle">
            <input type="checkbox" checked={saveRule} onChange={(event) => setSaveRule(event.target.checked)} />
            <span>
              앞으로 ‘{merchant.trim()}’을(를) 이 카테고리로 자동 분류<small>다음 결제 문자부터 적용돼요</small>
            </span>
          </label>
        )}
        <p role="alert" className="bb-over-note">
          {error}
        </p>
        <button className="bb-primary" type="button" disabled={busy} onClick={submit}>
          {busy ? '저장 중…' : '수정 저장'}
        </button>
        {onDelete && (
          <button type="button" className="bb-danger-button" disabled={busy} onClick={() => void run(() => onDelete())}>
            <Trash2 size={16} /> 이 거래 삭제
          </button>
        )}
      </div>
    </dialog>
  );
}
