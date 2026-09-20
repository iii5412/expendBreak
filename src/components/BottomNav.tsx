import React from 'react';
import {
  Home,
  ListOrdered,
  PlusCircle,
  BarChart3,
  Receipt,
} from 'lucide-react';

export type NavTab = 'home' | 'recurring_payment' | 'accounts' | 'history' | 'analytics' | 'management';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAddModal: () => void;
}

/**
 * Primary destinations (PRD-ui-renewal §5): 홈 / 고정지출 / 내역 / 분석 with
 * the "+ 기록" button always in the same place. Accounts and settings live
 * in the top-bar "더보기" sheet (see Navbar).
 */
const PRIMARY_TABS: Array<{ tab: NavTab; label: string; icon: React.ElementType }> = [
  { tab: 'home', label: '홈', icon: Home },
  { tab: 'recurring_payment', label: '고정지출', icon: Receipt },
  { tab: 'history', label: '내역', icon: ListOrdered },
  { tab: 'analytics', label: '분석', icon: BarChart3 },
];

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenAddModal,
}) => {
  // 44px minimum touch target on every control.
  const tabClass = (isActive: boolean) =>
    `relative flex min-h-12 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs transition-colors ${
      isActive ? 'font-extrabold text-rose-400' : 'font-medium text-slate-400 hover:text-slate-200'
    }`;

  const renderTab = ({ tab, label, icon: Icon }: typeof PRIMARY_TABS[number]) => (
    <button
      key={tab}
      onClick={() => onSelectTab(tab)}
      aria-current={activeTab === tab ? 'page' : undefined}
      className={tabClass(activeTab === tab)}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700/80 bg-slate-950/94 px-2 pt-1 backdrop-blur-xl"
      style={{ paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom, 0px))' }}
      aria-label="주요 화면"
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-[clamp(0.25rem,1.5vw,1rem)]">
        {PRIMARY_TABS.slice(0, 2).map(renderTab)}

        {/* Central Add Button */}
        <button
          onClick={onOpenAddModal}
          className="-mt-5 flex h-14 w-14 shrink-0 items-center justify-center transition-transform active:scale-95"
          aria-label="새 거래 작성"
        >
          <span className="flex h-12 w-12 items-center justify-center bg-rose-500 text-white shadow-[0_10px_30px_rgba(255,77,61,0.32)] ring-4 ring-slate-950 transition-transform hover:-translate-y-0.5">
            <PlusCircle className="h-6 w-6" />
          </span>
        </button>

        {PRIMARY_TABS.slice(2).map(renderTab)}
      </div>
    </nav>
  );
};
