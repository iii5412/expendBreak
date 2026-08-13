import React, { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Building2,
  Plus,
  Trash2,
  Edit2,
  X,
  Wallet,
  ArrowRightLeft,
  Calendar,
  AlertCircle,
  FileText,
  Copy
} from 'lucide-react';
import { BankAccount, PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { formatKRW } from '../utils/calculations';
import { findCardIssuerPreset } from '../data/cardIssuerPresets';
import { calculateMonthlyCardSettlementSummary, MonthlyCardSettlementSummary } from '../utils/cardPayments';
import { useConfirm, useToast } from './ui/FeedbackProvider';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';
import { formatAmountInput, parseAmountInput } from '../utils/amount';

interface AccountsViewProps {
  currentYM: string;
  monthStartDay: number;
  transactions: Transaction[];
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  cardSettlementSummary: MonthlyCardSettlementSummary;
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
  currentYM,
  monthStartDay,
  transactions,
  recurringOccurrences,
  recurringTemplates,
  bankAccounts,
  paymentCards,
  cardSettlementSummary,
  onSaveBankAccount,
  onUpdateBankAccount,
  onDeleteBankAccount,
  onSavePaymentCard,
  onUpdatePaymentCard,
  onDeletePaymentCard,
}) => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<'accounts' | 'cards'>('accounts');

  // Account Modal State
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accBankName, setAccBankName] = useState('KB국민');
  const [accName, setAccName] = useState('');
  const [accNumber, setAccNumber] = useState('');
  const [accHolder, setAccHolder] = useState('');
  const [accBalance, setAccBalance] = useState<number>(0);
  const [accBalanceAsOf, setAccBalanceAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [accMemo, setAccMemo] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);

  // Card Modal State
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardName, setCardName] = useState('');
  const [cardCompany, setCardCompany] = useState('신한카드');
  const [cardType, setCardType] = useState<'credit' | 'debit'>('credit');
  const [cardLinkedAccountId, setCardLinkedAccountId] = useState<string>('');
  const [cardBillingDay, setCardBillingDay] = useState<number>(25);
  const [cardStatementClosingDay, setCardStatementClosingDay] = useState<number | null>(null);
  const [cardMemo, setCardMemo] = useState('');
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardPaymentMonth, setCardPaymentMonth] = useState(currentYM);
  const [monthlyAmountDrafts, setMonthlyAmountDrafts] = useState<Record<string, string>>({});

  // Handle Account Form Submit
  const handleOpenAccountModal = (acc?: BankAccount) => {
    if (acc) {
      setEditingAccountId(acc.id);
      setAccBankName(acc.bankName || 'KB국민');
      setAccName(acc.accountName || '');
      setAccNumber(acc.accountNumber || '');
      setAccHolder(acc.accountHolder || '');
      setAccBalance(acc.balance || 0);
      setAccBalanceAsOf(acc.balanceAsOf || new Date().toISOString().slice(0, 10));
      setAccMemo(acc.memo || '');
    } else {
      setEditingAccountId(null);
      setAccBankName('KB국민');
      setAccName('');
      setAccNumber('');
      setAccHolder('');
      setAccBalance(0);
      setAccBalanceAsOf(new Date().toISOString().slice(0, 10));
      setAccMemo('');
    }
    setIsAccountModalOpen(true);
  };

  const handleSaveAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) {
      setAccountError('계좌 별칭을 입력해 주세요.');
      document.getElementById('account-name-input')?.focus();
      return;
    }
    if (!accNumber.trim()) {
      setAccountError('계좌번호를 입력해 주세요.');
      document.getElementById('account-number-input')?.focus();
      return;
    }
    setAccountError(null);

    if (editingAccountId) {
      const previous = bankAccounts.find(account => account.id === editingAccountId);
      onUpdateBankAccount(editingAccountId, {
        bankName: accBankName,
        accountName: accName,
        accountNumber: accNumber,
        accountHolder: accHolder,
        balance: accBalance,
        balanceAsOf: accBalanceAsOf,
        memo: accMemo,
      });
      if (previous && previous.balance !== accBalance) {
        showToast({
          message: '잔액을 수정했습니다.',
          description: `${previous.accountName}: ${formatKRW(previous.balance)} → ${formatKRW(accBalance)}`,
          tone: 'success',
          action: {
            label: '실행 취소',
            onAction: () => onUpdateBankAccount(previous.id, {
              balance: previous.balance,
              balanceAsOf: previous.balanceAsOf,
            }),
          },
        });
      } else {
        showToast({ message: '계좌 정보를 저장했습니다.', tone: 'success' });
      }
    } else {
      onSaveBankAccount({
        bankName: accBankName,
        accountName: accName,
        accountNumber: accNumber,
        accountHolder: accHolder,
        balance: accBalance,
        balanceAsOf: accBalanceAsOf,
        memo: accMemo,
      });
      showToast({ message: `'${accName}' 계좌를 추가했습니다.`, tone: 'success' });
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
      setCardStatementClosingDay(card.statementClosingDay ?? null);
      setCardMemo(card.memo || '');
    } else {
      setEditingCardId(null);
      setCardName('');
      setCardCompany('신한카드');
      setCardType('credit');
      setCardLinkedAccountId(bankAccounts[0]?.id || '');
      setCardBillingDay(25);
      setCardStatementClosingDay(findCardIssuerPreset('신한카드', 25)?.statementClosingDay ?? null);
      setCardMemo('');
    }
    setIsCardModalOpen(true);
  };

  const handleSaveCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardName.trim()) {
      setCardError('카드명을 입력해 주세요.');
      document.getElementById('card-name-input')?.focus();
      return;
    }
    setCardError(null);

    if (editingCardId) {
      onUpdatePaymentCard(editingCardId, {
        cardName,
        cardCompany,
        cardType,
        linkedAccountId: cardLinkedAccountId || null,
        billingDay: Number(cardBillingDay) || null,
        statementClosingDay: cardStatementClosingDay,
        memo: cardMemo,
      });
    } else {
      onSavePaymentCard({
        cardName,
        cardCompany,
        cardType,
        linkedAccountId: cardLinkedAccountId || null,
        billingDay: Number(cardBillingDay) || null,
        statementClosingDay: cardStatementClosingDay,
        memo: cardMemo,
      });
    }
    showToast({
      message: editingCardId ? '카드 정보를 저장했습니다.' : `'${cardName}' 카드를 추가했습니다.`,
      tone: 'success',
    });
    setIsCardModalOpen(false);
  };

  // Total balance sum
  const totalAccountBalance = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const selectedMonthSettlement = useMemo(
    () => cardPaymentMonth === currentYM
      ? cardSettlementSummary
      : calculateMonthlyCardSettlementSummary(
        cardPaymentMonth,
        transactions,
        paymentCards,
        monthStartDay,
        recurringOccurrences,
        recurringTemplates,
      ),
    [cardPaymentMonth, currentYM, cardSettlementSummary, transactions, paymentCards, monthStartDay, recurringOccurrences, recurringTemplates],
  );

  // Follow the app-wide period selector; the card month can still be changed here.
  useEffect(() => {
    setCardPaymentMonth(currentYM);
  }, [currentYM]);

  useEffect(() => {
    setMonthlyAmountDrafts(Object.fromEntries(selectedMonthSettlement.cards.map(card => [card.cardId, String(card.amount)])));
  }, [selectedMonthSettlement]);

  const settlementAmountByAccount = useMemo(() => {
    const amounts = new Map<string, number>();
    selectedMonthSettlement.cards.forEach(card => {
      if (!card.linkedAccountId) return;
      amounts.set(card.linkedAccountId, (amounts.get(card.linkedAccountId) || 0) + card.amount);
    });
    return amounts;
  }, [selectedMonthSettlement]);

  const saveMonthlyCardAmount = (card: PaymentCard) => {
    const amount = Math.round(Number(monthlyAmountDrafts[card.id]));
    if (!Number.isFinite(amount) || amount < 0) {
      showToast({
        message: '월 카드 결제금액을 확인해 주세요.',
        description: '0원 이상의 숫자만 입력할 수 있습니다.',
        tone: 'error',
      });
      return;
    }
    onUpdatePaymentCard(card.id, {
      monthlyPaymentAmounts: {
        ...(card.monthlyPaymentAmounts || {}),
        [cardPaymentMonth]: amount,
      },
    });
    showToast({
      message: `${card.cardName} ${cardPaymentMonth} 결제금액을 저장했습니다.`,
      description: formatKRW(amount),
      tone: 'success',
    });
  };

  const useEstimatedMonthlyCardAmount = (card: PaymentCard) => {
    const monthlyPaymentAmounts = { ...(card.monthlyPaymentAmounts || {}) };
    delete monthlyPaymentAmounts[cardPaymentMonth];
    onUpdatePaymentCard(card.id, { monthlyPaymentAmounts });
  };

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ message, tone: 'success', durationMs: 2200 });
    } catch {
      // Clipboard access can be blocked; show the value so it can be copied by hand.
      showToast({
        message: '자동 복사를 사용할 수 없습니다.',
        description: `아래 내용을 길게 눌러 직접 복사해 주세요: ${text}`,
        tone: 'warning',
        durationMs: 12000,
      });
    }
  };

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

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 sm:grid-cols-3">
        <label className="text-xs text-slate-400">
          <span className="mb-1 block font-medium">카드대금 관리 월</span>
          <input
            type="month"
            value={cardPaymentMonth}
            onChange={event => setCardPaymentMonth(event.target.value || currentYM)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-bold text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-xs text-slate-400">연결 계좌 고정 출금</div>
          <div className="mt-1 text-base font-bold text-rose-300">{formatKRW(selectedMonthSettlement.linkedAccountTotal)}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-xs text-slate-400">출금 계좌 미연결</div>
          <div className={`mt-1 text-base font-bold ${selectedMonthSettlement.unlinkedAmount > 0 ? 'text-amber-300' : 'text-slate-300'}`}>
            {formatKRW(selectedMonthSettlement.unlinkedAmount)}
          </div>
        </div>
      </div>

      {/* ACCOUNTS TAB */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          {/* Top Summary Box */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col xs:flex-row items-center justify-between gap-3">
            <div>
              <span className="text-xs text-slate-400 font-medium">직접 입력 잔액 합계</span>
              <p className="text-2xl font-bold text-white mt-0.5">{formatKRW(totalAccountBalance)}</p>
            </div>
            <button
              onClick={() => handleOpenAccountModal()}
              className="w-full xs:w-auto flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              새 계좌 등록
            </button>
          </div>

          {/* List of Accounts */}
          {bankAccounts.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                <Wallet className="w-6 h-6" />
              </div>
              <p className="text-sm text-slate-300 font-medium">등록된 은행 계좌가 없습니다.</p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
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
                          <span className="text-xs font-semibold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700">
                            {acc.bankName}
                          </span>
                        </div>
                        <button
                          onClick={() => copyText(acc.accountNumber, `${acc.bankName} ${acc.accountName} 계좌번호를 복사했습니다.`)}
                          className="text-xs text-slate-300 hover:text-emerald-300 mt-0.5 tracking-wide font-mono flex items-center gap-1.5 text-left transition-colors"
                          title="계좌번호 복사"
                        >
                          <span>{acc.accountNumber} {acc.accountHolder ? `(${acc.accountHolder})` : ''}</span>
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpenAccountModal(acc)}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                        title="수정"
                        aria-label={`${acc.accountName} 계좌 수정`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          const accepted = await confirm({
                            title: '이 계좌를 삭제할까요?',
                            description: '카드, 정기 항목, 거래에서 사용 중이면 삭제되지 않습니다.',
                            details: [
                              { label: '계좌', value: `${acc.bankName} ${acc.accountName}` },
                              { label: '잔액', value: formatKRW(acc.balance || 0) },
                            ],
                            confirmLabel: '삭제',
                            tone: 'danger',
                          });
                          if (accepted) onDeleteBankAccount(acc.id);
                        }}
                        className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                        title="삭제"
                        aria-label={`${acc.accountName} 계좌 삭제`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {acc.memo && (
                    <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 text-xs text-slate-400 flex items-start gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>{acc.memo}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => copyText(acc.accountNumber, `${acc.bankName} ${acc.accountName} 계좌번호를 복사했습니다.`)}
                      className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" /> 계좌번호만 복사
                    </button>
                    <button
                      onClick={() => copyText(
                        `${acc.bankName} ${acc.accountNumber}${acc.accountHolder ? ` ${acc.accountHolder}` : ''}`,
                        `${acc.accountName} 송금정보를 복사했습니다.`,
                      )}
                      className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" /> 송금정보 복사
                    </button>
                  </div>

                  {(settlementAmountByAccount.get(acc.id) || 0) > 0 && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">{cardPaymentMonth} 카드 고정 출금</span>
                        <span className="font-bold text-rose-300">
                          -{formatKRW(settlementAmountByAccount.get(acc.id) || 0)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                        <span>출금 후 예상잔액</span>
                        <span>{formatKRW((acc.balance || 0) - (settlementAmountByAccount.get(acc.id) || 0))}</span>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      직접 입력 잔액
                      <span className="block text-xs mt-0.5">기준 {acc.balanceAsOf || '미지정'}</span>
                    </span>
                    <button
                      onClick={() => handleOpenAccountModal(acc)}
                      className="font-bold text-emerald-400 text-sm hover:text-emerald-300"
                      title="잔액 수정"
                    >
                      {formatKRW(acc.balance || 0)}
                    </button>
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
              className="w-full xs:w-auto flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              새 카드 등록
            </button>
          </div>

          {paymentCards.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                <CreditCard className="w-6 h-6" />
              </div>
              <p className="text-sm text-slate-300 font-medium">등록된 신용/체크카드가 없습니다.</p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
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
                const monthlySettlement = selectedMonthSettlement.cards.find(item => item.cardId === card.id);

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
                              className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${
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
                          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                          title="수정"
                          aria-label={`${card.cardName} 카드 수정`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            const accepted = await confirm({
                              title: '이 카드를 삭제할까요?',
                              description: '정기 항목이나 거래에서 사용 중이면 삭제되지 않습니다.',
                              details: [
                                { label: '카드', value: `${card.cardCompany} ${card.cardName}` },
                                { label: '유형', value: card.cardType === 'credit' ? '신용카드' : '체크카드' },
                              ],
                              confirmLabel: '삭제',
                              tone: 'danger',
                            });
                            if (accepted) onDeletePaymentCard(card.id);
                          }}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="삭제"
                          aria-label={`${card.cardName} 카드 삭제`}
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
                        <span className="text-slate-400 italic">미지정</span>
                      )}
                    </div>

                    {card.cardType === 'credit' && monthlySettlement && (
                      <div className="space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-200">{cardPaymentMonth} 카드대금</div>
                            <div className="mt-0.5 text-xs text-slate-400">
                              {monthlySettlement.paymentDate || '결제일 미지정'} · 전월 카드 지출·고정비 {formatKRW(monthlySettlement.estimatedAmount)}
                            </div>
                          </div>
                          <span className={`rounded-md border px-2 py-1 text-xs font-bold ${
                            monthlySettlement.source === 'confirmed'
                              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                              : 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                          }`}>
                            {monthlySettlement.source === 'confirmed' ? '확정 금액' : '자동 추정'}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <div className="min-w-0 flex-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatAmountInput(monthlyAmountDrafts[card.id] ?? '')}
                              onChange={event => setMonthlyAmountDrafts(current => ({
                                ...current,
                                [card.id]: String(parseAmountInput(event.target.value)),
                              }))}
                              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-right font-bold text-slate-100 focus:border-indigo-500 focus:outline-none"
                              aria-label={`${card.cardName} ${cardPaymentMonth} 결제금액`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => saveMonthlyCardAmount(card)}
                            className="rounded-lg bg-indigo-500 px-3 py-2 font-bold text-white hover:bg-indigo-600"
                          >
                            월 금액 저장
                          </button>
                        </div>
                        {monthlySettlement.source === 'confirmed' && (
                          <button
                            type="button"
                            onClick={() => useEstimatedMonthlyCardAmount(card)}
                            className="text-xs font-semibold text-slate-400 hover:text-amber-300"
                          >
                            수동 보정값 삭제하고 카드별 지출 자동 계산 사용
                          </button>
                        )}
                      </div>
                    )}

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
      <Modal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        labelledById="account-modal-title"
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-slate-100 shadow-2xl"
      >
        <>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="account-modal-title" className="font-bold text-base text-white flex items-center gap-2">
                <Wallet className="w-5 h-5 text-rose-400" />
                {editingAccountId ? '은행 계좌 정보 수정' : '새 은행 계좌 등록'}
              </h3>
              <button
                onClick={() => setIsAccountModalOpen(false)}
                aria-label="계좌 창 닫기"
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {accountError && (
              <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300">
                {accountError}
              </p>
            )}

            <form onSubmit={handleSaveAccountSubmit} className="space-y-3 text-xs" noValidate>
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
                  id="account-name-input"
                  type="text"
                  placeholder="예: 월급 통장, 주거래 계좌"
                  value={accName}
                  onChange={(e) => {
                    setAccountError(null);
                    setAccName(e.target.value);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  계좌번호 <span className="text-rose-400">*</span>
                </label>
                <input
                  id="account-number-input"
                  type="text"
                  placeholder="예: 110-123-456789"
                  value={accNumber}
                  onChange={(e) => {
                    setAccountError(null);
                    setAccNumber(e.target.value);
                  }}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">직접 입력 잔액 (KRW)</label>
                  <AmountInput
                    value={accBalance || 0}
                    onChange={setAccBalance}
                    placeholder="0"
                    className="text-emerald-300"
                  />
                  <div className="grid grid-cols-4 gap-1 mt-2">
                    {[
                      { label: '-5만', value: -50000 },
                      { label: '-1만', value: -10000 },
                      { label: '+1만', value: 10000 },
                      { label: '+5만', value: 50000 },
                    ].map(adjustment => (
                      <button
                        key={adjustment.label}
                        type="button"
                        onClick={() => setAccBalance(current => current + adjustment.value)}
                        className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-1 text-xs font-bold text-slate-300"
                      >
                        {adjustment.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">잔액 기준일</label>
                  <input
                    type="date"
                    value={accBalanceAsOf}
                    onChange={(e) => setAccBalanceAsOf(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
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
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl shadow-lg transition-colors"
                >
                  저장
                </button>
              </div>
            </form>
        </>
      </Modal>

      {/* CARD MODAL */}
      <Modal
        isOpen={isCardModalOpen}
        onClose={() => setIsCardModalOpen(false)}
        labelledById="card-modal-title"
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-slate-100 shadow-2xl"
      >
        <>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="card-modal-title" className="font-bold text-base text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" />
                {editingCardId ? '카드 정보 수정' : '새 카드 등록'}
              </h3>
              <button
                onClick={() => setIsCardModalOpen(false)}
                aria-label="카드 창 닫기"
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cardError && (
              <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300">
                {cardError}
              </p>
            )}

            <form onSubmit={handleSaveCardSubmit} className="space-y-3 text-xs" noValidate>
              <div>
                <label htmlFor="card-name-input" className="block font-medium text-slate-300 mb-1">
                  카드명 <span className="text-rose-400">*</span>
                </label>
                <input
                  id="card-name-input"
                  type="text"
                  placeholder="예: 신한 딥드림 카드, 삼성 iD 카드"
                  value={cardName}
                  onChange={(e) => {
                    setCardError(null);
                    setCardName(e.target.value);
                  }}
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
                  <p className="text-xs text-amber-400/90 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    등록된 계좌가 없습니다. 은행 계좌 메뉴에서 먼저 계좌를 등록해 주세요.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">결제일 (매월 몇 일)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">매월</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={cardBillingDay || ''}
                      onChange={(e) => {
                        const nextBillingDay = Number(e.target.value);
                        setCardBillingDay(nextBillingDay);
                        // Filling the window from the issuer saves the common case;
                        // the field below stays editable for anything unusual.
                        const preset = findCardIssuerPreset(cardCompany, nextBillingDay);
                        if (preset) setCardStatementClosingDay(preset.statementClosingDay);
                      }}
                      className="w-20 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-slate-400">일</span>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-300 mb-1">이용기간 마감일</label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">매월</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      placeholder="미설정"
                      value={cardStatementClosingDay ?? ''}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setCardStatementClosingDay(value >= 1 && value <= 31 ? value : null);
                      }}
                      className="w-20 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-slate-400">일까지 쓴 금액이 청구</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    {cardStatementClosingDay
                      ? `전월 ${cardStatementClosingDay + 1}일 ~ 당월 ${cardStatementClosingDay}일 사용분이 결제일에 빠져나갑니다.`
                      : '비워 두면 결제월 직전 달 사용분으로 추정합니다. 실제 청구와 한 달 어긋날 수 있습니다.'}
                  </p>
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
        </>
      </Modal>
    </div>
  );
};
