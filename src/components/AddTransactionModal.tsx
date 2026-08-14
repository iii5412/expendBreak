import React, { useEffect, useState } from 'react';
import {
  X,
  Sparkles,
  CheckCircle,
  PenTool,
  Loader2,
  AlertTriangle,
  Send,
  Camera,
  Mic,
  RotateCcw,
  Volume2,
  Zap,
  Settings2,
} from 'lucide-react';
import {
  Category,
  Transaction,
  AIClassifyResult,
  VoiceAnalysisResult,
  MerchantRule,
  BankAccount,
  Budget,
  PaymentCard,
  PaymentMethodType,
  RecurringOccurrence,
  RecurringTemplate,
  QuickEntry,
} from '../types';
import { formatKRW, getCurrentYearMonth, getLocalDateString } from '../utils/calculations';
import { authenticatedFetch } from '../utils/auth';
import { normalizeTags } from '../utils/receipt';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';
import { parseAmountInput } from '../utils/amount';
import {
  TransactionDraft,
  clearTransactionDraft,
  readTransactionDraft,
  saveTransactionDraft,
} from '../utils/transactionDraft';
import { readPreferredEntryMode, savePreferredEntryMode } from '../utils/entryMode';
import { ReceiptCapturePanel } from './ReceiptCapturePanel';
import { VoiceInputPanel } from './VoiceInputPanel';
import { LiveVoicePanel } from './LiveVoicePanel';
import { normalizeInstallmentPlan } from '../utils/installments';
import { RecurringMatchCandidate, findRecurringMatches } from '../utils/recurringMatch';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts?: BankAccount[];
  paymentCards?: PaymentCard[];
  transactions?: Transaction[];
  budget: Budget;
  recurringOccurrences?: RecurringOccurrence[];
  recurringTemplates?: RecurringTemplate[];
  monthStartDay?: number;
  aiClassificationEnabled?: boolean;
  onSaveTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  onSaveMerchantRule: (pattern: string, categoryId: string) => void;
  quickEntries?: QuickEntry[];
  /** Runs the same one-tap path used by the home screen and widget. */
  onPostQuickEntry?: (id: string, amountOverride?: number) => boolean;
  onManageQuickEntries?: () => void;
  /** Settles a recurring item directly when this entry turns out to be one. */
  onPostOccurrence?: (
    occurrenceId: string,
    amount: number,
    paymentMethodType: PaymentMethodType,
    accountId: string | null,
    cardId: string | null,
  ) => Promise<void> | void;
}

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  isOpen,
  onClose,
  categories,
  merchantRules,
  bankAccounts = [],
  paymentCards = [],
  transactions = [],
  budget,
  recurringOccurrences = [],
  recurringTemplates = [],
  monthStartDay = 1,
  aiClassificationEnabled = true,
  onSaveTransaction,
  onSaveMerchantRule,
  quickEntries = [],
  onPostQuickEntry,
  onManageQuickEntries,
  onPostOccurrence,
}) => {
  const [activeMode, setActiveMode] = useState<'receipt' | 'voice' | 'ai' | 'manual'>('voice');
  const [voiceInputKind, setVoiceInputKind] = useState<'live' | 'quick'>('live');

  // Manual Form State
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState<string>('');
  const [localDate, setLocalDate] = useState<string>(getLocalDateString());
  const [categoryId, setCategoryId] = useState<string>(
    categories.find((category) => category.id === 'etc_expense')?.id
      || categories.find((category) => category.type === 'expense' && category.active)?.id
      || '',
  );
  const [merchant, setMerchant] = useState<string>('');
  const [memo, setMemo] = useState<string>('');
  const [tagsText, setTagsText] = useState<string>('');
  const [paymentMethodType, setPaymentMethodType] = useState<PaymentMethodType>('card');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [installmentMonths, setInstallmentMonths] = useState<number>(1);
  const [installmentCurrentRound, setInstallmentCurrentRound] = useState<number>(1);

  // AI Prompt State
  const [aiPromptText, setAiPromptText] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AIClassifyResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Voice State
  const [voiceResult, setVoiceResult] = useState<VoiceAnalysisResult | null>(null);
  const [voiceDurationMs, setVoiceDurationMs] = useState<number>(0);
  const [voiceMimeType, setVoiceMimeType] = useState<string>('audio/webm');
  const [confirmTranscript, setConfirmTranscript] = useState<string>('');

  // Confirmation Drawer Edit States
  const [confirmAmount, setConfirmAmount] = useState<number>(0);
  const [confirmCategoryId, setConfirmCategoryId] = useState<string>('');
  const [confirmMerchant, setConfirmMerchant] = useState<string>('');
  const [confirmType, setConfirmType] = useState<'income' | 'expense'>('expense');
  const [confirmDate, setConfirmDate] = useState<string>(getLocalDateString());
  const [confirmMemo, setConfirmMemo] = useState<string>('');
  const [confirmPaymentMethodType, setConfirmPaymentMethodType] = useState<PaymentMethodType>('card');
  const [confirmAccountId, setConfirmAccountId] = useState<string>('');
  const [confirmCardId, setConfirmCardId] = useState<string>('');
  const [confirmInstallmentMonths, setConfirmInstallmentMonths] = useState<number>(1);
  const [confirmInstallmentCurrentRound, setConfirmInstallmentCurrentRound] = useState<number>(1);
  const [rememberRule, setRememberRule] = useState<boolean>(true);

  /** Inline validation message for whichever save flow is active. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<TransactionDraft | null>(null);
  /** Pending "is this your rent?" question, blocking the save until answered. */
  const [recurringMatchPrompt, setRecurringMatchPrompt] = useState<RecurringMatchCandidate | null>(null);
  const [quickAmountEntry, setQuickAmountEntry] = useState<QuickEntry | null>(null);
  const [quickAmount, setQuickAmount] = useState(0);

  /**
   * Mode changes the user asked for, which become the remembered default. The
   * programmatic `setActiveMode('manual')` hops after an AI or voice result are
   * deliberately not routed through here — they are a step inside another flow,
   * not a statement about how this person prefers to enter transactions.
   */
  const selectMode = (mode: 'receipt' | 'voice' | 'ai' | 'manual') => {
    setActiveMode(mode);
    savePreferredEntryMode(mode);
  };

  const failValidation = (message: string, focusElementId?: string) => {
    setSaveError(message);
    if (focusElementId) document.getElementById(focusElementId)?.focus();
    return false;
  };

  useEffect(() => {
    if (!aiClassificationEnabled) setActiveMode('manual');
  }, [aiClassificationEnabled]);

  useEffect(() => {
    if (isOpen) {
      setActiveMode(readPreferredEntryMode(aiClassificationEnabled));
      setVoiceInputKind('live');
      setVoiceResult(null);
      setSaveError(null);
      setRecurringMatchPrompt(null);
      setQuickAmountEntry(null);
      setQuickAmount(0);
      setRecoverableDraft(readTransactionDraft());
    }
  }, [isOpen, aiClassificationEnabled]);

  // Persist the manual form so an auto-lock does not discard it.
  useEffect(() => {
    if (!isOpen) return;
    saveTransactionDraft({
      type,
      amount,
      localDate,
      categoryId,
      merchant,
      memo,
      tagsText,
      paymentMethodType,
      accountId: selectedAccountId,
      cardId: selectedCardId,
      installmentMonths,
      installmentCurrentRound,
    });
  }, [isOpen, type, amount, localDate, categoryId, merchant, memo, tagsText, paymentMethodType, selectedAccountId, selectedCardId, installmentMonths, installmentCurrentRound]);

  useEffect(() => {
    if (!isOpen) return;
    const defaultCardId = paymentCards[0]?.id || '';
    setSelectedCardId(current => paymentCards.some(card => card.id === current) ? current : defaultCardId);
    setConfirmCardId(current => paymentCards.some(card => card.id === current) ? current : defaultCardId);
  }, [isOpen, paymentCards]);

  const categoryForType = (nextType: 'income' | 'expense') =>
    categories.find((category) => category.id === (nextType === 'expense' ? 'etc_expense' : 'etc_income'))?.id
      || categories.find((category) => category.type === nextType && category.active)?.id
      || '';

  if (!isOpen) return null;

  const handleRunAiClassify = async () => {
    if (!aiPromptText.trim()) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiResult(null);

    try {
      const res = await authenticatedFetch('/api/ai/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: aiPromptText,
          categories,
          merchantRules,
          defaultDate: getLocalDateString(),
        }),
      });

      if (!res.ok) throw new Error('AI Server Error');
      const data: AIClassifyResult = await res.json();

      const safeType = data.type === 'income' ? 'income' : 'expense';
      const suggestedCategory = categories.find((category) => category.id === data.suggestedCategoryId);
      const safeCategoryId = suggestedCategory?.type === safeType
        ? suggestedCategory.id
        : categories.find((category) => category.id === (safeType === 'expense' ? 'etc_expense' : 'etc_income'))?.id
          || categories.find((category) => category.type === safeType && category.active)?.id
          || '';

      setAiResult({ ...data, type: safeType, suggestedCategoryId: safeCategoryId, needsConfirmation: true });
      setConfirmAmount(data.amount);
      setConfirmCategoryId(safeCategoryId);
      setConfirmMerchant(data.merchant);
      setConfirmType(safeType);
      setConfirmDate(data.date || getLocalDateString());
      setConfirmMemo(data.memo || aiPromptText);
      const compactPrompt = aiPromptText.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
      const matchedCard = paymentCards.find(card => [card.cardName, card.cardCompany]
        .some(value => compactPrompt.includes(value.toLocaleLowerCase('ko-KR').replace(/\s+/g, ''))));
      const matchedAccount = bankAccounts.find(account => [account.bankName, account.accountName]
        .some(value => compactPrompt.includes(value.toLocaleLowerCase('ko-KR').replace(/\s+/g, ''))));
      if (matchedCard) {
        setConfirmPaymentMethodType('card');
        setConfirmCardId(matchedCard.id);
      } else if (matchedAccount) {
        setConfirmPaymentMethodType('account');
        setConfirmAccountId(matchedAccount.id);
      } else if (compactPrompt.includes('현금')) {
        setConfirmPaymentMethodType('cash');
      }
      const installmentMatch = compactPrompt.match(/(\d+)개월할부/);
      const roundMatch = compactPrompt.match(/(\d+)회차/);
      if (installmentMatch) {
        const months = Math.min(60, Math.max(2, Number(installmentMatch[1])));
        setConfirmInstallmentMonths(months);
        setConfirmInstallmentCurrentRound(Math.min(months, Math.max(1, Number(roundMatch?.[1] || 1))));
      } else {
        setConfirmInstallmentMonths(1);
        setConfirmInstallmentCurrentRound(1);
      }
    } catch (err: any) {
      console.error(err);
      setAiError('AI 분석 중 오류가 발생했습니다. 아래 수동 입력을 이용해주세요.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleConfirmAiSave = () => {
    if (confirmAmount <= 0) {
      failValidation('1원 이상의 정수 금액을 입력해 주세요.', 'ai-confirm-amount');
      return;
    }
    const selectedCategory = categories.find((category) => category.id === confirmCategoryId);
    if (!selectedCategory || selectedCategory.type !== confirmType) {
      failValidation(`${confirmType === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }
    if (confirmPaymentMethodType === 'card' && paymentCards.length > 0 && !confirmCardId) {
      failValidation('카드 결제 예정액을 계산할 수 있도록 사용한 카드를 선택해 주세요.');
      return;
    }
    setSaveError(null);

    onSaveTransaction({
      type: confirmType,
      amount: Math.round(confirmAmount),
      occurredAt: `${confirmDate}T12:00:00.000Z`,
      localDate: confirmDate,
      categoryId: confirmCategoryId,
      merchant: confirmMerchant || '기타',
      memo: confirmMemo,
      tags: normalizeTags(tagsText),
      source: 'ai',
      paymentMethodType: confirmPaymentMethodType,
      accountId: confirmPaymentMethodType === 'account' ? confirmAccountId : null,
      cardId: confirmPaymentMethodType === 'card' ? confirmCardId : null,
      installment: confirmType === 'expense' && confirmPaymentMethodType === 'card'
        ? normalizeInstallmentPlan(confirmInstallmentMonths, confirmInstallmentCurrentRound, getCurrentYearMonth(monthStartDay))
        : null,
      aiConfidence: aiResult?.confidence || 0.9,
      aiReviewed: true,
    });

    if (rememberRule && confirmMerchant && confirmCategoryId) {
      onSaveMerchantRule(confirmMerchant, confirmCategoryId);
    }

    resetAll();
    onClose();
  };

  const handleVoiceAnalysisComplete = (
    result: VoiceAnalysisResult,
    durationMs: number,
    mimeType: string,
  ) => {
    setVoiceResult(result);
    setVoiceDurationMs(durationMs);
    setVoiceMimeType(mimeType);

    setConfirmType(result.type);
    setConfirmAmount(result.amount);
    setConfirmDate(result.date || getLocalDateString());
    setConfirmMerchant(result.merchant);
    setConfirmCategoryId(result.suggestedCategoryId);
    setConfirmMemo(result.memo || result.transcript);
    setConfirmTranscript(result.transcript);

    if (result.tags && result.tags.length > 0) {
      setTagsText(result.tags.join(', '));
    }
    if (result.paymentMethodType) {
      setConfirmPaymentMethodType(result.paymentMethodType);
    }
    if (result.suggestedAccountId) {
      setConfirmAccountId(result.suggestedAccountId);
    }
    if (result.suggestedCardId) {
      setConfirmCardId(result.suggestedCardId);
    }
    setConfirmInstallmentMonths(result.installmentMonths || 1);
    setConfirmInstallmentCurrentRound(result.installmentCurrentRound || 1);
  };

  const handleConfirmVoiceSave = () => {
    if (confirmAmount <= 0) {
      failValidation('1원 이상의 정수 금액을 입력해 주세요.', 'voice-confirm-amount');
      return;
    }
    const selectedCategory = categories.find((c) => c.id === confirmCategoryId);
    if (!selectedCategory || selectedCategory.type !== confirmType) {
      failValidation(`${confirmType === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }
    if (confirmPaymentMethodType === 'card' && paymentCards.length > 0 && !confirmCardId) {
      failValidation('카드 결제 예정액을 계산할 수 있도록 사용한 카드를 선택해 주세요.');
      return;
    }
    setSaveError(null);

    onSaveTransaction({
      type: confirmType,
      amount: Math.round(confirmAmount),
      occurredAt: `${confirmDate}T12:00:00.000Z`,
      localDate: confirmDate,
      categoryId: confirmCategoryId,
      merchant: confirmMerchant || '기타 사용처',
      memo: confirmMemo,
      tags: normalizeTags(tagsText),
      source: 'voice',
      paymentMethodType: confirmPaymentMethodType,
      accountId: confirmPaymentMethodType === 'account' ? confirmAccountId : null,
      cardId: confirmPaymentMethodType === 'card' ? confirmCardId : null,
      installment: confirmType === 'expense' && confirmPaymentMethodType === 'card'
        ? normalizeInstallmentPlan(confirmInstallmentMonths, confirmInstallmentCurrentRound, getCurrentYearMonth(monthStartDay))
        : null,
      aiConfidence: voiceResult?.confidence || 0.9,
      aiReviewed: true,
      voiceRecord: {
        transcript: confirmTranscript || voiceResult?.transcript || '',
        durationMs: voiceDurationMs,
        mimeType: voiceMimeType,
        confidence: voiceResult?.confidence || 0.9,
        modelUsed: voiceResult?.modelUsed || 'gemini-3.5-flash-lite',
        fallbackUsed: voiceResult?.fallbackUsed || false,
        recordedAt: new Date().toISOString(),
      },
    });

    if (rememberRule && confirmMerchant && confirmCategoryId) {
      onSaveMerchantRule(confirmMerchant, confirmCategoryId);
    }

    // Optional Speech Synthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
      try {
        const speechText = `${selectedCategory.name} ${Math.round(confirmAmount).toLocaleString('ko-KR')}원으로 등록했습니다.`;
        const utterance = new SpeechSynthesisUtterance(speechText);
        utterance.lang = 'ko-KR';
        window.speechSynthesis.speak(utterance);
      } catch {
        // Optional Web Speech API
      }
    }

    resetAll();
    onClose();
  };

  const handleSwitchToManualFromVoice = () => {
    // Fill manual form fields from voice analysis
    setType(confirmType);
    if (confirmAmount > 0) setAmount(String(confirmAmount));
    setLocalDate(confirmDate);
    setMerchant(confirmMerchant);
    if (confirmCategoryId) setCategoryId(confirmCategoryId);
    setMemo(confirmMemo);
    setPaymentMethodType(confirmPaymentMethodType);
    setSelectedAccountId(confirmAccountId);
    setSelectedCardId(confirmCardId);
    setInstallmentMonths(confirmInstallmentMonths);
    setInstallmentCurrentRound(confirmInstallmentCurrentRound);
    setVoiceResult(null);
    setActiveMode('manual');
  };

  const handleSaveManual = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount) || numAmount <= 0) {
      failValidation('1원 이상의 정수 금액을 입력해 주세요.', 'manual-amount');
      return;
    }
    const selectedCategory = categories.find((category) => category.id === categoryId);
    if (!selectedCategory || selectedCategory.type !== type) {
      failValidation(`${type === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }
    if (paymentMethodType === 'card' && paymentCards.length > 0 && !selectedCardId) {
      failValidation('카드 결제 예정액을 계산할 수 있도록 사용한 카드를 선택해 주세요.');
      return;
    }
    setSaveError(null);

    // Saving this as an ordinary expense while the recurring item stays pending
    // would charge the same money twice, so ask before that happens.
    if (!recurringMatchPrompt) {
      const [match] = findRecurringMatches(
        { type, amount: numAmount, localDate, merchant, categoryId },
        recurringOccurrences,
        recurringTemplates,
      );
      if (match) {
        setRecurringMatchPrompt(match);
        return;
      }
    }

    saveManualTransaction(numAmount);
  };

  const saveManualTransaction = (numAmount: number) => {
    onSaveTransaction({
      type,
      amount: numAmount,
      occurredAt: `${localDate}T12:00:00.000Z`,
      localDate,
      categoryId,
      merchant: merchant || '기타',
      memo,
      tags: normalizeTags(tagsText),
      source: 'manual',
      paymentMethodType,
      accountId: paymentMethodType === 'account' ? selectedAccountId : null,
      cardId: paymentMethodType === 'card' ? selectedCardId : null,
      installment: type === 'expense' && paymentMethodType === 'card'
        ? normalizeInstallmentPlan(installmentMonths, installmentCurrentRound, getCurrentYearMonth(monthStartDay))
        : null,
    });

    setRecurringMatchPrompt(null);
    resetAll();
    onClose();
  };

  /** Settles the matched recurring item instead of recording a separate expense. */
  const handleConfirmRecurringMatch = async () => {
    if (!recurringMatchPrompt || !onPostOccurrence) return;
    const amountToPost = parseInt(amount, 10);
    await onPostOccurrence(
      recurringMatchPrompt.occurrence.id,
      amountToPost,
      paymentMethodType,
      paymentMethodType === 'account' ? selectedAccountId || null : null,
      paymentMethodType === 'card' ? selectedCardId || null : null,
    );
    setRecurringMatchPrompt(null);
    resetAll();
    onClose();
  };

  const restoreDraft = () => {
    if (!recoverableDraft) return;
    setType(recoverableDraft.type);
    setAmount(recoverableDraft.amount);
    setLocalDate(recoverableDraft.localDate);
    if (recoverableDraft.categoryId) setCategoryId(recoverableDraft.categoryId);
    setMerchant(recoverableDraft.merchant);
    setMemo(recoverableDraft.memo);
    setTagsText(recoverableDraft.tagsText);
    setPaymentMethodType(recoverableDraft.paymentMethodType || 'card');
    setSelectedAccountId(recoverableDraft.accountId || '');
    setSelectedCardId(recoverableDraft.cardId || paymentCards[0]?.id || '');
    setInstallmentMonths(recoverableDraft.installmentMonths || 1);
    setInstallmentCurrentRound(recoverableDraft.installmentCurrentRound || 1);
    setActiveMode('manual');
    setRecoverableDraft(null);
  };

  const discardDraft = () => {
    clearTransactionDraft();
    setRecoverableDraft(null);
  };

  const resetAll = () => {
    clearTransactionDraft();
    setRecoverableDraft(null);
    setSaveError(null);
    setAiPromptText('');
    setAiResult(null);
    setVoiceResult(null);
    setVoiceDurationMs(0);
    setVoiceInputKind('live');
    setConfirmTranscript('');
    setAmount('');
    setMerchant('');
    setMemo('');
    setTagsText('');
    setInstallmentMonths(1);
    setInstallmentCurrentRound(1);
    setConfirmInstallmentMonths(1);
    setConfirmInstallmentCurrentRound(1);
    setQuickAmountEntry(null);
    setQuickAmount(0);
  };

  const expenseQuickEntries = quickEntries.filter(entry => entry.type === 'expense');

  const finishQuickEntry = (entry: QuickEntry, amountOverride?: number) => {
    if (!onPostQuickEntry?.(entry.id, amountOverride)) return;
    resetAll();
    onClose();
  };

  const selectQuickEntry = (entry: QuickEntry) => {
    if (entry.amount === null) {
      setQuickAmountEntry(entry);
      setQuickAmount(0);
      return;
    }
    finishQuickEntry(entry);
  };

  const saveErrorNotice = saveError ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs font-semibold text-rose-300"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{saveError}</span>
    </p>
  ) : null;

  const examplePrompts = [
    '배민 저녁 24,900원',
    '아이 학원비 180000 오늘',
    '월급 3,500,000원 들어옴',
    '어제 카카오택시 13,500',
  ];

  const renderInstallmentFields = (confirmation: boolean) => {
    const currentType = confirmation ? confirmType : type;
    const currentMethod = confirmation ? confirmPaymentMethodType : paymentMethodType;
    if (currentType !== 'expense' || currentMethod !== 'card') return null;
    const months = confirmation ? confirmInstallmentMonths : installmentMonths;
    const round = confirmation ? confirmInstallmentCurrentRound : installmentCurrentRound;
    const setMonths = (next: number) => {
      const normalized = Math.min(60, Math.max(1, Math.trunc(next || 1)));
      if (confirmation) {
        setConfirmInstallmentMonths(normalized);
        setConfirmInstallmentCurrentRound(current => Math.min(normalized, Math.max(1, current)));
      } else {
        setInstallmentMonths(normalized);
        setInstallmentCurrentRound(current => Math.min(normalized, Math.max(1, current)));
      }
    };
    const setRound = (next: number) => {
      const normalized = Math.min(months, Math.max(1, Math.trunc(next || 1)));
      if (confirmation) setConfirmInstallmentCurrentRound(normalized);
      else setInstallmentCurrentRound(normalized);
    };
    return (
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-bold text-indigo-200">할부 정보</span>
          <span className="text-xs text-slate-400">{months <= 1 ? '일시불' : `${round}/${months}회차`}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-slate-400">
            <span className="mb-1 block">할부 개월</span>
            <input type="number" min="1" max="60" value={months} onChange={event => setMonths(Number(event.target.value))} className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-white" />
          </label>
          <label className="text-slate-400">
            <span className="mb-1 block">이번 달 회차</span>
            <input type="number" min="1" max={months} value={round} disabled={months <= 1} onChange={event => setRound(Number(event.target.value))} className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-white disabled:opacity-50" />
          </label>
        </div>
        {months > 1 && (() => {
          // Show the monthly commitment, not the sticker price: that is the number
          // that competes with the rest of this cycle's living budget.
          const total = confirmation ? Math.round(confirmAmount) : parseAmountInput(amount);
          const perRound = total > 0 ? Math.floor(total / months) : 0;
          const remainingRounds = Math.max(0, months - round + 1);
          return (
            <div className="mt-2 space-y-1 border-t border-indigo-500/20 pt-2 text-xs">
              {perRound > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">이번 주기 생활비에서</span>
                    <span className="font-bold text-indigo-200">{formatKRW(perRound)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">남은 {remainingRounds}회 동안 매달</span>
                    <span className="font-semibold text-slate-300">{formatKRW(perRound)}</span>
                  </div>
                </>
              )}
              <p className="text-slate-400">
                총액이 아니라 회차분만 이번 주기에 반영됩니다. 나머지는 회차가 오는 주기에 잡힙니다.
              </p>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="add-transaction-title"
      dismissOnBackdrop={false}
      backdropClassName="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
      panelClassName="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-2xl"
    >
      <>
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <h2 id="add-transaction-title" className="text-base font-bold text-white">거래 추가</h2>
            <span className="text-xs text-rose-400 font-semibold bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 rounded-full">
              10초 간편 입력
            </span>
          </div>

          <button
            onClick={onClose}
            aria-label="거래 추가 창 닫기"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Draft left behind by an auto-lock or an accidental close. */}
        {recoverableDraft && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <p className="font-bold text-amber-200">작성 중이던 내용이 있습니다.</p>
            <p className="text-amber-100/80">
              {recoverableDraft.merchant || '사용처 미입력'}
              {Number(recoverableDraft.amount) > 0 && ` · ${formatKRW(Number(recoverableDraft.amount))}`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={restoreDraft}
                className="min-h-9 flex-1 rounded-lg bg-amber-400 px-3 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-300"
              >
                이어서 작성
              </button>
              <button
                type="button"
                onClick={discardDraft}
                className="min-h-9 rounded-lg border border-amber-500/40 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/10"
              >
                지우기
              </button>
            </div>
          </div>
        )}

        {/* The central + button is the fastest route into the app, so saved
            expenses live here as well as on the dashboard and widget. */}
        {onPostQuickEntry && (
          <section className="space-y-3 rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-slate-950 to-rose-500/5 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-amber-200">
                  <Zap className="h-4 w-4 fill-amber-300 text-amber-300" aria-hidden="true" />
                  퀵등록으로 바로 기록
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">자주 쓰는 지출은 입력 과정 없이 바로 저장합니다.</p>
              </div>
              {onManageQuickEntries && (
                <button
                  type="button"
                  onClick={onManageQuickEntries}
                  className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  <Settings2 className="h-3.5 w-3.5" /> 관리
                </button>
              )}
            </div>

            {expenseQuickEntries.length > 0 ? (
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                {expenseQuickEntries.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => selectQuickEntry(entry)}
                    className="min-h-14 min-w-[7.25rem] shrink-0 rounded-xl border border-amber-500/20 bg-slate-900 px-3 py-2 text-left transition-colors hover:border-amber-400/50 hover:bg-slate-800 active:scale-[0.98]"
                  >
                    <span className="block truncate text-xs font-extrabold text-slate-100">{entry.label}</span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-amber-300">
                      {entry.amount === null ? '금액 입력' : formatKRW(entry.amount)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={onManageQuickEntries}
                className="min-h-11 w-full rounded-xl border border-dashed border-slate-700 text-xs font-semibold text-slate-400 hover:border-amber-500/40 hover:text-amber-200"
              >
                지출 퀵등록 만들기
              </button>
            )}

            {quickAmountEntry && (
              <div className="space-y-3 rounded-xl border border-amber-500/30 bg-slate-900 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold text-slate-100">{quickAmountEntry.label}</p>
                    <p className="text-[11px] text-slate-400">이번 지출 금액만 입력하세요.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuickAmountEntry(null)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    aria-label="퀵등록 금액 입력 닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <AmountInput value={quickAmount} onChange={setQuickAmount} showQuickAdd autoFocus />
                <button
                  type="button"
                  disabled={quickAmount <= 0}
                  onClick={() => finishQuickEntry(quickAmountEntry, quickAmount)}
                  className="min-h-11 w-full rounded-xl bg-amber-400 text-sm font-extrabold text-slate-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {quickAmount > 0 ? `${formatKRW(quickAmount)} 바로 기록` : '금액을 입력해 주세요'}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Mode Switcher - 2x2 Grid on Mobile for 4 modes */}
        <div
          className={`grid ${
            aiClassificationEnabled ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'
          } gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800`}
        >
          {aiClassificationEnabled && (
            <button
              onClick={() => {
                selectMode('voice');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                activeMode === 'voice'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mic className="w-4 h-4 shrink-0 text-purple-300" />
              <span>GPT 라이브</span>
            </button>
          )}

          {aiClassificationEnabled && (
            <button
              onClick={() => {
                selectMode('ai');
                setVoiceResult(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                activeMode === 'ai'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-amber-300" />
              <span>AI 문장</span>
            </button>
          )}

          {aiClassificationEnabled && (
            <button
              onClick={() => {
                selectMode('receipt');
                setVoiceResult(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                activeMode === 'receipt'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>영수증</span>
            </button>
          )}

          <button
            onClick={() => {
              selectMode('manual');
              setVoiceResult(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
              activeMode === 'manual'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PenTool className="w-4 h-4 shrink-0" />
            <span>직접 입력</span>
          </button>
        </div>

        {/* MODE 1: Receipt Capture */}
        {aiClassificationEnabled && activeMode === 'receipt' && (
          <ReceiptCapturePanel
            categories={categories}
            merchantRules={merchantRules}
            bankAccounts={bankAccounts}
            paymentCards={paymentCards}
            monthStartDay={monthStartDay}
            onSaveTransaction={onSaveTransaction}
            onSaveMerchantRule={onSaveMerchantRule}
            onDone={() => {
              resetAll();
              onClose();
            }}
          />
        )}

        {/* MODE 2: Voice Input */}
        {aiClassificationEnabled && activeMode === 'voice' && (
          <div className="space-y-4">
            {!voiceResult ? (
              voiceInputKind === 'live' ? (
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
                  onDraftReady={handleVoiceAnalysisComplete}
                  onUseQuickVoice={() => setVoiceInputKind('quick')}
                />
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setVoiceInputKind('live')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 py-2.5 text-xs font-semibold text-cyan-200"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    GPT 라이브 음성으로 돌아가기
                  </button>
                  <VoiceInputPanel
                    categories={categories}
                    merchantRules={merchantRules}
                    bankAccounts={bankAccounts}
                    paymentCards={paymentCards}
                    onAnalysisComplete={handleVoiceAnalysisComplete}
                  />
                </div>
              )
            ) : (
              /* Voice Confirmation Drawer / Panel */
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3.5 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 text-purple-300 font-bold">
                    <Mic className="w-4 h-4" />
                    <span>음성 분석 결과 확인</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30 font-semibold">
                      신뢰도 {Math.round(voiceResult.confidence * 100)}%
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border font-semibold ${
                        voiceResult.fallbackUsed
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                      title={`사용 모델: ${voiceResult.modelUsed}`}
                    >
                      {voiceResult.modelUsed} {voiceResult.fallbackUsed ? '(정밀 재분석)' : ''}
                    </span>
                  </div>
                </div>

                {/* Multiple Transactions Warning */}
                {voiceResult.multipleTransactionsDetected && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <span>
                      여러 개의 거래가 감지되었습니다. 한 번에 하나의 거래만 등록하거나, 직접 입력으로 분리해주세요.
                    </span>
                  </div>
                )}

                {/* Voice Transcript (Editable) */}
                <div>
                  <label className="text-slate-400 block mb-1 font-semibold flex items-center justify-between">
                    <span>음성 인식 원문 (수정 가능)</span>
                    <span className="text-xs text-slate-400">{(voiceDurationMs / 1000).toFixed(1)}초 녹음</span>
                  </label>
                  <input
                    type="text"
                    value={confirmTranscript}
                    onChange={(e) => setConfirmTranscript(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-medium focus:border-purple-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">구분</label>
                    <select
                      value={confirmType}
                      onChange={(e) => {
                        const nextType = e.target.value as 'income' | 'expense';
                        setConfirmType(nextType);
                        const current = categories.find((c) => c.id === confirmCategoryId);
                        if (!current || current.type !== nextType) setConfirmCategoryId(categoryForType(nextType));
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white font-bold"
                    >
                      <option value="expense">지출 (-)</option>
                      <option value="income">수입 (+)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="voice-confirm-amount" className="text-slate-400 block mb-1">금액 (KRW)</label>
                    <AmountInput
                      id="voice-confirm-amount"
                      value={confirmAmount}
                      onChange={next => {
                        setSaveError(null);
                        setConfirmAmount(next);
                      }}
                      invalid={Boolean(saveError)}
                      className="text-rose-300"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">날짜</label>
                    <input
                      type="date"
                      value={confirmDate}
                      onChange={(e) => setConfirmDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">사용처 / 거래처</label>
                    <input
                      type="text"
                      value={confirmMerchant}
                      onChange={(e) => setConfirmMerchant(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="text-slate-400 block mb-1">카테고리</label>
                    <select
                      value={confirmCategoryId}
                      onChange={(e) => {
                        setSaveError(null);
                        setConfirmCategoryId(e.target.value);
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    >
                      {categories
                        .filter((c) => c.type === confirmType && c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Payment Method selection */}
                <div>
                  <label className="text-slate-400 block mb-1">결제 수단</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setConfirmPaymentMethodType('card')}
                      className={`p-1.5 rounded-lg text-xs font-semibold border ${
                        confirmPaymentMethodType === 'card'
                          ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      카드
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPaymentMethodType('account')}
                      className={`p-1.5 rounded-lg text-xs font-semibold border ${
                        confirmPaymentMethodType === 'account'
                          ? 'bg-rose-600/30 border-rose-500 text-rose-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      계좌
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPaymentMethodType('cash')}
                      className={`p-1.5 rounded-lg text-xs font-semibold border ${
                        (confirmPaymentMethodType === 'cash' || confirmPaymentMethodType === 'other')
                          ? 'bg-slate-800 border-slate-600 text-slate-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      현금/기타
                    </button>
                  </div>

                  {confirmPaymentMethodType === 'card' && (
                    <select
                      value={confirmCardId}
                      onChange={(e) => setConfirmCardId(e.target.value)}
                      disabled={paymentCards.length === 0}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    >
                      <option value="">{paymentCards.length > 0 ? '-- 카드 선택 --' : '등록된 카드 없음'}</option>
                      {paymentCards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.cardName} ({c.cardCompany})
                        </option>
                      ))}
                    </select>
                  )}

                  {confirmPaymentMethodType === 'account' && (
                    <select
                      value={confirmAccountId}
                      onChange={(e) => setConfirmAccountId(e.target.value)}
                      disabled={bankAccounts.length === 0}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    >
                      <option value="">{bankAccounts.length > 0 ? '-- 계좌 선택 --' : '등록된 계좌 없음'}</option>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          [{a.bankName}] {a.accountName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {renderInstallmentFields(true)}

                <div className="text-xs text-slate-400 bg-slate-900 p-2.5 rounded-lg border border-slate-800/80">
                  <span className="font-semibold text-purple-300">AI 판단 이유:</span> {voiceResult.reason}
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">생활 태그 (선택)</label>
                  <input
                    type="text"
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="예: 가족, 여행, 병원"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>

                {confirmMerchant && (
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={rememberRule}
                      onChange={(e) => setRememberRule(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                    />
                    <span>다음에도 '{confirmMerchant}' 사용처를 이 카테고리로 자동 기억하기</span>
                  </label>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setVoiceResult(null)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>다시 녹음</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSwitchToManualFromVoice}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>직접 입력으로 전환</span>
                  </button>
                </div>

                {saveErrorNotice}

                <button
                  onClick={handleConfirmVoiceSave}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30 flex items-center justify-center gap-2 text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>확인 및 저장</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* MODE 3: AI Quick Input */}
        {aiClassificationEnabled && activeMode === 'ai' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-slate-300 font-semibold block">
                한 문장으로 적으면 AI가 자동 분류합니다.
              </label>

              <div className="relative">
                <input
                  type="text"
                  value={aiPromptText}
                  onChange={(e) => setAiPromptText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRunAiClassify()}
                  placeholder="예: 배민 저녁 24,900원"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3.5 pr-12 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                />
                <button
                  onClick={handleRunAiClassify}
                  disabled={isAiLoading || !aiPromptText.trim()}
                  aria-label={isAiLoading ? 'AI 분석 중' : 'AI로 분석하기'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white p-2 rounded-lg transition-colors"
                >
                  {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>

              {/* Preset example buttons */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-slate-400">추천 예시:</span>
                {examplePrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setAiPromptText(prompt)}
                    className="text-xs bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 px-2.5 py-1 rounded-md transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {aiError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {aiError}
              </div>
            )}

            {/* AI Confirmation Panel */}
            {aiResult && (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3.5 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold">
                    <Sparkles className="w-4 h-4" />
                    <span>AI 분류 결과 확인</span>
                  </div>

                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                    신뢰도 {Math.round(aiResult.confidence * 100)}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">구분</label>
                    <select
                      value={confirmType}
                      onChange={(e) => {
                        const nextType = e.target.value as 'income' | 'expense';
                        setConfirmType(nextType);
                        const current = categories.find((category) => category.id === confirmCategoryId);
                        if (!current || current.type !== nextType) setConfirmCategoryId(categoryForType(nextType));
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white font-bold"
                    >
                      <option value="expense">지출 (-)</option>
                      <option value="income">수입 (+)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="ai-confirm-amount" className="text-slate-400 block mb-1">금액 (KRW)</label>
                    <AmountInput
                      id="ai-confirm-amount"
                      value={confirmAmount}
                      onChange={next => {
                        setSaveError(null);
                        setConfirmAmount(next);
                      }}
                      invalid={Boolean(saveError)}
                      className="text-rose-300"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">사용처 / 거래처</label>
                    <input
                      type="text"
                      value={confirmMerchant}
                      onChange={(e) => setConfirmMerchant(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">카테고리</label>
                    <select
                      value={confirmCategoryId}
                      onChange={(e) => setConfirmCategoryId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    >
                      {categories
                        .filter((c) => c.type === confirmType && c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">결제 / 출금 수단</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {([['card', '카드'], ['account', '계좌'], ['cash', '현금/기타']] as Array<[PaymentMethodType, string]>).map(([method, label]) => (
                      <button key={method} type="button" onClick={() => setConfirmPaymentMethodType(method)} className={`rounded-lg border p-2 text-xs font-semibold ${(confirmPaymentMethodType === method || (method === 'cash' && confirmPaymentMethodType === 'other')) ? 'border-indigo-500 bg-indigo-600/30 text-indigo-200' : 'border-slate-800 bg-slate-900 text-slate-400'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {confirmPaymentMethodType === 'card' && (
                    <select value={confirmCardId} onChange={event => setConfirmCardId(event.target.value)} disabled={paymentCards.length === 0} className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white disabled:text-slate-500">
                      <option value="">{paymentCards.length > 0 ? '-- 카드 선택 --' : '등록된 카드 없음'}</option>
                      {paymentCards.map(card => <option key={card.id} value={card.id}>{card.cardName} ({card.cardCompany})</option>)}
                    </select>
                  )}
                  {confirmPaymentMethodType === 'account' && (
                    <select value={confirmAccountId} onChange={event => setConfirmAccountId(event.target.value)} disabled={bankAccounts.length === 0} className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white disabled:text-slate-500">
                      <option value="">{bankAccounts.length > 0 ? '-- 계좌 선택 --' : '등록된 계좌 없음'}</option>
                      {bankAccounts.map(account => <option key={account.id} value={account.id}>[{account.bankName}] {account.accountName}</option>)}
                    </select>
                  )}
                </div>

                {renderInstallmentFields(true)}

                <div className="text-xs text-slate-400 bg-slate-900 p-2.5 rounded-lg border border-slate-800/80">
                  <span className="font-semibold text-amber-300">AI 판단 이유:</span> {aiResult.reason}
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">생활 태그 (선택)</label>
                  <input
                    type="text"
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="예: 가족, 여행, 병원"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>

                {confirmMerchant && (
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={rememberRule}
                      onChange={(e) => setRememberRule(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                    />
                    <span>다음에도 '{confirmMerchant}' 사용처를 이 카테고리로 자동 기억하기</span>
                  </label>
                )}

                {saveErrorNotice}

                <button
                  onClick={handleConfirmAiSave}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30 flex items-center justify-center gap-2 text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>확인 및 저장</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* MODE 4: Manual Input */}
        {activeMode === 'manual' && (
          <form onSubmit={handleSaveManual} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1">유형</label>
                <select
                  value={type}
                  onChange={(e) => {
                    const nextType = e.target.value as 'income' | 'expense';
                    setType(nextType);
                    const current = categories.find((category) => category.id === categoryId);
                    if (!current || current.type !== nextType) setCategoryId(categoryForType(nextType));
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-bold"
                >
                  <option value="expense">지출 (-)</option>
                  <option value="income">수입 (+)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">날짜</label>
                <input
                  type="date"
                  value={localDate}
                  onChange={(e) => setLocalDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="manual-amount" className="text-slate-400 block mb-1">금액 (KRW 정수)</label>
              <AmountInput
                id="manual-amount"
                value={parseAmountInput(amount)}
                onChange={next => {
                  setSaveError(null);
                  setAmount(next ? String(next) : '');
                }}
                showQuickAdd
                invalid={Boolean(saveError)}
                className="text-base text-rose-400"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">카테고리</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
              >
                {categories
                  .filter((c) => c.type === type)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">결제 / 출금 수단</label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethodType('card')}
                  className={`p-2 rounded-lg text-xs font-semibold border ${
                    paymentMethodType === 'card'
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  카드
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethodType('account')}
                  className={`p-2 rounded-lg text-xs font-semibold border ${
                    paymentMethodType === 'account'
                      ? 'bg-rose-600/30 border-rose-500 text-rose-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  계좌
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethodType('cash')}
                  className={`p-2 rounded-lg text-xs font-semibold border ${
                    paymentMethodType === 'cash'
                      ? 'bg-slate-800 border-slate-600 text-slate-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  현금/기타
                </button>
              </div>

              {paymentMethodType === 'card' && (
                <select
                  value={selectedCardId}
                  onChange={(e) => setSelectedCardId(e.target.value)}
                  disabled={paymentCards.length === 0}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                >
                  <option value="">{paymentCards.length > 0 ? '-- 카드 선택 --' : '등록된 카드 없음'}</option>
                  {paymentCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.cardName} ({c.cardCompany})
                    </option>
                  ))}
                </select>
              )}

              {paymentMethodType === 'account' && (
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  disabled={bankAccounts.length === 0}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                >
                  <option value="">{bankAccounts.length > 0 ? '-- 계좌 선택 --' : '등록된 계좌 없음'}</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.bankName}] {a.accountName} ({a.accountNumber})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {renderInstallmentFields(false)}

            <div>
              <label className="text-slate-400 block mb-1">사용처 / 거래처</label>
              <input
                type="text"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="예: 배달의민족, 이마트, 카카오택시"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">메모 (선택)</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예: 저녁 보쌈 배달"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">생활 태그 (선택)</label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="예: 가족, 여행, 병원 (쉼표로 구분)"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
              />
            </div>

            {saveErrorNotice}

            {recurringMatchPrompt && (
              <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>이 거래, 등록해 둔 정기 항목인가요?</span>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs">
                  <div className="font-bold text-slate-100">{recurringMatchPrompt.template.name}</div>
                  <div className="mt-0.5 text-slate-400">
                    {recurringMatchPrompt.occurrence.scheduledDate} 예정 · {formatKRW(recurringMatchPrompt.expectedAmount)}
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-300">
                  정기 항목으로 확정하면 예정된 고정 출금이 처리됩니다. 별개 지출로 저장하면
                  생활비에서 한 번 더 빠지고 정기 항목은 미처리로 남습니다.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleConfirmRecurringMatch()}
                    disabled={!onPostOccurrence}
                    className="min-h-11 flex-1 rounded-lg bg-amber-500 text-xs font-extrabold text-slate-950 transition-colors hover:bg-amber-600 disabled:opacity-50"
                  >
                    정기 항목으로 확정
                  </button>
                  <button
                    type="button"
                    onClick={() => saveManualTransaction(parseInt(amount, 10))}
                    className="min-h-11 flex-1 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
                  >
                    별개 지출로 저장
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30 flex items-center justify-center gap-2 text-sm"
            >
              <CheckCircle className="w-4 h-4" />
              <span>거래 저장하기</span>
            </button>
          </form>
        )}
      </>
    </Modal>
  );
};
