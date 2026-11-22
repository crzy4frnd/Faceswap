import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  DetectedFace,
  DuplicateAngleCheckResult,
  FaceAdjustments,
  FaceAngleMatchResult,
  FaceAngleVariant,
  FaceProfile,
  FACE_COMPOSITE_LAYER_ID,
  HistoryItem,
  BatchItem,
  LayerBlendMode,
  LightingCalibrationSuggestion,
  Point,
  Rect,
  FaceLandmarks,
  LiveCameraConfig,
  SegmentationVisualizationData,
  SegmentedCutoutLayerSummary,
  SkinReferenceSample,
  SkinTextureAnalysisReport,
  SmartCleanupStats,
  TargetLightingFilter,
} from '../types/face';
import { WardrobeAsset, WardrobeCategory } from '../types/body';
import {
  BUILTIN_CLOTHING_TAGS,
  ClothingTagDef,
  INITIAL_WARDROBE_ASSETS,
  loadSavedCustomAssets,
  loadSavedCustomClothingTags,
  normalizeTagId,
  saveCustomAssetsToStorage,
  saveCustomClothingTagsToStorage,
} from '../utils/bodyAssets';
import { INITIAL_FACE_PROFILES, DEFAULT_ADJUSTMENTS } from '../utils/sampleData';
import {
  loadSavedAdjustments,
  saveAdjustmentsToStorage,
} from '../utils/adjustmentStorage';
import {
  AmbientLightReport,
  AutoOptimizeReport,
  analyzeFaceForAngleVariant,
  checkDuplicateAngle,
  computeAmbientLightMatch,
  computeAutoAlignTransform,
  computeLightingCalibrationSuggestion,
  computeMLSceneAutoOptimize,
  computeSourceToTargetLightingFilter,
  detectFacesOnCanvas,
  generateBatchExportMaskAssets,
  generateLayerCompositionPsdAssets,
  inspectDiscreteTargetLayers,
  loadImage,
  renderFaceSwap,
  sampleTargetSkinReference,
  scanProfileForBestAngleMatch,
} from '../utils/faceEngine';
import { downloadCanvasImage } from '../utils/tiffExporter';
import { downloadPsdDocument } from '../utils/psdExporter';

interface FaceStudioContextType {
  // Theme & View
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  viewMode: 'android' | 'expanded';
  setViewMode: (mode: 'android' | 'expanded') => void;
  isInspectorOpen: boolean;
  setIsInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  activeTab: 'studio' | 'body' | 'camera' | 'vault' | 'batch' | 'history';
  setActiveTab: (tab: 'studio' | 'body' | 'camera' | 'vault' | 'batch' | 'history') => void;

  // Target Image & Detection
  targetImageUrl: string;
  setTargetImageUrl: (url: string) => void;
  targetImageElement: HTMLImageElement | null;
  detectedFaces: DetectedFace[];
  selectedFaceId: string | null;
  setSelectedFaceId: (id: string | null) => void;
  toggleFaceEnabled: (id: string) => void;
  setFaceIndividualStrength: (id: string, strength: number) => void;
  rescanFaces: () => Promise<void>;
  updateFaceLandmark: (faceId: string, landmarkKey: string, pos: Point, isDelta?: boolean) => void;
  resetFaceLandmarks: (faceId: string) => void;
  autoAlignFace: (faceId?: string) => Promise<{ scale: number; rotation: number; offsetX: number; offsetY: number } | null>;

  // Profiles (Cutout Store / Multi-Person Multi-Angle Face Vault)
  profiles: FaceProfile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  assignProfileToFace: (faceId: string, profileId: string) => void;
  assignProfileToAllFaces: (profileId: string) => void;
  addFaceProfile: (profile: FaceProfile) => void;
  addFaceFromDataUrl: (dataUrl: string, customName?: string, sourceTag?: string) => Promise<FaceProfile | null>;
  createPersonProfile: (
    dataUrl: string,
    personName: string,
    sourceTag?: string
  ) => Promise<FaceProfile | null>;
  addAngleToProfile: (
    profileId: string,
    dataUrl: string,
    sourceTag?: string
  ) => Promise<{
    added: boolean;
    angle?: FaceAngleVariant;
    duplicateCheck: DuplicateAngleCheckResult;
  }>;
  removeAngleFromProfile: (profileId: string, angleId: string) => void;
  removeFaceProfile: (id: string) => void;
  getProfileImage: (profileId: string) => HTMLImageElement | null;
  profileImagesVersion: number;

  // 96-100% Angle Matching & Flip Face Alignment
  angleScanResults: Record<string, FaceAngleMatchResult>;
  scanAndMatchFaceAngle: (
    faceId?: string,
    profileIdOverride?: string | '__all__'
  ) => Promise<FaceAngleMatchResult | null>;
  overrideClosestAngleMatch: (faceId: string) => void;
  flipFaceAndAdjust: (faceId?: string) => Promise<void>;

  // Adjustments & Engine
  adjustments: FaceAdjustments;
  updateAdjustments: (partial: Partial<FaceAdjustments>, actionLabel?: string) => void;
  resetAdjustments: () => void;
  ambientLightReport: AmbientLightReport | null;
  matchAmbientLight: (faceId?: string) => Promise<AmbientLightReport | null>;
  lightingCalibrationReport: LightingCalibrationSuggestion | null;
  analyzeLightingCalibration: (faceId?: string) => Promise<LightingCalibrationSuggestion | null>;
  autoMatchTargetLighting: (faceId?: string) => Promise<TargetLightingFilter | null>;
  clearTargetLightingFilter: () => void;
  autoOptimizeReport: AutoOptimizeReport | null;
  autoOptimizeWithCamera: () => Promise<AutoOptimizeReport | null>;
  liveCameraVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  outputCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  manualMaskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  clearManualMask: () => void;
  hasManualMaskStrokes: boolean;
  setHasManualMaskStrokes: (has: boolean) => void;
  triggerRender: () => Promise<void>;
  isProcessing: boolean;

  // Comparison & Real-time Preview
  compareMode: 'off' | 'split' | 'side-by-side' | 'peek';
  setCompareMode: (mode: 'off' | 'split' | 'side-by-side' | 'peek') => void;
  splitPos: number;
  setSplitPos: (pos: number) => void;
  isPeekingOriginal: boolean;
  setIsPeekingOriginal: (peek: boolean) => void;

  // History
  history: HistoryItem[];
  historyIndex: number;
  undo: () => void;
  redo: () => void;
  revertToOriginal: () => void;
  canUndo: boolean;
  canRedo: boolean;
  jumpToHistory: (index: number) => void;

  // Modals, Safe Back Navigation & Batch
  showExportModal: boolean;
  setShowExportModal: (show: boolean) => void;
  showGitHubModal: boolean;
  setShowGitHubModal: (show: boolean) => void;
  showExitConfirmModal: boolean;
  setShowExitConfirmModal: (show: boolean) => void;
  exitConfirmState: {
    title: string;
    message: string;
    targetLabel: string;
    kind: 'tool' | 'tab' | 'app';
  } | null;
  onBackPress: () => boolean;
  confirmExitAction: () => void;
  cancelExitAction: () => void;
  batchQueue: BatchItem[];
  setBatchQueue: React.Dispatch<React.SetStateAction<BatchItem[]>>;
  runBatchProcessing: (profileId: string) => Promise<void>;
  isBatchRunning: boolean;

  // Wardrobe & Custom Costume/Jewelry/Object Assets
  wardrobeAssets: WardrobeAsset[];
  addWardrobeAsset: (asset: WardrobeAsset) => void;
  removeWardrobeAsset: (id: string) => void;
  customClothingTags: ClothingTagDef[];
  allClothingTags: ClothingTagDef[];
  addCustomClothingTag: (label: string, defaultAnchor?: WardrobeAsset['anchorPoint'], defaultFabric?: NonNullable<WardrobeAsset['fabricType']>) => ClothingTagDef | null;
  showCustomAssetModal: boolean;
  setShowCustomAssetModal: (show: boolean) => void;
  openCustomAssetModal: (category?: WardrobeCategory, initialSource?: 'camera' | 'upload' | 'samples') => void;
  customAssetInitialCategory: WardrobeCategory;
  customAssetInitialSource: 'camera' | 'upload' | 'samples';

  // Live Camera Preview State & Real-Time Sync
  liveCameraConfig: LiveCameraConfig;
  setLiveCameraConfig: React.Dispatch<React.SetStateAction<LiveCameraConfig>>;
  liveSyncedFaceId: string | null;
  setLiveSyncedFaceId: React.Dispatch<React.SetStateAction<string | null>>;
  syncFaceToLive: (faceId?: string) => void;
  // Auto-Refocus Camera Re-Centering Trigger
  refocusSignal: number;
  triggerAutoRefocus: () => void;

  // Real-Time Target Body Skin Reference Picker
  isSkinSamplingMode: boolean;
  setIsSkinSamplingMode: (active: boolean) => void;
  sampleSkinReferenceAt: (
    normX: number,
    normY: number,
    radiusRatio?: number,
    commitHistory?: boolean
  ) => SkinReferenceSample | null;
  clearSkinReference: () => void;

  // Adaptive Object-Scanning Cutout Layers & Depth Visualization
  detectedCutoutLayers: SegmentedCutoutLayerSummary[];
  segmentationVisualization: SegmentationVisualizationData | null;
  smartCleanupStats: SmartCleanupStats | null;
  skinTextureReport: SkinTextureAnalysisReport | null;
  layerDecisionSummary: string;
  totalLayerCount: number;
  toggleCutoutLayerVisibility: (layerId: string) => void;
  setCutoutLayerOpacity: (layerId: string, opacity: number, commitHistory?: boolean) => void;
  setCutoutLayerBlendMode: (layerId: string, blendMode: LayerBlendMode) => void;
  reorderCutoutLayers: (nextFrontToBackOrder: string[], actionLabel?: string) => void;
  resetCutoutLayerStack: () => void;
  toggleIsolatedLayer: (layerId: string | null) => void;
  rescanObjectLayers: () => void;
  isBatchExportingMasks: boolean;
  exportBatchMasksAndResult: (
    baseFilename?: string,
    scale?: number,
    includeFinalImage?: boolean
  ) => Promise<number>;
  isExportingPsd: boolean;
  exportLayerCompositionPsd: (
    baseFilename?: string,
    scale?: number
  ) => Promise<{ layerCount: number; filename: string } | null>;
}

const FaceStudioContext = createContext<FaceStudioContextType | undefined>(undefined);

