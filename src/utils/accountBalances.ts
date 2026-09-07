import { BankAccount } from '../types';
import { getLocalDateString } from './calculations';
export function hasConfirmedBalance(account: BankAccount): boolean {
  return account.balanceConfirmed ?? (Number.isFinite(account.balance) && account.balance !== 0);
}
export function balanceStatus(account: BankAccount, now = new Date()): string {
  if (!hasConfirmedBalance(account)) return '잔액 미확인';
  if (!account.balanceAsOf) return '잔액 기준일 미지정';
  const days = Math.floor((Date.parse(getLocalDateString(now) + 'T12:00:00') - Date.parse(account.balanceAsOf + 'T12:00:00')) / 86400000);
  return days > 7 ? '잔액 확인 후 ' + days + '일 경과' : '잔액 확인됨';
}
