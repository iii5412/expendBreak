import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { dismissSyncConflict, getSyncConflicts, subscribeSyncConflicts, SyncConflict } from '../utils/firestoreSync';
import { formatKRW } from '../utils/calculations';

/**
 * An amount operation the cloud refused because another device changed the
 * same row first. The screen already shows the winning value (the realtime
 * snapshot replaced the local one); this banner explains what was not applied
 * so the user can re-enter it deliberately instead of it being merged silently.
 */
export const SyncConflictBanner: React.FC<{ onReview?: () => void }> = ({ onReview }) => {
  const [conflicts, setConflicts] = useState<SyncConflict[]>(() => getSyncConflicts());

  useEffect(() => subscribeSyncConflicts(() => setConflicts(getSyncConflicts())), []);

  if (conflicts.length === 0) return null;

  const describe = (conflict: SyncConflict) => {
    const record = conflict.changeRecord;
    if (!record) return '금액 변경';
    const after = record.after.amount == null ? '미입력' : formatKRW(record.after.amount);
    const kind = record.kind === 'post' ? '납부 완료'
      : record.kind === 'undo_post' ? '완료 취소'
      : record.kind === 'posted_correction' ? '완료 금액 수정' : '금액 확정';
    return `${record.scheduledDate} ${kind} → ${after}`;
  };

  return (
    <div role="alert" className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-bold"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />다른 기기에서 먼저 수정한 항목 {conflicts.length}건은 반영하지 않았습니다.</p>
          <p className="mt-0.5 text-amber-200/80">지금 화면의 값이 최신입니다. 필요하면 해당 항목을 다시 수정해 주세요.</p>
          <ul className="mt-1 space-y-0.5">
            {conflicts.slice(0, 3).map(conflict => (
              <li key={conflict.operationId} className="flex items-center justify-between gap-2">
                <span className="truncate">{describe(conflict)}</span>
                <button type="button" onClick={() => dismissSyncConflict(conflict.operationId)} className="shrink-0 rounded border border-amber-400/40 px-2 py-0.5 font-bold">확인</button>
              </li>
            ))}
            {conflicts.length > 3 && <li className="text-amber-200/70">외 {conflicts.length - 3}건</li>}
          </ul>
        </div>
        {onReview && (
          <button type="button" onClick={onReview} className="min-h-9 shrink-0 rounded-lg border border-amber-400/40 px-3 font-bold">고정지출 열기</button>
        )}
      </div>
    </div>
  );
};
