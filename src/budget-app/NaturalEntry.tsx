import { useEffect, useRef, useState } from 'react';
import { confidenceMode, type BudgetAiUi } from './aiClient';
import type { BudgetClassification } from '../lib/budgetAi';

export function NaturalEntry({
  ai,
  onApply,
  onManual,
}: {
  ai: BudgetAiUi;
  onApply: (result: BudgetClassification, categoryId: string) => void;
  onManual: () => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<BudgetClassification | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => request.current?.abort(), []);
  const mode = result ? confidenceMode(result.confidence) : 'confirm';
  const classify = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    setResult(null);
    setDetail('');
    try {
      const candidate = await ai.classify(text, controller.signal);
      if (sequence.current !== current || controller.signal.aborted) return;
      setResult(candidate);
      setCategoryId(confidenceMode(candidate.confidence) === 'confirm' ? candidate.suggestedCategoryId : '');
    } catch (error) {
      if (sequence.current !== current || controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : '수동으로 입력해 주세요.');
      onManual();
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  };
  return (
    <section className="bb-natural" aria-label="자연어 거래 입력">
      <label htmlFor="budget-natural-text">한 문장으로 기록하기</label>
      <textarea
        id="budget-natural-text"
        maxLength={500}
        rows={2}
        placeholder="배민 저녁 24,900원"
        value={text}
        onChange={(event) => {
          sequence.current += 1;
          request.current?.abort();
          setBusy(false);
          setResult(null);
          setText(event.target.value);
        }}
      />
      <p className="bb-caption">직접 쓴 금액·사용처만 입력해 주세요. 계좌번호와 문자 원문은 입력하지 마세요.</p>
      <button type="button" className="bb-small-button" disabled={!text.trim() || busy} onClick={() => void classify()}>
        {busy ? '문장을 확인하는 중…' : '문장 해석하기'}
      </button>
      <p role="alert" className="bb-over-note">
        {error}
      </p>
      {result && (
        <div className="bb-ai-candidate">
          <p className="bb-caption">
            {result.source === 'ai' ? 'AI 추천' : '규칙·사전 분류'} · 신뢰도 {Math.round(result.confidence * 100)}% ·{' '}
            {result.reason}
          </p>
          <strong>
            {result.merchant} · {result.amount.toLocaleString('ko-KR')}원 · {result.date}
          </strong>
          <p>
            {mode === 'confirm'
              ? '추천 내용을 확인하고 입력 칸에 적용해 주세요.'
              : mode === 'choose'
                ? '카테고리를 직접 선택해 주세요.'
                : '어떤 수입 또는 지출인가요? 내용을 보충하고 카테고리를 골라 주세요.'}
          </p>
          <label>
            추천 거래 카테고리
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">직접 선택해 주세요</option>
              {ai.categories
                .filter((c) => c.type === result.type)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {mode === 'question' && (
            <label>
              어떤 거래인지 알려주세요
              <input
                maxLength={300}
                value={detail}
                placeholder="무엇을 구입했거나 받은 돈인가요?"
                onChange={(e) => setDetail(e.target.value)}
              />
            </label>
          )}
          <button
            type="button"
            className="bb-small-button"
            disabled={!categoryId || (mode === 'question' && !detail.trim())}
            onClick={() => onApply({ ...result, memo: detail.trim() || result.memo }, categoryId)}
          >
            추천 내용 확인 후 적용
          </button>
          <p className="bb-caption">아직 저장되지 않습니다. 아래 금액·날짜를 확인한 뒤 저장해 주세요.</p>
        </div>
      )}
    </section>
  );
}
