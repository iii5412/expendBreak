import { formatKRW, MonthSummary } from './calculations';

export function spendingUsageLabel(summary: MonthSummary): string {
  return summary.budgetUsagePercent === null ? '가용 재원 없음' : `${summary.budgetUsagePercent}%`;
}

export function spendingConclusion(summary: MonthSummary): string {
  if (summary.spendPeriodStatus === 'closed') {
    // Closed cycle: report the result against both yardsticks separately and
    // never mix them into one number (PRD-ui-renewal §5 마감 주기).
    const used = summary.confirmedVariableExpenses;
    const limitPart = summary.allowanceLimit > 0
      ? (used > summary.allowanceLimit ? `설정 한도 대비 ${formatKRW(used - summary.allowanceLimit)} 초과` : `설정 한도 잔여 ${formatKRW(summary.allowanceLimit - used)}`)
      : null;
    const fundingPart = used > summary.signedLivingBudget
      ? `재원 대비 ${formatKRW(used - summary.signedLivingBudget)} 초과`
      : `재원 잔여 ${formatKRW(summary.signedLivingBudget - used)}`;
    const provisional = summary.calculationStatus !== 'confirmed' ? ' (잠정 결과)' : '';
    return `마감된 생활비 주기입니다${provisional}. 생활비 ${formatKRW(used)} 사용 · ${[limitPart, fundingPart].filter(Boolean).join(' · ')}`;
  }
  if (summary.spendPeriodStatus === 'upcoming') return '아직 시작하지 않은 생활비 주기입니다. 예정 수입과 고정 지출을 확인해 주세요.';
  if (summary.fundingShortfall > 0) return `고정 지출을 확보하는 데 ${formatKRW(summary.fundingShortfall)}이 부족합니다. 생활비 사용액 ${formatKRW(summary.confirmedVariableExpenses)}은 별도입니다.`;
  if (summary.remainingAllowance < 0) return `현재 적용 한도를 ${formatKRW(-summary.remainingAllowance)} 초과했습니다.`;
  if (summary.budgetUsagePercent === null) return '가용 생활비 재원이 없습니다. 수입과 고정 지출을 확인해 주세요.';
  if (summary.projectedDepletionDate) return `현재 속도면 ${summary.projectedDepletionDate}에 생활비가 끝날 가능성이 있습니다.`;
  if (summary.spendDaysPassed < 3) return '소비 기록이 쌓이면 지출 속도를 안내합니다.';
  return '현재 속도면 생활비 주기 종료일까지 생활비가 남습니다.';
}
