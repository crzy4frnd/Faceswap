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
  Move,
  RotateCw,
  Pipette,
  ScanLine,
  FlipHorizontal2,
  AlertTriangle,
  ScanFace,
  Plus,
  Columns2,
  MoveHorizontal,
  X,
  Compass,
  Flame,
  Layers,
  Paintbrush,
  Focus,
  Activity,
  Ruler,
  Droplets,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import {
  DetectedFace,
  FACE_COMPOSITE_LAYER_ID,
  FaceLandmarks,
  FaceMetricsReport,
  FocusPeakingColor,
  FocusPeakingStats,
  OcclusionHeatmapStats,
} from '../types/face';
import {
  classifyFaceAngle,
  computeFaceLandmarkMetrics,
  renderFocusPeakingOverlay,
  renderOcclusionHeatmapOverlay,
} from '../utils/faceEngine';
import { downloadCanvasImage } from '../utils/tiffExporter';
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
    isSkinSamplingMode,
    setIsSkinSamplingMode,
    sampleSkinReferenceAt,
    clearSkinReference,
    profiles,
    activeProfileId,
    flipFaceAndAdjust,
    angleScanResults,
    scanAndMatchFaceAngle,
    overrideClosestAngleMatch,
    addAngleToProfile,
    toggleIsolatedLayer,
    detectedCutoutLayers,
  } = useFaceStudio();

  const containerRef = useRef<HTMLDivElement>(null);
  const occlusionHeatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const focusPeakingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [occlusionStats, setOcclusionStats] = useState<OcclusionHeatmapStats | null>(null);
  const [focusPeakingEnabled, setFocusPeakingEnabled] = useState(false);
  const [focusPeakingSensitivity, setFocusPeakingSensitivity] = useState<number>(54);
  const [focusPeakingColor, setFocusPeakingColor] = useState<FocusPeakingColor>('crimson');
  const [focusPeakingDimBg, setFocusPeakingDimBg] = useState(true);
  const [focusPeakingStats, setFocusPeakingStats] = useState<FocusPeakingStats | null>(null);
  const [showFaceMetrics, setShowFaceMetrics] = useState(false);
  const [faceMetrics, setFaceMetrics] = useState<FaceMetricsReport | null>(null);
  const [gestureFeedback, setGestureFeedback] = useState<string | null>(null);
  const gestureFeedbackTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ timeMs: number; x: number; y: number } | null>(null);
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
  const angleUploadInputRef = useRef<HTMLInputElement>(null);

  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [angleUploadWarning, setAngleUploadWarning] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const snapshotResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (snapshotResetTimerRef.current !== null) {
        window.clearTimeout(snapshotResetTimerRef.current);
      }
    };
  }, []);

  const handleCaptureSnapshot = useCallback(async () => {
    const canvas = outputCanvasRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0 || snapshotStatus === 'saving') {
      return;
    }
    setSnapshotStatus('saving');
    try {
      await downloadCanvasImage(canvas, 'png', 1, 'facemorph_snapshot');
      setSnapshotStatus('saved');
      if (snapshotResetTimerRef.current !== null) {
        window.clearTimeout(snapshotResetTimerRef.current);
      }
      snapshotResetTimerRef.current = window.setTimeout(() => {
        setSnapshotStatus('idle');
      }, 1600);
    } catch {
      setSnapshotStatus('idle');
    }
  }, [outputCanvasRef, snapshotStatus]);

  // Interactive Swapped Face Transform Gesture state (pinch-to-scale, 2-finger rotate, 1-finger drag)
  const [faceTransformMode, setFaceTransformMode] = useState(false);
  const [activeFaceGestureHud, setActiveFaceGestureHud] = useState<{
    scale: number;
    rotation: number;
  } | null>(null);
  const faceGestureRef = useRef<{
    mode: 'drag' | 'pinch-rotate';
    startMidX: number;
    startMidY: number;
    startDist: number;
    prevAngleRad: number;
    accumulatedAngleDeg: number;
    startScale: number;
    startRotation: number;
    startOffsetX: number;
    startOffsetY: number;
    pxPerScreenX: number;
    pxPerScreenY: number;
    didModify: boolean;
  } | null>(null);

  // Real-time Target-Body Skin Reference Sampling state
  const isSamplingSkinDragRef = useRef(false);
  const lastSkinSampleNormRef = useRef<{ normX: number; normY: number } | null>(null);

  // Geometric Mesh & Manual Landmark Nudge state
  const [selectedLandmarkKey, setSelectedLandmarkKey] = useState<string | null>('nose');
  const [draggingLandmarkKey, setDraggingLandmarkKey] = useState<string | null>(null);
  const [nudgeStep, setNudgeStep] = useState<number>(2);

  // Currently active face for landmark mesh & transform overlays
  const activeFace =
    detectedFaces.find((f) => f.id === selectedFaceId) || detectedFaces[0] || null;
  const hasSwappedFace = detectedFaces.some((f) => f.enabled && Boolean(f.assignedProfileId));

  const lastBrushImgPosRef = useRef<{ x: number; y: number } | null>(null);

  // 1. Paint smooth feathered strokes onto manual segmentation mask canvas
  const handleBrushStroke = (clientX: number, clientY: number, isStartStroke: boolean = false) => {
    if (adjustments.brushMode === 'none' || !outputCanvasRef.current || !manualMaskCanvasRef.current) {
      return;
    }
    const canvas = outputCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    if (screenX < 0 || screenY < 0 || screenX > rect.width || screenY > rect.height) {
      lastBrushImgPosRef.current = null;
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
    if (!mctx) return;

    const radius = Math.max(2, adjustments.brushSize * ((scaleX + scaleY) * 0.5));
    const featherPct = Math.max(0, Math.min(100, adjustments.brushFeather ?? 40));
    const isAddMask = adjustments.brushMode === 'protect';
    const rgb = isAddMask ? '16, 185, 129' : '244, 63, 94';

    const prev = isStartStroke || !lastBrushImgPosRef.current ? { x: imgX, y: imgY } : lastBrushImgPosRef.current;
    const dist = Math.hypot(imgX - prev.x, imgY - prev.y);
    const stepSize = Math.max(1.5, radius * 0.24);
    const steps = Math.max(1, Math.ceil(dist / stepSize));

    const drawStamp = (sx: number, sy: number) => {
      mctx.save();
      mctx.beginPath();
      mctx.arc(sx, sy, radius, 0, Math.PI * 2);
      if (featherPct <= 2) {
        mctx.fillStyle = `rgba(${rgb}, 0.96)`;
      } else {
        const solidStop = Math.max(0.05, 1 - (featherPct / 100) * 0.88);
        const grad = mctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
        grad.addColorStop(0, `rgba(${rgb}, 0.96)`);
        grad.addColorStop(solidStop, `rgba(${rgb}, 0.92)`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        mctx.fillStyle = grad;
      }
      mctx.fill();
      mctx.restore();
    };

    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 1 : s / steps;
      drawStamp(prev.x + (imgX - prev.x) * t, prev.y + (imgY - prev.y) * t);
    }

    lastBrushImgPosRef.current = { x: imgX, y: imgY };
    setHasManualMaskStrokes(true);
    triggerRender();
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
    setFaceTransformMode(false);
  }, [targetImageUrl, resetView]);

  useEffect(() => {
    if (
      adjustments.brushMode !== 'none' ||
      adjustments.showGeometricMesh ||
      !hasSwappedFace ||
      isSkinSamplingMode
    ) {
      setFaceTransformMode(false);
    }
  }, [adjustments.brushMode, adjustments.showGeometricMesh, hasSwappedFace, isSkinSamplingMode]);

  // Real-time Occlusion Heatmap computation (Sobel edge detection + foreground depth + face-mesh collision)
  useEffect(() => {
    if (!adjustments.showOcclusionHeatmap || !targetImageElement) {
      setOcclusionStats(null);
      const hc = occlusionHeatmapCanvasRef.current;
      if (hc) {
        const hctx = hc.getContext('2d');
        hctx?.clearRect(0, 0, hc.width, hc.height);
      }
      return;
    }

    const canvas = occlusionHeatmapCanvasRef.current;
    if (!canvas) return;
    const stats = renderOcclusionHeatmapOverlay(
      targetImageElement,
      detectedFaces,
      adjustments,
      canvas,
      manualMaskCanvasRef.current
    );
    setOcclusionStats(stats);
  }, [
    adjustments,
    detectedFaces,
    hasManualMaskStrokes,
    manualMaskCanvasRef,
    targetImageElement,
  ]);

  // Real-time Focus Peaking computation on final composited outputCanvasRef
  useEffect(() => {
    const peakingCanvas = focusPeakingCanvasRef.current;
    if (!focusPeakingEnabled || !targetImageUrl || !outputCanvasRef.current) {
      setFocusPeakingStats(null);
      if (peakingCanvas) {
        const pCtx = peakingCanvas.getContext('2d');
        pCtx?.clearRect(0, 0, peakingCanvas.width, peakingCanvas.height);
      }
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || !outputCanvasRef.current || !focusPeakingCanvasRef.current) return;
      const stats = renderFocusPeakingOverlay(
        outputCanvasRef.current,
        detectedFaces,
        focusPeakingCanvasRef.current,
        {
          sensitivityPct: focusPeakingSensitivity,
          color: focusPeakingColor,
          dimBackground: focusPeakingDimBg,
        }
      );
      if (!cancelled) {
        setFocusPeakingStats(stats);
      }
    }, 65);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    focusPeakingEnabled,
    focusPeakingSensitivity,
    focusPeakingColor,
    focusPeakingDimBg,
    targetImageUrl,
    targetImageElement,
    detectedFaces,
    detectedCutoutLayers,
    adjustments,
    hasManualMaskStrokes,
    isProcessing,
    outputCanvasRef,
  ]);

  // Real-Time ML Kit Face Metrics (Symmetry, Interpupillary Distance, Skin Hydration)
  useEffect(() => {
    if (!showFaceMetrics || !targetImageUrl || !activeFace) {
      setFaceMetrics(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const surface = outputCanvasRef.current || targetImageElement;
      const w = outputCanvasRef.current?.width || targetImageElement?.naturalWidth || 1000;
      const h = outputCanvasRef.current?.height || targetImageElement?.naturalHeight || 1000;
      const report = computeFaceLandmarkMetrics(activeFace, surface, w, h);
      setFaceMetrics(report);
    }, 55);
    return () => window.clearTimeout(timer);
  }, [
    showFaceMetrics,
    targetImageUrl,
    activeFace,
    targetImageElement,
    adjustments,
    detectedCutoutLayers,
    isProcessing,
    outputCanvasRef,
  ]);

  useEffect(() => {
    return () => {
      if (gestureFeedbackTimerRef.current !== null) {
        window.clearTimeout(gestureFeedbackTimerRef.current);
      }
    };
  }, []);

  const showTransientGestureFeedback = useCallback((label: string) => {
    setGestureFeedback(label);
    if (gestureFeedbackTimerRef.current !== null) {
      window.clearTimeout(gestureFeedbackTimerRef.current);
    }
    gestureFeedbackTimerRef.current = window.setTimeout(() => {
      setGestureFeedback(null);
    }, 1500);
  }, []);

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

  const findSwappedFaceAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = outputCanvasRef.current;
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const imgX = ((clientX - rect.left) / rect.width) * canvas.width;
      const imgY = ((clientY - rect.top) / rect.height) * canvas.height;

      const swappedFaces = detectedFaces.filter((f) => f.enabled && Boolean(f.assignedProfileId));
      if (swappedFaces.length === 0) return null;

      // Prefer selected face if hit, otherwise any matching swapped face
      const ordered = activeFace
        ? [activeFace, ...swappedFaces.filter((f) => f.id !== activeFace.id)]
        : swappedFaces;

      for (const face of ordered) {
        if (!face.enabled || !face.assignedProfileId) continue;
        const padX = face.box.width * 0.28;
        const padY = face.box.height * 0.28;
        const left = face.box.x + adjustments.offsetX - padX;
        const right = face.box.x + face.box.width + adjustments.offsetX + padX;
        const top = face.box.y + adjustments.offsetY - padY;
        const bottom = face.box.y + face.box.height + adjustments.offsetY + padY;
        if (imgX >= left && imgX <= right && imgY >= top && imgY <= bottom) {
          return face;
        }
      }
      return null;
    },
    [activeFace, adjustments.offsetX, adjustments.offsetY, detectedFaces, outputCanvasRef]
  );

  const findAnyFaceAtClientPoint = useCallback(
    (clientX: number, clientY: number): DetectedFace | null => {
      const canvas = outputCanvasRef.current;
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const imgX = ((clientX - rect.left) / rect.width) * canvas.width;
      const imgY = ((clientY - rect.top) / rect.height) * canvas.height;

      const ordered = activeFace
        ? [activeFace, ...detectedFaces.filter((f) => f.id !== activeFace.id)]
        : detectedFaces;

      for (const face of ordered) {
        const padX = face.box.width * 0.25;
        const padY = face.box.height * 0.25;
        const left = face.box.x + adjustments.offsetX - padX;
        const right = face.box.x + face.box.width + adjustments.offsetX + padX;
        const top = face.box.y + adjustments.offsetY - padY;
        const bottom = face.box.y + face.box.height + adjustments.offsetY + padY;
        if (imgX >= left && imgX <= right && imgY >= top && imgY <= bottom) {
          return face;
        }
      }
      return null;
    },
    [activeFace, adjustments.offsetX, adjustments.offsetY, detectedFaces, outputCanvasRef]
  );

  const zoomViewportToFace = useCallback(
    (face: DetectedFace, targetScale: number = 2.25) => {
      const container = containerRef.current;
      const canvas = outputCanvasRef.current;
      if (!container || !canvas || canvas.width <= 0 || canvas.height <= 0) return;

      const cRect = container.getBoundingClientRect();
      const baseScale = Math.min(cRect.width / canvas.width, cRect.height / canvas.height) || 1;
      const nextZoom = clampZoom(targetScale);
      const faceCx = face.box.x + face.box.width * 0.5;
      const faceCy = face.box.y + face.box.height * 0.5;
      const dxImg = faceCx - canvas.width * 0.5;
      const dyImg = faceCy - canvas.height * 0.5;

      const targetPanX = -dxImg * baseScale * nextZoom;
      const targetPanY = -dyImg * baseScale * nextZoom;

      setZoom(nextZoom);
      setPan(clampPan(targetPanX, targetPanY, nextZoom));
    },
    [clampPan, outputCanvasRef]
  );

  const handleDoubleTapAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!targetImageElement || adjustments.brushMode !== 'none' || isSkinSamplingMode) {
        return;
      }

      const hitFace = findAnyFaceAtClientPoint(clientX, clientY);
      if (hitFace && hitFace.id !== selectedFaceId) {
        setSelectedFaceId(hitFace.id);
      }

      const hasTransformDelta =
        adjustments.scale !== 1 ||
        adjustments.rotation !== 0 ||
        adjustments.offsetX !== 0 ||
        adjustments.offsetY !== 0 ||
        adjustments.headPitch !== 0 ||
        adjustments.headYaw !== 0;

      // Double-tap resets transformation parameters for the selected face segment
      if ((faceTransformMode || hitFace) && hasTransformDelta) {
        updateAdjustments(
          {
            scale: 1,
            rotation: 0,
            offsetX: 0,
            offsetY: 0,
            headPitch: 0,
            headYaw: 0,
          },
          'Reset Face Transform (Double-Tap)'
        );
        showTransientGestureFeedback('Face Transform Reset');
        return;
      }

      if (faceTransformMode) {
        showTransientGestureFeedback('Transform Already Reset');
        return;
      }

      if (zoom > 1.05) {
        resetView();
      } else if (hitFace) {
        zoomViewportToFace(hitFace, 2.25);
        const fIdx = detectedFaces.findIndex((f) => f.id === hitFace.id);
        showTransientGestureFeedback(`Zoomed Face #${fIdx >= 0 ? fIdx + 1 : 1}`);
      } else {
        setZoom(2);
      }
    },
    [
      adjustments.brushMode,
      adjustments.headPitch,
      adjustments.headYaw,
      adjustments.offsetX,
      adjustments.offsetY,
      adjustments.rotation,
      adjustments.scale,
      detectedFaces,
      faceTransformMode,
      findAnyFaceAtClientPoint,
      isSkinSamplingMode,
      resetView,
      selectedFaceId,
      setSelectedFaceId,
      showTransientGestureFeedback,
      targetImageElement,
      updateAdjustments,
      zoom,
      zoomViewportToFace,
    ]
  );

  const getCanvasPxPerScreenPx = useCallback(() => {
    const canvas = outputCanvasRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      return { x: 1, y: 1 };
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: 1, y: 1 };
    }
    return {
      x: canvas.width / rect.width,
      y: canvas.height / rect.height,
    };
  }, [outputCanvasRef]);

  const sampleSkinAtClientPoint = useCallback(
    (clientX: number, clientY: number, requireInsideCanvas: boolean, commitHistory: boolean) => {
      const canvas = outputCanvasRef.current;
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      if (
        requireInsideCanvas &&
        (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
      ) {
        return;
      }

      const normX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      lastSkinSampleNormRef.current = { normX, normY };
      sampleSkinReferenceAt(
        normX,
        normY,
        adjustments.skinReference?.radiusRatio,
        commitHistory
      );
    },
    [adjustments.skinReference?.radiusRatio, outputCanvasRef, sampleSkinReferenceAt]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!targetImageElement) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2) {
      isSamplingSkinDragRef.current = false;
      setIsPainting(false);
      setIsDraggingSplit(false);
      setIsPanning(false);
      didPanDragRef.current = true;
      panStartRef.current = null;
      faceGestureRef.current = null;
      setActiveFaceGestureHud(null);

      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const angleRad = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);

      // Determine whether two-finger pinch/rotate edits the selected face segment (Transform Mode)
      // or performs face-targeted viewport pinch-to-zoom
      const canEditFaceTransform =
        hasSwappedFace &&
        faceTransformMode &&
        !isSkinSamplingMode &&
        adjustments.brushMode === 'none' &&
        !adjustments.showGeometricMesh;

      if (canEditFaceTransform) {
        const hitSwappedFace = findSwappedFaceAtClientPoint(midX, midY);
        if (hitSwappedFace && hitSwappedFace.id !== selectedFaceId) {
          setSelectedFaceId(hitSwappedFace.id);
        }
        const pxRatio = getCanvasPxPerScreenPx();
        pinchStartRef.current = null;
        faceGestureRef.current = {
          mode: 'pinch-rotate',
          startMidX: midX,
          startMidY: midY,
          startDist: Math.max(12, dist),
          prevAngleRad: angleRad,
          accumulatedAngleDeg: 0,
          startScale: adjustments.scale,
          startRotation: adjustments.rotation,
          startOffsetX: adjustments.offsetX,
          startOffsetY: adjustments.offsetY,
          pxPerScreenX: pxRatio.x,
          pxPerScreenY: pxRatio.y,
          didModify: false,
        };
        setActiveFaceGestureHud({
          scale: adjustments.scale,
          rotation: adjustments.rotation,
        });
        for (const pid of activePointersRef.current.keys()) {
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(pid);
          } catch {
            // ignore
          }
        }
        return;
      }

      // Face-targeted pinch-to-zoom: if pinch starts over a specific face, focus & anchor zoom on that face
      const hitTargetFace = findAnyFaceAtClientPoint(midX, midY);
      let pinchAnchorX = midX;
      let pinchAnchorY = midY;
      if (hitTargetFace) {
        if (hitTargetFace.id !== selectedFaceId) {
          setSelectedFaceId(hitTargetFace.id);
        }
        const faceIdx = detectedFaces.findIndex((f) => f.id === hitTargetFace.id);
        showTransientGestureFeedback(`Pinch Zoom · Face #${faceIdx >= 0 ? faceIdx + 1 : 1}`);
        const canvas = outputCanvasRef.current;
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            pinchAnchorX =
              rect.left +
              ((hitTargetFace.box.x + hitTargetFace.box.width * 0.5) / canvas.width) * rect.width;
            pinchAnchorY =
              rect.top +
              ((hitTargetFace.box.y + hitTargetFace.box.height * 0.5) / canvas.height) * rect.height;
          }
        }
      }

      setIsPanning(true);
      pinchStartRef.current = {
        dist: Math.max(10, dist),
        zoom,
        midX: pinchAnchorX,
        midY: pinchAnchorY,
        panX: pan.x,
        panY: pan.y,
      };
      for (const pid of activePointersRef.current.keys()) {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(pid);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (isSkinSamplingMode) {
      isSamplingSkinDragRef.current = true;
      sampleSkinAtClientPoint(e.clientX, e.clientY, true, false);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (adjustments.brushMode !== 'none') {
      setIsPainting(true);
      handleBrushStroke(e.clientX, e.clientY, true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (
      faceTransformMode &&
      hasSwappedFace &&
      !adjustments.showGeometricMesh &&
      compareMode === 'off'
    ) {
      const pxRatio = getCanvasPxPerScreenPx();
      faceGestureRef.current = {
        mode: 'drag',
        startMidX: e.clientX,
        startMidY: e.clientY,
        startDist: 1,
        prevAngleRad: 0,
        accumulatedAngleDeg: 0,
        startScale: adjustments.scale,
        startRotation: adjustments.rotation,
        startOffsetX: adjustments.offsetX,
        startOffsetY: adjustments.offsetY,
        pxPerScreenX: pxRatio.x,
        pxPerScreenY: pxRatio.y,
        didModify: false,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (compareMode === 'split' && zoom <= 1.02) {
      setIsDraggingSplit(true);
      const rect =
        outputCanvasRef.current?.getBoundingClientRect() ||
        containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        setSplitPos(pct);
      }
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

    if (
      activePointersRef.current.size === 2 &&
      faceGestureRef.current &&
      faceGestureRef.current.mode === 'pinch-rotate'
    ) {
      const pts = Array.from(activePointersRef.current.values());
      const curDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const curMidX = (pts[0].x + pts[1].x) / 2;
      const curMidY = (pts[0].y + pts[1].y) / 2;
      const curAngleRad = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);

      const g = faceGestureRef.current;
      let deltaRad = curAngleRad - g.prevAngleRad;
      while (deltaRad > Math.PI) deltaRad -= Math.PI * 2;
      while (deltaRad < -Math.PI) deltaRad += Math.PI * 2;
      g.prevAngleRad = curAngleRad;
      g.accumulatedAngleDeg += (deltaRad * 180) / Math.PI;

      const scaleFactor = curDist / g.startDist;
      const rawScale = g.startScale * scaleFactor;
      const nextScale = Math.round(Math.max(0.75, Math.min(1.45, rawScale)) * 100) / 100;
      const nextRotation = Math.round(
        Math.max(-45, Math.min(45, g.startRotation + g.accumulatedAngleDeg))
      );

      const dxCanvas = (curMidX - g.startMidX) * g.pxPerScreenX;
      const dyCanvas = (curMidY - g.startMidY) * g.pxPerScreenY;
      const nextOffsetX = Math.round(Math.max(-120, Math.min(120, g.startOffsetX + dxCanvas)));
      const nextOffsetY = Math.round(Math.max(-120, Math.min(120, g.startOffsetY + dyCanvas)));

      g.didModify = true;
      setActiveFaceGestureHud({ scale: nextScale, rotation: nextRotation });
      updateAdjustments({
        scale: nextScale,
        rotation: nextRotation,
        offsetX: nextOffsetX,
        offsetY: nextOffsetY,
      });
      return;
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

    if (isSamplingSkinDragRef.current && isSkinSamplingMode) {
      sampleSkinAtClientPoint(e.clientX, e.clientY, false, false);
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

    if (faceGestureRef.current && faceGestureRef.current.mode === 'drag') {
      const g = faceGestureRef.current;
      const dxScreen = e.clientX - g.startMidX;
      const dyScreen = e.clientY - g.startMidY;
      if (Math.hypot(dxScreen, dyScreen) > 2) {
        g.didModify = true;
      }
      const nextOffsetX = Math.round(
        Math.max(-120, Math.min(120, g.startOffsetX + dxScreen * g.pxPerScreenX))
      );
      const nextOffsetY = Math.round(
        Math.max(-120, Math.min(120, g.startOffsetY + dyScreen * g.pxPerScreenY))
      );
      updateAdjustments({ offsetX: nextOffsetX, offsetY: nextOffsetY });
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

    if (activePointersRef.current.size < 2 && faceGestureRef.current?.mode === 'pinch-rotate') {
      if (faceGestureRef.current.didModify) {
        updateAdjustments({}, 'Face Transform Gesture');
      }
      faceGestureRef.current = null;
      setActiveFaceGestureHud(null);
    }

    if (activePointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }

    if (activePointersRef.current.size === 0) {
      const wasDragOrMulti =
        didPanDragRef.current ||
        Boolean(faceGestureRef.current?.didModify) ||
        isPainting ||
        isDraggingSplit ||
        isSamplingSkinDragRef.current;

      if (isSamplingSkinDragRef.current) {
        isSamplingSkinDragRef.current = false;
        const lastNorm = lastSkinSampleNormRef.current;
        if (lastNorm) {
          sampleSkinReferenceAt(
            lastNorm.normX,
            lastNorm.normY,
            adjustments.skinReference?.radiusRatio,
            true
          );
        }
      }
      if (faceGestureRef.current) {
        if (faceGestureRef.current.didModify) {
          updateAdjustments({}, 'Move Swapped Face');
        }
        faceGestureRef.current = null;
      }
      setActiveFaceGestureHud(null);
      setIsPainting(false);
      lastBrushImgPosRef.current = null;
      setIsDraggingSplit(false);
      setIsPanning(false);
      panStartRef.current = null;

      // Touch-friendly double-tap detection for pointerType === 'touch' or 'pen'
      // (Desktop mouse double-click is handled via container onDoubleClick to avoid firing twice)
      if (!wasDragOrMulti && e.pointerType !== 'mouse') {
        const now = performance.now();
        const prevTap = lastTapRef.current;
        if (
          prevTap &&
          now - prevTap.timeMs < 320 &&
          Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < 32
        ) {
          lastTapRef.current = null;
          handleDoubleTapAtPoint(e.clientX, e.clientY);
        } else {
          lastTapRef.current = { timeMs: now, x: e.clientX, y: e.clientY };
        }
      }
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
      <input
        ref={angleUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const profId = activeFace?.assignedProfileId || activeProfileId;
          if (!file || !profId) return;
          setAngleUploadWarning(null);
          const reader = new FileReader();
          reader.onload = async () => {
            if (typeof reader.result === 'string') {
              const res = await addAngleToProfile(profId, reader.result, 'Gallery');
              if (!res.added) {
                setAngleUploadWarning(
                  res.duplicateCheck.reason || 'Duplicate angle photo blocked.'
                );
              }
            }
          };
          reader.readAsDataURL(file);
          e.target.value = '';
        }}
      />

      {/* Top Action & Viewport Toolbar — solid docked bar above canvas, secondary tools inside Menu */}
      <div className="px-2.5 sm:px-3 py-2 flex items-center justify-between gap-2 z-30 bg-slate-950/95 border-b border-slate-800/80 shrink-0">
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
                onClick={() =>
                  updateAdjustments(
                    { showAngleGuide: !adjustments.showAngleGuide },
                    !adjustments.showAngleGuide
                      ? 'Angle Alignment Guide Shown'
                      : 'Angle Alignment Guide Hidden'
                  )
                }
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adjustments.showAngleGuide
                    ? 'bg-emerald-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Angle Alignment Guide (3D Head Yaw, Pitch & Roll Guidelines)"
              >
                <Compass className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Angle</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  updateAdjustments(
                    { showOcclusionHeatmap: !adjustments.showOcclusionHeatmap },
                    !adjustments.showOcclusionHeatmap
                      ? 'Occlusion Heatmap Shown'
                      : 'Occlusion Heatmap Hidden'
                  )
                }
                className={`hidden sm:flex p-1.5 sm:px-2 rounded text-xs items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adjustments.showOcclusionHeatmap
                    ? 'bg-orange-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Real-Time Occlusion Heatmap (Edge & Depth Face Mesh Intersection)"
              >
                <Flame className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Occlusion</span>
              </button>

              {(hasSwappedFace || Boolean(activeFace?.assignedProfileId)) && (
                <>
                  <button
                    type="button"
                    onClick={() => void flipFaceAndAdjust(activeFace?.id)}
                    className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                      adjustments.flipHorizontal
                        ? 'bg-fuchsia-600 text-white font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                    title="Flip Source Face Horizontally & Auto-Adjust to Target Face"
                  >
                    <FlipHorizontal2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden xl:inline text-[11px]">Flip</span>
                  </button>

                  {hasSwappedFace && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !faceTransformMode;
                        setFaceTransformMode(next);
                        if (next) {
                          if (compareMode !== 'off') setCompareMode('off');
                          if (adjustments.showGeometricMesh || adjustments.brushMode !== 'none') {
                            updateAdjustments({ showGeometricMesh: false, brushMode: 'none' });
                          }
                        }
                      }}
                      className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                        faceTransformMode
                          ? 'bg-violet-600 text-white font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                      title="Touch Gesture Transform (Pinch Scale, Two-Finger Rotate & Drag Face)"
                    >
                      <Move className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden xl:inline text-[11px]">Transform</span>
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  const next = !isSkinSamplingMode;
                  setIsSkinSamplingMode(next);
                  if (next) {
                    setFaceTransformMode(false);
                    if (compareMode !== 'off') setCompareMode('off');
                    if (adjustments.showGeometricMesh || adjustments.brushMode !== 'none') {
                      updateAdjustments({ showGeometricMesh: false, brushMode: 'none' });
                    }
                  }
                }}
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  isSkinSamplingMode
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : adjustments.skinReference
                    ? 'bg-indigo-600/80 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Pick Skin Reference from Target Body"
              >
                <Pipette className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Skin Ref</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  updateAdjustments(
                    { previewSegmentation: !adjustments.previewSegmentation },
                    !adjustments.previewSegmentation
                      ? 'Preview Segmentation Enabled'
                      : 'Preview Segmentation Disabled'
                  )
                }
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adjustments.previewSegmentation
                    ? 'bg-cyan-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Preview Segmentation (Highlight Hand, Hair, Jewelry & Face Before Swap)"
              >
                <ScanLine className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Segment</span>
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
                onClick={() => setFocusPeakingEnabled((prev) => !prev)}
                aria-pressed={focusPeakingEnabled}
                aria-label="Focus Peaking"
                className={`flex p-1.5 sm:px-2 rounded text-xs items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  focusPeakingEnabled
                    ? 'bg-rose-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Focus Peaking (Highlight high-contrast sharpest edges before export)"
              >
                <Focus className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Focus</span>
              </button>

              <button
                type="button"
                onClick={() => setShowFaceMetrics((prev) => !prev)}
                aria-pressed={showFaceMetrics}
                aria-label="Face Metrics Overlay"
                className={`flex p-1.5 sm:px-2 rounded text-xs items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  showFaceMetrics
                    ? 'bg-teal-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Real-Time ML Kit Face Metrics (Symmetry, IPD & Skin Hydration)"
              >
                <Activity className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline text-[11px]">Metrics</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setCompareMode(
                    compareMode === 'split' || compareMode === 'side-by-side' ? 'off' : 'split'
                  )
                }
                className={`p-1.5 sm:px-2 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  compareMode === 'split' || compareMode === 'side-by-side'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Compare Before / After (Swipe or Side-by-Side)"
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
                      updateAdjustments(
                        { showOcclusionHeatmap: !adjustments.showOcclusionHeatmap },
                        !adjustments.showOcclusionHeatmap
                          ? 'Occlusion Heatmap Shown'
                          : 'Occlusion Heatmap Hidden'
                      );
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 sm:hidden"
                  >
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    <span>
                      {adjustments.showOcclusionHeatmap
                        ? 'Hide Occlusion Heatmap'
                        : 'Show Occlusion Heatmap'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setFocusPeakingEnabled((prev) => !prev);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2"
                  >
                    <Focus className="w-3.5 h-3.5 text-rose-400" />
                    <span>{focusPeakingEnabled ? 'Hide Focus Peaking' : 'Show Focus Peaking'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowFaceMetrics((prev) => !prev);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2"
                  >
                    <Activity className="w-3.5 h-3.5 text-teal-400" />
                    <span>{showFaceMetrics ? 'Hide Face Metrics' : 'Show Face Metrics'}</span>
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

      {/* Docked Unmatched 96-100% Angle Strip (Prompts to create matching angle face) */}
      {targetImageUrl &&
        adjustments.autoMatchAngle &&
        activeFace &&
        activeFace.angleMatchStatus === 'unmatched' && (
          <div className="px-3 py-1.5 bg-amber-950/90 border-b border-amber-500/50 flex items-center justify-between text-xs z-20 shrink-0 gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-semibold text-amber-100 whitespace-nowrap font-mono tabular-nums">
                {activeFace.angleMatchScore ?? 0}% &lt; {adjustments.minAngleMatchScore}%
              </span>
              <span className="text-amber-200/90 text-[11px] truncate">
                {angleUploadWarning ||
                  `Need ${
                    angleScanResults[activeFace.id]?.requiredAngleLabel || 'matching'
                  } angle face for ${
                    profiles.find((p) => p.id === activeFace.assignedProfileId)?.name || 'profile'
                  } — create or upload matching angle.`}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => angleUploadInputRef.current?.click()}
                className="px-2 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px] flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3 h-3 shrink-0" />
                <span>Add Angle</span>
              </button>
              {profiles.length > 1 && (
                <button
                  type="button"
                  onClick={() => void scanAndMatchFaceAngle(activeFace.id, '__all__')}
                  className="px-2 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <ScanFace className="w-3 h-3 shrink-0" />
                  <span>Scan All</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => overrideClosestAngleMatch(activeFace.id)}
                className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-[11px] transition-colors whitespace-nowrap"
              >
                Use Closest
              </button>
            </div>
          </div>
        )}

      {/* Docked Layer Isolation View Strip */}
      {adjustments.isolatedLayerId && targetImageUrl && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-violet-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="font-semibold text-slate-100 whitespace-nowrap">
              Layer Isolation
            </span>
            <span className="text-slate-300 text-[11px] truncate">
              {adjustments.isolatedLayerId === '__background__'
                ? 'Background Only'
                : adjustments.isolatedLayerId === FACE_COMPOSITE_LAYER_ID ||
                  adjustments.isolatedLayerId === 'cat:skin'
                ? 'Skin / Face Layer'
                : adjustments.isolatedLayerId === 'cat:hair'
                ? 'Hair Segments'
                : adjustments.isolatedLayerId === 'cat:accessory'
                ? 'Jewelry & Accessories'
                : adjustments.isolatedLayerId === 'cat:hand_finger'
                ? 'Hands & Foreground Objects'
                : adjustments.isolatedLayerId === 'cat:forehead'
                ? 'Forehead Segments'
                : detectedCutoutLayers.find((l) => l.id === adjustments.isolatedLayerId)?.name ||
                  'Isolated Segment'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => toggleIsolatedLayer(null)}
            className="px-2.5 py-0.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap shrink-0"
          >
            Exit Isolation
          </button>
        </div>
      )}

      {/* Docked Angle Alignment Guide Strip */}
      {adjustments.showAngleGuide && activeFace && targetImageUrl && (() => {
        const lm = activeFace.landmarks;
        const eyeDx = lm.rightEye.x - lm.leftEye.x;
        const eyeDy = lm.rightEye.y - lm.leftEye.y;
        const eyeDist = Math.hypot(eyeDx, eyeDy) || activeFace.box.width * 0.44;
        const eyeMidX = (lm.leftEye.x + lm.rightEye.x) / 2;
        const tYaw =
          typeof activeFace.yaw === 'number'
            ? activeFace.yaw
            : Math.round(Math.max(-45, Math.min(45, ((lm.nose.x - eyeMidX) / eyeDist) * 58)));
        const tPitch = typeof activeFace.pitch === 'number' ? activeFace.pitch : 0;
        const tRoll =
          typeof activeFace.roll === 'number'
            ? activeFace.roll
            : Math.round((Math.atan2(eyeDy, eyeDx) * 180) / Math.PI);
        const targetClass = classifyFaceAngle(tYaw, tPitch);
        const scan = angleScanResults[activeFace.id];
        const profId = activeFace.assignedProfileId || activeProfileId;

        return (
          <div className="px-3 py-1.5 bg-slate-950/95 border-b border-emerald-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-semibold text-slate-100 whitespace-nowrap">
                Angle Guide
              </span>
              <span className="text-emerald-300 font-mono tabular-nums text-[11px] whitespace-nowrap">
                Yaw {tYaw > 0 ? `+${tYaw}` : tYaw}° · Pitch {tPitch > 0 ? `+${tPitch}` : tPitch}° · Roll {tRoll > 0 ? `+${tRoll}` : tRoll}°
              </span>
              <span className="text-slate-400 text-[11px] truncate hidden md:inline">
                · Target: {targetClass.label}
                {scan ? ` · Best ${scan.matchScore}%${scan.shouldFlip ? ' (Flip fit)' : ''}` : ''}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {profId && (
                <button
                  type="button"
                  onClick={() => angleUploadInputRef.current?.click()}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-[11px] flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Plus className="w-3 h-3 shrink-0" />
                  <span>Add Angle</span>
                </button>
              )}
              {hasSwappedFace && (
                <button
                  type="button"
                  onClick={() => void flipFaceAndAdjust(activeFace.id)}
                  className="px-2 py-0.5 rounded-lg bg-fuchsia-600/80 hover:bg-fuchsia-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap"
                >
                  Flip &amp; Align
                </button>
              )}
              <button
                type="button"
                onClick={() => updateAdjustments({ showAngleGuide: false })}
                className="px-2.5 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap"
              >
                Done
              </button>
            </div>
          </div>
        );
      })()}

      {/* Docked Real-Time Occlusion Heatmap Strip */}
      {adjustments.showOcclusionHeatmap && targetImageUrl && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-orange-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="font-semibold text-slate-100 whitespace-nowrap">
              Occlusion Heatmap
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 shrink-0">
              <span>Low</span>
              <span
                className="w-12 h-2 rounded-sm inline-block"
                style={{
                  background:
                    'linear-gradient(90deg, rgb(34,211,238) 0%, rgb(245,158,11) 55%, rgb(255,40,70) 100%)',
                }}
              />
              <span>High</span>
            </span>
            {occlusionStats && (
              <span className="text-orange-200/90 font-mono tabular-nums text-[11px] truncate">
                Mesh Hit {occlusionStats.intersectionCoveragePct}% · Peak {occlusionStats.peakHeatPct}% · {occlusionStats.edgeCollisionPixels} edge px
                {occlusionStats.occluderCategories.length > 0
                  ? ` (${occlusionStats.occluderCategories.join(', ')})`
                  : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                updateAdjustments({
                  brushMode: adjustments.brushMode === 'protect' ? 'none' : 'protect',
                })
              }
              className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap ${
                adjustments.brushMode === 'protect'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              <Paintbrush className="w-3 h-3 shrink-0" />
              <span>Mask Brush</span>
            </button>
            <button
              type="button"
              onClick={() => updateAdjustments({ showOcclusionHeatmap: false })}
              className="px-2.5 py-0.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Docked Focus Peaking High-Contrast Sharpness Strip */}
      {focusPeakingEnabled && targetImageUrl && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-rose-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Focus className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="font-semibold text-slate-100 whitespace-nowrap">
              Focus Peaking
            </span>
            {focusPeakingStats && (
              <span className="text-rose-200/90 font-mono tabular-nums text-[11px] truncate">
                Face Sharp {focusPeakingStats.faceSharpnessPct}% · Score {focusPeakingStats.peakIntensityScore}/100 · All {focusPeakingStats.sharpEdgePct}%
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <div className="flex items-center gap-1 bg-slate-900/90 rounded-lg p-0.5 border border-slate-800">
              {(
                [
                  { id: 'crimson', label: 'Red', dotClass: 'bg-rose-500' },
                  { id: 'cyan', label: 'Cyan', dotClass: 'bg-cyan-400' },
                  { id: 'amber', label: 'Yellow', dotClass: 'bg-amber-400' },
                  { id: 'emerald', label: 'Green', dotClass: 'bg-emerald-400' },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setFocusPeakingColor(c.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap ${
                    focusPeakingColor === c.id
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Focus peaking highlight color: ${c.label}`}
                >
                  <span className={`w-2.5 h-2.5 rounded-xs ${c.dotClass} shrink-0`} aria-hidden="true" />
                  <span className="hidden sm:inline">{c.label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-slate-900/90 rounded-lg p-0.5 border border-slate-800">
              {(
                [
                  { label: 'Low', val: 32 },
                  { label: 'Med', val: 54 },
                  { label: 'High', val: 78 },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setFocusPeakingSensitivity(preset.val)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors whitespace-nowrap ${
                    Math.abs(focusPeakingSensitivity - preset.val) <= 8
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Focus peaking edge sensitivity: ${preset.label}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setFocusPeakingDimBg((prev) => !prev)}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-colors whitespace-nowrap ${
                focusPeakingDimBg
                  ? 'bg-slate-800 border-slate-600 text-slate-100'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Darken soft areas to boost peaking edge contrast"
            >
              Dim BG
            </button>

            <button
              type="button"
              onClick={() => setFocusPeakingEnabled(false)}
              className="px-2.5 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Docked Real-Time ML Kit Face Metrics Overlay Bar */}
      {showFaceMetrics && faceMetrics && activeFace && targetImageUrl && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-teal-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <span className="font-semibold text-slate-100 flex items-center gap-1.5 whitespace-nowrap">
              <Activity className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span>Face Metrics</span>
            </span>

            <span className="text-[11px] font-mono tabular-nums text-teal-300 flex items-center gap-1 whitespace-nowrap">
              <span>Symmetry {faceMetrics.symmetryScore}%</span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <Ruler className="w-3 h-3 text-sky-400 shrink-0" />
              <span className="text-sky-300">
                IPD {faceMetrics.ipdMm} mm ({faceMetrics.ipdPx} px)
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <Droplets className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="text-emerald-300">
                Hydration {faceMetrics.hydrationScore}% ({faceMetrics.hydrationStatus})
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowFaceMetrics(false)}
            className="px-2.5 py-0.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap shrink-0"
          >
            Done
          </button>
        </div>
      )}

      {/* Docked Pre-Swap Segmentation Preview Strip */}
      {adjustments.previewSegmentation && targetImageUrl && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-cyan-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ScanLine className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="font-semibold text-slate-100 whitespace-nowrap">
              Preview Segmentation
            </span>
            <span className="text-slate-400 text-[11px] truncate hidden sm:inline">
              Highlighting Face (Cyan) · Hair (Rose) · Hand (Amber) · Jewelry (Sky)
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              updateAdjustments({ previewSegmentation: false }, 'Apply Full Face Swap')
            }
            className="px-2.5 py-0.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap shrink-0"
          >
            Apply Swap
          </button>
        </div>
      )}

      {/* Docked Skin Reference Sampling Strip */}
      {isSkinSamplingMode && targetImageUrl && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-amber-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {adjustments.skinReference ? (
              <span
                className="w-4 h-4 rounded-full border border-white shrink-0 shadow-xs"
                style={{
                  backgroundColor: `rgb(${Math.round(adjustments.skinReference.r)}, ${Math.round(
                    adjustments.skinReference.g
                  )}, ${Math.round(adjustments.skinReference.b)})`,
                }}
              />
            ) : (
              <Pipette className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            )}
            <span className="font-semibold text-slate-100 whitespace-nowrap">
              Skin Reference
            </span>
            <span className="text-slate-400 text-[11px] truncate">
              {adjustments.skinReference
                ? `Baseline #${[
                    adjustments.skinReference.r,
                    adjustments.skinReference.g,
                    adjustments.skinReference.b,
                  ]
                    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
                    .join('')
                    .toUpperCase()} · Touch or drag body to adjust`
                : 'Touch or drag anywhere on the target body to pick skin tone'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {adjustments.skinReference && (
              <button
                type="button"
                onClick={clearSkinReference}
                className="px-2 py-0.5 rounded text-[11px] text-rose-400 hover:bg-rose-950/60 font-medium transition-colors whitespace-nowrap"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsSkinSamplingMode(false)}
              className="px-2.5 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px] transition-colors whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Docked Face Transform Gesture Strip */}
      {(faceTransformMode || activeFaceGestureHud) && hasSwappedFace && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-violet-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <RotateCw className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="font-semibold text-slate-100 whitespace-nowrap">
              Face Transform
            </span>
            <span className="text-slate-400 text-[11px] hidden sm:inline truncate">
              · Drag to move · Pinch to scale · 2-finger rotate
            </span>
            <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-violet-950/80 border border-violet-500/30 text-violet-200 whitespace-nowrap">
              {Math.round((activeFaceGestureHud?.scale ?? adjustments.scale) * 100)}% ·{' '}
              {(activeFaceGestureHud?.rotation ?? adjustments.rotation) > 0
                ? `+${activeFaceGestureHud?.rotation ?? adjustments.rotation}`
                : activeFaceGestureHud?.rotation ?? adjustments.rotation}
              °
            </span>
          </div>

          {faceTransformMode && (
            <div className="flex items-center gap-1.5 shrink-0">
              {(adjustments.scale !== 1 ||
                adjustments.rotation !== 0 ||
                adjustments.offsetX !== 0 ||
                adjustments.offsetY !== 0) && (
                <button
                  type="button"
                  onClick={() =>
                    updateAdjustments(
                      { scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
                      'Reset Face Transform'
                    )
                  }
                  className="px-2 py-0.5 rounded text-[11px] text-amber-400 hover:bg-amber-950/60 font-medium transition-colors flex items-center gap-1 whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setFaceTransformMode(false)}
                className="px-2.5 py-0.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* Docked Geometric Landmark Mesh Active Strip */}
      {adjustments.showGeometricMesh && activeFace && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-cyan-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
            <span className="font-semibold text-slate-100 whitespace-nowrap">Geometric Mesh Active</span>
            <span className="text-slate-400 text-[11px] hidden sm:inline truncate">
              · Drag handles on face or use nudge controls below
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {activeFace.isLandmarksEdited && (
              <button
                type="button"
                onClick={() => resetFaceLandmarks(activeFace.id)}
                className="px-2 py-0.5 rounded text-[11px] text-amber-400 hover:bg-amber-950/60 font-medium transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => updateAdjustments({ showGeometricMesh: false })}
              className="px-2.5 py-0.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Docked Manual Brush Active Strip */}
      {adjustments.brushMode !== 'none' && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-b border-indigo-500/45 flex items-center justify-between text-xs z-20 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-3 h-3 rounded-full shrink-0 ${
                adjustments.brushMode === 'protect' ? 'bg-emerald-400' : 'bg-rose-500'
              }`}
            />
            <span className="font-semibold text-slate-100 whitespace-nowrap">
              {adjustments.brushMode === 'protect' ? 'Add (+ Mask)' : 'Subtract (- Mask)'} Brush
            </span>
            <span className="text-slate-400 text-[11px] hidden sm:inline truncate tabular-nums">
              · {adjustments.brushSize}px · {adjustments.brushFeather}% feather
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {hasManualMaskStrokes && (
              <button
                type="button"
                onClick={clearManualMask}
                className="px-2 py-0.5 rounded text-[11px] text-rose-400 hover:bg-rose-950/60 font-medium transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <Eraser className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => updateAdjustments({ brushMode: 'none' })}
              className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] transition-colors whitespace-nowrap"
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
            lastBrushImgPosRef.current = null;
            setIsPanning(false);
          }
          setBrushHover((prev) => ({ ...prev, visible: false }));
        }}
        onDoubleClick={(e) => {
          handleDoubleTapAtPoint(e.clientX, e.clientY);
        }}
        className={`flex-1 relative flex items-center justify-center p-2 sm:p-4 overflow-hidden touch-none min-h-0 ${
          adjustments.brushMode !== 'none' || isSkinSamplingMode
            ? 'cursor-crosshair'
            : faceTransformMode
            ? 'cursor-move'
            : zoom > 1.02
            ? isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : ''
        }`}
      >
        {/* Drag-and-drop highlight */}
        {isDragOver && (
          <div className="absolute inset-3 z-20 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-950/60 backdrop-blur-sm flex items-center justify-center text-sm font-semibold text-indigo-100 pointer-events-none">
            Drop photo here to start editing
          </div>
        )}

        {/* Interactive Brush Cursor Follower */}
        {adjustments.brushMode !== 'none' && brushHover.visible && (
          <div
            className="absolute rounded-full pointer-events-none z-20 border-2 transition-transform duration-75"
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
          <div className="absolute inset-0 z-20 bg-black/40 backdrop-blur-xs flex items-center justify-center">
            <div className="px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-xs font-medium flex items-center gap-2 shadow-xl">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
              <span>Scanning faces &amp; processing layers...</span>
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
            className={`relative max-w-full max-h-full ${
              compareMode === 'side-by-side'
                ? 'grid grid-cols-2 gap-1.5 sm:gap-3 items-center justify-center w-full max-w-5xl'
                : 'flex items-center justify-center rounded-xl overflow-hidden shadow-2xl'
            } ${isPanning ? '' : 'transition-transform duration-100'}`}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
          >
            {/* Side-by-Side Left Pane: Original Target Image */}
            {compareMode === 'side-by-side' && targetImageElement && (
              <div className="relative flex items-center justify-center rounded-xl overflow-hidden border border-slate-700/85 bg-slate-950/75 shadow-xl">
                <img
                  src={targetImageUrl}
                  alt="Original target"
                  className="w-auto h-auto max-w-full max-h-[68vh] md:max-h-[76vh] lg:max-h-[calc(100vh-11.5rem)] object-contain block pointer-events-none"
                />
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-950/85 border border-white/15 text-[10px] font-semibold text-slate-200 pointer-events-none">
                  Original
                </span>
              </div>
            )}

            {/* Primary Result Wrapper (Always keeps outputCanvasRef mounted in place) */}
            <div
              className={
                compareMode === 'side-by-side'
                  ? 'relative flex items-center justify-center rounded-xl overflow-hidden border border-indigo-500/60 bg-slate-950/75 shadow-xl'
                  : 'relative flex items-center justify-center max-w-full max-h-full'
              }
            >
              {/* Swapped Render Canvas */}
              <canvas
                ref={outputCanvasRef}
                className={`w-auto h-auto max-w-full object-contain block ${
                  compareMode === 'side-by-side'
                    ? 'max-h-[68vh] md:max-h-[76vh] lg:max-h-[calc(100vh-11.5rem)]'
                    : 'max-h-[76vh] md:max-h-[82vh] lg:max-h-[calc(100vh-9.5rem)] rounded-xl'
                } ${isPeekingOriginal ? 'opacity-0' : 'opacity-100'}`}
              />

              {compareMode === 'side-by-side' && (
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-indigo-600/90 border border-indigo-400/40 text-[10px] font-semibold text-white pointer-events-none">
                  Morphed
                </span>
              )}

              {/* Original Base Target Image (For peek & swipe-to-reveal comparison) */}
              {targetImageElement && compareMode !== 'side-by-side' && (
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

              {/* Swipe-to-Reveal Mode Badges & Interactive Slider Divider Handle */}
              {compareMode === 'split' && adjustments.brushMode === 'none' && (
                <>
                  <span className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded bg-slate-950/80 border border-white/15 text-[10px] font-semibold text-slate-200 pointer-events-none">
                    Original
                  </span>
                  <span className="absolute top-2.5 right-2.5 z-20 px-2 py-0.5 rounded bg-indigo-600/90 border border-indigo-300/30 text-[10px] font-semibold text-white pointer-events-none">
                    Morphed
                  </span>
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setIsDraggingSplit(true);
                      try {
                        containerRef.current?.setPointerCapture(e.pointerId);
                      } catch {
                        // ignore
                      }
                    }}
                    className="absolute top-0 bottom-0 z-20 w-11 touch-none cursor-ew-resize flex items-center justify-center"
                    style={{ left: `${splitPos}%`, transform: 'translateX(-50%)' }}
                    title="Swipe left or right to reveal original vs morphed"
                  >
                    <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.65)]" />
                    <div className="absolute w-9 h-9 rounded-full bg-white text-slate-900 shadow-xl border border-slate-300 flex items-center justify-center select-none active:scale-95 transition-transform">
                      <MoveHorizontal className="w-4 h-4" />
                    </div>
                    <span className="absolute bottom-3 px-1.5 py-0.5 rounded bg-slate-950/90 border border-white/20 text-[10px] font-mono tabular-nums text-white shadow-md pointer-events-none">
                      {Math.round(splitPos)}%
                    </span>
                  </div>
                </>
              )}

              {/* Real-Time Occlusion Heatmap Canvas Overlay (Edge + Depth Mesh Intersection) */}
              <canvas
                ref={occlusionHeatmapCanvasRef}
                className={`absolute inset-0 w-full h-full object-contain pointer-events-none z-20 transition-opacity ${
                  adjustments.showOcclusionHeatmap && !isPeekingOriginal
                    ? 'opacity-90'
                    : 'opacity-0'
                }`}
              />

              {/* High-Contrast Focus Peaking Canvas Overlay (Edge Sharpness Verification) */}
              <canvas
                ref={focusPeakingCanvasRef}
                className={`absolute inset-0 w-full h-full object-contain pointer-events-none z-20 transition-opacity ${
                  focusPeakingEnabled && !isPeekingOriginal ? 'opacity-100' : 'opacity-0'
                }`}
              />

              {/* Angle Alignment Guide SVG Overlay (3D Yaw/Pitch/Roll Guidelines for 1:1 Mapping) */}
              {adjustments.showAngleGuide && activeFace && outputCanvasRef.current && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none z-20"
                  viewBox={`0 0 ${canvasW} ${canvasH}`}
                  preserveAspectRatio="none"
                >
                  {(() => {
                    const lm = activeFace.landmarks;
                    const u = Math.max(1, canvasW / 680);
                    const eyeDx = lm.rightEye.x - lm.leftEye.x;
                    const eyeDy = lm.rightEye.y - lm.leftEye.y;
                    const eyeDist = Math.hypot(eyeDx, eyeDy) || activeFace.box.width * 0.44;
                    const eyeMidX = (lm.leftEye.x + lm.rightEye.x) / 2;
                    const eyeMidY = (lm.leftEye.y + lm.rightEye.y) / 2;

                    const tYaw =
                      typeof activeFace.yaw === 'number'
                        ? activeFace.yaw
                        : Math.round(
                            Math.max(-45, Math.min(45, ((lm.nose.x - eyeMidX) / eyeDist) * 58))
                          );
                    const tPitch = typeof activeFace.pitch === 'number' ? activeFace.pitch : 0;
                    const tRoll =
                      typeof activeFace.roll === 'number'
                        ? activeFace.roll
                        : Math.round((Math.atan2(eyeDy, eyeDx) * 180) / Math.PI);

                    const yawRad = (tYaw * Math.PI) / 180;
                    const pitchRad = (tPitch * Math.PI) / 180;

                    const cx = activeFace.box.x + activeFace.box.width * 0.5;
                    const cy = activeFace.box.y + activeFace.box.height * 0.5;
                    const rx = activeFace.box.width * 0.54;
                    const ry = activeFace.box.height * 0.62;

                    // Meridian & Equator quadratic curves representing 3D face sphere tilt & turn
                    const yawShift = Math.sin(yawRad) * rx * 0.92;
                    const pitchShift = Math.sin(pitchRad) * ry * 0.92;

                    // Gaze projection vector from nose / bridge center
                    const rayLen = Math.max(rx, ry) * 0.65;
                    const rayEndX = cx + Math.sin(yawRad) * rayLen;
                    const rayEndY = cy + Math.sin(pitchRad) * rayLen;

                    // Assigned source pose alignment comparison
                    const assignedProf = activeFace.assignedProfileId
                      ? profiles.find((p) => p.id === activeFace.assignedProfileId)
                      : undefined;
                    const assignedAngle =
                      assignedProf?.angles?.find((a) => a.id === activeFace.assignedAngleId) ||
                      assignedProf?.angles?.[0];
                    const shouldFlipSrc = Boolean(
                      activeFace.flipHorizontal ?? adjustments.flipHorizontal
                    );
                    const sYaw = assignedAngle
                      ? (shouldFlipSrc ? -assignedAngle.yaw : assignedAngle.yaw) +
                        (adjustments.headYaw ?? 0)
                      : null;
                    const sPitch = assignedAngle
                      ? assignedAngle.pitch + (adjustments.headPitch ?? 0)
                      : null;

                    const srcEndX =
                      sYaw !== null ? cx + Math.sin((sYaw * Math.PI) / 180) * rayLen * 0.85 : null;
                    const srcEndY =
                      sPitch !== null
                        ? cy + Math.sin((sPitch * Math.PI) / 180) * rayLen * 0.85
                        : null;

                    const poseDiff =
                      sYaw !== null && sPitch !== null
                        ? Math.hypot(tYaw - sYaw, tPitch - sPitch)
                        : null;
                    const isPoseMatched = poseDiff !== null && poseDiff <= 9;

                    const targetClass = classifyFaceAngle(tYaw, tPitch);
                    const hudW = 152 * u;
                    const hudX = Math.max(
                      4 * u,
                      Math.min(canvasW - hudW - 4 * u, cx - hudW / 2)
                    );
                    const hudY = Math.max(4 * u, activeFace.box.y - 34 * u);

                    return (
                      <g>
                        {/* Outer target framing guide box & cardinal ticks */}
                        <rect
                          x={activeFace.box.x - 6 * u}
                          y={activeFace.box.y - 6 * u}
                          width={activeFace.box.width + 12 * u}
                          height={activeFace.box.height + 12 * u}
                          rx={10 * u}
                          fill="none"
                          stroke="rgba(16, 185, 129, 0.42)"
                          strokeWidth={1.1 * u}
                          strokeDasharray={`${4 * u} ${3 * u}`}
                        />

                        {/* Level horizon line behind eyes */}
                        <line
                          x1={cx - rx * 1.18}
                          y1={eyeMidY}
                          x2={cx + rx * 1.18}
                          y2={eyeMidY}
                          stroke="rgba(148, 163, 184, 0.45)"
                          strokeWidth={1 * u}
                          strokeDasharray={`${3 * u} ${3 * u}`}
                        />

                        {/* Inter-ocular Roll Axis passing through leftEye and rightEye */}
                        <line
                          x1={lm.leftEye.x - eyeDx * 0.45}
                          y1={lm.leftEye.y - eyeDy * 0.45}
                          x2={lm.rightEye.x + eyeDx * 0.45}
                          y2={lm.rightEye.y + eyeDy * 0.45}
                          stroke="#38bdf8"
                          strokeWidth={1.6 * u}
                        />

                        {/* 3D Rotated Elliptical Head Reticle */}
                        <g transform={`rotate(${tRoll} ${cx} ${cy})`}>
                          <ellipse
                            cx={cx}
                            cy={cy}
                            rx={rx * Math.max(0.68, Math.cos(yawRad))}
                            ry={ry * Math.max(0.72, Math.cos(pitchRad))}
                            fill="rgba(16, 185, 129, 0.04)"
                            stroke={isPoseMatched ? '#10b981' : '#34d399'}
                            strokeWidth={1.6 * u}
                          />
                          {/* Vertical Yaw Meridian Curve */}
                          <path
                            d={`M ${cx} ${cy - ry} Q ${cx + yawShift} ${cy} ${cx} ${cy + ry}`}
                            fill="none"
                            stroke="#34d399"
                            strokeWidth={1.4 * u}
                          />
                          {/* Horizontal Pitch Equator Curve */}
                          <path
                            d={`M ${cx - rx} ${cy} Q ${cx} ${cy + pitchShift} ${cx + rx} ${cy}`}
                            fill="none"
                            stroke="#fbbf24"
                            strokeWidth={1.3 * u}
                          />
                        </g>

                        {/* Target Head Facing Ray Vector */}
                        <line
                          x1={cx}
                          y1={cy}
                          x2={rayEndX}
                          y2={rayEndY}
                          stroke="#10b981"
                          strokeWidth={2.2 * u}
                        />
                        <circle
                          cx={rayEndX}
                          cy={rayEndY}
                          r={4.2 * u}
                          fill="#10b981"
                          stroke="#ffffff"
                          strokeWidth={1.2 * u}
                        />

                        {/* Assigned Source Profile Pose Comparison Vector */}
                        {srcEndX !== null && srcEndY !== null && (
                          <>
                            <line
                              x1={cx}
                              y1={cy}
                              x2={srcEndX}
                              y2={srcEndY}
                              stroke={isPoseMatched ? '#38bdf8' : '#f59e0b'}
                              strokeWidth={1.7 * u}
                              strokeDasharray={`${3 * u} ${2 * u}`}
                            />
                            <circle
                              cx={srcEndX}
                              cy={srcEndY}
                              r={3.2 * u}
                              fill={isPoseMatched ? '#38bdf8' : '#f59e0b'}
                              stroke="#0f172a"
                              strokeWidth={1 * u}
                            />
                          </>
                        )}

                        {/* Compact Pose Guide Readout Header */}
                        <g transform={`translate(${hudX}, ${hudY})`}>
                          <rect
                            x={0}
                            y={0}
                            width={hudW}
                            height={26 * u}
                            rx={5 * u}
                            fill="rgba(2, 6, 23, 0.88)"
                            stroke={isPoseMatched ? '#10b981' : '#34d399'}
                            strokeWidth={1 * u}
                          />
                          <text
                            x={7 * u}
                            y={11 * u}
                            fill="#34d399"
                            fontSize={7.8 * u}
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                            fontWeight="700"
                          >
                            {`POSE: ${targetClass.label.toUpperCase()}`}
                          </text>
                          <text
                            x={7 * u}
                            y={21 * u}
                            fill="#e2e8f0"
                            fontSize={7.3 * u}
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          >
                            {`Y:${tYaw > 0 ? `+${tYaw}` : tYaw}° P:${tPitch > 0 ? `+${tPitch}` : tPitch}° R:${tRoll > 0 ? `+${tRoll}` : tRoll}°${
                              poseDiff !== null
                                ? ` · ${isPoseMatched ? '1:1 OK' : `Δ${Math.round(poseDiff)}°`}`
                                : ''
                            }`}
                          </text>
                        </g>
                      </g>
                    );
                  })()}
                </svg>
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

            {/* REAL-TIME ML KIT FACE METRICS OVERLAY (Symmetry Midline, IPD Caliper & Hydration Callout) */}
            {showFaceMetrics && faceMetrics && activeFace && outputCanvasRef.current && !isPeekingOriginal && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-20"
                viewBox={`0 0 ${canvasW} ${canvasH}`}
                preserveAspectRatio="none"
              >
                {(() => {
                  const lm = activeFace.landmarks;
                  const u = Math.max(1, canvasW / 680);
                  const eyeMidX = (lm.leftEye.x + lm.rightEye.x) * 0.5;
                  const eyeMidY = (lm.leftEye.y + lm.rightEye.y) * 0.5;
                  const dx = lm.rightEye.x - lm.leftEye.x;
                  const dy = lm.rightEye.y - lm.leftEye.y;
                  const len = Math.max(1, Math.hypot(dx, dy));
                  const nx = -dy / len;
                  const ny = dx / len;
                  const tick = 5 * u;
                  const labelW = 148 * u;
                  const labelX = Math.max(
                    6 * u,
                    Math.min(canvasW - labelW - 6 * u, activeFace.box.x)
                  );
                  const labelY = Math.max(24 * u, activeFace.box.y - 10 * u);

                  return (
                    <g>
                      {/* Bilateral Midline Symmetry Axis */}
                      <line
                        x1={lm.forehead.x}
                        y1={lm.forehead.y}
                        x2={lm.chin.x}
                        y2={lm.chin.y}
                        stroke="rgba(45, 212, 191, 0.88)"
                        strokeWidth={1.6 * u}
                        strokeDasharray={`${4 * u} ${3 * u}`}
                      />
                      {/* Symmetry Balance Reference Line across Mouth */}
                      <line
                        x1={lm.mouthLeft.x}
                        y1={lm.mouthLeft.y}
                        x2={lm.mouthRight.x}
                        y2={lm.mouthRight.y}
                        stroke="rgba(45, 212, 191, 0.55)"
                        strokeWidth={1.1 * u}
                        strokeDasharray={`${2.5 * u} ${2.5 * u}`}
                      />

                      {/* Interpupillary Distance (IPD) Caliper */}
                      <line
                        x1={lm.leftEye.x}
                        y1={lm.leftEye.y}
                        x2={lm.rightEye.x}
                        y2={lm.rightEye.y}
                        stroke="#38bdf8"
                        strokeWidth={2 * u}
                      />
                      <line
                        x1={lm.leftEye.x - nx * tick}
                        y1={lm.leftEye.y - ny * tick}
                        x2={lm.leftEye.x + nx * tick}
                        y2={lm.leftEye.y + ny * tick}
                        stroke="#38bdf8"
                        strokeWidth={1.6 * u}
                      />
                      <line
                        x1={lm.rightEye.x - nx * tick}
                        y1={lm.rightEye.y - ny * tick}
                        x2={lm.rightEye.x + nx * tick}
                        y2={lm.rightEye.y + ny * tick}
                        stroke="#38bdf8"
                        strokeWidth={1.6 * u}
                      />
                      <circle cx={lm.leftEye.x} cy={lm.leftEye.y} r={3 * u} fill="#38bdf8" stroke="#ffffff" strokeWidth={0.9 * u} />
                      <circle cx={lm.rightEye.x} cy={lm.rightEye.y} r={3 * u} fill="#38bdf8" stroke="#ffffff" strokeWidth={0.9 * u} />

                      {/* IPD Readout Badge at Eye Midpoint */}
                      <g transform={`translate(${eyeMidX}, ${eyeMidY - 12 * u})`}>
                        <rect
                          x={-28 * u}
                          y={-9 * u}
                          width={56 * u}
                          height={12 * u}
                          rx={3 * u}
                          fill="rgba(2, 6, 23, 0.88)"
                          stroke="rgba(56, 189, 248, 0.85)"
                          strokeWidth={0.8 * u}
                        />
                        <text
                          x={0}
                          y={-0.5 * u}
                          textAnchor="middle"
                          fill="#e0f2fe"
                          fontSize={7.8 * u}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontWeight="700"
                        >
                          {`${faceMetrics.ipdMm} mm`}
                        </text>
                      </g>

                      {/* Cheek Hydration Zone Brackets */}
                      <rect
                        x={activeFace.box.x + activeFace.box.width * 0.16}
                        y={activeFace.box.y + activeFace.box.height * 0.46}
                        width={activeFace.box.width * 0.22}
                        height={activeFace.box.height * 0.2}
                        rx={3 * u}
                        fill="rgba(52, 211, 153, 0.08)"
                        stroke="rgba(52, 211, 153, 0.7)"
                        strokeWidth={1 * u}
                        strokeDasharray={`${3 * u} ${2 * u}`}
                      />
                      <rect
                        x={activeFace.box.x + activeFace.box.width * 0.62}
                        y={activeFace.box.y + activeFace.box.height * 0.46}
                        width={activeFace.box.width * 0.22}
                        height={activeFace.box.height * 0.2}
                        rx={3 * u}
                        fill="rgba(52, 211, 153, 0.08)"
                        stroke="rgba(52, 211, 153, 0.7)"
                        strokeWidth={1 * u}
                        strokeDasharray={`${3 * u} ${2 * u}`}
                      />

                      {/* Floating Summary Header Box above Active Face */}
                      <g transform={`translate(${labelX}, ${labelY})`}>
                        <rect
                          x={0}
                          y={-15 * u}
                          width={labelW}
                          height={17 * u}
                          rx={4 * u}
                          fill="rgba(2, 6, 23, 0.9)"
                          stroke="rgba(45, 212, 191, 0.8)"
                          strokeWidth={0.9 * u}
                        />
                        <text
                          x={6 * u}
                          y={-3.5 * u}
                          fill="#f0fdfa"
                          fontSize={8.2 * u}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontWeight="700"
                        >
                          {`Sym ${faceMetrics.symmetryScore}% · Hyd ${faceMetrics.hydrationScore}%`}
                        </text>
                      </g>
                    </g>
                  );
                })()}
              </svg>
            )}

            {/* GEOMETRIC MESH OVERLAY & MANUAL LANDMARK NUDGE HANDLES */}
            {adjustments.showGeometricMesh && activeFace && outputCanvasRef.current && (
              <div className="absolute inset-0 pointer-events-none z-20">
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

            {/* Active Swapped Face Transform Guide Ring */}
            {(faceTransformMode || activeFaceGestureHud) &&
              activeFace &&
              activeFace.enabled &&
              activeFace.assignedProfileId &&
              outputCanvasRef.current && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none z-20"
                  viewBox={`0 0 ${canvasW} ${canvasH}`}
                  preserveAspectRatio="none"
                >
                  {(() => {
                    const u = Math.max(1, canvasW / 700);
                    const cx = activeFace.box.x + activeFace.box.width / 2 + adjustments.offsetX;
                    const cy = activeFace.box.y + activeFace.box.height / 2 + adjustments.offsetY;
                    const rx = activeFace.box.width * 0.54 * adjustments.scale;
                    const ry = activeFace.box.height * 0.62 * adjustments.scale;
                    return (
                      <g transform={`rotate(${adjustments.rotation} ${cx} ${cy})`}>
                        <ellipse
                          cx={cx}
                          cy={cy}
                          rx={rx}
                          ry={ry}
                          fill="rgba(139, 92, 246, 0.06)"
                          stroke="rgba(167, 139, 250, 0.9)"
                          strokeWidth={1.8 * u}
                          strokeDasharray={`${5 * u} ${3 * u}`}
                        />
                        <line
                          x1={cx}
                          y1={cy - ry}
                          x2={cx}
                          y2={cy - ry - 12 * u}
                          stroke="rgba(167, 139, 250, 0.9)"
                          strokeWidth={1.5 * u}
                        />
                        <circle
                          cx={cx}
                          cy={cy - ry - 12 * u}
                          r={3.5 * u}
                          fill="#8b5cf6"
                          stroke="#ffffff"
                          strokeWidth={1.1 * u}
                        />
                      </g>
                    );
                  })()}
                </svg>
              )}

            {/* Skin Reference Target Reticle & Live Color Loupe */}
            {isSkinSamplingMode && adjustments.skinReference && outputCanvasRef.current && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-20"
                viewBox={`0 0 ${canvasW} ${canvasH}`}
                preserveAspectRatio="none"
              >
                {(() => {
                  const ref = adjustments.skinReference;
                  const u = Math.max(1, canvasW / 700);
                  const px = ref.normX * canvasW;
                  const py = ref.normY * canvasH;
                  const rad = Math.max(10 * u, ref.radiusRatio * Math.min(canvasW, canvasH));
                  const rgbCss = `rgb(${Math.round(ref.r)}, ${Math.round(ref.g)}, ${Math.round(ref.b)})`;
                  const loupeY = Math.max(22 * u, py - rad - 22 * u);
                  return (
                    <g>
                      <circle cx={px} cy={py} r={rad} fill={rgbCss} fillOpacity={0.22} />
                      <circle
                        cx={px}
                        cy={py}
                        r={rad}
                        fill="none"
                        stroke="rgba(2, 6, 23, 0.85)"
                        strokeWidth={3 * u}
                      />
                      <circle
                        cx={px}
                        cy={py}
                        r={rad}
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth={1.6 * u}
                      />
                      <line
                        x1={px - 6 * u}
                        y1={py}
                        x2={px + 6 * u}
                        y2={py}
                        stroke="#ffffff"
                        strokeWidth={1.4 * u}
                      />
                      <line
                        x1={px}
                        y1={py - 6 * u}
                        x2={px}
                        y2={py + 6 * u}
                        stroke="#ffffff"
                        strokeWidth={1.4 * u}
                      />
                      <circle cx={px} cy={loupeY} r={11 * u} fill="rgba(2, 6, 23, 0.9)" />
                      <circle
                        cx={px}
                        cy={loupeY}
                        r={8.5 * u}
                        fill={rgbCss}
                        stroke="#fbbf24"
                        strokeWidth={1.6 * u}
                      />
                    </g>
                  );
                })()}
              </svg>
            )}

            {/* Standard Interactive Detected Face Overlays */}
            {compareMode === 'off' &&
              adjustments.brushMode === 'none' &&
              !adjustments.showGeometricMesh &&
              !faceTransformMode &&
              !isSkinSamplingMode &&
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
          </div>
        )}

        {/* Gesture Reset / Face Zoom Transient HUD Toast */}
        {gestureFeedback && targetImageUrl && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-xl bg-slate-950/92 border border-indigo-400/50 text-xs font-semibold text-white shadow-xl backdrop-blur-md whitespace-nowrap">
            {gestureFeedback}
          </div>
        )}

        {/* Floating Bottom-Left Viewport Actions: 'Compare' & 'Snapshot' */}
        {targetImageUrl && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-3 left-3 z-20 flex items-center gap-2"
          >
            {adjustments.brushMode === 'none' && !isSkinSamplingMode && !faceTransformMode && (
              <>
                {compareMode === 'off' || compareMode === 'peek' ? (
                  <button
                    type="button"
                    onClick={() => setCompareMode('split')}
                    aria-label="Compare"
                    className="min-h-[38px] px-3.5 py-2 rounded-xl bg-slate-950/90 hover:bg-indigo-600 active:scale-95 text-slate-100 hover:text-white border border-white/15 shadow-xl backdrop-blur-md text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    title="Compare morphed result with original target (Swipe or Side-by-Side)"
                  >
                    <Columns2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>Compare</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/95 border border-white/15 shadow-2xl backdrop-blur-md">
                    <button
                      type="button"
                      onClick={() => setCompareMode('split')}
                      className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                        compareMode === 'split'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                      }`}
                      title="Swipe-to-reveal slider comparison"
                    >
                      <Split className="w-3.5 h-3.5 shrink-0" />
                      <span>Swipe</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareMode('side-by-side')}
                      className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                        compareMode === 'side-by-side'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                      }`}
                      title="Temporary side-by-side Original vs Morphed comparison"
                    >
                      <Columns2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Side-by-Side</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareMode('off')}
                      aria-label="Exit compare view"
                      className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/90 transition-colors shrink-0"
                      title="Exit compare view"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleCaptureSnapshot}
              disabled={snapshotStatus === 'saving'}
              aria-label="Snapshot"
              className={`min-h-[38px] px-3.5 py-2 rounded-xl border shadow-xl backdrop-blur-md text-xs font-semibold flex items-center gap-1.5 transition-[background-color,border-color,transform] duration-150 active:scale-95 whitespace-nowrap shrink-0 disabled:opacity-70 ${
                snapshotStatus === 'saved'
                  ? 'bg-emerald-600/95 border-emerald-400/60 text-white'
                  : 'bg-slate-950/90 hover:bg-emerald-600 text-slate-100 hover:text-white border-white/15'
              }`}
              title="Capture and save current frame as high-quality PNG to device storage"
            >
              {snapshotStatus === 'saved' ? (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{snapshotStatus === 'saving' ? 'Saving…' : 'Snapshot'}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* DOCKED LANDMARK NUDGE CONTROLLER STRIP (never floats over canvas face) */}
      {adjustments.showGeometricMesh && activeFace && selectedLandmarkKey && (
        <div className="px-3 py-1.5 bg-slate-950/95 border-t border-cyan-500/35 z-20 shrink-0 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">Landmark:</span>
            <span className="text-xs font-bold text-cyan-300 font-mono capitalize whitespace-nowrap">
              {selectedLandmarkKey.replace(/([A-Z])/g, ' $1')}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => handleNudgeDirection(-1, 0)}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all"
              title="Nudge Left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleNudgeDirection(0, -1)}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all"
              title="Nudge Up"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleNudgeDirection(0, 1)}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all"
              title="Nudge Down"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleNudgeDirection(1, 0)}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center font-bold text-xs active:scale-95 transition-all"
              title="Nudge Right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setNudgeStep(1)}
              className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors whitespace-nowrap ${
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
              className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors whitespace-nowrap ${
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

      {/* Docked Bottom Viewport Status & Zoom Bar — shown when image loaded */}
      {targetImageUrl && (
        <div className="px-3 py-1.5 flex items-center justify-between text-xs text-slate-300 z-20 bg-slate-950/95 border-t border-slate-800/80 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-medium text-slate-200 tabular-nums whitespace-nowrap">
              {detectedFaces.length} {detectedFaces.length === 1 ? 'Face' : 'Faces'} Detected
            </span>
            <span className="text-slate-500 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="text-[11px] text-slate-400 truncate hidden sm:inline tabular-nums">
              {showFaceMetrics && faceMetrics
                ? `Symmetry ${faceMetrics.symmetryScore}% · IPD ${faceMetrics.ipdMm}mm · Hydration ${faceMetrics.hydrationScore}%`
                : focusPeakingEnabled
                ? `Focus Peaking${focusPeakingStats ? ` · Face Sharp ${focusPeakingStats.faceSharpnessPct}%` : ''}`
                : adjustments.isolatedLayerId
                ? 'Layer Isolation View'
                : adjustments.showOcclusionHeatmap
                ? `Occlusion Heatmap${occlusionStats ? ` (${occlusionStats.intersectionCoveragePct}% hit)` : ''}`
                : adjustments.showAngleGuide
                ? 'Angle Alignment Guide'
                : adjustments.previewSegmentation
                ? 'Segmentation Preview (Pre-Swap)'
                : adjustments.showGeometricMesh
                ? 'Geometric Mesh Active'
                : adjustments.showFaceLandmarks
                ? 'Landmarks Wireframe Grid'
                : activeFace?.angleMatchStatus === 'matched' && activeFace.angleMatchScore
                ? `Matched ${activeFace.angleMatchScore}%${adjustments.flipHorizontal ? ' · Flipped' : ''}`
                : adjustments.flipHorizontal
                ? 'Flipped Horizontally'
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
