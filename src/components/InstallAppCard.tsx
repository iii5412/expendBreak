import React, { useEffect, useState } from 'react';
import { Share, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Home-screen install entry point. Chrome-family browsers fire
 * `beforeinstallprompt`; iOS Safari does not, so it gets manual steps instead.
 */
export const InstallAppCard: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setInstallEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isInstalled) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
        <Smartphone className="h-4 w-4 text-emerald-300" />
        <span>홈 화면에 추가</span>
      </h3>
      <p className="text-xs leading-relaxed text-slate-400">
        홈 화면에서 바로 열 수 있고, 네트워크가 불안정한 곳에서도 최근 내역 조회와 기록이 가능합니다.
      </p>

      {installEvent ? (
        <button
          type="button"
          onClick={async () => {
            await installEvent.prompt();
            const choice = await installEvent.userChoice;
            if (choice.outcome === 'accepted') setIsInstalled(true);
            setInstallEvent(null);
          }}
          className="min-h-11 w-full rounded-xl bg-emerald-500 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-600"
        >
          홈 화면에 추가하기
        </button>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-400">
          <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            iPhone Safari는 공유 버튼을 누른 뒤 <span className="font-semibold text-slate-200">홈 화면에 추가</span>를 선택하세요.
            Android Chrome은 메뉴에서 <span className="font-semibold text-slate-200">앱 설치</span>를 선택하면 됩니다.
          </span>
        </p>
      )}
    </div>
  );
};
