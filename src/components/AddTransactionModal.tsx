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
} from 'lucide-react';
import {
  Category,
  Transaction,
  AIClassifyResult,
  VoiceAnalysisResult,
  MerchantRule,
  BankAccount,
  PaymentCard,
  PaymentMethodType,
} from '../types';
import { formatKRW, getLocalDateString } from '../utils/calculations';
import { authenticatedFetch } from '../utils/auth';
import { normalizeTags } from '../utils/receipt';
import { ReceiptCapturePanel } from './ReceiptCapturePanel';
import { VoiceInputPanel } from './VoiceInputPanel';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts?: BankAccount[];
  paymentCards?: PaymentCard[];
  aiClassificationEnabled?: boolean;
  onSaveTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  onSaveMerchantRule: (pattern: string, categoryId: string) => void;
}

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  isOpen,
  onClose,
  categories,
  merchantRules,
  bankAccounts = [],
  paymentCards = [],
  aiClassificationEnabled = true,
  onSaveTransaction,
  onSaveMerchantRule,
}) => {
  const [activeMode, setActiveMode] = useState<'receipt' | 'voice' | 'ai' | 'manual'>('receipt');

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
  const [rememberRule, setRememberRule] = useState<boolean>(true);

  useEffect(() => {
    if (!aiClassificationEnabled) setActiveMode('manual');
  }, [aiClassificationEnabled]);

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
    } catch (err: any) {
      console.error(err);
      setAiError('AI 분석 중 오류가 발생했습니다. 아래 수동 입력을 이용해주세요.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleConfirmAiSave = () => {
    if (confirmAmount <= 0) {
      alert('1원 이상의 정수 금액을 입력해주세요.');
      return;
    }
    const selectedCategory = categories.find((category) => category.id === confirmCategoryId);
    if (!selectedCategory || selectedCategory.type !== confirmType) {
      alert(`${confirmType === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }

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
  };

  const handleConfirmVoiceSave = () => {
    if (confirmAmount <= 0) {
      alert('1원 이상의 정수 금액을 입력해주세요.');
      return;
    }
    const selectedCategory = categories.find((c) => c.id === confirmCategoryId);
    if (!selectedCategory || selectedCategory.type !== confirmType) {
      alert(`${confirmType === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }

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
    setVoiceResult(null);
    setActiveMode('manual');
  };

  const handleSaveManual = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('올바른 금액을 입력하세요.');
      return;
    }
    const selectedCategory = categories.find((category) => category.id === categoryId);
    if (!selectedCategory || selectedCategory.type !== type) {
      alert(`${type === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }

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
    });

    resetAll();
    onClose();
  };

  const resetAll = () => {
    setAiPromptText('');
    setAiResult(null);
    setVoiceResult(null);
    setVoiceDurationMs(0);
    setConfirmTranscript('');
    setAmount('');
    setMerchant('');
    setMemo('');
    setTagsText('');
  };

  const examplePrompts = [
    '배민 저녁 24,900원',
    '아이 학원비 180000 오늘',
    '월급 3,500,000원 들어옴',
    '어제 카카오택시 13,500',
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">거래 추가</h2>
            <span className="text-[10px] text-rose-400 font-semibold bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 rounded-full">
              10초 간편 입력
            </span>
          </div>

          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher - 2x2 Grid on Mobile for 4 modes */}
        <div
          className={`grid ${
            aiClassificationEnabled ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'
          } gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800`}
        >
          {aiClassificationEnabled && (
            <button
              onClick={() => {
                setActiveMode('receipt');
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

          {aiClassificationEnabled && (
            <button
              onClick={() => {
                setActiveMode('voice');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                activeMode === 'voice'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mic className="w-4 h-4 shrink-0 text-purple-300" />
              <span>음성 입력</span>
            </button>
          )}

          {aiClassificationEnabled && (
            <button
              onClick={() => {
                setActiveMode('ai');
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

          <button
            onClick={() => {
              setActiveMode('manual');
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
              <VoiceInputPanel
                categories={categories}
                merchantRules={merchantRules}
                bankAccounts={bankAccounts}
                paymentCards={paymentCards}
                onAnalysisComplete={handleVoiceAnalysisComplete}
              />
            ) : (
              /* Voice Confirmation Drawer / Panel */
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3.5 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 text-purple-300 font-bold">
                    <Mic className="w-4 h-4" />
                    <span>음성 분석 결과 확인</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30 font-semibold">
                      신뢰도 {Math.round(voiceResult.confidence * 100)}%
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${
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
                    <span className="text-[10px] text-slate-500">{(voiceDurationMs / 1000).toFixed(1)}초 녹음</span>
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
                    <label className="text-slate-400 block mb-1">금액 (KRW)</label>
                    <input
                      type="number"
                      value={confirmAmount}
                      onChange={(e) => setConfirmAmount(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-rose-300 font-extrabold"
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
                        confirmPaymentMethodType === 'cash'
                          ? 'bg-slate-800 border-slate-600 text-slate-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      현금/기타
                    </button>
                  </div>

                  {confirmPaymentMethodType === 'card' && paymentCards.length > 0 && (
                    <select
                      value={confirmCardId}
                      onChange={(e) => setConfirmCardId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    >
                      <option value="">-- 카드 선택 --</option>
                      {paymentCards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.cardName} ({c.cardCompany})
                        </option>
                      ))}
                    </select>
                  )}

                  {confirmPaymentMethodType === 'account' && bankAccounts.length > 0 && (
                    <select
                      value={confirmAccountId}
                      onChange={(e) => setConfirmAccountId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    >
                      <option value="">-- 계좌 선택 --</option>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          [{a.bankName}] {a.accountName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 bg-slate-900 p-2.5 rounded-lg border border-slate-800/80">
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

                <button
                  onClick={handleConfirmVoiceSave}
                  className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30 flex items-center justify-center gap-2 text-sm"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white p-2 rounded-lg transition-colors"
                >
                  {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>

              {/* Preset example buttons */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-slate-500">추천 예시:</span>
                {examplePrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setAiPromptText(prompt)}
                    className="text-[11px] bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 px-2.5 py-1 rounded-md transition-colors"
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

                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
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
                    <label className="text-slate-400 block mb-1">금액 (KRW)</label>
                    <input
                      type="number"
                      value={confirmAmount}
                      onChange={(e) => setConfirmAmount(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-rose-300 font-extrabold"
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

                <div className="text-[11px] text-slate-400 bg-slate-900 p-2.5 rounded-lg border border-slate-800/80">
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

                <button
                  onClick={handleConfirmAiSave}
                  className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30 flex items-center justify-center gap-2 text-sm"
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
              <label className="text-slate-400 block mb-1">금액 (KRW 정수)</label>
              <input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="예: 24900"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-base font-extrabold text-rose-400 placeholder-slate-600"
                required
              />
              {Number(amount) > 0 && <p className="text-[11px] text-slate-500 mt-1">{formatKRW(Number(amount))}</p>}
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

              {paymentMethodType === 'card' && paymentCards.length > 0 && (
                <select
                  value={selectedCardId}
                  onChange={(e) => setSelectedCardId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                >
                  <option value="">-- 카드 선택 --</option>
                  {paymentCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.cardName} ({c.cardCompany})
                    </option>
                  ))}
                </select>
              )}

              {paymentMethodType === 'account' && bankAccounts.length > 0 && (
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                >
                  <option value="">-- 계좌 선택 --</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.bankName}] {a.accountName} ({a.accountNumber})
                    </option>
                  ))}
                </select>
              )}
            </div>

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

            <button
              type="submit"
              className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30 flex items-center justify-center gap-2 text-sm"
            >
              <CheckCircle className="w-4 h-4" />
              <span>거래 저장하기</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
