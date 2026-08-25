import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, MessageCircle, Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import {
  BankAccount,
  Budget,
  Category,
  PaymentCard,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
} from '../types';
import { authenticatedFetch } from '../utils/auth';
import { createFinanceChatContext } from '../utils/financeChat';

type FinanceChatProvider = 'openai' | 'gemini';
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modelUsed?: string;
};

interface FinanceChatPanelProps {
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  transactions: Transaction[];
  budget: Budget;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  monthStartDay?: number;
}

const CHAT_TIMEOUT_MS = 60_000;
const suggestedQuestions = [
  '이번 달 지출에서 가장 많이 늘어난 부분은?',
  '오늘부터 하루에 얼마까지 써도 안전해?',
  '최근 카페 지출 합계와 줄일 방법을 알려줘',
];

const messageId = (role: ChatMessage['role']) => `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const FinanceChatPanel: React.FC<FinanceChatPanelProps> = ({
  categories,
  bankAccounts,
  paymentCards,
  transactions,
  budget,
  recurringOccurrences,
  recurringTemplates,
  monthStartDay,
}) => {
  const [provider, setProvider] = useState<FinanceChatProvider>('openai');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const context = useMemo(() => createFinanceChatContext({
    transactions,
    categories,
    bankAccounts,
    paymentCards,
    budget,
    recurringOccurrences,
    recurringTemplates,
    monthStartDay,
  }), [transactions, categories, bankAccounts, paymentCards, budget, recurringOccurrences, recurringTemplates, monthStartDay]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  const sendMessage = async (text = input) => {
    const question = text.trim().slice(0, 1_000);
    if (!question || isSending) return;

    const previousMessages = messages.slice(-8);
    setMessages(current => [...current, { id: messageId('user'), role: 'user' as const, text: question }].slice(-12));
    setInput('');
    setError(null);
    setIsSending(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    try {
      const response = await authenticatedFetch('/api/ai/finance-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          provider,
          message: question,
          history: previousMessages.map(({ role, text: historyText }) => ({ role, text: historyText })),
          context,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || '재무 채팅 응답을 받지 못했습니다.');
      const answer = String(data.answer || '').trim();
      if (!answer) throw new Error('모델이 빈 답변을 반환했습니다. 다시 질문해 주세요.');
      setMessages(current => [...current, {
        id: messageId('assistant'),
        role: 'assistant' as const,
        text: answer,
        modelUsed: String(data.modelUsed || ''),
      }].slice(-12));
    } catch (nextError) {
      setError(
        nextError instanceof DOMException && nextError.name === 'AbortError'
          ? '응답이 60초 안에 도착하지 않았습니다. 잠시 후 다시 시도해 주세요.'
          : nextError instanceof Error
            ? nextError.message
            : '재무 채팅 중 오류가 발생했습니다.',
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsSending(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="재무 채팅">
      <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/15 via-slate-950 to-cyan-500/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/40">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-white">내 지출에 물어보기</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">기록된 거래와 예산을 근거로 답합니다.</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button type="button" onClick={() => { setMessages([]); setError(null); }} className="rounded-xl p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="채팅 내용 지우기">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-950/80 p-1" aria-label="채팅 모델 선택">
          <button
            type="button"
            onClick={() => setProvider('openai')}
            className={`rounded-lg px-3 py-2 text-left transition-colors ${provider === 'openai' ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/35' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <span className="block text-xs font-extrabold">GPT 경제형</span>
            <span className="mt-0.5 block text-[10px] opacity-75">5.6 Luna · 빠른 질문</span>
          </button>
          <button
            type="button"
            onClick={() => setProvider('gemini')}
            className={`rounded-lg px-3 py-2 text-left transition-colors ${provider === 'gemini' ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/35' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <span className="block text-xs font-extrabold">Gemini 정밀형</span>
            <span className="mt-0.5 block text-[10px] opacity-75">3.7 Flash · 복합 분석</span>
          </button>
        </div>
      </div>

      <div className="max-h-[45vh] min-h-56 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/80 p-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs leading-relaxed text-slate-300">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
              <p>이번 달 지출, 카테고리 변화, 남은 생활비처럼 내 기록으로 확인할 수 있는 내용을 질문해 보세요.</p>
            </div>
            <div className="space-y-2">
              {suggestedQuestions.map(question => (
                <button key={question} type="button" onClick={() => { void sendMessage(question); }} className="flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-left text-xs text-slate-300 hover:border-indigo-500/40 hover:text-indigo-200">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${message.role === 'user' ? 'rounded-br-md bg-indigo-500 text-white' : 'rounded-bl-md border border-slate-800 bg-slate-900 text-slate-200'}`}>
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
              {message.modelUsed && <p className="mt-1.5 text-[9px] text-slate-500">{message.modelUsed}</p>}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-800 bg-slate-900 px-3.5 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-300" />
              내 지출 기록을 분석하는 중...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div>}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={event => setInput(event.target.value.slice(0, 1_000))}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          rows={2}
          placeholder="예: 지난달보다 식비가 왜 늘었어?"
          className="min-h-12 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-indigo-500"
          aria-label="재무 질문"
        />
        <button type="button" disabled={!input.trim() || isSending} onClick={() => { void sendMessage(); }} className="flex w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40" aria-label="질문 보내기">
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] leading-relaxed text-emerald-100/75">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>계좌·카드 번호, PIN, 영수증 원문, 음성 원본은 보내지 않습니다. 정제된 거래와 계산 요약만 선택한 AI로 전송되며 대화는 저장되지 않습니다.</p>
      </div>
    </section>
  );
};
