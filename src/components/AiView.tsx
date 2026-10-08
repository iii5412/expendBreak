import React, { useState } from 'react';
import { Bot, Mic, Sparkles } from 'lucide-react';
import type {
  BankAccount, Budget, Category, MerchantRule, PaymentCard, RecurringOccurrence,
  RecurringTemplate, Transaction, VoiceAnalysisResult,
} from '../types';
import { AgentPanel } from './AgentPanel';
import type { AgentActionDeps } from '../agent/approve';
import type { AgentScreen } from '../agent/tools';
import { LiveVoicePanel } from './LiveVoicePanel';
import { ScreenHeader } from './ui/ScreenHeader';

interface AiViewProps {
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  transactions: Transaction[];
  budget: Budget;
  recurringOccurrences: RecurringOccurrence[];
  allRecurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  monthStartDay: number;
  aiEnabled: boolean;
  onEnableAI: () => Promise<boolean>;
  getCurrentTransactions: () => Transaction[];
  onSaveStatementTransaction: (draft: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  onUpdateStatementTransaction: (id: string, expectedUpdatedAt: string, updates: Partial<Transaction>) => Transaction | null;
  onLiveDraftReady: (result: VoiceAnalysisResult, durationMs: number, mimeType: string) => void;
  agentActionDeps: AgentActionDeps;
  onNavigate: (screen: AgentScreen) => void;
  onQuickAdd: (text: string) => void;
}

export const AiView: React.FC<AiViewProps> = ({
  categories, merchantRules, bankAccounts, paymentCards, transactions, budget,
  recurringOccurrences, allRecurringOccurrences, recurringTemplates, monthStartDay, aiEnabled, onEnableAI,
  getCurrentTransactions, onSaveStatementTransaction, onUpdateStatementTransaction,
  onLiveDraftReady, agentActionDeps, onNavigate, onQuickAdd,
}) => {
  const [mode, setMode] = useState<'agent' | 'live'>('agent');

  return <div className="space-y-4 pb-24">
    <ScreenHeader
      eyebrow="AI"
      title="AI"
      description="Agent에게 가계부를 묻거나 GPT Live와 말로 대화하세요. AI가 만든 거래는 확인한 뒤에 등록됩니다."
      icon={<Sparkles className="h-4 w-4" />}
    />
    {!aiEnabled ? (
      <section className="eb-panel space-y-3 rounded-xl p-4">
        <p className="text-sm text-slate-300">AI 기능을 사용하려면 이 계정의 동의가 필요합니다.</p>
        <button type="button" onClick={() => { void onEnableAI(); }} className="min-h-11 rounded-lg bg-rose-500 px-4 text-sm font-bold text-white">AI 기능 사용하기</button>
      </section>
    ) : <>
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900 p-1" role="tablist" aria-label="AI 기능 선택">
        <button type="button" role="tab" aria-selected={mode === 'agent'} onClick={() => setMode('agent')}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-bold ${mode === 'agent' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}>
          <Bot className="h-4 w-4" /> Agent
        </button>
        <button type="button" role="tab" aria-selected={mode === 'live'} onClick={() => setMode('live')}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-bold ${mode === 'live' ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-white'}`}>
          <Mic className="h-4 w-4" /> GPT Live
        </button>
      </div>
      <div role="tabpanel" hidden={mode !== 'agent'}>
        <AgentPanel
          categories={categories}
          bankAccounts={bankAccounts}
          paymentCards={paymentCards}
          transactions={transactions}
          budget={budget}
          recurringOccurrences={recurringOccurrences}
          allRecurringOccurrences={allRecurringOccurrences}
          recurringTemplates={recurringTemplates}
          monthStartDay={monthStartDay}
          actionDeps={agentActionDeps}
          onNavigate={onNavigate}
          onQuickAdd={onQuickAdd}
          getCurrentTransactions={getCurrentTransactions}
          onSaveStatementTransaction={onSaveStatementTransaction}
          onUpdateStatementTransaction={onUpdateStatementTransaction}
        />
      </div>
      {mode === 'live' && <div role="tabpanel">
        <LiveVoicePanel
          categories={categories}
          merchantRules={merchantRules}
          bankAccounts={bankAccounts}
          paymentCards={paymentCards}
          transactions={transactions}
          budget={budget}
          recurringOccurrences={recurringOccurrences}
          recurringTemplates={recurringTemplates}
          monthStartDay={monthStartDay}
          onDraftReady={(result, durationMs, mimeType) => {
            setMode('agent');
            onLiveDraftReady(result, durationMs, mimeType);
          }}
        />
      </div>}
    </>}
  </div>;
};
