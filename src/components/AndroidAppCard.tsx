import React, { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { CheckCircle2, Download, RefreshCw, Shield, Smartphone } from 'lucide-react';
import { UserProfile, WidgetPrivacyMode } from '../types';
import {
  AppUpdateInfo,
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  formatUpdateSize,
  hasNewerAppVersion,
} from '../utils/appUpdate';
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
  const [installedBuild, setInstalledBuild] = useState('');
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'checking' | 'idle' | 'current' | 'available' | 'downloading'>('checking');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const nativeAndroid = isNativeAndroid();

  useEffect(() => {
    if (!nativeAndroid) return;
    void App.getInfo().then(async info => {
      setVersion(`${info.version} (${info.build})`);
      setInstalledBuild(info.build);
      try {
        const nextUpdate = await checkForAppUpdate();
        if (nextUpdate && hasNewerAppVersion(info.build, nextUpdate)) {
          setUpdate(nextUpdate);
          setUpdateStatus('available');
        } else {
          setUpdateStatus('current');
        }
      } catch {
        setUpdateStatus('idle');
      }
    }).catch(() => setUpdateStatus('idle'));
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

  const checkUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const nextUpdate = await checkForAppUpdate();
      if (nextUpdate && hasNewerAppVersion(installedBuild, nextUpdate)) {
        setUpdate(nextUpdate);
        setUpdateStatus('available');
        showToast({ message: `새 버전 ${nextUpdate.versionName}을 설치할 수 있습니다.`, tone: 'info' });
      } else {
        setUpdate(null);
        setUpdateStatus('current');
        showToast({ message: '현재 최신 버전을 사용 중입니다.', tone: 'success' });
      }
    } catch {
      setUpdateStatus('idle');
      showToast({ message: '업데이트 정보를 확인하지 못했습니다.', tone: 'error' });
    }
  };

  const installUpdate = async () => {
    if (!update) return;
    const accepted = await confirm({
      title: `지출브레이크 ${update.versionName} 업데이트`,
      description: update.releaseNotes || '새 APK를 다운로드한 뒤 Android 설치 확인 화면을 엽니다.',
      details: [
        { label: '파일 크기', value: formatUpdateSize(update.sizeBytes) },
        { label: '새 빌드', value: String(update.versionCode) },
      ],
      confirmLabel: '다운로드',
    });
    if (!accepted) return;

    setDownloadPercent(0);
    setUpdateStatus('downloading');
    try {
      const result = await downloadAndInstallAppUpdate(update, progress => setDownloadPercent(progress.percent));
      if (result.permissionRequired) {
        setUpdateStatus('available');
        showToast({
          message: '이 출처의 앱 설치를 허용해 주세요.',
          description: '허용한 뒤 앱으로 돌아와 업데이트 버튼을 다시 눌러주세요.',
          tone: 'warning',
          durationMs: 8000,
        });
      } else {
        setUpdateStatus('available');
        showToast({ message: 'Android 설치 화면에서 업데이트를 확인해 주세요.', tone: 'success' });
      }
    } catch {
      setUpdateStatus('available');
      showToast({
        message: 'APK 업데이트를 시작하지 못했습니다.',
        description: '네트워크 연결과 업데이트 파일을 확인해 주세요.',
        tone: 'error',
      });
    }
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

      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
        {updateStatus === 'available' || updateStatus === 'downloading' ? (
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-emerald-300">새 버전 {update?.versionName}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  빌드 {update?.versionCode} · {update ? formatUpdateSize(update.sizeBytes) : ''}
                </p>
              </div>
              <Download className="h-4 w-4 shrink-0 text-emerald-300" />
            </div>
            {update?.releaseNotes && <p className="text-xs leading-relaxed text-slate-300">{update.releaseNotes}</p>}
            <button
              type="button"
              disabled={updateStatus === 'downloading'}
              onClick={() => void installUpdate()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-bold text-slate-950 disabled:cursor-wait disabled:opacity-70"
            >
              {updateStatus === 'downloading' ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> 다운로드 {downloadPercent}%</>
              ) : (
                <><Download className="h-4 w-4" /> APK 업데이트</>
              )}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={updateStatus === 'checking'}
            onClick={() => void checkUpdate()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 font-bold text-slate-200 disabled:cursor-wait disabled:opacity-70"
          >
            {updateStatus === 'checking' ? (
              <><RefreshCw className="h-4 w-4 animate-spin" /> 업데이트 확인 중</>
            ) : updateStatus === 'current' ? (
              <><CheckCircle2 className="h-4 w-4 text-emerald-300" /> 최신 버전 · 다시 확인</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> 앱 업데이트 확인</>
            )}
          </button>
        )}
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
