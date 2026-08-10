import React, { useState } from 'react';
import {
  CreditCard,
  Building2,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Wallet,
  ArrowRightLeft,
  Calendar,
  AlertCircle,
  FileText
} from 'lucide-react';
import { BankAccount, PaymentCard } from '../types';
import { formatKRW } from '../utils/calculations';

interface AccountsViewProps {
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  onSaveBankAccount: (acc: Omit<BankAccount, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateBankAccount: (id: string, updates: Partial<BankAccount>) => void;
  onDeleteBankAccount: (id: string) => void;
  onSavePaymentCard: (card: Omit<PaymentCard, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdatePaymentCard: (id: string, updates: Partial<PaymentCard>) => void;
  onDeletePaymentCard: (id: string) => void;
}

const MAJOR_BANKS = [
  'KB국민', '신한', '카카오뱅크', '토스뱅크', 'NH농협',
  'IBK기업', '하나', '우리', '수협', '우체국',
  'SC제일', '대구', '부산', '경남', '기타'
];

const CARD_COMPANIES = [
  '신한카드', '삼성카드', 'KB국민카드', '현대카드', '롯데카드',
  'NH농협카드', 'BC카드', '하나카드', '카카오페이', '토스', '기타'
];

export const AccountsView: React.FC<AccountsViewProps> = ({
  bankAccounts,
  paymentCards,
  onSaveBankAccount,
  onUpdateBankAccount,
  onDeleteBankAccount,
  onSavePaymentCard,
  onUpdatePaymentCard,
  onDeletePaymentCard,
}) => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'cards'>('accounts');

  // Account Modal State
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accBankName, setAccBankName] = useState('KB국민');
  const [accName, setAccName] = useState('');
  const [accNumber, setAccNumber] = useState('');
  const [accHolder, setAccHolder] = useState('');
  const [accBalance, setAccBalance] = useState<number>(0);
  const [accMemo, setAccMemo] = useState('');

