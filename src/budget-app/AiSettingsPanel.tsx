import { useState } from 'react';

export function AiSettingsPanel({
  classification,
  insights,
  onSave,
}: {
  classification: boolean;
  insights: boolean;
  onSave: (classification: boolean, insights: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const change = async (nextClassification: boolean, nextInsights: boolean) => {
    setBusy(true);
    setMessage('');
    try {
      await onSave(nextClassification, nextInsights);
      setMessage('AI 설정을 저장했습니다.');
    } catch {
      setMessage('AI 설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bb-card">
      <p className="bb-kicker">필요할 때만 도움받기</p>
      <h2>AI 사용 설정</h2>
      <p className="bb-caption">
        켜면 모르는 사용처의 직접 입력 문장 또는 계산한 집계만 Gemini에 전송합니다. 규칙·사전 분류는 AI가 꺼져 있어도
        동작합니다. AI 분류·소비 분석 요청은 합산해 계정당 하루 최대 30회입니다.
      </p>
      <label className="bb-toggle">
        <input
          type="checkbox"
          checked={classification}
          disabled={busy}
          onChange={(e) => void change(e.target.checked, insights)}
        />
        <span>AI 자연어 분류</span>
      </label>
      <label className="bb-toggle">
        <input
          type="checkbox"
          checked={insights}
          disabled={busy}
          onChange={(e) => void change(classification, e.target.checked)}
        />
        <span>AI 소비 분석</span>
      </label>
      <p role="status" className="bb-caption">
        {message}
      </p>
    </section>
  );
}
