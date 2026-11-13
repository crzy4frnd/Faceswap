import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Split,
  Eye,
  Sparkles,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize,
  Paintbrush,
  Eraser,
  ShieldCheck,
  X,
  Network,
  RotateCcw,
  Move,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Crosshair,
  Grid,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { SAMPLE_TARGETS } from '../utils/sampleData';
import { FaceLandmarks, Point } from '../types/face';

interface LandmarkNodeConfig {
  key: keyof Omit<FaceLandmarks, 'jawline' | 'contour'>;
  label: string;
  color: string;
  bgColor: string;
}

const PRIMARY_LANDMARKS: LandmarkNodeConfig[] = [
  { key: 'forehead', label: 'Forehead', color: '#818cf8', bgColor: '#4f46e5' },
  { key: 'leftEye', label: 'Left Eye', color: '#38bdf8', bgColor: '#0284c7' },
  { key: 'rightEye', label: 'Right Eye', color: '#38bdf8', bgColor: '#0284c7' },
  { key: 'nose', label: 'Nose Tip', color: '#f59e0b', bgColor: '#d97706' },
  { key: 'mouthLeft', label: 'Left Mouth', color: '#f43f5e', bgColor: '#e11d48' },
  { key: 'mouthRight', label: 'Right Mouth', color: '#f43f5e', bgColor: '#e11d48' },
  { key: 'mouthCenter', label: 'Lip Center', color: '#ec4899', bgColor: '#db2777' },
  { key: 'chin', label: 'Chin Tip', color: '#34d399', bgColor: '#059669' },
];

