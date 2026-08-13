import React, { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { RefreshCw, Shield, Smartphone } from 'lucide-react';
import { UserProfile, WidgetPrivacyMode } from '../types';
import { isNativeAndroid } from '../utils/platform';
import { normalizeWidgetPrivacyMode, refreshWidgets, requestWidgetPin } from '../utils/widget';
import { useConfirm, useToast } from './ui/FeedbackProvider';

interface AndroidAppCardProps {
  userProfile: UserProfile;
  onUpdateUserProfile: (updates: Partial<UserProfile>) => void;
}

export const AndroidAppCard: React.FC<AndroidAppCardProps> = ({ userProfile, onUpdateUserProfile }) => {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [version, setVersion] = useState('');
  const nativeAndroid = isNativeAndroid();

  useEffect(() => {
    if (!nativeAndroid) return;
    void App.getInfo().then(info => setVersion(`${info.version} (${info.build})`)).catch(() => undefined);
  }, [nativeAndroid]);

  if (!nativeAndroid) return null;

  const updatePrivacy = async (next: WidgetPrivacyMode) => {
    if (next === 'always_show') {
      const accepted = await confirm({
        title: '잠금 중에도 금액을 표시할까요?',
        description: '홈 화면을 볼 수 있는 사람은 누구나 오늘 안전 금액과 남은 생활비를 확인할 수 있습니다.',
        confirmLabel: '항상 표시',
        tone: 'danger',
      });
      if (!accepted) return;
    }
    onUpdateUserProfile({ widgetPrivacyMode: next });
    showToast({ message: '위젯 개인정보 설정을 변경했습니다.', tone: 'success' });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <Smartphone className="h-4 w-4 text-emerald-300" />
            <span>Android 앱과 위젯</span>
          </h3>
          <p className="mt-1 text-xs text-slate-400">설치 버전 {version || '확인 중'}</p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-300">APK</span>
      </div>

      <button
        type="button"
        onClick={async () => {
          try {
            const result = await requestWidgetPin();
            showToast({
              message: result.requested ? '홈 화면에서 위젯 추가를 확인해 주세요.' : '위젯 목록에서 지출브레이크를 추가해 주세요.',
              tone: result.requested ? 'success' : 'info',
            });
          } catch {
            showToast({ message: '위젯 추가 요청을 시작하지 못했습니다.', tone: 'error' });
          }
        }}
        className="min-h-11 w-full rounded-xl bg-emerald-500 font-bold text-slate-950 transition-colors hover:bg-emerald-400"
      >
        홈 화면 위젯 추가
      </button>

      <label className="block space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
        <span className="flex items-center gap-2 font-bold text-slate-200">
          <Shield className="h-4 w-4 text-sky-300" /> 위젯 개인정보 보호
        </span>
        <select
          value={normalizeWidgetPrivacyMode(userProfile.widgetPrivacyMode)}
          onChange={event => void updatePrivacy(event.target.value as WidgetPrivacyMode)}
          className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-slate-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="unlock_required">잠금 시 금액 숨김 (권장)</option>
          <option value="always_show">잠금 중에도 항상 표시</option>
          <option value="amounts_hidden">항상 금액 숨김</option>
        </select>
      </label>

      <button
        type="button"
        onClick={async () => {
          try {
            await refreshWidgets();
            showToast({ message: '위젯을 새로고침했습니다.', tone: 'success' });
          } catch {
            showToast({ message: '위젯 새로고침에 실패했습니다.', tone: 'error' });
          }
        }}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 font-bold text-slate-200 hover:border-slate-600"
      >
        <RefreshCw className="h-4 w-4" /> 위젯 새로고침
      </button>
    </div>
  );
};
