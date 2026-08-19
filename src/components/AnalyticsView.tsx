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
    { name: '카드대금', amount: summary.cardSettlementOutflow, fill: '#6366F1' },
    { name: '생활비 사용', amount: summary.confirmedVariableExpenses, fill: '#F43F5E' },
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

  return (
    <div className="space-y-6 pb-24">
      {/* Top AI Report Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">지출 브레이크 AI 맞춤 리포트</h2>
              <p className="text-xs text-slate-400">수치 원본에 기반한 절약 및 위험 분석</p>
            </div>
          </div>

          <button
            onClick={() => fetchAiFeedback(true)}
            disabled={isLoadingFeedback || !aiInsightsEnabled}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFeedback ? 'animate-spin' : ''}`} />
            <span>재분석</span>
          </button>
        </div>

        {!aiInsightsEnabled ? (
          <div className="text-center py-6 text-xs text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
            AI 월간 리포트가 꺼져 있습니다. 설정에서 다시 활성화할 수 있습니다.
          </div>
        ) : feedback ? (
          <div className="space-y-3.5 text-xs">
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 font-bold text-slate-100 text-sm">
              "{feedback.oneLiner}"
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
          <div className="text-center py-6 text-xs text-slate-400">
            {isLoadingFeedback ? 'AI 리포트를 생성하는 중입니다...' : 'AI 분석을 불러오는 중...'}
          </div>
        )}
      </div>

      <CashflowTimelineCard timeline={cashflowTimeline} />

      <FutureCommitmentsCard summary={futureCommitments} />

      {/* 1. Income vs Expense Overview Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
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
      </div>

      {/* 2. Donut Category Breakdown Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
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
      </div>

      {/* 3. Cumulative Daily Allowance Spend vs Allowance Limit */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-3">일별 누적 생활비 사용 vs 사용 가능액</h3>
        <p className="-mt-2 mb-3 text-xs text-slate-400">할부는 원금이 아닌 이번 달 회차 금액을 월초에 반영합니다.</p>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="day" stroke="#94A3B8" fontSize={10} />
              <YAxis stroke="#94A3B8" fontSize={10} tickFormatter={v => `${v / 10000}만`} />
              <Tooltip formatter={(val: any) => formatKRW(val)} />
              <Line type="monotone" dataKey="spend" name="누적 생활비 사용" stroke="#F43F5E" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="limit" name="사용 가능 생활비" stroke="#10B981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