export const CanvasViewport: React.FC = () => {
  const {
    targetImageUrl,
    setTargetImageUrl,
    targetImageElement,
    detectedFaces,
    selectedFaceId,
    setSelectedFaceId,
    outputCanvasRef,
    manualMaskCanvasRef,
    setHasManualMaskStrokes,
    triggerRender,
    adjustments,
    updateAdjustments,
    clearManualMask,
    hasManualMaskStrokes,
    isProcessing,
    compareMode,
    setCompareMode,
    splitPos,
    setSplitPos,
    isPeekingOriginal,
    setIsPeekingOriginal,
    updateFaceLandmark,
    resetFaceLandmarks,
  } = useFaceStudio();

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [brushHover, setBrushHover] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Geometric Mesh & Manual Landmark Nudge state
  const [selectedLandmarkKey, setSelectedLandmarkKey] = useState<string | null>('nose');
  const [draggingLandmarkKey, setDraggingLandmarkKey] = useState<string | null>(null);
  const [nudgeStep, setNudgeStep] = useState<number>(2); // 1px or 4px step

  // Currently active face for landmark mesh overlay
  const activeFace =
    detectedFaces.find((f) => f.id === selectedFaceId) || detectedFaces[0] || null;

  // 1. Paint onto manual mask canvas
  const handleBrushStroke = (clientX: number, clientY: number) => {
    if (adjustments.brushMode === 'none' || !outputCanvasRef.current || !manualMaskCanvasRef.current) {
      return;
    }
    const canvas = outputCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    if (screenX < 0 || screenY < 0 || screenX > rect.width || screenY > rect.height) {
      return;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const imgX = screenX * scaleX;
    const imgY = screenY * scaleY;

    const maskCanvas = manualMaskCanvasRef.current;
    if (maskCanvas.width !== canvas.width || maskCanvas.height !== canvas.height) {
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
    }
    const mctx = maskCanvas.getContext('2d');
    if (mctx) {
      mctx.save();
      mctx.beginPath();
      mctx.arc(imgX, imgY, adjustments.brushSize, 0, Math.PI * 2);
      if (adjustments.brushMode === 'protect') {
        mctx.fillStyle = 'rgba(16, 185, 129, 0.95)';
      } else {
        mctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
      }
      mctx.fill();
      mctx.restore();
      setHasManualMaskStrokes(true);
      triggerRender();
    }
  };

  // 2. Handle dragging split slider
  const handlePointerDown = (e: React.PointerEvent) => {
    if (adjustments.brushMode !== 'none') {
      setIsPainting(true);
      handleBrushStroke(e.clientX, e.clientY);
      return;
    }
    if (compareMode === 'split') {
      setIsDraggingSplit(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (adjustments.brushMode !== 'none') {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        setBrushHover({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          visible: true,
        });
      }
      if (isPainting) {
        handleBrushStroke(e.clientX, e.clientY);
      }
      return;
    }

    if (isDraggingSplit && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSplitPos(pct);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsPainting(false);
    setIsDraggingSplit(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // 3. Interactive Landmark Node Pointer Dragging
  const handleLandmarkPointerDown = (e: React.PointerEvent, key: string) => {
    e.stopPropagation();
    setSelectedLandmarkKey(key);
    setDraggingLandmarkKey(key);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleLandmarkPointerMove = (e: React.PointerEvent) => {
    if (!draggingLandmarkKey || !activeFace || !outputCanvasRef.current) return;
    e.stopPropagation();

    const canvas = outputCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const imgX = Math.round(screenX * scaleX);
    const imgY = Math.round(screenY * scaleY);

    updateFaceLandmark(activeFace.id, draggingLandmarkKey, { x: imgX, y: imgY });
  };

  const handleLandmarkPointerUp = (e: React.PointerEvent) => {
    if (draggingLandmarkKey) {
      setDraggingLandmarkKey(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  // 4. Directional step nudge helper
  const handleNudgeDirection = (dx: number, dy: number) => {
    if (!activeFace || !selectedLandmarkKey) return;
    updateFaceLandmark(
      activeFace.id,
      selectedLandmarkKey,
      { x: dx * nudgeStep, y: dy * nudgeStep },
      true
    );
  };

  // 5. Keyboard arrow nudge listener for precision editing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!adjustments.showGeometricMesh || !selectedLandmarkKey || !activeFace) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? nudgeStep * 3 : nudgeStep;
        if (e.key === 'ArrowLeft') updateFaceLandmark(activeFace.id, selectedLandmarkKey, { x: -step, y: 0 }, true);
        if (e.key === 'ArrowRight') updateFaceLandmark(activeFace.id, selectedLandmarkKey, { x: step, y: 0 }, true);
        if (e.key === 'ArrowUp') updateFaceLandmark(activeFace.id, selectedLandmarkKey, { x: 0, y: -step }, true);
        if (e.key === 'ArrowDown') updateFaceLandmark(activeFace.id, selectedLandmarkKey, { x: 0, y: step }, true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [adjustments.showGeometricMesh, selectedLandmarkKey, activeFace, nudgeStep, updateFaceLandmark]);

  // Handle local image upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setTargetImageUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const canvasW = outputCanvasRef.current?.width || 1000;
  const canvasH = outputCanvasRef.current?.height || 1000;

  return (
    <div className="flex flex-col h-full bg-slate-900/40 dark:bg-slate-950/80 relative overflow-hidden select-none">
      {/* Top Controls Overlay */}
      <div className="p-3 flex items-center justify-between gap-2 z-20 bg-gradient-to-b from-black/60 to-transparent">
        {/* Sample Targets & Upload Carousel */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 max-w-[60%]">
          {SAMPLE_TARGETS.map((sample) => {
            const isSelected = targetImageUrl === sample.url;
            return (
              <button
                key={sample.id}
                onClick={() => setTargetImageUrl(sample.url)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-black/40 hover:bg-black/60 text-slate-200 border border-white/10'
                }`}
              >
                <img
                  src={sample.url}
                  alt={sample.title}
                  className="w-4 h-4 rounded-full object-cover"
                />
                <span className="truncate max-w-[80px] sm:max-w-none">{sample.title}</span>
              </button>
            );
          })}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-black/40 hover:bg-black/60 text-slate-200 border border-white/10 whitespace-nowrap transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Photo</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {/* Viewport Tools: Geometric Mesh, Mask Overlay & Comparison */}
        <div className="flex items-center gap-1 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg p-0.5">
          {/* Geometric Landmark Mesh Overlay Toggle */}
          <button
            onClick={() => updateAdjustments({ showGeometricMesh: !adjustments.showGeometricMesh })}
            className={`p-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
              adjustments.showGeometricMesh
                ? 'bg-cyan-600 text-white font-semibold shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
            title="Toggle Geometric Mesh & Manual Landmark Alignment"
          >
            <Network className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Mesh</span>
          </button>

          {/* Quick Mask Overlay Toggle */}
          <button
            onClick={() => updateAdjustments({ showMaskOverlay: !adjustments.showMaskOverlay })}
            className={`p-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
              adjustments.showMaskOverlay
                ? 'bg-emerald-600 text-white font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
            title="Toggle Protected Hair & Accessory Mask Overlay"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Mask</span>
          </button>

          {/* Before/After Split */}
          <button
            onClick={() => setCompareMode(compareMode === 'split' ? 'off' : 'split')}
            className={`p-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
              compareMode === 'split'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
            title="Before / After Split Slider"
          >
            <Split className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Split</span>
          </button>

          {/* Peek Original */}
          <button
            onPointerDown={() => setIsPeekingOriginal(true)}
            onPointerUp={() => setIsPeekingOriginal(false)}
            onPointerLeave={() => setIsPeekingOriginal(false)}
            className={`p-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
              isPeekingOriginal
                ? 'bg-amber-600 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
            title="Hold to Peek Original Image"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Peek</span>
          </button>
        </div>
      </div>

      {/* Floating Geometric Landmark Mesh Active Banner */}
      {adjustments.showGeometricMesh && activeFace && (
        <div className="mx-3 mb-1 px-3 py-1.5 rounded-xl bg-slate-900/95 border border-cyan-500/50 backdrop-blur-md flex items-center justify-between text-xs z-30 shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-semibold text-slate-100">
              Geometric Landmark Mesh Active
            </span>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              · Drag handles on face or use arrow keys to manually correct alignment
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {activeFace.isLandmarksEdited && (
              <button
                onClick={() => resetFaceLandmarks(activeFace.id)}
                className="px-2 py-0.5 rounded text-[11px] text-amber-400 hover:bg-amber-950/60 font-medium transition-colors flex items-center gap-1"
                title="Reset landmarks back to auto-detected position"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
            <button
              onClick={() => updateAdjustments({ showGeometricMesh: false })}
              className="px-2.5 py-0.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-[11px] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Floating Manual Brush Active Banner */}
      {adjustments.brushMode !== 'none' && (
        <div className="mx-3 mb-1 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-indigo-500/50 backdrop-blur-md flex items-center justify-between text-xs z-30 shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                adjustments.brushMode === 'protect' ? 'bg-emerald-400' : 'bg-rose-500'
              }`}
            />
            <span className="font-semibold text-slate-100">
              {adjustments.brushMode === 'protect' ? 'Protect Hair / Accessory' : 'Reveal Face'} Brush Active
            </span>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              · Drag on photo to refine boundaries ({adjustments.brushSize}px)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {hasManualMaskStrokes && (
              <button
                onClick={clearManualMask}
                className="px-2 py-0.5 rounded text-[11px] text-rose-400 hover:bg-rose-950/60 font-medium transition-colors flex items-center gap-1"
                title="Clear all painted brush strokes"
              >
                <Eraser className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
            <button
              onClick={() => updateAdjustments({ brushMode: 'none' })}
              className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Interactive Canvas Area */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setIsPainting(false);
          setBrushHover((prev) => ({ ...prev, visible: false }));
        }}
        className={`flex-1 relative flex items-center justify-center p-2 sm:p-4 overflow-hidden touch-none ${
          adjustments.brushMode !== 'none' ? 'cursor-crosshair' : ''
        }`}
      >
        {/* Interactive Brush Cursor Follower */}
        {adjustments.brushMode !== 'none' && brushHover.visible && (
          <div
            className="absolute rounded-full pointer-events-none z-40 border-2 transition-transform duration-75"
            style={{
              left: `${brushHover.x}px`,
              top: `${brushHover.y}px`,
              width: `${adjustments.brushSize * 2}px`,
              height: `${adjustments.brushSize * 2}px`,
              transform: 'translate(-50%, -50%)',
              borderColor:
                adjustments.brushMode === 'protect'
                  ? 'rgba(52, 211, 153, 0.9)'
                  : 'rgba(239, 68, 68, 0.9)',
              backgroundColor:
                adjustments.brushMode === 'protect'
                  ? 'rgba(52, 211, 153, 0.2)'
                  : 'rgba(239, 68, 68, 0.2)',
            }}
          />
        )}

        {isProcessing && (
          <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-xs flex items-center justify-center">
            <div className="px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-xs font-medium flex items-center gap-2 shadow-xl">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
              <span>Scanning faces & processing auto-mask...</span>
            </div>
          </div>
        )}

        <div
          className="relative max-w-full max-h-full flex items-center justify-center rounded-xl overflow-hidden shadow-2xl transition-transform"
          style={{ transform: `scale(${zoom})` }}
        >
          {/* Swapped Render Canvas */}
          <canvas
            ref={outputCanvasRef}
            className={`max-w-full max-h-[58vh] sm:max-h-[64vh] object-contain rounded-xl block ${
              isPeekingOriginal ? 'opacity-0' : 'opacity-100'
            }`}
          />

          {/* Original Base Target Image (For peek & split comparison) */}
          {targetImageElement && (
            <img
              src={targetImageUrl}
              alt="Original target"
              className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity ${
                isPeekingOriginal
                  ? 'opacity-100'
                  : compareMode === 'split'
                  ? 'opacity-100'
                  : 'opacity-0'
              }`}
              style={
                compareMode === 'split'
                  ? { clipPath: `inset(0 ${100 - splitPos}% 0 0)` }
                  : undefined
              }
            />
          )}

          {/* Split Mode Divider Handle */}
          {compareMode === 'split' && adjustments.brushMode === 'none' && (
            <div
              onPointerDown={handlePointerDown}
              className="absolute top-0 bottom-0 z-20 cursor-ew-resize flex items-center justify-center"
              style={{ left: `${splitPos}%`, transform: 'translateX(-50%)' }}
            >
              <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]" />
              <div className="absolute w-8 h-8 rounded-full bg-white text-slate-900 shadow-xl border border-slate-300 flex items-center justify-center font-bold text-[10px] select-none hover:scale-110 active:scale-95 transition-transform">
                <Split className="w-3.5 h-3.5" />
              </div>
            </div>
          )}

          {/* GEOMETRIC MESH OVERLAY & MANUAL LANDMARK NUDGE HANDLES */}
          {adjustments.showGeometricMesh && activeFace && outputCanvasRef.current && (
            <div className="absolute inset-0 pointer-events-none z-30">
              {/* SVG Geometric Wireframe Lines */}
              <svg
                className="w-full h-full pointer-events-none"
                viewBox={`0 0 ${canvasW} ${canvasH}`}
                preserveAspectRatio="none"
              >
                {/* Structural Facial Feature Wireframe Links */}
                {(() => {
                  const lm = activeFace.landmarks;
                  return (
                    <g stroke="rgba(56, 189, 248, 0.65)" strokeWidth="1.5">
                      {/* Forehead to Eyes */}
                      <line x1={lm.forehead.x} y1={lm.forehead.y} x2={lm.leftEye.x} y2={lm.leftEye.y} strokeDasharray="3 3" />
                      <line x1={lm.forehead.x} y1={lm.forehead.y} x2={lm.rightEye.x} y2={lm.rightEye.y} strokeDasharray="3 3" />

                      {/* Interpupillary Axis */}
                      <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.rightEye.x} y2={lm.rightEye.y} stroke="rgba(56, 189, 248, 0.9)" strokeWidth="2" />

                      {/* Eyes to Nose Bridge */}
                      <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.nose.x} y2={lm.nose.y} />
                      <line x1={lm.rightEye.x} y1={lm.rightEye.y} x2={lm.nose.x} y2={lm.nose.y} />

                      {/* Eyes to Outer Mouth Corners */}
                      <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.mouthLeft.x} y2={lm.mouthLeft.y} stroke="rgba(99, 102, 241, 0.45)" strokeDasharray="2 2" />
                      <line x1={lm.rightEye.x} y1={lm.rightEye.y} x2={lm.mouthRight.x} y2={lm.mouthRight.y} stroke="rgba(99, 102, 241, 0.45)" strokeDasharray="2 2" />

                      {/* Nose to Lip Center */}
                      <line x1={lm.nose.x} y1={lm.nose.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} stroke="rgba(245, 158, 11, 0.85)" strokeWidth="2" />

                      {/* Lip Contour */}
                      <line x1={lm.mouthLeft.x} y1={lm.mouthLeft.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} stroke="rgba(244, 63, 94, 0.85)" strokeWidth="2" />
                      <line x1={lm.mouthRight.x} y1={lm.mouthRight.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} stroke="rgba(244, 63, 94, 0.85)" strokeWidth="2" />

                      {/* Mouth to Chin */}
                      <line x1={lm.mouthCenter.x} y1={lm.mouthCenter.y} x2={lm.chin.x} y2={lm.chin.y} stroke="rgba(52, 211, 153, 0.85)" strokeWidth="2" />
                      <line x1={lm.mouthLeft.x} y1={lm.mouthLeft.y} x2={lm.chin.x} y2={lm.chin.y} stroke="rgba(52, 211, 153, 0.4)" strokeDasharray="3 3" />
                      <line x1={lm.mouthRight.x} y1={lm.mouthRight.y} x2={lm.chin.x} y2={lm.chin.y} stroke="rgba(52, 211, 153, 0.4)" strokeDasharray="3 3" />

                      {/* Jawline & Contour Path */}
                      {lm.jawline.length > 1 && (
                        <polyline
                          points={lm.jawline.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke="rgba(56, 189, 248, 0.45)"
                          strokeWidth="1.5"
                          strokeDasharray="4 3"
                        />
                      )}
                    </g>
                  );
                })()}
              </svg>

              {/* Draggable Landmark Handles */}
              {PRIMARY_LANDMARKS.map((node) => {
                const pt = activeFace.landmarks[node.key];
                const isSelected = selectedLandmarkKey === node.key;
                const isDragging = draggingLandmarkKey === node.key;

                const leftPct = (pt.x / canvasW) * 100;
                const topPct = (pt.y / canvasH) * 100;

                return (
                  <div
                    key={node.key}
                    onPointerDown={(e) => handleLandmarkPointerDown(e, node.key)}
                    onPointerMove={handleLandmarkPointerMove}
                    onPointerUp={handleLandmarkPointerUp}
                    className="absolute pointer-events-auto cursor-move -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  >
                    {/* Pulsing ring when active */}
                    <div
                      className={`relative w-6 h-6 rounded-full flex items-center justify-center transition-transform ${
                        isSelected || isDragging ? 'scale-125' : 'hover:scale-115'
                      }`}
                    >
                      <div
                        className={`absolute inset-0 rounded-full opacity-40 animate-ping ${
                          isSelected ? 'block' : 'hidden'
                        }`}
                        style={{ backgroundColor: node.color }}
                      />
                      <div
                        className="w-3.5 h-3.5 rounded-full border-2 border-white shadow-lg flex items-center justify-center"
                        style={{ backgroundColor: node.bgColor }}
                      >
                        <div className="w-1 h-1 rounded-full bg-white" />
                      </div>
                    </div>

                    {/* Landmark Name Badge */}
                    <div
                      className={`absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold whitespace-nowrap shadow-md pointer-events-none transition-opacity ${
                        isSelected ? 'opacity-100 bg-slate-900 text-white border border-white/20' : 'opacity-0 group-hover:opacity-100 bg-black/80 text-slate-200'
                      }`}
                    >
                      {node.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Standard Interactive Detected Face Overlays (shown when not in mesh mode) */}
          {compareMode === 'off' &&
            adjustments.brushMode === 'none' &&
            !adjustments.showGeometricMesh &&
            !isPeekingOriginal &&
            outputCanvasRef.current &&
            detectedFaces.map((face, index) => {
              const canvas = outputCanvasRef.current!;
              const cw = canvas.width || 1;
              const ch = canvas.height || 1;

              const leftPct = (face.box.x / cw) * 100;
              const topPct = (face.box.y / ch) * 100;
              const widthPct = (face.box.width / cw) * 100;
              const heightPct = (face.box.height / ch) * 100;

              const isSelected = selectedFaceId === face.id;

              return (
                <div
                  key={face.id}
                  onClick={() => setSelectedFaceId(face.id)}
                  className={`absolute rounded-xl transition-all cursor-pointer pointer-events-auto ${
                    isSelected
                      ? 'border-2 border-indigo-500 bg-indigo-500/10 shadow-[0_0_12px_rgba(99,102,241,0.4)]'
                      : 'border border-dashed border-white/50 hover:border-white/90 bg-black/5 hover:bg-black/20'
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: `${widthPct}%`,
                    height: `${heightPct}%`,
                  }}
                  title={`Face ${index + 1}: Click to configure`}
                >
                  <div
                    className={`absolute -top-3 left-2 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm ${
                      isSelected
                        ? 'bg-indigo-600 text-white'
                        : 'bg-black/70 text-slate-200'
                    }`}
                  >
                    <span>Person #{index + 1}</span>
                    {face.assignedProfileId && <Check className="w-2.5 h-2.5 text-emerald-400" />}
                  </div>
                </div>
              );
            })}
        </div>

        {/* FLOATING LANDMARK NUDGE CONTROLLER HUD */}
        {adjustments.showGeometricMesh && activeFace && selectedLandmarkKey && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-cyan-500/40 rounded-2xl px-3 py-2 shadow-2xl backdrop-blur-md flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
            {/* Active Landmark Info */}
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">Selected Feature</span>
              <span className="text-xs font-bold text-cyan-300 font-mono capitalize">
                {selectedLandmarkKey.replace(/([A-Z])/g, ' $1')}
              </span>
            </div>

            <div className="h-6 w-px bg-slate-700" />

            {/* Directional Nudge Pad */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleNudgeDirection(-1, 0)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                title="Nudge Left (or Left Arrow key)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleNudgeDirection(0, -1)}
                  className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                  title="Nudge Up (or Up Arrow key)"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleNudgeDirection(0, 1)}
                  className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                  title="Nudge Down (or Down Arrow key)"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={() => handleNudgeDirection(1, 0)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                title="Nudge Right (or Right Arrow key)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="h-6 w-px bg-slate-700" />

            {/* Step Size Selector */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setNudgeStep(1)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
                  nudgeStep === 1
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="1px Fine Precision Nudge"
              >
                1px
              </button>
              <button
                onClick={() => setNudgeStep(4)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
                  nudgeStep === 4
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="4px Fast Nudge"
              >
                4px
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Floating Bar on Canvas */}
      <div className="p-2 sm:p-3 flex items-center justify-between text-xs text-slate-300 z-10 bg-gradient-to-t from-black/70 via-black/30 to-transparent">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>
              {detectedFaces.length} {detectedFaces.length === 1 ? 'Face' : 'Faces'} Detected
            </span>
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-[11px] text-slate-400">
            {adjustments.showGeometricMesh
              ? 'Geometric Mesh Active'
              : adjustments.autoMaskHair
              ? 'Hair Protected'
              : 'Full Swap'}
          </span>
        </div>

        <div className="flex items-center gap-1 bg-black/40 backdrop-blur-md rounded-lg p-0.5 border border-white/10">
          <button
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))}
            className="p-1 text-slate-300 hover:text-white rounded"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono px-1.5 text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
            className="p-1 text-slate-300 hover:text-white rounded"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1 text-slate-300 hover:text-white rounded"
            title="Reset Zoom"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
