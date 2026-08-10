import React, { useState } from 'react';
import {
  X,
  Sparkles,
  CheckCircle,
  PenTool,
  Loader2,
  AlertTriangle,
  Send,
  HelpCircle,
  BookmarkPlus,
} from 'lucide-react';
import { Category, Transaction, AIClassifyResult, MerchantRule, BankAccount, PaymentCard, PaymentMethodType } from '../types';
import { formatKRW, getLocalDateString } from '../utils/calculations';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts?: BankAccount[];
  paymentCards?: PaymentCard[];
  onSaveTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onSaveMerchantRule: (pattern: string, categoryId: string) => void;
}

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  isOpen,
  onClose,
  categories,
  merchantRules,
  bankAccounts = [],
  paymentCards = [],
  onSaveTransaction,
  onSaveMerchantRule,
}) => {
  const [activeMode, setActiveMode] = useState<'ai' | 'manual'>('ai');

  // Manual Form State
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState<string>('');
  const [localDate, setLocalDate] = useState<string>(getLocalDateString());
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id || 'delivery_food');
  const [merchant, setMerchant] = useState<string>('');
  const [memo, setMemo] = useState<string>('');
  const [paymentMethodType, setPaymentMethodType] = useState<PaymentMethodType>('card');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedCardId, setSelectedCardId] = useState<string>('');

  // AI Prompt State
  const [aiPromptText, setAiPromptText] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AIClassifyResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Confirmation Drawer Edit States
  const [confirmAmount, setConfirmAmount] = useState<number>(0);
  const [confirmCategoryId, setConfirmCategoryId] = useState<string>('');
  const [confirmMerchant, setConfirmMerchant] = useState<string>('');
  const [confirmType, setConfirmType] = useState<'income' | 'expense'>('expense');
  const [confirmDate, setConfirmDate] = useState<string>(getLocalDateString());
  const [confirmMemo, setConfirmMemo] = useState<string>('');
  const [rememberRule, setRememberRule] = useState<boolean>(true);

  if (!isOpen) return null;

  const handleRunAiClassify = async () => {
    if (!aiPromptText.trim()) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiResult(null);

    try {
      const pin = sessionStorage.getItem('app_access_pin') || '';
      const res = await fetch('/api/ai/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-access-key': pin,
          'x-app-pin': pin,
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

      setAiResult(data);
      setConfirmAmount(data.amount);
      setConfirmCategoryId(data.suggestedCategoryId);
      setConfirmMerchant(data.merchant);
      setConfirmType(data.type);
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

    onSaveTransaction({
      type: confirmType,
      amount: Math.round(confirmAmount),
      occurredAt: `${confirmDate}T12:00:00.000Z`,
      localDate: confirmDate,
      categoryId: confirmCategoryId,
      merchant: confirmMerchant || '기타',
      memo: confirmMemo,
      source: 'ai',
      aiConfidence: aiResult?.confidence || 0.9,
      aiReviewed: true,
    });

    if (rememberRule && confirmMerchant && confirmCategoryId) {
      onSaveMerchantRule(confirmMerchant, confirmCategoryId);
    }

    // Reset & Close
    resetAll();
    onClose();
  };

  const handleSaveManual = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('올바른 금액을 입력하세요.');
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
    setAmount('');
    setMerchant('');
    setMemo('');
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

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveMode('ai')}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              activeMode === 'ai'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>AI 자연어 입력</span>
          </button>

          <button
            onClick={() => setActiveMode('manual')}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              activeMode === 'manual'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-950/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PenTool className="w-4 h-4" />
            <span>직접 수동 입력</span>
          </button>
        </div>

        {/* MODE 1: AI Quick Input */}
        {activeMode === 'ai' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-slate-300 font-semibold block">
                한 문장으로 적으면 AI가 자동 분류합니다.
              </label>

              <div className="relative">
                <input
                  type="text"
                  value={aiPromptText}
                  onChange={e => setAiPromptText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRunAiClassify()}
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
                {examplePrompts.map(prompt => (
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
                      onChange={e => setConfirmType(e.target.value as 'income' | 'expense')}
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
                      onChange={e => setConfirmAmount(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-rose-300 font-extrabold"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">사용처 / 거래처</label>
                    <input
                      type="text"
                      value={confirmMerchant}
                      onChange={e => setConfirmMerchant(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">카테고리</label>
                    <select
                      value={confirmCategoryId}
                      onChange={e => setConfirmCategoryId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white"
                    >
                      {categories.map(c => (
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

                {confirmMerchant && (
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={rememberRule}
                      onChange={e => setRememberRule(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                    />
                    <span>다음에도 '{confirmMerchant}' 사용처를 이 카테고리로 자동 기억하기</span>
                  </label>
                )}

                <button
                  onClick={handleConfirmAiSave}
                  className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30"
                >
                  확인 및 저장
                </button>
              </div>
            )}
          </div>
        )}

        {/* MODE 2: Manual Input */}
        {activeMode === 'manual' && (
          <form onSubmit={handleSaveManual} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1">유형</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value as 'income' | 'expense')}
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
                  onChange={e => setLocalDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">금액 (KRW 정수)</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="예: 24900"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-base font-extrabold text-rose-400 placeholder-slate-600"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">카테고리</label>
              <select
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
              >
                {categories
                  .filter(c => c.type === type)
                  .map(c => (
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
                onChange={e => setMerchant(e.target.value)}
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
                onChange={e => setMemo(e.target.value)}
                placeholder="예: 저녁 보쌈 배달"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-rose-950/30"
            >
              거래 저장하기
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
