import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BudgetCalculationInput } from '../types/budget';
import { buildBudgetAnalytics } from './analytics';

const colors = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#8A6500', '#444444'];
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const axisMoney = (n: number) => (n >= 10000 ? `${+(n / 10000).toFixed(1)}만` : n.toLocaleString('ko-KR'));

export function BudgetAnalytics({ input, names }: { input: BudgetCalculationInput; names: Record<string, string> }) {
  const data = buildBudgetAnalytics(input, names);
  const moneyBars = data.categories.filter((c) => c.budget > 0);
  const countBars = data.categories.filter((c) => c.coupons > 0);
  return (
    <>
      <section className="bb-card bb-analytics">
        <p className="bb-kicker">확정된 거래 기준</p>
        <h2>수입과 지출</h2>
        <p className="bb-caption">
          {data.start} ~ {data.end} · 오늘까지 · 단위: 원
        </p>
        <div className="bb-chart" role="img" aria-label={`수입 ${won(data.income)}, 지출 ${won(data.expense)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[
                { name: '수입', amount: data.income },
                { name: '지출', amount: data.expense },
              ]}
              margin={{ left: 0, right: 12, top: 28 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={axisMoney} width={55} />
              <Tooltip formatter={(value) => won(Number(value))} />
              <Bar
                dataKey="amount"
                name="금액"
                radius={[6, 6, 0, 0]}
                label={{ position: 'top', formatter: (value) => won(Number(value)), fontSize: 11 }}
              >
                <Cell fill={colors[0]} />
                <Cell fill={colors[1]} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="bb-caption">
          수입 {won(data.income)} · 지출 {won(data.expense)} · 차액 {won(data.income - data.expense)}
        </p>
      </section>
      <section className="bb-card bb-analytics">
        <h2>카테고리별 지출</h2>
        <p className="bb-caption">고정비·일회성 포함 · 단위: 원</p>
        {data.expense > 0 ? (
          <div className="bb-chart" role="img" aria-label="카테고리 지출 구성, 아래 목록에 금액과 비율 표시">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.categories.filter((c) => c.amount > 0)}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius="45%"
                  outerRadius="80%"
                  stroke="#fff"
                  strokeWidth={3}
                >
                  {data.categories
                    .filter((c) => c.amount > 0)
                    .map((c, i) => (
                      <Cell key={c.id} fill={colors[i % colors.length]} />
                    ))}
                </Pie>
                <Tooltip formatter={(value) => won(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="bb-caption">이 주기의 확정 지출이 없습니다.</p>
        )}
        <ul className="bb-chart-key">
          {data.categories
            .filter((c) => c.amount > 0)
            .map((c, i) => (
              <li key={c.id}>
                <span>
                  <i style={{ background: colors[i % colors.length] }} aria-hidden="true" />
                  {c.name}
                </span>
                <b>
                  {won(c.amount)} · {Math.round((c.amount / data.expense) * 100)}%
                </b>
              </li>
            ))}
        </ul>
      </section>
      <section className="bb-card bb-analytics">
        <h2>누적 변동지출과 한도</h2>
        <p className="bb-caption">실선: 실제 지출 · 점선: 주기 전체 한도 · 단위: 원</p>
        <div
          className="bb-chart"
          role="img"
          aria-label={`누적 변동지출 ${won(data.days.find((d) => d.date === input.today)?.spent || 0)}, 주기 한도 ${won(input.settings.variableExpenseLimit)}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.days} margin={{ right: 12, top: 12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(date) => String(date).slice(5)} minTickGap={35} />
              <YAxis tickFormatter={axisMoney} width={55} />
              <Tooltip formatter={(value) => won(Number(value))} />
              <Line
                dataKey="spent"
                name="누적 변동지출"
                stroke={colors[0]}
                strokeWidth={3}
                dot={false}
                connectNulls={false}
              />
              <Line
                dataKey="limit"
                name="월 변동지출 한도"
                stroke={colors[1]}
                strokeDasharray="7 5"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="bb-caption">일회성 포함, 예정 지출 제외. 미래 날짜에는 실제 지출을 표시하지 않습니다.</p>
      </section>
      <section className="bb-card bb-analytics">
        <h2>카테고리 예산과 쿠폰 사용률</h2>
        <p className="bb-caption">변동지출 기준 · 100%가 설정한 한도입니다. 초과분도 표시합니다.</p>
        {moneyBars.length === 0 && (
          <p className="bb-caption">관리 → 예산 기준에서 카테고리별 금액 한도를 정해 주세요.</p>
        )}
        {moneyBars.length > 0 && (
          <UsageChart
            rows={moneyBars.map((c) => ({
              name: c.name,
              rate: Math.round((c.variable / c.budget) * 100),
              text: `${won(c.variable)} / ${won(c.budget)}`,
            }))}
            unit="금액 예산"
          />
        )}
        {countBars.length > 0 ? (
          <UsageChart
            rows={countBars.map((c) => ({
              name: c.name,
              rate: Math.round((c.count / c.coupons) * 100),
              text: `${c.count}회 / ${c.coupons}회`,
            }))}
            unit="쿠폰"
          />
        ) : (
          <p className="bb-caption">설정된 쿠폰이 없습니다.</p>
        )}
      </section>
    </>
  );
}

function UsageChart({ rows, unit }: { rows: Array<{ name: string; rate: number; text: string }>; unit: string }) {
  return (
    <div>
      <h3>{unit} 사용률 (%)</h3>
      <div
        style={{ width: '100%', height: Math.max(110, rows.length * 42 + 30) }}
        role="img"
        aria-label={`${unit} 사용률, 아래 목록에 수치 표시`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ right: 36 }}>
            <XAxis type="number" domain={[0, (max: number) => Math.max(100, max)]} tickFormatter={(n) => `${n}%`} />
            <YAxis type="category" dataKey="name" width={85} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => `${value}%`} />
            <Bar
              dataKey="rate"
              name={unit}
              fill={unit === '쿠폰' ? colors[2] : colors[0]}
              label={{ position: 'right', formatter: (value) => `${value}%`, fontSize: 11 }}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="bb-chart-key">
        {rows.map((row) => (
          <li key={row.name}>
            <span>{row.name}</span>
            <b>
              {row.text} · {row.rate}%
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}
