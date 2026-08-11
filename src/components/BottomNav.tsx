import React, { useState } from 'react';
import {
  Home,
  ListOrdered,
  PlusCircle,
  BarChart3,
  Settings,
  Receipt,
  Building2,
  MoreHorizontal,
} from 'lucide-react';
import { Modal } from './ui/Modal';

export type NavTab = 'home' | 'recurring_payment' | 'accounts' | 'history' | 'analytics' | 'management';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAddModal: () => void;
}

/** Primary tabs stay on the bar; the rest move into the "더보기" sheet. */
const PRIMARY_TABS: Array<{ tab: NavTab; label: string; icon: React.ElementType }> = [
  { tab: 'home', label: '홈', icon: Home },
  { tab: 'history', label: '내역', icon: ListOrdered },
  { tab: 'analytics', label: '분석', icon: BarChart3 },
];

const SECONDARY_TABS: Array<{ tab: NavTab; label: string; description: string; icon: React.ElementType }> = [
  { tab: 'recurring_payment', label: '정기납부', description: '월급 입금과 고정 지출 납부 확인', icon: Receipt },
  { tab: 'accounts', label: '계좌/카드', description: '계좌 잔액과 카드 결제 관리', icon: Building2 },
  { tab: 'management', label: '설정', description: '정기 항목, 용돈 한도, 카테고리, 앱 설정', icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenAddModal,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const activeSecondary = SECONDARY_TABS.find(item => item.tab === activeTab);

  // 44px minimum touch target on every control.
  const tabClass = (isActive: boolean) =>
    `flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-xs transition-colors ${
      isActive ? 'font-bold text-rose-400' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-900/95 px-2 pt-1 backdrop-blur-md"
        style={{ paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom, 0px))' }}
        aria-label="주요 화면"
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-1">
          {PRIMARY_TABS.slice(0, 2).map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => onSelectTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              className={tabClass(activeTab === tab)}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          ))}

          {/* Central Add Button */}
          <button
            onClick={onOpenAddModal}
            className="-mt-5 flex h-14 w-14 shrink-0 items-center justify-center transition-transform active:scale-95"
            aria-label="새 거래 작성"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-rose-500 to-amber-500 text-white shadow-lg shadow-rose-950/40 ring-4 ring-slate-900">
              <PlusCircle className="h-6 w-6" />
            </span>
          </button>

          {PRIMARY_TABS.slice(2).map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => onSelectTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              className={tabClass(activeTab === tab)}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          ))}

          <button
            onClick={() => setIsMoreOpen(true)}
            aria-haspopup="dialog"
            aria-current={activeSecondary ? 'page' : undefined}
            className={tabClass(Boolean(activeSecondary))}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>{activeSecondary ? activeSecondary.label : '더보기'}</span>
          </button>
        </div>
      </nav>

      <Modal
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        labelledById="more-sheet-title"
        backdropClassName="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        panelClassName="w-full max-w-md space-y-3 rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl"
      >
        <h2 id="more-sheet-title" className="text-sm font-bold text-slate-100">
          더보기
        </h2>

        <div className="space-y-2">
          {SECONDARY_TABS.map(({ tab, label, description, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => {
                onSelectTab(tab);
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
    </>
  );
};
