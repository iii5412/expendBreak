import React from 'react';
import {
  Home,
  ListOrdered,
  PlusCircle,
  BarChart3,
  Settings,
  Receipt,
  Building2,
  CreditCard
} from 'lucide-react';

export type NavTab = 'home' | 'recurring_payment' | 'accounts' | 'history' | 'analytics' | 'management';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAddModal: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenAddModal,
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 text-slate-400 py-2 px-2">
      <div className="max-w-md mx-auto flex items-center justify-between relative">
        {/* Home */}
        <button
          onClick={() => onSelectTab('home')}
          className={`flex flex-col items-center gap-0.5 text-[11px] transition-colors py-1 px-1.5 rounded-lg ${
            activeTab === 'home' ? 'text-rose-400 font-bold' : 'hover:text-slate-200'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>홈</span>
        </button>

        {/* Recurring Payment */}
        <button
          onClick={() => onSelectTab('recurring_payment')}
          className={`flex flex-col items-center gap-0.5 text-[11px] transition-colors py-1 px-1.5 rounded-lg ${
            activeTab === 'recurring_payment' ? 'text-rose-400 font-bold' : 'hover:text-slate-200'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>정기납부</span>
        </button>

        {/* Accounts & Cards */}
        <button
          onClick={() => onSelectTab('accounts')}
          className={`flex flex-col items-center gap-0.5 text-[11px] transition-colors py-1 px-1.5 rounded-lg ${
            activeTab === 'accounts' ? 'text-rose-400 font-bold' : 'hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>계좌/카드</span>
        </button>

        {/* Central Add Button */}
        <button
          onClick={onOpenAddModal}
          className="flex flex-col items-center -mt-4 transition-transform active:scale-95 group shrink-0 mx-0.5"
          title="새 거래 작성"
        >
          <div className="w-11 h-11 rounded-full bg-gradient-to-r from-rose-500 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-rose-950/40 ring-4 ring-slate-900 group-hover:from-rose-600 group-hover:to-amber-600">
            <PlusCircle className="w-6 h-6" />
          </div>
        </button>

        {/* History */}
        <button
          onClick={() => onSelectTab('history')}
          className={`flex flex-col items-center gap-0.5 text-[11px] transition-colors py-1 px-1.5 rounded-lg ${
            activeTab === 'history' ? 'text-rose-400 font-bold' : 'hover:text-slate-200'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span>내역</span>
        </button>

        {/* Analytics */}
        <button
          onClick={() => onSelectTab('analytics')}
          className={`flex flex-col items-center gap-0.5 text-[11px] transition-colors py-1 px-1.5 rounded-lg ${
            activeTab === 'analytics' ? 'text-rose-400 font-bold' : 'hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>분석</span>
        </button>

        {/* Management */}
        <button
          onClick={() => onSelectTab('management')}
          className={`flex flex-col items-center gap-0.5 text-[11px] transition-colors py-1 px-1.5 rounded-lg ${
            activeTab === 'management' ? 'text-rose-400 font-bold' : 'hover:text-slate-200'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>설정</span>
        </button>
      </div>
    </nav>
  );
};
