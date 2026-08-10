import React from 'react';
import { Zap, UserCheck, Sparkles, Calendar, Lock } from 'lucide-react';
import { UserProfile } from '../types';

interface NavbarProps {
  userProfile: UserProfile;
  nextPaydayText: string;
  onOpenSettings: () => void;
  onLock: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ userProfile, nextPaydayText, onOpenSettings, onLock }) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 via-amber-500 to-emerald-500 p-0.5 shadow-md shadow-rose-950/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Zap className="w-5 h-5 text-rose-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-bold text-lg tracking-tight text-white leading-none">지출브레이크</h1>
              <span className="text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded-full">
                강한 통제
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">안전하게 쓸 수 있는 돈을 계산하는 지출 통제 앱</p>
          </div>
        </div>

        {/* Right side info */}
        <div className="flex items-center gap-2">
          {nextPaydayText && (
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-xs px-2.5 py-1.5 rounded-lg text-slate-300">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              <span>{nextPaydayText}</span>
            </div>
          )}

          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium hidden xs:inline">{userProfile.displayName}</span>
            {userProfile.aiClassificationEnabled && (
              <Sparkles className="w-3 h-3 text-amber-400" title="AI 자동분류 활성화" />
            )}
          </button>

          <button
            onClick={onLock}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-xs text-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
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
