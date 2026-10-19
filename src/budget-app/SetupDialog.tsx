import { useEffect, useRef, useState } from 'react';

export interface BudgetSetup {
  salary: number;
  salaryDay: number;
  fixed: number;
  fixedDay: number;
  limit: number;
  deliveryCount: number;
}
export function SetupDialog({
  onComplete,
  onSkip,
}: {
  onComplete: (setup: BudgetSetup) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<BudgetSetup>({
    salary: 0,
    salaryDay: 25,
    fixed: 0,
    fixedDay: 1,
    limit: 0,
    deliveryCount: 6,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : '설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      className="bb-dialog"
      ref={dialog}
      aria-labelledby="budget-setup-title"
      onCancel={(e) => e.preventDefault()}
    >
      <div className="bb-dialog-content">
        <p className="bb-kicker">처음 한 번, 30초 예산 설정</p>
        <h2 id="budget-setup-title">나에게 맞는 한 달을 시작해요.</h2>
        <p className="bb-caption">월급과 고정비는 확인 후 반영하는 정기 항목으로 등록합니다.</p>
        <form
          className="bb-recurring-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => onComplete(draft));
          }}
        >
          {(
            [
              ['salary', '월급 (원)', 999999999, 1],
              ['salaryDay', '급여일 · 예산 주기 시작일', 28, 1],
              ['fixed', '배우자 생활비·주거비 등 고정비 (원)', 999999999, 0],
              ['fixedDay', '고정비 예정일', 28, 1],
              ['limit', '월 변동지출 목표 한도 (원)', 999999999, 1],
              ['deliveryCount', '배달음식 월 쿠폰 횟수', 100, 0],
            ] as const
          ).map(([key, label, max, min]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                step="1"
                required
                value={draft[key] || (min > 0 ? '' : 0)}
                onChange={(event) => setDraft((old) => ({ ...old, [key]: Number(event.target.value) }))}
              />
            </label>
          ))}
          <p role="alert" className="bb-over-note">
            {error}
          </p>
          <button className="bb-primary" type="submit" disabled={busy}>
            {busy ? '설정 중…' : '내 예산으로 시작하기'}
          </button>
          <button className="bb-text-button" type="button" disabled={busy} onClick={() => void run(onSkip)}>
            나중에 설정하기
          </button>
        </form>
      </div>
    </dialog>
  );
}
