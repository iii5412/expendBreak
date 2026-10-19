import { useState } from 'react';

export function DataControls({
  exportCsv,
  resetData,
  isDemo,
}: {
  exportCsv: () => Promise<string>;
  resetData: () => Promise<void>;
  isDemo: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <section className="bb-card">
      <p className="bb-kicker">내 기록 관리</p>
      <h2>내보내기와 초기화</h2>
      <p className="bb-caption">
        CSV 저장 범위: {isDemo ? '이 브라우저의 체험 기록' : '현재 로그인한 계정의 전체 기간 거래'}. 한글 Excel 형식을
        지원합니다.
      </p>
      <button
        className="bb-small-button"
        type="button"
        disabled={busy || confirming}
        onClick={async () => {
          setBusy(true);
          setMessage('전체 거래를 불러오는 중입니다…');
          try {
            const csv = await exportCsv();
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `지출브레이크-전체거래-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            setMessage('CSV 다운로드를 요청했습니다. 저장 위치를 확인해 주세요.');
          } catch {
            setMessage('전체 거래를 내보내지 못했습니다. 연결과 동기화 상태를 확인해 주세요.');
          } finally {
            setBusy(false);
          }
        }}
      >
        전체 거래 CSV 내보내기
      </button>
      <details
        className="bb-data-danger"
        open={confirming || undefined}
        onToggle={(event) => {
          if (!event.currentTarget.open && !busy) {
            setConfirming(false);
            setPhrase('');
          }
        }}
      >
        <summary>계정 가계부 데이터 초기화</summary>
        <p className="bb-caption">
          거래·예산·정기 항목·계좌·카드·개인 규칙·영수증을 삭제하고 기본 설정으로 돌아갑니다. 되돌릴 수 없으므로 먼저
          CSV를 저장해 주세요. 로그인 계정과 PIN은 유지됩니다.
        </p>
        <button
          type="button"
          className="bb-small-button"
          disabled={busy}
          onClick={() => {
            setConfirming(true);
            setMessage('');
          }}
        >
          삭제 전 확인
        </button>
        {confirming && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || phrase !== '내 가계부 초기화') return;
              setBusy(true);
              setMessage('초기화 중입니다. 창을 닫지 마세요.');
              try {
                await resetData();
                setConfirming(false);
                setPhrase('');
                setMessage('가계부 데이터를 초기화했습니다.');
              } catch {
                setMessage('초기화가 완료되지 않았습니다. 남아 있는 기록을 확인하고 연결 후 다시 시도해 주세요.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="bb-setting">
              확인 문구: 내 가계부 초기화
              <input
                value={phrase}
                disabled={busy}
                autoComplete="off"
                onChange={(event) => setPhrase(event.target.value)}
              />
            </label>
            <p className="bb-caption">
              {isDemo ? '로컬 체험 기록만' : '현재 로그인한 계정의 실제 가계부 기록을'} 삭제합니다.
            </p>
            <div className="bb-button-row">
              <button
                type="button"
                className="bb-small-button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setPhrase('');
                }}
              >
                취소
              </button>
              <button
                type="submit"
                className="bb-small-button bb-danger-button"
                disabled={busy || phrase !== '내 가계부 초기화'}
              >
                {busy ? '삭제 중…' : '확인한 가계부 데이터 삭제'}
              </button>
            </div>
          </form>
        )}
      </details>
      <p className="bb-caption" role="status">
        {message}
      </p>
    </section>
  );
}
