import React, { useEffect, useState } from 'react';
import { ImageOff, Loader2, ReceiptText, X } from 'lucide-react';
import { ReceiptRecord } from '../types';
import { formatKRW } from '../utils/calculations';
import { loadReceiptImage } from '../utils/receiptStorage';
import { Modal } from './ui/Modal';

interface ReceiptDetailsModalProps {
  receipt: ReceiptRecord;
  merchant: string;
  onClose: () => void;
}

export const ReceiptDetailsModal: React.FC<ReceiptDetailsModalProps> = ({ receipt, merchant, onClose }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedUrl: string | null = null;
    if (receipt.storagePath) {
      loadReceiptImage(receipt.storagePath).then(url => {
        loadedUrl = url;
        if (!cancelled) setImageUrl(url);
      }).catch(() => {
        if (!cancelled) setImageError('저장된 원본 이미지를 불러오지 못했습니다. Storage rules와 파일 상태를 확인해 주세요.');
      });
    }
    return () => {
      cancelled = true;
      if (loadedUrl) URL.revokeObjectURL(loadedUrl);
    };
  }, [receipt.storagePath]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      labelledById="receipt-modal-title"
      backdropClassName="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/90 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      panelClassName="max-h-[94vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 sm:rounded-2xl"
    >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 id="receipt-modal-title" className="font-bold text-white">{merchant} 영수증</h3>
            <p className="text-xs text-slate-400">OCR 결과와 원본 보관 정보</p>
          </div>
          <button
            onClick={onClose}
            aria-label="영수증 창 닫기"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {receipt.storagePath ? (
          imageUrl ? <img src={imageUrl} alt={`${merchant} 영수증 원본`} className="max-h-[50vh] w-full rounded-xl bg-white object-contain" />
            : imageError ? <div role="alert" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"><ImageOff className="h-4 w-4 shrink-0" />{imageError}</div>
              : <div role="status" aria-label="영수증 원본 불러오는 중" className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-rose-400" /></div>
        ) : <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300"><ImageOff className="h-4 w-4" />원본을 저장하지 않고 OCR 정보만 보관한 거래입니다.</div>}

        <dl className="grid grid-cols-2 gap-2 text-xs">
          {receipt.receiptNumber && <div className="rounded-lg bg-slate-950 p-2"><dt className="block text-slate-400">영수증 번호</dt><dd className="text-slate-200">{receipt.receiptNumber}</dd></div>}
          {receipt.businessNumber && <div className="rounded-lg bg-slate-950 p-2"><dt className="block text-slate-400">사업자번호</dt><dd className="text-slate-200">{receipt.businessNumber}</dd></div>}
          {receipt.paymentMethodText && <div className="rounded-lg bg-slate-950 p-2"><dt className="block text-slate-400">결제 표시</dt><dd className="text-slate-200">{receipt.paymentMethodText}{receipt.cardLast4 ? ` · ${receipt.cardLast4}` : ''}</dd></div>}
          {receipt.tax != null && <div className="rounded-lg bg-slate-950 p-2"><dt className="block text-slate-400">세금</dt><dd className="text-slate-200">{formatKRW(receipt.tax)}</dd></div>}
        </dl>

        {receipt.lineItems.length > 0 && <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs"><h4 className="mb-2 flex items-center gap-2 font-bold text-slate-200"><ReceiptText className="h-4 w-4" />구매 항목 {receipt.lineItems.length}개</h4><div className="space-y-2">{receipt.lineItems.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-3 text-slate-300"><span>{item.name}{item.quantity ? ` × ${item.quantity}` : ''}</span><span className="shrink-0">{formatKRW(item.amount)}</span></div>)}</div></div>}

        {receipt.rawText && <details className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs"><summary className="cursor-pointer font-bold text-slate-300">OCR 원문 보기</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans leading-relaxed text-slate-400">{receipt.rawText}</pre></details>}
        <p className="text-xs text-slate-400">인식 신뢰도 {Math.round(receipt.ocrConfidence * 100)}% · {new Date(receipt.scannedAt).toLocaleString('ko-KR')}</p>
    </Modal>
  );
};
