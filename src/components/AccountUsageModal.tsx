import React, { useState } from 'react';
import type { BankAccount } from '../types';
import type { AccountUsage } from '../utils/accountUsage';
import { formatKRW } from '../utils/calculations';
import { Modal } from './ui/Modal';

export function AccountUsageModal({ account, usage, accounts, onMerge, onClose }: {
  account: BankAccount;
  usage: AccountUsage;
  accounts: BankAccount[];
  onMerge: (sourceId: string, targetId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alternatives = accounts.filter(item => item.id !== account.id);
  const target = alternatives.find(item => item.id === targetId);
  const close = () => { if (!busy) onClose(); };
  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onMerge(account.id, target.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계좌 정리를 완료하지 못했습니다. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };
  const label = (item: BankAccount) => `${item.bankName} · ${item.accountName}${item.accountNumber ? ` · 끝 ${item.accountNumber.replace(/\D/g, '').slice(-4)}` : ''}`;

  return <Modal isOpen onClose={close} dismissOnBackdrop={!busy} ariaLabel={`${account.accountName} 중복 계좌 정리`} panelClassName="eb-viewport-sheet eb-panel w-full max-w-lg overflow-y-auto rounded-2xl p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-white">중복 계좌 정리</h2>
        <p className="mt-1 break-words text-sm text-slate-300">삭제할 계좌: {label(account)}</p>
      </div>
      <button type="button" disabled={busy} onClick={close} className="min-h-11 shrink-0 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 disabled:opacity-50">닫기</button>
    </div>
    <p className="mt-4 text-sm leading-relaxed text-slate-300">남길 계좌를 선택하면 카드·정기 항목·월별 일정·거래·퀵등록의 연결을 한 번에 옮기고 중복 계좌를 삭제합니다.</p>
    <label htmlFor="merge-target-account" className="mt-4 block text-sm font-bold text-white">연결을 옮길 계좌 (남길 계좌)</label>
    <select id="merge-target-account" value={targetId} disabled={busy} onChange={event => { setTargetId(event.target.value); setError(null); }} className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white disabled:opacity-50">
      <option value="">남길 계좌를 선택하세요</option>
      {alternatives.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
    </select>
    {alternatives.length === 0 && <p className="mt-2 text-sm text-amber-200">남길 계좌가 없습니다. 계좌를 먼저 추가해 주세요.</p>}
    {target && <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">{label(account)} → {label(target)}<br />남길 계좌의 잔액 {formatKRW(target.balance || 0)}을 유지합니다.</p>}
    <p className="mt-3 text-xs leading-relaxed text-slate-400">거래 금액·날짜와 남길 계좌의 잔액은 바뀌지 않으며, 두 계좌의 잔액을 합산하지 않습니다. 인터넷 연결 후 전체 과거 내역까지 함께 변경합니다.</p>
    {error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200" role="alert">{error}</p>}
    <button type="button" disabled={!target || busy} onClick={() => void submit()} className="mt-4 min-h-12 w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">
      {busy ? '연결 내역 변경 중…' : '연결 일괄 변경 후 중복 계좌 삭제'}
    </button>
    <details className="mt-4 rounded-lg border border-slate-800 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-200">계좌 사용 내역 · 현재 확인된 연결 {usage.total}건</summary>
      <p className="mt-2 text-xs text-slate-400">아래는 현재 불러온 내역입니다. 일괄 변경할 때는 서버의 전체 기간을 확인하며, 완료된 거래와 삭제된 정기 원본도 포함합니다.</p>
      <div className="mt-4 space-y-4">
        {usage.groups.map(group => <section key={group.kind} aria-label={group.label}>
          <h3 className="font-bold text-slate-100">{group.label} <span className="text-amber-300">{group.items.length}건</span></h3>
          <ul className="mt-2 divide-y divide-slate-800 rounded-lg border border-slate-800">
            {group.items.map(item => <li key={item.id} className="space-y-1 p-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="min-w-0 break-words font-semibold text-slate-100">{item.name}</span>
                {item.amount !== undefined && <span className="shrink-0 text-slate-200">{item.amount === null ? '금액 직접 입력' : formatKRW(item.amount)}</span>}
              </div>
              <p className="text-xs text-slate-400">{item.date && `${item.date} · `}{item.status}</p>
            </li>)}
          </ul>
        </section>)}
      </div>
    </details>
  </Modal>;
}
