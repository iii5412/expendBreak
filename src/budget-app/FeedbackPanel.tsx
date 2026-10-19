import { useEffect, useRef, useState } from 'react';
import type { BudgetFeedback, BudgetFeedbackSummary } from '../lib/budgetAi';

export function FeedbackPanel({
  enabled,
  summary,
  request,
}: {
  enabled: boolean;
  summary: BudgetFeedbackSummary;
  request: (summary: BudgetFeedbackSummary, signal: AbortSignal) => Promise<BudgetFeedback>;
}) {
  const [report, setReport] = useState<BudgetFeedback | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const summaryKey = JSON.stringify(summary);
  useEffect(() => {
    controller.current?.abort();
    setReport(null);
    setBusy(false);
    setError('');
  }, [enabled, summaryKey]);
  const run = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const result = await request(summary, current.signal);
      if (!current.signal.aborted) setReport(result);
    } catch (error) {
      if (!current.signal.aborted) setError(error instanceof Error ? error.message : '분석을 불러오지 못했습니다.');
    } finally {
      if (controller.current === current) setBusy(false);
    }
  };
  return (
    <section className="bb-card">
      <p className="bb-kicker">숫자로 살펴보는 소비 습관</p>
      <h2>AI 소비 피드백</h2>
      <p className="bb-caption">가맹점·메모·원시 거래 없이 예산, 지출 합계와 카테고리별 집계만 전송합니다.</p>
      <button className="bb-primary" type="button" disabled={!enabled || busy} onClick={() => void run()}>
        {busy ? '집계로 분석하는 중…' : '이번 주 소비 피드백 받기'}
      </button>
      {!enabled && <p className="bb-caption">관리에서 AI 소비 분석을 켜면 사용할 수 있습니다.</p>}
      <p role="alert" className="bb-over-note">
        {error}
      </p>
      {report && (
        <div className="bb-feedback-report">
          <h3>{report.oneLiner}</h3>
          <p>잘한 점 · {report.positivePoint}</p>
          {report.riskFactors.length > 0 && (
            <>
              <h4>주의할 점</h4>
              <ul>
                {report.riskFactors.map((risk, index) => (
                  <li key={index}>{risk}</li>
                ))}
              </ul>
            </>
          )}
          <h4>이번 주 해볼 일</h4>
          <ul>
            {report.weeklyActions.map((action, index) => (
              <li key={index}>
                {action.action}
                <small>
                  예상 절감액 {action.savingsMin.toLocaleString('ko-KR')}~{action.savingsMax.toLocaleString('ko-KR')}원
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
