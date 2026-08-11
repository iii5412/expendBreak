import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, RotateCcw, Sparkles, Loader2, AlertCircle, ShieldCheck, Volume2 } from 'lucide-react';
import { Category, MerchantRule, BankAccount, PaymentCard, VoiceAnalysisResult } from '../types';
import { authenticatedFetch } from '../utils/auth';
import { getLocalDateString } from '../utils/calculations';
import { validateAudioInput } from '../utils/voice';

interface VoiceInputPanelProps {
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts?: BankAccount[];
  paymentCards?: PaymentCard[];
  onAnalysisComplete: (result: VoiceAnalysisResult, durationMs: number, mimeType: string) => void;
}

export const VoiceInputPanel: React.FC<VoiceInputPanelProps> = ({
  categories,
  merchantRules,
  bankAccounts = [],
  paymentCards = [],
  onAnalysisComplete,
}) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState<number>(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('audio/webm');
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      cleanupStream();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const cleanupStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const getSupportedMimeType = (): string => {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/wav',
      'audio/aac',
    ];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return '';
  };

  const startRecording = async () => {
    setErrorMessage(null);
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('이 브라우저는 음성 녹음을 지원하지 않습니다.');
      return;
    }

    const selectedMimeType = getSupportedMimeType();
    if (!selectedMimeType && typeof MediaRecorder === 'undefined') {
      setErrorMessage('이 브라우저는 음성 녹음을 지원하지 않습니다.');
      return;
    }
    setMimeType(selectedMimeType || 'audio/webm');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Setup audio analyzer for real-time volume meter
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateVolume = () => {
            if (analyserRef.current) {
              analyserRef.current.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const avg = sum / dataArray.length;
              setVolumeLevel(Math.min(100, Math.round((avg / 128) * 100)));
              animFrameRef.current = requestAnimationFrame(updateVolume);
            }
          };
          updateVolume();
        }
      } catch {
        // AudioContext optional for meter
      }

      const recorder = new MediaRecorder(stream, selectedMimeType ? { mimeType: selectedMimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalDuration = Date.now() - startTimeRef.current;
        const blob = new Blob(audioChunksRef.current, { type: selectedMimeType || 'audio/webm' });
        
        const validation = validateAudioInput(finalDuration, blob.size);
        if (!validation.isValid) {
          setErrorMessage(validation.errorMessage || '녹음이 올바르지 않습니다.');
          setAudioBlob(null);
        } else {
          setAudioBlob(blob);
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
          setRecordingDurationMs(finalDuration);
        }
        cleanupStream();
        setIsRecording(false);
      };

      recorder.start(100);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDurationMs(0);

      // Timer counter
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setRecordingDurationMs(elapsed);
        if (elapsed >= 8000) {
          stopRecording();
        }
      }, 100);
    } catch (err: any) {
      console.error('Microphone access error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 접근을 허용해주세요.');
      } else {
        setErrorMessage('마이크 연결 상태를 확인해주세요.');
      }
      cleanupStream();
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleReRecord = () => {
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setRecordingDurationMs(0);
    setErrorMessage(null);
  };

  const handleAnalyze = async () => {
    if (!audioBlob) {
      setErrorMessage('녹음된 음성이 없거나 너무 짧습니다.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const res = reader.result as string;
          const base64 = res ? res.split(',')[1] : '';
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('파일 변환 오류'));
      });
      reader.readAsDataURL(audioBlob);

      const audioBase64 = await base64Promise;

      const response = await authenticatedFetch('/api/ai/voice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioBase64,
          mimeType: audioBlob.type || mimeType,
          durationMs: recordingDurationMs,
          categories,
          merchantRules,
          bankAccounts,
          paymentCards,
          defaultDate: getLocalDateString(),
          timezone: 'Asia/Seoul',
        }),
      });

      if (response.status === 401) {
        throw new Error('인증이 만료되었습니다. 다시 로그인 해주세요.');
      }
      if (response.status === 429) {
        throw new Error('요청 제한을 초과했습니다. 잠시 후 다시 시도해주세요.');
      }
      if (response.status === 413) {
        throw new Error('음성 파일 크기가 2MB를 초과했습니다.');
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || '음성 분석 결과가 불충분합니다. 직접 입력 화면을 이용해보세요.');
      }

      const result: VoiceAnalysisResult = await response.json();
      onAnalysisComplete(result, recordingDurationMs, audioBlob.type || mimeType);
    } catch (err: any) {
      console.error('Voice analyze failure:', err);
      setErrorMessage(err.message || '네트워크 연결 상태를 확인해주세요.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const examplePrompts = [
    '오늘 이마트에서 장보기 5만 2천 원 신한카드로 결제했어',
    '어제 배민에서 저녁 2만 4천 9백 원 썼어',
    '오늘 월급 350만 원 들어왔어',
    '지난 금요일 병원비 3만 원 현금으로 결제했어',
    '카카오택시 13,500원 국민카드로 결제했어',
  ];

  const formatSeconds = (ms: number) => {
    const sec = Math.min(8, (ms / 1000)).toFixed(1);
    return `${sec}s / 8.0s`;
  };

  return (
    <div className="space-y-4">
      {/* Privacy Guard Notice */}
      <div className="flex items-start gap-2 bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-400">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <p className="leading-tight">
          녹음된 음성은 거래 분석을 위해 Gemini로 전송됩니다. 음성 원본은 저장하지 않으며, 확인된 음성 원문과 거래 정보만 저장할 수 있습니다.
        </p>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Mic Recording Stage */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 text-center space-y-4 relative overflow-hidden">
        {!isRecording && !audioBlob && (
          <div className="space-y-4">
            <div className="relative inline-block">
              <button
                onClick={startRecording}
                className="w-20 h-20 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center mx-auto shadow-lg shadow-rose-950/50 transition-all hover:scale-105 active:scale-95 group"
                title="녹음 시작"
                aria-label="음성 녹음 시작"
              >
                <Mic className="w-9 h-9 group-hover:scale-110 transition-transform" />
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-200">버튼을 누르고 짧게 말해주세요</p>
              <p className="text-xs text-slate-400">최대 8초 동안 수입/지출 내역을 음성으로 전달할 수 있습니다.</p>
            </div>

            {/* Example Presets */}
            <div className="pt-2 border-t border-slate-900 text-left space-y-1.5">
              <p className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>이렇게 말해보세요:</span>
              </p>
              <div className="space-y-1">
                {examplePrompts.map((p) => (
                  <div
                    key={p}
                    className="text-xs bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2.5 py-1.5"
                  >
                    "{p}"
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Recording Active State */}
        {isRecording && (
          <div className="space-y-5 py-2">
            <div className="relative inline-block">
              <div className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping" />
              <div className="w-20 h-20 rounded-full bg-rose-600 text-white flex items-center justify-center mx-auto relative z-10 shadow-xl">
                <Mic className="w-9 h-9 animate-pulse" />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-center gap-2 text-rose-400 font-mono font-extrabold text-base">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                <span>{formatSeconds(recordingDurationMs)}</span>
              </div>
              <p className="text-xs text-slate-400">음성을 분석 중입니다. 말씀이 끝나면 중지를 눌러주세요.</p>
            </div>

            {/* Live Real-time Volume Bar */}
            <div className="w-48 mx-auto bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-rose-500 to-amber-400 h-full transition-all duration-75"
                style={{ width: `${Math.max(5, volumeLevel)}%` }}
              />
            </div>

            <button
              onClick={stopRecording}
              className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-colors border border-slate-700"
            >
              <Square className="w-4 h-4 text-rose-400 fill-rose-400" />
              <span>녹음 중지</span>
            </button>
          </div>
        )}

        {/* Has Recorded Audio Preview State */}
        {!isRecording && audioBlob && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 py-2 px-3 rounded-xl max-w-xs mx-auto">
              <Volume2 className="w-4 h-4" />
              <span>음성 녹음 완료 ({(recordingDurationMs / 1000).toFixed(1)}초)</span>
            </div>

            {audioUrl && (
              <div className="max-w-xs mx-auto">
                <audio src={audioUrl} controls className="w-full h-10 rounded-lg" />
              </div>
            )}

            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={handleReRecord}
                disabled={isAnalyzing}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-700 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>다시 녹음</span>
              </button>

              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-lg shadow-rose-950/40"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Gemini 정밀 분석 중...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>음성 분석하기</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
