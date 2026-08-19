import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Landmark,
  PiggyBank,
  Sparkles,
  Wallet,
} from 'lucide-react';
import {
  BankAccount,
  PaymentCard,
  PaymentMethodType,
  RecurringOccurrence,
  RecurringTemplate,
} from '../types';
import { AccountingPeriod, MonthSummary, formatKRW, formatPeriodRange } from '../utils/calculations';
import { MonthlyCardSettlementSummary } from '../utils/cardPayments';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';

/**
 * The payday routine as one flow: confirm the deposit, transfer the fixed costs,
 * check the card bill, then commit to a living budget for the cycle.
 *
 * These four things already existed across three screens with no signal that the
 * routine was finished. Step 4 writes the cycle baseline, which is what stops the
 * remaining balance from drifting for the rest of the cycle (INV-4).
 */

const STEPS = ['급여 입금', '고정지출 이체', '카드대금', '생활비 확정'] as const;

interface PaydaySetupSheetProps {
  isOpen: boolean;
  onClose: () => void;
  period: AccountingPeriod;
  summary: MonthSummary;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  cardSettlementSummary: MonthlyCardSettlementSummary;
  /** Manual "카드대금" items the generated bill stands in for, so they are not listed. */
  replacedCardSettlementCount: number;
  onPostOccurrence: (
    occurrenceId: string,
    amount?: number,
    paymentMethodType?: PaymentMethodType,
    accountId?: string | null,
    cardId?: string | null,
  ) => Promise<void> | void;
  onSaveCardSettlementAmount: (cardId: string, amount: number) => void;
  onConfirmBaseline: (savingsReserve: number) => Promise<void> | void;
  onCopyText: (text: string, message: string) => void;
}

