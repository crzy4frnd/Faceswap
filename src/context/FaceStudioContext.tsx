import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  DetectedFace,
  FaceAdjustments,
  FaceProfile,
  HistoryItem,
  BatchItem,
  Point,
  Rect,
  FaceLandmarks,
  LiveCameraConfig,
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
  computeAmbientLightMatch,
  computeAutoAlignTransform,
  computeMLSceneAutoOptimize,
  createFaceCutout,
  detectFacesOnCanvas,
  loadImage,
  renderFaceSwap,
} from '../utils/faceEngine';

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

  // Profiles (Cutout Store / Face Vault)
  profiles: FaceProfile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  assignProfileToFace: (faceId: string, profileId: string) => void;
  assignProfileToAllFaces: (profileId: string) => void;
  addFaceProfile: (profile: FaceProfile) => void;
  addFaceFromDataUrl: (dataUrl: string, customName?: string, sourceTag?: string) => Promise<FaceProfile | null>;
  removeFaceProfile: (id: string) => void;

  // Adjustments & Engine
  adjustments: FaceAdjustments;
  updateAdjustments: (partial: Partial<FaceAdjustments>, actionLabel?: string) => void;
  resetAdjustments: () => void;
  ambientLightReport: AmbientLightReport | null;
  matchAmbientLight: (faceId?: string) => Promise<AmbientLightReport | null>;
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
  compareMode: 'off' | 'split' | 'peek';
  setCompareMode: (mode: 'off' | 'split' | 'peek') => void;
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

  // Modals & Batch
  showExportModal: boolean;
  setShowExportModal: (show: boolean) => void;
  showGitHubModal: boolean;
  setShowGitHubModal: (show: boolean) => void;
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
}

const FaceStudioContext = createContext<FaceStudioContextType | undefined>(undefined);

