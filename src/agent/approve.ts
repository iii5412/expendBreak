import {
  deleteTransaction,
  finalizeTransactionDeletion,
  getTransactions,
  postOccurrenceToTransaction,
  restoreTransaction,
  saveTransaction,
  undoAmountChange,
  undoPostedOccurrence,
  updateOccurrencePlan,
  updateOccurrenceStatus,
  updateTransaction,
} from '../utils/storage';
import type { AgentProposalAction } from './executor';

/**
 * Applies a proposal the user approved, through the same storage functions the
 * screens use, so the revision protocol, category checks and Firestore sync
 * all still apply. Each success returns an undo for the proposal card.
 */

export interface AgentActionDeps {
  /** Reloads app state after a write. */
  refresh(): void;
  /** Recurring writes need a saved cycle plan, like the 고정지출 screen. */
  isCyclePlanSaved(): boolean;
}

export interface AgentActionResult {
  ok: boolean;
  message: string;
  undo?: () => Promise<AgentActionResult>;
}

const PLAN_MISSING = '이 주기는 아직 계획이 없습니다. 고정지출에서 ‘미리 준비하기’를 먼저 눌러 주세요.';
const changedMeanwhile = { ok: false, message: '그 사이 거래가 바뀌어 실행하지 않았습니다. 다시 요청해 주세요.' };

export async function applyAgentAction(action: AgentProposalAction, deps: AgentActionDeps): Promise<AgentActionResult> {
  const done = (message: string, undo?: AgentActionResult['undo']): AgentActionResult => {
    deps.refresh();
    return { ok: true, message, undo };
  };

  switch (action.kind) {
    case 'add_transaction': {
      const { transaction } = saveTransaction(action.draft);
      return done('거래를 추가했습니다.', async () => {
        const snapshot = deleteTransaction(transaction.id);
        if (snapshot) finalizeTransactionDeletion(snapshot);
        return done(snapshot ? '추가한 거래를 지웠습니다.' : '이미 삭제된 거래입니다.');
      });
    }

    case 'update_transaction': {
      const current = getTransactions().find(item => item.id === action.transactionId);
      if (!current || current.updatedAt !== action.expectedUpdatedAt) return changedMeanwhile;
      const updated = updateTransaction(action.transactionId, action.changes);
      if (!updated) return { ok: false, message: '거래를 수정하지 못했습니다.' };
      return done('거래를 수정했습니다.', async () => {
        const latest = getTransactions().find(item => item.id === action.transactionId);
        if (!latest || latest.updatedAt !== updated.updatedAt) return changedMeanwhile;
        return updateTransaction(action.transactionId, action.previous)
          ? done('수정 전으로 되돌렸습니다.')
          : { ok: false, message: '되돌리지 못했습니다.' };
      });
    }

    case 'delete_transaction': {
      const current = getTransactions().find(item => item.id === action.transactionId);
      if (!current || current.updatedAt !== action.expectedUpdatedAt) return changedMeanwhile;
      const snapshot = deleteTransaction(action.transactionId);
      if (!snapshot) return { ok: false, message: '이미 삭제된 거래입니다.' };
      return done('거래를 삭제했습니다.', async () => {
        restoreTransaction(snapshot.transaction, snapshot.restoredOccurrenceIds);
        return done('삭제를 취소했습니다.');
      });
    }

    case 'set_recurring_amount': {
      if (!deps.isCyclePlanSaved()) return { ok: false, message: PLAN_MISSING };
      const occurrence = await updateOccurrencePlan(action.occurrenceId, { amount: action.amount });
      if (!occurrence) return { ok: false, message: '금액을 확정하지 못했습니다. 이미 처리됐는지 확인해 주세요.' };
      const operationId = occurrence.lastOperationId;
      return done('금액을 확정했습니다.', operationId
        ? async () => (undoAmountChange(operationId)
          ? done('금액 확정을 되돌렸습니다.')
          : { ok: false, message: '그 사이 다른 변경이 있어 되돌릴 수 없습니다.' })
        : undefined);
    }

    case 'complete_recurring': {
      if (!deps.isCyclePlanSaved()) return { ok: false, message: PLAN_MISSING };
      const transaction = await postOccurrenceToTransaction(
        action.occurrenceId,
        action.amount ?? undefined,
        undefined,
        undefined,
        undefined,
        action.paidOn ?? undefined,
      );
      if (!transaction) return { ok: false, message: '완료 처리하지 못했습니다. 금액과 상태를 확인해 주세요.' };
      return done('완료 처리했습니다.', async () => (undoPostedOccurrence(action.occurrenceId)
        ? done('완료를 취소했습니다.')
        : { ok: false, message: '완료를 취소하지 못했습니다.' }));
    }

    case 'skip_recurring': {
      if (!deps.isCyclePlanSaved()) return { ok: false, message: PLAN_MISSING };
      updateOccurrenceStatus(action.occurrenceId, 'skipped');
      return done('이번 주기에서 제외했습니다.', async () => {
        updateOccurrenceStatus(action.occurrenceId, action.previousStatus);
        return done('제외를 취소했습니다.');
      });
    }
  }
}
