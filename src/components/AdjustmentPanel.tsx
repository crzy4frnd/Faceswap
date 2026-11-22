import React, { useState } from 'react';
import {
  Sliders,
  Palette,
  Move,
  RotateCcw,
  Sparkles,
  Sun,
  Contrast,
  CloudMoon,
  Thermometer,
  Wand2,
  Paintbrush,
  Glasses,
  Eye,
  Eraser,
  ShieldCheck,
  Check,
  Network,
  Droplets,
  SunMedium,
  Camera,
  Trees,
  Film,
  Activity,
  Crosshair,
  Compass,
  Pipette,
  Layers,
  EyeOff,
  RefreshCw,
  ScanLine,
  FlipHorizontal2,
  ScanFace,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Clock,
  Download,
  Waves,
  Wind,
  Flame,
  ChevronUp,
  ChevronDown,
  Users,
  X,
} from 'lucide-react';
import { FACE_COMPOSITE_LAYER_ID, LayerBlendMode } from '../types/face';
import { resolveCompositeLayerOrder } from '../utils/faceEngine';
import { useFaceStudio } from '../context/FaceStudioContext';
import {
  AdjustmentSubTab,
  LightingPresetCategory,
  loadSavedPanelUIState,
  savePanelUIState,
} from '../utils/adjustmentStorage';
import { DEFAULT_ADJUSTMENTS } from '../utils/sampleData';
import { LuminanceHistogram } from './LuminanceHistogram';
import { SegmentationVisualizer } from './SegmentationVisualizer';

const LAYER_BLEND_MODES: { value: LayerBlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
];

interface LightingPreset {
  id: string;
  name: string;
  category: Exclude<LightingPresetCategory, 'all'>;
  subtitle: string;
  swatchClass: string;
  values: {
    brightness: number;
    shadows: number;
    contrast: number;
    temperature: number;
    saturation: number;
  };
}

const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'studio-softbox',
    name: 'Studio Softbox',
    category: 'studio',
    subtitle: 'Even key & lifted shadows',
    swatchClass: 'from-slate-100 via-amber-50 to-slate-300',
    values: { brightness: 6, shadows: 14, contrast: 4, temperature: 2, saturation: 2 },
  },
  {
    id: 'studio-rembrandt',
    name: 'Rembrandt Key',
    category: 'studio',
    subtitle: 'Sculpted editorial contrast',
    swatchClass: 'from-amber-200 via-stone-500 to-slate-900',
    values: { brightness: -4, shadows: -8, contrast: 22, temperature: 6, saturation: -4 },
  },
  {
    id: 'outdoor-golden-hour',
    name: 'Golden Hour',
    category: 'outdoor',
    subtitle: 'Warm sunlit rim glow',
    swatchClass: 'from-amber-300 via-orange-400 to-rose-400',
    values: { brightness: 8, shadows: 12, contrast: 8, temperature: 24, saturation: 14 },
  },
  {
    id: 'outdoor-overcast',
    name: 'Overcast Shade',
    category: 'outdoor',
    subtitle: 'Cool diffused daylight',
    swatchClass: 'from-sky-200 via-cyan-300 to-slate-400',
    values: { brightness: 2, shadows: 18, contrast: -6, temperature: -14, saturation: -6 },
  },
  {
    id: 'cinematic-noir',
    name: 'Noir Contrast',
    category: 'cinematic',
    subtitle: 'Deep shadow & crisp highlights',
    swatchClass: 'from-slate-300 via-slate-700 to-slate-950',
    values: { brightness: -10, shadows: -22, contrast: 34, temperature: -8, saturation: -28 },
  },
  {
    id: 'cinematic-film',
    name: 'Cinema Warm',
    category: 'cinematic',
    subtitle: 'Rich tungsten & deep tone',
    swatchClass: 'from-orange-300 via-amber-600 to-cyan-900',
    values: { brightness: -2, shadows: 8, contrast: 18, temperature: 14, saturation: 10 },
  },
];

interface QuickLookPreset {
  id: string;
  name: string;
  subtitle: string;
  swatchClass: string;
  values: {
    brightness: number;
    contrast: number;
    shadows: number;
    temperature: number;
    saturation: number;
    hue: number;
    vibrance: number;
    skinSmoothing: number;
    skinTextureSmoothing: number;
    softBloom: number;
    shadowMatcher: number;
    lightingAdjustment: number;
    edgeContrast: number;
  };
}

const QUICK_LOOKS: QuickLookPreset[] = [
  {
    id: 'natural-studio',
    name: 'Natural Studio',
    subtitle: 'Clean & balanced',
    swatchClass: 'from-slate-100 via-sky-100 to-indigo-200',
    values: {
      brightness: 2,
      contrast: 6,
      shadows: 6,
      temperature: 2,
      saturation: 2,
      hue: 0,
      vibrance: 6,
      skinSmoothing: 28,
      skinTextureSmoothing: 22,
      softBloom: 14,
      shadowMatcher: 52,
      lightingAdjustment: 48,
      edgeContrast: 8,
    },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    subtitle: 'Filmic teal & warm',
    swatchClass: 'from-amber-400 via-orange-600 to-cyan-900',
    values: {
      brightness: -4,
      contrast: 22,
      shadows: -10,
      temperature: 12,
      saturation: -8,
      hue: -2,
      vibrance: 16,
      skinSmoothing: 34,
      skinTextureSmoothing: 26,
      softBloom: 28,
      shadowMatcher: 72,
      lightingAdjustment: 58,
      edgeContrast: 18,
    },
  },
  {
    id: 'soft-glow',
    name: 'Soft Glow',
    subtitle: 'Silky halation',
    swatchClass: 'from-rose-200 via-amber-100 to-orange-200',
    values: {
      brightness: 8,
      contrast: -6,
      shadows: 18,
      temperature: 8,
      saturation: 6,
      hue: 2,
      vibrance: 14,
      skinSmoothing: 54,
      skinTextureSmoothing: 46,
      softBloom: 68,
      shadowMatcher: 38,
      lightingAdjustment: 45,
      edgeContrast: 0,
    },
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    subtitle: 'Crisp tonal punch',
    swatchClass: 'from-slate-200 via-slate-600 to-slate-950',
    values: {
      brightness: 0,
      contrast: 38,
      shadows: -18,
      temperature: -2,
      saturation: 8,
      hue: 0,
      vibrance: 18,
      skinSmoothing: 18,
      skinTextureSmoothing: 14,
      softBloom: 10,
      shadowMatcher: 82,
      lightingAdjustment: 55,
      edgeContrast: 34,
    },
  },
  {
    id: 'warm-editorial',
    name: 'Warm Editorial',
    subtitle: 'Golden magazine',
    swatchClass: 'from-amber-200 via-orange-300 to-rose-400',
    values: {
      brightness: 5,
      contrast: 14,
      shadows: 10,
      temperature: 22,
      saturation: 12,
      hue: 0,
      vibrance: 20,
      skinSmoothing: 36,
      skinTextureSmoothing: 28,
      softBloom: 34,
      shadowMatcher: 55,
      lightingAdjustment: 50,
      edgeContrast: 14,
    },
  },
  {
    id: 'bleach-noir',
    name: 'Bleach Noir',
    subtitle: 'Silver contrast',
    swatchClass: 'from-zinc-100 via-zinc-500 to-zinc-900',
    values: {
      brightness: -6,
      contrast: 42,
      shadows: -20,
      temperature: -6,
      saturation: -50,
      hue: 0,
      vibrance: -50,
      skinSmoothing: 24,
      skinTextureSmoothing: 18,
      softBloom: 22,
      shadowMatcher: 85,
      lightingAdjustment: 62,
      edgeContrast: 28,
    },
  },
];

interface AdjustmentPanelProps {
  facesSlot?: React.ReactNode;
  stageRef?: React.RefObject<HTMLDivElement | null>;
}

