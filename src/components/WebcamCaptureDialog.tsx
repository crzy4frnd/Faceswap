import React, { useEffect, useRef, useState } from 'react';
import { Camera, RotateCw, X, Check, Upload, RefreshCw } from 'lucide-react';

interface WebcamCaptureDialogProps {
  isOpen: boolean;
  mode: 'face' | 'photo';
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}

export const WebcamCaptureDialog: React.FC<WebcamCaptureDialogProps> = ({
  isOpen,
  mode,
  onClose,
  onCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCaptureRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(
    mode === 'face' ? 'user' : 'environment'
  );
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      setCapturedUrl(null);
      setCameraError(null);
      return;
    }

    let cancelled = false;
    const start = async () => {
      setIsStarting(true);
      setCameraError(null);
      stopStream();
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Live browser camera is unavailable.');
        }
        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setCameraError(
            'Camera stream is blocked or unavailable in this browser. Use Device Camera below to capture a photo.'
          );
        }
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    };

    if (!capturedUrl) {
      start();
    }

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isOpen, facingMode, capturedUrl]);

  if (!isOpen) return null;

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    setCapturedUrl(dataUrl);
    stopStream();
  };

  const handleNativeCaptureFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onCapture(reader.result);
        onClose();
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = () => {
    if (!capturedUrl) return;
    onCapture(capturedUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {mode === 'face' ? 'Capture Face via Camera' : 'Take Target Photo'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera capture"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="relative bg-slate-950 aspect-[4/3] flex items-center justify-center overflow-hidden">
          {capturedUrl ? (
            <img
              src={capturedUrl}
              alt="Captured preview"
              className="w-full h-full object-contain"
            />
          ) : cameraError ? (
            <div className="p-6 text-center space-y-3">
              <Camera className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-300 leading-relaxed">{cameraError}</p>
              <button
                type="button"
                onClick={() => nativeCaptureRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>Open Device Camera</span>
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
              />
              {mode === 'face' && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-40 h-52 rounded-full border-2 border-dashed border-cyan-400/75 shadow-[0_0_0_999px_rgba(2,6,23,0.35)]" />
                </div>
              )}
              {isStarting && (
                <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center text-xs text-slate-300">
                  Starting camera...
                </div>
              )}
            </>
          )}

          <input
            ref={nativeCaptureRef}
            type="file"
            accept="image/*"
            capture={facingMode === 'user' ? 'user' : 'environment'}
            className="hidden"
            onChange={handleNativeCaptureFile}
          />
        </div>

        {/* Controls Footer */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          {capturedUrl ? (
            <>
              <button
                type="button"
                onClick={() => setCapturedUrl(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retake</span>
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Check className="w-4 h-4" />
                <span>{mode === 'face' ? 'Use This Face' : 'Use This Photo'}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
                }
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Flip</span>
              </button>

              {!cameraError && (
                <button
                  type="button"
                  onClick={handleSnap}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
                >
                  <Camera className="w-4 h-4" />
                  <span>{mode === 'face' ? 'Capture Face' : 'Take Photo'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => nativeCaptureRef.current?.click()}
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                Device Cam
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
