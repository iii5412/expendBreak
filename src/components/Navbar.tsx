import React, { useState } from 'react';
import { UserCheck, Sparkles, Calendar, Lock, MoreHorizontal, Building2, Settings } from 'lucide-react';
import { UserProfile } from '../types';
import type { NavTab } from './BottomNav';
import { Modal } from './ui/Modal';

interface NavbarProps {
  userProfile: UserProfile;
  accountName: string;
  nextPaydayText: string;
  activeTab: NavTab;
  /** Secondary destinations (계좌·카드, 설정) open from the top "더보기" sheet. */
  onNavigateTab: (tab: NavTab) => void;
  onLock: () => void;
  /** Sync status badge; kept as a slot so the Navbar stays presentational. */
  syncStatusSlot?: React.ReactNode;
}

const SECONDARY_TABS: Array<{ tab: NavTab; label: string; description: string; icon: React.ElementType }> = [
  { tab: 'accounts', label: '계좌/카드', description: '계좌 잔액과 카드 결제 관리', icon: Building2 },
  { tab: 'management', label: '설정', description: '고정 항목 원본, 생활비 한도, 카테고리, 앱 설정', icon: Settings },
];

export const Navbar: React.FC<NavbarProps> = ({
  userProfile,
  accountName,
  nextPaydayText,
  activeTab,
  onNavigateTab,
  onLock,
  syncStatusSlot,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const activeSecondary = SECONDARY_TABS.find(item => item.tab === activeTab);

  return (
    <header
      className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/88 text-slate-100 backdrop-blur-xl"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-3 px-[clamp(0.75rem,3vw,2rem)] py-2.5">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center border border-rose-500/45 bg-rose-500/10" aria-hidden="true">
            <span className="h-5 w-1.5 -skew-x-12 bg-rose-500" />
            <span className="ml-1 h-5 w-1.5 -skew-x-12 border border-rose-400" />
          </div>
          <div className="min-w-0">
            <h1 className="eb-display truncate text-[17px] font-extrabold leading-none tracking-[-0.04em] text-white sm:text-lg">
              지출브레이크
            </h1>
            <p className="mt-1 hidden truncate text-xs text-slate-400 sm:block">오늘 써도 되는 돈을 계산합니다</p>
          </div>
        </div>

        {/* Right side info */}
        <div className="flex items-center gap-2">
          {syncStatusSlot}

          {nextPaydayText && (
            <div className="hidden min-h-10 items-center gap-1.5 border border-slate-700/70 bg-slate-900 px-3 text-xs text-slate-300 md:flex">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              <span>{nextPaydayText}</span>
            </div>
          )}

          <button
            onClick={() => setIsMoreOpen(true)}
            aria-haspopup="dialog"
            aria-current={activeSecondary ? 'page' : undefined}
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 border px-3 text-xs transition-colors ${
              activeSecondary
                ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
                : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500 hover:bg-slate-800'
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
            <span className="font-medium hidden xs:inline">{activeSecondary ? activeSecondary.label : '더보기'}</span>
            {userProfile.aiClassificationEnabled && (
              // lucide icons drop unknown props, so the tooltip lives on a wrapper.
              <span title="AI 자동분류 활성화" className="inline-flex">
                <Sparkles className="w-3 h-3 text-amber-400" aria-label="AI 자동분류 활성화" />
              </span>
            )}
          </button>

          <button
            onClick={onLock}
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-200 transition-colors hover:border-rose-500/50 hover:bg-rose-500/10"
            title="앱 잠금"
            aria-label="앱 잠금"
          >
            <Lock className="w-3.5 h-3.5 text-rose-300" />
            <span className="hidden sm:inline">잠금</span>
          </button>
        </div>
      </div>

      <Modal
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        labelledById="more-sheet-title"
        backdropClassName="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        panelClassName="w-full max-w-md space-y-3 rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="more-sheet-title" className="text-sm font-bold text-slate-100">더보기</h2>
          <span className="flex items-center gap-1 text-xs text-slate-400"><UserCheck className="h-3.5 w-3.5" />{accountName}</span>
        </div>

        <div className="space-y-2">
          {SECONDARY_TABS.map(({ tab, label, description, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => {
                onNavigateTab(tab);
                setIsMoreOpen(false);
              }}
              aria-current={activeTab === tab ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                activeTab === tab
                  ? 'border-rose-500/40 bg-rose-500/10'
                  : 'border-slate-800 bg-slate-950 hover:bg-slate-800'
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-bold ${activeTab === tab ? 'text-rose-300' : 'text-slate-100'}`}>
                  {label}
                </span>
                <span className="block text-xs text-slate-400">{description}</span>
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIsMoreOpen(false)}
          className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
        >
          닫기
        </button>
      </Modal>
    </header>
  );
};
