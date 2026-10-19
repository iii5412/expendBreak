import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { calculateBudget, getBudgetPeriodKey } from '../lib/calculator';
import type { BudgetCalculationInput } from '../types/budget';
import './budget-core-demo.css';

const mock: BudgetCalculationInput = {
  today: '2026-10-19', observationStartDate: '2026-10-01',
  settings: { monthStartDay: 1, variableExpenseLimit: 600_000 },
  templates: [{ id: 'rent', active: true, type: 'expense', expenseNature: 'fixed', amount: 500_000 }],
  transactions: [{ id: 'groceries', localDate: '2026-10-18', budgetPeriodKey: '2026-10', type: 'expense', amount: 100_000, expenseNature: 'variable', isOneOff: false }],
  occurrences: [{ id: 'subscription-oct', templateId: 'subscription', localDate: '2026-10-25', budgetPeriodKey: '2026-10', type: 'expense', expenseNature: 'variable', amount: 20_000, status: 'pending' }],
};
const won = (value: number | null) => value === null ? '데이터 부족' : `${value.toLocaleString('ko-KR')}원`;

function BudgetCoreDemo() {
  const [amount, setAmount] = useState(50_000);
  const [oneOff, setOneOff] = useState(false);
  const baseline = calculateBudget(mock);
  const result = calculateBudget({ ...mock, transactions: [...mock.transactions, {
    id: 'today-demo', localDate: mock.today, budgetPeriodKey: '2026-10', type: 'expense',
    amount, expenseNature: 'variable', isOneOff: oneOff,
  }] });
  const rows = [
    ['등록된 활성 고정비 예산', won(result.fixedExpenseBudget)],
    ['변동지출 목표 한도', won(result.variableExpenseLimit)],
    ['어제까지 실제 변동지출', won(result.actualVariableBeforeToday)],
    ['미결제 예정 변동지출', won(result.pendingVariableExpense)],
    ['오늘 00시 안전 잔액', won(result.safeBalanceAtStartOfDay)],
    ['현재 안전 잔액', won(result.currentSafeBalance)],
    ['내일 예상 일일 예산', won(result.projectedTomorrowAllowance)],
    ['최근 14일 일평균 일상 지출', won(result.dailyBurnRate)],
    ['예상 주기말 총지출', won(result.projectedPeriodEndExpense)],
  ];
  return <main>
    <p className="eyebrow">지출브레이크 · TASK 1</p>
    <h1>오늘 지출은 오늘 예산에서.</h1>
    <p>계산 코어 검증용 가상 데이터입니다. 입력값은 저장되지 않습니다.</p>
    <section>
      <h2>당일 지출 시뮬레이션</h2>
      <p>2026년 10월 19일 · 오늘 포함 13일 남음</p>
      <label htmlFor="amount">오늘 실제 변동지출 (원)</label>
      <input id="amount" type="number" min="0" max="10000000" step="1" value={amount} onChange={event => {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) setAmount(Math.min(10_000_000, Math.max(0, Math.floor(value))));
      }} />
      <label className="check"><input type="checkbox" checked={oneOff} onChange={event => setOneOff(event.target.checked)} /> 일회성 특별지출로 계산</label>
      <div className="metrics">
        <article><span>오늘 배정 예산 · 00시 고정</span><strong>{won(result.todayAllowance)}</strong></article>
        <article><span>오늘 남은 사용 가능액</span><strong className={result.remainingToday < 0 ? 'over' : ''}>{won(result.remainingToday)}</strong></article>
      </div>
      <p role="status">지출 전 {won(baseline.remainingToday)} − 오늘 지출 {won(amount)} = {won(result.remainingToday)}</p>
      <p>당일 지출 금액을 바꿔도 오늘 배정 예산은 그대로 유지됩니다. 일회성 지출도 안전 잔액에서 차감하며, 일상 지출 속도에서만 제외합니다.</p>
    </section>
    <section><h2>수식별 계산 결과</h2><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section><h2>급여 조기 입금 검증</h2><p>주기 시작일이 25일이고 10월 25일 급여가 23일에 먼저 입금된 경우:</p>
      <p>실제 날짜: 2026-10-23 · 날짜 기준 주기: {getBudgetPeriodKey('2026-10-23', 25)}</p>
      <p>급여 예정일로 부여한 주기: <strong>{getBudgetPeriodKey('2026-10-25', 25)}</strong></p>
      <p>실제 날짜와 별도로 저장한 주기 키로 한 번만 집계합니다.</p>
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<BudgetCoreDemo />);