export const AdjustmentPanel: React.FC<AdjustmentPanelProps> = ({
  facesSlot,
  stageRef,
}) => {
  const {
    adjustments,
    updateAdjustments,
    resetAdjustments,
    clearManualMask,
    hasManualMaskStrokes,
    matchAmbientLight,
    ambientLightReport,
    lightingCalibrationReport,
    analyzeLightingCalibration,
    autoOptimizeReport,
    autoOptimizeWithCamera,
    triggerAutoRefocus,
    targetImageUrl,
    targetImageElement,
    detectedFaces,
    selectedFaceId,
    profiles,
    isProcessing,
    isPeekingOriginal,
    setIsPeekingOriginal,
    isInspectorOpen,
    setIsInspectorOpen,
    isSkinSamplingMode,
    setIsSkinSamplingMode,
    sampleSkinReferenceAt,
    clearSkinReference,
    autoMatchTargetLighting,
    clearTargetLightingFilter,
    detectedCutoutLayers,
    segmentationVisualization,
    smartCleanupStats,
    skinTextureReport,
    layerDecisionSummary,
    totalLayerCount,
    toggleCutoutLayerVisibility,
    toggleIsolatedLayer,
    setCutoutLayerOpacity,
    setCutoutLayerBlendMode,
    reorderCutoutLayers,
    resetCutoutLayerStack,
    rescanObjectLayers,
    isBatchExportingMasks,
    exportBatchMasksAndResult,
    isExportingPsd,
    exportLayerCompositionPsd,
    angleScanResults,
    scanAndMatchFaceAngle,
    flipFaceAndAdjust,
  } = useFaceStudio();

  const [activeSubTab, setActiveSubTab] = useState<AdjustmentSubTab>(
    () => loadSavedPanelUIState().activeSubTab
  );
  const [presetCategory, setPresetCategory] = useState<LightingPresetCategory>(
    () => loadSavedPanelUIState().presetCategory
  );
  const [isMatchingLight, setIsMatchingLight] = useState(false);
  const [isMatchingTargetLight, setIsMatchingTargetLight] = useState(false);
  const [isCalibratingLight, setIsCalibratingLight] = useState(false);
  const [calibrationAppliedNotice, setCalibrationAppliedNotice] = useState(false);
  const [isAutoOptimizing, setIsAutoOptimizing] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [batchExportCountNotice, setBatchExportCountNotice] = useState<number | null>(null);
  const [psdExportCountNotice, setPsdExportCountNotice] = useState<number | null>(null);

  // Floating glass-morphism container state: drag offset, collapse, faces drawer, sheer mode & real-time preview indicator
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFacesExpanded, setIsFacesExpanded] = useState<boolean>(() => !targetImageUrl);
  const [isSheerGlass, setIsSheerGlass] = useState(false);
  const [isScrubbingSlider, setIsScrubbingSlider] = useState(false);
  const [livePreviewReadout, setLivePreviewReadout] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const liveScrubTimeoutRef = React.useRef<number | null>(null);
  const dragSessionRef = React.useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  React.useEffect(() => {
    savePanelUIState({ activeSubTab, presetCategory });
  }, [activeSubTab, presetCategory]);

  // Clear live scrubbing state on any pointer/touch release
  React.useEffect(() => {
    const endScrub = () => {
      setIsScrubbingSlider(false);
      if (liveScrubTimeoutRef.current !== null) {
        window.clearTimeout(liveScrubTimeoutRef.current);
      }
      liveScrubTimeoutRef.current = window.setTimeout(() => {
        setLivePreviewReadout(null);
      }, 1200);
    };
    window.addEventListener('pointerup', endScrub);
    window.addEventListener('pointercancel', endScrub);
    window.addEventListener('touchend', endScrub);
    return () => {
      window.removeEventListener('pointerup', endScrub);
      window.removeEventListener('pointercancel', endScrub);
      window.removeEventListener('touchend', endScrub);
      if (liveScrubTimeoutRef.current !== null) {
        window.clearTimeout(liveScrubTimeoutRef.current);
      }
    };
  }, []);

  // Re-clamp dragged floating panel position if viewport/stage resizes
  React.useEffect(() => {
    const handleResize = () => {
      const stageEl = stageRef?.current;
      const panelEl = panelRef.current;
      if (!stageEl || !panelEl) return;
      const sRect = stageEl.getBoundingClientRect();
      const pRect = panelEl.getBoundingClientRect();
      setDragOffset((prev) => {
        let nx = prev.x;
        let ny = prev.y;
        const margin = 8;
        if (pRect.left < sRect.left + margin) {
          nx += sRect.left + margin - pRect.left;
        } else if (pRect.right > sRect.right - margin) {
          nx -= pRect.right - (sRect.right - margin);
        }
        if (pRect.top < sRect.top + margin) {
          ny += sRect.top + margin - pRect.top;
        } else if (pRect.bottom > sRect.bottom - margin) {
          ny -= pRect.bottom - (sRect.bottom - margin);
        }
        if (nx === prev.x && ny === prev.y) return prev;
        return { x: Math.round(nx), y: Math.round(ny) };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [stageRef]);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const panelEl = panelRef.current;
    const stageEl = stageRef?.current || panelEl?.parentElement;
    if (!panelEl || !stageEl) return;

    const pRect = panelEl.getBoundingClientRect();
    const sRect = stageEl.getBoundingClientRect();
    const margin = 8;
    const minX = dragOffset.x + (sRect.left + margin - pRect.left);
    const maxX = dragOffset.x + (sRect.right - margin - pRect.right);
    const minY = dragOffset.y + (sRect.top + margin - pRect.top);
    const maxY = dragOffset.y + (sRect.bottom - margin - pRect.bottom);

    dragSessionRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dragOffset.x,
      origY: dragOffset.y,
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minY: Math.min(minY, maxY),
      maxY: Math.max(minY, maxY),
    };
    setIsDraggingPanel(true);

    const handleMove = (ev: PointerEvent) => {
      const ds = dragSessionRef.current;
      if (!ds) return;
      const dx = ev.clientX - ds.startX;
      const dy = ev.clientY - ds.startY;
      const nextX = Math.max(ds.minX, Math.min(ds.maxX, ds.origX + dx));
      const nextY = Math.max(ds.minY, Math.min(ds.maxY, ds.origY + dy));
      setDragOffset({ x: Math.round(nextX), y: Math.round(nextY) });
    };

    const handleUp = () => {
      dragSessionRef.current = null;
      setIsDraggingPanel(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const handleSliderCaptureInput = (e: React.SyntheticEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target || target.tagName !== 'INPUT') return;
    const input = target as HTMLInputElement;
    if (input.type !== 'range') return;

    const rawLabel = input.getAttribute('aria-label') || 'Setting';
    const val = input.value;
    setIsScrubbingSlider(true);
    setLivePreviewReadout({ label: rawLabel, value: val });
    if (liveScrubTimeoutRef.current !== null) {
      window.clearTimeout(liveScrubTimeoutRef.current);
    }
    liveScrubTimeoutRef.current = window.setTimeout(() => {
      setLivePreviewReadout(null);
    }, 1500);
  };

  const activeChangedCount = React.useMemo(() => {
    let count = 0;
    if (adjustments.swapStrength !== DEFAULT_ADJUSTMENTS.swapStrength) count++;
    if (adjustments.edgeSoftness !== DEFAULT_ADJUSTMENTS.edgeSoftness) count++;
    if (adjustments.boundaryRefinement !== DEFAULT_ADJUSTMENTS.boundaryRefinement) count++;
    if (adjustments.boundaryRefinementStrength !== DEFAULT_ADJUSTMENTS.boundaryRefinementStrength) count++;
    if (adjustments.boundaryTemporalStabilizer !== DEFAULT_ADJUSTMENTS.boundaryTemporalStabilizer) count++;
    if (adjustments.boundaryStabilizerFrames !== DEFAULT_ADJUSTMENTS.boundaryStabilizerFrames) count++;
    if (adjustments.brightness !== 0 || adjustments.contrast !== 0 || adjustments.shadows !== 0) count++;
    if (adjustments.temperature !== DEFAULT_ADJUSTMENTS.temperature || adjustments.saturation !== 0) count++;
    if (adjustments.skinSmoothing !== DEFAULT_ADJUSTMENTS.skinSmoothing) count++;
    if (adjustments.lightingAdjustment !== DEFAULT_ADJUSTMENTS.lightingAdjustment) count++;
    if (adjustments.shadowMatcher !== DEFAULT_ADJUSTMENTS.shadowMatcher) count++;
    if (adjustments.motionSmoothingEnabled !== DEFAULT_ADJUSTMENTS.motionSmoothingEnabled) count++;
    if (adjustments.motionSmoothing !== DEFAULT_ADJUSTMENTS.motionSmoothing) count++;
    if ((adjustments.globalColorHarmony ?? 0) > 0) count++;
    if ((adjustments.ageProgression ?? 0) > 0) count++;
    if (adjustments.genderMorph !== 0) count++;
    return count;
  }, [adjustments]);

  const visiblePresets =
    presetCategory === 'all'
      ? LIGHTING_PRESETS
      : LIGHTING_PRESETS.filter((p) => p.category === presetCategory);

  const applyLightingPreset = (preset: LightingPreset) => {
    updateAdjustments(
      {
        brightness: preset.values.brightness,
        shadows: preset.values.shadows,
        contrast: preset.values.contrast,
        temperature: preset.values.temperature,
        saturation: preset.values.saturation,
        autoAmbientLight: false,
      },
      `Lighting Preset: ${preset.name}`
    );
  };

  const activeQuickLook = QUICK_LOOKS.find(
    (look) =>
      adjustments.brightness === look.values.brightness &&
      adjustments.contrast === look.values.contrast &&
      adjustments.shadows === look.values.shadows &&
      adjustments.temperature === look.values.temperature &&
      adjustments.saturation === look.values.saturation &&
      adjustments.hue === look.values.hue &&
      adjustments.vibrance === look.values.vibrance &&
      adjustments.skinSmoothing === look.values.skinSmoothing &&
      adjustments.skinTextureSmoothing === look.values.skinTextureSmoothing &&
      adjustments.softBloom === look.values.softBloom &&
      adjustments.shadowMatcher === look.values.shadowMatcher &&
      adjustments.lightingAdjustment === look.values.lightingAdjustment &&
      adjustments.edgeContrast === look.values.edgeContrast
  );

  const applyQuickLook = (look: QuickLookPreset) => {
    updateAdjustments(
      {
        ...look.values,
        autoAmbientLight: false,
      },
      `Quick Look: ${look.name}`
    );
  };

  const resetQuickLook = () => {
    updateAdjustments(
      {
        brightness: DEFAULT_ADJUSTMENTS.brightness,
        contrast: DEFAULT_ADJUSTMENTS.contrast,
        shadows: DEFAULT_ADJUSTMENTS.shadows,
        temperature: DEFAULT_ADJUSTMENTS.temperature,
        saturation: DEFAULT_ADJUSTMENTS.saturation,
        hue: DEFAULT_ADJUSTMENTS.hue,
        vibrance: DEFAULT_ADJUSTMENTS.vibrance,
        skinSmoothing: DEFAULT_ADJUSTMENTS.skinSmoothing,
        skinTextureSmoothing: DEFAULT_ADJUSTMENTS.skinTextureSmoothing,
        softBloom: DEFAULT_ADJUSTMENTS.softBloom,
        shadowMatcher: DEFAULT_ADJUSTMENTS.shadowMatcher,
        lightingAdjustment: DEFAULT_ADJUSTMENTS.lightingAdjustment,
        edgeContrast: DEFAULT_ADJUSTMENTS.edgeContrast,
      },
      'Quick Look: Default'
    );
  };

  const handleMatchAmbientLight = async () => {
    setIsMatchingLight(true);
    try {
      await matchAmbientLight();
    } finally {
      setIsMatchingLight(false);
    }
  };

  const handleAutoMatchTargetLighting = async () => {
    setIsMatchingTargetLight(true);
    try {
      await autoMatchTargetLighting();
    } finally {
      setIsMatchingTargetLight(false);
    }
  };

  const handleCalibrateLighting = async () => {
    setIsCalibratingLight(true);
    try {
      await analyzeLightingCalibration();
    } finally {
      setIsCalibratingLight(false);
    }
  };

  const handleApplyWhiteBalanceSuggestion = () => {
    if (!lightingCalibrationReport) return;
    updateAdjustments(
      {
        temperature: lightingCalibrationReport.suggestedTemperature,
        hue: lightingCalibrationReport.suggestedHue,
        brightness: lightingCalibrationReport.suggestedBrightness,
        saturation: lightingCalibrationReport.suggestedSaturation,
      },
      `Lighting Calibration (${lightingCalibrationReport.ambientKelvin}K White Balance)`
    );
    setCalibrationAppliedNotice(true);
    window.setTimeout(() => setCalibrationAppliedNotice(false), 1800);
  };

  const orderedStackIds = React.useMemo(
    () => resolveCompositeLayerOrder(detectedCutoutLayers, adjustments.cutoutLayerOrder),
    [detectedCutoutLayers, adjustments.cutoutLayerOrder]
  );

  const moveCompositeLayer = (layerId: string, direction: -1 | 1) => {
    const idx = orderedStackIds.indexOf(layerId);
    if (idx < 0) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= orderedStackIds.length) return;
    const nextOrder = [...orderedStackIds];
    const [removed] = nextOrder.splice(idx, 1);
    nextOrder.splice(nextIdx, 0, removed);
    const labelName =
      layerId === FACE_COMPOSITE_LAYER_ID
        ? 'Swapped Face'
        : detectedCutoutLayers.find((l) => l.id === layerId)?.name || 'Layer';
    reorderCutoutLayers(nextOrder, `Moved ${labelName} ${direction < 0 ? 'Forward' : 'Back'}`);
  };

  const handleLayerDrop = (targetLayerId: string) => {
    if (!draggedLayerId || draggedLayerId === targetLayerId) {
      setDraggedLayerId(null);
      setDragOverLayerId(null);
      return;
    }
    const fromIdx = orderedStackIds.indexOf(draggedLayerId);
    const toIdx = orderedStackIds.indexOf(targetLayerId);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggedLayerId(null);
      setDragOverLayerId(null);
      return;
    }
    const nextOrder = [...orderedStackIds];
    const [moved] = nextOrder.splice(fromIdx, 1);
    nextOrder.splice(toIdx, 0, moved);
    const movedName =
      draggedLayerId === FACE_COMPOSITE_LAYER_ID
        ? 'Swapped Face'
        : detectedCutoutLayers.find((l) => l.id === draggedLayerId)?.name || 'Layer';
    reorderCutoutLayers(nextOrder, `Reordered ${movedName} to Layer #${toIdx + 1}`);
    setDraggedLayerId(null);
    setDragOverLayerId(null);
  };

  const handleAutoOptimize = async () => {
    setIsAutoOptimizing(true);
    try {
      await autoOptimizeWithCamera();
    } finally {
      setIsAutoOptimizing(false);
    }
  };

  const activeFaceCount = detectedFaces.filter((f) => f.enabled).length;
  const activeProfileName =
    profiles.find((p) => p.id === (detectedFaces.find((f) => f.id === selectedFaceId)?.assignedProfileId))?.name ||
    profiles[0]?.name ||
    'No Profile';

  const isTransparentPreviewActive = isScrubbingSlider || isSheerGlass;

  return (
    <div
      ref={panelRef}
      aria-hidden={!isInspectorOpen}
      style={{
        transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
      }}
      className={`${
        isInspectorOpen ? 'pointer-events-auto' : 'pointer-events-none'
      } absolute right-2 sm:right-3.5 bottom-8 sm:bottom-9 w-[calc(100%-16px)] sm:w-[408px] max-w-[424px] rounded-2xl border shadow-[0_24px_64px_-12px_rgba(2,6,23,0.6)] flex flex-col overflow-hidden select-none ${
        isCollapsed ? 'max-h-[96px]' : 'max-h-[min(64vh,560px)] sm:max-h-[min(78vh,680px)]'
      } ${
        isTransparentPreviewActive
          ? 'bg-white/42 dark:bg-slate-900/42 backdrop-blur-md border-indigo-400/55 dark:border-indigo-400/45'
          : 'bg-white/74 dark:bg-slate-900/70 backdrop-blur-xl border-white/55 dark:border-white/15'
      } ${isDraggingPanel ? 'ring-2 ring-indigo-500/60' : 'transition-[background-color,border-color] duration-150'}`}
    >
      {/* Draggable Glass-Morphism Handle Bar + Real-Time Preview Indicators */}
      <div
        onPointerDown={handleDragStart}
        className="px-3 py-2 border-b border-slate-200/60 dark:border-white/10 bg-white/40 dark:bg-slate-950/35 flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing touch-none shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-semibold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
                Adjustments
              </span>
              {isProcessing ? (
                <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />
              ) : (
                <Activity className="w-3 h-3 text-emerald-500 shrink-0" />
              )}
              <span className="text-[10px] font-mono tabular-nums truncate text-indigo-600 dark:text-indigo-300">
                {isPeekingOriginal
                  ? 'Preview: Original'
                  : livePreviewReadout
                  ? `${livePreviewReadout.label}: ${livePreviewReadout.value}`
                  : isProcessing
                  ? 'Rendering…'
                  : `Live Sync · ${activeChangedCount} tuned`}
              </span>
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onPointerDown={() => setIsPeekingOriginal(true)}
            onPointerUp={() => setIsPeekingOriginal(false)}
            onPointerLeave={() => setIsPeekingOriginal(false)}
            onPointerCancel={() => setIsPeekingOriginal(false)}
            aria-label="Hold to preview original target"
            title="Hold to peek original vs morphed canvas"
            className={`min-h-[30px] px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap ${
              isPeekingOriginal
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-900/10 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-900/20 dark:hover:bg-white/20'
            }`}
          >
            <Eye className="w-3 h-3 shrink-0" />
            <span className="hidden sm:inline">Peek</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSheerGlass((prev) => !prev)}
            aria-pressed={isSheerGlass}
            title="Toggle ultra-sheer see-through glass mode"
            className={`min-h-[30px] px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors whitespace-nowrap ${
              isSheerGlass
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-900/10 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-900/20 dark:hover:bg-white/20'
            }`}
          >
            Sheer
          </button>

          {(dragOffset.x !== 0 || dragOffset.y !== 0) && (
            <button
              type="button"
              onClick={() => setDragOffset({ x: 0, y: 0 })}
              aria-label="Snap panel back to corner"
              title="Reset floating panel position"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-900/15 dark:hover:bg-white/15 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-label={isCollapsed ? 'Expand adjustments panel' : 'Minimize adjustments panel'}
            title={isCollapsed ? 'Expand panel' : 'Collapse to floating bar'}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-900/15 dark:hover:bg-white/15 transition-colors"
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setIsInspectorOpen(false)}
            aria-label="Hide adjustments panel"
            title="Hide floating panel"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-rose-500 hover:bg-rose-500/15 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Collapsible Panel Body */}
      {!isCollapsed && (
        <>
          {/* Optional Collapsible Faces & Profiles Strip */}
          {facesSlot && (
            <div className="border-b border-slate-200/60 dark:border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => setIsFacesExpanded((prev) => !prev)}
                className="w-full px-3 py-1.5 bg-slate-100/45 dark:bg-slate-950/35 hover:bg-slate-100/75 dark:hover:bg-slate-900/55 flex items-center justify-between gap-2 text-left transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Users className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                    Faces &amp; Profiles
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    · {profiles.length} saved / {activeFaceCount} active ({activeProfileName})
                  </span>
                </div>
                {isFacesExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                )}
              </button>
              {isFacesExpanded && (
                <div className="max-h-[210px] overflow-y-auto bg-white/35 dark:bg-slate-950/30">
                  {facesSlot}
                </div>
              )}
            </div>
          )}

          {/* Sub Tabs */}
          <div className="flex items-center justify-between px-3 pt-2 pb-1.5 border-b border-slate-200/60 dark:border-white/10 overflow-x-auto no-scrollbar shrink-0">
        <div className="flex items-center gap-1 p-0.5 bg-slate-200/65 dark:bg-slate-950/65 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setActiveSubTab('blend')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'blend'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Blend & Skin
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('masking')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all flex items-center gap-1 ${
              activeSubTab === 'masking'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span>Auto-Mask & Brush</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('lighting')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'lighting'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Lighting & Tone
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('transform')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'transform'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Alignment
          </button>
        </div>

        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <button
            type="button"
            onClick={handleAutoOptimize}
            disabled={isAutoOptimizing}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] text-[11px] font-semibold text-white shadow-xs transition-all whitespace-nowrap disabled:opacity-70"
            title="Analyze scene lighting via camera and balance Edge Softness, Shadow Matcher, and Color Correction"
          >
            <Sparkles className={`w-3 h-3 ${isAutoOptimizing ? 'animate-spin' : ''}`} />
            <span>{isAutoOptimizing ? 'Analyzing...' : 'Auto-Optimize'}</span>
          </button>

          <button
            type="button"
            onClick={handleMatchAmbientLight}
            disabled={isMatchingLight}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50/85 dark:bg-amber-950/60 border border-amber-300/70 dark:border-amber-700/60 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors whitespace-nowrap"
            title="Match source color temperature and exposure to target image ambient light"
          >
            <SunMedium className={`w-3 h-3 ${isMatchingLight ? 'animate-spin' : ''}`} />
            <span>{isMatchingLight ? 'Matching...' : 'Match Light'}</span>
          </button>

          <button
            type="button"
            onClick={resetAdjustments}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors whitespace-nowrap"
            title="Reset sliders to default"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {autoOptimizeReport && (
        <div className="px-3 py-1.5 bg-indigo-50/70 dark:bg-indigo-950/45 border-b border-indigo-200/70 dark:border-indigo-800/50 flex items-center justify-between gap-2 text-[10px] shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 text-indigo-800 dark:text-indigo-200">
            <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="font-semibold truncate">
              {autoOptimizeReport.source} · {autoOptimizeReport.lightingProfile} ({autoOptimizeReport.sceneKelvin}K)
            </span>
          </div>
          <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-300 whitespace-nowrap shrink-0">
            Edge {autoOptimizeReport.edgeSoftness}% · Shadow {autoOptimizeReport.shadowMatcher}% · Sat{' '}
            {autoOptimizeReport.saturation > 0
              ? `+${autoOptimizeReport.saturation}`
              : autoOptimizeReport.saturation}
          </span>
        </div>
      )}

      {/* Quick Looks One-Click Photo Presets */}
      <div className="px-3 py-2 bg-slate-50/50 dark:bg-slate-950/35 border-b border-slate-200/60 dark:border-white/10 shrink-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Wand2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
              Quick Looks
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              · {activeQuickLook ? activeQuickLook.name : 'One-click presets'}
            </span>
          </div>

          {activeQuickLook && (
            <button
              type="button"
              onClick={resetQuickLook}
              className="text-[10px] font-medium text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 whitespace-nowrap shrink-0 transition-colors"
            >
              Clear Look
            </button>
          )}
        </div>

        <div className="flex items-stretch gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {QUICK_LOOKS.map((look) => {
            const isActive = activeQuickLook?.id === look.id;
            return (
              <button
                key={look.id}
                type="button"
                onClick={() => applyQuickLook(look)}
                aria-pressed={isActive}
                title={`Apply ${look.name}: ${look.subtitle}`}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left transition-all shrink-0 ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50/90 dark:bg-indigo-950/60'
                    : 'border-slate-200/80 dark:border-slate-700/80 bg-white/75 dark:bg-slate-900/75 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-md bg-gradient-to-br ${look.swatchClass} border border-black/10 dark:border-white/15 shrink-0 flex items-center justify-center`}
                >
                  {isActive && <Check className="w-3 h-3 text-slate-900 drop-shadow-xs" />}
                </div>
                <div className="min-w-0 pr-0.5">
                  <span
                    className={`block text-[11px] font-semibold leading-tight whitespace-nowrap ${
                      isActive
                        ? 'text-indigo-700 dark:text-indigo-300'
                        : 'text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {look.name}
                  </span>
                  <span className="block text-[9px] text-slate-500 dark:text-slate-400 leading-tight whitespace-nowrap mt-0.5">
                    {look.subtitle}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sliders & Tools Container (Captures real-time scrubbing for Live Preview Indicator) */}
      <div
        onPointerDownCapture={handleSliderCaptureInput}
        onInputCapture={handleSliderCaptureInput}
        className="p-3 space-y-3 flex-1 min-h-0 overflow-y-auto"
      >
        {/* TAB 1: BLEND & SKIN */}
        {activeSubTab === 'blend' && (
          <>
            {/* Swap Strength Slider */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                  Swap Strength
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 text-[11px]">
                  {adjustments.swapStrength}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.swapStrength}
                onChange={(e) =>
                  updateAdjustments({ swapStrength: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Swap Strength: ${adjustments.swapStrength}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Swap Strength: ${adjustments.swapStrength}%`)
                }
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Auto Skin Tone Matching Toggle + Strength */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-emerald-500" />
                  <div>
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Automatic Skin Tone Matching
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Reinhard statistical color matching in Lab space
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adjustments.skinToneMatch}
                    onChange={(e) =>
                      updateAdjustments(
                        { skinToneMatch: e.target.checked },
                        e.target.checked ? 'Skin Tone Matching Enabled' : 'Skin Tone Matching Disabled'
                      )
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {adjustments.skinToneMatch && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600 dark:text-slate-400">Tone Match Intensity</span>
                    <span className="font-mono text-slate-500">{adjustments.skinToneStrength}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={adjustments.skinToneStrength}
                    onChange={(e) =>
                      updateAdjustments({ skinToneStrength: Number(e.target.value) })
                    }
                    className="w-full accent-emerald-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              )}

              {/* Real-Time Target-Body Skin Reference Picker */}
              <div className="mt-2.5 pt-2.5 border-t border-slate-200/60 dark:border-slate-800/60 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {adjustments.skinReference ? (
                      <div
                        className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-700 shadow-sm shrink-0"
                        style={{
                          backgroundColor: `rgb(${Math.round(adjustments.skinReference.r)}, ${Math.round(
                            adjustments.skinReference.g
                          )}, ${Math.round(adjustments.skinReference.b)})`,
                        }}
                        title={`Sampled RGB(${Math.round(adjustments.skinReference.r)}, ${Math.round(
                          adjustments.skinReference.g
                        )}, ${Math.round(adjustments.skinReference.b)})`}
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
                        <Pipette className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Skin Reference
                      </span>
                      <span className="block text-[10px] text-slate-500 truncate">
                        {isSkinSamplingMode
                          ? 'Touch any part of target body to sample…'
                          : adjustments.skinReference
                          ? `Body Baseline #${[
                              adjustments.skinReference.r,
                              adjustments.skinReference.g,
                              adjustments.skinReference.b,
                            ]
                              .map((v) => Math.round(v).toString(16).padStart(2, '0'))
                              .join('')
                              .toUpperCase()}`
                          : 'Touch target body to override face baseline'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {adjustments.skinReference && (
                      <button
                        type="button"
                        onClick={clearSkinReference}
                        className="px-2 py-1 rounded-md text-[10px] font-medium bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
                        title="Clear custom skin reference and revert to automatic face sampling"
                      >
                        Auto
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!targetImageUrl}
                      onClick={() => {
                        const next = !isSkinSamplingMode;
                        if (next && (adjustments.brushMode !== 'none' || adjustments.showGeometricMesh)) {
                          updateAdjustments({ brushMode: 'none', showGeometricMesh: false });
                        }
                        setIsSkinSamplingMode(next);
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all whitespace-nowrap ${
                        !targetImageUrl
                          ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
                          : isSkinSamplingMode
                          ? 'bg-amber-500 text-slate-950 shadow-sm ring-2 ring-amber-400/50'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs'
                      }`}
                      title="Touch or drag on any part of the target body to set baseline color"
                    >
                      <Pipette className="w-3 h-3 shrink-0" />
                      <span>{isSkinSamplingMode ? 'Done' : 'Pick Skin'}</span>
                    </button>
                  </div>
                </div>

                {adjustments.skinReference && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-600 dark:text-slate-400">Sample Patch Size</span>
                      <span className="font-mono text-slate-500">
                        {Math.round(adjustments.skinReference.radiusRatio * 1000)}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.014"
                      max="0.075"
                      step="0.002"
                      value={adjustments.skinReference.radiusRatio}
                      onChange={(e) => {
                        const ref = adjustments.skinReference;
                        if (ref) {
                          sampleSkinReferenceAt(ref.normX, ref.normY, Number(e.target.value), false);
                        }
                      }}
                      onMouseUp={() => {
                        const ref = adjustments.skinReference;
                        if (ref) {
                          sampleSkinReferenceAt(ref.normX, ref.normY, ref.radiusRatio, true);
                        }
                      }}
                      onTouchEnd={() => {
                        const ref = adjustments.skinReference;
                        if (ref) {
                          sampleSkinReferenceAt(ref.normX, ref.normY, ref.radiusRatio, true);
                        }
                      }}
                      aria-label="Skin Reference Sample Radius"
                      className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Global Color Harmony Slider (All Active Layers Unified Palette) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-fuchsia-500 shrink-0" />
                  Global Color Harmony
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {(adjustments.globalColorHarmony ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        updateAdjustments({ globalColorHarmony: 0 }, 'Global Color Harmony: Reset')
                      }
                      className="text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:underline whitespace-nowrap"
                    >
                      Reset
                    </button>
                  )}
                  <span className="font-mono tabular-nums text-fuchsia-600 dark:text-fuchsia-400 text-[11px] font-medium">
                    {adjustments.globalColorHarmony ?? 0}%
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Harmonizes all active layers (face, hair &amp; foreground cutouts) to match target skin tone and ambient lighting
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.globalColorHarmony ?? 0}
                onChange={(e) =>
                  updateAdjustments({ globalColorHarmony: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments(
                    {},
                    `Global Color Harmony: ${adjustments.globalColorHarmony ?? 0}%`
                  )
                }
                onTouchEnd={() =>
                  updateAdjustments(
                    {},
                    `Global Color Harmony: ${adjustments.globalColorHarmony ?? 0}%`
                  )
                }
                aria-label="Global Color Harmony"
                className="w-full accent-fuchsia-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>0% Original Layer Tones</span>
                <span>50% Balanced</span>
                <span>100% Unified Scene</span>
              </div>
            </div>

            {/* Edge Feathering Tool */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-indigo-500" />
                  Base Feather Radius
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 text-[11px]">
                  {adjustments.featherRadius}px
                </span>
              </div>
              <input
                type="range"
                min="4"
                max="50"
                value={adjustments.featherRadius}
                onChange={(e) =>
                  updateAdjustments({ featherRadius: Number(e.target.value) })
                }
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Edge Softness (Face Mask Feathering Intensity) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  Edge Softness
                </span>
                <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400 text-[11px] font-medium">
                  {adjustments.edgeSoftness}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Controls the feathering intensity of the face mask for a seamless transition between swapped face and original skin
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.edgeSoftness}
                onChange={(e) =>
                  updateAdjustments({ edgeSoftness: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Edge Softness: ${adjustments.edgeSoftness}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Edge Softness: ${adjustments.edgeSoftness}%`)
                }
                aria-label="Edge Softness"
                className="w-full accent-sky-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Boundary Refinement (Alpha-Matte Feathering & Luminance Edge Matching) */}
            <div className="p-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-teal-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Boundary Refinement
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Alpha-matte feathering &amp; luminance edge matching to eliminate swap border seams
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.boundaryRefinement !== false}
                    onChange={(e) =>
                      updateAdjustments(
                        { boundaryRefinement: e.target.checked },
                        e.target.checked
                          ? 'Boundary Refinement Enabled'
                          : 'Boundary Refinement Disabled'
                      )
                    }
                    aria-label="Toggle Boundary Refinement"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-teal-600"></div>
                </label>
              </div>

              {adjustments.boundaryRefinement !== false && (
                <div className="pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60 space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Luminance &amp; Feather Match
                      </span>
                      <span className="font-mono tabular-nums text-teal-600 dark:text-teal-400 font-medium">
                        {adjustments.boundaryRefinementStrength ?? 78}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={adjustments.boundaryRefinementStrength ?? 78}
                      onChange={(e) =>
                        updateAdjustments({
                          boundaryRefinementStrength: Number(e.target.value),
                        })
                      }
                      onMouseUp={() =>
                        updateAdjustments(
                          {},
                          `Boundary Refinement: ${adjustments.boundaryRefinementStrength ?? 78}%`
                        )
                      }
                      onTouchEnd={() =>
                        updateAdjustments(
                          {},
                          `Boundary Refinement: ${adjustments.boundaryRefinementStrength ?? 78}%`
                        )
                      }
                      aria-label="Boundary Refinement"
                      className="w-full accent-teal-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Video Temporal Stabilizer (3-5 Consecutive Frame Alpha-Matte Averaging) */}
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          Temporal Stabilizer (Video)
                        </span>
                        <span className="block text-[10px] text-slate-500 leading-snug">
                          Averages boundary alpha-matte across 3–5 consecutive frames to eliminate edge flicker
                        </span>
                      </div>

                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={adjustments.boundaryTemporalStabilizer !== false}
                          onChange={(e) =>
                            updateAdjustments(
                              { boundaryTemporalStabilizer: e.target.checked },
                              e.target.checked
                                ? 'Boundary Temporal Stabilizer Enabled'
                                : 'Boundary Temporal Stabilizer Disabled'
                            )
                          }
                          aria-label="Toggle Boundary Temporal Stabilizer"
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all dark:border-slate-600 peer-checked:bg-teal-600"></div>
                      </label>
                    </div>

                    {adjustments.boundaryTemporalStabilizer !== false && (
                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          Frame Averaging Window
                        </span>
                        <div className="grid grid-cols-3 gap-1 shrink-0">
                          {[3, 4, 5].map((frames) => {
                            const currentFrames = adjustments.boundaryStabilizerFrames ?? 4;
                            const isSelected = currentFrames === frames;
                            return (
                              <button
                                key={frames}
                                type="button"
                                onClick={() =>
                                  updateAdjustments(
                                    { boundaryStabilizerFrames: frames },
                                    `Boundary Stabilizer Window: ${frames} Frames`
                                  )
                                }
                                className={`min-h-[28px] px-2 py-0.5 rounded-md text-[10px] font-mono tabular-nums font-semibold border transition-colors whitespace-nowrap ${
                                  isSelected
                                    ? 'border-teal-500 bg-teal-600 text-white'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-teal-400'
                                }`}
                              >
                                {frames}F
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* AI Skin Smoothing (Real-Time Bilateral Filter) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5 text-cyan-500" />
                  AI Skin Smoothing
                </span>
                <span className="font-mono text-cyan-600 dark:text-cyan-400 text-[11px] font-medium">
                  {adjustments.skinSmoothing}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Real-time bilateral filter smooths skin while preserving eyes &amp; lips and matching target texture
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.skinSmoothing}
                onChange={(e) =>
                  updateAdjustments({ skinSmoothing: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `AI Skin Smoothing: ${adjustments.skinSmoothing}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `AI Skin Smoothing: ${adjustments.skinSmoothing}%`)
                }
                aria-label="AI Skin Smoothing"
                className="w-full accent-cyan-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Skin Texture Smoothing (Edge-Masked Gaussian Blur) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                  Skin Texture Smoothing
                </span>
                <span className="font-mono tabular-nums text-violet-600 dark:text-violet-400 text-[11px] font-medium">
                  {adjustments.skinTextureSmoothing}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Real-time Gaussian blur mask blends synthetic skin texture with the original image while keeping eyes &amp; lips crisp
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.skinTextureSmoothing}
                onChange={(e) =>
                  updateAdjustments({ skinTextureSmoothing: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments(
                    {},
                    `Skin Texture Smoothing: ${adjustments.skinTextureSmoothing}%`
                  )
                }
                onTouchEnd={() =>
                  updateAdjustments(
                    {},
                    `Skin Texture Smoothing: ${adjustments.skinTextureSmoothing}%`
                  )
                }
                aria-label="Skin Texture Smoothing"
                className="w-full accent-violet-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Skin Texture Sync (GAN Multi-Band Target Pore Transfer) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Waves className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Skin Texture Sync
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Analyzes target pore spectrum &amp; transfers natural skin grain onto the swapped face layer
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.skinTextureSync}
                    onChange={(e) =>
                      updateAdjustments(
                        { skinTextureSync: e.target.checked },
                        e.target.checked
                          ? 'Skin Texture Sync Enabled'
                          : 'Skin Texture Sync Disabled'
                      )
                    }
                    aria-label="Toggle Skin Texture Sync"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {adjustments.skinTextureSync && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">Pore Transfer Intensity</span>
                    <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                      {adjustments.skinTextureSyncStrength}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={adjustments.skinTextureSyncStrength}
                    onChange={(e) =>
                      updateAdjustments({ skinTextureSyncStrength: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments(
                        {},
                        `Skin Texture Sync Strength: ${adjustments.skinTextureSyncStrength}%`
                      )
                    }
                    onTouchEnd={() =>
                      updateAdjustments(
                        {},
                        `Skin Texture Sync Strength: ${adjustments.skinTextureSyncStrength}%`
                      )
                    }
                    aria-label="Skin Texture Sync Strength"
                    className="w-full accent-emerald-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                  {skinTextureReport && (
                    <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      Pore Band:{' '}
                      <span className="capitalize text-slate-700 dark:text-slate-300">
                        {skinTextureReport.dominantFreqBand}
                      </span>{' '}
                      · Density {skinTextureReport.poreDensityScore}% · Gain{' '}
                      {skinTextureReport.matchedVarianceRatio.toFixed(2)}x
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Texture Denoise (Chroma-Speckle & Synthetic Noise Removal) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  Texture Denoise
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {adjustments.textureDenoise > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        updateAdjustments({ textureDenoise: 0 }, 'Texture Denoise: Reset')
                      }
                      className="text-[10px] font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
                    >
                      Reset
                    </button>
                  )}
                  <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400 text-[11px] font-medium">
                    {adjustments.textureDenoise}%
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Smooths synthetic compression &amp; chroma noise from swapping while keeping skin pores, lashes &amp; contours sharp
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.textureDenoise}
                onChange={(e) =>
                  updateAdjustments({ textureDenoise: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Texture Denoise: ${adjustments.textureDenoise}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Texture Denoise: ${adjustments.textureDenoise}%`)
                }
                aria-label="Texture Denoise"
                className="w-full accent-sky-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Age Progression (Localized Facial Texture Overlay + Subtle Contour Warping) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  Age Progression
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {adjustments.ageProgression > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        updateAdjustments({ ageProgression: 0 }, 'Age Progression: Reset')
                      }
                      className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap"
                    >
                      Reset
                    </button>
                  )}
                  <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                    {adjustments.ageProgression === 0
                      ? '0% (Natural)'
                      : `${adjustments.ageProgression}% (+${Math.round(
                          adjustments.ageProgression * 0.45
                        )}y)`}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Applies localized facial crease texture &amp; subtle contour warp to the detected face layer only (background &amp; segmented objects untouched)
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.ageProgression ?? 0}
                onChange={(e) =>
                  updateAdjustments({ ageProgression: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Age Progression: ${adjustments.ageProgression}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Age Progression: ${adjustments.ageProgression}%`)
                }
                aria-label="Age Progression"
                className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                <span>0% Baseline</span>
                <span>50% Mature</span>
                <span>100% Senior</span>
              </div>
            </div>

            {/* Smart Blend: Dynamic Skin Texture & Boundary Topology Feathering */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  <div>
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Smart Blend (Topology-Aware)
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Dynamically adapts feathering based on facial curvature & texture
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adjustments.smartBlend}
                    onChange={(e) =>
                      updateAdjustments(
                        { smartBlend: e.target.checked },
                        e.target.checked ? 'Smart Blend Enabled' : 'Smart Blend Disabled'
                      )
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {adjustments.smartBlend && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 space-y-2">
                  {/* Topology Adaptiveness Slider */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-600 dark:text-slate-400">Topology Adaptiveness</span>
                      <span className="font-mono text-slate-500">{adjustments.smartBlendIntensity}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={adjustments.smartBlendIntensity}
                      onChange={(e) =>
                        updateAdjustments({ smartBlendIntensity: Number(e.target.value) })
                      }
                      className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Texture & Pore Frequency Matching */}
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={adjustments.textureMatching}
                      onChange={(e) =>
                        updateAdjustments({ textureMatching: e.target.checked })
                      }
                      className="accent-indigo-600 rounded"
                    />
                    <span>Skin Pore & Micro-Grain Matching (Anti-Plastic Blur)</span>
                  </label>

                  {/* Real-time Topology Breakdown Badges */}
                  <div className="flex items-center gap-1.5 pt-1 text-[10px] text-slate-500 font-mono">
                    <span className="bg-slate-200/70 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                      Jaw: Crisp ({Math.round(adjustments.featherRadius * 0.45)}px)
                    </span>
                    <span className="bg-slate-200/70 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                      Cheeks: Soft ({Math.round(adjustments.featherRadius * 1.38)}px)
                    </span>
                    <span className="bg-slate-200/70 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                      Forehead: Natural ({Math.round(adjustments.featherRadius * 0.92)}px)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Motion Sensitivity: Adaptive Live Swap Quality */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Activity className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Motion Sensitivity
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Automatically adjusts swap quality using lighter processing when camera movement is high
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.motionSensitivity}
                    onChange={(e) =>
                      updateAdjustments(
                        { motionSensitivity: e.target.checked },
                        e.target.checked
                          ? 'Motion Sensitivity Enabled'
                          : 'Motion Sensitivity Disabled'
                      )
                    }
                    aria-label="Toggle Motion Sensitivity"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-amber-500"></div>
                </label>
              </div>

              {adjustments.motionSensitivity && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                  Steady camera uses full HD &amp; bilateral filtering · High motion switches to a lightweight fast pass for frame stability.
                </p>
              )}
            </div>

            {/* Motion Blur: Camera-Movement Adaptive Directional Blur */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Wind className="w-4 h-4 text-cyan-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Motion Blur (Adaptive)
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Detects camera pan direction &amp; speed in live video and applies matching directional blur to the swapped face layer
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.motionBlur}
                    onChange={(e) =>
                      updateAdjustments(
                        { motionBlur: e.target.checked },
                        e.target.checked
                          ? 'Adaptive Motion Blur Enabled'
                          : 'Adaptive Motion Blur Disabled'
                      )
                    }
                    aria-label="Toggle Adaptive Motion Blur"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-cyan-500"></div>
                </label>
              </div>

              {adjustments.motionBlur && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                  Active in Live AR video: optical block-matching tracks pan velocity &amp; streaks the morphed face layer to match frame motion.
                </p>
              )}
            </div>

            {/* Motion Smoothing: Temporal Stabilizer Toggle + Sensitivity */}
            <div
              className={`p-2.5 rounded-xl border space-y-2 transition-colors ${
                adjustments.motionSmoothingEnabled !== false
                  ? 'bg-teal-50/70 dark:bg-teal-950/25 border-teal-500/40'
                  : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Film
                    className={`w-4 h-4 shrink-0 ${
                      adjustments.motionSmoothingEnabled !== false
                        ? 'text-teal-500'
                        : 'text-slate-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Motion Smoothing
                    </span>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                      Tune temporal stabilizer sensitivity for dynamic video
                    </span>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.motionSmoothingEnabled !== false}
                    onChange={(e) => {
                      const next = e.target.checked;
                      updateAdjustments(
                        { motionSmoothingEnabled: next },
                        next ? 'Motion Smoothing Enabled' : 'Motion Smoothing Disabled'
                      );
                    }}
                    aria-label="Toggle Motion Smoothing"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-teal-500"></div>
                </label>
              </div>

              {adjustments.motionSmoothingEnabled !== false ? (
                <div className="pt-1.5 border-t border-slate-200/70 dark:border-slate-800/70 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Temporal Stabilizer Sensitivity
                    </span>
                    <span className="font-mono tabular-nums text-teal-600 dark:text-teal-400 font-semibold whitespace-nowrap">
                      {adjustments.motionSmoothing < 35
                        ? 'Gentle'
                        : adjustments.motionSmoothing >= 70
                        ? 'Strong'
                        : 'Balanced'}{' '}
                      · {adjustments.motionSmoothing}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={adjustments.motionSmoothing}
                    onChange={(e) =>
                      updateAdjustments({ motionSmoothing: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments(
                        {},
                        `Temporal Stabilizer Sensitivity: ${adjustments.motionSmoothing}%`
                      )
                    }
                    onTouchEnd={() =>
                      updateAdjustments(
                        {},
                        `Temporal Stabilizer Sensitivity: ${adjustments.motionSmoothing}%`
                      )
                    }
                    aria-label="Temporal Stabilizer Sensitivity"
                    className="w-full accent-teal-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer touch-pan-x"
                  />
                  {adjustments.boundaryTemporalStabilizer !== false && (
                    <p className="text-[10px] text-teal-700 dark:text-teal-400 tabular-nums">
                      Synced with {adjustments.boundaryStabilizerFrames ?? 4}-frame boundary alpha-matte averaging during dynamic camera motion.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                  Temporal smoothing bypassed — raw frame-by-frame tracking active.
                </p>
              )}
            </div>
          </>
        )}

        {/* TAB 2: AUTO-MASKING & FINE-TUNE BRUSH */}
        {activeSubTab === 'masking' && (
          <div className="space-y-3">
            {/* Preview Segmentation Toggle (Pre-Swap Highlight Mode) */}
            <div
              className={`p-2.5 rounded-xl border space-y-1.5 transition-colors ${
                adjustments.previewSegmentation
                  ? 'bg-cyan-50/80 dark:bg-cyan-950/35 border-cyan-500/60'
                  : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ScanLine
                    className={`w-4 h-4 shrink-0 ${
                      adjustments.previewSegmentation ? 'text-cyan-500' : 'text-sky-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Preview Segmentation
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Highlights detected hand, hair, jewelry, and face layers before applying full swap
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.previewSegmentation}
                    onChange={(e) =>
                      updateAdjustments(
                        { previewSegmentation: e.target.checked },
                        e.target.checked
                          ? 'Preview Segmentation Enabled'
                          : 'Preview Segmentation Disabled'
                      )
                    }
                    aria-label="Preview Segmentation"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-cyan-600"></div>
                </label>
              </div>
            </div>

            {/* Real-Time Occlusion Heatmap Overlay Toggle */}
            <div
              className={`p-2.5 rounded-xl border space-y-1.5 transition-colors ${
                adjustments.showOcclusionHeatmap
                  ? 'bg-orange-50/80 dark:bg-orange-950/35 border-orange-500/60'
                  : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Flame
                    className={`w-4 h-4 shrink-0 ${
                      adjustments.showOcclusionHeatmap ? 'text-orange-500' : 'text-amber-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Occlusion Heatmap
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Edge detection + depth intersection heat map around foreground hands &amp; hair
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.showOcclusionHeatmap}
                    onChange={(e) =>
                      updateAdjustments(
                        { showOcclusionHeatmap: e.target.checked },
                        e.target.checked
                          ? 'Occlusion Heatmap Enabled'
                          : 'Occlusion Heatmap Disabled'
                      )
                    }
                    aria-label="Occlusion Heatmap"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-orange-600"></div>
                </label>
              </div>
            </div>

            {/* Depth-Mapping Foreground Object Analyzer */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Depth-Map Foreground Analysis
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Analyzes target depth planes for hair, hands &amp; jewelry to auto-define cutouts
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.depthMappingEnabled}
                    onChange={(e) =>
                      updateAdjustments(
                        { depthMappingEnabled: e.target.checked },
                        e.target.checked
                          ? 'Depth Mapping Enabled'
                          : 'Depth Mapping Disabled'
                      )
                    }
                    aria-label="Depth-Map Foreground Analysis"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-amber-500"></div>
                </label>
              </div>

              {adjustments.depthMappingEnabled && (
                <div className="pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600 dark:text-slate-400">
                      Foreground Depth Threshold
                    </span>
                    <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 font-medium">
                      {adjustments.depthThreshold}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="90"
                    value={adjustments.depthThreshold}
                    onChange={(e) =>
                      updateAdjustments({ depthThreshold: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments({}, `Depth Threshold: ${adjustments.depthThreshold}%`)
                    }
                    onTouchEnd={() =>
                      updateAdjustments({}, `Depth Threshold: ${adjustments.depthThreshold}%`)
                    }
                    aria-label="Foreground Depth Threshold"
                    className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Live Segmentation Heat Map & Wireframe Visualization */}
            <SegmentationVisualizer
              visualization={segmentationVisualization}
              cutoutLayers={detectedCutoutLayers}
              detectedFaces={detectedFaces}
              hiddenLayerIds={adjustments.hiddenCutoutLayerIds || []}
              depthMappingEnabled={adjustments.depthMappingEnabled}
              hasTargetImage={Boolean(targetImageUrl)}
              imageWidth={targetImageElement?.naturalWidth || targetImageElement?.width}
              imageHeight={targetImageElement?.naturalHeight || targetImageElement?.height}
            />

            {/* Smart Masking: Edge-Detection Boundary Refinement & Anti-Halo */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Smart Masking (Edge-Detection)
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Refines swap boundaries on complex hair & ear transitions to prevent halos
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.smartMasking}
                    onChange={(e) =>
                      updateAdjustments(
                        { smartMasking: e.target.checked },
                        e.target.checked ? 'Smart Masking Enabled' : 'Smart Masking Disabled'
                      )
                    }
                    aria-label="Toggle Smart Masking"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            </div>

            {/* Smart Cleanup: Remove Floating Stray Hair Specks & Blurry Alpha Edges */}
            <div
              className={`p-2.5 rounded-xl border space-y-2 transition-colors ${
                adjustments.smartCleanup
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500/60'
                  : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Eraser
                    className={`w-4 h-4 shrink-0 ${
                      adjustments.smartCleanup ? 'text-emerald-500' : 'text-teal-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Smart Cleanup
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Auto-detects &amp; removes floating stray hairs and edge blurriness in segmented layers
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.smartCleanup}
                    onChange={(e) =>
                      updateAdjustments(
                        { smartCleanup: e.target.checked },
                        e.target.checked ? 'Smart Cleanup Enabled' : 'Smart Cleanup Disabled'
                      )
                    }
                    aria-label="Smart Cleanup"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {adjustments.smartCleanup && targetImageUrl && smartCleanupStats && (
                <div className="pt-1.5 border-t border-emerald-500/25 flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-emerald-700 dark:text-emerald-300 flex-wrap">
                  <span>
                    {smartCleanupStats.removedIslands > 0 || smartCleanupStats.removedPixels > 0
                      ? `${smartCleanupStats.removedIslands} stray clusters (${smartCleanupStats.removedPixels} px) pruned`
                      : 'No stray fragments detected'}
                  </span>
                  <span>
                    {smartCleanupStats.refinedEdgePixels} edge px tightened
                  </span>
                </div>
              )}
            </div>

            {/* Anti-Aliasing: Post-Processing Cutout Edge Smoothing */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Wand2 className="w-4 h-4 text-cyan-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Anti-Aliasing
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Post-processing filter smooths jagged edges around the face-swap cutout
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.antiAliasing}
                    onChange={(e) =>
                      updateAdjustments(
                        { antiAliasing: e.target.checked },
                        e.target.checked ? 'Anti-Aliasing Enabled' : 'Anti-Aliasing Disabled'
                      )
                    }
                    aria-label="Toggle Anti-Aliasing"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-cyan-600"></div>
                </label>
              </div>
            </div>

            {/* Edge Contrast: Local Contrast Enhancement Along Swap/Target Border */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Contrast className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  Edge Contrast
                </span>
                <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400 text-[11px] font-medium">
                  {adjustments.edgeContrast}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Enhances local contrast along the border between the swap and target image for a sharper separation
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.edgeContrast}
                onChange={(e) =>
                  updateAdjustments({ edgeContrast: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Edge Contrast: ${adjustments.edgeContrast}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Edge Contrast: ${adjustments.edgeContrast}%`)
                }
                aria-label="Edge Contrast"
                className="w-full accent-sky-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Layer Isolation View Mode (Solo Hair / Skin / Accessories / Hands / Background) */}
            <div
              className={`p-2.5 rounded-xl border space-y-2 transition-colors ${
                adjustments.isolatedLayerId !== null
                  ? 'bg-amber-50/75 dark:bg-amber-950/35 border-amber-500/60'
                  : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Crosshair
                    className={`w-4 h-4 shrink-0 ${
                      adjustments.isolatedLayerId !== null
                        ? 'text-amber-500'
                        : 'text-indigo-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Layer Isolation Mode
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Verify hair, skin, accessories &amp; hand masks on a clean matte before blending
                    </span>
                  </div>
                </div>

                {adjustments.isolatedLayerId !== null && (
                  <button
                    type="button"
                    onClick={() => toggleIsolatedLayer(null)}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap shrink-0 transition-colors"
                  >
                    Exit Solo
                  </button>
                )}
              </div>

              {(() => {
                const hairCount = detectedCutoutLayers.filter((l) => l.kind === 'hair').length;
                const accessoryCount = detectedCutoutLayers.filter(
                  (l) => l.kind === 'accessory'
                ).length;
                const occluderCount = detectedCutoutLayers.filter(
                  (l) =>
                    l.kind === 'hand_finger' ||
                    l.kind === 'forehead' ||
                    l.kind === 'object'
                ).length;

                const isolationSegments: {
                  id: string | null;
                  label: string;
                  count?: number;
                }[] = [
                  { id: null, label: 'All Layers' },
                  { id: 'cat:skin', label: 'Skin / Face' },
                  { id: 'cat:hair', label: 'Hair', count: hairCount },
                  { id: 'cat:accessory', label: 'Accessories', count: accessoryCount },
                  { id: 'cat:hand_finger', label: 'Hands / Obj', count: occluderCount },
                  { id: '__background__', label: 'Background' },
                ];

                return (
                  <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                    {isolationSegments.map((seg) => {
                      const isActive = adjustments.isolatedLayerId === seg.id;
                      const isDisabled =
                        !targetImageUrl && seg.id !== null;
                      return (
                        <button
                          key={seg.id ?? 'all'}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => toggleIsolatedLayer(seg.id)}
                          className={`min-h-[34px] px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors whitespace-nowrap flex items-center justify-center gap-1 tabular-nums disabled:opacity-40 ${
                            isActive
                              ? seg.id === null
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-amber-600 text-white border-amber-500'
                              : 'bg-white/70 dark:bg-slate-900/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:border-amber-400'
                          }`}
                        >
                          <span className="truncate">{seg.label}</span>
                          {typeof seg.count === 'number' && seg.count > 0 && (
                            <span
                              className={`text-[9px] font-mono ${
                                isActive ? 'text-white/90' : 'text-slate-400'
                              }`}
                            >
                              {seg.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Adaptive Dynamic Object-Scanning Layer Stack */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="truncate">Adaptive Cutout Stack</span>
                  </span>
                  <span className="block text-[10px] text-slate-500 font-mono tabular-nums truncate mt-0.5">
                    {targetImageUrl ? layerDecisionSummary : 'Load a photo to auto-scan objects'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={!targetImageUrl || !adjustments.preserveTargetLayers}
                    onClick={rescanObjectLayers}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-40"
                    title="Re-scan target photo for hair strands, forehead, jewelry, hands, fingers, and objects"
                  >
                    <RefreshCw className="w-3 h-3 shrink-0" />
                    <span>Scan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateAdjustments(
                        { preserveTargetLayers: !adjustments.preserveTargetLayers },
                        !adjustments.preserveTargetLayers
                          ? 'Adaptive Cutout Stack Enabled'
                          : 'Adaptive Cutout Stack Disabled'
                      )
                    }
                    className={`text-[10px] font-semibold px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                      adjustments.preserveTargetLayers
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                        : 'border-slate-300 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {adjustments.preserveTargetLayers ? `${totalLayerCount} Layers` : 'Off'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <button
                  type="button"
                  onClick={() =>
                    updateAdjustments({ showBackgroundLayer: !adjustments.showBackgroundLayer })
                  }
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
                    adjustments.showBackgroundLayer
                      ? 'bg-slate-800 text-white border-slate-700'
                      : 'bg-transparent text-slate-500 border-slate-300 dark:border-slate-800'
                  }`}
                >
                  <Eye className="w-3 h-3 shrink-0" />
                  <span>Bg Layer</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ showFaceLayer: !adjustments.showFaceLayer })}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
                    adjustments.showFaceLayer
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-transparent text-slate-500 border-slate-300 dark:border-slate-800'
                  }`}
                >
                  <Eye className="w-3 h-3 shrink-0" />
                  <span>Face</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateAdjustments({ showForeLayers: !adjustments.showForeLayers })
                  }
                  disabled={!adjustments.preserveTargetLayers}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap flex items-center justify-center gap-1 disabled:opacity-40 ${
                    adjustments.showForeLayers && adjustments.preserveTargetLayers
                      ? 'bg-emerald-600 text-white border-emerald-500'
                      : 'bg-transparent text-slate-500 border-slate-300 dark:border-slate-800'
                  }`}
                >
                  <Eye className="w-3 h-3 shrink-0" />
                  <span>All Cutouts</span>
                </button>
              </div>

              {/* Drag-and-Drop Reorderable Segmentation Layers with Individual Opacity Sliders */}
              {adjustments.preserveTargetLayers && orderedStackIds.length > 0 && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      Drag or reorder layers (Top = Front · Bottom = Above Bg)
                    </span>
                    {((adjustments.cutoutLayerOrder || []).length > 0 ||
                      Object.keys(adjustments.cutoutLayerOpacities || {}).length > 0 ||
                      Object.keys(adjustments.cutoutLayerBlendModes || {}).length > 0 ||
                      (adjustments.hiddenCutoutLayerIds || []).length > 0) && (
                      <button
                        type="button"
                        onClick={resetCutoutLayerStack}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold whitespace-nowrap shrink-0"
                      >
                        Reset Stack
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
                    {orderedStackIds.map((layerId, stackIndex) => {
                      const isFace = layerId === FACE_COMPOSITE_LAYER_ID;
                      const layer = isFace
                        ? null
                        : detectedCutoutLayers.find((l) => l.id === layerId);
                      if (!isFace && !layer) return null;

                      const isHidden = isFace
                        ? adjustments.showFaceLayer === false
                        : (adjustments.hiddenCutoutLayerIds || []).includes(layerId) ||
                          adjustments.showForeLayers === false;
                      const isVisible = !isHidden;
                      const opacity = adjustments.cutoutLayerOpacities?.[layerId] ?? 100;
                      const blendMode: LayerBlendMode =
                        adjustments.cutoutLayerBlendModes?.[layerId] ?? 'source-over';

                      const kindDotColor = isFace
                        ? 'bg-indigo-500'
                        : layer!.kind === 'forehead'
                        ? 'bg-emerald-500'
                        : layer!.kind === 'hair'
                        ? 'bg-rose-500'
                        : layer!.kind === 'hand_finger'
                        ? 'bg-amber-500'
                        : layer!.kind === 'accessory'
                        ? 'bg-sky-500'
                        : 'bg-violet-500';

                      const kindLabel = isFace
                        ? 'Swapped Face'
                        : layer!.kind === 'hand_finger'
                        ? 'Hand/Finger'
                        : layer!.kind === 'accessory'
                        ? 'Jewelry/Veil'
                        : layer!.kind === 'forehead'
                        ? 'Forehead'
                        : layer!.kind === 'hair'
                        ? 'Hair'
                        : 'Object';

                      const displayName = isFace ? 'Swapped Face Layer' : layer!.name;
                      const isBeingDragged = draggedLayerId === layerId;
                      const isDropTarget =
                        dragOverLayerId === layerId && draggedLayerId !== layerId;

                      return (
                        <div
                          key={layerId}
                          draggable
                          onDragStart={(e) => {
                            setDraggedLayerId(layerId);
                            try {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', layerId);
                            } catch {
                              // ignore browser drag quirk
                            }
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (dragOverLayerId !== layerId) {
                              setDragOverLayerId(layerId);
                            }
                          }}
                          onDragLeave={() => {
                            if (dragOverLayerId === layerId) {
                              setDragOverLayerId(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            handleLayerDrop(layerId);
                          }}
                          onDragEnd={() => {
                            setDraggedLayerId(null);
                            setDragOverLayerId(null);
                          }}
                          className={`px-2 py-2 rounded-lg border transition-colors ${
                            isDropTarget
                              ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/60 ring-1 ring-indigo-500/40'
                              : isVisible
                              ? 'bg-white dark:bg-slate-900/90 border-slate-200 dark:border-slate-700/80'
                              : 'bg-transparent border-slate-200/60 dark:border-slate-800/60 opacity-60'
                          } ${isBeingDragged ? 'opacity-45' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                                title="Drag to reorder compositing layer"
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </span>
                              <span className={`w-2 h-2 rounded-sm shrink-0 ${kindDotColor}`} />
                              <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                                {displayName}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[9px] font-mono tabular-nums text-slate-500 mr-0.5">
                                {kindLabel}
                                {!isFace && layer ? ` · z${Math.round(layer.meanDepth * 100)}` : ''}
                              </span>
                              <button
                                type="button"
                                disabled={stackIndex === 0}
                                onClick={() => moveCompositeLayer(layerId, -1)}
                                className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-25 transition-colors"
                                title="Move layer forward (toward top)"
                                aria-label={`Move ${displayName} forward`}
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={stackIndex === orderedStackIds.length - 1}
                                onClick={() => moveCompositeLayer(layerId, 1)}
                                className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-25 transition-colors"
                                title="Move layer backward (toward background)"
                                aria-label={`Move ${displayName} backward`}
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleIsolatedLayer(layerId)}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                                  adjustments.isolatedLayerId === layerId
                                    ? 'bg-amber-600 text-white border-amber-500'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400'
                                }`}
                                title={
                                  adjustments.isolatedLayerId === layerId
                                    ? 'Exit solo isolation view'
                                    : `Isolate ${displayName} on matte`
                                }
                                aria-label={`Isolate ${displayName}`}
                              >
                                Solo
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  isFace
                                    ? updateAdjustments({
                                        showFaceLayer: adjustments.showFaceLayer === false,
                                      })
                                    : toggleCutoutLayerVisibility(layerId)
                                }
                                className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                title={isVisible ? 'Hide layer' : 'Show layer'}
                                aria-label={isVisible ? `Hide ${displayName}` : `Show ${displayName}`}
                              >
                                {isVisible ? (
                                  <Eye className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                ) : (
                                  <EyeOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Individual Layer Opacity Slider */}
                          <div className="mt-1.5 pl-5 flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 whitespace-nowrap shrink-0">
                              Opacity
                            </span>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={opacity}
                              onChange={(e) =>
                                setCutoutLayerOpacity(layerId, Number(e.target.value), false)
                              }
                              onMouseUp={(e) =>
                                setCutoutLayerOpacity(
                                  layerId,
                                  Number((e.target as HTMLInputElement).value),
                                  true
                                )
                              }
                              onTouchEnd={(e) =>
                                setCutoutLayerOpacity(
                                  layerId,
                                  Number((e.target as HTMLInputElement).value),
                                  true
                                )
                              }
                              aria-label={`${displayName} Opacity`}
                              className="w-full accent-indigo-500 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                            />
                            <span className="text-[10px] font-mono tabular-nums text-indigo-600 dark:text-indigo-400 w-8 text-right shrink-0">
                              {opacity}%
                            </span>
                          </div>

                          {/* Layer Blending Mode Dropdown */}
                          <div className="mt-1.5 pl-5 flex items-center justify-between gap-2">
                            <label
                              htmlFor={`blend-mode-${layerId}`}
                              className="text-[10px] text-slate-500 whitespace-nowrap shrink-0"
                            >
                              Blend Mode
                            </label>
                            <select
                              id={`blend-mode-${layerId}`}
                              value={blendMode}
                              onChange={(e) =>
                                setCutoutLayerBlendMode(
                                  layerId,
                                  e.target.value as LayerBlendMode
                                )
                              }
                              aria-label={`${displayName} Blending Mode`}
                              className="min-h-[32px] max-w-[148px] w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              {LAYER_BLEND_MODES.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-slate-500">
                Drag layers to control z-order between hand, hair, and swapped face, select per-layer blend modes, and tune opacity to reveal the target background beneath.
              </p>
            </div>

            {/* Batch Export Masks Toggle Card */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <Download className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Batch Export Masks
                    </span>
                    <span className="block text-[10px] text-slate-500 leading-snug">
                      Save individual PNG files for every detected segment layer alongside the final morphed image
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0 min-h-[40px]">
                  <input
                    type="checkbox"
                    checked={adjustments.batchExportMasks}
                    onChange={(e) =>
                      updateAdjustments(
                        { batchExportMasks: e.target.checked },
                        e.target.checked
                          ? 'Batch Export Masks Enabled'
                          : 'Batch Export Masks Disabled'
                      )
                    }
                    aria-label="Toggle Batch Export Masks"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[10px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {adjustments.batchExportMasks && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 space-y-2">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed tabular-nums">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Queued PNGs ({2 + detectedCutoutLayers.filter((l) => !(adjustments.hiddenCutoutLayerIds || []).includes(l.id)).length}):
                    </span>{' '}
                    Final Morphed · Face Layer
                    {detectedCutoutLayers
                      .filter((l) => !(adjustments.hiddenCutoutLayerIds || []).includes(l.id))
                      .map((l) => ` · ${l.name}`)
                      .join('')}
                  </div>

                  <button
                    type="button"
                    disabled={!targetImageUrl || isBatchExportingMasks}
                    onClick={async () => {
                      const exported = await exportBatchMasksAndResult('facemorph_portrait', 1, true);
                      if (exported > 0) {
                        setBatchExportCountNotice(exported);
                        window.setTimeout(() => setBatchExportCountNotice(null), 2600);
                      }
                    }}
                    className="w-full min-h-[40px] px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-45 text-white text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isBatchExportingMasks
                        ? 'Exporting Layer PNGs...'
                        : batchExportCountNotice
                        ? `Saved ${batchExportCountNotice} PNG Files`
                        : `Export ${
                            2 +
                            detectedCutoutLayers.filter(
                              (l) => !(adjustments.hiddenCutoutLayerIds || []).includes(l.id)
                            ).length
                          } Layer PNGs Now`}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* Automated Layer Composition (.PSD Multi-Layer Export) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-start gap-2">
                <Layers className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Layer Composition (.PSD)
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-violet-600 dark:text-violet-400 font-semibold whitespace-nowrap shrink-0">
                      {2 + detectedCutoutLayers.length} Layers
                    </span>
                  </div>
                  <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">
                    Packages Background, Face Layer, and every masked segment (hands, hair, accessories) with blend modes &amp; opacities into one optimized .PSD file
                  </span>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed tabular-nums">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Stack:
                </span>{' '}
                Background · Face Layer
                {detectedCutoutLayers.map((l) => ` · ${l.name}`).join('')}
              </div>

              <button
                type="button"
                disabled={!targetImageUrl || isExportingPsd}
                onClick={async () => {
                  const result = await exportLayerCompositionPsd('facemorph_layer_composition', 1);
                  if (result) {
                    setPsdExportCountNotice(result.layerCount);
                    window.setTimeout(() => setPsdExportCountNotice(null), 2800);
                  }
                }}
                className="w-full min-h-[40px] px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isExportingPsd
                    ? 'Packaging .PSD Layers...'
                    : psdExportCountNotice
                    ? `Saved ${psdExportCountNotice}-Layer .PSD File`
                    : `Export ${2 + detectedCutoutLayers.length}-Layer .PSD Composition`}
                </span>
              </button>
            </div>

            {/* Auto Detection Toggles Box */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  Auto Segmentation Rules
                </span>
                <button
                  onClick={() =>
                    updateAdjustments({ showMaskOverlay: !adjustments.showMaskOverlay })
                  }
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    adjustments.showMaskOverlay
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-300 dark:border-slate-700 text-slate-500'
                  }`}
                  title="Toggle visual mask display"
                >
                  <Eye className="w-3 h-3" />
                  <span>{adjustments.showMaskOverlay ? 'Hide Mask' : 'View Mask'}</span>
                </button>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adjustments.autoMaskHair}
                    onChange={(e) =>
                      updateAdjustments(
                        { autoMaskHair: e.target.checked },
                        'Hair & Bangs Mask Toggled'
                      )
                    }
                    className="accent-indigo-600 rounded shrink-0"
                  />
                  <span className="truncate">Hair</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adjustments.autoMaskAccessories}
                    onChange={(e) =>
                      updateAdjustments(
                        { autoMaskAccessories: e.target.checked },
                        'Accessory Mask Toggled'
                      )
                    }
                    className="accent-indigo-600 rounded shrink-0"
                  />
                  <span className="truncate">Jewelry</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adjustments.autoMaskObjects}
                    onChange={(e) =>
                      updateAdjustments(
                        { autoMaskObjects: e.target.checked },
                        'Foreground Hands & Objects Mask Toggled'
                      )
                    }
                    className="accent-indigo-600 rounded shrink-0"
                  />
                  <span className="truncate">Hands/Obj</span>
                </label>
              </div>

              {/* Sensitivity Slider */}
              <div className="pt-1.5">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-600 dark:text-slate-400">Detection Sensitivity</span>
                  <span className="font-mono text-slate-500">{adjustments.maskSensitivity}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={adjustments.maskSensitivity}
                  onChange={(e) =>
                    updateAdjustments({ maskSensitivity: Number(e.target.value) })
                  }
                  className="w-full accent-emerald-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Segmentation Mask Brush Tool (Add / Subtract Mask Refining) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Paintbrush className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>Brush</span>
                </span>

                {hasManualMaskStrokes && (
                  <button
                    type="button"
                    onClick={clearManualMask}
                    className="text-[10px] text-rose-500 hover:text-rose-600 font-medium flex items-center gap-1 whitespace-nowrap"
                    title="Clear all painted mask strokes"
                  >
                    <Eraser className="w-3 h-3 shrink-0" />
                    <span>Clear Brush</span>
                  </button>
                )}
              </div>

              {/* Brush Mode Segmented Control */}
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-lg">
                <button
                  type="button"
                  onClick={() => updateAdjustments({ brushMode: 'none' })}
                  className={`min-h-[38px] py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    adjustments.brushMode === 'none'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Off
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ brushMode: 'protect' })}
                  className={`min-h-[38px] py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    adjustments.brushMode === 'protect'
                      ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                      : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10'
                  }`}
                  title="Paint directly on photo to add hair, fingers, or objects to the protective mask"
                >
                  Add (+ Mask)
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ brushMode: 'reveal' })}
                  className={`min-h-[38px] py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    adjustments.brushMode === 'reveal'
                      ? 'bg-rose-600 text-white shadow-xs font-semibold'
                      : 'text-rose-700 dark:text-rose-400 hover:bg-rose-500/10'
                  }`}
                  title="Paint directly on photo to subtract from the mask and reveal swapped face"
                >
                  Subtract (- Mask)
                </button>
              </div>

              {/* Brush Size & Edge Feather Settings */}
              <div className="space-y-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60">
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600 dark:text-slate-400">Brush Size</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {adjustments.brushSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="80"
                    value={adjustments.brushSize}
                    onChange={(e) =>
                      updateAdjustments({ brushSize: Number(e.target.value) })
                    }
                    aria-label="Brush Size"
                    className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600 dark:text-slate-400">Edge Feather</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {adjustments.brushFeather}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={adjustments.brushFeather}
                    onChange={(e) =>
                      updateAdjustments({ brushFeather: Number(e.target.value) })
                    }
                    aria-label="Brush Edge Feather"
                    className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                <p className="text-[10px] text-slate-500">
                  {adjustments.brushMode === 'none'
                    ? 'Choose Add (+ Mask) or Subtract (- Mask) to paint directly on hair strands, fingers, or boundary edges.'
                    : adjustments.brushMode === 'protect'
                    ? 'Drag on canvas to add hair locks, fingers, or foreground details to the protective segmentation mask.'
                    : 'Drag on canvas to erase excess mask regions around hair or fingers and reveal the swapped face.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LIGHTING & TONE */}
        {activeSubTab === 'lighting' && (
          <div className="space-y-3">
            {/* Match Ambient Light Harmonizer Card */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <SunMedium className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      Match Ambient Light
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Harmonizes color temperature and exposure to target scene lighting
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleMatchAmbientLight}
                  disabled={isMatchingLight}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-slate-950 text-xs font-semibold shadow-xs transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isMatchingLight ? 'Analyzing...' : 'Auto-Match'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-[11px]">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adjustments.autoAmbientLight}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      updateAdjustments(
                        { autoAmbientLight: enabled },
                        enabled ? 'Auto Ambient Light Sync Enabled' : 'Auto Ambient Light Sync Disabled'
                      );
                    }}
                    className="accent-amber-500 rounded"
                  />
                  <span>Auto-sync on photo change</span>
                </label>

                {ambientLightReport && (
                  <span className="font-mono tabular-nums text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
                    {ambientLightReport.sceneKelvin}K · {ambientLightReport.lightCondition} ·{' '}
                    {ambientLightReport.exposureShiftEv >= 0
                      ? `+${ambientLightReport.exposureShiftEv}`
                      : ambientLightReport.exposureShiftEv}{' '}
                    EV
                  </span>
                )}
              </div>
            </div>

            {/* Lighting Calibration: Ambient Kelvin Detection + White Balance Suggestion */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-sky-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      Lighting Calibration
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Detects ambient light temperature and suggests white balance to match source content
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCalibrateLighting}
                  disabled={isCalibratingLight || !targetImageElement}
                  className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 active:scale-[0.98] disabled:opacity-45 text-slate-950 text-xs font-semibold transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <Thermometer className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isCalibratingLight
                      ? 'Detecting...'
                      : lightingCalibrationReport
                      ? 'Recalibrate'
                      : 'Detect Light'}
                  </span>
                </button>
              </div>

              {lightingCalibrationReport && (
                <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/70 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                      {lightingCalibrationReport.ambientCondition}
                    </span>
                    <span className="font-mono tabular-nums text-[10px] text-sky-600 dark:text-sky-400 whitespace-nowrap">
                      {lightingCalibrationReport.ambientKelvin}K Ambient · {lightingCalibrationReport.sourceKelvin}K Source ({lightingCalibrationReport.confidencePct}%)
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono tabular-nums">
                    <div className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[9px] text-slate-400 font-sans">White Bal</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        {lightingCalibrationReport.suggestedTemperature >= 0
                          ? `+${lightingCalibrationReport.suggestedTemperature}`
                          : lightingCalibrationReport.suggestedTemperature}
                      </span>
                    </div>
                    <div className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[9px] text-slate-400 font-sans">Tint</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {lightingCalibrationReport.suggestedHue >= 0
                          ? `+${lightingCalibrationReport.suggestedHue}°`
                          : `${lightingCalibrationReport.suggestedHue}°`}
                      </span>
                    </div>
                    <div className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[9px] text-slate-400 font-sans">Exposure</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {lightingCalibrationReport.suggestedBrightness >= 0
                          ? `+${lightingCalibrationReport.suggestedBrightness}`
                          : lightingCalibrationReport.suggestedBrightness}
                      </span>
                    </div>
                    <div className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[9px] text-slate-400 font-sans">Chroma</span>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        {lightingCalibrationReport.suggestedSaturation >= 0
                          ? `+${lightingCalibrationReport.suggestedSaturation}`
                          : lightingCalibrationReport.suggestedSaturation}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {lightingCalibrationReport.whiteBalanceLabel} · {lightingCalibrationReport.tintAxisLabel}
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyWhiteBalanceSuggestion}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                        calibrationAppliedNotice
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      <Check className="w-3 h-3 shrink-0" />
                      <span>{calibrationAppliedNotice ? 'Applied' : 'Apply White Balance'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Source-to-Target Auto-Match Lighting Card (applies source face Kelvin & intensity filter to target layer) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="w-4 h-4 text-cyan-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      Target Layer Lighting Filter
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Reads source face color temp & intensity and filters target background & cutouts
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {adjustments.targetLightingFilter?.enabled && (
                    <button
                      type="button"
                      onClick={clearTargetLightingFilter}
                      className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAutoMatchTargetLighting}
                    disabled={isMatchingTargetLight || !targetImageElement}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-45 text-slate-950 text-xs font-semibold transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5"
                  >
                    <Wand2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{isMatchingTargetLight ? 'Calculating...' : 'Auto-Match Lighting'}</span>
                  </button>
                </div>
              </div>

              {adjustments.targetLightingFilter?.enabled && (
                <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-[10px] font-mono tabular-nums">
                  <div className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="block text-[9px] text-slate-400 uppercase font-sans">
                      Source Temp
                    </span>
                    <span className="font-semibold text-cyan-600 dark:text-cyan-400">
                      {adjustments.targetLightingFilter.sourceKelvin}K
                    </span>
                  </div>
                  <div className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="block text-[9px] text-slate-400 uppercase font-sans">
                      Light Level
                    </span>
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      {adjustments.targetLightingFilter.sourceIntensity}%
                    </span>
                  </div>
                  <div className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="block text-[9px] text-slate-400 uppercase font-sans">
                      Target Shift
                    </span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {adjustments.targetLightingFilter.brightnessShift >= 0
                        ? `+${adjustments.targetLightingFilter.brightnessShift}`
                        : adjustments.targetLightingFilter.brightnessShift}
                      L /{' '}
                      {adjustments.targetLightingFilter.temperatureShift >= 0
                        ? `+${adjustments.targetLightingFilter.temperatureShift}`
                        : adjustments.targetLightingFilter.temperatureShift}
                      W
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Global Color Harmony Slider (All Active Layers) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-fuchsia-500 shrink-0" />
                  <span>Global Color Harmony</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {(adjustments.globalColorHarmony ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        updateAdjustments({ globalColorHarmony: 0 }, 'Global Color Harmony: Reset')
                      }
                      className="text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:underline whitespace-nowrap"
                    >
                      Reset
                    </button>
                  )}
                  <span className="font-mono tabular-nums text-fuchsia-600 dark:text-fuchsia-400 text-[11px] font-medium">
                    {adjustments.globalColorHarmony ?? 0}%
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Adjusts the color palette of all active layers to match target skin tone and ambient lighting environment
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.globalColorHarmony ?? 0}
                onChange={(e) =>
                  updateAdjustments({ globalColorHarmony: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments(
                    {},
                    `Global Color Harmony: ${adjustments.globalColorHarmony ?? 0}%`
                  )
                }
                onTouchEnd={() =>
                  updateAdjustments(
                    {},
                    `Global Color Harmony: ${adjustments.globalColorHarmony ?? 0}%`
                  )
                }
                aria-label="Global Color Harmony"
                className="w-full accent-fuchsia-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>0% Original</span>
                <span>50% Balanced</span>
                <span>100% Unified Harmony</span>
              </div>
            </div>

            {/* Real-Time Luminance Histogram */}
            <LuminanceHistogram />

            {/* Real-Time Lighting Adjustment Slider */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Lighting Adjustment</span>
                </span>
                <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                  {adjustments.lightingAdjustment}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                Matches swapped face brightness and contrast to the original background in real-time
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.lightingAdjustment}
                onChange={(e) =>
                  updateAdjustments({ lightingAdjustment: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments(
                    {},
                    `Lighting Adjustment: ${adjustments.lightingAdjustment}%`
                  )
                }
                onTouchEnd={() =>
                  updateAdjustments(
                    {},
                    `Lighting Adjustment: ${adjustments.lightingAdjustment}%`
                  )
                }
                aria-label="Lighting Adjustment"
                className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>0% Source Face</span>
                <span>50% Balanced</span>
                <span>100% Background Match</span>
              </div>
            </div>

            {/* Shadow Matcher Intensity Slider */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <CloudMoon className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>Shadow Matcher</span>
                </span>
                <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px] font-medium">
                  {adjustments.shadowMatcher}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                Automatically adjusts shadow overlay depth and opacity on the replaced face to match original scene ambient lighting
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.shadowMatcher}
                onChange={(e) =>
                  updateAdjustments({ shadowMatcher: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Shadow Matcher: ${adjustments.shadowMatcher}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Shadow Matcher: ${adjustments.shadowMatcher}%`)
                }
                aria-label="Shadow Matcher"
                className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>0% Off</span>
                <span>50% Natural</span>
                <span>100% Full Scene Depth</span>
              </div>
            </div>

            {/* Lighting Presets Gallery */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Lighting Presets</span>
                </span>

                <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-900 p-0.5 rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'studio', label: 'Studio' },
                      { id: 'outdoor', label: 'Outdoor' },
                      { id: 'cinematic', label: 'Cinematic' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setPresetCategory(cat.id)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                        presetCategory === cat.id
                          ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {visiblePresets.map((preset) => {
                  const isActive =
                    adjustments.brightness === preset.values.brightness &&
                    adjustments.shadows === preset.values.shadows &&
                    adjustments.contrast === preset.values.contrast &&
                    adjustments.temperature === preset.values.temperature &&
                    adjustments.saturation === preset.values.saturation;

                  const CategoryIcon =
                    preset.category === 'studio'
                      ? Camera
                      : preset.category === 'outdoor'
                      ? Trees
                      : Film;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyLightingPreset(preset)}
                      className={`group text-left p-2 rounded-lg border transition-all flex flex-col gap-1.5 ${
                        isActive
                          ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 shadow-xs'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                      title={`Apply ${preset.name}: ${preset.subtitle}`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div
                          className={`w-6 h-6 rounded-md bg-gradient-to-br ${preset.swatchClass} border border-black/10 dark:border-white/15 shrink-0 flex items-center justify-center`}
                        >
                          {isActive && <Check className="w-3 h-3 text-slate-900 drop-shadow-xs" />}
                        </div>
                        <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                          <CategoryIcon className="w-2.5 h-2.5" />
                          {preset.category}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <span
                          className={`block text-[11px] font-semibold leading-tight truncate ${
                            isActive
                              ? 'text-indigo-700 dark:text-indigo-300'
                              : 'text-slate-800 dark:text-slate-100'
                          }`}
                        >
                          {preset.name}
                        </span>
                        <span className="block text-[9px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {preset.subtitle}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Brightness */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    Brightness
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                    {adjustments.brightness > 0 ? `+${adjustments.brightness}` : adjustments.brightness}
                  </span>
                </div>
                <input
                  type="range"
                  min="-60"
                  max="60"
                  value={adjustments.brightness}
                  onChange={(e) => updateAdjustments({ brightness: Number(e.target.value) })}
                  onMouseUp={() => updateAdjustments({}, `Brightness: ${adjustments.brightness}`)}
                  onTouchEnd={() => updateAdjustments({}, `Brightness: ${adjustments.brightness}`)}
                  className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Shadows */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <CloudMoon className="w-3.5 h-3.5 text-indigo-400" />
                    Shadow Lift
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                    {adjustments.shadows > 0 ? `+${adjustments.shadows}` : adjustments.shadows}
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={adjustments.shadows}
                  onChange={(e) => updateAdjustments({ shadows: Number(e.target.value) })}
                  onMouseUp={() => updateAdjustments({}, `Shadow Lift: ${adjustments.shadows}`)}
                  onTouchEnd={() => updateAdjustments({}, `Shadow Lift: ${adjustments.shadows}`)}
                  className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Contrast */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Contrast className="w-3.5 h-3.5 text-blue-500" />
                    Contrast
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                    {adjustments.contrast > 0 ? `+${adjustments.contrast}` : adjustments.contrast}
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={adjustments.contrast}
                  onChange={(e) => updateAdjustments({ contrast: Number(e.target.value) })}
                  onMouseUp={() => updateAdjustments({}, `Contrast: ${adjustments.contrast}`)}
                  onTouchEnd={() => updateAdjustments({}, `Contrast: ${adjustments.contrast}`)}
                  className="w-full accent-blue-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

            {/* Warmth / Color Temperature */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5 text-orange-500" />
                  Warmth
                </span>
                <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                  {adjustments.temperature > 0 ? `+${adjustments.temperature}` : adjustments.temperature}
                </span>
              </div>
              <input
                type="range"
                min="-40"
                max="40"
                value={adjustments.temperature}
                onChange={(e) => updateAdjustments({ temperature: Number(e.target.value) })}
                onMouseUp={() => updateAdjustments({}, `Warmth: ${adjustments.temperature}`)}
                onTouchEnd={() => updateAdjustments({}, `Warmth: ${adjustments.temperature}`)}
                className="w-full accent-orange-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Color Correction Section (Saturation, Hue, Vibrance) */}
            <div className="sm:col-span-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    Color Correction
                  </span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    Fine-tune Saturation, Hue, and Vibrance to match the source image color profile
                  </span>
                </div>

                {(adjustments.saturation !== 0 ||
                  adjustments.hue !== 0 ||
                  adjustments.vibrance !== 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      updateAdjustments(
                        { saturation: 0, hue: 0, vibrance: 0 },
                        'Color Correction Reset'
                      )
                    }
                    className="text-[10px] font-medium text-rose-500 hover:text-rose-400 whitespace-nowrap shrink-0"
                  >
                    Reset Color
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                {/* Saturation */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Saturation
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                      {adjustments.saturation > 0
                        ? `+${adjustments.saturation}`
                        : adjustments.saturation}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={adjustments.saturation}
                    onChange={(e) =>
                      updateAdjustments({ saturation: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments({}, `Saturation: ${adjustments.saturation}`)
                    }
                    onTouchEnd={() =>
                      updateAdjustments({}, `Saturation: ${adjustments.saturation}`)
                    }
                    aria-label="Saturation"
                    className="w-full accent-rose-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Hue */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Hue
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                      {adjustments.hue > 0 ? `+${adjustments.hue}°` : `${adjustments.hue}°`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={adjustments.hue}
                    onChange={(e) =>
                      updateAdjustments({ hue: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments({}, `Hue: ${adjustments.hue}°`)
                    }
                    onTouchEnd={() =>
                      updateAdjustments({}, `Hue: ${adjustments.hue}°`)
                    }
                    aria-label="Hue"
                    className="w-full accent-violet-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Vibrance */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Vibrance
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                      {adjustments.vibrance > 0
                        ? `+${adjustments.vibrance}`
                        : adjustments.vibrance}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={adjustments.vibrance}
                    onChange={(e) =>
                      updateAdjustments({ vibrance: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments({}, `Vibrance: ${adjustments.vibrance}`)
                    }
                    onTouchEnd={() =>
                      updateAdjustments({}, `Vibrance: ${adjustments.vibrance}`)
                    }
                    aria-label="Vibrance"
                    className="w-full accent-fuchsia-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Soft Bloom (Cinematic Skin Highlight Glow) */}
            <div className="sm:col-span-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  Soft Bloom
                </span>
                <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                  {adjustments.softBloom}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-1.5">
                Adds a subtle halation glow to skin highlights for a polished cinematic finish
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.softBloom}
                onChange={(e) => updateAdjustments({ softBloom: Number(e.target.value) })}
                onMouseUp={() => updateAdjustments({}, `Soft Bloom: ${adjustments.softBloom}%`)}
                onTouchEnd={() => updateAdjustments({}, `Soft Bloom: ${adjustments.softBloom}%`)}
                aria-label="Soft Bloom"
                className="w-full accent-amber-400 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
            </div>
          </div>
        )}

        {/* TAB 4: ALIGNMENT & TRANSFORM */}
        {activeSubTab === 'transform' && (
          <div className="space-y-3">
            {/* Flip Face & Auto-Adjust with Target Face */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <FlipHorizontal2 className="w-3.5 h-3.5 text-fuchsia-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Flip Face &amp; Target Align
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Mirror source face horizontally and auto-align landmarks to match target face pose
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adjustments.flipHorizontal}
                      onChange={() => void flipFaceAndAdjust()}
                      aria-label="Flip Face Horizontally"
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-fuchsia-600"></div>
                  </label>

                  <button
                    type="button"
                    onClick={() => void flipFaceAndAdjust()}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 transition-colors ${
                      adjustments.flipHorizontal
                        ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-fuchsia-600 hover:text-white'
                    }`}
                  >
                    <FlipHorizontal2 className="w-3 h-3 shrink-0" />
                    <span>{adjustments.flipHorizontal ? 'Unflip' : 'Flip & Align'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Angle Alignment Guide Overlay Toggle */}
            <div
              className={`p-2.5 rounded-xl border space-y-1.5 transition-colors ${
                adjustments.showAngleGuide
                  ? 'bg-sky-50/80 dark:bg-sky-950/35 border-sky-500/60'
                  : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Compass
                    className={`w-4 h-4 shrink-0 ${
                      adjustments.showAngleGuide ? 'text-sky-500' : 'text-indigo-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Angle Alignment Guide
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      3D yaw, pitch &amp; roll guidelines on canvas for 1:1 profile pose matching
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.showAngleGuide}
                    onChange={(e) =>
                      updateAdjustments(
                        { showAngleGuide: e.target.checked },
                        e.target.checked
                          ? 'Angle Alignment Guide Enabled'
                          : 'Angle Alignment Guide Disabled'
                      )
                    }
                    aria-label="Angle Alignment Guide"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-sky-600"></div>
                </label>
              </div>
            </div>

            {/* 96-100% Auto Angle Match Scanner */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <ScanFace className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Auto Angle Match ({adjustments.minAngleMatchScore}–100%)
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Scans stored angles &amp; prompts if no {adjustments.minAngleMatchScore}–100% pose match exists
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adjustments.autoMatchAngle}
                      onChange={(e) =>
                        updateAdjustments(
                          { autoMatchAngle: e.target.checked },
                          e.target.checked
                            ? '96-100% Angle Match Enabled'
                            : '96-100% Angle Match Disabled'
                        )
                      }
                      aria-label="Enable Auto Angle Match"
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                  </label>

                  <button
                    type="button"
                    onClick={() => void scanAndMatchFaceAngle(undefined, '__all__')}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 transition-colors"
                  >
                    <ScanFace className="w-3 h-3 shrink-0" />
                    <span>Scan Match</span>
                  </button>
                </div>
              </div>

              {adjustments.autoMatchAngle && (
                <div className="pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">
                      Required Pose Similarity
                    </span>
                    <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 font-semibold">
                      {adjustments.minAngleMatchScore}%–100%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="85"
                    max="100"
                    step="1"
                    value={adjustments.minAngleMatchScore}
                    onChange={(e) =>
                      updateAdjustments({ minAngleMatchScore: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments(
                        {},
                        `Angle Match Threshold: ${adjustments.minAngleMatchScore}%`
                      )
                    }
                    onTouchEnd={() =>
                      updateAdjustments(
                        {},
                        `Angle Match Threshold: ${adjustments.minAngleMatchScore}%`
                      )
                    }
                    aria-label="Minimum Angle Match Score"
                    className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                  {(() => {
                    const activeFaceId = selectedFaceId || detectedFaces[0]?.id;
                    const scan = activeFaceId ? angleScanResults[activeFaceId] : undefined;
                    if (!scan) return null;
                    return (
                      <div className="flex items-center justify-between text-[10px] font-mono tabular-nums pt-0.5">
                        <span className="text-slate-500 truncate">
                          Best: {scan.angleLabel}
                          {scan.shouldFlip ? ' (Flipped)' : ''}
                        </span>
                        <span
                          className={
                            scan.isMatch96To100
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-amber-600 dark:text-amber-400 font-semibold'
                          }
                        >
                          {scan.matchScore}% {scan.isMatch96To100 ? '· Matched' : '· Create Angle'}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Face Scale */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">Face Scale</span>
                <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                  {Math.round(adjustments.scale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.25"
                step="0.01"
                value={adjustments.scale}
                onChange={(e) => updateAdjustments({ scale: Number(e.target.value) })}
                onMouseUp={() => updateAdjustments({}, `Face Scale: ${Math.round(adjustments.scale * 100)}%`)}
                onTouchEnd={() => updateAdjustments({}, `Face Scale: ${Math.round(adjustments.scale * 100)}%`)}
                aria-label="Face Scale"
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Head Rotation (Pitch, Yaw, Roll Orientation) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Head Rotation
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Manually correct pitch, yaw &amp; roll when ML detection is off-axis
                  </p>
                </div>
                {((adjustments.headPitch ?? 0) !== 0 ||
                  (adjustments.headYaw ?? 0) !== 0 ||
                  adjustments.rotation !== 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      updateAdjustments(
                        { headPitch: 0, headYaw: 0, rotation: 0 },
                        'Reset Head Rotation'
                      )
                    }
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Pitch */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Pitch <span className="text-[10px] text-slate-400 font-normal">(Up / Down)</span>
                  </span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px]">
                    {(adjustments.headPitch ?? 0) > 0 ? `+${adjustments.headPitch}` : adjustments.headPitch ?? 0}°
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={adjustments.headPitch ?? 0}
                  onChange={(e) => updateAdjustments({ headPitch: Number(e.target.value) })}
                  onMouseUp={() =>
                    updateAdjustments({}, `Head Pitch: ${adjustments.headPitch ?? 0}°`)
                  }
                  onTouchEnd={() =>
                    updateAdjustments({}, `Head Pitch: ${adjustments.headPitch ?? 0}°`)
                  }
                  aria-label="Head Pitch"
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Yaw */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Yaw <span className="text-[10px] text-slate-400 font-normal">(Left / Right)</span>
                  </span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px]">
                    {(adjustments.headYaw ?? 0) > 0 ? `+${adjustments.headYaw}` : adjustments.headYaw ?? 0}°
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={adjustments.headYaw ?? 0}
                  onChange={(e) => updateAdjustments({ headYaw: Number(e.target.value) })}
                  onMouseUp={() =>
                    updateAdjustments({}, `Head Yaw: ${adjustments.headYaw ?? 0}°`)
                  }
                  onTouchEnd={() =>
                    updateAdjustments({}, `Head Yaw: ${adjustments.headYaw ?? 0}°`)
                  }
                  aria-label="Head Yaw"
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Roll */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Roll <span className="text-[10px] text-slate-400 font-normal">(Tilt)</span>
                  </span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px]">
                    {adjustments.rotation > 0 ? `+${adjustments.rotation}` : adjustments.rotation}°
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={adjustments.rotation}
                  onChange={(e) => updateAdjustments({ rotation: Number(e.target.value) })}
                  onMouseUp={() =>
                    updateAdjustments({}, `Head Roll: ${adjustments.rotation}°`)
                  }
                  onTouchEnd={() =>
                    updateAdjustments({}, `Head Roll: ${adjustments.rotation}°`)
                  }
                  aria-label="Head Roll"
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Gender Morph (Jawline & Brow Ridge Prominence) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-500 shrink-0" />
                  Gender Morph
                </span>
                <span className="font-mono tabular-nums text-fuchsia-600 dark:text-fuchsia-400 text-[11px] font-medium">
                  {adjustments.genderMorph === 0
                    ? 'Neutral (0)'
                    : adjustments.genderMorph > 0
                    ? `Define (+${adjustments.genderMorph})`
                    : `Soften (${adjustments.genderMorph})`}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Subtly adjusts jawline &amp; brow ridge prominence when swapping faces across different features
              </p>
              <input
                type="range"
                min="-100"
                max="100"
                value={adjustments.genderMorph}
                onChange={(e) =>
                  updateAdjustments({ genderMorph: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Gender Morph: ${adjustments.genderMorph}`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Gender Morph: ${adjustments.genderMorph}`)
                }
                aria-label="Gender Morph"
                className="w-full accent-fuchsia-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                <span>Softer Jaw &amp; Brow</span>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ genderMorph: 0 }, 'Gender Morph: Neutral')}
                  className="text-fuchsia-600 dark:text-fuchsia-400 hover:underline font-medium"
                >
                  Reset Neutral
                </button>
                <span>Defined Jaw &amp; Brow</span>
              </div>
            </div>

            {/* Show Face Landmarks Wireframe Grid Toggle */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Show Face Landmarks
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Overlays a real-time wireframe grid on the detected face for precise adjustment visualization
                </span>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={adjustments.showFaceLandmarks}
                  onChange={(e) =>
                    updateAdjustments(
                      { showFaceLandmarks: e.target.checked },
                      e.target.checked
                        ? 'Face Landmarks Wireframe Shown'
                        : 'Face Landmarks Wireframe Hidden'
                    )
                  }
                  aria-label="Show Face Landmarks"
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-sky-500"></div>
              </label>
            </div>

            {/* Geometric Landmark Mesh & Manual Alignment Toggle */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-cyan-500" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Geometric Landmark Mesh
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Drag eyes, nose, lips or jawline directly on photo to correct auto-alignment
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  updateAdjustments({ showGeometricMesh: !adjustments.showGeometricMesh })
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  adjustments.showGeometricMesh
                    ? 'bg-cyan-600 text-white shadow-xs'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {adjustments.showGeometricMesh ? 'Mesh Active' : 'Show Mesh'}
              </button>
            </div>

            {/* Auto-Refocus Trigger & Sudden-Shift Tracking */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Auto-Refocus
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Re-centers camera bounding box on the largest detected face on sudden subject shifts
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label
                  className="relative inline-flex items-center cursor-pointer"
                  title="Automatically re-center bounding box on sudden subject shifts"
                >
                  <input
                    type="checkbox"
                    checked={adjustments.autoRefocus}
                    onChange={(e) =>
                      updateAdjustments(
                        { autoRefocus: e.target.checked },
                        e.target.checked ? 'Auto-Refocus Enabled' : 'Auto-Refocus Disabled'
                      )
                    }
                    aria-label="Auto-Refocus on shift"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-cyan-600"></div>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    if (!adjustments.autoRefocus) {
                      updateAdjustments({ autoRefocus: true }, 'Auto-Refocus Enabled');
                    }
                    triggerAutoRefocus();
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 bg-cyan-600 hover:bg-cyan-500 text-white shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  <span>Auto-Refocus</span>
                </button>
              </div>
            </div>

            {/* Micro Alignment Nudge Pad */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Move className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  Position Nudge
                </span>
                <span className="text-[10px] text-slate-500 font-mono tabular-nums truncate">
                  ({adjustments.offsetX}px, {adjustments.offsetY}px)
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetX: adjustments.offsetX - 3 })}
                  aria-label="Nudge left"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetX: adjustments.offsetX + 3 })}
                  aria-label="Nudge right"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetY: adjustments.offsetY - 3 })}
                  aria-label="Nudge up"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetY: adjustments.offsetY + 3 })}
                  aria-label="Nudge down"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetX: 0, offsetY: 0 })}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  Center
                </button>
              </div>
            </div>
          </div>
        )}
          </div>
        </>
      )}
    </div>
  );
};
