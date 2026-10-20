import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  House,
  List,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { calculateBudget } from '../lib/calculator';
import type { BudgetCalculationInput, BudgetSettings, BudgetTransaction } from '../types/budget';
import { categoryCoupon, savedYesterday, spendingSignal, waterfallSegments } from './dashboard';
import { categories as defaultCategories, quickEntries as defaultQuickEntries, mockBudget } from './mock';
import type { BudgetCategory, BudgetQuickEntry } from './catalog';
import { BudgetSettingsForm } from './BudgetSettingsForm';
import { QuickAddDialog } from './QuickAddDialog';
import type { AgentScreen } from '../agent/tools';
import { TransactionEditSheet } from './TransactionEditSheet';
import { filterHistory, HISTORY_FILTERS, type HistoryFilter, type TransactionEdit } from './history';
import type { BudgetAiUi } from './aiClient';
import type { BudgetMerchantRule } from '../lib/budgetAi';

const won = (value: number | null) => (value === null ? '데이터 부족' : `${value.toLocaleString('ko-KR')}원`);
type Tab = 'home' | 'history' | 'analysis' | 'manage';

/** Moves between accounting cycles; the app shell owns which cycle is selected. */
export interface BudgetPeriodNav {
  isCurrent: boolean;
  canGoPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}
const dotted = (date: string) => date.replaceAll('-', '.');
const tabs = [
  { id: 'home', label: '홈', icon: House },
  { id: 'history', label: '내역', icon: List },
  { id: 'add', label: '추가', icon: Plus },
  { id: 'analysis', label: '분석', icon: ChartNoAxesCombined },
  { id: 'manage', label: '관리', icon: Settings2 },
] as const;

