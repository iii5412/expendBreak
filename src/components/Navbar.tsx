import React from 'react';
import { UserCheck, Sparkles, Calendar, Lock } from 'lucide-react';
import { UserProfile } from '../types';

interface NavbarProps {
  userProfile: UserProfile;
  accountName: string;
  nextPaydayText: string;
  onOpenSettings: () => void;
  onLock: () => void;
  /** Sync status badge; kept as a slot so the Navbar stays presentational. */
  syncStatusSlot?: React.ReactNode;
}

export const Navbar: React.FC<NavbarProps> = ({
  userProfile,
  accountName,
  nextPaydayText,
  onOpenSettings,
  onLock,
  syncStatusSlot,
}) => {
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
            onClick={onOpenSettings}
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800"
          >
            <UserCheck className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium hidden xs:inline">{accountName}</span>
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
    </header>
  );
};
