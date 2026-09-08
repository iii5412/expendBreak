import React, { useEffect, useState } from 'react';
import { MessageSquareText, Settings2, ShieldCheck } from 'lucide-react';
import { UserProfile } from '../types';
import {
  clearPendingSms,
  configureSmsImport,
  getSmsPermissionState,
  isSmsImportAvailable,
  openSmsPermissionSettings,
  requestSmsPermission,
  SmsPermissionState,
} from '../utils/smsImport';
import { useConfirm, useToast } from './ui/FeedbackProvider';

interface SmsImportSettingsCardProps {
  userProfile: UserProfile;
  onUpdateUserProfile: (updates: Partial<UserProfile>) => void;
}

export const SmsImportSettingsCard: React.FC<SmsImportSettingsCardProps> = ({
  userProfile,
  onUpdateUserProfile,
}) => {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [permission, setPermission] = useState<SmsPermissionState>('prompt');
  const [working, setWorking] = useState(false);
  const available = isSmsImportAvailable();

  useEffect(() => {
    if (!available) return;
    void getSmsPermissionState().then(setPermission).catch(() => setPermission('denied'));
  }, [available, userProfile.smsAutoImportEnabled]);

  if (!available) return null;

  const disable = async () => {
    await configureSmsImport(userProfile.uid, false);
    await clearPendingSms(userProfile.uid);
    onUpdateUserProfile({ smsAutoImportEnabled: false });
    setPermission(await getSmsPermissionState());
    showToast({ message: 'SMS 후보 받기를 껐습니다.', tone: 'info' });
  };

  const enable = async () => {
    const accepted = await confirm({
      title: '카드 승인 문자를 지출 후보로 받을까요?',
      description: '새로 도착하는 SMS 중 금액과 승인·취소 표현이 있는 금융 문자만 기기에서 분석합니다. 카드사 앱 알림과 일반 문자, 기존 문자함은 읽지 않으며 문자 원문은 서버나 AI로 보내지 않습니다.',
      details: [
        { label: '읽는 범위', value: '기능을 켠 뒤 새로 도착한 SMS' },
        { label: '처리 방식', value: '후보 생성 · 확인 후 승인 · 중복 차단' },
        { label: '원문 보관', value: '처리 전 앱 내부 임시 큐(최대 7일)' },
      ],
      confirmLabel: '권한 허용하고 켜기',
    });
    if (!accepted) return;

    const nextPermission = await requestSmsPermission();
    setPermission(nextPermission);
    if (nextPermission !== 'granted') {
      showToast({
        message: 'SMS 권한이 필요합니다.',
        description: 'Android 앱 설정에서 SMS 권한을 허용해 주세요.',
        tone: 'warning',
        durationMs: 12000,
        action: { label: '앱 설정', onAction: () => void openSmsPermissionSettings() },
      });
      return;
    }

    await configureSmsImport(userProfile.uid, true);
    onUpdateUserProfile({
      smsAutoImportEnabled: true,
      smsConsentAt: userProfile.smsConsentAt || new Date().toISOString(),
    });
    showToast({ message: 'SMS 카드 지출 후보 받기를 켰습니다.', tone: 'success' });
  };

  const toggle = async (enabled: boolean) => {
    if (working) return;
    setWorking(true);
    try {
      if (enabled) await enable();
      else await disable();
    } catch (error) {
      console.error('Unable to update SMS import setting:', error);
      showToast({ message: 'SMS 후보 받기 설정을 변경하지 못했습니다.', tone: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const enabled = Boolean(userProfile.smsAutoImportEnabled);
  const permissionMissing = enabled && permission !== 'granted';

  return (
    <div className="eb-panel space-y-3 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <MessageSquareText className="h-4 w-4 text-sky-300" />
            <span>SMS 카드 지출 후보 받기</span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            새 카드 승인·취소 SMS를 후보로 만들며, 승인하기 전에는 지출에 반영하지 않습니다.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          disabled={working}
          onChange={event => void toggle(event.target.checked)}
          className="h-11 w-11 shrink-0 accent-sky-500"
          aria-label="SMS 카드 지출 후보 받기"
        />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>일반 문자와 카드사 앱 푸시는 저장하지 않으며, 문자 원문은 클라우드에 전송하지 않습니다.</span>
      </div>

      {permissionMissing && (
        <button
          type="button"
          onClick={() => void openSmsPermissionSettings()}
          className="flex min-h-11 w-full items-center justify-center gap-2 border border-amber-500/40 bg-amber-500/10 px-3 font-bold text-amber-200"
        >
          <Settings2 className="h-4 w-4" />
          SMS 권한 다시 허용하기
        </button>
      )}
    </div>
  );
};
