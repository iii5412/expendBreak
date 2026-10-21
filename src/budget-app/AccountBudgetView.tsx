import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BudgetAnalytics } from './BudgetAnalytics';
import { DataControls } from './DataControls';
import { BudgetApp, type BudgetPeriodNav } from './BudgetApp';
import { BudgetSmsPanel, scrollToSmsReview, type BudgetSmsBridge } from './BudgetSmsPanel';
import type { TransactionEdit } from './history';
import {
  autoPostingCandidates,
  needsLimitSetup,
  shouldOnboard,
  toBudgetInput,
  type BudgetAccountData,
} from './adapter';
import { suggestQuickEntryCandidates } from '../utils/quickEntrySuggestions';
import { accountCatalog } from './catalog';
import { AgentPanel } from '../components/AgentPanel';
import type { AgentActionDeps } from '../agent/approve';
import { QuickEntryManager, type NewQuickEntry } from './QuickEntryManager';
import type { QuickEntry } from '../types';
import { RecurringManager, type RecurringActions } from './RecurringManager';
import { SetupDialog, type BudgetSetup } from './SetupDialog';
import type { BudgetSettings, BudgetTransaction } from '../types/budget';
import { resolveRecurringAmount } from '../utils/recurringAmounts';
import { AiSettingsPanel } from './AiSettingsPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { buildFeedbackSummary, classifyBudgetText, requestFeedback, type BudgetAiRequest } from './aiClient';
import { getLocalDateString, getYearMonthForDate } from '../utils/calculations';

export interface BudgetAccountActions extends RecurringActions {
  exportCsv: () => Promise<string>;
  resetData: () => Promise<void>;
  saveAiSettings: (classification: boolean, insights: boolean) => Promise<void>;
  saveRule: (pattern: string, categoryId: string) => Promise<void>;
  saveTransaction: (transaction: BudgetTransaction) => Promise<void>;
  updateTransaction?: (id: string, edit: TransactionEdit) => Promise<void>;
  deleteTransaction?: (id: string) => Promise<void>;
  saveQuickEntry?: (entry: NewQuickEntry) => Promise<void>;
  updateQuickEntry?: (id: string, patch: Partial<QuickEntry>) => Promise<void>;
  deleteQuickEntry?: (id: string) => Promise<void>;
  saveSettings: (settings: BudgetSettings) => Promise<void>;
  completeSetup: (setup: BudgetSetup) => Promise<void>;
  skipSetup: () => Promise<void>;
}

