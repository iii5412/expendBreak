import { useState } from 'react';
import { getStartView, setStartView, type StartView } from '../utils/startView';

/** Lets the user pick which screen opens after unlocking, and open the classic one now. */
export function StartViewSetting() {
  const [view, setView] = useState<StartView>(getStartView);
  const [message, setMessage] = useState('');
  const choose = (next: StartView) => {
    if (next === view) return;
    if (setStartView(next)) {
      setView(next);
      setMessage(next === 'budget' ? '다음부터 예산뷰로 시작해요.' : '다음부터 기존 화면으로 시작해요.');
    } else {
      setMessage('이 기기에 설정을 저장하지 못했습니다.');
    }
  };
  return (
    <section className="bb-card">
      <p className="bb-kicker">화면 설정</p>
      <h2>시작 화면</h2>
      <p className="bb-caption">잠금을 풀었을 때 처음 보이는 화면입니다. 이 기기에만 적용돼요.</p>
      <div className="bb-button-row" role="group" aria-label="시작 화면">
        <button type="button" className="bb-small-button" aria-pressed={view === 'budget'} onClick={() => choose('budget')}>
          예산뷰
        </button>
        <button type="button" className="bb-small-button" aria-pressed={view === 'classic'} onClick={() => choose('classic')}>
          기존 화면
        </button>
        <a href="/?view=classic">기존 화면 지금 열기</a>
      </div>
      {message && (
        <p className="bb-caption" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
