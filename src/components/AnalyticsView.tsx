import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import {
  MonthSummary,
  formatKRW,
  getCategoryBreakdown,
  getLocalDateString,
  isSpendingTransaction,
} from '../utils/calculations';
import { Transaction, Category, AIFeedbackResult } from '../types';
import { FutureCommitmentSummary } from '../utils/futureCommitments';
import { FutureCommitmentsCard } from './FutureCommitmentsCard';
import { CashflowTimeline } from '../utils/cashflowTimeline';
import { CashflowTimelineCard } from './CashflowTimelineCard';
import { getCachedAIFeedback, saveCachedAIFeedback } from '../utils/storage';
import { authenticatedFetch } from '../utils/auth';
import { getInstallmentCharge } from '../utils/installments';
import { ScreenHeader } from './ui/ScreenHeader';

interface AnalyticsViewProps {
  summary: MonthSummary;
  futureCommitments: FutureCommitmentSummary;
  cashflowTimeline: CashflowTimeline;
  transactions: Transaction[];
  categories: Category[];
  aiInsightsEnabled?: boolean;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  summary,
  futureCommitments,
  cashflowTimeline,
  transactions,
  categories,
  aiInsightsEnabled = true,
}) => {
  const [feedback, setFeedback] = useState<AIFeedbackResult | null>(null);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState<boolean>(false);

  // 1. Cash track (income, committed outflows) beside spend track (living expenses)
  const incomeVsExpenseData = [
    { name: '수입', amount: summary.planningIncome, fill: '#10B981' },
    { name: '계좌 고정 이체', amount: summary.accountFixedOutflow, fill: '#64748B' },
    { name: '카드대금', amount: summary.cardSettlementOutflow, fill: '#78A9FF' },
    { name: '생활비 사용', amount: summary.confirmedVariableExpenses, fill: '#FF4D3D' },
  ];

  // 2. Allowance category breakdown (fixed recurring expenses stay separate)
  const categoryInfo = Object.fromEntries(categories.map(category => [category.id, category]));
  const categoryPieData = getCategoryBreakdown(
    summary.yearMonth,
    transactions,
    categoryInfo,
    { variableOnly: true, monthStartDay: 1 },
  ).map(item => ({ name: item.categoryName, value: item.amount, color: item.color }));
  const feedbackCacheKey = [
    summary.yearMonth,
    summary.planningIncome,
    summary.accountFixedOutflow,
    summary.cardSettlementOutflow,
    summary.confirmedVariableExpenses,
    summary.remainingLivingBudget,
    ...categoryPieData.map(item => `${item.name}:${item.value}`),
  ].join('|');

  // 3. Cumulative daily allowance spend vs allowance limit, walked across the
  // calendar spending month, matching MonthSummary.confirmedVariableExpenses.
  const cumulativeData: { day: string; spend: number; limit: number }[] = [];
  let runningTotal = 0;
  const [periodStartYear, periodStartMonth, periodStartDay] = summary.spendPeriodStartDate.split('-').map(Number);
  const installmentAmount = transactions
    .filter(transaction => transaction.type === 'expense'
      && !transaction.recurringTemplateId
      && isSpendingTransaction(transaction)
      && Boolean(transaction.installment))
    .reduce((sum, transaction) => (
      sum + (getInstallmentCharge(transaction.amount, transaction.installment, summary.yearMonth)?.amount ?? 0)
    ), 0);

  for (let offset = 0; offset < summary.spendDaysInMonth; offset++) {
    const dayDate = new Date(periodStartYear, periodStartMonth - 1, periodStartDay + offset);
    const dayStr = getLocalDateString(dayDate);
    const daySpend = transactions
      .filter(t => t.type === 'expense'
        && !t.recurringTemplateId
        && !t.installment
        && isSpendingTransaction(t)
        && t.localDate === dayStr)
      .reduce((sum, t) => sum + t.amount, 0);

    // An installment round is already committed for the month and has no new
    // purchase date, so place it at month start instead of replaying the principal.
    runningTotal += daySpend + (offset === 0 ? installmentAmount : 0);

    cumulativeData.push({
      day: `${dayDate.getDate()}일`,
      spend: runningTotal,
      limit: summary.spendableLimit,
    });
  }

  // Fetch AI Feedback
  const fetchAiFeedback = async (force = false) => {
    if (!aiInsightsEnabled) return;
    if (!force) {
      const cached = getCachedAIFeedback(feedbackCacheKey);
      if (cached) {
        setFeedback(cached);
        return;
      }
    }

    setIsLoadingFeedback(true);
    try {
      const res = await authenticatedFetch('/api/ai/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          monthSummary: summary,
          categoryBreakdown: categoryPieData,
        }),
      });

      if (!res.ok) throw new Error('Feedback API Error');
      const data: AIFeedbackResult = await res.json();
      data.generatedAt = new Date().toISOString();

      setFeedback(data);
      saveCachedAIFeedback(feedbackCacheKey, data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingFeedback(false);
    }
  };

  useEffect(() => {
    if (aiInsightsEnabled) fetchAiFeedback();
    else setFeedback(null);
  }, [
    aiInsightsEnabled,
    feedbackCacheKey,
  ]);

  const ruleBasedConclusion = summary.projectedDepletionDate
    ? `현재 속도면 ${summary.projectedDepletionDate}에 생활비가 끝날 가능성이 있습니다.`
    : summary.budgetUsagePercent > summary.periodProgressPercent + 10
      ? `기간 경과보다 생활비 사용이 ${summary.budgetUsagePercent - summary.periodProgressPercent}%p 빠릅니다.`
      : '현재 지출 속도면 이번 주기 생활비를 유지할 수 있습니다.';

  return (
    <div className="space-y-6 pb-24">
      <ScreenHeader
        eyebrow="Spending intelligence"
        title="지출 분석"
        description="차트를 해석하는 대신, 이번 주기의 결론과 원인 그리고 지금 바꿀 행동을 먼저 보여드립니다."
        icon={<TrendingUp className="h-4 w-4" />}
        meta={<span>{summary.spendPeriodStartDate}–{summary.spendPeriodEndDate} · 생활비 {summary.budgetUsagePercent}% 사용</span>}
      />

      {/* Top AI Report Header */}
      <section className="eb-instrument rounded-xl p-5" aria-labelledby="weekly-conclusion-title">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="eb-kicker text-amber-300">Decision first</p>
            <h3 id="weekly-conclusion-title" className="eb-display mt-1 text-lg font-extrabold text-white">이번 주 결론</h3>
          </div>

          <button
            onClick={() => fetchAiFeedback(true)}
            disabled={isLoadingFeedback || !aiInsightsEnabled}
            className="flex min-h-11 items-center gap-1 border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFeedback ? 'animate-spin' : ''}`} />
            <span>재분석</span>
          </button>
        </div>

        {!aiInsightsEnabled ? (
          <div className="border-l-2 border-emerald-500 bg-slate-950/55 px-4 py-3">
            <p className="text-sm font-bold leading-relaxed text-slate-100">{ruleBasedConclusion}</p>
            <p className="mt-1 text-xs text-slate-400">AI가 꺼져 있어도 확정된 수치로 계산한 결론은 계속 제공됩니다.</p>
          </div>
        ) : feedback ? (
          <div className="space-y-3.5 text-xs">
            <div className="border-l-2 border-amber-400 bg-slate-950/55 px-4 py-3 text-sm font-bold leading-relaxed text-slate-100">
              {feedback.oneLiner || ruleBasedConclusion}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-950/60 p-3 rounded-xl border border-emerald-500/30">
                <div className="text-emerald-400 font-bold mb-1 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>잘하고 있는 점</span>
                </div>
                <p className="text-slate-300">{feedback.positivePoint}</p>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-rose-500/30">
                <div className="text-rose-400 font-bold mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>위험 요인</span>
                </div>
                <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                  {feedback.riskFactors?.map((rf, idx) => (
                    <li key={idx}>{rf}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-2">
              <div className="font-bold text-amber-300 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>이번 주 추천 절약 행동</span>
              </div>
              <div className="space-y-1.5">
                {feedback.weeklyActions?.map((act, idx) => (
                  <div key={idx} className="flex items-center justify-between text-slate-200">
                    <span>• {act.action}</span>
                    <span className="font-bold text-emerald-400">{act.estimatedSavings}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="border-l-2 border-slate-600 bg-slate-950/55 px-4 py-3">
            <p className="text-sm font-bold leading-relaxed text-slate-100">{ruleBasedConclusion}</p>
            <p className="mt-1 text-xs text-slate-400">
              {isLoadingFeedback ? 'AI가 근거와 추천 행동을 정리하고 있습니다.' : '확정된 수치로 계산한 기본 결론입니다.'}
            </p>
          </div>
        )}
      </section>

      <CashflowTimelineCard timeline={cashflowTimeline} />

      <FutureCommitmentsCard summary={futureCommitments} />

      {/* 1. Income vs Expense Overview Chart */}
      <section className="eb-panel rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-3">수입·고정 출금·생활비 구조</h3>
        <p className="-mt-2 mb-3 text-xs text-slate-400">
          카드대금은 계좌 고정 이체와 분리된 현금 출금이며 생활비에 다시 합산하지 않습니다.
        </p>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={incomeVsExpenseData}>
              <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} />
              <YAxis stroke="#94A3B8" fontSize={10} tickFormatter={v => `${v / 10000}만`} />
              <Tooltip
                formatter={(val: any) => formatKRW(val)}
                contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
              />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 2. Donut Category Breakdown Chart */}
      <section className="eb-panel rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-3">카테고리별 생활비 사용 비중</h3>
        {categoryPieData.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-400">지출 기록이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {categoryPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: any) => formatKRW(val)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-1.5 text-xs">
              {categoryPieData.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-1.5 rounded bg-slate-950/40">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-slate-300 font-medium">{item.name}</span>
                  </div>
                  <span className="font-bold text-slate-100">{formatKRW(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 3. Cumulative Daily Allowance Spend vs Allowance Limit */}
      <section className="eb-panel rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-3">일별 누적 생활비 사용 vs 사용 가능액</h3>
        <p className="-mt-2 mb-3 text-xs text-slate-400">할부는 원금이 아닌 이번 달 회차 금액을 월초에 반영합니다.</p>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363C" />
              <XAxis dataKey="day" stroke="#94A3B8" fontSize={10} />
              <YAxis stroke="#94A3B8" fontSize={10} tickFormatter={v => `${v / 10000}만`} />
              <Tooltip formatter={(val: any) => formatKRW(val)} />
              <Line type="monotone" dataKey="spend" name="누적 생활비 사용" stroke="#FF4D3D" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="limit" name="사용 가능 생활비" stroke="#10B981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
};
