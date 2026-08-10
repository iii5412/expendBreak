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
import { MonthSummary, formatKRW } from '../utils/calculations';
import { Transaction, Category, Budget, AIFeedbackResult } from '../types';
import { getCachedAIFeedback, saveCachedAIFeedback } from '../utils/storage';
import { authenticatedFetch } from '../utils/auth';

interface AnalyticsViewProps {
  summary: MonthSummary;
  transactions: Transaction[];
  categories: Category[];
  budget: Budget;
  aiInsightsEnabled?: boolean;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  summary,
  transactions,
  categories,
  budget,
  aiInsightsEnabled = true,
}) => {
  const [feedback, setFeedback] = useState<AIFeedbackResult | null>(null);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState<boolean>(false);

  const catMap = new Map<string, Category>(categories.map(c => [c.id, c]));

  // 1. Income vs Expense
  const incomeVsExpenseData = [
    { name: '수입', amount: summary.totalIncome, fill: '#10B981' },
    { name: '실제지출', amount: summary.confirmedExpenses, fill: '#F43F5E' },
    { name: '고정지출예정', amount: summary.remainingScheduledExpenses, fill: '#6366F1' },
  ];

  // 2. Category Pie Breakdown
  const categoryMap: Record<string, number> = {};
  transactions
    .filter(t => t.type === 'expense' && t.localDate.startsWith(summary.yearMonth))
    .forEach(t => {
      const categoryId = catMap.get(t.categoryId)?.type === 'expense' ? t.categoryId : '__needs_review_expense';
      categoryMap[categoryId] = (categoryMap[categoryId] || 0) + t.amount;
    });

  const categoryPieData = Object.entries(categoryMap).map(([catId, amount]) => {
    const info = catMap.get(catId);
    return {
      name: catId === '__needs_review_expense' ? '분류 확인 필요' : info?.name || '기타',
      value: amount,
      color: catId === '__needs_review_expense' ? '#F59E0B' : info?.color || '#94A3B8',
    };
  });

  // 3. Cumulative Daily Spend vs Monthly Limit Line Chart
  const daysInMonth = summary.daysInMonth;
  const cumulativeData: { day: string; spend: number; limit: number }[] = [];
  let runningTotal = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${summary.yearMonth}-${String(d).padStart(2, '0')}`;
    const daySpend = transactions
      .filter(t => t.type === 'expense' && t.localDate === dayStr)
      .reduce((sum, t) => sum + t.amount, 0);

    runningTotal += daySpend;

    cumulativeData.push({
      day: `${d}일`,
      spend: runningTotal,
      limit: summary.monthlyBudgetLimit,
    });
  }

  // 4. Category Budget vs Actual Bar Chart
  const categoryBudgetBarData = Object.entries(budget.categoryLimits || {}).map(([catId, limit]) => {
    const actual = categoryMap[catId] || 0;
    const cat = catMap.get(catId);
    return {
      name: cat?.name || '기타',
      actual,
      limit,
    };
  });

  // Fetch AI Feedback
  const fetchAiFeedback = async (force = false) => {
    if (!aiInsightsEnabled) return;
    const periodId = summary.yearMonth;
    if (!force) {
      const cached = getCachedAIFeedback(periodId);
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
      saveCachedAIFeedback(periodId, data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingFeedback(false);
    }
  };

  useEffect(() => {
    if (aiInsightsEnabled) fetchAiFeedback();
    else setFeedback(null);
  }, [summary.yearMonth, aiInsightsEnabled]);

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
              <p className="text-[11px] text-slate-400">수치 원본에 기반한 절약 및 위험 분석</p>
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
          <div className="text-center py-6 text-xs text-slate-500">
            {isLoadingFeedback ? 'AI 리포트를 생성하는 중입니다...' : 'AI 분석을 불러오는 중...'}
          </div>
        )}
      </div>

      {/* 1. Income vs Expense Overview Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-3">수입 vs 지출 구조</h3>
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
        <h3 className="text-sm font-bold text-slate-200 mb-3">카테고리별 지출 비중</h3>
        {categoryPieData.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-500">지출 기록이 없습니다.</div>
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

      {/* 3. Cumulative Daily Spend vs Monthly Limit Line Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-3">일별 누적 지출 vs 월 한도</h3>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="day" stroke="#94A3B8" fontSize={10} />
              <YAxis stroke="#94A3B8" fontSize={10} tickFormatter={v => `${v / 10000}만`} />
              <Tooltip formatter={(val: any) => formatKRW(val)} />
              <Line type="monotone" dataKey="spend" name="누적 지출" stroke="#F43F5E" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="limit" name="월 한도" stroke="#10B981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
