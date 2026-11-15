import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Camera,
  Split,
  Eye,
  Sparkles,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize,
  Eraser,
  ShieldCheck,
  Network,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Crosshair,
  MoreVertical,
  Trash2,
  ImagePlus,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { FaceLandmarks } from '../types/face';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';

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
    rescanFaces,
    refocusSignal,
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
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    dist: number;
    zoom: number;
    midX: number;
    midY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const didPanDragRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Geometric Mesh & Manual Landmark Nudge state
  const [selectedLandmarkKey, setSelectedLandmarkKey] = useState<string | null>('nose');
  const [draggingLandmarkKey, setDraggingLandmarkKey] = useState<string | null>(null);
  const [nudgeStep, setNudgeStep] = useState<number>(2);

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

  const clampZoom = (z: number) => Math.max(0.6, Math.min(4.0, z));

  const clampPan = useCallback((px: number, py: number, z: number) => {
    const container = containerRef.current;
    if (!container || z <= 1.01) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const maxX = rect.width * (z - 1) * 0.55 + 80;
    const maxY = rect.height * (z - 1) * 0.55 + 80;
    return {
      x: Math.max(-maxX, Math.min(maxX, px)),
      y: Math.max(-maxY, Math.min(maxY, py)),
    };
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [targetImageUrl, resetView]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const prevLargestFaceRef = useRef<{
    url: string;
    cx: number;
    cy: number;
    area: number;
  } | null>(null);

  const focusCameraOnLargestFace = useCallback(() => {
    const canvas = outputCanvasRef.current;
    if (!canvas || detectedFaces.length === 0 || canvas.width === 0 || canvas.height === 0) {
      return;
    }

    const largest = detectedFaces.reduce((best, f) =>
      f.box.width * f.box.height > best.box.width * best.box.height ? f : best
    );

    if (largest.id !== selectedFaceId) {
      setSelectedFaceId(largest.id);
    }

    const rect = canvas.getBoundingClientRect();
    const curZoom = zoomRef.current || 1;
    const baseW = rect.width / curZoom;
    const baseH = rect.height / curZoom;
    if (baseW <= 0 || baseH <= 0) return;

    const fx = (largest.box.x + largest.box.width / 2) / canvas.width;
    const fy = (largest.box.y + largest.box.height / 2) / canvas.height;
    const nx = (fx - 0.5) * baseW;
    const ny = (fy - 0.5) * baseH;

    const targetZoom = clampZoom(
      Math.max(1.35, Math.min(2.4, 0.42 / Math.max(0.15, largest.box.height / canvas.height)))
    );
    const targetPan = clampPan(-nx * targetZoom, -ny * targetZoom, targetZoom);

    setZoom(targetZoom);
    setPan(targetPan);

    prevLargestFaceRef.current = {
      url: targetImageUrl,
      cx: largest.box.x + largest.box.width / 2,
      cy: largest.box.y + largest.box.height / 2,
      area: largest.box.width * largest.box.height,
    };
  }, [
    clampPan,
    detectedFaces,
    outputCanvasRef,
    selectedFaceId,
    setSelectedFaceId,
    targetImageUrl,
  ]);

  // Manual Auto-Refocus trigger from AdjustmentPanel
  useEffect(() => {
    if (refocusSignal > 0) {
      focusCameraOnLargestFace();
    }
  }, [refocusSignal, focusCameraOnLargestFace]);

  // Automatic refocus when a sudden positional/size shift occurs in the largest detected face
  useEffect(() => {
    if (!targetImageUrl || detectedFaces.length === 0) {
      prevLargestFaceRef.current = null;
      return;
    }

    const canvas = outputCanvasRef.current;
    const cw = canvas?.width || targetImageElement?.naturalWidth || 0;
    if (cw <= 0) return;

    const largest = detectedFaces.reduce((best, f) =>
      f.box.width * f.box.height > best.box.width * best.box.height ? f : best
    );
    const cx = largest.box.x + largest.box.width / 2;
    const cy = largest.box.y + largest.box.height / 2;
    const area = largest.box.width * largest.box.height;

    const prev = prevLargestFaceRef.current;
    if (!prev || prev.url !== targetImageUrl) {
      prevLargestFaceRef.current = { url: targetImageUrl, cx, cy, area };
      return;
    }

    const shiftRatio = Math.hypot(cx - prev.cx, cy - prev.cy) / cw;
    const areaDeltaRatio = Math.abs(area - prev.area) / Math.max(1, prev.area);

    if (adjustments.autoRefocus && (shiftRatio > 0.08 || areaDeltaRatio > 0.25)) {
      focusCameraOnLargestFace();
    } else {
      prevLargestFaceRef.current = { url: targetImageUrl, cx, cy, area };
    }
  }, [
    adjustments.autoRefocus,
    detectedFaces,
    focusCameraOnLargestFace,
    outputCanvasRef,
    targetImageElement,
    targetImageUrl,
  ]);

  // Smooth wheel / trackpad pinch zoom centered on pointer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!targetImageElement) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const factor = e.ctrlKey ? 1 - e.deltaY * 0.01 : e.deltaY < 0 ? 1.12 : 0.89;
      setZoom((prevZoom) => {
        const nextZoom = clampZoom(prevZoom * factor);
        const ratio = nextZoom / prevZoom;
        setPan((prevPan) =>
          clampPan(cx - (cx - prevPan.x) * ratio, cy - (cy - prevPan.y) * ratio, nextZoom)
        );
        return nextZoom;
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [clampPan, targetImageElement]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!targetImageElement) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2) {
      setIsPainting(false);
      setIsDraggingSplit(false);
      setIsPanning(true);
      panStartRef.current = null;
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      pinchStartRef.current = {
        dist: Math.max(10, dist),
        zoom,
        midX,
        midY,
        panX: pan.x,
        panY: pan.y,
      };
      return;
    }

    if (adjustments.brushMode !== 'none') {
      setIsPainting(true);
      handleBrushStroke(e.clientX, e.clientY);
      return;
    }

    if (compareMode === 'split' && zoom <= 1.02) {
      setIsDraggingSplit(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (zoom > 1.02 || e.button === 1) {
      didPanDragRef.current = false;
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointersRef.current.size === 2 && pinchStartRef.current && containerRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const curDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const curMidX = (pts[0].x + pts[1].x) / 2;
      const curMidY = (pts[0].y + pts[1].y) / 2;

      const start = pinchStartRef.current;
      const nextZoom = clampZoom(start.zoom * (curDist / start.dist));
      const rect = containerRef.current.getBoundingClientRect();
      const relMidX = start.midX - rect.left - rect.width / 2;
      const relMidY = start.midY - rect.top - rect.height / 2;
      const scaleRatio = nextZoom / start.zoom;

      const dxMid = curMidX - start.midX;
      const dyMid = curMidY - start.midY;

      const targetPanX = relMidX - (relMidX - start.panX) * scaleRatio + dxMid;
      const targetPanY = relMidY - (relMidY - start.panY) * scaleRatio + dyMid;

      setZoom(nextZoom);
      setPan(clampPan(targetPanX, targetPanY, nextZoom));
      return;
    }

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
      const rect =
        outputCanvasRef.current?.getBoundingClientRect() || containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSplitPos(pct);
      return;
    }

    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      if (Math.hypot(dx, dy) > 4) {
        didPanDragRef.current = true;
      }
      setPan(clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy, zoom));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      setIsPainting(false);
      setIsDraggingSplit(false);
      setIsPanning(false);
      panStartRef.current = null;
    }
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

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

  const handleNudgeDirection = (dx: number, dy: number) => {
    if (!activeFace || !selectedLandmarkKey) return;
    updateFaceLandmark(
      activeFace.id,
      selectedLandmarkKey,
      { x: dx * nudgeStep, y: dy * nudgeStep },
      true
    );
  };

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

  const loadFileAsTarget = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setTargetImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadFileAsTarget(file);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      loadFileAsTarget(file);
    }
  };

  const canvasW = outputCanvasRef.current?.width || targetImageElement?.naturalWidth || 1000;
  const canvasH = outputCanvasRef.current?.height || targetImageElement?.naturalHeight || 1000;

  return (
    <div
      className="flex flex-col h-full bg-slate-900/40 dark:bg-slate-950/80 relative overflow-hidden select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Hidden Gallery Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Top Action & Viewport Toolbar — unclipped buttons, secondary tools inside Menu */}
      <div className="px-2.5 sm:px-3 py-2 flex items-center justify-between gap-2 z-20 bg-gradient-to-b from-black/70 via-black/35 to-transparent shrink-0">
        {/* Left: Target Photo Source Actions (Gallery + Camera) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm whitespace-nowrap shrink-0 transition-colors"
            title="Choose target photo from gallery"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>Gallery</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCameraModal(true)}
            className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-100 border border-white/15 shadow-sm whitespace-nowrap shrink-0 transition-colors"
            title="Take target photo with camera"
          >
            <Camera className="w-3.5 h-3.5 shrink-0" />
            <span>Camera</span>
          </button>
        </div>

        {/* Right: Viewport Inspection Tools & Overflow Menu */}
        <div className="flex items-center gap-1 relative shrink-0">
          {targetImageUrl && (
            <div className="flex items-center gap-0.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() =>
                  updateAdjustments(
                    { showFaceLandmarks: !adjustments.showFaceLandmarks },
                    !adjustments.showFaceLandmarks
                      ? 'Face Landmarks Wireframe Shown'
                      : 'Face Landmarks Wireframe Hidden'
                  )
                }
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adjustments.showFaceLandmarks
                    ? 'bg-sky-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Show Face Landmarks Wireframe Grid"
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Landmarks</span>
              </button>

              <button
                type="button"
                onClick={() => updateAdjustments({ showGeometricMesh: !adjustments.showGeometricMesh })}
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adjustments.showGeometricMesh
                    ? 'bg-cyan-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Geometric Mesh & Manual Nudge"
              >
                <Network className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Mesh</span>
              </button>

              <button
                type="button"
                onClick={() => updateAdjustments({ showMaskOverlay: !adjustments.showMaskOverlay })}
                className={`hidden sm:flex p-1.5 sm:px-2 rounded text-xs items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adjustments.showMaskOverlay
                    ? 'bg-emerald-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Protected Hair & Accessory Mask"
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Mask</span>
              </button>

              <button
                type="button"
                onClick={() => setCompareMode(compareMode === 'split' ? 'off' : 'split')}
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  compareMode === 'split'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Before / After Split"
              >
                <Split className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline text-[11px]">Split</span>
              </button>

              <button
                type="button"
                onPointerDown={() => setIsPeekingOriginal(true)}
                onPointerUp={() => setIsPeekingOriginal(false)}
                onPointerLeave={() => setIsPeekingOriginal(false)}
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  isPeekingOriginal
                    ? 'bg-amber-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Hold to Peek Original"
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline text-[11px]">Peek</span>
              </button>
            </div>
          )}

          {/* Overflow Viewport Menu */}
          {targetImageUrl && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowToolsMenu((prev) => !prev)}
                aria-label="More viewport options"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-black/60 hover:bg-black/80 text-slate-200 border border-white/10 transition-colors"
                title="Viewport menu"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showToolsMenu && (
                <div
                  className="absolute right-0 mt-1.5 w-48 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl py-1.5 z-50 backdrop-blur-md text-xs text-slate-200"
                  onMouseLeave={() => setShowToolsMenu(false)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      rescanFaces();
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Rescan Faces</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      updateAdjustments({ showMaskOverlay: !adjustments.showMaskOverlay });
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 sm:hidden"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{adjustments.showMaskOverlay ? 'Hide Protection Mask' : 'Show Protection Mask'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      resetView();
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2"
                  >
                    <Maximize className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Reset Zoom &amp; Pan</span>
                  </button>
                  <div className="my-1 border-t border-slate-800" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setTargetImageUrl('');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-rose-950/60 text-rose-400 flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Photo</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Floating Geometric Landmark Mesh Active Banner */}
      {adjustments.showGeometricMesh && activeFace && (
        <div className="mx-3 mb-1 px-3 py-1.5 rounded-xl bg-slate-900/95 border border-cyan-500/50 backdrop-blur-md flex items-center justify-between text-xs z-30 shadow-lg">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-semibold text-slate-100">Geometric Landmark Mesh Active</span>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              · Drag handles on face or use arrow keys to adjust alignment
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {activeFace.isLandmarksEdited && (
              <button
                type="button"
                onClick={() => resetFaceLandmarks(activeFace.id)}
                className="px-2 py-0.5 rounded text-[11px] text-amber-400 hover:bg-amber-950/60 font-medium transition-colors flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
            <button
              type="button"
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
        <div className="mx-3 mb-1 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-indigo-500/50 backdrop-blur-md flex items-center justify-between text-xs z-30 shadow-lg">
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
                type="button"
                onClick={clearManualMask}
                className="px-2 py-0.5 rounded text-[11px] text-rose-400 hover:bg-rose-950/60 font-medium transition-colors flex items-center gap-1"
              >
                <Eraser className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => updateAdjustments({ brushMode: 'none' })}
              className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Interactive Canvas Stage */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (activePointersRef.current.size === 0) {
            setIsPainting(false);
            setIsPanning(false);
          }
          setBrushHover((prev) => ({ ...prev, visible: false }));
        }}
        onDoubleClick={() => {
          if (targetImageElement && adjustments.brushMode === 'none') {
            if (zoom > 1.05) {
              resetView();
            } else {
              setZoom(2);
            }
          }
        }}
        className={`flex-1 relative flex items-center justify-center p-2 sm:p-4 overflow-hidden touch-none min-h-0 ${
          adjustments.brushMode !== 'none'
            ? 'cursor-crosshair'
            : zoom > 1.02
            ? isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : ''
        }`}
      >
        {/* Drag-and-drop highlight */}
        {isDragOver && (
          <div className="absolute inset-3 z-40 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-950/60 backdrop-blur-sm flex items-center justify-center text-sm font-semibold text-indigo-100 pointer-events-none">
            Drop photo here to start editing
          </div>
        )}

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
              <span>Scanning faces &amp; processing mask...</span>
            </div>
          </div>
        )}

        {/* Clean Empty State Prompt when no photo is loaded */}
        {!targetImageUrl ? (
          <div className="max-w-md w-full mx-auto p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
              <ImagePlus className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-100">Choose a Photo to Edit</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Pick a portrait or group photo from your gallery, or snap a new photo with your camera. No dummy templates are loaded automatically.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-md transition-colors whitespace-nowrap"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Choose from Gallery</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCameraModal(true)}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Take Camera Photo</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`relative max-w-full max-h-full flex items-center justify-center rounded-xl overflow-hidden shadow-2xl ${
              isPanning ? '' : 'transition-transform duration-100'
            }`}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
          >
            {/* Swapped Render Canvas */}
            <canvas
              ref={outputCanvasRef}
              className={`w-auto h-auto max-w-full max-h-[70vh] md:max-h-[78vh] lg:max-h-[calc(100vh-9.5rem)] object-contain rounded-xl block ${
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

            {/* DETECTED FACE LANDMARKS WIREFRAME GRID OVERLAY */}
            {adjustments.showFaceLandmarks && detectedFaces.length > 0 && outputCanvasRef.current && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-20"
                viewBox={`0 0 ${canvasW} ${canvasH}`}
                preserveAspectRatio="none"
              >
                {detectedFaces.map((face, idx) => {
                  const lm = face.landmarks;
                  const isSelected = face.id === activeFace?.id;
                  const isSwapped = Boolean(face.enabled && face.assignedProfileId);
                  const u = Math.max(1, canvasW / 700);
                  const opacity = isSelected ? 0.96 : 0.65;

                  const eyeDx = lm.rightEye.x - lm.leftEye.x;
                  const eyeDy = lm.rightEye.y - lm.leftEye.y;
                  const eyeDist = Math.hypot(eyeDx, eyeDy) || face.box.width * 0.44;
                  const cosA = eyeDx / eyeDist;
                  const sinA = eyeDy / eyeDist;

                  const rotPt = (cx: number, cy: number, uOff: number, vOff: number) => ({
                    x: cx + uOff * cosA - vOff * sinA,
                    y: cy + uOff * sinA + vOff * cosA,
                  });

                  const eyeRx = eyeDist * 0.22;
                  const eyeRy = eyeDist * 0.11;
                  const leftEyePts = [
                    rotPt(lm.leftEye.x, lm.leftEye.y, -eyeRx, 0),
                    rotPt(lm.leftEye.x, lm.leftEye.y, 0, -eyeRy),
                    rotPt(lm.leftEye.x, lm.leftEye.y, eyeRx, 0),
                    rotPt(lm.leftEye.x, lm.leftEye.y, 0, eyeRy),
                  ];
                  const rightEyePts = [
                    rotPt(lm.rightEye.x, lm.rightEye.y, -eyeRx, 0),
                    rotPt(lm.rightEye.x, lm.rightEye.y, 0, -eyeRy),
                    rotPt(lm.rightEye.x, lm.rightEye.y, eyeRx, 0),
                    rotPt(lm.rightEye.x, lm.rightEye.y, 0, eyeRy),
                  ];

                  const eyeMid = {
                    x: (lm.leftEye.x + lm.rightEye.x) / 2,
                    y: (lm.leftEye.y + lm.rightEye.y) / 2,
                  };
                  const noseWingW = eyeDist * 0.19;
                  const noseWingH = eyeDist * 0.05;
                  const leftNostril = rotPt(lm.nose.x, lm.nose.y, -noseWingW, noseWingH);
                  const rightNostril = rotPt(lm.nose.x, lm.nose.y, noseWingW, noseWingH);

                  const lipHalfH = eyeDist * 0.11;
                  const upperLip = rotPt(lm.mouthCenter.x, lm.mouthCenter.y, 0, -lipHalfH * 0.85);
                  const lowerLip = rotPt(lm.mouthCenter.x, lm.mouthCenter.y, 0, lipHalfH * 1.15);

                  const mapCx = face.box.x + face.box.width / 2 + adjustments.offsetX;
                  const mapCy = face.box.y + face.box.height / 2 + adjustments.offsetY;
                  const mapRx = face.box.width * 0.49 * adjustments.scale;
                  const mapRy = face.box.height * 0.59 * adjustments.scale;
                  const featherPad = Math.max(2, adjustments.featherRadius * 0.25);

                  // Deformable 6x6 Real-Time Wireframe Grid following face scale, pitch, yaw, roll, offset & genderMorph
                  const morphT = Math.max(-1, Math.min(1, adjustments.genderMorph / 100));
                  const pitchRad = ((adjustments.headPitch ?? 0) * Math.PI) / 180;
                  const yawRad = ((adjustments.headYaw ?? 0) * Math.PI) / 180;
                  const sinP = Math.sin(pitchRad);
                  const cosP = Math.cos(pitchRad);
                  const sinY = Math.sin(yawRad);
                  const cosY = Math.cos(yawRad);

                  const gridRows = 6;
                  const gridCols = 6;
                  const gridPts: { x: number; y: number }[][] = [];
                  for (let r = 0; r <= gridRows; r++) {
                    const vNorm = (r / gridRows) * 2 - 1; // -1 forehead .. +1 chin
                    const jawBand = Math.exp(-Math.pow((vNorm - 0.55) / 0.38, 2));
                    const browBand = Math.exp(-Math.pow((vNorm + 0.34) / 0.2, 2));
                    const morphScaleX = 1 + morphT * (0.085 * jawBand + 0.025 * browBand);
                    const vTaper = 1 - 0.12 * Math.max(0, vNorm) - 0.08 * Math.max(0, -vNorm);
                    const row: { x: number; y: number }[] = [];
                    for (let c = 0; c <= gridCols; c++) {
                      const uNorm = (c / gridCols) * 2 - 1;
                      const baseU =
                        uNorm *
                        morphScaleX *
                        vTaper *
                        Math.sqrt(Math.max(0.28, 1 - vNorm * vNorm * 0.44));
                      const baseV = (1 - uNorm * uNorm * 0.18) * vNorm * 0.92;
                      const z0 =
                        0.55 *
                        Math.sqrt(
                          Math.max(0.04, 1 - Math.min(0.95, 0.5 * (baseU * baseU + baseV * baseV)))
                        );
                      const u1 = baseU * cosY + z0 * sinY;
                      const z1 = -baseU * sinY + z0 * cosY;
                      const v2 = baseV * cosP + z1 * sinP;
                      const z2 = baseV * -sinP + z1 * cosP;
                      const persp = 1 + 0.16 * (z2 - 0.55);
                      row.push({
                        x: mapCx + u1 * persp * mapRx,
                        y: mapCy + v2 * persp * mapRy,
                      });
                    }
                    gridPts.push(row);
                  }

                  const gridLines: { x1: number; y1: number; x2: number; y2: number; diag?: boolean }[] = [];
                  for (let r = 0; r <= gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                      gridLines.push({
                        x1: gridPts[r][c].x,
                        y1: gridPts[r][c].y,
                        x2: gridPts[r][c + 1].x,
                        y2: gridPts[r][c + 1].y,
                      });
                    }
                  }
                  for (let c = 0; c <= gridCols; c++) {
                    for (let r = 0; r < gridRows; r++) {
                      gridLines.push({
                        x1: gridPts[r][c].x,
                        y1: gridPts[r][c].y,
                        x2: gridPts[r + 1][c].x,
                        y2: gridPts[r + 1][c].y,
                      });
                    }
                  }
                  for (let r = 0; r < gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                      if ((r + c) % 2 === 0) {
                        gridLines.push({
                          x1: gridPts[r][c].x,
                          y1: gridPts[r][c].y,
                          x2: gridPts[r + 1][c + 1].x,
                          y2: gridPts[r + 1][c + 1].y,
                          diag: true,
                        });
                      } else {
                        gridLines.push({
                          x1: gridPts[r][c + 1].x,
                          y1: gridPts[r][c + 1].y,
                          x2: gridPts[r + 1][c].x,
                          y2: gridPts[r + 1][c].y,
                          diag: true,
                        });
                      }
                    }
                  }

                  return (
                    <g key={face.id} opacity={opacity}>
                      {/* Deformable Wireframe Grid responding live to Scale, Pitch, Yaw, Roll, Offset, Gender Morph & Feather */}
                      <g transform={`rotate(${adjustments.rotation} ${mapCx} ${mapCy})`}>
                        {gridLines.map((seg, sIdx) => (
                          <line
                            key={sIdx}
                            x1={seg.x1}
                            y1={seg.y1}
                            x2={seg.x2}
                            y2={seg.y2}
                            stroke={
                              seg.diag
                                ? 'rgba(56, 189, 248, 0.16)'
                                : 'rgba(56, 189, 248, 0.34)'
                            }
                            strokeWidth={(seg.diag ? 0.7 : 0.95) * u}
                          />
                        ))}
                        {isSwapped && (
                          <ellipse
                            cx={mapCx}
                            cy={mapCy}
                            rx={(mapRx + featherPad) * Math.max(0.8, cosY)}
                            ry={(mapRy + featherPad) * Math.max(0.8, cosP)}
                            fill="none"
                            stroke="rgba(52, 211, 153, 0.45)"
                            strokeWidth={0.9 * u}
                            strokeDasharray={`${2.5 * u} ${2.5 * u}`}
                          />
                        )}
                      </g>

                      {lm.contour.length > 2 && (
                        <polygon
                          points={lm.contour.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke="rgba(56, 189, 248, 0.45)"
                          strokeWidth={1.1 * u}
                          strokeDasharray={`${3 * u} ${2.5 * u}`}
                        />
                      )}

                      {isSwapped && (
                        <g transform={`rotate(${adjustments.rotation} ${mapCx} ${mapCy})`}>
                          <ellipse
                            cx={mapCx}
                            cy={mapCy}
                            rx={mapRx}
                            ry={mapRy}
                            fill="none"
                            stroke="rgba(52, 211, 153, 0.78)"
                            strokeWidth={1.4 * u}
                            strokeDasharray={`${5 * u} ${3 * u}`}
                          />
                          <line
                            x1={mapCx - 8 * u}
                            y1={mapCy}
                            x2={mapCx + 8 * u}
                            y2={mapCy}
                            stroke="rgba(52, 211, 153, 0.9)"
                            strokeWidth={1.2 * u}
                          />
                          <line
                            x1={mapCx}
                            y1={mapCy - 8 * u}
                            x2={mapCx}
                            y2={mapCy + 8 * u}
                            stroke="rgba(52, 211, 153, 0.9)"
                            strokeWidth={1.2 * u}
                          />
                        </g>
                      )}

                      <g stroke="rgba(129, 140, 248, 0.52)" strokeWidth={1.1 * u}>
                        <line x1={lm.forehead.x} y1={lm.forehead.y} x2={lm.leftEye.x} y2={lm.leftEye.y} />
                        <line x1={lm.forehead.x} y1={lm.forehead.y} x2={lm.rightEye.x} y2={lm.rightEye.y} />
                        <line x1={lm.forehead.x} y1={lm.forehead.y} x2={eyeMid.x} y2={eyeMid.y} strokeDasharray={`${2 * u} ${2 * u}`} />
                        <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.nose.x} y2={lm.nose.y} />
                        <line x1={lm.rightEye.x} y1={lm.rightEye.y} x2={lm.nose.x} y2={lm.nose.y} />
                        <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.mouthLeft.x} y2={lm.mouthLeft.y} />
                        <line x1={lm.rightEye.x} y1={lm.rightEye.y} x2={lm.mouthRight.x} y2={lm.mouthRight.y} />
                        <line x1={leftNostril.x} y1={leftNostril.y} x2={lm.mouthLeft.x} y2={lm.mouthLeft.y} />
                        <line x1={rightNostril.x} y1={rightNostril.y} x2={lm.mouthRight.x} y2={lm.mouthRight.y} />
                        <line x1={lm.mouthLeft.x} y1={lm.mouthLeft.y} x2={lm.chin.x} y2={lm.chin.y} />
                        <line x1={lm.mouthRight.x} y1={lm.mouthRight.y} x2={lm.chin.x} y2={lm.chin.y} />
                        <line x1={lm.mouthCenter.x} y1={lm.mouthCenter.y} x2={lm.chin.x} y2={lm.chin.y} />
                      </g>

                      <g stroke="#38bdf8" strokeWidth={1.5 * u} fill="rgba(56, 189, 248, 0.08)">
                        <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.rightEye.x} y2={lm.rightEye.y} strokeDasharray={`${3 * u} ${2 * u}`} />
                        <polygon points={leftEyePts.map((p) => `${p.x},${p.y}`).join(' ')} />
                        <polygon points={rightEyePts.map((p) => `${p.x},${p.y}`).join(' ')} />
                        <circle cx={lm.leftEye.x} cy={lm.leftEye.y} r={2.8 * u} fill="#38bdf8" stroke="#ffffff" strokeWidth={0.9 * u} />
                        <circle cx={lm.rightEye.x} cy={lm.rightEye.y} r={2.8 * u} fill="#38bdf8" stroke="#ffffff" strokeWidth={0.9 * u} />
                      </g>

                      <g stroke="#fbbf24" strokeWidth={1.5 * u} fill="rgba(251, 191, 36, 0.08)">
                        <polygon points={`${eyeMid.x},${eyeMid.y} ${leftNostril.x},${leftNostril.y} ${lm.nose.x},${lm.nose.y} ${rightNostril.x},${rightNostril.y}`} />
                        <line x1={lm.nose.x} y1={lm.nose.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} strokeDasharray={`${2 * u} ${2 * u}`} />
                        <circle cx={lm.nose.x} cy={lm.nose.y} r={2.8 * u} fill="#f59e0b" stroke="#ffffff" strokeWidth={0.9 * u} />
                      </g>

                      <g stroke="#fb7185" strokeWidth={1.5 * u} fill="rgba(251, 113, 133, 0.1)">
                        <polygon points={`${lm.mouthLeft.x},${lm.mouthLeft.y} ${upperLip.x},${upperLip.y} ${lm.mouthRight.x},${lm.mouthRight.y} ${lowerLip.x},${lowerLip.y}`} />
                        <line x1={lm.mouthLeft.x} y1={lm.mouthLeft.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} />
                        <line x1={lm.mouthCenter.x} y1={lm.mouthCenter.y} x2={lm.mouthRight.x} y2={lm.mouthRight.y} />
                        <circle cx={lm.mouthLeft.x} cy={lm.mouthLeft.y} r={2.3 * u} fill="#f43f5e" stroke="#ffffff" strokeWidth={0.8 * u} />
                        <circle cx={lm.mouthCenter.x} cy={lm.mouthCenter.y} r={2.5 * u} fill="#ec4899" stroke="#ffffff" strokeWidth={0.8 * u} />
                        <circle cx={lm.mouthRight.x} cy={lm.mouthRight.y} r={2.3 * u} fill="#f43f5e" stroke="#ffffff" strokeWidth={0.8 * u} />
                      </g>

                      <circle cx={lm.forehead.x} cy={lm.forehead.y} r={2.3 * u} fill="#818cf8" stroke="#ffffff" strokeWidth={0.8 * u} />
                      <circle cx={lm.chin.x} cy={lm.chin.y} r={2.3 * u} fill="#34d399" stroke="#ffffff" strokeWidth={0.8 * u} />

                      <g transform={`translate(${face.box.x}, ${Math.max(14 * u, face.box.y - 6 * u)})`}>
                        <rect
                          x={0}
                          y={-11 * u}
                          width={(isSwapped ? 104 : 66) * u}
                          height={13 * u}
                          rx={3 * u}
                          fill="rgba(15, 23, 42, 0.85)"
                          stroke={isSwapped ? 'rgba(52, 211, 153, 0.7)' : 'rgba(56, 189, 248, 0.6)'}
                          strokeWidth={0.8 * u}
                        />
                        <text
                          x={4 * u}
                          y={-2 * u}
                          fill="#f8fafc"
                          fontSize={8.5 * u}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontWeight="600"
                        >
                          {`#${idx + 1} ${Math.round(face.confidence * 100)}%${isSwapped ? ' · Mapped' : ''}`}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>
            )}

            {/* GEOMETRIC MESH OVERLAY & MANUAL LANDMARK NUDGE HANDLES */}
            {adjustments.showGeometricMesh && activeFace && outputCanvasRef.current && (
              <div className="absolute inset-0 pointer-events-none z-30">
                <svg
                  className="w-full h-full pointer-events-none"
                  viewBox={`0 0 ${canvasW} ${canvasH}`}
                  preserveAspectRatio="none"
                >
                  {(() => {
                    const lm = activeFace.landmarks;
                    return (
                      <g stroke="rgba(56, 189, 248, 0.65)" strokeWidth="1.5">
                        <line x1={lm.forehead.x} y1={lm.forehead.y} x2={lm.leftEye.x} y2={lm.leftEye.y} strokeDasharray="3 3" />
                        <line x1={lm.forehead.x} y1={lm.forehead.y} x2={lm.rightEye.x} y2={lm.rightEye.y} strokeDasharray="3 3" />
                        <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.rightEye.x} y2={lm.rightEye.y} stroke="rgba(56, 189, 248, 0.9)" strokeWidth="2" />
                        <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.nose.x} y2={lm.nose.y} />
                        <line x1={lm.rightEye.x} y1={lm.rightEye.y} x2={lm.nose.x} y2={lm.nose.y} />
                        <line x1={lm.leftEye.x} y1={lm.leftEye.y} x2={lm.mouthLeft.x} y2={lm.mouthLeft.y} stroke="rgba(99, 102, 241, 0.45)" strokeDasharray="2 2" />
                        <line x1={lm.rightEye.x} y1={lm.rightEye.y} x2={lm.mouthRight.x} y2={lm.mouthRight.y} stroke="rgba(99, 102, 241, 0.45)" strokeDasharray="2 2" />
                        <line x1={lm.nose.x} y1={lm.nose.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} stroke="rgba(245, 158, 11, 0.85)" strokeWidth="2" />
                        <line x1={lm.mouthLeft.x} y1={lm.mouthLeft.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} stroke="rgba(244, 63, 94, 0.85)" strokeWidth="2" />
                        <line x1={lm.mouthRight.x} y1={lm.mouthRight.y} x2={lm.mouthCenter.x} y2={lm.mouthCenter.y} stroke="rgba(244, 63, 94, 0.85)" strokeWidth="2" />
                        <line x1={lm.mouthCenter.x} y1={lm.mouthCenter.y} x2={lm.chin.x} y2={lm.chin.y} stroke="rgba(52, 211, 153, 0.85)" strokeWidth="2" />
                        <line x1={lm.mouthLeft.x} y1={lm.mouthLeft.y} x2={lm.chin.x} y2={lm.chin.y} stroke="rgba(52, 211, 153, 0.4)" strokeDasharray="3 3" />
                        <line x1={lm.mouthRight.x} y1={lm.mouthRight.y} x2={lm.chin.x} y2={lm.chin.y} stroke="rgba(52, 211, 153, 0.4)" strokeDasharray="3 3" />
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

                      <div
                        className={`absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold whitespace-nowrap shadow-md pointer-events-none transition-opacity ${
                          isSelected
                            ? 'opacity-100 bg-slate-900 text-white border border-white/20'
                            : 'opacity-0 group-hover:opacity-100 bg-black/80 text-slate-200'
                        }`}
                      >
                        {node.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Standard Interactive Detected Face Overlays */}
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
                    onClick={() => {
                      if (!didPanDragRef.current) setSelectedFaceId(face.id);
                    }}
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
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-black/70 text-slate-200'
                      }`}
                    >
                      <span>Person #{index + 1}</span>
                      {face.assignedProfileId && <Check className="w-2.5 h-2.5 text-emerald-400" />}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* FLOATING LANDMARK NUDGE CONTROLLER HUD */}
        {adjustments.showGeometricMesh && activeFace && selectedLandmarkKey && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-cyan-500/40 rounded-2xl px-3 py-2 shadow-2xl backdrop-blur-md flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">Selected Feature</span>
              <span className="text-xs font-bold text-cyan-300 font-mono capitalize">
                {selectedLandmarkKey.replace(/([A-Z])/g, ' $1')}
              </span>
            </div>

            <div className="h-6 w-px bg-slate-700" />

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleNudgeDirection(-1, 0)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                title="Nudge Left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => handleNudgeDirection(0, -1)}
                  className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                  title="Nudge Up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeDirection(0, 1)}
                  className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                  title="Nudge Down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleNudgeDirection(1, 0)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all shadow-sm"
                title="Nudge Right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="h-6 w-px bg-slate-700" />

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setNudgeStep(1)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
                  nudgeStep === 1
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                1px
              </button>
              <button
                type="button"
                onClick={() => setNudgeStep(4)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
                  nudgeStep === 4
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                4px
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Floating Bar on Canvas — shown when image loaded */}
      {targetImageUrl && (
        <div className="px-3 py-1.5 flex items-center justify-between text-xs text-slate-300 z-10 bg-gradient-to-t from-black/75 via-black/35 to-transparent shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-medium text-slate-200 tabular-nums whitespace-nowrap">
              {detectedFaces.length} {detectedFaces.length === 1 ? 'Face' : 'Faces'} Detected
            </span>
            <span className="text-slate-500 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="text-[11px] text-slate-400 truncate hidden sm:inline">
              {adjustments.showGeometricMesh
                ? 'Geometric Mesh Active'
                : adjustments.showFaceLandmarks
                ? 'Landmarks Wireframe Grid'
                : adjustments.autoMaskHair
                ? 'Hair Protected'
                : 'Full Swap'}
            </span>
          </div>

          <div className="flex items-center gap-0.5 bg-black/55 backdrop-blur-md rounded-lg p-0.5 border border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => {
                const next = clampZoom(zoom - 0.25);
                setZoom(next);
                setPan((p) => clampPan(p.x, p.y, next));
              }}
              className="p-1.5 text-slate-300 hover:text-white rounded transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono tabular-nums px-1.5 text-slate-200 min-w-[42px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => {
                const next = clampZoom(zoom + 0.25);
                setZoom(next);
                setPan((p) => clampPan(p.x, p.y, next));
              }}
              className="p-1.5 text-slate-300 hover:text-white rounded transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="p-1.5 text-slate-300 hover:text-white rounded transition-colors"
              title="Reset Zoom & Pan"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Camera Capture Dialog for Target Photo */}
      <WebcamCaptureDialog
        isOpen={showCameraModal}
        mode="photo"
        onClose={() => setShowCameraModal(false)}
        onCapture={(dataUrl) => setTargetImageUrl(dataUrl)}
      />
    </div>
  );
};
