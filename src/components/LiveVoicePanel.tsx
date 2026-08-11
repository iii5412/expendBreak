import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  BankAccount,
  Budget,
  Category,
  MerchantRule,
  PaymentCard,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
  VoiceAnalysisResult,
} from '../types';
import { authenticatedFetch } from '../utils/auth';
import { getLocalDateString } from '../utils/calculations';
import {
  createAssistantFinancialSnapshot,
  createLiveVoiceResult,
  LiveTransactionSearchArguments,
  LiveTransactionToolArguments,
  searchTransactionsForAssistant,
} from '../utils/liveVoice';

type LiveStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';
type TranscriptMessage = { id: string; role: 'user' | 'assistant'; text: string };

interface LiveVoicePanelProps {
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  transactions: Transaction[];
  budget: Budget;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  onDraftReady: (result: VoiceAnalysisResult, durationMs: number, mimeType: string) => void;
  onUseQuickVoice: () => void;
}

const REALTIME_MODEL = 'gpt-realtime-2.1-mini';
const LIVE_ASSISTANT_PROMPT = `
당신은 1인 사용자를 위한 한국어 수입·지출 비서다.
돈에 관해 말하면 정확히 이해하고 거래 초안을 만들며, 개인 재무 질문에는 도구로 조회한 계산 결과만 근거로 답한다.
금액이 불명확하면 추측하지 말고 한 번에 한 가지만 되묻는다.
거래 저장, 잔액 변경, 고정지출 등록을 완료했다고 절대 말하지 않는다.
prepare_transaction은 화면 검토용 초안이며, 초안을 만든 뒤 화면에서 확인하고 등록해 달라고 안내한다.
계좌번호, 카드번호, PIN, 인증정보를 요청하거나 반복해서 말하지 않는다.
개인 재무 수치에 답하기 전에는 get_financial_summary 또는 search_transactions를 먼저 호출한다.
한 번에 여러 거래가 포함되면 각각 따로 말해 달라고 요청한다.
기본 언어는 자연스러운 한국어이며 답변은 보통 두세 문장 이내로 짧게 한다.
`.trim();

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const LiveVoicePanel: React.FC<LiveVoicePanelProps> = ({
  categories,
  merchantRules,
  bankAccounts,
  paymentCards,
  transactions,
  budget,
  recurringOccurrences,
  recurringTemplates,
  onDraftReady,
  onUseQuickVoice,
}) => {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionStartedAtRef = useRef(0);
  const activeAssistantMessageRef = useRef<string | null>(null);
  const latestUserTranscriptRef = useRef('');
  const handledToolCallsRef = useRef(new Set<string>());

  const cleanupResources = () => {
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    activeAssistantMessageRef.current = null;
  };

  useEffect(() => () => cleanupResources(), []);

  const sendEvent = (event: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (channel?.readyState === 'open') channel.send(JSON.stringify(event));
  };

  const appendAssistantDelta = (delta: string) => {
    if (!delta) return;
    let messageId = activeAssistantMessageRef.current;
    if (!messageId) {
      messageId = uniqueId('assistant');
      activeAssistantMessageRef.current = messageId;
      setMessages(previous => [...previous, { id: messageId!, role: 'assistant', text: delta }].slice(-8));
      return;
    }
    setMessages(previous => previous.map(message => (
      message.id === messageId ? { ...message, text: `${message.text}${delta}` } : message
    )));
  };

  const finishAssistantMessage = (transcript?: string) => {
    const activeId = activeAssistantMessageRef.current;
    if (transcript && activeId) {
      setMessages(previous => previous.map(message => (
        message.id === activeId ? { ...message, text: transcript } : message
      )));
    } else if (transcript && !activeId) {
      setMessages(previous => [...previous, {
        id: uniqueId('assistant'),
        role: 'assistant',
        text: transcript,
      }].slice(-8));
    }
    activeAssistantMessageRef.current = null;
    setStatus('listening');
  };

  const sendToolOutput = (callId: string, output: unknown) => {
    sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    sendEvent({ type: 'response.create' });
  };

  const handleToolCall = (name: string, callId: string, argumentText: string) => {
    if (!callId || handledToolCallsRef.current.has(callId)) return;
    handledToolCallsRef.current.add(callId);

    let parsed: Record<string, unknown> = {};
    try {
      parsed = argumentText ? JSON.parse(argumentText) : {};
    } catch {
      sendToolOutput(callId, { error: '도구 인수를 해석하지 못했습니다. 사용자에게 다시 확인해 주세요.' });
      return;
    }

    if (name === 'get_financial_summary') {
      sendToolOutput(callId, createAssistantFinancialSnapshot({
        transactions,
        categories,
        bankAccounts,
        budget,
        recurringOccurrences,
        recurringTemplates,
      }));
      return;
    }

    if (name === 'search_transactions') {
      sendToolOutput(
        callId,
        searchTransactionsForAssistant(
          transactions,
          categories,
          parsed as LiveTransactionSearchArguments,
        ),
      );
      return;
    }

    if (name === 'prepare_transaction') {
      const args = parsed as LiveTransactionToolArguments;
      if (!args.spoken_summary && latestUserTranscriptRef.current) {
        args.spoken_summary = latestUserTranscriptRef.current;
      }
      const result = createLiveVoiceResult(args, {
        categories,
        merchantRules,
        bankAccounts,
        paymentCards,
        defaultDate: getLocalDateString(),
        modelUsed: REALTIME_MODEL,
      });

      if (result.amount <= 0 || !result.suggestedCategoryId) {
        sendToolOutput(callId, {
          status: 'needs_clarification',
          message: result.amount <= 0
            ? '금액이 확인되지 않았습니다. 정확한 금액을 물어보세요.'
            : '수입·지출 유형에 맞는 카테고리를 확인해 주세요.',
        });
        return;
      }

      sendToolOutput(callId, {
        status: 'draft_ready',
        message: '화면에 거래 초안을 열었습니다. 사용자가 확인 버튼을 눌러야 저장됩니다.',
      });
      const durationMs = Math.max(300, Date.now() - sessionStartedAtRef.current);
      window.setTimeout(() => onDraftReady(result, durationMs, 'audio/webrtc'), 250);
      return;
    }

    sendToolOutput(callId, { error: '지원하지 않는 도구입니다.' });
  };

  const inspectFunctionCalls = (items: unknown) => {
    if (!Array.isArray(items)) return;
    items.forEach((item: any) => {
      if (item?.type === 'function_call' && item?.name && item?.call_id) {
        handleToolCall(item.name, item.call_id, item.arguments || '{}');
      }
    });
  };

  const handleServerEvent = (event: any) => {
    switch (event?.type) {
      case 'input_audio_buffer.speech_started':
        setStatus('listening');
        break;
      case 'response.created':
        setStatus('speaking');
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = String(event.transcript || '').trim();
        if (transcript) {
          latestUserTranscriptRef.current = transcript;
          setMessages(previous => [...previous, {
            id: uniqueId('user'),
            role: 'user',
            text: transcript,
          }].slice(-8));
        }
        break;
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        appendAssistantDelta(String(event.delta || ''));
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        finishAssistantMessage(String(event.transcript || ''));
        break;
      case 'response.function_call_arguments.done':
        handleToolCall(event.name, event.call_id, event.arguments || '{}');
        break;
      case 'conversation.item.done':
        inspectFunctionCalls([event.item]);
        break;
      case 'response.done':
        inspectFunctionCalls(event.response?.output);
        if (!event.response?.output?.some((item: any) => item?.type === 'function_call')) {
          setStatus('listening');
        }
        break;
      case 'error':
        setErrorMessage(event.error?.message || 'GPT 라이브 대화 중 오류가 발생했습니다.');
        setStatus('error');
        break;
      default:
        break;
    }
  };

  const createSessionUpdate = () => {
    const categoryNames = categories
      .filter(category => category.active !== false)
      .map(category => `${category.type === 'income' ? '수입' : '지출'}:${category.name}`)
      .join(', ');
    const accountNames = bankAccounts.map(account => `${account.bankName} ${account.accountName}`).join(', ');
    const cardNames = paymentCards.map(card => `${card.cardCompany} ${card.cardName}`).join(', ');

    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: [
          LIVE_ASSISTANT_PROMPT,
          `오늘은 ${getLocalDateString()}이고 시간대는 Asia/Seoul이다.`,
          `사용 가능한 카테고리: ${categoryNames || '없음'}`,
          `계좌 별칭: ${accountNames || '없음'}`,
          `카드 별칭: ${cardNames || '없음'}`,
          '거래 기록 요청은 prepare_transaction을 호출한다. 절대 저장 완료라고 말하지 않는다.',
          '개인 재무 수치에 답하기 전에는 반드시 조회 도구를 호출한다.',
        ].join('\n'),
        output_modalities: ['audio'],
        audio: {
          input: {
            transcription: {
              model: 'gpt-4o-mini-transcribe',
              language: 'ko',
            },
            turn_detection: {
              type: 'server_vad',
              silence_duration_ms: 650,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: 'marin' },
        },
        tools: [
          {
            type: 'function',
            name: 'get_financial_summary',
            description: '현재 월 수입·지출·예산·예정 고정지출·수동 계좌잔액 요약을 정확한 계산 결과로 조회한다.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          },
          {
            type: 'function',
            name: 'search_transactions',
            description: '날짜, 수입·지출 유형, 사용처 또는 카테고리 조건으로 실제 거래를 조회한다.',
            parameters: {
              type: 'object',
              properties: {
                from: { type: 'string', description: '시작일 YYYY-MM-DD' },
                to: { type: 'string', description: '종료일 YYYY-MM-DD' },
                type: { type: 'string', enum: ['income', 'expense'] },
                merchant: { type: 'string' },
                category_name: { type: 'string' },
                limit: { type: 'integer', minimum: 1, maximum: 30 },
              },
              additionalProperties: false,
            },
          },
          {
            type: 'function',
            name: 'prepare_transaction',
            description: '사용자가 말한 단일 수입 또는 지출을 저장하지 않고 화면 검토용 거래 초안으로 만든다.',
            parameters: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['income', 'expense'] },
                amount: { type: 'integer', minimum: 1, description: '원 단위 정수 금액' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
                merchant: { type: 'string', description: '사용처 또는 수입처' },
                memo: { type: 'string' },
                category_name: { type: 'string', description: '사용 가능한 카테고리 중 가장 알맞은 이름' },
                payment_method: { type: 'string', enum: ['card', 'account', 'cash', 'other'] },
                account_name: { type: 'string' },
                card_name: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
                spoken_summary: { type: 'string', description: '사용자가 말한 거래 요청을 보존한 한국어 문장' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                reason: { type: 'string' },
              },
              required: ['type', 'amount', 'date', 'merchant', 'category_name', 'spoken_summary', 'confidence'],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: 'auto',
      },
    };
  };

  const startSession = async () => {
    setStatus('connecting');
    setErrorMessage(null);
    setMessages([]);
    handledToolCallsRef.current.clear();

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
        throw new Error('이 브라우저는 GPT 라이브 음성을 지원하지 않습니다.');
      }

      const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerRef.current = peer;
      const remoteAudio = document.createElement('audio');
      remoteAudio.autoplay = true;
      audioRef.current = remoteAudio;
      peer.ontrack = event => {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(() => undefined);
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          setErrorMessage('GPT 라이브 연결이 끊어졌습니다. 다시 연결해주세요.');
          setStatus('error');
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));

      const channel = peer.createDataChannel('oai-events');
      channelRef.current = channel;
      channel.addEventListener('message', event => {
        try {
          handleServerEvent(JSON.parse(event.data));
        } catch {
          // Ignore malformed or non-JSON diagnostic events.
        }
      });
      channel.addEventListener('open', () => {
        sessionStartedAtRef.current = Date.now();
        channel.send(JSON.stringify(createSessionUpdate()));
        setStatus('listening');
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await authenticatedFetch('/api/ai/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!response.ok) {
        const raw = await response.text();
        let message = 'GPT 라이브 음성에 연결하지 못했습니다.';
        try {
          const parsed = JSON.parse(raw);
          message = parsed.message || parsed.error?.message || message;
        } catch {
          if (raw.trim()) message = raw.slice(0, 200);
        }
        throw new Error(message);
      }
      const answerSdp = await response.text();
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (error: any) {
      cleanupResources();
      if (error?.name === 'NotAllowedError') {
        setErrorMessage('마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.');
      } else {
        setErrorMessage(error?.message || 'GPT 라이브 음성 연결에 실패했습니다.');
      }
      setStatus('error');
    }
  };

  const stopSession = () => {
    cleanupResources();
    setIsMuted(false);
    setStatus('idle');
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    streamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  };

  const statusText = status === 'connecting'
    ? 'GPT 비서 연결 중'
    : status === 'speaking'
      ? '비서가 답변하고 있어요'
      : status === 'listening'
        ? isMuted ? '마이크가 꺼져 있어요' : '말씀하세요. 듣고 있어요'
        : 'GPT 라이브 금융 비서';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <p className="leading-relaxed">
          음성은 실시간 대화를 위해 OpenAI로 전송됩니다. 앱은 음성 원본을 저장하지 않으며,
          거래는 반드시 화면에서 확인한 뒤에만 저장됩니다.
        </p>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="relative overflow-hidden rounded-3xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_rgba(15,23,42,0.96)_58%)] px-5 py-7 text-center">
        <div className="pointer-events-none absolute inset-x-12 top-8 h-28 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative space-y-4">
          <div className="flex items-center justify-center gap-2 text-[10px] font-bold tracking-[0.22em] text-cyan-300 uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{REALTIME_MODEL}</span>
          </div>

          <button
            type="button"
            onClick={status === 'idle' || status === 'error' ? startSession : undefined}
            disabled={status === 'connecting'}
            className={`relative mx-auto flex h-28 w-28 items-center justify-center rounded-full border transition-all ${
              status === 'listening' || status === 'speaking'
                ? 'border-cyan-300/60 bg-gradient-to-br from-cyan-400/30 to-violet-500/30 shadow-[0_0_55px_rgba(34,211,238,0.22)]'
                : 'border-slate-700 bg-slate-900 hover:scale-105 hover:border-cyan-400/50'
            }`}
            aria-label="GPT 라이브 음성 시작"
          >
            {(status === 'listening' || status === 'speaking') && (
              <span className="absolute inset-[-10px] animate-pulse rounded-full border border-cyan-400/20" />
            )}
            {status === 'connecting'
              ? <Loader2 className="h-10 w-10 animate-spin text-cyan-300" />
              : status === 'speaking'
                ? <Radio className="h-10 w-10 animate-pulse text-violet-200" />
                : <Mic className="h-10 w-10 text-cyan-200" />}
          </button>

          <div>
            <p className="text-sm font-bold text-white">{statusText}</p>
            <p className="mt-1 text-xs text-slate-400">
              {status === 'idle' || status === 'error'
                ? '버튼을 누른 뒤 자연스럽게 수입·지출을 말하거나 질문하세요.'
                : '말을 끊거나 바로 이어서 질문해도 됩니다.'}
            </p>
          </div>

          {(status === 'listening' || status === 'speaking') && (
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold ${
                  isMuted
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    : 'border-slate-700 bg-slate-900/80 text-slate-300'
                }`}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isMuted ? '마이크 켜기' : '음소거'}
              </button>
              <button
                type="button"
                onClick={stopSession}
                className="flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200"
              >
                <PhoneOff className="h-4 w-4" />
                대화 종료
              </button>
            </div>
          )}
        </div>
      </div>

      {messages.length > 0 ? (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
          {messages.map(message => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                message.role === 'user'
                  ? 'bg-cyan-500/15 text-cyan-50'
                  : 'bg-slate-800 text-slate-200'
              }`}>
                {message.text}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
            <MessageCircle className="h-3.5 w-3.5 text-violet-300" />
            이렇게 말해보세요
          </p>
          {[
            '오늘 이마트에서 신한카드로 5만 2천 원 썼어',
            '이번 달 지출이 지난달보다 많이 늘었어?',
            '월급날까지 하루에 얼마 써도 돼?',
          ].map(example => (
            <p key={example} className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] text-slate-300">
              “{example}”
            </p>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onUseQuickVoice}
        className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 text-xs font-semibold text-slate-400 hover:text-white"
      >
        연결이 어렵다면 Gemini 8초 빠른 음성 입력 사용
      </button>
    </div>
  );
};