export function AccountBudgetView({
  account,
  actions,
  isDemo,
  accountContent,
  aiRequest,
  selectedKey,
  periodNav,
  sms,
  entryRequested,
  onEntryRequestHandled,
  agent,
}: {
  account: BudgetAccountData;
  actions: BudgetAccountActions;
  isDemo: boolean;
  accountContent?: ReactNode;
  aiRequest?: BudgetAiRequest;
  /** Cycle being viewed; omitted means the one that contains today. */
  selectedKey?: string;
  periodNav?: BudgetPeriodNav;
  sms?: BudgetSmsBridge;
  entryRequested?: boolean;
  onEntryRequestHandled?: () => void;
  /** Wires the AI agent into the add dialog; omitted in the local preview. */
  agent?: { deps: AgentActionDeps; onEnable: () => Promise<boolean> };
}) {
  const [now, setNow] = useState(() => new Date());
  const [autoMessage, setAutoMessage] = useState('');
  const [setupOpen, setSetupOpen] = useState(() => shouldOnboard(account));
  const pendingIds = useRef(new Set<string>());
  const input = toBudgetInput(account, now, selectedKey);
  const suggestions = suggestQuickEntryCandidates(account.transactions, account.quickEntries || [], { limit: 5 });
  const catalog = accountCatalog(account.categories, {
    quickEntries: account.quickEntries,
    suggestions,
    useDefaults: account.transactions.length === 0,
  });
  const livingBudget =
    account.cycleBaseline && account.cycleBaseline.yearMonth === input.period.key
      ? account.cycleBaseline.livingBudget
      : null;
  const aiCategories = account.categories.filter((c) => c.active).map(({ id, name, type }) => ({ id, name, type }));
  const aiRules = (account.merchantRules || []).map(({ pattern, categoryId }) => ({ pattern, categoryId }));
  const feedbackSummary = buildFeedbackSummary(input, aiCategories);
  const nextPeriodStart = new Date(new Date(`${input.period.end}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const candidates = autoPostingCandidates(account, getLocalDateString(now));
  const candidateKey = JSON.stringify(candidates);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      for (const candidate of JSON.parse(candidateKey) as Array<{ id: string; amount: number }>) {
        if (disposed || pendingIds.current.has(candidate.id)) continue;
        pendingIds.current.add(candidate.id);
        try {
          await actions.post(candidate.id, candidate.amount);
          if (!disposed) setAutoMessage('예정된 정기 항목을 자동 반영했습니다.');
        } catch {
          if (!disposed) setAutoMessage('자동 반영하지 못한 항목이 있습니다. 관리에서 확인해 주세요.');
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [candidateKey, actions]);
  const incomplete = account.occurrences.filter(
    (o) =>
      o.status !== 'posted' &&
      o.status !== 'skipped' &&
      input.occurrences.some((item) => item.id === o.id && item.budgetPeriodKey === input.period.key) &&
      resolveRecurringAmount(o, account.transactions).status !== 'confirmed',
  ).length;
  const occurrences = account.occurrences.filter((o) =>
    input.occurrences.some((item) => item.id === o.id && item.budgetPeriodKey === input.period.key),
  );
  return (
    <BudgetApp
      data={input}
      {...catalog}
      isDemo={isDemo}
      onSaveTransaction={actions.saveTransaction}
      onSaveSettings={actions.saveSettings}
      onUpdateTransaction={isDemo ? undefined : actions.updateTransaction}
      onDeleteTransaction={isDemo ? undefined : actions.deleteTransaction}
      periodNav={periodNav}
      limitSetupNeeded={!isDemo && needsLimitSetup(account, input.period.key)}
      livingBudget={livingBudget}
      agentSlot={
        agent && !isDemo
          ? ({ onQuickAdd, onNavigate }) => (
              <div className="bb-agent bb-agent-light">
                {account.profile.aiClassificationEnabled ? (
                  <AgentPanel
                    compact
                    categories={account.categories}
                    bankAccounts={account.bankAccounts || []}
                    paymentCards={account.paymentCards || []}
                    transactions={account.transactions}
                    budget={account.budget}
                    recurringOccurrences={occurrences}
                    allRecurringOccurrences={account.occurrences}
                    recurringTemplates={account.templates}
                    monthStartDay={account.profile.monthStartDay}
                    actionDeps={agent.deps}
                    onNavigate={onNavigate}
                    onQuickAdd={onQuickAdd}
                  />
                ) : (
                  <div className="bb-agent-consent">
                    <p>AI 에이전트를 쓰려면 이 계정의 AI 기능 동의가 필요해요.</p>
                    <button type="button" onClick={() => void agent.onEnable()}>
                      AI 기능 사용하기
                    </button>
                  </div>
                )}
              </div>
            )
          : undefined
      }
      entryRequested={entryRequested}
      onEntryRequestHandled={onEntryRequestHandled}
      smsPendingCount={sms?.candidates.length || 0}
      onReviewSms={sms ? scrollToSmsReview : undefined}
      periodKeyForDate={(date) => getYearMonthForDate(date, input.settings.monthStartDay)}
      ai={{
        categories: aiCategories,
        saveRule: actions.saveRule,
        classify: (text, signal) =>
          classifyBudgetText(
            text,
            aiCategories,
            aiRules,
            input.today,
            account.profile.aiClassificationEnabled,
            aiRequest,
            signal,
          ),
      }}
      analysisContent={
        <>
          <BudgetAnalytics input={input} names={Object.fromEntries(account.categories.map((c) => [c.id, c.name]))} />
          <FeedbackPanel
            enabled={account.profile.aiInsightsEnabled}
            summary={feedbackSummary}
            request={(summary, signal) => requestFeedback(summary, aiRequest, signal)}
          />
        </>
      }
      accountContent={accountContent}
      banner={
        <>
          {sms && (
            <BudgetSmsPanel
              sms={sms}
              categories={account.categories}
              paymentCards={account.paymentCards || []}
              bankAccounts={account.bankAccounts || []}
            />
          )}
          {isDemo && <p className="bb-notice">로컬 체험 모드입니다. 실제 계정과 분리해 이 브라우저에만 저장합니다.</p>}
          {incomplete > 0 && (
            <p className="bb-notice">
              예정 금액 {incomplete}건이 아직 확정되지 않았습니다. 표시된 잔액과 예측은 참고값이며, 관리에서 금액을
              확인해 주세요.
            </p>
          )}
          {autoMessage && (
            <p className="bb-notice" role="status">
              {autoMessage}
            </p>
          )}
        </>
      }
      managementContent={
        <>
          <DataControls exportCsv={actions.exportCsv} resetData={actions.resetData} isDemo={isDemo} />
          <AiSettingsPanel
            classification={account.profile.aiClassificationEnabled}
            insights={account.profile.aiInsightsEnabled}
            onSave={actions.saveAiSettings}
          />
          {!isDemo && actions.saveQuickEntry && actions.updateQuickEntry && actions.deleteQuickEntry && (
            <QuickEntryManager
              entries={account.quickEntries || []}
              categories={catalog.categories}
              paymentCards={account.paymentCards || []}
              suggestions={suggestions}
              onSave={actions.saveQuickEntry}
              onUpdate={actions.updateQuickEntry}
              onDelete={actions.deleteQuickEntry}
            />
          )}
          <RecurringManager
            templates={account.templates}
            occurrences={occurrences}
            categories={account.categories}
            today={input.today}
            nextPeriodStart={nextPeriodStart}
            actions={actions}
          />
        </>
      }
    >
      {setupOpen && (
        <SetupDialog
          onComplete={async (setup) => {
            await actions.completeSetup(setup);
            setSetupOpen(false);
          }}
          onSkip={async () => {
            await actions.skipSetup();
            setSetupOpen(false);
          }}
        />
      )}
    </BudgetApp>
  );
}
