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
} from '../types/face';
import { WardrobeAsset } from '../types/body';
import {
  INITIAL_WARDROBE_ASSETS,
  loadSavedCustomAssets,
  saveCustomAssetsToStorage,
} from '../utils/bodyAssets';
import {
  SAMPLE_TARGETS,
  INITIAL_FACE_PROFILES,
  DEFAULT_ADJUSTMENTS,
} from '../utils/sampleData';
import {
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

  // Profiles (Cutout Store / Face Vault)
  profiles: FaceProfile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  assignProfileToFace: (faceId: string, profileId: string) => void;
  assignProfileToAllFaces: (profileId: string) => void;
  addFaceProfile: (profile: FaceProfile) => void;
  removeFaceProfile: (id: string) => void;

  // Adjustments & Engine
  adjustments: FaceAdjustments;
  updateAdjustments: (partial: Partial<FaceAdjustments>, actionLabel?: string) => void;
  resetAdjustments: () => void;
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
  batchQueue: BatchItem[];
  setBatchQueue: React.Dispatch<React.SetStateAction<BatchItem[]>>;
  runBatchProcessing: (profileId: string) => Promise<void>;
  isBatchRunning: boolean;

  // Wardrobe & Custom Costume/Jewelry Assets
  wardrobeAssets: WardrobeAsset[];
  addWardrobeAsset: (asset: WardrobeAsset) => void;
  removeWardrobeAsset: (id: string) => void;
  showCustomAssetModal: boolean;
  setShowCustomAssetModal: (show: boolean) => void;
  openCustomAssetModal: (category?: 'clothing' | 'jewelry' | 'accessory') => void;
  customAssetInitialCategory: 'clothing' | 'jewelry' | 'accessory';
}

const FaceStudioContext = createContext<FaceStudioContextType | undefined>(undefined);

export const FaceStudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Theme and Native Android UI Mode
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [viewMode, setViewMode] = useState<'android' | 'expanded'>('android');
  const [activeTab, setActiveTab] = useState<'studio' | 'body' | 'camera' | 'vault' | 'batch' | 'history'>('studio');

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

  // 2. Profiles / Face Vault
  const [profiles, setProfiles] = useState<FaceProfile[]>(() => {
    try {
      const saved = localStorage.getItem('facemorph_profiles_v1');
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return INITIAL_FACE_PROFILES;
  });

  const [activeProfileId, setActiveProfileId] = useState<string>(INITIAL_FACE_PROFILES[0].id);

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

  // 3. Target Image & Detected Faces
  const [targetImageUrl, setTargetImageUrl] = useState<string>(SAMPLE_TARGETS[0].url);
  const [targetImageElement, setTargetImageElement] = useState<HTMLImageElement | null>(null);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);

  // 4. Adjustments & Output Canvas
  const [adjustments, setAdjustments] = useState<FaceAdjustments>(DEFAULT_ADJUSTMENTS);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const manualMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasManualMaskStrokes, setHasManualMaskStrokes] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // 5. Comparison & Live Preview
  const [compareMode, setCompareMode] = useState<'off' | 'split' | 'peek'>('off');
  const [splitPos, setSplitPos] = useState<number>(50);
  const [isPeekingOriginal, setIsPeekingOriginal] = useState<boolean>(false);

  // 6. History Stack
  const [history, setHistory] = useState<HistoryItem[]>([
    {
      id: 'init',
      timestamp: Date.now(),
      action: 'Initial Image Load',
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      assignedFaces: {},
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // 7. Batch Queue
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([
    {
      id: 'b1',
      imageUrl: SAMPLE_TARGETS[0].url,
      name: 'Studio Portrait (01)',
      status: 'pending',
      progress: 0,
    },
    {
      id: 'b2',
      imageUrl: SAMPLE_TARGETS[1].url,
      name: 'Urban Café Duo (02)',
      status: 'pending',
      progress: 0,
    },
    {
      id: 'b3',
      imageUrl: SAMPLE_TARGETS[2].url,
      name: 'Park Friends Group (03)',
      status: 'pending',
      progress: 0,
    },
  ]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

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
        // Map first profile by default and store pristine original landmarks
        const mapped = faces.map((f, i) => ({
          ...f,
          originalLandmarks: JSON.parse(JSON.stringify(f.landmarks)),
          isLandmarksEdited: false,
          assignedProfileId: i === 0 ? activeProfileId : undefined,
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

  const removeFaceProfile = (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    if (activeProfileId === id) {
      const remaining = profiles.filter((p) => p.id !== id);
      if (remaining.length > 0) {
        setActiveProfileId(remaining[0].id);
      }
    }
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

  // Wardrobe & Custom Costume / Jewelry Assets
  const [wardrobeAssets, setWardrobeAssets] = useState<WardrobeAsset[]>(() => {
    const saved = loadSavedCustomAssets();
    const initialIds = new Set(INITIAL_WARDROBE_ASSETS.map((a) => a.id));
    const customOnly = saved.filter((s) => !initialIds.has(s.id));
    return [...INITIAL_WARDROBE_ASSETS, ...customOnly];
  });
  const [showCustomAssetModal, setShowCustomAssetModal] = useState<boolean>(false);
  const [customAssetInitialCategory, setCustomAssetInitialCategory] = useState<'clothing' | 'jewelry' | 'accessory'>('clothing');

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

  const openCustomAssetModal = useCallback((category: 'clothing' | 'jewelry' | 'accessory' = 'clothing') => {
    setCustomAssetInitialCategory(category);
    setShowCustomAssetModal(true);
  }, []);

  return (
    <FaceStudioContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        viewMode,
        setViewMode,
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
        profiles,
        activeProfileId,
        setActiveProfileId,
        assignProfileToFace,
        assignProfileToAllFaces,
        addFaceProfile,
        removeFaceProfile,
        adjustments,
        updateAdjustments,
        resetAdjustments,
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
        batchQueue,
        setBatchQueue,
        runBatchProcessing,
        isBatchRunning,
        wardrobeAssets,
        addWardrobeAsset,
        removeWardrobeAsset,
        showCustomAssetModal,
        setShowCustomAssetModal,
        openCustomAssetModal,
        customAssetInitialCategory,
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
