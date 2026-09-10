import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { UserProfile } from '../types';
import {
  clearPendingSms,
  configureSmsImport,
  getSmsImportStatus,
  getSmsPermissionStatus,
  isSmsImportAvailable,
  openSmsPermissionSettings,
  requestSmsPermissions,
  scanSmsInbox,
  SmsImportStatus,
  SmsPermissionStatus,
} from '../utils/smsImport';
import { useConfirm, useToast } from './ui/FeedbackProvider';

const SMS_INBOX_CONSENT_VERSION = 2;

interface SmsImportSettingsCardProps {
  userProfile: UserProfile;
  onUpdateUserProfile: (updates: Partial<UserProfile>) => void;
}

function formatTimestamp(value: number) {
  if (!value) return '아직 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export const SmsImportSettingsCard: React.FC<SmsImportSettingsCardProps> = ({
  userProfile,
  onUpdateUserProfile,
}) => {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [permissions, setPermissions] = useState<SmsPermissionStatus>({ receiveSms: 'prompt', readSms: 'prompt' });
  const [status, setStatus] = useState<SmsImportStatus | null>(null);
  const [working, setWorking] = useState(false);
  const available = isSmsImportAvailable();

  const refreshStatus = useCallback(async () => {
    if (!available || !userProfile.uid) return;
    const [nextPermissions, nextStatus] = await Promise.all([
      getSmsPermissionStatus(),
      getSmsImportStatus(userProfile.uid),
    ]);
    setPermissions(nextPermissions);
    setStatus(nextStatus);
  }, [available, userProfile.uid]);

  useEffect(() => {
    void refreshStatus().catch(() => {
      setPermissions({ receiveSms: 'denied', readSms: 'denied' });
    });
  }, [refreshStatus, userProfile.smsAutoImportEnabled, userProfile.smsInboxConsentVersion]);

  if (!available) return null;

  const acceptInboxDisclosure = async () => {
    const baseline = status?.baselineAt || Date.now();
    const accepted = await confirm({
      title: '앱이 꺼져 있을 때 온 결제 문자도 확인할까요?',
      description: `앱을 열면 ${formatTimestamp(baseline)} 이후 받은 SMS를 기기에서 확인합니다. 결제 내역을 찾으면 등록할지 먼저 물어보며, 문자 원문은 서버나 AI로 보내지 않습니다.`,
      details: [
        { label: '읽는 범위', value: `${formatTimestamp(baseline)} 이후 받은 SMS` },
        { label: '처리 방식', value: '기기에서 분석 · 확인 후 등록' },
        { label: '지원 대상', value: '카드 승인·취소 SMS' },
      ],
      confirmLabel: '문자 확인 사용하기',
      cancelLabel: '나중에',
    });
    if (!accepted) {
      onUpdateUserProfile({ smsInboxConsentDeferredAt: new Date().toISOString() });
      return false;
    }

    const now = new Date().toISOString();
    onUpdateUserProfile({
      smsAutoImportEnabled: true,
      smsConsentAt: userProfile.smsConsentAt || now,
      smsInboxConsentVersion: SMS_INBOX_CONSENT_VERSION,
      smsInboxConsentAt: now,
      smsInboxConsentDeferredAt: null,
    });
    await configureSmsImport(userProfile.uid, true);
    const nextPermissions = await requestSmsPermissions();
    setPermissions(nextPermissions);
    if (nextPermissions.readSms !== 'granted') {
      showToast({
        message: '문자 읽기 권한이 필요합니다.',
        description: 'Android 앱 설정에서 SMS 권한을 허용해 주세요.',
        tone: 'warning',
        durationMs: 12000,
        action: { label: '앱 설정', onAction: () => void openSmsPermissionSettings() },
      });
      await refreshStatus();
      return false;
    }

    await scanSmsInbox(userProfile.uid, true);
    await refreshStatus();
    showToast({ message: '문자에서 지출 찾기를 켰습니다.', tone: 'success' });
    return true;
  };

  const disable = async () => {
    await configureSmsImport(userProfile.uid, false);
    await clearPendingSms(userProfile.uid);
    onUpdateUserProfile({ smsAutoImportEnabled: false });
    await refreshStatus();
    showToast({ message: '문자에서 지출 찾기를 껐습니다.', tone: 'info' });
  };

  const enable = async () => {
    return acceptInboxDisclosure();
  };

  const toggle = async (enabled: boolean) => {
    if (working) return;
    setWorking(true);
    try {
      if (enabled) await enable();
      else await disable();
    } catch (error) {
      console.error('Unable to update SMS import setting:', error);
      showToast({ message: '문자 확인 설정을 변경하지 못했습니다.', tone: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const scanNow = async () => {
    if (working) return;
    setWorking(true);
    try {
      const next = await scanSmsInbox(userProfile.uid, true);
      await refreshStatus();
      showToast({
        message: next?.lastCandidateCount
          ? `새 결제 후보 ${next.lastCandidateCount}건을 찾았습니다.`
          : '새 결제 후보가 없습니다.',
        description: next ? `SMS ${next.lastScannedCount}건을 확인했습니다.` : undefined,
        tone: 'info',
      });
    } catch (error) {
      console.error('Unable to scan SMS inbox:', error);
      await refreshStatus().catch(() => undefined);
      showToast({
        message: '문자를 확인하지 못했습니다.',
        description: 'SMS 권한을 확인한 뒤 다시 시도해 주세요.',
        tone: 'error',
      });
    } finally {
      setWorking(false);
    }
  };

  const enabled = Boolean(userProfile.smsAutoImportEnabled);
  const inboxConsentReady = (userProfile.smsInboxConsentVersion || 0) >= SMS_INBOX_CONSENT_VERSION;
  const readMissing = enabled && permissions.readSms !== 'granted';

  return (
    <div className="eb-panel space-y-3 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <MessageSquareText className="h-4 w-4 text-sky-300" />
            <span>문자에서 지출 찾기</span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            앱을 열면 새 결제 문자를 확인하고 등록 여부를 물어봅니다.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          disabled={working}
          onChange={event => void toggle(event.target.checked)}
          className="h-11 w-11 shrink-0 accent-sky-500"
          aria-label="문자에서 지출 찾기"
        />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>문자는 기기에서만 분석하며 원문과 발신번호를 클라우드에 전송하지 않습니다.</span>
      </div>

      {enabled && !inboxConsentReady && (
        <button
          type="button"
          disabled={working}
          onClick={() => void acceptInboxDisclosure()}
          className="min-h-11 w-full border border-sky-500/40 bg-sky-500/10 px-3 text-sm font-bold text-sky-200 disabled:opacity-50"
        >
          문자함 확인 설정 완료하기
        </button>
      )}

      {enabled && inboxConsentReady && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs">
          <dt className="text-slate-500">확인 시작</dt>
          <dd className="text-right text-slate-300">{formatTimestamp(status?.baselineAt || 0)}</dd>
          <dt className="text-slate-500">마지막 성공</dt>
          <dd className="text-right text-slate-300">{formatTimestamp(status?.lastSuccessAt || 0)}</dd>
          <dt className="text-slate-500">최근 결과</dt>
          <dd className="text-right text-slate-300">
            {status?.lastError
              ? '확인 실패'
              : `SMS ${status?.lastScannedCount || 0}건 · 새 후보 ${status?.lastCandidateCount || 0}건`}
          </dd>
          <dt className="text-slate-500">확인 대기</dt>
          <dd className="text-right text-slate-300">{status?.pendingCount || 0}건</dd>
        </dl>
      )}

      {enabled && inboxConsentReady && !readMissing && (
        <button
          type="button"
          disabled={working}
          onClick={() => void scanNow()}
          className="flex min-h-11 w-full items-center justify-center gap-2 border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-slate-200 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${working ? 'animate-spin' : ''}`} />
          지금 확인
        </button>
      )}

      {(readMissing || (enabled && permissions.receiveSms !== 'granted')) && (
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
