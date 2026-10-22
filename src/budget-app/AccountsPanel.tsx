import { useState } from 'react';
import { Copy } from 'lucide-react';
import type { BankAccount, PaymentCard } from '../types';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/**
 * Read-only list of the user's accounts and cards, with a copy button for the
 * account number. The numbers are shown on this device only: the AI agent never
 * receives them, so this is the place to look them up. Editing stays in the
 * classic screen.
 */
export function AccountsPanel({
  bankAccounts,
  paymentCards,
  copy = (text: string) => navigator.clipboard.writeText(text),
}: {
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  copy?: (text: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const accountName = (id?: string | null) => {
    const account = bankAccounts.find((item) => item.id === id);
    return account ? `${account.bankName} ${account.accountName}` : '';
  };
  const copyNumber = async (account: BankAccount) => {
    try {
      await copy(account.accountNumber);
      setMessage(`${account.bankName} ${account.accountName} 계좌번호를 복사했어요.`);
    } catch {
      // Clipboard access can be blocked; the number is already on screen to copy by hand.
      setMessage('자동 복사를 쓸 수 없어요. 번호를 길게 눌러 직접 복사해 주세요.');
    }
  };
  return (
    <section className="bb-card" aria-labelledby="accounts-title">
      <p className="bb-kicker">내 계좌와 카드</p>
      <h2 id="accounts-title">계좌·카드 정보</h2>
      <p className="bb-caption">
        이 기기에서만 보여요. AI 에이전트에는 계좌번호와 카드 정보를 보내지 않아서, 에이전트에게 물으면 찾을 수 없다고
        답해요. 추가·수정은 기존 화면의 계좌/카드 메뉴에서 할 수 있어요.
      </p>

      <h3 className="bb-list-heading">계좌 {bankAccounts.length}개</h3>
      {bankAccounts.length === 0 && <p className="bb-caption">등록한 계좌가 없어요.</p>}
      <div className="bb-template-list">
        {bankAccounts.map((account) => (
          <article className="bb-template-row" key={account.id}>
            <div>
              <strong>
                {account.accountName} <span className="bb-muted">{account.bankName}</span>
              </strong>
              <small className="bb-account-number">
                {account.accountNumber || '계좌번호 미등록'}
                {account.accountHolder ? ` · ${account.accountHolder}` : ''}
              </small>
              <small>
                {account.balanceConfirmed || account.balance
                  ? `잔액 ${won(account.balance)}${account.balanceAsOf ? ` (${account.balanceAsOf} 기준)` : ''}`
                  : '잔액 미입력'}
                {account.memo ? ` · ${account.memo}` : ''}
              </small>
            </div>
            {account.accountNumber && (
              <button
                type="button"
                className="bb-small-button"
                aria-label={`${account.bankName} ${account.accountName} 계좌번호 복사`}
                onClick={() => void copyNumber(account)}
              >
                <Copy size={14} aria-hidden="true" /> 복사
              </button>
            )}
          </article>
        ))}
      </div>

      <h3 className="bb-list-heading">카드 {paymentCards.length}장</h3>
      {paymentCards.length === 0 && <p className="bb-caption">등록한 카드가 없어요.</p>}
      <div className="bb-template-list">
        {paymentCards.map((card) => (
          <article className="bb-template-row" key={card.id}>
            <div>
              <strong>
                {card.cardName} <span className="bb-muted">{card.cardCompany}</span>
              </strong>
              <small>
                {card.cardType === 'credit' ? '신용카드' : '체크카드'}
                {card.cardLast4 ? ` · 끝자리 ${card.cardLast4}` : ' · 끝자리 미등록'}
              </small>
              <small>
                {card.billingDay ? `결제일 ${card.billingDay}일` : '결제일 미설정'}
                {card.statementClosingDay ? ` · 이용기간 마감 ${card.statementClosingDay}일` : ''}
                {accountName(card.linkedAccountId) ? ` · 출금 ${accountName(card.linkedAccountId)}` : ''}
              </small>
            </div>
          </article>
        ))}
      </div>
      <p className="bb-caption">카드는 전체 번호가 아니라 SMS 연결용 끝 4자리만 저장돼 있어요.</p>
      <p className="bb-caption" role="status">
        {message}
      </p>
    </section>
  );
}
