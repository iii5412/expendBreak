import { formatKRW, MonthSummary } from './calculations';

export function spendingUsageLabel(summary: MonthSummary): string {
  return summary.budgetUsagePercent === null ? '가용 재원 없음' : `${summary.budgetUsagePercent}%`;
}

export function spendingConclusion(summary: MonthSummary): string {
  if (summary.spendPeriodStatus === 'closed') {
    return `마감된 생활비 주기입니다. 생활비 ${formatKRW(summary.confirmedVariableExpenses)} 사용 · ${summary.remainingAllowance < 0 ? `한도 ${formatKRW(-summary.remainingAllowance)} 초과` : `한도 잔여 ${formatKRW(summary.remainingAllowance)}`}`;
  }
  if (summary.spendPeriodStatus === 'upcoming') return '아직 시작하지 않은 생활비 주기입니다. 예정 수입과 고정 지출을 확인해 주세요.';
  if (summary.fundingShortfall > 0) return `고정 지출을 확보하는 데 ${formatKRW(summary.fundingShortfall)}이 부족합니다. 생활비 사용액 ${formatKRW(summary.confirmedVariableExpenses)}은 별도입니다.`;
  if (summary.remainingAllowance < 0) return `현재 적용 한도를 ${formatKRW(-summary.remainingAllowance)} 초과했습니다.`;
  if (summary.budgetUsagePercent === null) return '가용 생활비 재원이 없습니다. 수입과 고정 지출을 확인해 주세요.';
  if (summary.projectedDepletionDate) return `현재 속도면 ${summary.projectedDepletionDate}에 생활비가 끝날 가능성이 있습니다.`;
  if (summary.spendDaysPassed < 3) return '소비 기록이 쌓이면 지출 속도를 안내합니다.';
  return '현재 속도면 생활비 주기 종료일까지 생활비가 남습니다.';
}
