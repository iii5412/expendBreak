import React, { useState } from 'react';
import { Lock, KeyRound, ShieldCheck, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import { UserProfile } from '../types';

interface AppLockModalProps {
  isOpen: boolean;
  userProfile: UserProfile;
  onUnlockSuccess: (pin: string) => void;
}

export const AppLockModal: React.FC<AppLockModalProps> = ({
  isOpen,
  userProfile,
  onUnlockSuccess,
}) => {
  const [enteredPin, setEnteredPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const pinToTest = enteredPin.trim();
    if (!pinToTest) return;

    setIsVerifying(true);
    setErrorMsg(null);

    try {
      // 1. Verify with server first
      const res = await fetch('/api/auth/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pinToTest }),
      });

      const data = await res.json();
      let isValid = false;

      if (data.isProtectedByServerEnv) {
        // If server is protected by APP_ACCESS_KEY
        if (data.isValid) {
          isValid = true;
        } else if (
          userProfile.securityPinEnabled &&
          userProfile.accessPin &&
          pinToTest === userProfile.accessPin.trim()
        ) {
          isValid = true;
        }
      } else {
        // Server does NOT have APP_ACCESS_KEY set
        if (userProfile.securityPinEnabled && userProfile.accessPin) {
          if (pinToTest === userProfile.accessPin.trim()) {
            isValid = true;
          }
        } else {
          // No restriction set, default valid
          isValid = true;
        }
      }

      if (!isValid) {
        setErrorMsg('보안 암호(PIN) 또는 APP_ACCESS_KEY가 일치하지 않습니다.');
        setIsVerifying(false);
        return;
      }

      // Unlock successful
      sessionStorage.setItem('app_access_pin', pinToTest);
      sessionStorage.setItem('app_unlocked', 'true');
      onUnlockSuccess(pinToTest);
    } catch (err) {
      console.error(err);
      if (
        userProfile.securityPinEnabled &&
        userProfile.accessPin &&
        pinToTest === userProfile.accessPin.trim()
      ) {
        sessionStorage.setItem('app_access_pin', pinToTest);
        sessionStorage.setItem('app_unlocked', 'true');
        onUnlockSuccess(pinToTest);
        return;
      }
      setErrorMsg('검증 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 text-center space-y-5 shadow-2xl relative overflow-hidden">
        {/* Subtle Ambient Shield Pattern */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-inner">
          <Lock className="w-7 h-7" />
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-black text-slate-100 flex items-center justify-center gap-1.5">
            <span>🛡️ Gemini API & 접근 보안 모드</span>
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed px-2">
            본인 전용 Gemini API 쿼터 및 가계부 데이터 무단 사용을 차단하도록 보호되고 있습니다. 접근 암호(PIN)를 입력하세요.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-3 pt-2">
          <div className="relative">
            <input
              type="password"
              value={enteredPin}
              onChange={e => {
                setEnteredPin(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="접근 암호(PIN) 입력"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-center text-lg font-bold tracking-widest text-emerald-400 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              autoFocus
              required
            />
            <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {errorMsg && (
            <div className="bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs px-3 py-2 rounded-lg flex items-center justify-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isVerifying || !enteredPin.trim()}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-slate-950 font-black py-3 rounded-xl shadow-lg shadow-emerald-900/30 text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            {isVerifying ? (
              <span>보안 암호 확인 중...</span>
            ) : (
              <>
                <span>앱 잠금 해제</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-400" />
          <span>본인 지정 암호 또는 APP_ACCESS_KEY 설정 연동</span>
        </div>
      </div>
    </div>
  );
};