export const PaydaySetupSheet: React.FC<PaydaySetupSheetProps> = ({
  isOpen,
  onClose,
  period,
  summary,
  recurringOccurrences,
  recurringTemplates,
  bankAccounts,
  paymentCards,
  cardSettlementSummary,
  replacedCardSettlementCount,
  onPostOccurrence,
  onSaveCardSettlementAmount,
  onConfirmBaseline,
  onCopyText,
}) => {
  const [step, setStep] = useState(0);
  const [incomeAmountDrafts, setIncomeAmountDrafts] = useState<Record<string, number>>({});
  const [cardAmountDrafts, setCardAmountDrafts] = useState<Record<string, number>>({});
  const [savingsReserve, setSavingsReserve] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const templateMap = useMemo(
    () => new Map(recurringTemplates.map(template => [template.id, template])),
    [recurringTemplates],
  );
  const accountMap = useMemo(
    () => new Map(bankAccounts.map(account => [account.id, account])),
    [bankAccounts],
  );

  const isPending = (occurrence: RecurringOccurrence) =>
    occurrence.status !== 'posted' && occurrence.status !== 'skipped';

  const typeOf = (occurrence: RecurringOccurrence) =>
    occurrence.typeSnapshot ?? templateMap.get(occurrence.templateId)?.type ?? 'expense';

  const methodOf = (occurrence: RecurringOccurrence) =>
    occurrence.paymentMethodType ?? templateMap.get(occurrence.templateId)?.paymentMethodType;

  const visibleOccurrences = useMemo(
    () => recurringOccurrences.filter(occurrence => occurrence.status !== 'skipped'),
    [recurringOccurrences],
  );

  const incomeOccurrences = useMemo(
    () => visibleOccurrences.filter(occurrence => typeOf(occurrence) === 'income'),
    [visibleOccurrences, templateMap],
  );

  // Card-paid fixed expenses are settled through the card bill, so the transfer
  // checklist only lists what actually leaves an account on payday.
  const transferOccurrences = useMemo(
    () => visibleOccurrences
      .filter(occurrence => typeOf(occurrence) === 'expense' && methodOf(occurrence) !== 'card')
      .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate)),
    [visibleOccurrences, templateMap],
  );

  // Fixed expenses that are real, just not transfers. Listing them by name is
  // what turns "왜 항목이 모자라지?" into an answer the user can check.
  const cardPaidOccurrences = useMemo(
    () => visibleOccurrences
      .filter(occurrence => typeOf(occurrence) === 'expense' && methodOf(occurrence) === 'card')
      .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate)),
    [visibleOccurrences, templateMap],
  );

  /** Transfers grouped the way the user actually does them: one bank at a time. */
  const transferGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      label: string;
      accountNumber: string;
      accountHolder: string;
      items: RecurringOccurrence[];
      pendingAmount: number;
    }>();

    transferOccurrences.forEach(occurrence => {
      const template = templateMap.get(occurrence.templateId);
      const linkedAccount = accountMap.get(occurrence.accountId || template?.accountId || '');
      const bankName = linkedAccount?.bankName || template?.bankName || '은행 미지정';
      const accountNumber = linkedAccount?.accountNumber || template?.accountNumber || '';
      const accountHolder = linkedAccount?.accountHolder || template?.accountHolder || template?.counterparty || '';
      const key = `${bankName}___${accountNumber}___${accountHolder}`;

      const group = groups.get(key) || {
        key,
        label: bankName,
        accountNumber,
        accountHolder,
        items: [],
        pendingAmount: 0,
      };
      group.items.push(occurrence);
      if (isPending(occurrence)) {
        group.pendingAmount += Math.round(occurrence.actualAmount ?? occurrence.expectedAmount);
      }
      groups.set(key, group);
    });

    return [...groups.values()].sort((left, right) => right.pendingAmount - left.pendingAmount);
  }, [transferOccurrences, templateMap, accountMap]);

  const pendingIncome = incomeOccurrences.filter(isPending);
  const pendingTransfers = transferOccurrences.filter(isPending);

  // Reset only when the sheet opens, so navigating back and forth keeps drafts.
  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setSavingsReserve(summary.savingsReserve);
    setIncomeAmountDrafts(Object.fromEntries(
      incomeOccurrences.map(occurrence => [
        occurrence.id,
        Math.round(occurrence.actualAmount ?? occurrence.expectedAmount),
      ]),
    ));
    setCardAmountDrafts(Object.fromEntries(
      cardSettlementSummary.cards.map(card => [card.cardId, card.amount]),
    ));
  }, [isOpen]);

  const periodRange = formatPeriodRange(period);

  const handleConfirmIncome = async (occurrence: RecurringOccurrence) => {
    const amount = incomeAmountDrafts[occurrence.id] ?? occurrence.expectedAmount;
    if (amount <= 0) return;
    await onPostOccurrence(occurrence.id, amount, methodOf(occurrence) ?? 'account');
  };

  const handleConfirmTransfer = async (occurrence: RecurringOccurrence) => {
    const template = templateMap.get(occurrence.templateId);
    await onPostOccurrence(
      occurrence.id,
      Math.round(occurrence.actualAmount ?? occurrence.expectedAmount),
      'account',
      occurrence.accountId || template?.accountId || null,
      null,
    );
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      await onConfirmBaseline(savingsReserve);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  // Step 4 previews the reserve the user is typing, so it cannot read the
  // already-locked summary value.
  const previewLivingBudget = Math.max(
    0,
    summary.planningIncome - summary.accountFixedOutflow - summary.cardSettlementOutflow - savingsReserve,
  );
  const previewDaily = Math.floor(previewLivingBudget / Math.max(1, period.daysInMonth));

  const renderStepDots = () => (
    <ol className="flex items-center gap-1.5" aria-label="급여일 확정 단계">
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            aria-current={index === step ? 'step' : undefined}
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors ${
              index === step
                ? 'bg-emerald-500 text-slate-950'
                : index < step
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
            }`}
          >
            {index + 1}. {label}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="급여일 확정"
      panelClassName="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
    >
      <div className="space-y-4">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Sparkles className="h-5 w-5 text-amber-300" />
                급여일 확정
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {period.yearMonth} 주기{periodRange && ` · ${periodRange}`} · {period.daysInMonth}일
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              나중에
            </button>
          </div>
          <div className="overflow-x-auto pb-1">{renderStepDots()}</div>
        </header>

        {/* Step 1 — confirm the deposit */}
        {step === 0 && (
          <section className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-400">
              급여가 통장에 들어왔는지 확인합니다. 실제 입금액이 예정과 다르면 고쳐서 확정하세요.
            </p>

            {incomeOccurrences.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-center text-xs text-slate-400">
                <p>이 주기에 등록된 정기 수입이 없습니다.</p>
                <p className="mt-1">정기/고정 관리에서 급여 항목을 먼저 등록하면 매달 자동으로 잡힙니다.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {incomeOccurrences.map(occurrence => {
                  const template = templateMap.get(occurrence.templateId);
                  const posted = occurrence.status === 'posted';
                  return (
                    <li
                      key={occurrence.id}
                      className={`rounded-xl border p-3 ${
                        posted ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                            <Landmark className="h-4 w-4 shrink-0 text-emerald-400" />
                            <span className="truncate">{template?.name || '정기 수입'}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">{occurrence.scheduledDate} 예정</p>
                        </div>
                        {posted && (
                          <span className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            입금 확인됨
                          </span>
                        )}
                      </div>

                      {posted ? (
                        <p className="mt-2 text-lg font-extrabold text-emerald-300">
                          {formatKRW(occurrence.actualAmount ?? occurrence.expectedAmount)}
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <AmountInput
                            value={incomeAmountDrafts[occurrence.id] ?? occurrence.expectedAmount}
                            onChange={amount => setIncomeAmountDrafts(drafts => ({ ...drafts, [occurrence.id]: amount }))}
                            className="text-base text-emerald-300"
                          />
                          <button
                            type="button"
                            onClick={() => void handleConfirmIncome(occurrence)}
                            className="min-h-10 w-full rounded-lg bg-emerald-500 text-xs font-extrabold text-slate-950 transition-colors hover:bg-emerald-600"
                          >
                            입금 확정
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {pendingIncome.length > 0 && (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-amber-200">
                아직 확정하지 않은 수입이 있습니다. 확정하지 않아도 계속 진행할 수 있고, 계획은 예정 금액 기준으로 세워집니다.
              </p>
            )}
          </section>
        )}

        {/* Step 2 — the transfer checklist */}
        {step === 1 && (
          <section className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-400">
              은행별로 묶었습니다. 이체한 항목을 체크하면 그 자리에서 거래로 확정됩니다.
              카드로 결제되는 고정지출은 다음 단계 카드대금에 들어갑니다.
            </p>

            {transferGroups.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-center text-xs text-slate-400">
                계좌에서 이체할 고정지출이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {transferGroups.map(group => (
                  <div key={group.key} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-800/70 pb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{group.label}</span>
                        </div>
                        {group.accountNumber && (
                          <button
                            type="button"
                            onClick={() => onCopyText(group.accountNumber, '계좌번호를 복사했습니다.')}
                            className="mt-1 flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-200"
                          >
                            <Copy className="h-3 w-3" />
                            <span className="truncate">
                              {group.accountNumber}
                              {group.accountHolder && ` · ${group.accountHolder}`}
                            </span>
                          </button>
                        )}
                      </div>
                      <span className="shrink-0 text-xs font-bold text-amber-300">
                        {formatKRW(group.pendingAmount)}
                      </span>
                    </div>

                    <ul className="mt-2 space-y-1.5">
                      {group.items.map(occurrence => {
                        const template = templateMap.get(occurrence.templateId);
                        const posted = occurrence.status === 'posted';
                        const amount = Math.round(occurrence.actualAmount ?? occurrence.expectedAmount);
                        return (
                          <li key={occurrence.id}>
                            <button
                              type="button"
                              disabled={posted}
                              onClick={() => void handleConfirmTransfer(occurrence)}
                              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                                posted
                                  ? 'cursor-default border-emerald-500/30 bg-emerald-500/5'
                                  : 'border-slate-800 bg-slate-900 hover:bg-slate-800'
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  aria-hidden
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    posted
                                      ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                                      : 'border-slate-600'
                                  }`}
                                >
                                  {posted && <Check className="h-3 w-3" />}
                                </span>
                                <span className={`truncate font-semibold ${posted ? 'text-emerald-300 line-through' : 'text-slate-200'}`}>
                                  {template?.name || '고정지출'}
                                </span>
                              </span>
                              <span className={`shrink-0 font-bold ${posted ? 'text-emerald-300' : 'text-slate-100'}`}>
                                {formatKRW(amount)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs">
              <span className="text-slate-400">남은 이체</span>
              <span className="font-bold text-amber-300">
                {formatKRW(summary.scheduledAccountFixedOutflow)} · {pendingTransfers.length}건
              </span>
            </div>

            {/* The checklist is shorter than the settings list on purpose. Saying
                which items were left out, and why, is what makes that checkable. */}
            {(cardPaidOccurrences.length > 0 || replacedCardSettlementCount > 0) && (
              <details className="rounded-xl border border-slate-800 bg-slate-950/40">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-300 marker:content-['']">
                  이 목록에 없는 고정지출 {cardPaidOccurrences.length + replacedCardSettlementCount}건
                </summary>
                <div className="space-y-2 border-t border-slate-800 px-3 py-2 text-xs">
                  {cardPaidOccurrences.length > 0 && (
                    <div>
                      <p className="text-slate-400">카드로 결제되어 다음 단계 카드대금에 포함됩니다.</p>
                      <ul className="mt-1 space-y-0.5">
                        {cardPaidOccurrences.map(occurrence => (
                          <li key={occurrence.id} className="flex items-center justify-between gap-3 text-slate-300">
                            <span className="truncate">
                              {templateMap.get(occurrence.templateId)?.name || '고정지출'}
                            </span>
                            <span className="shrink-0 font-semibold text-slate-200">
                              {formatKRW(Math.round(occurrence.actualAmount ?? occurrence.expectedAmount))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {replacedCardSettlementCount > 0 && (
                    <p className="text-slate-400">
                      직접 등록한 카드대금 항목 {replacedCardSettlementCount}건은 자동 계산된 카드대금으로 대체되어
                      이중으로 잡히지 않습니다.
                    </p>
                  )}
                </div>
              </details>
            )}
          </section>
        )}

        {/* Step 3 — the card bill */}
        {step === 2 && (
          <section className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-400">
              결제일이 이번 주기 안에 있는 카드대금입니다. 고지서 금액이 다르면 실제 금액으로 고쳐 주세요.
            </p>

            {cardSettlementSummary.cards.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-center text-xs text-slate-400">
                등록된 신용카드가 없습니다.
              </div>
            ) : (
              <ul className="space-y-2">
                {cardSettlementSummary.cards.map(card => {
                  const linkedAccount = accountMap.get(card.linkedAccountId || '');
                  const draft = cardAmountDrafts[card.cardId] ?? card.amount;
                  return (
                    <li key={card.cardId} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                            <CreditCard className="h-4 w-4 shrink-0 text-indigo-300" />
                            <span className="truncate">{card.cardName}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {card.paymentDate ? `${card.paymentDate} 출금` : '결제일 미지정'}
                            {linkedAccount ? ` · ${linkedAccount.accountName}` : ' · 결제계좌 미지정'}
                          </p>
                          <p className="mt-0.5 text-xs text-indigo-200/80">
                            {card.hasStatementWindow
                              ? `${card.usageStartDate} ~ ${card.usageEndDate} 사용분`
                              : `${card.usageYearMonth} 사용분 (이용기간 미설정, 추정)`}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                          card.source === 'confirmed'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-slate-700 bg-slate-800 text-slate-300'
                        }`}>
                          {card.source === 'confirmed' ? '입력한 금액' : '추정'}
                        </span>
                      </div>

                      <div className="mt-2 space-y-2">
                        <AmountInput
                          value={draft}
                          onChange={amount => setCardAmountDrafts(drafts => ({ ...drafts, [card.cardId]: amount }))}
                          className="text-base text-indigo-200"
                        />
                        {draft !== card.amount && (
                          <button
                            type="button"
                            onClick={() => onSaveCardSettlementAmount(card.cardId, draft)}
                            className="min-h-10 w-full rounded-lg border border-indigo-500/40 bg-indigo-500/15 text-xs font-extrabold text-indigo-200 transition-colors hover:bg-indigo-500/25"
                          >
                            이 금액으로 저장
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center justify-between rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs">
              <span className="text-slate-400">이번 주기 카드대금 합계</span>
              <span className="font-bold text-indigo-200">{formatKRW(summary.cardSettlementOutflow)}</span>
            </div>
          </section>
        )}

        {/* Step 4 — commit */}
        {step === 3 && (
          <section className="space-y-3">
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-center">
              <p className="text-xs font-semibold text-emerald-300">이번 주기에 쓸 수 있는 돈</p>
              <p className="mt-1 text-3xl font-extrabold tracking-tight text-white">
                {formatKRW(previewLivingBudget)}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                하루 {formatKRW(previewDaily)} · {period.daysInMonth}일
              </p>
            </div>

            <dl className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">
                  {summary.isProjected ? '급여 (입금 예정)' : '급여 입금'}
                </dt>
                <dd className="font-bold text-emerald-400">{formatKRW(summary.planningIncome)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">− 계좌 고정 이체</dt>
                <dd className="font-semibold text-slate-200">{formatKRW(summary.accountFixedOutflow)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">− 카드대금</dt>
                <dd className="font-semibold text-indigo-300">{formatKRW(summary.cardSettlementOutflow)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">− 저축</dt>
                <dd className="font-semibold text-emerald-300">{formatKRW(savingsReserve)}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-slate-800 pt-1.5">
                <dt className="font-semibold text-slate-200">= 생활비</dt>
                <dd className="font-extrabold text-white">{formatKRW(previewLivingBudget)}</dd>
              </div>
            </dl>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300" htmlFor="payday-savings">
                <PiggyBank className="h-3.5 w-3.5 text-emerald-400" />
                저축으로 먼저 뺄 금액
              </label>
              <p className="mt-0.5 mb-2 text-xs text-slate-400">
                생활비에서 미리 떼어 둡니다. 비워 두면 전액을 생활비로 씁니다.
              </p>
              <AmountInput
                id="payday-savings"
                value={savingsReserve}
                onChange={setSavingsReserve}
                showQuickAdd
                className="text-base text-emerald-300"
              />
            </div>

            {(pendingIncome.length > 0 || pendingTransfers.length > 0) && (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-200">
                미확정 항목 {pendingIncome.length + pendingTransfers.length}건이 남아 있습니다.
                예정 금액으로 계획을 세우고, 나중에 확정해도 이 생활비는 바뀌지 않습니다.
              </p>
            )}

            <p className="text-xs leading-relaxed text-slate-400">
              확정하면 이 금액이 이번 주기의 기준이 됩니다. 이후 고정비나 카드대금이 바뀌어도
              먼저 알려 드릴 뿐, 남은 생활비가 저절로 움직이지 않습니다.
            </p>
          </section>
        )}

        <footer className="flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => setStep(current => Math.max(0, current - 1))}
            disabled={step === 0}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            이전
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(current => Math.min(STEPS.length - 1, current + 1))}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-slate-100 px-4 text-xs font-extrabold text-slate-950 transition-colors hover:bg-white"
            >
              다음
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleFinish()}
              disabled={isSaving}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-500 px-4 text-xs font-extrabold text-slate-950 transition-colors hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60"
            >
              <Wallet className="h-4 w-4" />
              {isSaving ? '저장 중...' : '이대로 시작하기'}
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
};
