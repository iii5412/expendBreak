import React, { useEffect, useState } from 'react';
import { Camera, CheckCircle2, FileImage, Loader2, Plus, ReceiptText, ShieldCheck, Trash2, Upload } from 'lucide-react';
import {
  AIReceiptResult,
  BankAccount,
  Category,
  MerchantRule,
  PaymentCard,
  PaymentMethodType,
  Transaction,
} from '../types';
import { authenticatedFetch } from '../utils/auth';
import { formatKRW, getCurrentYearMonth, getLocalDateString } from '../utils/calculations';
import { blobToBase64, normalizeTags, prepareReceiptImage, PreparedReceiptImage } from '../utils/receipt';
import { deleteReceiptImage, uploadReceiptImage } from '../utils/receiptStorage';
import { normalizeInstallmentPlan } from '../utils/installments';

interface ReceiptCapturePanelProps {
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  monthStartDay: number;
  onSaveTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  onSaveMerchantRule: (pattern: string, categoryId: string) => void;
  onDone: () => void;
}

export const ReceiptCapturePanel: React.FC<ReceiptCapturePanelProps> = ({
  categories,
  merchantRules,
  bankAccounts,
  paymentCards,
  monthStartDay,
  onSaveTransaction,
  onSaveMerchantRule,
  onDone,
}) => {
  const [prepared, setPrepared] = useState<PreparedReceiptImage | null>(null);
  const [result, setResult] = useState<AIReceiptResult | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(getLocalDateString());
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [memo, setMemo] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [paymentMethodType, setPaymentMethodType] = useState<PaymentMethodType>('card');
  const [accountId, setAccountId] = useState('');
  const [cardId, setCardId] = useState('');
  const [installmentMonths, setInstallmentMonths] = useState(1);
  const [installmentCurrentRound, setInstallmentCurrentRound] = useState(1);
  const [saveOriginal, setSaveOriginal] = useState(true);
  const [rememberRule, setRememberRule] = useState(true);

  useEffect(() => () => {
    if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
  }, [prepared]);

  useEffect(() => {
    setCardId(current => paymentCards.some(card => card.id === current) ? current : paymentCards[0]?.id || '');
  }, [paymentCards]);

  const defaultExpenseCategory = () => categories.find(category => category.id === 'etc_expense')?.id
    || categories.find(category => category.type === 'expense' && category.active)?.id
    || '';

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const next = await prepareReceiptImage(file);
      setPrepared(next);
    } catch (nextError) {
      setPrepared(null);
      setError(nextError instanceof Error ? nextError.message : '영수증 이미지를 읽지 못했습니다.');
    }
  };

  const handleReadReceipt = async () => {
    if (!prepared) return;
    setIsReading(true);
    setError(null);
    try {
      const imageBase64 = await blobToBase64(prepared.blob);
      const response = await authenticatedFetch('/api/ai/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType: prepared.mimeType,
          categories,
          defaultDate: getLocalDateString(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || '영수증 OCR 요청에 실패했습니다.');

      const receiptResult = data as AIReceiptResult;
      const suggested = categories.find(category => category.id === receiptResult.suggestedCategoryId);
      const matchedRule = merchantRules.find(rule =>
        rule.pattern
        && receiptResult.merchant?.toLowerCase().includes(rule.pattern.toLowerCase())
        && categories.find(category => category.id === rule.categoryId)?.type === 'expense',
      );
      const safeCategoryId = matchedRule?.categoryId || (suggested?.type === 'expense' ? suggested.id : defaultExpenseCategory());
      setResult({ ...receiptResult, suggestedCategoryId: safeCategoryId, needsConfirmation: true });
      setAmount(receiptResult.amount || 0);
      setDate(receiptResult.date || getLocalDateString());
      setMerchant(receiptResult.merchant || '사용처 미확인');
      setCategoryId(safeCategoryId);
      setMemo(receiptResult.memo || '영수증 촬영 등록');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '영수증을 읽는 중 오류가 발생했습니다.');
    } finally {
      setIsReading(false);
    }
  };

  const handleSave = async () => {
    if (!prepared || !result) return;
    const category = categories.find(item => item.id === categoryId);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('영수증 총액을 1원 이상으로 확인해 주세요.');
      return;
    }
    if (!category || category.type !== 'expense') {
      setError('지출 카테고리를 선택해 주세요.');
      return;
    }

    setIsSaving(true);
    setError(null);
    const receiptId = `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let storagePath: string | null = null;
    try {
      if (saveOriginal) {
        try {
          storagePath = await uploadReceiptImage(receiptId, prepared.blob);
        } catch (storageErr) {
          console.warn('Receipt image upload failed or timed out, continuing transaction save without image:', storageErr);
          storagePath = null;
        }
      }

      onSaveTransaction({
        type: 'expense',
        amount: Math.round(amount),
        occurredAt: `${date}T12:00:00.000Z`,
        localDate: date,
        categoryId,
        merchant: merchant.trim() || '사용처 미확인',
        memo: memo.trim(),
        source: 'receipt',
        aiConfidence: result.confidence,
        aiReviewed: true,
        paymentMethodType,
        accountId: paymentMethodType === 'account' ? accountId || null : null,
        cardId: paymentMethodType === 'card' ? cardId || null : null,
        installment: paymentMethodType === 'card'
          ? normalizeInstallmentPlan(installmentMonths, installmentCurrentRound, getCurrentYearMonth(monthStartDay))
          : null,
        tags: normalizeTags(tagsText),
        receipt: {
          id: receiptId,
          storagePath,
          mimeType: saveOriginal && storagePath ? prepared.mimeType : null,
          imageSize: saveOriginal && storagePath ? prepared.blob.size : null,
          receiptNumber: result.receiptNumber || null,
          businessNumber: result.businessNumber || null,
          purchasedTime: result.purchasedTime || null,
          subtotal: result.subtotal || null,
          tax: result.tax || null,
          paymentMethodText: result.paymentMethodText || null,
          cardLast4: result.cardLast4 || null,
          lineItems: (result.lineItems || []).filter(item => item.name.trim()).map(item => ({ ...item, name: item.name.trim(), amount: Math.max(0, Math.round(item.amount)) })),
          rawText: result.rawText || null,
          ocrConfidence: result.confidence,
          scannedAt: new Date().toISOString(),
        },
      });

      if (rememberRule && merchant.trim()) {
        try {
          onSaveMerchantRule(merchant.trim(), categoryId);
        } catch (ruleErr) {
          console.warn('Failed to save merchant rule:', ruleErr);
        }
      }

      onDone();
    } catch (nextError) {
      if (storagePath) await deleteReceiptImage(storagePath).catch(() => undefined);
      setError(nextError instanceof Error ? nextError.message : '영수증 거래 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-indigo-100">
        <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4" /> 영수증은 자동 저장되지 않습니다.</div>
        <p className="mt-1 text-xs text-indigo-200/80">사진은 OCR을 위해 Gemini로 전송되며, 결과를 직접 확인한 뒤 저장합니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 py-3 font-bold text-rose-200">
          <Camera className="h-4 w-4" /> 바로 촬영
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={event => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 py-3 font-bold text-slate-200">
          <FileImage className="h-4 w-4" /> 사진 선택
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
      </div>

      {prepared && (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <img src={prepared.previewUrl} alt="선택한 영수증" className="max-h-64 w-full rounded-xl bg-white object-contain" />
          {!result && (
            <button type="button" disabled={isReading} onClick={handleReadReceipt} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 py-3 font-bold text-white disabled:opacity-50">
              {isReading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
              {isReading ? '글자와 결제 정보를 읽는 중...' : '영수증 읽기'}
            </button>
          )}
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200">{error}</div>}

      {result && (
        <div className="space-y-3 rounded-2xl border border-emerald-500/30 bg-slate-950 p-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="flex items-center gap-2 font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" /> OCR 결과 확인</span>
            <span className="text-xs text-slate-400">신뢰도 {Math.round(result.confidence * 100)}%</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-slate-400">결제일
              <input type="date" value={date} onChange={event => setDate(event.target.value)} className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white" />
            </label>
            <label className="space-y-1 text-slate-400">총액
              <input type="number" inputMode="numeric" value={amount} onChange={event => setAmount(Number(event.target.value))} className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 font-bold text-rose-300" />
            </label>
          </div>
          {amount > 0 && <p className="-mt-2 text-right text-xs text-slate-400">{formatKRW(amount)}</p>}

          <label className="block space-y-1 text-slate-400">사용처
            <input value={merchant} onChange={event => setMerchant(event.target.value)} className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white" />
          </label>
          <label className="block space-y-1 text-slate-400">카테고리
            <select value={categoryId} onChange={event => setCategoryId(event.target.value)} className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white">
              {categories.filter(category => category.type === 'expense' && category.active).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-slate-400">결제 수단</span>
            <div className="grid grid-cols-3 gap-2">
              {(['card', 'account', 'cash'] as PaymentMethodType[]).map(method => (
                <button type="button" key={method} onClick={() => setPaymentMethodType(method)} className={`rounded-lg border p-2 font-semibold ${paymentMethodType === method ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200' : 'border-slate-800 text-slate-400'}`}>
                  {method === 'card' ? '카드' : method === 'account' ? '계좌' : '현금/기타'}
                </button>
              ))}
            </div>
            {paymentMethodType === 'card' && <select value={cardId} onChange={event => setCardId(event.target.value)} disabled={paymentCards.length === 0} className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white disabled:text-slate-500"><option value="">{paymentCards.length > 0 ? '카드 선택' : '등록된 카드 없음'}</option>{paymentCards.map(card => <option key={card.id} value={card.id}>{card.cardName} ({card.cardCompany})</option>)}</select>}
            {paymentMethodType === 'account' && <select value={accountId} onChange={event => setAccountId(event.target.value)} disabled={bankAccounts.length === 0} className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white disabled:text-slate-500"><option value="">{bankAccounts.length > 0 ? '계좌 선택' : '등록된 계좌 없음'}</option>{bankAccounts.map(account => <option key={account.id} value={account.id}>[{account.bankName}] {account.accountName}</option>)}</select>}
          </div>

          {paymentMethodType === 'card' && (
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
              <span className="mb-2 block font-bold text-indigo-200">할부 정보</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-slate-400">할부 개월<input type="number" min="1" max="60" value={installmentMonths} onChange={event => { const months = Math.min(60, Math.max(1, Number(event.target.value) || 1)); setInstallmentMonths(months); setInstallmentCurrentRound(current => Math.min(months, current)); }} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-white" /></label>
                <label className="text-slate-400">이번 달 회차<input type="number" min="1" max={installmentMonths} disabled={installmentMonths <= 1} value={installmentCurrentRound} onChange={event => setInstallmentCurrentRound(Math.min(installmentMonths, Math.max(1, Number(event.target.value) || 1)))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-white disabled:opacity-50" /></label>
              </div>
            </div>
          )}

          <label className="block space-y-1 text-slate-400">메모
            <input value={memo} onChange={event => setMemo(event.target.value)} className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white" />
          </label>
          <label className="block space-y-1 text-slate-400">생활 태그
            <input value={tagsText} onChange={event => setTagsText(event.target.value)} placeholder="예: 가족, 여행, 병원 (쉼표로 구분)" className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-white" />
          </label>

          <details open={result.lineItems.length > 0} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <summary className="cursor-pointer font-bold text-slate-200">구매 항목 {result.lineItems.length}개</summary>
            <div className="mt-3 space-y-2">
              {result.lineItems.map((item, index) => (
                <div key={index} className="grid grid-cols-[1fr_7rem_2rem] gap-2">
                  <input
                    value={item.name}
                    aria-label={`구매 항목 ${index + 1} 이름`}
                    onChange={event => setResult({ ...result, lineItems: result.lineItems.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, name: event.target.value.slice(0, 120) } : candidate) })}
                    className="min-w-0 rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={item.amount}
                    aria-label={`구매 항목 ${index + 1} 금액`}
                    onChange={event => setResult({ ...result, lineItems: result.lineItems.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, amount: Math.max(0, Math.round(Number(event.target.value) || 0)) } : candidate) })}
                    className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-right text-slate-200"
                  />
                  <button type="button" aria-label={`구매 항목 ${index + 1} 삭제`} onClick={() => setResult({ ...result, lineItems: result.lineItems.filter((_, itemIndex) => itemIndex !== index) })} className="text-slate-400 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {result.lineItems.length < 50 && <button type="button" onClick={() => setResult({ ...result, lineItems: [...result.lineItems, { name: '', amount: 0 }] })} className="flex items-center gap-1 text-xs font-bold text-indigo-300"><Plus className="h-3.5 w-3.5" />품목 추가</button>}
              {result.lineItems.some(item => item.amount > 0) && (
                <button type="button" onClick={() => setAmount(result.lineItems.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0))} className="text-xs font-bold text-emerald-300">
                  품목 합계 {formatKRW(result.lineItems.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0))}를 총액으로 적용
                </button>
              )}
            </div>
          </details>

          <label className="flex items-start gap-2 text-slate-300"><input type="checkbox" checked={saveOriginal} onChange={event => setSaveOriginal(event.target.checked)} className="mt-0.5" /><span>영수증 원본도 내 전용 Storage에 보관</span></label>
          <label className="flex items-start gap-2 text-slate-300"><input type="checkbox" checked={rememberRule} onChange={event => setRememberRule(event.target.checked)} className="mt-0.5" /><span>다음에도 이 사용처를 같은 카테고리로 기억</span></label>

          <button type="button" disabled={isSaving} onClick={handleSave} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 py-3 font-bold text-white disabled:opacity-50">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isSaving ? '영수증과 지출을 저장하는 중...' : '확인한 내용으로 지출 저장'}
          </button>
        </div>
      )}

      {!prepared && <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400"><Camera className="mx-auto mb-2 h-8 w-8" /><p>구겨진 영수증은 펴고, 그림자가 적게 촬영하면 인식률이 좋아집니다.</p></div>}
    </div>
  );
};
