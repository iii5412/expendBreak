import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bot, Check, Loader2, Search, Send, ShieldCheck, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type {
  BankAccount, Budget, Category, PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction,
} from '../types';
import type { AgentDataContext, AgentProposal } from '../agent/executor';
import { applyAgentAction, type AgentActionDeps, type AgentActionResult } from '../agent/approve';
import {
  agentSession, clearAgentSession, recordProposalOutcome, sendAgentMessage, updateProposalEntry,
  type AgentEntry, type ProposalStatus,
} from '../agent/session';
import type { AgentScreen } from '../agent/tools';
import { FinanceChatAnswer } from './FinanceChatAnswer';
import { CardStatementReconcilePanel } from './CardStatementReconcilePanel';

interface AgentPanelProps {
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  transactions: Transaction[];
  budget: Budget;
  recurringOccurrences: RecurringOccurrence[];
  allRecurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  monthStartDay: number;
  actionDeps: AgentActionDeps;
  onNavigate: (screen: AgentScreen) => void;
  getCurrentTransactions: () => Transaction[];
  onSaveStatementTransaction: (draft: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  onUpdateStatementTransaction: (id: string, expectedUpdatedAt: string, updates: Partial<Transaction>) => Transaction | null;
}

const SUGGESTIONS = [
  '이번 달 식비 얼마나 썼어?',
  '어제 스타벅스 5,800원 카드로 추가해줘',
  '이번 달 남은 고정지출 알려줘',
];

// Undo handlers stay with the proposal cards across remounts of this screen.
const undoByProposal = new Map<string, NonNullable<AgentActionResult['undo']>>();

const STATUS_TEXT: Record<Exclude<ProposalStatus, 'pending'>, string> = {
  running: '실행 중...',
  approved: '실행했습니다',
  rejected: '거절했습니다',
  failed: '실행하지 못했습니다',
  undone: '되돌렸습니다',
};

export const AgentPanel: React.FC<AgentPanelProps> = props => {
  const session = useSyncExternalStore(agentSession.subscribe, agentSession.get);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  // Tools read the newest data even when a turn started before a refresh.
  const contextRef = useRef<AgentDataContext | null>(null);
  contextRef.current = {
    transactions: props.transactions,
    categories: props.categories,
    bankAccounts: props.bankAccounts,
    paymentCards: props.paymentCards,
    budget: props.budget,
    recurringOccurrences: props.recurringOccurrences,
    allRecurringOccurrences: props.allRecurringOccurrences,
    recurringTemplates: props.recurringTemplates,
    monthStartDay: props.monthStartDay,
  };
  const navigateRef = useRef(props.onNavigate);
  navigateRef.current = props.onNavigate;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session.entries.length, session.busy]);

  const send = (text = input) => {
    if (!text.trim() || session.busy) return;
    setInput('');
    void sendAgentMessage(text, {
      getContext: () => contextRef.current!,
      navigate: screen => navigateRef.current(screen),
    });
  };

  const approve = async (proposal: AgentProposal) => {
    updateProposalEntry(proposal.id, 'running');
    let result: AgentActionResult;
    try {
      result = await applyAgentAction(proposal.action, props.actionDeps);
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : '실행 중 오류가 발생했습니다.' };
    }
    if (result.ok) {
      if (result.undo) undoByProposal.set(proposal.id, result.undo);
      updateProposalEntry(proposal.id, 'approved', result.message);
      recordProposalOutcome(proposal, '사용자가 승인했고 실행되었습니다.');
    } else {
      updateProposalEntry(proposal.id, 'failed', result.message);
      recordProposalOutcome(proposal, `실행하지 못했습니다. 이유: ${result.message}`);
    }
  };

  const reject = (proposal: AgentProposal) => {
    updateProposalEntry(proposal.id, 'rejected');
    recordProposalOutcome(proposal, '사용자가 거절했습니다. 실행하지 않았습니다.');
  };

  const undo = async (proposal: AgentProposal) => {
    const handler = undoByProposal.get(proposal.id);
    if (!handler) return;
    let result: AgentActionResult;
    try {
      result = await handler();
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : '되돌리는 중 오류가 발생했습니다.' };
    }
    if (result.ok) {
      undoByProposal.delete(proposal.id);
      updateProposalEntry(proposal.id, 'undone', result.message);
      recordProposalOutcome(proposal, '사용자가 실행을 되돌렸습니다. 지금은 반영되지 않은 상태입니다.');
    } else {
      updateProposalEntry(proposal.id, 'approved', result.message);
    }
  };

  const renderEntry = (entry: AgentEntry) => {
    if (entry.kind === 'user') {
      return (
        <div key={entry.id} className="flex justify-end">
          <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-500 px-3.5 py-2.5 text-xs leading-relaxed text-white">{entry.text}</p>
        </div>
      );
    }
    if (entry.kind === 'assistant') {
      return (
        <div key={entry.id} className="flex justify-start">
          <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-slate-800 bg-slate-900 px-3.5 py-2.5 text-xs leading-relaxed text-slate-200">
            <FinanceChatAnswer text={entry.text} />
          </div>
        </div>
      );
    }
    if (entry.kind === 'activity') {
      return (
        <p key={entry.id} className="flex items-center gap-1.5 pl-1 text-[11px] text-slate-500">
          <Search className="h-3 w-3" aria-hidden="true" /> {entry.text}
        </p>
      );
    }
    const { proposal, status, message } = entry;
    const tone = status === 'approved' ? 'border-emerald-500/40' : status === 'failed' ? 'border-rose-500/40' : status === 'pending' ? 'border-amber-400/50' : 'border-slate-700';
    return (
      <section key={entry.id} className={`rounded-2xl border ${tone} bg-slate-950 p-3.5 text-xs`} aria-label={`확인 필요: ${proposal.title}`}>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">{status === 'pending' ? '승인이 필요합니다' : '제안'}</p>
        <h4 className="mt-1 text-sm font-extrabold text-white">{proposal.title}</h4>
        <dl className="mt-2.5 space-y-1.5">
          {proposal.details.map(detail => (
            <div key={detail.label} className="flex justify-between gap-3">
              <dt className="shrink-0 text-slate-500">{detail.label}</dt>
              <dd className="text-right font-semibold text-slate-200">{detail.value}</dd>
            </div>
          ))}
        </dl>
        {status === 'pending' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => reject(proposal)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-800 font-bold text-slate-300 hover:bg-slate-700">
              <X className="h-4 w-4" /> 거절
            </button>
            <button type="button" onClick={() => { void approve(proposal); }} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 font-extrabold text-slate-950 hover:bg-emerald-400">
              <Check className="h-4 w-4" /> 승인
            </button>
          </div>
        )}
        {status !== 'pending' && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800 pt-2.5">
            <p role="status" className={status === 'failed' ? 'text-rose-300' : status === 'approved' ? 'text-emerald-300' : 'text-slate-400'}>
              {status === 'running' && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
              {message || STATUS_TEXT[status]}
            </p>
            {status === 'approved' && undoByProposal.has(proposal.id) && (
              <button type="button" onClick={() => { void undo(proposal); }} className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 font-bold text-slate-300 hover:bg-slate-800">
                <Undo2 className="h-3.5 w-3.5" /> 되돌리기
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <section className="space-y-3" aria-label="Agent">
      <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/15 via-slate-950 to-cyan-500/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/40">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-white">Agent</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">기록을 찾고 계산하고, 승인하면 대신 처리합니다.</p>
            </div>
          </div>
          {session.entries.length > 0 && (
            <button type="button" onClick={clearAgentSession} disabled={session.busy} className="rounded-xl p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40" aria-label="대화 지우기">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[55vh] min-h-56 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/80 p-3" aria-live="polite">
        {session.entries.length === 0 && (
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs leading-relaxed text-slate-300">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
              <p>지출을 묻거나, 거래 추가·수정·삭제, 고정지출 금액 확정·완료·제외를 맡겨 보세요. 기록을 바꾸는 일은 확인 카드에서 승인해야 실행됩니다.</p>
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map(suggestion => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)} className="flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-left text-xs text-slate-300 hover:border-indigo-500/40 hover:text-indigo-200">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {session.entries.map(renderEntry)}
        {session.busy && (
          <div className="flex items-center gap-2 pl-1 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-300" /> 처리하는 중...
          </div>
        )}
        <div ref={endRef} />
      </div>

      {session.error && <div role="alert" className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-200">{session.error}</div>}

      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-2.5 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/30">
        <textarea
          value={input}
          onChange={event => setInput(event.target.value.slice(0, 4_000))}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          rows={3}
          maxLength={4_000}
          placeholder="예: 지난주 배달 지출 찾아서 합계 알려주고, 어제 쿠팡 거래는 생활용품으로 바꿔줘"
          className="max-h-60 w-full resize-y bg-transparent px-1 py-1.5 text-sm leading-6 text-white outline-none placeholder:text-slate-500"
          aria-label="Agent에게 요청"
        />
        <div className="mt-2 flex justify-end border-t border-slate-800 pt-2">
          <button type="button" disabled={!input.trim() || session.busy} onClick={() => send()} className="flex min-h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-xs font-bold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40" aria-label="요청 보내기">
            {session.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            보내기
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] leading-relaxed text-emerald-100/75">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>Agent가 요청한 조회 결과만 GPT로 보내며, 계좌·카드 번호와 PIN은 보내지 않습니다. 대화는 저장되지 않고 잠금 시 지워집니다.</p>
      </div>

      <CardStatementReconcilePanel
        categories={props.categories}
        paymentCards={props.paymentCards}
        transactions={props.transactions}
        getCurrentTransactions={props.getCurrentTransactions}
        onSave={props.onSaveStatementTransaction}
        onUpdate={props.onUpdateStatementTransaction}
      />
    </section>
  );
};