  // Card Modal State
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardName, setCardName] = useState('');
  const [cardCompany, setCardCompany] = useState('신한카드');
  const [cardType, setCardType] = useState<'credit' | 'debit'>('credit');
  const [cardLinkedAccountId, setCardLinkedAccountId] = useState<string>('');
  const [cardBillingDay, setCardBillingDay] = useState<number>(25);
  const [cardMemo, setCardMemo] = useState('');

  // Handle Account Form Submit
  const handleOpenAccountModal = (acc?: BankAccount) => {
    if (acc) {
      setEditingAccountId(acc.id);
      setAccBankName(acc.bankName || 'KB국민');
      setAccName(acc.accountName || '');
      setAccNumber(acc.accountNumber || '');
      setAccHolder(acc.accountHolder || '');
      setAccBalance(acc.balance || 0);
      setAccMemo(acc.memo || '');
    } else {
      setEditingAccountId(null);
      setAccBankName('KB국민');
      setAccName('');
      setAccNumber('');
      setAccHolder('');
      setAccBalance(0);
      setAccMemo('');
    }
    setIsAccountModalOpen(true);
  };

  const handleSaveAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim() || !accNumber.trim()) {
      alert('계좌 별칭과 계좌번호를 입력해주세요.');
      return;
    }

    if (editingAccountId) {
      onUpdateBankAccount(editingAccountId, {
        bankName: accBankName,
        accountName: accName,
        accountNumber: accNumber,
        accountHolder: accHolder,
        balance: accBalance,
        memo: accMemo,
      });
    } else {
      onSaveBankAccount({
        bankName: accBankName,
        accountName: accName,
        accountNumber: accNumber,
        accountHolder: accHolder,
        balance: accBalance,
        memo: accMemo,
      });
    }
    setIsAccountModalOpen(false);
  };

  // Handle Card Form Submit
  const handleOpenCardModal = (card?: PaymentCard) => {
    if (card) {
      setEditingCardId(card.id);
      setCardName(card.cardName || '');
      setCardCompany(card.cardCompany || '신한카드');
      setCardType(card.cardType || 'credit');
      setCardLinkedAccountId(card.linkedAccountId || '');
      setCardBillingDay(card.billingDay || 25);
      setCardMemo(card.memo || '');
    } else {
      setEditingCardId(null);
      setCardName('');
      setCardCompany('신한카드');
      setCardType('credit');
      setCardLinkedAccountId(bankAccounts[0]?.id || '');
      setCardBillingDay(25);
      setCardMemo('');
    }
    setIsCardModalOpen(true);
  };

  const handleSaveCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardName.trim()) {
      alert('카드명을 입력해주세요.');
      return;
    }

    if (editingCardId) {
      onUpdatePaymentCard(editingCardId, {
        cardName,
        cardCompany,
        cardType,
        linkedAccountId: cardLinkedAccountId || null,
        billingDay: Number(cardBillingDay) || null,
        memo: cardMemo,
      });
    } else {
      onSavePaymentCard({
        cardName,
        cardCompany,
        cardType,
        linkedAccountId: cardLinkedAccountId || null,
        billingDay: Number(cardBillingDay) || null,
        memo: cardMemo,
      });
    }
    setIsCardModalOpen(false);
  };

  // Total balance sum
  const totalAccountBalance = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-rose-400" />
            계좌 및 카드 관리
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            지출 및 납부 시 사용할 은행 계좌와 신용/체크카드를 통합 관리합니다.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'accounts'
                ? 'bg-rose-500 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wallet className="w-4 h-4" />
            은행 계좌 ({bankAccounts.length})
          </button>
          <button
            onClick={() => setActiveTab('cards')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'cards'
                ? 'bg-rose-500 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            신용/체크카드 ({paymentCards.length})
          </button>
        </div>
      </div>

      {/* ACCOUNTS TAB */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          {/* Top Summary Box */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col xs:flex-row items-center justify-between gap-3">
            <div>
              <span className="text-xs text-slate-400 font-medium">등록된 계좌 총 예치 잔액</span>
              <p className="text-2xl font-bold text-white mt-0.5">{formatKRW(totalAccountBalance)}</p>
            </div>
            <button
              onClick={() => handleOpenAccountModal()}
              className="w-full xs:w-auto flex items-center justify-center gap-1.5 bg-rose-500 hover:bg-rose-600 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              새 계좌 등록
            </button>
          </div>

          {/* List of Accounts */}
          {bankAccounts.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Wallet className="w-6 h-6" />
              </div>
              <p className="text-sm text-slate-300 font-medium">등록된 은행 계좌가 없습니다.</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                급여 통장, 생활비 계좌 등을 등록해 지출 시 선택하거나 카드의 출금 계좌로 연동해 보세요.
              </p>
              <button
                onClick={() => handleOpenAccountModal()}
                className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-rose-400 text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                첫 계좌 등록하기
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {bankAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-all flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-rose-400 font-bold text-xs shrink-0">
                        {acc.bankName.slice(0, 2)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{acc.accountName}</span>
                          <span className="text-[10px] font-semibold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700">
                            {acc.bankName}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 tracking-wide font-mono">
                          {acc.accountNumber} {acc.accountHolder ? `(${acc.accountHolder})` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpenAccountModal(acc)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                        title="수정"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`'${acc.accountName}' 계좌를 삭제하시겠습니까?`)) {
                            onDeleteBankAccount(acc.id);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                        title="삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {acc.memo && (
                    <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 text-xs text-slate-400 flex items-start gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                      <span>{acc.memo}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span className="text-slate-500">잔액</span>
                    <span className="font-bold text-emerald-400 text-sm">{formatKRW(acc.balance || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CARDS TAB */}
      {activeTab === 'cards' && (
        <div className="space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col xs:flex-row items-center justify-between gap-3">
            <div>
              <span className="text-xs text-slate-400 font-medium">등록 카드 수</span>
              <p className="text-xl font-bold text-white mt-0.5">{paymentCards.length} 개</p>
            </div>
            <button
              onClick={() => handleOpenCardModal()}
              className="w-full xs:w-auto flex items-center justify-center gap-1.5 bg-rose-500 hover:bg-rose-600 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              새 카드 등록
            </button>
          </div>

          {paymentCards.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <CreditCard className="w-6 h-6" />
              </div>
              <p className="text-sm text-slate-300 font-medium">등록된 신용/체크카드가 없습니다.</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                자주 사용하는 카드와 출금 연결 계좌를 등록해 납부 및 지출 기록 시 편리하게 관리하세요.
              </p>
              <button
                onClick={() => handleOpenCardModal()}
                className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-rose-400 text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                첫 카드 등록하기
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {paymentCards.map((card) => {
                const linkedAccount = bankAccounts.find((a) => a.id === card.linkedAccountId);

                return (
                  <div
                    key={card.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-all flex flex-col justify-between gap-3 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-md">
                          <CreditCard className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">{card.cardName}</span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                                card.cardType === 'credit'
                                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              }`}
                            >
                              {card.cardType === 'credit' ? '신용' : '체크'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {card.cardCompany} {card.billingDay ? `· 매월 ${card.billingDay}일 결제` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenCardModal(card)}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                          title="수정"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`'${card.cardName}' 카드를 삭제하시겠습니까?`)) {
                              onDeletePaymentCard(card.id);
                            }
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Linked Account info */}
                    <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 text-xs flex items-center justify-between">
                      <span className="text-slate-400 flex items-center gap-1">
                        <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />
                        연결 출금 계좌:
                      </span>
                      {linkedAccount ? (
                        <span className="font-semibold text-slate-200">
                          {linkedAccount.bankName} ({linkedAccount.accountName})
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">미지정</span>
                      )}
                    </div>

                    {card.memo && (
                      <p className="text-xs text-slate-400 px-1">{card.memo}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ACCOUNT MODAL */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 text-slate-100 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Wallet className="w-5 h-5 text-rose-400" />
                {editingAccountId ? '은행 계좌 정보 수정' : '새 은행 계좌 등록'}
              </h3>
              <button
                onClick={() => setIsAccountModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAccountSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">은행 선택</label>
                <select
                  value={accBankName}
                  onChange={(e) => setAccBankName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                >
                  {MAJOR_BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  계좌 별칭 / 이름 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="예: 월급 통장, 주거래 계좌"
                  value={accName}
                  onChange={(e) => setAccName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  계좌번호 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="예: 110-123-456789"
                  value={accNumber}
                  onChange={(e) => setAccNumber(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">예금주</label>
                <input
                  type="text"
                  placeholder="예: 홍길동"
                  value={accHolder}
                  onChange={(e) => setAccHolder(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">현재 잔액 (KRW)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={accBalance || ''}
                  onChange={(e) => setAccBalance(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">비고 / 메모</label>
                <textarea
                  placeholder="특이사항, 자동이체 정보 등 메모"
                  value={accMemo}
                  onChange={(e) => setAccMemo(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl transition-colors font-medium"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="bg-rose-500 hover:bg-rose-600 text-white font-bold px-4 py-2 rounded-xl shadow-lg transition-colors"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CARD MODAL */}
      {isCardModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 text-slate-100 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" />
                {editingCardId ? '카드 정보 수정' : '새 카드 등록'}
              </h3>
              <button
                onClick={() => setIsCardModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCardSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  카드명 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="예: 신한 딥드림 카드, 삼성 iD 카드"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">카드사</label>
                  <select
                    value={cardCompany}
                    onChange={(e) => setCardCompany(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    {CARD_COMPANIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-300 mb-1">카드 종류</label>
                  <select
                    value={cardType}
                    onChange={(e) => setCardType(e.target.value as 'credit' | 'debit')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="credit">신용카드</option>
                    <option value="debit">체크카드</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  출금 계좌 연결 (등록된 계좌에서 선택)
                </label>
                <select
                  value={cardLinkedAccountId}
                  onChange={(e) => setCardLinkedAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- 출금 계좌 미선택 --</option>
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      [{acc.bankName}] {acc.accountName} ({acc.accountNumber})
                    </option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="text-[11px] text-amber-400/90 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    등록된 계좌가 없습니다. 은행 계좌 메뉴에서 먼저 계좌를 등록해 주세요.
                  </p>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">결제일 (매월 몇 일)</label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">매월</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={cardBillingDay || ''}
                    onChange={(e) => setCardBillingDay(Number(e.target.value))}
                    className="w-20 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-slate-400">일</span>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">비고 / 메모</label>
                <textarea
                  placeholder="전월 실적 조건, 혜택 매뉴얼 등"
                  value={cardMemo}
                  onChange={(e) => setCardMemo(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCardModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl transition-colors font-medium"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-xl shadow-lg transition-colors"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