export const FaceStudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Theme and Full-Screen Studio View Mode
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [viewMode, setViewMode] = useState<'android' | 'expanded'>('expanded');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'studio' | 'body' | 'camera' | 'vault' | 'batch' | 'history'>('studio');

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

  // 2. Profiles / Face Vault (User-added only — filter out any legacy built-in dummy faces)
  const [profiles, setProfiles] = useState<FaceProfile[]>(() => {
    try {
      const saved = localStorage.getItem('facemorph_profiles_v1');
      if (saved) {
        const parsed = JSON.parse(saved) as FaceProfile[];
        return Array.isArray(parsed) ? parsed.filter((p) => !p.isBuiltIn) : INITIAL_FACE_PROFILES;
      }
    } catch {
      // fallback
    }
    return INITIAL_FACE_PROFILES;
  });

  const [activeProfileId, setActiveProfileId] = useState<string>(profiles[0]?.id || '');

  // Cached profile HTMLImageElements for fast real-time canvas rendering
  const profileImagesCacheRef = useRef<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    try {
      localStorage.setItem('facemorph_profiles_v1', JSON.stringify(profiles));
    } catch {
      // ignore
    }
    // Pre-cache profile images
    profiles.forEach((p) => {
      if (!profileImagesCacheRef.current[p.id]) {
        loadImage(p.fullImageUrl)
          .then((img) => {
            profileImagesCacheRef.current[p.id] = img;
          })
          .catch(() => {});
      }
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
  const [autoOptimizeReport, setAutoOptimizeReport] = useState<AutoOptimizeReport | null>(null);
  const liveCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const manualMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasManualMaskStrokes, setHasManualMaskStrokes] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);

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
  const [compareMode, setCompareMode] = useState<'off' | 'split' | 'peek'>('off');
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
        const defaultProf = activeProfileId || undefined;
        const mapped = faces.map((f, i) => ({
          ...f,
          originalLandmarks: JSON.parse(JSON.stringify(f.landmarks)),
          isLandmarksEdited: false,
          assignedProfileId: i === 0 ? defaultProf : undefined,
        }));
        setDetectedFaces(mapped);
        if (mapped.length > 0) {
          setSelectedFaceId(mapped[0].id);
        }
      }
    } catch (err) {
      console.error('Face detection error:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [activeProfileId]);

  useEffect(() => {
    if (!targetImageUrl) {
      setTargetImageElement(null);
      setDetectedFaces([]);
      setSelectedFaceId(null);
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
      if (face.assignedProfileId && !profileImagesCacheRef.current[face.assignedProfileId]) {
        try {
          const prof = profilesMap[face.assignedProfileId];
          if (prof) {
            const img = await loadImage(prof.fullImageUrl);
            profileImagesCacheRef.current[face.assignedProfileId] = img;
          }
        } catch {
          // ignore
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
      manualMaskCanvasRef.current
    );
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

  // Face assignment
  const assignProfileToFace = (faceId: string, profileId: string) => {
    setDetectedFaces((prev) =>
      prev.map((f) => (f.id === faceId ? { ...f, assignedProfileId: profileId, enabled: true } : f))
    );
    const prof = profiles.find((p) => p.id === profileId);
    updateAdjustments({}, `Assigned ${prof?.name || 'Face'} to Person`);
  };

  const assignProfileToAllFaces = (profileId: string) => {
    setDetectedFaces((prev) =>
      prev.map((f) => ({ ...f, assignedProfileId: profileId, enabled: true }))
    );
    const prof = profiles.find((p) => p.id === profileId);
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
    setProfiles((prev) => [profile, ...prev]);
    setActiveProfileId(profile.id);
  };

  const addFaceFromDataUrl = useCallback(
    async (dataUrl: string, customName?: string, sourceTag: string = 'Custom'): Promise<FaceProfile | null> => {
      try {
        const img = await loadImage(dataUrl);
        const off = document.createElement('canvas');
        off.width = img.naturalWidth || img.width;
        off.height = img.naturalHeight || img.height;
        const ctx = off.getContext('2d');
        let cutoutUrl = dataUrl;
        let detectedLandmarks = undefined;

        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const faces = await detectFacesOnCanvas(off);
          const primary = faces[0] || {
            box: {
              x: Math.round(off.width * 0.2),
              y: Math.round(off.height * 0.15),
              width: Math.round(off.width * 0.6),
              height: Math.round(off.height * 0.65),
            },
            landmarks: undefined,
          };
          detectedLandmarks = primary.landmarks;
          cutoutUrl = await createFaceCutout(img, primary.box, 256);
        }

        const newProfile: FaceProfile = {
          id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: customName?.trim() || `Face ${profiles.length + 1}`,
          avatarUrl: cutoutUrl,
          fullImageUrl: dataUrl,
          dateAdded: new Date().toISOString().split('T')[0],
          isBuiltIn: false,
          tags: [sourceTag],
          detectedLandmarks,
        };

        profileImagesCacheRef.current[newProfile.id] = img;
        setProfiles((prev) => [newProfile, ...prev]);
        setActiveProfileId(newProfile.id);

        const targetFaceId = selectedFaceId || detectedFaces[0]?.id;
        if (targetFaceId) {
          setDetectedFaces((prev) =>
            prev.map((f) =>
              f.id === targetFaceId ? { ...f, assignedProfileId: newProfile.id, enabled: true } : f
            )
          );
        }

        return newProfile;
      } catch (err) {
        console.error('Failed adding face from image:', err);
        return null;
      }
    },
    [profiles.length, selectedFaceId, detectedFaces]
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

      // Ensure source profile image is loaded
      let sourceImg = profileImagesCacheRef.current[profile.id];
      if (!sourceImg) {
        try {
          sourceImg = await loadImage(profile.fullImageUrl);
          profileImagesCacheRef.current[profile.id] = sourceImg;
        } catch {
          return null;
        }
      }

      // Detect and cache source face landmarks if not yet available
      let sourceLandmarks = profile.detectedLandmarks || null;
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

      const aligned = computeAutoAlignTransform(targetFace, sourceLandmarks, {
        width: sourceImg.naturalWidth || sourceImg.width,
        height: sourceImg.naturalHeight || sourceImg.height,
      });

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
    lightingAdjustment: adjustments.lightingAdjustment,
    shadowMatcher: adjustments.shadowMatcher,
    softBloom: adjustments.softBloom,
    autoRefocus: adjustments.autoRefocus,
    antiAliasing: adjustments.antiAliasing,
    genderMorph: adjustments.genderMorph,
    edgeContrast: adjustments.edgeContrast,
    motionSmoothing: adjustments.motionSmoothing,
    edgeSoftness: adjustments.edgeSoftness,
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
        lightingAdjustment: adj.lightingAdjustment,
        shadowMatcher: adj.shadowMatcher,
        softBloom: adj.softBloom,
        autoRefocus: adj.autoRefocus,
        antiAliasing: adj.antiAliasing,
        genderMorph: adj.genderMorph,
        edgeContrast: adj.edgeContrast,
        motionSmoothing: adj.motionSmoothing,
        edgeSoftness: adj.edgeSoftness,
      }));
    },
    []
  );

  // Keep global motionSensitivity, autoRefocus, antiAliasing, genderMorph, edgeContrast, motionSmoothing, edgeSoftness, shadowMatcher, headPitch, headYaw, showFaceLandmarks & color preferences synchronized with live camera configuration
  useEffect(() => {
    setLiveCameraConfig((prev) =>
      prev.motionSensitivity === adjustments.motionSensitivity &&
      prev.autoRefocus === adjustments.autoRefocus &&
      prev.antiAliasing === adjustments.antiAliasing &&
      prev.genderMorph === adjustments.genderMorph &&
      prev.edgeContrast === adjustments.edgeContrast &&
      prev.motionSmoothing === adjustments.motionSmoothing &&
      prev.edgeSoftness === adjustments.edgeSoftness &&
      prev.shadowMatcher === adjustments.shadowMatcher &&
      prev.headPitch === adjustments.headPitch &&
      prev.headYaw === adjustments.headYaw &&
      prev.showLandmarkMesh === adjustments.showFaceLandmarks &&
      prev.hue === adjustments.hue &&
      prev.vibrance === adjustments.vibrance
        ? prev
        : {
            ...prev,
            motionSensitivity: adjustments.motionSensitivity,
            autoRefocus: adjustments.autoRefocus,
            antiAliasing: adjustments.antiAliasing,
            genderMorph: adjustments.genderMorph,
            edgeContrast: adjustments.edgeContrast,
            motionSmoothing: adjustments.motionSmoothing,
            edgeSoftness: adjustments.edgeSoftness,
            shadowMatcher: adjustments.shadowMatcher,
            headPitch: adjustments.headPitch,
            headYaw: adjustments.headYaw,
            showLandmarkMesh: adjustments.showFaceLandmarks,
            hue: adjustments.hue,
            vibrance: adjustments.vibrance,
          }
    );
  }, [
    adjustments.motionSensitivity,
    adjustments.autoRefocus,
    adjustments.antiAliasing,
    adjustments.genderMorph,
    adjustments.edgeContrast,
    adjustments.motionSmoothing,
    adjustments.edgeSoftness,
    adjustments.shadowMatcher,
    adjustments.headPitch,
    adjustments.headYaw,
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
        removeFaceProfile,
        adjustments,
        updateAdjustments,
        resetAdjustments,
        ambientLightReport,
        matchAmbientLight,
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