export function BudgetApp({
  data,
  categories = defaultCategories,
  quickEntries = defaultQuickEntries,
  onSaveTransaction,
  onSaveSettings,
  managementContent,
  accountContent,
  banner,
  children,
  isDemo = true,
  ai,
  analysisContent,
  periodKeyForDate,
  periodNav,
  limitSetupNeeded = false,
  onUpdateTransaction,
  onDeleteTransaction,
  smsPendingCount = 0,
  onReviewSms,
  entryRequested = false,
  onEntryRequestHandled,
  agentSlot,
  livingBudget = null,
}: {
  data?: BudgetCalculationInput;
  categories?: BudgetCategory[];
  quickEntries?: BudgetQuickEntry[];
  onSaveTransaction?: (transaction: BudgetTransaction) => Promise<void> | void;
  onSaveSettings?: (settings: BudgetSettings) => Promise<void> | void;
  managementContent?: ReactNode;
  accountContent?: ReactNode;
  banner?: ReactNode;
  children?: ReactNode;
  isDemo?: boolean;
  ai?: BudgetAiUi;
  analysisContent?: ReactNode;
  periodKeyForDate?: (date: string) => string;
  periodNav?: BudgetPeriodNav;
  /** No typed limit and no locked living budget: ask the user to set one instead of showing 0원. */
  limitSetupNeeded?: boolean;
  onUpdateTransaction?: (id: string, edit: TransactionEdit) => Promise<void>;
  onDeleteTransaction?: (id: string) => Promise<void>;
  smsPendingCount?: number;
  onReviewSms?: () => void;
  /** A widget or deep link asked for the entry dialog; reported back once it opened. */
  entryRequested?: boolean;
  onEntryRequestHandled?: () => void;
  /** AI agent shown at the top of the add dialog; see QuickAddDialog. */
  agentSlot?: ComponentProps<typeof QuickAddDialog>['agentSlot'];
  /** The cycle's locked living budget, offered as a one-tap limit. */
  livingBudget?: number | null;
} = {}) {
  const [localInput, setInput] = useState<BudgetCalculationInput>(mockBudget);
  const input = data ?? localInput;
  const [tab, setTab] = useState<Tab>('home');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const result = calculateBudget(input);
  const spent = result.actualVariableBeforeToday + result.actualVariableToday;
  const signal = spendingSignal(result.actualVariableToday, result.todayAllowance);
  const bar = waterfallSegments(spent, result.pendingVariableExpense, result.variableExpenseLimit);
  const periodTransactions = input.transactions.filter(
    (t) => t.budgetPeriodKey === result.budgetPeriodKey && t.localDate <= input.today,
  );
  const income = periodTransactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const pendingIncome = input.occurrences
    .filter((o) => o.type === 'income' && o.status === 'pending' && o.budgetPeriodKey === result.budgetPeriodKey)
    .reduce((sum, o) => sum + o.amount, 0);
  const expense = periodTransactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const pendingExpense = result.pendingFixedExpense + result.pendingVariableExpense;
  const visibleHistory = filterHistory(periodTransactions, { query, filter });
  const editing = editingId ? input.transactions.find((t) => t.id === editingId) : undefined;

  useEffect(() => {
    if (!entryRequested) return;
    setAdding(true);
    onEntryRequestHandled?.();
  }, [entryRequested, onEntryRequestHandled]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const save = async (transaction: BudgetTransaction, rule?: BudgetMerchantRule) => {
    if (onSaveTransaction) await onSaveTransaction(transaction);
    else setInput((value) => ({ ...value, transactions: [...value.transactions, transaction] }));
    let ruleFailed = false;
    if (rule && ai) {
      try {
        await ai.saveRule(rule.pattern, rule.categoryId);
      } catch {
        ruleFailed = true;
      }
    }
    setAdding(false);
    setNotice(
      `${transaction.merchant || '지출'} ${won(transaction.amount)} 기록했어요.${ruleFailed ? ' 가맹점 규칙은 저장하지 못했습니다.' : rule ? ' 가맹점 규칙도 저장했어요.' : ''}`,
    );
  };

  return (
    <div className="bb-app">
      <a className="bb-skip" href="#bb-content">
        본문으로 바로가기
      </a>
      <header className="bb-header">
        <a href="#bb-content" className="bb-brand" onClick={() => setTab('home')}>
          <span className="bb-brand-icon">
            <ShieldCheck size={23} />
          </span>
          지출브레이크<span className="bb-brand-dot">.</span>
        </a>
        <div className="bb-button-row" style={{ marginTop: 0 }}>
          <span className="bb-demo-badge">{isDemo ? '가상 데이터로 체험 중' : '내 계정과 연결됨'}</span>
        </div>
      </header>
      <main id="bb-content" className="bb-content">
        {banner}
        <div className="bb-page-heading">
          <div>
            <p className="bb-kicker">내 소비, 나의 속도로</p>
            <h1>
              {tab === 'home'
                ? '조금 더 가벼운, 오늘.'
                : tab === 'history'
                  ? '차곡차곡 쌓인 기록.'
                  : tab === 'analysis'
                    ? '내 소비의 흐름.'
                    : '나에게 맞는 기준.'}
            </h1>
            <p className="bb-subtitle">
              {result.budgetPeriodKey.replace('-', '년 ')}월 예산 <span>·</span> {dotted(result.periodStart)} ~{' '}
              {dotted(result.periodEnd)}
            </p>
          </div>
          <span className="bb-period-tag">
            <Wallet size={15} />
            {periodNav && !periodNav.isCurrent ? '지난 주기' : `이번 주기 ${result.remainingDaysIncludingToday}일 남음`}
          </span>
        </div>
        {periodNav && (
          <nav className="bb-period-nav" aria-label="예산 주기 이동">
            <button type="button" aria-label="이전 주기" disabled={!periodNav.canGoPrev} onClick={periodNav.onPrev}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="bb-period-today" disabled={periodNav.isCurrent} onClick={periodNav.onToday}>
              오늘
            </button>
            <button type="button" aria-label="다음 주기" disabled={periodNav.isCurrent} onClick={periodNav.onNext}>
              <ChevronRight size={18} />
            </button>
          </nav>
        )}
        {limitSetupNeeded && tab === 'home' && (
          <div className="bb-notice bb-limit-notice" role="status">
            변동지출 예산 한도를 설정해 주세요.
            <button type="button" className="bb-small-button" onClick={() => setTab('manage')}>
              한도 설정하러 가기
            </button>
          </div>
        )}

        {tab === 'home' && (
          <>
            <section className={`bb-hero bb-${signal.tone}`} aria-labelledby="today-title">
              <div className="bb-hero-top">
                <span id="today-title">오늘 남은 사용 가능액</span>
                <span className="bb-signal">
                  <span aria-hidden="true">{signal.icon}</span> {signal.label}
                </span>
              </div>
              <div className="bb-hero-amount">
                {result.remainingToday.toLocaleString('ko-KR')}
                <span>원</span>
              </div>
              <p className="bb-hero-advice">{signal.advice}</p>
              <div className="bb-hero-breakdown">
                <div>
                  <span>오늘 배정 예산</span>
                  <strong>{won(result.todayAllowance)}</strong>
                </div>
                <span className="bb-divider" />
                <div>
                  <span>오늘 쓴 금액</span>
                  <strong>{won(result.actualVariableToday)}</strong>
                </div>
              </div>
              {savedYesterday(input) && <p className="bb-savings">✨ 어제 절약으로 오늘 예산이 늘었어요!</p>}
            </section>
            <section className="bb-card bb-budget-card" aria-labelledby="variable-title">
              <div className="bb-section-heading">
                <div>
                  <p className="bb-kicker">한 달 예산 살펴보기</p>
                  <h2 id="variable-title">이번 달 변동지출</h2>
                </div>
                <span>
                  목표 <b>{won(result.variableExpenseLimit)}</b>
                </span>
              </div>
              <div className="bb-safe-total">
                <span>안전하게 남은 금액</span>
                <strong>{won(result.currentSafeBalance)}</strong>
              </div>
              <div
                className="bb-waterfall"
                role="img"
                aria-label={`변동지출 한도 ${won(result.variableExpenseLimit)}, 이미 쓴 변동지출 ${won(spent)}, 예정 반복지출 ${won(result.pendingVariableExpense)}, 안전 잔액 ${won(result.currentSafeBalance)}`}
              >
                <span className="bb-bar-spent" style={{ width: `${bar.spent}%` }} />
                <span className="bb-bar-pending" style={{ width: `${bar.pending}%` }} />
                <span className="bb-bar-safe" style={{ width: `${bar.safe}%` }} />
              </div>
              <div className="bb-legend">
                <div>
                  <span className="bb-swatch bb-bar-spent" />
                  <span>
                    이미 쓴 금액<strong>{won(spent)}</strong>
                  </span>
                </div>
                <div>
                  <span className="bb-swatch bb-bar-pending" />
                  <span>
                    예정된 반복지출<strong>{won(result.pendingVariableExpense)}</strong>
                  </span>
                </div>
                <div>
                  <span className="bb-swatch bb-bar-safe" />
                  <span>
                    안전 잔액<strong>{won(result.currentSafeBalance)}</strong>
                  </span>
                </div>
              </div>
              {bar.over > 0 && <p className="bb-over-note">지출과 예정 금액이 목표를 {won(bar.over)} 초과했어요.</p>}
              <p className="bb-caption">고정비 {won(result.fixedExpenseBudget)}는 변동지출 한도와 따로 관리해요.</p>
            </section>
            <section className="bb-coupon-section" aria-labelledby="coupon-title">
              <div className="bb-section-heading">
                <div>
                  <p className="bb-kicker">작은 멈춤, 더 큰 여유</p>
                  <h2 id="coupon-title">꼭 쓰고 싶은 순간을 위해</h2>
                </div>
                <span className="bb-muted">월 횟수 쿠폰</span>
              </div>
              <div className="bb-coupon-grid">
                {Object.entries(input.settings.categoryCountLimits || {}).map(([id, limit]) => {
                  const coupon = categoryCoupon(input, id, limit);
                  const category = categories.find((c) => c.id === id);
                  return (
                    <article className="bb-coupon" key={id}>
                      <div className="bb-coupon-heading">
                        <span className="bb-category-icon" aria-hidden="true">
                          {category?.icon || '🎟️'}
                        </span>
                        <span>
                          {category?.label || id}
                          <small>이번 달 {limit}장 중</small>
                        </span>
                        <strong>
                          {coupon.remaining}
                          <small>장 남음</small>
                        </strong>
                      </div>
                      <div className="bb-stamps" aria-hidden="true">
                        {Array.from({ length: Math.min(limit, 12) }, (_, index) => (
                          <span key={index} className={index < coupon.used ? 'bb-stamp used' : 'bb-stamp'}>
                            {index < coupon.used ? '✓' : '·'}
                          </span>
                        ))}
                      </div>
                      <p className="bb-caption">
                        {category?.label} 쿠폰: 이번 달 {limit}장 중 {coupon.remaining}장 남음
                        {coupon.over > 0 ? ` · ${coupon.over}회 초과` : ''}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
            <details className="bb-card bb-cashflow">
              <summary>
                <span>
                  <span className="bb-summary-icon">
                    <ArrowDownLeft size={19} />
                  </span>
                  <span>
                    이번 달 현금흐름<small>수입부터 월말 예상까지 한눈에</small>
                  </span>
                </span>
                <ChevronDown size={20} />
              </summary>
              <dl>
                {[
                  ['확정 수입', won(income)],
                  ['예정 수입', won(pendingIncome)],
                  [
                    '고정비 차감 후 금액',
                    won(income + pendingIncome - result.confirmedFixedExpense - result.pendingFixedExpense),
                  ],
                  ['순현금흐름 (예정 포함)', won(income + pendingIncome - expense - pendingExpense)],
                  ['예상 월말 지출', won(result.projectedPeriodEndExpense)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="bb-footer-note">
              <ShieldCheck size={14} />
              작은 멈춤이 만드는 여유, 지출브레이크
            </p>
          </>
        )}

        {tab === 'history' && (
          <section className="bb-card">
            <div className="bb-section-heading">
              <h2>이번 주기 거래 내역</h2>
              <span>{visibleHistory.length === periodTransactions.length ? `${periodTransactions.length}건` : `${visibleHistory.length}/${periodTransactions.length}건`}</span>
            </div>
            <label className="bb-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                maxLength={40}
                placeholder="사용처·메모 검색"
                aria-label="거래 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="bb-filter-chips" role="group" aria-label="거래 필터">
              {HISTORY_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {visibleHistory.length === 0 && <p className="bb-caption">조건에 맞는 거래가 없어요.</p>}
            <ul className="bb-history">
              {visibleHistory.map((t) => {
                const row = (
                  <>
                    <span className="bb-category-icon" aria-hidden="true">
                      {t.type === 'income' ? '↙' : categories.find((c) => c.id === t.categoryId)?.icon || '🧾'}
                    </span>
                    <div>
                      <strong>{t.merchant || '지출'}</strong>
                      <small>
                        {t.localDate} ·{' '}
                        {t.type === 'income'
                          ? '수입'
                          : t.isOneOff
                            ? '일회성 지출'
                            : t.expenseNature === 'fixed'
                              ? '고정비'
                              : categories.find((c) => c.id === t.categoryId)?.label || '기타'}
                      </small>
                    </div>
                    <b className={t.type === 'income' ? 'bb-income' : ''}>
                      {t.type === 'income' ? '+' : '−'}
                      {won(t.amount)}
                    </b>
                  </>
                );
                return (
                  <li key={t.id}>
                    {onUpdateTransaction ? (
                      <button
                        type="button"
                        className="bb-history-row"
                        aria-label={`${t.merchant || '거래'} ${won(t.amount)} 수정`}
                        onClick={() => setEditingId(t.id)}
                      >
                        {row}
                      </button>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {tab === 'analysis' && (
          <>
            <section className="bb-card">
              <p className="bb-kicker">내 소비 돌아보기</p>
              <h2>이번 달 소비 요약</h2>
              <dl className="bb-stat-list">
                <div>
                  <dt>누적 변동지출</dt>
                  <dd>{won(spent)}</dd>
                </div>
                <div>
                  <dt>일상 지출 속도 · 최근 {result.burnRateObservationDays}일</dt>
                  <dd>{won(result.dailyBurnRate)} / 일</dd>
                </div>
                <div>
                  <dt>예측 속도에서 제외한 특별지출</dt>
                  <dd>{won(result.accumulatedOneOffExpense)}</dd>
                </div>
                <div>
                  <dt>예상 월말 지출</dt>
                  <dd>{won(result.projectedPeriodEndExpense)}</dd>
                </div>
              </dl>
              <p className="bb-caption">일회성 지출을 제외한 평소 소비 속도로 월말을 예상해요.</p>
            </section>
            {analysisContent}
          </>
        )}
        {tab === 'manage' && (
          <>
            {accountContent}
            {managementContent}
            <BudgetSettingsForm
              key={result.budgetPeriodKey}
              livingBudget={livingBudget}
              settings={input.settings}
              categories={categories}
              isDemo={isDemo}
              onSave={async (settings) => {
                if (onSaveSettings) await onSaveSettings(settings);
                else setInput((old) => ({ ...old, settings }));
              }}
            />
          </>
        )}
      </main>
      <nav className="bb-nav" aria-label="주요 메뉴">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${item.id === 'add' ? 'bb-nav-add' : ''} ${tab === item.id ? 'active' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => (item.id === 'add' ? setAdding(true) : setTab(item.id))}
          >
            <span className="bb-nav-icon">
              <item.icon size={22} strokeWidth={tab === item.id ? 2.3 : 1.7} />
            </span>
            <span>{item.id === 'add' ? '+ 추가' : item.label}</span>
          </button>
        ))}
      </nav>
      <div className="bb-toast" role="status" aria-live="polite">
        {notice && (
          <span>
            <ShieldCheck size={18} />
            {notice}
          </span>
        )}
      </div>
      {adding && (
        <QuickAddDialog
          input={input}
          categories={categories}
          quickEntries={quickEntries}
          isDemo={isDemo}
          onSave={save}
          onClose={() => setAdding(false)}
          ai={ai}
          periodKeyForDate={periodKeyForDate}
          pendingSmsCount={smsPendingCount}
          agentSlot={agentSlot}
          onNavigate={(screen: AgentScreen) => {
            setAdding(false);
            setTab(screen === 'history' ? 'history' : screen === 'analytics' ? 'analysis' : screen === 'home' ? 'home' : 'manage');
          }}
          onReviewSms={
            onReviewSms
              ? () => {
                  setAdding(false);
                  setTimeout(onReviewSms, 50);
                }
              : undefined
          }
        />
      )}
      {editing && onUpdateTransaction && (
        <TransactionEditSheet
          key={editing.id}
          transaction={editing}
          categories={categories}
          onClose={() => setEditingId(null)}
          onSave={async (edit) => {
            await onUpdateTransaction(editing.id, edit);
            setEditingId(null);
            setNotice(`${edit.merchant || editing.merchant || '거래'} 내역을 수정했어요.`);
          }}
          onDelete={
            onDeleteTransaction
              ? async () => {
                  await onDeleteTransaction(editing.id);
                  setEditingId(null);
                }
              : undefined
          }
        />
      )}
      {children}
    </div>
  );
}