export const FaceStudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Theme and Full-Screen Studio View Mode
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [viewMode, setViewModeState] = useState<'android' | 'expanded'>('expanded');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [activeTab, setActiveTab] = useState<'studio' | 'body' | 'camera' | 'vault' | 'batch' | 'history'>('studio');

  const setViewMode = useCallback((mode: 'android' | 'expanded') => {
    setViewModeState(mode);
    if (mode === 'android') {
      setIsInspectorOpen(false);
    } else if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setIsInspectorOpen(true);
    }
  }, []);

  const toggleInspector = useCallback(() => setIsInspectorOpen((prev) => !prev), []);

  // Sync theme with document element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  // 2. Profiles / Multi-Person Multi-Angle Face Vault
  const normalizeSavedProfile = useCallback((p: FaceProfile): FaceProfile => {
    if (p.angles && p.angles.length > 0) return p;
    const primaryAngle: FaceAngleVariant = {
      id: `${p.id}-primary`,
      label: 'Front',
      bucket: 'front',
      avatarUrl: p.avatarUrl,
      fullImageUrl: p.fullImageUrl,
      yaw: 0,
      pitch: 0,
      roll: 0,
      detectedLandmarks: p.detectedLandmarks,
      visualSignature: [],
      aspectRatio: 0.85,
      dateAdded: p.dateAdded,
      sourceTag: p.tags?.[0] || 'Saved',
    };
    return { ...p, angles: [primaryAngle] };
  }, []);

  const [profiles, setProfiles] = useState<FaceProfile[]>(() => {
    try {
      const saved = localStorage.getItem('facemorph_profiles_v1');
      if (saved) {
        const parsed = JSON.parse(saved) as FaceProfile[];
        return Array.isArray(parsed)
          ? parsed.filter((p) => !p.isBuiltIn).map((p) => normalizeSavedProfile(p))
          : INITIAL_FACE_PROFILES;
      }
    } catch {
      // fallback
    }
    return INITIAL_FACE_PROFILES;
  });

  const [activeProfileId, setActiveProfileId] = useState<string>(profiles[0]?.id || '');
  const [angleScanResults, setAngleScanResults] = useState<Record<string, FaceAngleMatchResult>>({});

  // Cached profile & angle HTMLImageElements for fast real-time canvas rendering
  const profileImagesCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const [profileImagesVersion, setProfileImagesVersion] = useState(0);

  const getProfileImage = useCallback(
    (profileId: string) => profileImagesCacheRef.current[profileId] || null,
    []
  );

  useEffect(() => {
    try {
      localStorage.setItem('facemorph_profiles_v1', JSON.stringify(profiles));
    } catch {
      // ignore storage quota errors gracefully
    }
    // Pre-cache profile images and all angle variant images
    profiles.forEach((p) => {
      if (!profileImagesCacheRef.current[p.id]) {
        loadImage(p.fullImageUrl)
          .then((img) => {
            profileImagesCacheRef.current[p.id] = img;
            setProfileImagesVersion((v) => v + 1);
          })
          .catch(() => {});
      }
      (p.angles || []).forEach((ang) => {
        if (!profileImagesCacheRef.current[ang.id]) {
          loadImage(ang.fullImageUrl)
            .then((img) => {
              profileImagesCacheRef.current[ang.id] = img;
              setProfileImagesVersion((v) => v + 1);
            })
            .catch(() => {});
        }
      });
    });
  }, [profiles]);

  // 3. Target Image & Detected Faces (Starts clean — user chooses Gallery or Camera)
  const [targetImageUrl, setTargetImageUrl] = useState<string>('');
  const [targetImageElement, setTargetImageElement] = useState<HTMLImageElement | null>(null);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);

  // 4. Adjustments & Output Canvas (Automatically restored from local browser storage)
  const [adjustments, setAdjustments] = useState<FaceAdjustments>(() => loadSavedAdjustments());
  const latestAdjustmentsRef = useRef<FaceAdjustments>(adjustments);
  latestAdjustmentsRef.current = adjustments;
  const [ambientLightReport, setAmbientLightReport] = useState<AmbientLightReport | null>(null);
  const [lightingCalibrationReport, setLightingCalibrationReport] =
    useState<LightingCalibrationSuggestion | null>(null);
  const [autoOptimizeReport, setAutoOptimizeReport] = useState<AutoOptimizeReport | null>(null);
  const liveCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const manualMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasManualMaskStrokes, setHasManualMaskStrokes] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSkinSamplingMode, setIsSkinSamplingMode] = useState(false);
  const [detectedCutoutLayers, setDetectedCutoutLayers] = useState<SegmentedCutoutLayerSummary[]>([]);
  const [segmentationVisualization, setSegmentationVisualization] =
    useState<SegmentationVisualizationData | null>(null);
  const [layerDecisionSummary, setLayerDecisionSummary] = useState<string>('2 Base Layers');
  const [totalLayerCount, setTotalLayerCount] = useState<number>(2);
  const [smartCleanupStats, setSmartCleanupStats] = useState<SmartCleanupStats | null>(null);
  const [skinTextureReport, setSkinTextureReport] = useState<SkinTextureAnalysisReport | null>(null);
  const [isBatchExportingMasks, setIsBatchExportingMasks] = useState<boolean>(false);
  const [isExportingPsd, setIsExportingPsd] = useState<boolean>(false);
  const prevTargetUrlForSkinRef = useRef<string>(targetImageUrl);

  // Auto-save adjustments to localStorage (debounced during rapid slider drags + flushed on unload)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveAdjustmentsToStorage(adjustments);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [adjustments]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveAdjustmentsToStorage(latestAdjustmentsRef.current);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 5. Comparison & Live Preview
  const [compareMode, setCompareMode] = useState<'off' | 'split' | 'side-by-side' | 'peek'>('off');
  const [splitPos, setSplitPos] = useState<number>(50);
  const [isPeekingOriginal, setIsPeekingOriginal] = useState<boolean>(false);

  // 6. History Stack
  const [history, setHistory] = useState<HistoryItem[]>(() => [
    {
      id: 'init',
      timestamp: Date.now(),
      action: 'Initial Session State',
      adjustments: { ...adjustments },
      assignedFaces: {},
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // 7. Batch Queue
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const [exitConfirmState, setExitConfirmState] = useState<{
    title: string;
    message: string;
    targetLabel: string;
    kind: 'tool' | 'tab' | 'app';
  } | null>(null);

  // Load and scan target image
  const scanTargetImage = useCallback(async (img: HTMLImageElement) => {
    setIsProcessing(true);
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = img.naturalWidth || img.width;
      offscreen.height = img.naturalHeight || img.height;
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const faces = await detectFacesOnCanvas(offscreen);
        const defaultProf = profiles.find((p) => p.id === activeProfileId) || profiles[0];
        const minThreshold = latestAdjustmentsRef.current.minAngleMatchScore ?? 96;
        const autoMatch = latestAdjustmentsRef.current.autoMatchAngle ?? true;
        const nextScanResults: Record<string, FaceAngleMatchResult> = {};

        const mapped: DetectedFace[] = faces.map((f, i) => {
          const baseFace: DetectedFace = {
            ...f,
            originalLandmarks: JSON.parse(JSON.stringify(f.landmarks)),
            isLandmarksEdited: false,
          };
          if (i === 0 && defaultProf) {
            if (autoMatch) {
              // Scan active person profile (and fallback check all profiles if active has no 96-100% match)
              let best = scanProfileForBestAngleMatch(baseFace, defaultProf, minThreshold);
              if (!best.isMatch96To100 && profiles.length > 1) {
                for (const other of profiles) {
                  if (other.id === defaultProf.id) continue;
                  const ev = scanProfileForBestAngleMatch(baseFace, other, minThreshold);
                  if (ev.matchScore > best.matchScore) {
                    best = ev;
                  }
                }
              }
              nextScanResults[baseFace.id] = best;
              return {
                ...baseFace,
                assignedProfileId: best.profileId,
                assignedAngleId: best.angleId || undefined,
                angleMatchScore: best.matchScore,
                angleMatchFlipped: best.shouldFlip,
                angleMatchStatus: best.isMatch96To100 ? 'matched' : 'unmatched',
                flipHorizontal: best.shouldFlip,
              };
            }
            return {
              ...baseFace,
              assignedProfileId: defaultProf.id,
            };
          }
          return baseFace;
        });

        setAngleScanResults(nextScanResults);
        setDetectedFaces(mapped);
        if (mapped.length > 0) {
          setSelectedFaceId(mapped[0].id);
          const first = mapped[0];
          const firstScan = nextScanResults[first.id];
          if (firstScan?.isMatch96To100) {
            const matchedProf = profiles.find((p) => p.id === firstScan.profileId);
            const matchedAngle =
              matchedProf?.angles?.find((a) => a.id === firstScan.angleId) || undefined;
            const srcImg =
              (matchedAngle && profileImagesCacheRef.current[matchedAngle.id]) ||
              (matchedProf && profileImagesCacheRef.current[matchedProf.id]);
            const aligned = computeAutoAlignTransform(
              first,
              matchedAngle?.detectedLandmarks || matchedProf?.detectedLandmarks || null,
              srcImg
                ? {
                    width: srcImg.naturalWidth || srcImg.width,
                    height: srcImg.naturalHeight || srcImg.height,
                  }
                : undefined,
              firstScan.shouldFlip
            );
            setAdjustments((prev) => ({
              ...prev,
              ...aligned,
              flipHorizontal: firstScan.shouldFlip,
            }));
          }
        }
      }
    } catch (err) {
      console.error('Face detection error:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [activeProfileId, profiles]);

  useEffect(() => {
    if (prevTargetUrlForSkinRef.current !== targetImageUrl) {
      prevTargetUrlForSkinRef.current = targetImageUrl;
      setIsSkinSamplingMode(false);
      if (
        latestAdjustmentsRef.current.skinReference ||
        latestAdjustmentsRef.current.hiddenCutoutLayerIds.length > 0 ||
        Object.keys(latestAdjustmentsRef.current.cutoutLayerOpacities || {}).length > 0 ||
        Object.keys(latestAdjustmentsRef.current.cutoutLayerBlendModes || {}).length > 0 ||
        (latestAdjustmentsRef.current.cutoutLayerOrder || []).length > 0 ||
        latestAdjustmentsRef.current.targetLightingFilter
      ) {
        setAdjustments((prev) => ({
          ...prev,
          skinReference: null,
          hiddenCutoutLayerIds: [],
          cutoutLayerOpacities: {},
          cutoutLayerBlendModes: {},
          cutoutLayerOrder: [],
          targetLightingFilter: null,
        }));
      }
    }
    if (!targetImageUrl) {
      setTargetImageElement(null);
      setDetectedFaces([]);
      setSelectedFaceId(null);
      setDetectedCutoutLayers([]);
      setSegmentationVisualization(null);
      setSkinTextureReport(null);
      setLayerDecisionSummary('2 Base Layers');
      setTotalLayerCount(2);
      const canvas = outputCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    let cancelled = false;
    loadImage(targetImageUrl)
      .then((img) => {
        if (!cancelled) {
          setTargetImageElement(img);
          scanTargetImage(img);
        }
      })
      .catch((err) => {
        console.error('Failed loading target image:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [targetImageUrl, scanTargetImage]);

  // Re-run Face Swap Rendering whenever adjustments, target, or faces change
  const renderTimeoutRef = useRef<number | null>(null);

  const triggerRender = useCallback(async () => {
    if (!targetImageElement || !outputCanvasRef.current) return;

    // Ensure all assigned profile images are loaded
    const profilesMap: Record<string, FaceProfile> = {};
    profiles.forEach((p) => {
      profilesMap[p.id] = p;
    });

    for (const face of detectedFaces) {
      if (face.assignedProfileId) {
        const prof = profilesMap[face.assignedProfileId];
        if (prof) {
          if (!profileImagesCacheRef.current[face.assignedProfileId]) {
            try {
              const img = await loadImage(prof.fullImageUrl);
              profileImagesCacheRef.current[face.assignedProfileId] = img;
              setProfileImagesVersion((v) => v + 1);
            } catch {
              // ignore
            }
          }
          if (face.assignedAngleId && !profileImagesCacheRef.current[face.assignedAngleId]) {
            const matchedAngle = prof.angles?.find((a) => a.id === face.assignedAngleId);
            if (matchedAngle) {
              try {
                const aImg = await loadImage(matchedAngle.fullImageUrl);
                profileImagesCacheRef.current[matchedAngle.id] = aImg;
                setProfileImagesVersion((v) => v + 1);
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }

    await renderFaceSwap(
      targetImageElement,
      detectedFaces,
      profilesMap,
      profileImagesCacheRef.current,
      adjustments,
      outputCanvasRef.current,
      manualMaskCanvasRef.current,
      {
        onTextureReport: setSkinTextureReport,
      }
    );

    const inspection = inspectDiscreteTargetLayers(targetImageElement, detectedFaces, adjustments);
    setDetectedCutoutLayers(inspection.objectLayers);
    setSegmentationVisualization(inspection.visualization);
    setSmartCleanupStats(inspection.cleanupStats);
    setLayerDecisionSummary(inspection.decisionSummary);
    setTotalLayerCount(inspection.totalLayerCount);
  }, [targetImageElement, detectedFaces, profiles, adjustments]);

  const clearManualMask = useCallback(() => {
    if (manualMaskCanvasRef.current) {
      const mctx = manualMaskCanvasRef.current.getContext('2d');
      if (mctx) {
        mctx.clearRect(0, 0, manualMaskCanvasRef.current.width, manualMaskCanvasRef.current.height);
      }
    }
    setHasManualMaskStrokes(false);
    triggerRender();
  }, [triggerRender]);

  useEffect(() => {
    if (renderTimeoutRef.current) {
      window.clearTimeout(renderTimeoutRef.current);
    }
    renderTimeoutRef.current = window.setTimeout(() => {
      triggerRender();
    }, 16);
    return () => {
      if (renderTimeoutRef.current) {
        window.clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [triggerRender]);

  // Adjustments updater with History Recording
  const updateAdjustments = useCallback(
    (partial: Partial<FaceAdjustments>, actionLabel?: string) => {
      setAdjustments((prev) => {
        const next = { ...prev, ...partial };
        if (actionLabel) {
          const assignedMap: Record<string, string> = {};
          detectedFaces.forEach((f) => {
            if (f.assignedProfileId) assignedMap[f.id] = f.assignedProfileId;
          });

          const newItem: HistoryItem = {
            id: `hist-${Date.now()}`,
            timestamp: Date.now(),
            action: actionLabel,
            adjustments: { ...next },
            assignedFaces: assignedMap,
          };

          setHistory((hPrev) => {
            const sliced = hPrev.slice(0, historyIndex + 1);
            return [...sliced, newItem];
          });
          setHistoryIndex((prevIdx) => prevIdx + 1);
        }
        return next;
      });
    },
    [detectedFaces, historyIndex]
  );

  const resetAdjustments = () => {
    updateAdjustments(DEFAULT_ADJUSTMENTS, 'Reset All Adjustments');
  };

  const revertToOriginal = () => {
    setDetectedFaces((prev) =>
      prev.map((f) => ({
        ...f,
        assignedProfileId: undefined,
      }))
    );
    setAdjustments({ ...DEFAULT_ADJUSTMENTS });
    const newItem: HistoryItem = {
      id: `hist-${Date.now()}`,
      timestamp: Date.now(),
      action: 'Reverted to Original Target Photo',
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      assignedFaces: {},
    };
    setHistory((prev) => [...prev, newItem]);
    setHistoryIndex((prev) => prev + 1);
  };

  // History Navigation
  const jumpToHistory = (index: number) => {
    if (index < 0 || index >= history.length) return;
    const item = history[index];
    setAdjustments(item.adjustments);
    setDetectedFaces((prev) =>
      prev.map((f) => ({
        ...f,
        assignedProfileId: item.assignedFaces[f.id] || undefined,
      }))
    );
    setHistoryIndex(index);
  };

  const undo = () => {
    if (historyIndex > 0) {
      jumpToHistory(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      jumpToHistory(historyIndex + 1);
    }
  };

  // Scan stored angles for 96-100% pose match and align to target face
  const scanAndMatchFaceAngle = useCallback(
    async (
      faceId?: string,
      profileIdOverride?: string | '__all__'
    ): Promise<FaceAngleMatchResult | null> => {
      const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
      const targetFace = detectedFaces.find((f) => f.id === targetId);
      if (!targetFace || profiles.length === 0) return null;

      const minThreshold = latestAdjustmentsRef.current.minAngleMatchScore ?? 96;
      const candidates =
        profileIdOverride === '__all__'
          ? profiles
          : profiles.filter(
              (p) => p.id === (profileIdOverride || targetFace.assignedProfileId || activeProfileId)
            );
      const pool = candidates.length > 0 ? candidates : profiles;

      let best: FaceAngleMatchResult = scanProfileForBestAngleMatch(targetFace, pool[0], minThreshold);
      for (let i = 1; i < pool.length; i++) {
        const res = scanProfileForBestAngleMatch(targetFace, pool[i], minThreshold);
        if (
          (res.isMatch96To100 && !best.isMatch96To100) ||
          (res.isMatch96To100 === best.isMatch96To100 && res.matchScore > best.matchScore)
        ) {
          best = res;
        }
      }

      setAngleScanResults((prev) => ({ ...prev, [targetFace.id]: best }));
      setDetectedFaces((prev) =>
        prev.map((f) =>
          f.id === targetFace.id
            ? {
                ...f,
                assignedProfileId: best.profileId,
                assignedAngleId: best.angleId || undefined,
                angleMatchScore: best.matchScore,
                angleMatchFlipped: best.shouldFlip,
                angleMatchStatus: best.isMatch96To100 ? 'matched' : 'unmatched',
                flipHorizontal: best.shouldFlip,
                enabled: true,
              }
            : f
        )
      );

      if (best.profileId) {
        setActiveProfileId(best.profileId);
      }

      const matchedProf = profiles.find((p) => p.id === best.profileId);
      const matchedAngle =
        matchedProf?.angles?.find((a) => a.id === best.angleId) || matchedProf?.angles?.[0];

      if (matchedProf && best.isMatch96To100) {
        const imageKey = matchedAngle?.id || matchedProf.id;
        let srcImg = profileImagesCacheRef.current[imageKey] || profileImagesCacheRef.current[matchedProf.id];
        if (!srcImg) {
          try {
            srcImg = await loadImage(matchedAngle?.fullImageUrl || matchedProf.fullImageUrl);
            profileImagesCacheRef.current[imageKey] = srcImg;
            setProfileImagesVersion((v) => v + 1);
          } catch {
            // ignore
          }
        }
        const aligned = computeAutoAlignTransform(
          targetFace,
          matchedAngle?.detectedLandmarks || matchedProf.detectedLandmarks || null,
          srcImg
            ? {
                width: srcImg.naturalWidth || srcImg.width,
                height: srcImg.naturalHeight || srcImg.height,
              }
            : undefined,
          best.shouldFlip
        );
        updateAdjustments(
          { ...aligned, flipHorizontal: best.shouldFlip },
          `Angle Matched (${best.matchScore}% · ${best.angleLabel}${best.shouldFlip ? ' · Flipped' : ''})`
        );
      }

      return best;
    },
    [selectedFaceId, detectedFaces, profiles, activeProfileId, updateAdjustments]
  );

  const overrideClosestAngleMatch = useCallback(
    (faceId: string) => {
      const targetFace = detectedFaces.find((f) => f.id === faceId);
      if (!targetFace) return;
      const prof = profiles.find((p) => p.id === (targetFace.assignedProfileId || activeProfileId));
      const matchedAngle =
        prof?.angles?.find((a) => a.id === targetFace.assignedAngleId) || prof?.angles?.[0];
      const useFlip = Boolean(targetFace.angleMatchFlipped ?? latestAdjustmentsRef.current.flipHorizontal);
      const imageKey = matchedAngle?.id || prof?.id || '';
      const srcImg = profileImagesCacheRef.current[imageKey] || (prof ? profileImagesCacheRef.current[prof.id] : undefined);

      setDetectedFaces((prev) =>
        prev.map((f) =>
          f.id === faceId
            ? { ...f, angleMatchStatus: 'manual', flipHorizontal: useFlip, enabled: true }
            : f
        )
      );

      if (prof) {
        const aligned = computeAutoAlignTransform(
          targetFace,
          matchedAngle?.detectedLandmarks || prof.detectedLandmarks || null,
          srcImg
            ? {
                width: srcImg.naturalWidth || srcImg.width,
                height: srcImg.naturalHeight || srcImg.height,
              }
            : undefined,
          useFlip
        );
        updateAdjustments(
          { ...aligned, flipHorizontal: useFlip },
          `Manual Closest Angle (${targetFace.angleMatchScore ?? '--'}%)`
        );
      }
    },
    [detectedFaces, profiles, activeProfileId, updateAdjustments]
  );

  const flipFaceAndAdjust = useCallback(
    async (faceId?: string) => {
      const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
      const targetFace = detectedFaces.find((f) => f.id === targetId);
      const nextFlip = !latestAdjustmentsRef.current.flipHorizontal;

      if (!targetFace) {
        updateAdjustments(
          { flipHorizontal: nextFlip },
          nextFlip ? 'Flip Face Horizontal' : 'Unflip Face Horizontal'
        );
        return;
      }

      setDetectedFaces((prev) =>
        prev.map((f) => (f.id === targetFace.id ? { ...f, flipHorizontal: nextFlip } : f))
      );

      const profileId = targetFace.assignedProfileId || activeProfileId;
      const prof = profiles.find((p) => p.id === profileId);
      if (!prof) {
        updateAdjustments(
          { flipHorizontal: nextFlip },
          nextFlip ? 'Flip Face Horizontal' : 'Unflip Face Horizontal'
        );
        return;
      }

      const matchedAngle =
        prof.angles?.find((a) => a.id === targetFace.assignedAngleId) || prof.angles?.[0];
      const imageKey = matchedAngle?.id || prof.id;
      let srcImg = profileImagesCacheRef.current[imageKey] || profileImagesCacheRef.current[prof.id];
      if (!srcImg) {
        try {
          srcImg = await loadImage(matchedAngle?.fullImageUrl || prof.fullImageUrl);
          profileImagesCacheRef.current[imageKey] = srcImg;
        } catch {
          // ignore
        }
      }

      const aligned = computeAutoAlignTransform(
        targetFace,
        matchedAngle?.detectedLandmarks || prof.detectedLandmarks || null,
        srcImg
          ? {
              width: srcImg.naturalWidth || srcImg.width,
              height: srcImg.naturalHeight || srcImg.height,
            }
          : undefined,
        nextFlip
      );

      updateAdjustments(
        { ...aligned, flipHorizontal: nextFlip },
        nextFlip ? 'Flip Face & Adjust to Target' : 'Unflip Face & Adjust to Target'
      );
    },
    [selectedFaceId, detectedFaces, activeProfileId, profiles, updateAdjustments]
  );

  // Face assignment
  const assignProfileToFace = (faceId: string, profileId: string) => {
    if (!profileId) {
      setDetectedFaces((prev) =>
        prev.map((f) =>
          f.id === faceId
            ? {
                ...f,
                assignedProfileId: undefined,
                assignedAngleId: undefined,
                angleMatchScore: undefined,
                angleMatchStatus: undefined,
              }
            : f
        )
      );
      updateAdjustments({}, 'Cleared Swapped Face');
      return;
    }

    const prof = profiles.find((p) => p.id === profileId);
    const targetFace = detectedFaces.find((f) => f.id === faceId);
    const autoMatch = latestAdjustmentsRef.current.autoMatchAngle ?? true;
    const minThreshold = latestAdjustmentsRef.current.minAngleMatchScore ?? 96;

    if (prof && targetFace && autoMatch) {
      const scan = scanProfileForBestAngleMatch(targetFace, prof, minThreshold);
      setAngleScanResults((prev) => ({ ...prev, [faceId]: scan }));
      setDetectedFaces((prev) =>
        prev.map((f) =>
          f.id === faceId
            ? {
                ...f,
                assignedProfileId: profileId,
                assignedAngleId: scan.angleId || undefined,
                angleMatchScore: scan.matchScore,
                angleMatchFlipped: scan.shouldFlip,
                angleMatchStatus: scan.isMatch96To100 ? 'matched' : 'unmatched',
                flipHorizontal: scan.shouldFlip,
                enabled: true,
              }
            : f
        )
      );

      if (scan.isMatch96To100) {
        const matchedAngle = prof.angles?.find((a) => a.id === scan.angleId) || prof.angles?.[0];
        const srcImg =
          (matchedAngle && profileImagesCacheRef.current[matchedAngle.id]) ||
          profileImagesCacheRef.current[prof.id];
        const aligned = computeAutoAlignTransform(
          targetFace,
          matchedAngle?.detectedLandmarks || prof.detectedLandmarks || null,
          srcImg
            ? {
                width: srcImg.naturalWidth || srcImg.width,
                height: srcImg.naturalHeight || srcImg.height,
              }
            : undefined,
          scan.shouldFlip
        );
        updateAdjustments(
          { ...aligned, flipHorizontal: scan.shouldFlip },
          `Assigned ${prof.name} (${scan.matchScore}% ${scan.angleLabel})`
        );
      } else {
        updateAdjustments({}, `Scanned ${prof.name}: ${scan.matchScore}% (Need ${scan.requiredAngleLabel})`);
      }
      return;
    }

    setDetectedFaces((prev) =>
      prev.map((f) =>
        f.id === faceId
          ? {
              ...f,
              assignedProfileId: profileId,
              assignedAngleId: prof?.angles?.[0]?.id,
              angleMatchStatus: 'manual',
              enabled: true,
            }
          : f
      )
    );
    updateAdjustments({}, `Assigned ${prof?.name || 'Face'} to Person`);
  };

  const assignProfileToAllFaces = (profileId: string) => {
    const prof = profiles.find((p) => p.id === profileId);
    const autoMatch = latestAdjustmentsRef.current.autoMatchAngle ?? true;
    const minThreshold = latestAdjustmentsRef.current.minAngleMatchScore ?? 96;
    const nextScanMap: Record<string, FaceAngleMatchResult> = {};

    setDetectedFaces((prev) =>
      prev.map((f) => {
        if (prof && autoMatch) {
          const scan = scanProfileForBestAngleMatch(f, prof, minThreshold);
          nextScanMap[f.id] = scan;
          return {
            ...f,
            assignedProfileId: profileId,
            assignedAngleId: scan.angleId || undefined,
            angleMatchScore: scan.matchScore,
            angleMatchFlipped: scan.shouldFlip,
            angleMatchStatus: scan.isMatch96To100 ? 'matched' : 'unmatched',
            flipHorizontal: scan.shouldFlip,
            enabled: true,
          };
        }
        return {
          ...f,
          assignedProfileId: profileId,
          assignedAngleId: prof?.angles?.[0]?.id,
          angleMatchStatus: 'manual',
          enabled: true,
        };
      })
    );

    if (Object.keys(nextScanMap).length > 0) {
      setAngleScanResults((prev) => ({ ...prev, ...nextScanMap }));
    }
    updateAdjustments({}, `Applied ${prof?.name || 'Face'} to All Detected Faces`);
  };

  const toggleFaceEnabled = (faceId: string) => {
    setDetectedFaces((prev) =>
      prev.map((f) => (f.id === faceId ? { ...f, enabled: !f.enabled } : f))
    );
  };

  const setFaceIndividualStrength = (faceId: string, strength: number) => {
    setDetectedFaces((prev) =>
      prev.map((f) => (f.id === faceId ? { ...f, individualStrength: strength } : f))
    );
  };

  const addFaceProfile = (profile: FaceProfile) => {
    const normalized = normalizeSavedProfile(profile);
    setProfiles((prev) => [normalized, ...prev]);
    setActiveProfileId(normalized.id);
  };

  const createPersonProfile = useCallback(
    async (
      dataUrl: string,
      personName: string,
      sourceTag: string = 'Custom'
    ): Promise<FaceProfile | null> => {
      try {
        const { angle, img } = await analyzeFaceForAngleVariant(dataUrl, sourceTag);
        const newProfile: FaceProfile = {
          id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: personName?.trim() || `Person ${profiles.length + 1}`,
          avatarUrl: angle.avatarUrl,
          fullImageUrl: angle.fullImageUrl,
          dateAdded: angle.dateAdded,
          isBuiltIn: false,
          tags: [sourceTag],
          detectedLandmarks: angle.detectedLandmarks,
          angles: [angle],
        };

        profileImagesCacheRef.current[newProfile.id] = img;
        profileImagesCacheRef.current[angle.id] = img;
        setProfileImagesVersion((v) => v + 1);
        setProfiles((prev) => [newProfile, ...prev]);
        setActiveProfileId(newProfile.id);

        const targetFaceId = selectedFaceId || detectedFaces[0]?.id;
        const targetFace = detectedFaces.find((f) => f.id === targetFaceId);
        if (targetFace) {
          const minThreshold = latestAdjustmentsRef.current.minAngleMatchScore ?? 96;
          const autoMatch = latestAdjustmentsRef.current.autoMatchAngle ?? true;
          if (autoMatch) {
            const scan = scanProfileForBestAngleMatch(targetFace, newProfile, minThreshold);
            setAngleScanResults((prev) => ({ ...prev, [targetFace.id]: scan }));
            setDetectedFaces((prev) =>
              prev.map((f) =>
                f.id === targetFace.id
                  ? {
                      ...f,
                      assignedProfileId: newProfile.id,
                      assignedAngleId: scan.angleId || angle.id,
                      angleMatchScore: scan.matchScore,
                      angleMatchFlipped: scan.shouldFlip,
                      angleMatchStatus: scan.isMatch96To100 ? 'matched' : 'unmatched',
                      flipHorizontal: scan.shouldFlip,
                      enabled: true,
                    }
                  : f
              )
            );
            if (scan.isMatch96To100) {
              const aligned = computeAutoAlignTransform(
                targetFace,
                angle.detectedLandmarks || null,
                {
                  width: img.naturalWidth || img.width,
                  height: img.naturalHeight || img.height,
                },
                scan.shouldFlip
              );
              setAdjustments((prev) => ({
                ...prev,
                ...aligned,
                flipHorizontal: scan.shouldFlip,
              }));
            }
          } else {
            setDetectedFaces((prev) =>
              prev.map((f) =>
                f.id === targetFace.id
                  ? {
                      ...f,
                      assignedProfileId: newProfile.id,
                      assignedAngleId: angle.id,
                      angleMatchStatus: 'manual',
                      enabled: true,
                    }
                  : f
              )
            );
          }
        }

        return newProfile;
      } catch (err) {
        console.error('Failed creating person face profile:', err);
        return null;
      }
    },
    [profiles.length, selectedFaceId, detectedFaces]
  );

  const addFaceFromDataUrl = useCallback(
    async (
      dataUrl: string,
      customName?: string,
      sourceTag: string = 'Custom'
    ): Promise<FaceProfile | null> => {
      return createPersonProfile(dataUrl, customName || `Person ${profiles.length + 1}`, sourceTag);
    },
    [createPersonProfile, profiles.length]
  );

  const addAngleToProfile = useCallback(
    async (
      profileId: string,
      dataUrl: string,
      sourceTag: string = 'Custom'
    ): Promise<{
      added: boolean;
      angle?: FaceAngleVariant;
      duplicateCheck: DuplicateAngleCheckResult;
    }> => {
      const targetProf = profiles.find((p) => p.id === profileId);
      if (!targetProf) {
        return {
          added: false,
          duplicateCheck: {
            isDuplicate: true,
            similarityPct: 0,
            reason: 'Selected person profile not found.',
          },
        };
      }

      const { angle, img } = await analyzeFaceForAngleVariant(dataUrl, sourceTag);
      const existingAngles = targetProf.angles || [];
      const duplicateCheck = checkDuplicateAngle(angle, existingAngles);

      if (duplicateCheck.isDuplicate) {
        return { added: false, duplicateCheck };
      }

      const updatedAngles = [...existingAngles, angle];
      const updatedProfile: FaceProfile = {
        ...targetProf,
        angles: updatedAngles,
      };

      profileImagesCacheRef.current[angle.id] = img;
      setProfileImagesVersion((v) => v + 1);
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? updatedProfile : p)));

      // Automatically re-scan active/matching target faces for this person
      const minThreshold = latestAdjustmentsRef.current.minAngleMatchScore ?? 96;
      const autoMatch = latestAdjustmentsRef.current.autoMatchAngle ?? true;
      if (autoMatch) {
        const activeId = selectedFaceId || detectedFaces[0]?.id;
        const activeFace = detectedFaces.find(
          (f) => f.id === activeId && f.assignedProfileId === profileId
        );
        if (activeFace) {
          const scan = scanProfileForBestAngleMatch(activeFace, updatedProfile, minThreshold);
          setAngleScanResults((prev) => ({ ...prev, [activeFace.id]: scan }));
          setDetectedFaces((prev) =>
            prev.map((f) =>
              f.id === activeFace.id
                ? {
                    ...f,
                    assignedProfileId: profileId,
                    assignedAngleId: scan.angleId || angle.id,
                    angleMatchScore: scan.matchScore,
                    angleMatchFlipped: scan.shouldFlip,
                    angleMatchStatus: scan.isMatch96To100 ? 'matched' : 'unmatched',
                    flipHorizontal: scan.shouldFlip,
                    enabled: true,
                  }
                : f
            )
          );
          if (scan.isMatch96To100) {
            const matchedAngle =
              updatedAngles.find((a) => a.id === scan.angleId) || angle;
            const aligned = computeAutoAlignTransform(
              activeFace,
              matchedAngle.detectedLandmarks || null,
              {
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
              },
              scan.shouldFlip
            );
            updateAdjustments(
              { ...aligned, flipHorizontal: scan.shouldFlip },
              `Added ${angle.label} (${scan.matchScore}% Match)`
            );
          }
        }
      }

      return { added: true, angle, duplicateCheck };
    },
    [profiles, selectedFaceId, detectedFaces, updateAdjustments]
  );

  const removeAngleFromProfile = useCallback(
    (profileId: string, angleId: string) => {
      const targetProf = profiles.find((p) => p.id === profileId);
      if (!targetProf) return;
      const nextAngles = (targetProf.angles || []).filter((a) => a.id !== angleId);
      if (nextAngles.length === 0) {
        // Removing the last angle removes the profile cleanly
        const remaining = profiles.filter((p) => p.id !== profileId);
        setProfiles(remaining);
        if (activeProfileId === profileId) {
          setActiveProfileId(remaining[0]?.id || '');
        }
        setDetectedFaces((prev) =>
          prev.map((f) =>
            f.assignedProfileId === profileId
              ? {
                  ...f,
                  assignedProfileId: remaining[0]?.id || undefined,
                  assignedAngleId: undefined,
                }
              : f
          )
        );
        return;
      }

      const fallback = nextAngles[0];
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profileId
            ? {
                ...p,
                avatarUrl: fallback.avatarUrl,
                fullImageUrl: fallback.fullImageUrl,
                detectedLandmarks: fallback.detectedLandmarks,
                angles: nextAngles,
              }
            : p
        )
      );
      setDetectedFaces((prev) =>
        prev.map((f) =>
          f.assignedProfileId === profileId && f.assignedAngleId === angleId
            ? { ...f, assignedAngleId: fallback.id }
            : f
        )
      );
    },
    [profiles, activeProfileId]
  );

  const removeFaceProfile = (id: string) => {
    const remaining = profiles.filter((p) => p.id !== id);
    setProfiles(remaining);
    if (activeProfileId === id) {
      setActiveProfileId(remaining[0]?.id || '');
    }
    setDetectedFaces((prev) =>
      prev.map((f) =>
        f.assignedProfileId === id
          ? { ...f, assignedProfileId: remaining[0]?.id || undefined }
          : f
      )
    );
  };

  const rescanFaces = async () => {
    if (targetImageElement) {
      await scanTargetImage(targetImageElement);
    }
  };

  const updateFaceLandmark = useCallback(
    (faceId: string, landmarkKey: string, pos: Point, isDelta: boolean = false) => {
      setDetectedFaces((prev) =>
        prev.map((f) => {
          if (f.id !== faceId) return f;

          const nextLandmarks: FaceLandmarks = {
            ...f.landmarks,
            contour: [...f.landmarks.contour],
            jawline: [...f.landmarks.jawline],
          };

          if (landmarkKey in nextLandmarks) {
            const key = landmarkKey as keyof Omit<FaceLandmarks, 'jawline' | 'contour'>;
            const current = nextLandmarks[key];
            nextLandmarks[key] = isDelta
              ? { x: current.x + pos.x, y: current.y + pos.y }
              : { x: pos.x, y: pos.y };
          } else if (landmarkKey.startsWith('jawline_')) {
            const idx = parseInt(landmarkKey.split('_')[1], 10);
            if (nextLandmarks.jawline[idx]) {
              const current = nextLandmarks.jawline[idx];
              nextLandmarks.jawline[idx] = isDelta
                ? { x: current.x + pos.x, y: current.y + pos.y }
                : { x: pos.x, y: pos.y };
            }
          }

          // Dynamically adjust bounding box to encompass nudged landmark nodes
          const allPts: Point[] = [
            nextLandmarks.leftEye,
            nextLandmarks.rightEye,
            nextLandmarks.nose,
            nextLandmarks.mouthLeft,
            nextLandmarks.mouthRight,
            nextLandmarks.mouthCenter,
            nextLandmarks.chin,
            nextLandmarks.forehead,
            ...nextLandmarks.jawline,
          ];

          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const pt of allPts) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }

          const padX = (maxX - minX) * 0.12;
          const padY = (maxY - minY) * 0.14;

          const nextBox: Rect = {
            x: Math.round(minX - padX),
            y: Math.round(minY - padY),
            width: Math.round(maxX - minX + padX * 2),
            height: Math.round(maxY - minY + padY * 2),
          };

          return {
            ...f,
            box: nextBox,
            landmarks: nextLandmarks,
            isLandmarksEdited: true,
          };
        })
      );
    },
    []
  );

  const resetFaceLandmarks = useCallback((faceId: string) => {
    setDetectedFaces((prev) =>
      prev.map((f) => {
        if (f.id !== faceId || !f.originalLandmarks) return f;
        const orig: FaceLandmarks = JSON.parse(JSON.stringify(f.originalLandmarks));

        const allPts: Point[] = [
          orig.leftEye,
          orig.rightEye,
          orig.nose,
          orig.mouthLeft,
          orig.mouthRight,
          orig.mouthCenter,
          orig.chin,
          orig.forehead,
          ...orig.jawline,
        ];

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const pt of allPts) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }

        const padX = (maxX - minX) * 0.12;
        const padY = (maxY - minY) * 0.14;

        const nextBox: Rect = {
          x: Math.round(minX - padX),
          y: Math.round(minY - padY),
          width: Math.round(maxX - minX + padX * 2),
          height: Math.round(maxY - minY + padY * 2),
        };

        return {
          ...f,
          box: nextBox,
          landmarks: orig,
          isLandmarksEdited: false,
        };
      })
    );
  }, []);

  const autoAlignFace = useCallback(
    async (faceId?: string) => {
      const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
      const targetFace = detectedFaces.find((f) => f.id === targetId);
      if (!targetFace) return null;

      const profileId = targetFace.assignedProfileId || activeProfileId;
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return null;

      // Ensure target face is selected & mapped if unmapped
      setSelectedFaceId(targetFace.id);
      if (!targetFace.assignedProfileId) {
        setDetectedFaces((prev) =>
          prev.map((f) =>
            f.id === targetFace.id ? { ...f, assignedProfileId: profile.id, enabled: true } : f
          )
        );
      }

      const matchedAngle =
        profile.angles?.find((a) => a.id === targetFace.assignedAngleId) || profile.angles?.[0];
      const imageKey = matchedAngle?.id || profile.id;
      const useFlip = Boolean(
        targetFace.flipHorizontal ?? latestAdjustmentsRef.current.flipHorizontal
      );

      // Ensure source profile/angle image is loaded
      let sourceImg = profileImagesCacheRef.current[imageKey] || profileImagesCacheRef.current[profile.id];
      if (!sourceImg) {
        try {
          sourceImg = await loadImage(matchedAngle?.fullImageUrl || profile.fullImageUrl);
          profileImagesCacheRef.current[imageKey] = sourceImg;
          setProfileImagesVersion((v) => v + 1);
        } catch {
          return null;
        }
      }

      // Detect and cache source face landmarks if not yet available
      let sourceLandmarks = matchedAngle?.detectedLandmarks || profile.detectedLandmarks || null;
      if (!sourceLandmarks) {
        try {
          const off = document.createElement('canvas');
          off.width = sourceImg.naturalWidth || sourceImg.width;
          off.height = sourceImg.naturalHeight || sourceImg.height;
          const octx = off.getContext('2d');
          if (octx) {
            octx.drawImage(sourceImg, 0, 0);
            const srcFaces = await detectFacesOnCanvas(off);
            if (srcFaces[0]?.landmarks) {
              sourceLandmarks = srcFaces[0].landmarks;
              setProfiles((prev) =>
                prev.map((p) =>
                  p.id === profile.id ? { ...p, detectedLandmarks: sourceLandmarks || undefined } : p
                )
              );
            }
          }
        } catch {
          // fall back to default portrait landmark estimation inside computeAutoAlignTransform
        }
      }

      const aligned = computeAutoAlignTransform(
        targetFace,
        sourceLandmarks,
        {
          width: sourceImg.naturalWidth || sourceImg.width,
          height: sourceImg.naturalHeight || sourceImg.height,
        },
        useFlip
      );

      const faceIdx = detectedFaces.findIndex((f) => f.id === targetFace.id);
      const label =
        faceIdx >= 0
          ? `Auto-Align Person #${faceIdx + 1} (${aligned.rotation}° / ${Math.round(aligned.scale * 100)}%)`
          : 'Auto-Align Face Pose';

      updateAdjustments(aligned, label);
      return aligned;
    },
    [selectedFaceId, detectedFaces, activeProfileId, profiles, updateAdjustments]
  );

  const matchAmbientLight = useCallback(
    async (faceId?: string) => {
      if (!targetImageElement) return null;
      const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
      const targetFace = detectedFaces.find((f) => f.id === targetId);
      if (!targetFace) return null;

      const profileId = targetFace.assignedProfileId || activeProfileId;
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return null;

      let sourceImg = profileImagesCacheRef.current[profile.id];
      if (!sourceImg) {
        try {
          sourceImg = await loadImage(profile.fullImageUrl);
          profileImagesCacheRef.current[profile.id] = sourceImg;
          setProfileImagesVersion((v) => v + 1);
        } catch {
          return null;
        }
      }

      const report = computeAmbientLightMatch(
        targetImageElement,
        targetFace,
        sourceImg,
        profile.detectedLandmarks || null,
        adjustments.skinToneMatch ? adjustments.skinToneStrength / 100 : 0
      );

      setAmbientLightReport(report);
      updateAdjustments(
        {
          brightness: report.brightness,
          shadows: report.shadows,
          contrast: report.contrast,
          temperature: report.temperature,
        },
        `Match Ambient Light (${report.sceneKelvin}K · ${report.lightCondition})`
      );

      return report;
    },
    [
      targetImageElement,
      selectedFaceId,
      detectedFaces,
      activeProfileId,
      profiles,
      adjustments.skinToneMatch,
      adjustments.skinToneStrength,
      updateAdjustments,
    ]
  );

  const autoMatchTargetLighting = useCallback(
    async (faceId?: string): Promise<TargetLightingFilter | null> => {
      if (!targetImageElement) return null;
      const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
      const targetFace = detectedFaces.find((f) => f.id === targetId) || detectedFaces[0] || null;

      const profileId = targetFace?.assignedProfileId || activeProfileId;
      const profile = profiles.find((p) => p.id === profileId) || profiles[0];
      if (!profile) return null;

      const matchedAngle =
        (targetFace?.assignedAngleId
          ? profile.angles?.find((a) => a.id === targetFace.assignedAngleId)
          : undefined) || profile.angles?.[0];
      const imageKey = matchedAngle?.id || profile.id;

      let sourceImg =
        profileImagesCacheRef.current[imageKey] || profileImagesCacheRef.current[profile.id];
      if (!sourceImg) {
        try {
          sourceImg = await loadImage(matchedAngle?.fullImageUrl || profile.fullImageUrl);
          profileImagesCacheRef.current[imageKey] = sourceImg;
          setProfileImagesVersion((v) => v + 1);
        } catch {
          return null;
        }
      }

      const filter = computeSourceToTargetLightingFilter(
        targetImageElement,
        targetFace,
        sourceImg,
        matchedAngle?.detectedLandmarks || profile.detectedLandmarks || null
      );

      updateAdjustments(
        { targetLightingFilter: filter },
        `Auto-Match Lighting (${filter.sourceKelvin}K · ${filter.sourceIntensity}% Light)`
      );
      return filter;
    },
    [targetImageElement, selectedFaceId, detectedFaces, activeProfileId, profiles, updateAdjustments]
  );

  const clearTargetLightingFilter = useCallback(() => {
    updateAdjustments({ targetLightingFilter: null }, 'Reset Target Lighting Filter');
  }, [updateAdjustments]);

  const analyzeLightingCalibration = useCallback(
    async (faceId?: string): Promise<LightingCalibrationSuggestion | null> => {
      if (!targetImageElement) return null;
      const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
      const targetFace = detectedFaces.find((f) => f.id === targetId) || detectedFaces[0] || null;

      const profileId = targetFace?.assignedProfileId || activeProfileId;
      const profile = profiles.find((p) => p.id === profileId) || profiles[0];
      if (!profile) return null;

      const matchedAngle =
        (targetFace?.assignedAngleId
          ? profile.angles?.find((a) => a.id === targetFace.assignedAngleId)
          : undefined) || profile.angles?.[0];
      const imageKey = matchedAngle?.id || profile.id;

      let sourceImg =
        profileImagesCacheRef.current[imageKey] || profileImagesCacheRef.current[profile.id];
      if (!sourceImg) {
        try {
          sourceImg = await loadImage(matchedAngle?.fullImageUrl || profile.fullImageUrl);
          profileImagesCacheRef.current[imageKey] = sourceImg;
          setProfileImagesVersion((v) => v + 1);
        } catch {
          return null;
        }
      }

      const suggestion = computeLightingCalibrationSuggestion(
        targetImageElement,
        targetFace,
        sourceImg,
        matchedAngle?.detectedLandmarks || profile.detectedLandmarks || null
      );
      setLightingCalibrationReport(suggestion);
      return suggestion;
    },
    [targetImageElement, selectedFaceId, detectedFaces, activeProfileId, profiles]
  );

  const autoOptimizeWithCamera = useCallback(async (): Promise<AutoOptimizeReport | null> => {
    const sampleW = 128;
    const sampleH = 128;
    const analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = sampleW;
    analysisCanvas.height = sampleH;
    const actx = analysisCanvas.getContext('2d');
    if (!actx) return null;

    let analysisSource: AutoOptimizeReport['source'] = 'Target Photo';
    let capturedFrame = false;

    // 1. Prefer an already-streaming live camera video element if active
    const activeVideo = liveCameraVideoRef.current;
    if (activeVideo && activeVideo.readyState >= 2 && activeVideo.videoWidth > 0) {
      actx.drawImage(activeVideo, 0, 0, sampleW, sampleH);
      analysisSource = 'Live Camera';
      capturedFrame = true;
    }

    // 2. Otherwise sample a quick ambient frame via the device camera sensor
    if (!capturedFrame && navigator.mediaDevices?.getUserMedia) {
      let tempStream: MediaStream | null = null;
      try {
        tempStream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          }),
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error('Camera timeout')), 1800)
          ),
        ]);

        const tempVideo = document.createElement('video');
        tempVideo.playsInline = true;
        tempVideo.muted = true;
        tempVideo.srcObject = tempStream;

        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Frame timeout')), 1200);
          tempVideo.onloadeddata = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          tempVideo.play().catch(() => {
            window.clearTimeout(timeout);
            reject(new Error('Play blocked'));
          });
        });

        if (tempVideo.videoWidth > 0 && tempVideo.videoHeight > 0) {
          actx.drawImage(tempVideo, 0, 0, sampleW, sampleH);
          analysisSource = 'Camera Sensor';
          capturedFrame = true;
        }
      } catch {
        // Camera unavailable or permission declined — fall back cleanly to target scene photo
      } finally {
        if (tempStream) {
          tempStream.getTracks().forEach((t) => t.stop());
        }
      }
    }

    // 3. Fallback to loaded target scene photo (or neutral studio canvas if empty)
    if (!capturedFrame) {
      if (targetImageElement) {
        actx.drawImage(targetImageElement, 0, 0, sampleW, sampleH);
        analysisSource = 'Target Photo';
      } else {
        actx.fillStyle = '#475569';
        actx.fillRect(0, 0, sampleW, sampleH);
        analysisSource = 'Target Photo';
      }
    }

    // Include active swapped profile image for skin/color baseline comparison if loaded
    const selectedFace = detectedFaces.find((f) => f.id === selectedFaceId) || detectedFaces[0];
    const profId = selectedFace?.assignedProfileId || activeProfileId;
    let sourceImg = profId ? profileImagesCacheRef.current[profId] || null : null;
    if (!sourceImg && profId) {
      const prof = profiles.find((p) => p.id === profId);
      if (prof) {
        try {
          sourceImg = await loadImage(prof.fullImageUrl);
          profileImagesCacheRef.current[profId] = sourceImg;
        } catch {
          sourceImg = null;
        }
      }
    }

    const sceneData = actx.getImageData(0, 0, sampleW, sampleH);
    const report = computeMLSceneAutoOptimize(sceneData, sourceImg, analysisSource);
    setAutoOptimizeReport(report);

    updateAdjustments(
      {
        edgeSoftness: report.edgeSoftness,
        shadowMatcher: report.shadowMatcher,
        saturation: report.saturation,
        hue: report.hue,
        vibrance: report.vibrance,
      },
      `ML Auto-Optimize (${report.lightingProfile} · ${report.sceneKelvin}K)`
    );

    return report;
  }, [
    targetImageElement,
    detectedFaces,
    selectedFaceId,
    activeProfileId,
    profiles,
    updateAdjustments,
  ]);

  const lastAutoLightKeyRef = useRef<string>('');
  useEffect(() => {
    if (!adjustments.autoAmbientLight || !targetImageElement || detectedFaces.length === 0) return;
    const face = detectedFaces.find((f) => f.id === selectedFaceId) || detectedFaces[0];
    if (!face) return;
    const profId = face.assignedProfileId || activeProfileId;
    const key = `${targetImageUrl}|${face.id}|${profId}`;
    if (lastAutoLightKeyRef.current === key) return;
    lastAutoLightKeyRef.current = key;
    void matchAmbientLight(face.id);
  }, [
    adjustments.autoAmbientLight,
    targetImageUrl,
    targetImageElement,
    detectedFaces,
    selectedFaceId,
    activeProfileId,
    matchAmbientLight,
  ]);

  // Batch Processing
  const runBatchProcessing = async (profileId: string) => {
    setIsBatchRunning(true);
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    let profileImg = profileImagesCacheRef.current[profileId];
    if (!profileImg) {
      profileImg = await loadImage(profile.fullImageUrl);
      profileImagesCacheRef.current[profileId] = profileImg;
    }

    const profilesMap = { [profileId]: profile };
    const imagesMap = { [profileId]: profileImg };

    for (let i = 0; i < batchQueue.length; i++) {
      const item = batchQueue[i];
      setBatchQueue((prev) =>
        prev.map((it, idx) => (idx === i ? { ...it, status: 'processing', progress: 20 } : it))
      );

      try {
        const itemImg = await loadImage(item.imageUrl);
        const offCanvas = document.createElement('canvas');
        offCanvas.width = itemImg.naturalWidth || itemImg.width;
        offCanvas.height = itemImg.naturalHeight || itemImg.height;
        const octx = offCanvas.getContext('2d');
        if (octx) {
          octx.drawImage(itemImg, 0, 0);
          const faces = await detectFacesOnCanvas(offCanvas);
          const swappedFaces = faces.map((f) => ({
            ...f,
            assignedProfileId: profileId,
            enabled: true,
          }));

          setBatchQueue((prev) =>
            prev.map((it, idx) =>
              idx === i ? { ...it, progress: 60, facesDetected: swappedFaces.length } : it
            )
          );

          const resultCanvas = document.createElement('canvas');
          await renderFaceSwap(
            itemImg,
            swappedFaces,
            profilesMap,
            imagesMap,
            adjustments,
            resultCanvas
          );

          const resultUrl = resultCanvas.toDataURL('image/jpeg', 0.92);

          setBatchQueue((prev) =>
            prev.map((it, idx) =>
              idx === i
                ? {
                    ...it,
                    status: 'completed',
                    progress: 100,
                    resultUrl,
                    facesDetected: swappedFaces.length,
                  }
                : it
            )
          );
        }
      } catch (err) {
        console.error('Batch error on item', item.id, err);
        setBatchQueue((prev) =>
          prev.map((it, idx) => (idx === i ? { ...it, status: 'failed', progress: 0 } : it))
        );
      }
    }
    setIsBatchRunning(false);
  };

  // Wardrobe & Custom Costume / Jewelry / Object Assets
  const [wardrobeAssets, setWardrobeAssets] = useState<WardrobeAsset[]>(() => {
    const saved = loadSavedCustomAssets();
    const initialIds = new Set(INITIAL_WARDROBE_ASSETS.map((a) => a.id));
    const customOnly = saved.filter((s) => !initialIds.has(s.id));
    return [...INITIAL_WARDROBE_ASSETS, ...customOnly];
  });
  const [customClothingTags, setCustomClothingTags] = useState<ClothingTagDef[]>(() =>
    loadSavedCustomClothingTags()
  );
  const allClothingTags = React.useMemo(() => {
    const builtinIds = new Set(BUILTIN_CLOTHING_TAGS.map((t) => t.id));
    return [...BUILTIN_CLOTHING_TAGS, ...customClothingTags.filter((t) => !builtinIds.has(t.id))];
  }, [customClothingTags]);

  const addCustomClothingTag = useCallback(
    (
      label: string,
      defaultAnchor: WardrobeAsset['anchorPoint'] = 'shoulders',
      defaultFabric: NonNullable<WardrobeAsset['fabricType']> = 'cotton'
    ): ClothingTagDef | null => {
      const cleanLabel = label.trim();
      const id = normalizeTagId(cleanLabel);
      if (!id || !cleanLabel) return null;

      const existing = [...BUILTIN_CLOTHING_TAGS, ...customClothingTags].find(
        (t) => t.id === id || t.label.toLowerCase() === cleanLabel.toLowerCase()
      );
      if (existing) return existing;

      const newDef: ClothingTagDef = {
        id,
        label: cleanLabel,
        defaultAnchor,
        defaultFabric,
        defaultScale: 1.0,
      };
      setCustomClothingTags((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        const next = [...prev, newDef];
        saveCustomClothingTagsToStorage(next);
        return next;
      });
      return newDef;
    },
    [customClothingTags]
  );

  const [showCustomAssetModal, setShowCustomAssetModal] = useState<boolean>(false);
  const [customAssetInitialCategory, setCustomAssetInitialCategory] = useState<WardrobeCategory>('clothing');
  const [customAssetInitialSource, setCustomAssetInitialSource] = useState<'camera' | 'upload' | 'samples'>('camera');

  const addWardrobeAsset = useCallback((asset: WardrobeAsset) => {
    setWardrobeAssets((prev) => {
      const filtered = prev.filter((a) => a.id !== asset.id);
      const next = [asset, ...filtered];
      saveCustomAssetsToStorage(next);
      return next;
    });
  }, []);

  const removeWardrobeAsset = useCallback((id: string) => {
    setWardrobeAssets((prev) => {
      const next = prev.filter((a) => a.id !== id);
      saveCustomAssetsToStorage(next);
      return next;
    });
  }, []);

  const openCustomAssetModal = useCallback(
    (
      category: WardrobeCategory = 'clothing',
      initialSource: 'camera' | 'upload' | 'samples' = 'camera'
    ) => {
      setCustomAssetInitialCategory(category);
      setCustomAssetInitialSource(initialSource);
      setShowCustomAssetModal(true);
    },
    []
  );

  // Shared Live Camera Preview Configuration & Real-Time Face Sync
  const [liveCameraConfig, setLiveCameraConfig] = useState<LiveCameraConfig>(() => ({
    swapStrength: adjustments.swapStrength,
    skinToneMatch: adjustments.skinToneMatch,
    featherRadius: adjustments.featherRadius,
    expressionWarp: 60,
    showLandmarkMesh: adjustments.showFaceLandmarks,
    splitPreview: false,
    splitPos: 50,
    scale: Math.max(0.75, Math.min(1.35, adjustments.scale)),
    rotation: adjustments.rotation,
    headPitch: adjustments.headPitch,
    headYaw: adjustments.headYaw,
    offsetX: adjustments.offsetX,
    offsetY: adjustments.offsetY || -5,
    expressionPreset: 'natural',
    removeBackground: true,
    activeBackgroundId: 'studio',
    removeHairAndBlemishes: true,
    hairRemovalIntensity: adjustments.skinTextureSmoothing,
    wearClothes: true,
    wearJewelry: true,
    selectedClothingId: 'asset-blazer-navy',
    selectedJewelryId: 'asset-necklace-diamond',
    brightness: adjustments.brightness,
    contrast: adjustments.contrast,
    temperature: adjustments.temperature,
    saturation: adjustments.saturation,
    hue: adjustments.hue,
    vibrance: adjustments.vibrance,
    skinSmoothing: adjustments.skinSmoothing,
    motionSensitivity: adjustments.motionSensitivity,
    motionBlur: adjustments.motionBlur,
    lightingAdjustment: adjustments.lightingAdjustment,
    shadowMatcher: adjustments.shadowMatcher,
    softBloom: adjustments.softBloom,
    autoRefocus: adjustments.autoRefocus,
    antiAliasing: adjustments.antiAliasing,
    genderMorph: adjustments.genderMorph,
    edgeContrast: adjustments.edgeContrast,
    motionSmoothingEnabled: adjustments.motionSmoothingEnabled,
    motionSmoothing: adjustments.motionSmoothing,
    edgeSoftness: adjustments.edgeSoftness,
    boundaryRefinement: adjustments.boundaryRefinement,
    boundaryRefinementStrength: adjustments.boundaryRefinementStrength,
    boundaryTemporalStabilizer: adjustments.boundaryTemporalStabilizer,
    boundaryStabilizerFrames: adjustments.boundaryStabilizerFrames,
    flipHorizontal: adjustments.flipHorizontal,
    captureMode: 'photo',
  }));
  const [liveSyncedFaceId, setLiveSyncedFaceId] = useState<string | null>(null);
  const [refocusSignal, setRefocusSignal] = useState<number>(0);

  const applyFaceSettingsToLiveConfig = useCallback(
    (face: DetectedFace | undefined, adj: FaceAdjustments) => {
      if (!face) return;
      const effectiveStrength = Math.round(
        (adj.swapStrength * (face.individualStrength ?? 100)) / 100
      );
      if (face.assignedProfileId) {
        setActiveProfileId(face.assignedProfileId);
      }
      setLiveCameraConfig((prev) => ({
        ...prev,
        swapStrength: face.enabled ? effectiveStrength : 0,
        skinToneMatch: adj.skinToneMatch,
        featherRadius: adj.featherRadius,
        scale: Math.max(0.75, Math.min(1.35, adj.scale)),
        rotation: adj.rotation,
        headPitch: adj.headPitch,
        headYaw: adj.headYaw,
        offsetX: adj.offsetX,
        offsetY: adj.offsetY,
        brightness: adj.brightness,
        contrast: adj.contrast,
        temperature: adj.temperature,
        saturation: adj.saturation,
        hue: adj.hue,
        vibrance: adj.vibrance,
        skinSmoothing: adj.skinSmoothing,
        hairRemovalIntensity: adj.skinTextureSmoothing,
        motionSensitivity: adj.motionSensitivity,
        motionBlur: adj.motionBlur,
        lightingAdjustment: adj.lightingAdjustment,
        shadowMatcher: adj.shadowMatcher,
        softBloom: adj.softBloom,
        autoRefocus: adj.autoRefocus,
        antiAliasing: adj.antiAliasing,
        genderMorph: adj.genderMorph,
        edgeContrast: adj.edgeContrast,
        motionSmoothingEnabled: adj.motionSmoothingEnabled,
        motionSmoothing: adj.motionSmoothing,
        edgeSoftness: adj.edgeSoftness,
        boundaryRefinement: adj.boundaryRefinement,
        boundaryRefinementStrength: adj.boundaryRefinementStrength,
        boundaryTemporalStabilizer: adj.boundaryTemporalStabilizer,
        boundaryStabilizerFrames: adj.boundaryStabilizerFrames,
        flipHorizontal: face.flipHorizontal ?? adj.flipHorizontal,
      }));
    },
    []
  );

  // Keep global motionSensitivity, motionBlur, autoRefocus, antiAliasing, genderMorph, edgeContrast, motionSmoothing, edgeSoftness, boundary refinement & temporal stabilizer, shadowMatcher, headPitch, headYaw, flipHorizontal, showFaceLandmarks & color preferences synchronized with live camera configuration
  useEffect(() => {
    setLiveCameraConfig((prev) =>
      prev.motionSensitivity === adjustments.motionSensitivity &&
      prev.motionBlur === adjustments.motionBlur &&
      prev.autoRefocus === adjustments.autoRefocus &&
      prev.antiAliasing === adjustments.antiAliasing &&
      prev.genderMorph === adjustments.genderMorph &&
      prev.edgeContrast === adjustments.edgeContrast &&
      prev.motionSmoothingEnabled === adjustments.motionSmoothingEnabled &&
      prev.motionSmoothing === adjustments.motionSmoothing &&
      prev.edgeSoftness === adjustments.edgeSoftness &&
      prev.boundaryRefinement === adjustments.boundaryRefinement &&
      prev.boundaryRefinementStrength === adjustments.boundaryRefinementStrength &&
      prev.boundaryTemporalStabilizer === adjustments.boundaryTemporalStabilizer &&
      prev.boundaryStabilizerFrames === adjustments.boundaryStabilizerFrames &&
      prev.shadowMatcher === adjustments.shadowMatcher &&
      prev.headPitch === adjustments.headPitch &&
      prev.headYaw === adjustments.headYaw &&
      prev.flipHorizontal === adjustments.flipHorizontal &&
      prev.showLandmarkMesh === adjustments.showFaceLandmarks &&
      prev.hue === adjustments.hue &&
      prev.vibrance === adjustments.vibrance
        ? prev
        : {
            ...prev,
            motionSensitivity: adjustments.motionSensitivity,
            motionBlur: adjustments.motionBlur,
            autoRefocus: adjustments.autoRefocus,
            antiAliasing: adjustments.antiAliasing,
            genderMorph: adjustments.genderMorph,
            edgeContrast: adjustments.edgeContrast,
            motionSmoothingEnabled: adjustments.motionSmoothingEnabled,
            motionSmoothing: adjustments.motionSmoothing,
            edgeSoftness: adjustments.edgeSoftness,
            boundaryRefinement: adjustments.boundaryRefinement,
            boundaryRefinementStrength: adjustments.boundaryRefinementStrength,
            boundaryTemporalStabilizer: adjustments.boundaryTemporalStabilizer,
            boundaryStabilizerFrames: adjustments.boundaryStabilizerFrames,
            shadowMatcher: adjustments.shadowMatcher,
            headPitch: adjustments.headPitch,
            headYaw: adjustments.headYaw,
            flipHorizontal: adjustments.flipHorizontal,
            showLandmarkMesh: adjustments.showFaceLandmarks,
            hue: adjustments.hue,
            vibrance: adjustments.vibrance,
          }
    );
  }, [
    adjustments.motionSensitivity,
    adjustments.motionBlur,
    adjustments.autoRefocus,
    adjustments.antiAliasing,
    adjustments.genderMorph,
    adjustments.edgeContrast,
    adjustments.motionSmoothingEnabled,
    adjustments.motionSmoothing,
    adjustments.edgeSoftness,
    adjustments.boundaryRefinement,
    adjustments.boundaryRefinementStrength,
    adjustments.boundaryTemporalStabilizer,
    adjustments.boundaryStabilizerFrames,
    adjustments.shadowMatcher,
    adjustments.headPitch,
    adjustments.headYaw,
    adjustments.flipHorizontal,
    adjustments.showFaceLandmarks,
    adjustments.hue,
    adjustments.vibrance,
  ]);

  const triggerAutoRefocus = useCallback(() => {
    if (detectedFaces.length > 0) {
      let largest = detectedFaces[0];
      let maxArea = largest.box.width * largest.box.height;
      for (let i = 1; i < detectedFaces.length; i++) {
        const area = detectedFaces[i].box.width * detectedFaces[i].box.height;
        if (area > maxArea) {
          maxArea = area;
          largest = detectedFaces[i];
        }
      }
      setSelectedFaceId(largest.id);
    }
    setRefocusSignal((n) => n + 1);
  }, [detectedFaces]);

  const sampleSkinReferenceAt = useCallback(
    (
      normX: number,
      normY: number,
      radiusRatio?: number,
      commitHistory: boolean = false
    ): SkinReferenceSample | null => {
      if (!targetImageElement) return null;
      const rad =
        radiusRatio ?? latestAdjustmentsRef.current.skinReference?.radiusRatio ?? 0.032;
      const sample = sampleTargetSkinReference(targetImageElement, normX, normY, rad);
      if (!sample) return null;
      updateAdjustments(
        {
          skinToneMatch: true,
          skinReference: sample,
        },
        commitHistory
          ? `Skin Reference (#${[sample.r, sample.g, sample.b]
              .map((v) => Math.round(v).toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase()})`
          : undefined
      );
      return sample;
    },
    [targetImageElement, updateAdjustments]
  );

  const clearSkinReference = useCallback(() => {
    setIsSkinSamplingMode(false);
    updateAdjustments({ skinReference: null }, 'Reset Skin Reference to Auto Face');
  }, [updateAdjustments]);

  const toggleCutoutLayerVisibility = useCallback(
    (layerId: string) => {
      const prevHidden = latestAdjustmentsRef.current.hiddenCutoutLayerIds || [];
      const isHidden = prevHidden.includes(layerId);
      const nextHidden = isHidden
        ? prevHidden.filter((id) => id !== layerId)
        : [...prevHidden, layerId];
      const layerName = detectedCutoutLayers.find((l) => l.id === layerId)?.name || 'Object Layer';
      updateAdjustments(
        { hiddenCutoutLayerIds: nextHidden },
        isHidden ? `Show Cutout: ${layerName}` : `Hide Cutout: ${layerName}`
      );
    },
    [detectedCutoutLayers, updateAdjustments]
  );

  const setCutoutLayerOpacity = useCallback(
    (layerId: string, opacity: number, commitHistory: boolean = false) => {
      const clamped = Math.max(0, Math.min(100, Math.round(opacity)));
      const prevMap = latestAdjustmentsRef.current.cutoutLayerOpacities || {};
      const nextMap = { ...prevMap, [layerId]: clamped };
      const layerName =
        layerId === '__face__'
          ? 'Swapped Face'
          : detectedCutoutLayers.find((l) => l.id === layerId)?.name || 'Segment Layer';
      updateAdjustments(
        { cutoutLayerOpacities: nextMap },
        commitHistory ? `Layer Opacity (${layerName}: ${clamped}%)` : undefined
      );
    },
    [detectedCutoutLayers, updateAdjustments]
  );

  const setCutoutLayerBlendMode = useCallback(
    (layerId: string, blendMode: LayerBlendMode) => {
      const nextModes = { ...(latestAdjustmentsRef.current.cutoutLayerBlendModes || {}) };
      if (blendMode === 'source-over') {
        delete nextModes[layerId];
      } else {
        nextModes[layerId] = blendMode;
      }
      const layerName =
        layerId === FACE_COMPOSITE_LAYER_ID
          ? 'Swapped Face'
          : detectedCutoutLayers.find((l) => l.id === layerId)?.name || 'Segment Layer';
      const label = blendMode === 'source-over' ? 'Normal' : blendMode;
      updateAdjustments(
        { cutoutLayerBlendModes: nextModes },
        `Layer Blend (${layerName}: ${label})`
      );
    },
    [detectedCutoutLayers, updateAdjustments]
  );

  const reorderCutoutLayers = useCallback(
    (nextFrontToBackOrder: string[], actionLabel?: string) => {
      const seen = new Set<string>();
      const clean: string[] = [];
      for (const id of nextFrontToBackOrder) {
        if (typeof id === 'string' && !seen.has(id)) {
          seen.add(id);
          clean.push(id);
        }
      }
      updateAdjustments(
        { cutoutLayerOrder: clean },
        actionLabel || 'Reordered Segmentation Layers'
      );
    },
    [updateAdjustments]
  );

  const resetCutoutLayerStack = useCallback(() => {
    updateAdjustments(
      {
        cutoutLayerOrder: [],
        cutoutLayerOpacities: {},
        cutoutLayerBlendModes: {},
        hiddenCutoutLayerIds: [],
        isolatedLayerId: null,
      },
      'Reset Layer Order, Blend & Opacities'
    );
  }, [updateAdjustments]);

  const toggleIsolatedLayer = useCallback(
    (layerId: string | null) => {
      const current = latestAdjustmentsRef.current.isolatedLayerId;
      const next = layerId === null || current === layerId ? null : layerId;
      const label =
        next === null
          ? 'Exit Layer Isolation'
          : next === '__background__'
          ? 'Isolate Background'
          : next === FACE_COMPOSITE_LAYER_ID || next === 'cat:skin'
          ? 'Isolate Skin / Face Layer'
          : next.startsWith('cat:')
          ? `Isolate ${next.replace('cat:', '').replace('_', ' ')}`
          : `Isolate ${detectedCutoutLayers.find((l) => l.id === next)?.name || 'Layer'}`;
      updateAdjustments({ isolatedLayerId: next }, label);
    },
    [detectedCutoutLayers, updateAdjustments]
  );

  const exportBatchMasksAndResult = useCallback(
    async (
      baseFilename: string = 'facemorph_portrait',
      scale: number = 1,
      includeFinalImage: boolean = true
    ): Promise<number> => {
      if (!targetImageElement) return 0;
      setIsBatchExportingMasks(true);
      try {
        const profilesMap: Record<string, FaceProfile> = {};
        profiles.forEach((p) => {
          profilesMap[p.id] = p;
        });

        const assets = await generateBatchExportMaskAssets({
          targetImage: targetImageElement,
          detectedFaces,
          profilesMap,
          profileImagesMap: profileImagesCacheRef.current,
          adjustments: latestAdjustmentsRef.current,
          outputCanvas: outputCanvasRef.current,
          manualMaskCanvas: manualMaskCanvasRef.current,
          baseFilename,
          includeFinalImage,
        });

        for (let idx = 0; idx < assets.length; idx++) {
          const item = assets[idx];
          await downloadCanvasImage(item.canvas, 'png', scale, item.filename, {
            omitTimestamp: true,
          });
          if (idx < assets.length - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 180));
          }
        }
        return assets.length;
      } catch (err) {
        console.error('Batch mask PNG export error:', err);
        return 0;
      } finally {
        setIsBatchExportingMasks(false);
      }
    },
    [targetImageElement, profiles, detectedFaces]
  );

  const exportLayerCompositionPsd = useCallback(
    async (
      baseFilename: string = 'facemorph_layer_composition',
      scale: number = 1
    ): Promise<{ layerCount: number; filename: string } | null> => {
      if (!targetImageElement) return null;
      setIsExportingPsd(true);
      try {
        const profilesMap: Record<string, FaceProfile> = {};
        profiles.forEach((p) => {
          profilesMap[p.id] = p;
        });

        const psdDoc = await generateLayerCompositionPsdAssets({
          targetImage: targetImageElement,
          detectedFaces,
          profilesMap,
          profileImagesMap: profileImagesCacheRef.current,
          adjustments: latestAdjustmentsRef.current,
          outputCanvas: outputCanvasRef.current,
          manualMaskCanvas: manualMaskCanvasRef.current,
          scale,
        });

        await downloadPsdDocument(psdDoc, baseFilename, { omitTimestamp: false });
        return {
          layerCount: psdDoc.layers.length,
          filename: `${baseFilename}.psd`,
        };
      } catch (err) {
        console.error('Multi-layer PSD export error:', err);
        return null;
      } finally {
        setIsExportingPsd(false);
      }
    },
    [targetImageElement, profiles, detectedFaces]
  );

  const rescanObjectLayers = useCallback(() => {
    if (!targetImageElement) return;
    const adjSnapshot = { ...latestAdjustmentsRef.current, hiddenCutoutLayerIds: [] };
    const inspection = inspectDiscreteTargetLayers(targetImageElement, detectedFaces, adjSnapshot);
    setDetectedCutoutLayers(inspection.objectLayers);
    setSegmentationVisualization(inspection.visualization);
    setSmartCleanupStats(inspection.cleanupStats);
    setLayerDecisionSummary(inspection.decisionSummary);
    setTotalLayerCount(inspection.totalLayerCount);
    updateAdjustments(
      { hiddenCutoutLayerIds: [] },
      `Auto-Scanned ${inspection.totalLayerCount} Layers`
    );
    void triggerRender();
  }, [targetImageElement, detectedFaces, updateAdjustments, triggerRender]);

  const syncFaceToLive = useCallback(
    (faceId?: string) => {
      const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
      const targetFace = detectedFaces.find((f) => f.id === targetId) || detectedFaces[0];
      if (!targetFace) return;

      setLiveSyncedFaceId(targetFace.id);
      applyFaceSettingsToLiveConfig(targetFace, adjustments);
    },
    [selectedFaceId, detectedFaces, adjustments, applyFaceSettingsToLiveConfig]
  );

  // Continuous real-time sync while a face is linked to Live Preview
  useEffect(() => {
    if (!liveSyncedFaceId) return;
    const syncedFace = detectedFaces.find((f) => f.id === liveSyncedFaceId);
    if (!syncedFace) return;
    applyFaceSettingsToLiveConfig(syncedFace, adjustments);
  }, [liveSyncedFaceId, detectedFaces, adjustments, applyFaceSettingsToLiveConfig]);

  // 10. Global Back Navigation Guard (onBackPress) with Exit Confirmation Modal
  const showCustomAssetModalRef = useRef(false);
  showCustomAssetModalRef.current = showCustomAssetModal;

  const onBackPress = useCallback((): boolean => {
    // If Exit Confirmation Modal is already visible, dismiss it safely (acts like 'No')
    if (showExitConfirmModal) {
      setShowExitConfirmModal(false);
      return true;
    }

    // Close secondary transient modals first if open
    if (showExportModal) {
      setShowExportModal(false);
      return true;
    }
    if (showGitHubModal) {
      setShowGitHubModal(false);
      return true;
    }
    if (showCustomAssetModalRef.current) {
      setShowCustomAssetModal(false);
      return true;
    }

    const adj = latestAdjustmentsRef.current;

    // 1) Active studio precision tool guard (Mask Brush, Geometric Mesh, Skin Picker, Layer Isolation, Compare)
    if (
      adj.brushMode !== 'none' ||
      adj.showGeometricMesh ||
      isSkinSamplingMode ||
      adj.isolatedLayerId !== null ||
      compareMode !== 'off'
    ) {
      const toolLabel =
        adj.brushMode !== 'none'
          ? 'Mask Fine-Tune Brush'
          : adj.showGeometricMesh
          ? 'Geometric Mesh Alignment'
          : isSkinSamplingMode
          ? 'Skin Reference Picker'
          : adj.isolatedLayerId !== null
          ? 'Layer Isolation View'
          : 'Split Compare View';

      setExitConfirmState({
        title: `Exit ${toolLabel}?`,
        message:
          'Return to the main studio canvas? Any saved mask strokes and parameter updates will be preserved safely.',
        targetLabel: toolLabel,
        kind: 'tool',
      });
      setShowExitConfirmModal(true);
      return true;
    }

    // 2) Secondary screen / tab guard (Body Fit, Live Camera, Face Vault, Batch, History)
    if (activeTab !== 'studio') {
      const tabNames: Record<'body' | 'camera' | 'vault' | 'batch' | 'history', string> = {
        body: 'Body Fit Studio',
        camera: 'Live Camera Studio',
        vault: 'Face Vault',
        batch: 'Batch Processing',
        history: 'Edit History',
      };
      const label = tabNames[activeTab];
      setExitConfirmState({
        title: `Exit ${label}?`,
        message: `Are you sure you want to leave ${label} and return to the Face Swap workspace?`,
        targetLabel: label,
        kind: 'tab',
      });
      setShowExitConfirmModal(true);
      return true;
    }

    // 3) Main studio / application exit guard
    const hasActiveWork =
      Boolean(targetImageUrl) || historyIndex > 0 || hasManualMaskStrokes;
    setExitConfirmState({
      title: 'Exit FaceMorph Studio?',
      message: hasActiveWork
        ? 'You have an active photo and unsaved workspace progress. Confirming Yes will safely close active overlays and end the current editing session.'
        : 'Confirm exiting FaceMorph Studio?',
      targetLabel: 'FaceMorph Studio',
      kind: 'app',
    });
    setShowExitConfirmModal(true);
    return true;
  }, [
    activeTab,
    compareMode,
    hasManualMaskStrokes,
    historyIndex,
    isSkinSamplingMode,
    showExitConfirmModal,
    showExportModal,
    showGitHubModal,
    targetImageUrl,
  ]);

  const confirmExitAction = useCallback(() => {
    const kind = exitConfirmState?.kind ?? 'app';
    setShowExitConfirmModal(false);
    setExitConfirmState(null);

    if (kind === 'tool') {
      setIsSkinSamplingMode(false);
      setCompareMode('off');
      updateAdjustments(
        {
          brushMode: 'none',
          showGeometricMesh: false,
          isolatedLayerId: null,
        },
        'Safely Exited Active Tool'
      );
      return;
    }

    if (kind === 'tab') {
      setActiveTab('studio');
      return;
    }

    // Safely close overlays & flush saved adjustments before exiting studio session / Capacitor app
    saveAdjustmentsToStorage(latestAdjustmentsRef.current);
    setIsSkinSamplingMode(false);
    setCompareMode('off');
    setIsInspectorOpen(false);
    setTargetImageUrl('');
    setDetectedFaces([]);

    const cap = (
      window as unknown as {
        Capacitor?: { Plugins?: { App?: { exitApp?: () => void } } };
      }
    ).Capacitor;
    if (cap?.Plugins?.App?.exitApp) {
      cap.Plugins.App.exitApp();
    }
  }, [exitConfirmState, updateAdjustments]);

  const cancelExitAction = useCallback(() => {
    setShowExitConfirmModal(false);
  }, []);

  const onBackPressRef = useRef(onBackPress);
  onBackPressRef.current = onBackPress;

  // Bind global onBackPress handler + browser popstate + Capacitor Android hardware back button
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const w = window as unknown as {
      onBackPress?: () => boolean;
      Capacitor?: {
        Plugins?: {
          App?: {
            addListener?: (
              eventName: string,
              cb: () => void
            ) => Promise<{ remove: () => void }> | { remove: () => void };
          };
        };
      };
    };

    const dispatchBack = () => onBackPressRef.current();
    w.onBackPress = dispatchBack;

    // Push lightweight guard state so hardware/browser Back invokes onBackPress instead of abrupt unload
    if (!window.history.state || !window.history.state.__facemorphBackGuard) {
      try {
        window.history.pushState({ __facemorphBackGuard: true }, '');
      } catch {
        // ignore sandboxed history restriction
      }
    }

    const handlePopState = () => {
      try {
        window.history.pushState({ __facemorphBackGuard: true }, '');
      } catch {
        // ignore
      }
      dispatchBack();
    };

    window.addEventListener('popstate', handlePopState);

    let capHandle: { remove: () => void } | null = null;
    const capApp = w.Capacitor?.Plugins?.App;
    if (capApp?.addListener) {
      const res = capApp.addListener('backButton', () => {
        dispatchBack();
      });
      if (res && typeof (res as Promise<{ remove: () => void }>).then === 'function') {
        (res as Promise<{ remove: () => void }>)
          .then((h) => {
            capHandle = h;
          })
          .catch(() => {});
      } else if (res && typeof (res as { remove: () => void }).remove === 'function') {
        capHandle = res as { remove: () => void };
      }
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (capHandle) {
        try {
          capHandle.remove();
        } catch {
          // ignore
        }
      }
      if (w.onBackPress === dispatchBack) {
        delete w.onBackPress;
      }
    };
  }, []);

  return (
    <FaceStudioContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        viewMode,
        setViewMode,
        isInspectorOpen,
        setIsInspectorOpen,
        toggleInspector,
        activeTab,
        setActiveTab,
        targetImageUrl,
        setTargetImageUrl,
        targetImageElement,
        detectedFaces,
        selectedFaceId,
        setSelectedFaceId,
        toggleFaceEnabled,
        setFaceIndividualStrength,
        rescanFaces,
        updateFaceLandmark,
        resetFaceLandmarks,
        autoAlignFace,
        profiles,
        activeProfileId,
        setActiveProfileId,
        assignProfileToFace,
        assignProfileToAllFaces,
        addFaceProfile,
        addFaceFromDataUrl,
        createPersonProfile,
        addAngleToProfile,
        removeAngleFromProfile,
        removeFaceProfile,
        getProfileImage,
        profileImagesVersion,
        angleScanResults,
        scanAndMatchFaceAngle,
        overrideClosestAngleMatch,
        flipFaceAndAdjust,
        adjustments,
        updateAdjustments,
        resetAdjustments,
        ambientLightReport,
        matchAmbientLight,
        lightingCalibrationReport,
        analyzeLightingCalibration,
        autoMatchTargetLighting,
        clearTargetLightingFilter,
        autoOptimizeReport,
        autoOptimizeWithCamera,
        liveCameraVideoRef,
        outputCanvasRef,
        manualMaskCanvasRef,
        clearManualMask,
        hasManualMaskStrokes,
        setHasManualMaskStrokes,
        triggerRender,
        isProcessing,
        compareMode,
        setCompareMode,
        splitPos,
        setSplitPos,
        isPeekingOriginal,
        setIsPeekingOriginal,
        history,
        historyIndex,
        undo,
        redo,
        revertToOriginal,
        canUndo: historyIndex > 0,
        canRedo: historyIndex < history.length - 1,
        jumpToHistory,
        showExportModal,
        setShowExportModal,
        showGitHubModal,
        setShowGitHubModal,
        showExitConfirmModal,
        setShowExitConfirmModal,
        exitConfirmState,
        onBackPress,
        confirmExitAction,
        cancelExitAction,
        batchQueue,
        setBatchQueue,
        runBatchProcessing,
        isBatchRunning,
        wardrobeAssets,
        addWardrobeAsset,
        removeWardrobeAsset,
        customClothingTags,
        allClothingTags,
        addCustomClothingTag,
        showCustomAssetModal,
        setShowCustomAssetModal,
        openCustomAssetModal,
        customAssetInitialCategory,
        customAssetInitialSource,
        liveCameraConfig,
        setLiveCameraConfig,
        liveSyncedFaceId,
        setLiveSyncedFaceId,
        syncFaceToLive,
        refocusSignal,
        triggerAutoRefocus,
        isSkinSamplingMode,
        setIsSkinSamplingMode,
        sampleSkinReferenceAt,
        clearSkinReference,
        detectedCutoutLayers,
        segmentationVisualization,
        smartCleanupStats,
        skinTextureReport,
        layerDecisionSummary,
        totalLayerCount,
        toggleCutoutLayerVisibility,
        setCutoutLayerOpacity,
        setCutoutLayerBlendMode,
        reorderCutoutLayers,
        resetCutoutLayerStack,
        toggleIsolatedLayer,
        rescanObjectLayers,
        isBatchExportingMasks,
        exportBatchMasksAndResult,
        isExportingPsd,
        exportLayerCompositionPsd,
      }}
    >
      {children}
    </FaceStudioContext.Provider>
  );
};

export const useFaceStudio = () => {
  const context = useContext(FaceStudioContext);
  if (!context) {
    throw new Error('useFaceStudio must be used within a FaceStudioProvider');
  }
  return context;
};
