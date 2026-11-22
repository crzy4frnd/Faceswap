import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  Sparkles,
  X,
  Scissors,
  RotateCw,
  Sliders,
  Layers,
  Shirt,
  Gem,
  RefreshCw,
  Eraser,
  Paintbrush,
  Wind,
  Plus,
  Package,
  Glasses,
  Tag,
  Undo2,
  Eye,
  Contrast,
  CheckSquare,
  Square,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { WardrobeAsset, WardrobeCategory } from '../types/body';
import {
  createNormalizedWorkingCanvas,
  createInitialCutoutMask,
  fillCutoutMask,
  invertCutoutMask,
  applyLassoCutoutToMask,
  strokeMaskBrush,
  computeSmartClotheMask,
  renderCutoutCompositePreview,
  extractTrimmedTransparentCutout,
  exportTransparentAssetDataUrl,
  Point2D,
  LassoApplyMode,
  OverlayTintColor,
  BrushToolSettings,
} from '../utils/customAssetSegmenter';
import {
  ClothMeshState,
  DEFAULT_CLOTH_CONFIG,
  createClothGrid,
  createPendantPhysics,
  renderClothMesh,
  stepClothMesh,
  stepPendantPhysics,
  PendantPhysicsState,
} from '../utils/clothPhysicsEngine';
import { loadImage } from '../utils/faceEngine';
import kimonoUrl from '../assets/images/costume_silk_kimono_1794472960844.jpg';
import emeraldPendantUrl from '../assets/images/costume_emerald_pendant_1794472974484.jpg';
import blazerUrl from '../assets/images/asset_tailored_blazer_1794417020215.jpg';
import goldNecklaceUrl from '../assets/images/asset_gold_necklace_1794417020572.jpg';

interface Props {
  onAssetAdded?: (assetId: string) => void;
}

type CutoutTool = 'outline' | 'brush' | 'erase';

const JEWELRY_SUBTYPES: {
  id: WardrobeAsset['subCategory'];
  label: string;
  anchor: WardrobeAsset['anchorPoint'];
  scale: number;
}[] = [
  { id: 'necklace', label: 'Necklace', anchor: 'neck', scale: 0.65 },
  { id: 'watch', label: 'Watch', anchor: 'wrist', scale: 0.4 },
  { id: 'bracelet', label: 'Bracelet', anchor: 'wrist', scale: 0.42 },
  { id: 'earrings', label: 'Earrings', anchor: 'ears', scale: 0.55 },
  { id: 'ring', label: 'Ring', anchor: 'wrist', scale: 0.35 },
];

const OBJECT_SUBTYPES: {
  id: WardrobeAsset['subCategory'];
  label: string;
  anchor: WardrobeAsset['anchorPoint'];
  scale: number;
}[] = [
  { id: 'glasses', label: 'Glasses', anchor: 'head', scale: 0.68 },
  { id: 'hat', label: 'Hat / Cap', anchor: 'head', scale: 0.92 },
  { id: 'crown', label: 'Crown', anchor: 'head', scale: 0.85 },
  { id: 'handbag', label: 'Handbag', anchor: 'wrist', scale: 0.85 },
  { id: 'prop', label: 'Object / Prop', anchor: 'wrist', scale: 0.75 },
];

export const CustomAssetCaptureModal: React.FC<Props> = ({ onAssetAdded }) => {
  const {
    showCustomAssetModal,
    setShowCustomAssetModal,
    addWardrobeAsset,
    customAssetInitialCategory,
    customAssetInitialSource,
    allClothingTags,
    addCustomClothingTag,
  } = useFaceStudio();

  // Step flow: 'source' -> 'segment' -> 'configure'
  const [activeStep, setActiveStep] = useState<'source' | 'segment' | 'configure'>('source');
  const [sourceType, setSourceType] = useState<'camera' | 'upload' | 'samples'>('camera');

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Non-destructive dual canvas cutout buffers
  const rawImageRef = useRef<HTMLImageElement | null>(null);
  const workingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [rawImageUrl, setRawImageUrl] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [cutoutDimensions, setCutoutDimensions] = useState<{ w: number; h: number } | null>(null);

  // Picsart-style Cutout Clothe tool & independent Brush / Erase settings
  const [activeTool, setActiveTool] = useState<CutoutTool>('outline');
  const [lassoMode, setLassoMode] = useState<LassoApplyMode>('replace');
  const [outlineHardness, setOutlineHardness] = useState<number>(85);
  const [outlineOverlay, setOutlineOverlay] = useState<number>(62);

  const [brushSettings, setBrushSettings] = useState<BrushToolSettings>({
    size: 26,
    hardness: 72,
    overlay: 68,
  });

  const [eraseSettings, setEraseSettings] = useState<BrushToolSettings>({
    size: 26,
    hardness: 80,
    overlay: 68,
  });

  const [overlayTint, setOverlayTint] = useState<OverlayTintColor>('rose');
  const [peekPureCutout, setPeekPureCutout] = useState<boolean>(false);
  const [canvasBgPreview, setCanvasBgPreview] = useState<'checker' | 'dark' | 'light'>('checker');

  // Pointer & lasso tracking refs
  const isDrawingRef = useRef<boolean>(false);
  const lastStrokePtRef = useRef<Point2D | null>(null);
  const lassoPointsRef = useRef<Point2D[]>([]);
  const [cursorRing, setCursorRing] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  // Undo history (stores ImageData snapshots of maskCanvas)
  const undoStackRef = useRef<ImageData[]>([]);
  const [undoCount, setUndoCount] = useState(0);

  // Asset Metadata & Physics configuration
  const [assetName, setAssetName] = useState('Custom Shirt');
  const [category, setCategory] = useState<WardrobeCategory>(customAssetInitialCategory || 'clothing');
  const [subCategory, setSubCategory] = useState<WardrobeAsset['subCategory']>('shirt');
  const [clothingTag, setClothingTag] = useState<string>('shirt');
  const [newClothingTagInput, setNewClothingTagInput] = useState('');
  const [anchorPoint, setAnchorPoint] = useState<WardrobeAsset['anchorPoint']>('shoulders');
  const [fabricType, setFabricType] = useState<WardrobeAsset['fabricType']>('cotton');
  const [defaultScale, setDefaultScale] = useState<number>(1.0);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(['Shirts', 'Custom']);
  const [previewMeshWireframe, setPreviewMeshWireframe] = useState(true);

  // Mannequin physics preview refs
  const mannequinCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mannequinAnimRef = useRef<number | null>(null);
  const previewClothMeshRef = useRef<ClothMeshState | null>(null);
  const previewPendantRef = useRef<PendantPhysicsState | null>(null);

  const activeOverlayOpacity = peekPureCutout
    ? 0
    : activeTool === 'brush'
    ? brushSettings.overlay
    : activeTool === 'erase'
    ? eraseSettings.overlay
    : outlineOverlay;

  const stopActiveStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Reset modal defaults when opened
  useEffect(() => {
    if (showCustomAssetModal) {
      const initCat = customAssetInitialCategory || 'clothing';
      setCategory(initCat);
      setSourceType(customAssetInitialSource || 'camera');
      setActiveStep('source');
      setActiveTool('outline');
      setLassoMode('replace');
      setPeekPureCutout(false);
      setCameraError(null);
      setRawImageUrl(null);
      setPreviewDataUrl(null);
      setCutoutDimensions(null);
      rawImageRef.current = null;
      workingCanvasRef.current = null;
      maskCanvasRef.current = null;
      undoStackRef.current = [];
      lassoPointsRef.current = [];
      setUndoCount(0);
    } else {
      stopActiveStream();
    }
  }, [showCustomAssetModal, customAssetInitialCategory, customAssetInitialSource, stopActiveStream]);

  // Camera initialization
  useEffect(() => {
    if (!showCustomAssetModal || activeStep !== 'source' || sourceType !== 'camera') {
      stopActiveStream();
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setCameraError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError('Camera access unavailable. You can upload an image or test a sample.');
        }
      });

    return () => {
      cancelled = true;
      stopActiveStream();
    };
  }, [showCustomAssetModal, activeStep, sourceType, facingMode, stopActiveStream]);

  // Render composite preview (source + mask + Picsart overlay + active outline trace)
  const redrawCutoutCanvas = useCallback(() => {
    const display = displayCanvasRef.current;
    const working = workingCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!display || !working || !mask) return;

    renderCutoutCompositePreview(display, working, mask, {
      overlayOpacity: activeOverlayOpacity,
      overlayTint,
    });

    // Draw live freehand Outline / Lasso path while tracing
    const pts = lassoPointsRef.current;
    if (pts.length > 1) {
      const ctx = display.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Outer high-contrast dark stroke + inner bright dashed/solid stroke
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }

        ctx.strokeStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.lineWidth = Math.max(4, Math.round(display.width / 160));
        ctx.stroke();

        ctx.strokeStyle =
          lassoMode === 'subtract'
            ? '#fb7185'
            : lassoMode === 'add'
            ? '#34d399'
            : '#f8fafc';
        ctx.lineWidth = Math.max(2, Math.round(display.width / 260));
        ctx.setLineDash([8, 6]);
        ctx.stroke();

        // Start point anchor dot to guide closing loop
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, Math.max(5, display.width / 110), 0, Math.PI * 2);
        ctx.fillStyle = '#f43f5e';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [activeOverlayOpacity, overlayTint, lassoMode]);

  // Redraw whenever Step 2 mounts or overlay settings change
  useEffect(() => {
    if (activeStep === 'segment') {
      redrawCutoutCanvas();
    }
  }, [activeStep, redrawCutoutCanvas]);

  // Initialize non-destructive cutout buffers from loaded image (NO forced background deletion)
  const initializeCutoutWorkspace = useCallback(
    (sourceImg: HTMLImageElement) => {
      const working = createNormalizedWorkingCanvas(sourceImg, 880);
      const { maskCanvas, hasSourceAlpha } = createInitialCutoutMask(working, 'preserve-alpha');

      workingCanvasRef.current = working;
      maskCanvasRef.current = maskCanvas;
      undoStackRef.current = [];
      lassoPointsRef.current = [];
      setUndoCount(0);
      setCutoutDimensions({ w: working.width, h: working.height });
      setActiveTool('outline');
      setLassoMode('replace');
      setPeekPureCutout(hasSourceAlpha);

      const trimmed = extractTrimmedTransparentCutout(working, maskCanvas, 4);
      setPreviewDataUrl(exportTransparentAssetDataUrl(trimmed.canvas));
      requestAnimationFrame(() => redrawCutoutCanvas());
    },
    [redrawCutoutCanvas]
  );

  // Compute finalized tight transparent PNG for Step 3 & Saved Assets
  const refreshFinalTrimmedExport = useCallback(() => {
    const working = workingCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!working || !mask) return;
    const trimmed = extractTrimmedTransparentCutout(working, mask, 4);
    setCutoutDimensions({ w: trimmed.canvas.width, h: trimmed.canvas.height });
    setPreviewDataUrl(exportTransparentAssetDataUrl(trimmed.canvas));
  }, []);

  // Push mask snapshot onto undo stack before each stroke / cutout edit
  const pushMaskUndo = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    if (!mctx) return;
    try {
      const snap = mctx.getImageData(0, 0, mask.width, mask.height);
      undoStackRef.current = [...undoStackRef.current.slice(-14), snap];
      setUndoCount(undoStackRef.current.length);
    } catch {
      // Ignore read failures
    }
  }, []);

  const handleUndoMask = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask || undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop();
    setUndoCount(undoStackRef.current.length);
    if (!prev) return;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    if (!mctx) return;
    mctx.putImageData(prev, 0, 0);
    redrawCutoutCanvas();
    refreshFinalTrimmedExport();
  }, [redrawCutoutCanvas, refreshFinalTrimmedExport]);

  // Sync defaults cleanly when top-level category switches
  const handleCategorySwitch = (nextCat: WardrobeCategory) => {
    setCategory(nextCat);
    if (nextCat === 'clothing') {
      const def = allClothingTags.find((t) => t.id === clothingTag) || allClothingTags[0];
      setClothingTag(def.id);
      setSubCategory(def.id);
      setAnchorPoint(def.defaultAnchor);
      setFabricType(def.defaultFabric);
      setDefaultScale(def.defaultScale);
      setAssetName(`Custom ${def.label.replace(/s$/, '')}`);
      setTags([def.label, 'Custom']);
    } else if (nextCat === 'jewelry') {
      setSubCategory('necklace');
      setAnchorPoint('neck');
      setDefaultScale(0.65);
      setAssetName('Custom Pendant Necklace');
      setTags(['Jewelry', 'Necklace', 'Custom']);
    } else {
      setSubCategory('prop');
      setAnchorPoint('head');
      setDefaultScale(0.8);
      setAssetName('Custom Studio Object');
      setTags(['Object', 'Custom']);
    }
  };

  // Camera snapshot
  const handleCaptureCamera = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const w = v.videoWidth || 640;
    const h = v.videoHeight || 480;

    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = w;
    snapCanvas.height = h;
    const sctx = snapCanvas.getContext('2d');
    if (!sctx) return;

    if (facingMode === 'user') {
      sctx.translate(w, 0);
      sctx.scale(-1, 1);
    }
    sctx.drawImage(v, 0, 0, w, h);

    const dataUrl = snapCanvas.toDataURL('image/png');
    loadImage(dataUrl).then((img) => {
      rawImageRef.current = img;
      setRawImageUrl(dataUrl);
      initializeCutoutWorkspace(img);
      setActiveStep('segment');
    });
    stopActiveStream();
  };

  // File upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const baseName = file.name.replace(/\.[^/.]+$/, '').trim();
    if (baseName) setAssetName(baseName);

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      loadImage(dataUrl).then((img) => {
        rawImageRef.current = img;
        setRawImageUrl(dataUrl);
        initializeCutoutWorkspace(img);
        setActiveStep('segment');
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Curated test sample
  const handleSelectSample = (
    url: string,
    name: string,
    cat: WardrobeCategory,
    sub: string,
    anchor: WardrobeAsset['anchorPoint'],
    mat?: WardrobeAsset['fabricType']
  ) => {
    loadImage(url).then((img) => {
      rawImageRef.current = img;
      setRawImageUrl(url);
      setAssetName(name);
      setCategory(cat);
      setSubCategory(sub);
      if (cat === 'clothing') setClothingTag(sub);
      setAnchorPoint(anchor);
      if (mat) setFabricType(mat);
      setTags([sub.charAt(0).toUpperCase() + sub.slice(1), 'Sample']);
      initializeCutoutWorkspace(img);
      setActiveStep('segment');
    });
  };

  // Map pointer event to mask canvas coordinates + screen-space cursor position inside container
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point2D | null => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
    };
  };

  const updateCursorOverlay = (e: React.PointerEvent<HTMLCanvasElement>, show: boolean) => {
    const canvas = displayCanvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    setCursorRing({
      x: e.clientX - parentRect.left,
      y: e.clientY - parentRect.top,
      visible: show && activeTool !== 'outline',
    });
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getCanvasPoint(e);
    const mask = maskCanvasRef.current;
    if (!pt || !mask) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    updateCursorOverlay(e, true);

    if (activeTool === 'outline') {
      lassoPointsRef.current = [pt];
      redrawCutoutCanvas();
      return;
    }

    pushMaskUndo();
    lastStrokePtRef.current = pt;

    const settings = activeTool === 'brush' ? brushSettings : eraseSettings;
    strokeMaskBrush(mask, pt, pt, settings.size, settings.hardness, activeTool);
    redrawCutoutCanvas();
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    updateCursorOverlay(e, true);
    if (!isDrawingRef.current) return;

    const pt = getCanvasPoint(e);
    const mask = maskCanvasRef.current;
    if (!pt || !mask) return;

    if (activeTool === 'outline') {
      const pts = lassoPointsRef.current;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 3) {
        pts.push(pt);
        redrawCutoutCanvas();
      }
      return;
    }

    const fromPt = lastStrokePtRef.current || pt;
    const settings = activeTool === 'brush' ? brushSettings : eraseSettings;
    strokeMaskBrush(mask, fromPt, pt, settings.size, settings.hardness, activeTool);
    lastStrokePtRef.current = pt;
    redrawCutoutCanvas();
  };

  const finishPointerStroke = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastStrokePtRef.current = null;

    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const mask = maskCanvasRef.current;
    if (activeTool === 'outline' && mask) {
      const pts = lassoPointsRef.current;
      lassoPointsRef.current = [];
      if (pts.length >= 3) {
        pushMaskUndo();
        applyLassoCutoutToMask(mask, pts, lassoMode, outlineHardness);
      }
      redrawCutoutCanvas();
    }

    refreshFinalTrimmedExport();
  };

  // 1-Tap Picsart Smart Clothe auto-seed (non-destructive, editable via Brush/Erase)
  const handleSmartClotheCutout = () => {
    const working = workingCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!working || !mask) return;
    pushMaskUndo();
    computeSmartClotheMask(working, mask);
    setPeekPureCutout(false);
    redrawCutoutCanvas();
    refreshFinalTrimmedExport();
  };

  const handleMaskQuickAction = (action: 'all' | 'clear' | 'invert' | 'reset') => {
    const working = workingCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!working || !mask) return;

    pushMaskUndo();
    if (action === 'all' || action === 'reset') {
      fillCutoutMask(mask, true);
      if (action === 'reset') {
        setActiveTool('outline');
        setLassoMode('replace');
        setPeekPureCutout(false);
      }
    } else if (action === 'clear') {
      fillCutoutMask(mask, false);
      setPeekPureCutout(false);
    } else if (action === 'invert') {
      invertCutoutMask(mask);
    }
    redrawCutoutCanvas();
    refreshFinalTrimmedExport();
  };

  // Compute scaled preview cursor diameter on screen
  const getScreenCursorDiameter = () => {
    const canvas = displayCanvasRef.current;
    const settings = activeTool === 'brush' ? brushSettings : eraseSettings;
    if (!canvas) return settings.size * 2;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !canvas.width) return settings.size * 2;
    return settings.size * 2 * (rect.width / canvas.width);
  };

  // Select built-in or custom clothing tag in Step 3
  const handleSelectClothingTag = (tagDef: {
    id: string;
    label: string;
    defaultAnchor: WardrobeAsset['anchorPoint'];
    defaultFabric: NonNullable<WardrobeAsset['fabricType']>;
    defaultScale: number;
  }) => {
    setClothingTag(tagDef.id);
    setSubCategory(tagDef.id);
    setAnchorPoint(tagDef.defaultAnchor);
    setFabricType(tagDef.defaultFabric);
    setDefaultScale(tagDef.defaultScale);
    if (!tags.some((t) => t.toLowerCase() === tagDef.label.toLowerCase())) {
      setTags((prev) => [
        tagDef.label,
        ...prev.filter((p) => !allClothingTags.some((a) => a.label === p)),
      ]);
    }
    previewClothMeshRef.current = null;
  };

  // Create custom clothing tag when not in list
  const handleCreateCustomClothingTag = () => {
    const raw = newClothingTagInput.trim();
    if (!raw) return;
    const created = addCustomClothingTag(raw, anchorPoint, fabricType || 'cotton');
    if (created) {
      handleSelectClothingTag(created);
      setNewClothingTagInput('');
    }
  };

  // Add arbitrary descriptive tag
  const handleAddTag = () => {
    const clean = tagInput.trim();
    if (!clean) return;
    if (!tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTags((prev) => [...prev, clean]);
    }
    setTagInput('');
  };

  // Step 3 Real-Time Mass-Spring Cloth Mesh & Pendulum Mannequin Preview
  useEffect(() => {
    if (activeStep !== 'configure' || !previewDataUrl) return;
    previewClothMeshRef.current = null;
    previewPendantRef.current = null;

    let isRunning = true;
    let imgEl: HTMLImageElement | null = null;
    loadImage(previewDataUrl).then((img) => {
      imgEl = img;
    });

    const startTime = performance.now();

    const loop = (timestamp: number) => {
      if (!isRunning) return;
      const canvas = mannequinCanvasRef.current;
      if (canvas && imgEl) {
        const w = 340;
        const h = 420;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, w, h);

          const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.75);
          grad.addColorStop(0, '#1e293b');
          grad.addColorStop(1, '#020617');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);

          const t = (timestamp - startTime) / 1000;
          const breathe = Math.sin(t * 1.8) * 2.5;
          const windX = Math.sin(t * 1.6) * 1.6;

          const shoulderL = { x: w / 2 - 64, y: 140 };
          const shoulderR = { x: w / 2 + 64, y: 140 };
          const chestL = { x: w / 2 - 58, y: 185 };
          const chestR = { x: w / 2 + 58, y: 185 };
          const waistL = { x: w / 2 - 48, y: 245 + breathe * 0.5 };
          const waistR = { x: w / 2 + 48, y: 245 + breathe * 0.5 };
          const sternum = { x: w / 2, y: 190 };
          const throat = { x: w / 2, y: 128 };

          ctx.fillStyle = '#334155';
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1.5;

          ctx.beginPath();
          ctx.ellipse(w / 2, 82, 23, 29, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillRect(w / 2 - 8, 110, 16, 22);

          ctx.beginPath();
          ctx.moveTo(shoulderL.x, shoulderL.y);
          ctx.lineTo(shoulderR.x, shoulderR.y);
          ctx.lineTo(waistR.x, waistR.y);
          ctx.lineTo(w / 2 + 56, 330);
          ctx.lineTo(w / 2 - 56, 330);
          ctx.lineTo(waistL.x, waistL.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          const imgW = imgEl.naturalWidth || imgEl.width || 1;
          const imgH = imgEl.naturalHeight || imgEl.height || 1;
          const aspect = imgH / imgW;

          ctx.save();
          if (
            category === 'clothing' ||
            anchorPoint === 'shoulders' ||
            anchorPoint === 'chest' ||
            anchorPoint === 'waist'
          ) {
            const anchorMode =
              anchorPoint === 'waist' ? 'waist' : anchorPoint === 'chest' ? 'chest' : 'shoulders';
            const aL = anchorMode === 'waist' ? waistL : anchorMode === 'chest' ? chestL : shoulderL;
            const aR = anchorMode === 'waist' ? waistR : anchorMode === 'chest' ? chestR : shoulderR;
            const span = Math.hypot(aR.x - aL.x, aR.y - aL.y);
            const gW =
              span *
              (anchorMode === 'shoulders' ? 1.42 : anchorMode === 'chest' ? 1.18 : 1.32) *
              defaultScale;
            const gH = Math.min(240, gW * aspect);
            const startY =
              anchorMode === 'waist'
                ? aL.y - gH * 0.06
                : anchorMode === 'chest'
                ? aL.y - gH * 0.25
                : aL.y - gH * 0.1;

            if (
              !previewClothMeshRef.current ||
              Math.abs(previewClothMeshRef.current.width - gW) > 3 ||
              Math.abs(previewClothMeshRef.current.height - gH) > 3 ||
              previewClothMeshRef.current.anchorMode !== anchorMode ||
              previewClothMeshRef.current.garmentType !== (clothingTag || subCategory)
            ) {
              previewClothMeshRef.current = createClothGrid(
                w / 2,
                startY,
                gW,
                gH,
                8,
                9,
                span,
                String(clothingTag || subCategory),
                45,
                anchorMode
              );
            }

            stepClothMesh(
              previewClothMeshRef.current,
              {
                ...DEFAULT_CLOTH_CONFIG,
                fabricType: fabricType || 'cotton',
                windStrength: 1.4,
                windTurbulence: 0.35,
              },
              aL,
              aR,
              sternum,
              { x: windX, y: breathe * 0.12 },
              breathe
            );

            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = 12;
            ctx.shadowOffsetY = 6;
            renderClothMesh(ctx, imgEl, previewClothMeshRef.current, previewMeshWireframe, false);
          } else if (anchorPoint === 'neck') {
            const nW = 86 * defaultScale;
            const nH = nW * aspect;
            if (!previewPendantRef.current) {
              previewPendantRef.current = createPendantPhysics(throat, throat, nW * 0.65, 6);
            }
            stepPendantPhysics(previewPendantRef.current, throat, throat, { x: windX, y: 0 }, 0.94);
            const midPt =
              previewPendantRef.current.links[
                Math.floor(previewPendantRef.current.links.length / 2)
              ];
            ctx.translate(midPt.x, midPt.y - nH * 0.2);
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 8;
            ctx.drawImage(imgEl, -nW / 2, 0, nW, nH);
          } else if (anchorPoint === 'head') {
            const hW = 92 * defaultScale;
            const hH = hW * aspect;
            const isGlasses = subCategory === 'glasses';
            ctx.translate(w / 2, isGlasses ? 78 : 54);
            ctx.drawImage(imgEl, -hW / 2, isGlasses ? -hH * 0.5 : -hH * 0.65, hW, hH);
          } else if (anchorPoint === 'wrist') {
            const rW = 54 * defaultScale;
            const rH = rW * aspect;
            ctx.translate(w / 2 - 74, 245);
            ctx.drawImage(imgEl, -rW / 2, -rH / 2, rW, rH);
          } else if (anchorPoint === 'ears') {
            const eW = 28 * defaultScale;
            const eH = eW * aspect;
            ctx.drawImage(imgEl, w / 2 - 28 - eW / 2, 84, eW, eH);
            ctx.drawImage(imgEl, w / 2 + 28 - eW / 2, 84, eW, eH);
          }
          ctx.restore();
        }
      }
      mannequinAnimRef.current = requestAnimationFrame(loop);
    };

    mannequinAnimRef.current = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      if (mannequinAnimRef.current) cancelAnimationFrame(mannequinAnimRef.current);
    };
  }, [
    activeStep,
    previewDataUrl,
    category,
    subCategory,
    clothingTag,
    anchorPoint,
    fabricType,
    defaultScale,
    previewMeshWireframe,
  ]);

  // Save asset with tight transparent cutout, tag & physics configuration
  const handleSaveAsset = () => {
    let finalUrl = previewDataUrl;
    if (workingCanvasRef.current && maskCanvasRef.current) {
      const trimmed = extractTrimmedTransparentCutout(
        workingCanvasRef.current,
        maskCanvasRef.current,
        4
      );
      finalUrl = exportTransparentAssetDataUrl(trimmed.canvas);
    }
    if (!finalUrl) return;

    const finalTagId = category === 'clothing' ? clothingTag : String(subCategory);
    const matchedTagLabel =
      allClothingTags.find((t) => t.id === finalTagId)?.label ||
      finalTagId.charAt(0).toUpperCase() + finalTagId.slice(1);

    const finalTags = Array.from(
      new Set([matchedTagLabel, ...tags].map((t) => t.trim()).filter(Boolean))
    );

    const newId = `custom-asset-${Date.now()}`;
    const newAsset: WardrobeAsset = {
      id: newId,
      name: assetName.trim() || `Custom ${matchedTagLabel}`,
      category,
      subCategory: finalTagId,
      clothingTag: category === 'clothing' ? finalTagId : undefined,
      imageUrl: finalUrl,
      anchorPoint,
      defaultScale,
      tags: finalTags,
      brand: 'Custom Atelier',
      isCustom: true,
      customCreatedAt: Date.now(),
      fabricType: category === 'clothing' ? fabricType : undefined,
    };

    addWardrobeAsset(newAsset);
    if (onAssetAdded) onAssetAdded(newId);

    setShowCustomAssetModal(false);
    setActiveStep('source');
    setRawImageUrl(null);
    setPreviewDataUrl(null);
    workingCanvasRef.current = null;
    maskCanvasRef.current = null;
  };

  if (!showCustomAssetModal) return null;

  const activeBrushConfig = activeTool === 'brush' ? brushSettings : eraseSettings;
  const setActiveBrushConfig = (patch: Partial<BrushToolSettings>) => {
    if (activeTool === 'brush') {
      setBrushSettings((prev) => ({ ...prev, ...patch }));
    } else if (activeTool === 'erase') {
      setEraseSettings((prev) => ({ ...prev, ...patch }));
    }
  };

  const screenDiameter = getScreenCursorDiameter();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-5xl max-h-[94vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-rose-500 to-indigo-600 text-white shadow-md shrink-0">
              <Scissors className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                Scan &amp; Cutout Clothe, Jewelry &amp; Object Assets
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                Picsart-style Cutout Clothe outline with manual Brush &amp; Erase hardness and overlay controls
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopActiveStream();
              setShowCustomAssetModal(false);
            }}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress Tabs */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/40 px-4 sm:px-6 py-2 gap-2 overflow-x-auto no-scrollbar">
          {[
            { id: 'source', label: '1. Capture / Select', icon: Camera },
            { id: 'segment', label: '2. Cutout Clothe & Touch-Up', icon: Scissors },
            { id: 'configure', label: '3. Tag, Mesh & Fit', icon: Sliders },
          ].map((s) => {
            const Icon = s.icon;
            const isActive = activeStep === s.id;
            const isCompleted =
              (s.id === 'source' && (activeStep === 'segment' || activeStep === 'configure')) ||
              (s.id === 'segment' && activeStep === 'configure');
            return (
              <button
                key={s.id}
                disabled={s.id !== 'source' && !rawImageUrl}
                onClick={() => {
                  if (s.id === 'configure') refreshFinalTrimmedExport();
                  setActiveStep(s.id as 'source' | 'segment' | 'configure');
                }}
                className={`flex items-center gap-2 py-2 px-3.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : isCompleted
                    ? 'text-slate-600 dark:text-slate-300 hover:text-indigo-500'
                    : 'text-slate-400 cursor-not-allowed opacity-60'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* STEP 1: CAPTURE / SOURCE SELECTION */}
          {activeStep === 'source' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => setSourceType('camera')}
                  className={`p-4 rounded-2xl border text-center transition-all flex flex-col items-center gap-2 ${
                    sourceType === 'camera'
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-500">
                    <Camera className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-sm">Live Camera Scan</span>
                  <span className="text-[11px] text-slate-500">
                    Snap a shirt, suit, bikini, jewelry or object
                  </span>
                </button>

                <button
                  onClick={() => setSourceType('upload')}
                  className={`p-4 rounded-2xl border text-center transition-all flex flex-col items-center gap-2 ${
                    sourceType === 'upload'
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
                    <Upload className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-sm">Upload from Gallery</span>
                  <span className="text-[11px] text-slate-500">
                    Full photo loaded for Cutout Clothe &amp; Brush editing
                  </span>
                </button>

                <button
                  onClick={() => setSourceType('samples')}
                  className={`p-4 rounded-2xl border text-center transition-all flex flex-col items-center gap-2 ${
                    sourceType === 'samples'
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-sm">Sample Presets</span>
                  <span className="text-[11px] text-slate-500">
                    Test Cutout Clothe, Brush &amp; Physics Mesh instantly
                  </span>
                </button>
              </div>

              {sourceType === 'camera' && (
                <div className="relative flex flex-col items-center justify-center bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 min-h-[360px]">
                  {cameraError ? (
                    <div className="p-6 text-center text-rose-400 space-y-3">
                      <p className="font-semibold text-sm">{cameraError}</p>
                      <button
                        onClick={() => setSourceType('upload')}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
                      >
                        Switch to File Upload
                      </button>
                    </div>
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className={`w-full max-h-[400px] object-contain ${
                          facingMode === 'user' ? 'scale-x-[-1]' : ''
                        }`}
                      />
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                        <div className="w-60 h-68 border-2 border-dashed border-rose-400/80 rounded-3xl flex flex-col items-center justify-between p-4 bg-black/10">
                          <span className="text-[11px] font-bold text-rose-300 bg-black/65 px-2.5 py-0.5 rounded-full">
                            Frame Cloth or Item
                          </span>
                          <span className="text-[10px] text-white/85 bg-black/55 px-2.5 py-1 rounded text-center">
                            Next step opens Cutout Clothe outline, Brush &amp; Erase tools
                          </span>
                        </div>
                      </div>
                      <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-4">
                        <button
                          onClick={() =>
                            setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
                          }
                          className="p-3 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 backdrop-blur-md"
                          title="Switch Camera"
                        >
                          <RotateCw className="w-5 h-5" />
                        </button>
                        <button
                          onClick={handleCaptureCamera}
                          className="px-6 py-3 rounded-full bg-gradient-to-r from-rose-500 to-indigo-600 hover:brightness-110 text-white font-bold text-sm shadow-xl flex items-center gap-2 whitespace-nowrap"
                        >
                          <Camera className="w-4 h-4 shrink-0" />
                          <span>Capture &amp; Cutout</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {sourceType === 'upload' && (
                <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-3xl p-10 text-center hover:border-indigo-500 transition-colors bg-slate-50/50 dark:bg-slate-950/40">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-4">
                    <Upload className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                    Select a cloth, jewelry, or object photo
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
                    Your full photo opens intact in the Cutout Studio — trace your clothe outline directly or refine cleanly with Brush &amp; Erase.
                  </p>
                  <label className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer shadow-lg">
                    <Upload className="w-4 h-4" />
                    Browse Photo Gallery / Files
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              )}

              {sourceType === 'samples' && (
                <div className="space-y-3">
                  <span className="text-xs font-semibold text-slate-500">
                    Pick a sample to open in Cutout Clothe &amp; Brush Studio:
                  </span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      {
                        name: 'Tailored Midnight Suit',
                        url: blazerUrl,
                        category: 'clothing' as const,
                        sub: 'suit',
                        anchor: 'shoulders' as const,
                        mat: 'wool' as const,
                        tag: 'Suit · Tailored Mesh',
                      },
                      {
                        name: 'Royal Silk Kimono Robe',
                        url: kimonoUrl,
                        category: 'clothing' as const,
                        sub: 'robe',
                        anchor: 'shoulders' as const,
                        mat: 'silk' as const,
                        tag: 'Robe · Fluid Silk',
                      },
                      {
                        name: 'Colombian Emerald Pendant',
                        url: emeraldPendantUrl,
                        category: 'jewelry' as const,
                        sub: 'necklace',
                        anchor: 'neck' as const,
                        mat: undefined,
                        tag: 'Jewelry · Pendulum',
                      },
                      {
                        name: 'Solitaire Gold Necklace',
                        url: goldNecklaceUrl,
                        category: 'jewelry' as const,
                        sub: 'necklace',
                        anchor: 'neck' as const,
                        mat: undefined,
                        tag: '18K Gold Necklace',
                      },
                    ].map((sample) => (
                      <button
                        key={sample.name}
                        onClick={() =>
                          handleSelectSample(
                            sample.url,
                            sample.name,
                            sample.category,
                            sample.sub,
                            sample.anchor,
                            sample.mat
                          )
                        }
                        className="group relative p-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-left hover:border-indigo-500 transition-all overflow-hidden flex flex-col"
                      >
                        <div className="aspect-square w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-950 mb-2">
                          <img
                            src={sample.url}
                            alt={sample.name}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate block">
                          {sample.name}
                        </span>
                        <span className="text-[10px] text-indigo-500 font-semibold">{sample.tag}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: PICSART-STYLE CUTOUT CLOTHE + BRUSH & ERASE STUDIO */}
          {activeStep === 'segment' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Interactive Cutout Canvas */}
              <div className="lg:col-span-2 flex flex-col items-center justify-center p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 min-h-[380px] relative overflow-hidden">
                <div
                  className={`relative w-full h-[360px] sm:h-[420px] flex items-center justify-center rounded-xl overflow-hidden select-none ${
                    canvasBgPreview === 'checker'
                      ? 'bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] bg-[size:14px_14px]'
                      : canvasBgPreview === 'dark'
                      ? 'bg-slate-950'
                      : 'bg-white'
                  }`}
                >
                  <canvas
                    ref={displayCanvasRef}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={finishPointerStroke}
                    onPointerCancel={finishPointerStroke}
                    onPointerLeave={(e) => {
                      setCursorRing((prev) => ({ ...prev, visible: false }));
                      if (isDrawingRef.current) finishPointerStroke(e);
                    }}
                    className={`max-w-full max-h-[345px] sm:max-h-[405px] object-contain shadow-lg touch-none ${
                      activeTool === 'outline' ? 'cursor-crosshair' : 'cursor-none'
                    }`}
                  />

                  {/* Live Brush / Erase Hardness & Size Ring Cursor */}
                  {cursorRing.visible && (activeTool === 'brush' || activeTool === 'erase') && (
                    <div
                      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm"
                      style={{
                        left: `${cursorRing.x}px`,
                        top: `${cursorRing.y}px`,
                        width: `${Math.max(8, screenDiameter)}px`,
                        height: `${Math.max(8, screenDiameter)}px`,
                        borderColor: activeTool === 'brush' ? '#10b981' : '#f43f5e',
                        background:
                          activeTool === 'brush'
                            ? `radial-gradient(circle, rgba(16,185,129,0.28) ${Math.round(
                                activeBrushConfig.hardness * 0.9
                              )}%, rgba(16,185,129,0) 100%)`
                            : `radial-gradient(circle, rgba(244,63,94,0.28) ${Math.round(
                                activeBrushConfig.hardness * 0.9
                              )}%, rgba(244,63,94,0) 100%)`,
                      }}
                    />
                  )}
                </div>

                {/* Top Status & Canvas Backdrop / Peek Final Controls */}
                <div className="w-full mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-slate-900/80 dark:bg-black/70 px-2.5 py-1 rounded-lg border border-slate-700/60 text-[10px] font-mono text-emerald-300 tabular-nums">
                      {cutoutDimensions ? `${cutoutDimensions.w} × ${cutoutDimensions.h} px` : 'Ready'}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {activeTool === 'outline'
                        ? 'Trace around cloth & release to cutout'
                        : activeTool === 'brush'
                        ? 'Drag to paint/keep cloth pixels'
                        : 'Drag to erase unwanted regions'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPeekPureCutout((v) => !v)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border flex items-center gap-1 transition-colors whitespace-nowrap ${
                        peekPureCutout
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                      }`}
                      title="Toggle between Picsart Overlay view and pure transparent cutout"
                    >
                      <Eye className="w-3 h-3 shrink-0" />
                      <span>{peekPureCutout ? 'Final Alpha' : 'Overlay On'}</span>
                    </button>

                    <div className="flex items-center gap-0.5 bg-slate-200/80 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-300/60 dark:border-slate-800">
                      {(['checker', 'dark', 'light'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setCanvasBgPreview(mode)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors ${
                            canvasBgPreview === mode
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Picsart Cutout Clothe + Brush & Erase Tool Panel */}
              <div className="space-y-3.5 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 flex flex-col justify-between">
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <Scissors className="w-4 h-4 text-rose-500 shrink-0" />
                      <span>Cutout Clothe Studio</span>
                    </h4>

                    <button
                      type="button"
                      onClick={handleSmartClotheCutout}
                      className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-rose-500 to-indigo-600 hover:brightness-110 text-white text-[10px] font-bold flex items-center gap-1 shadow-xs whitespace-nowrap shrink-0"
                      title="1-tap smart clothe seed around centered garment (editable with Brush & Erase)"
                    >
                      <Sparkles className="w-3 h-3 shrink-0" />
                      <span>Auto Clothe</span>
                    </button>
                  </div>

                  {/* Primary 3 Cutout Tools: Outline Clothe | Manual Brush | Manual Erase */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTool('outline');
                        setPeekPureCutout(false);
                      }}
                      className={`py-2 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all whitespace-nowrap ${
                        activeTool === 'outline'
                          ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 ring-2 ring-rose-500/20'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-rose-400'
                      }`}
                    >
                      <Scissors className="w-4 h-4 shrink-0" />
                      <span>Outline</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTool('brush');
                        setPeekPureCutout(false);
                      }}
                      className={`py-2 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all whitespace-nowrap ${
                        activeTool === 'brush'
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-emerald-400'
                      }`}
                    >
                      <Paintbrush className="w-4 h-4 shrink-0" />
                      <span>Brush</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTool('erase');
                        setPeekPureCutout(false);
                      }}
                      className={`py-2 px-2 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all whitespace-nowrap ${
                        activeTool === 'erase'
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-300 ring-2 ring-amber-500/20'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-amber-400'
                      }`}
                    >
                      <Eraser className="w-4 h-4 shrink-0" />
                      <span>Erase</span>
                    </button>
                  </div>

                  {/* OUTLINE / CUTOUT CLOTHE SETTINGS */}
                  {activeTool === 'outline' && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                          Cutout Clothe Mode
                        </span>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { id: 'replace' as const, label: 'Cut Clothe' },
                            { id: 'add' as const, label: '+ Add Part' },
                            { id: 'subtract' as const, label: '− Cut Area' },
                          ].map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setLassoMode(m.id)}
                              className={`py-1.5 px-1.5 rounded-lg text-[10px] font-bold border transition-all whitespace-nowrap ${
                                lassoMode === m.id
                                  ? 'bg-rose-600 border-rose-500 text-white'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Outline Edge Hardness</span>
                          <span className="font-mono font-bold text-rose-500 tabular-nums">
                            {outlineHardness}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          step="2"
                          value={outlineHardness}
                          onChange={(e) => setOutlineHardness(Number(e.target.value))}
                          className="w-full accent-rose-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer touch-pan-x"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Outline Mask Overlay</span>
                          <span className="font-mono font-bold text-rose-500 tabular-nums">
                            {outlineOverlay}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="2"
                          value={outlineOverlay}
                          onChange={(e) => {
                            setPeekPureCutout(false);
                            setOutlineOverlay(Number(e.target.value));
                          }}
                          className="w-full accent-rose-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer touch-pan-x"
                        />
                      </div>
                    </div>
                  )}

                  {/* MANUAL BRUSH & MANUAL ERASE SETTINGS (SIZE + HARDNESS + OVERLAY) */}
                  {(activeTool === 'brush' || activeTool === 'erase') && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                          {activeTool === 'brush'
                            ? 'Manual Brush Touch-Up'
                            : 'Manual Erase Touch-Up'}
                        </span>
                        {/* Live radial hardness preview dot */}
                        <div
                          className="w-5 h-5 rounded-full border border-slate-400/50 shrink-0"
                          style={{
                            background:
                              activeTool === 'brush'
                                ? `radial-gradient(circle, #10b981 ${Math.round(
                                    activeBrushConfig.hardness * 0.9
                                  )}%, transparent 100%)`
                                : `radial-gradient(circle, #f43f5e ${Math.round(
                                    activeBrushConfig.hardness * 0.9
                                  )}%, transparent 100%)`,
                          }}
                          title="Brush Edge Falloff Preview"
                        />
                      </div>

                      {/* Size */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>{activeTool === 'brush' ? 'Brush Size' : 'Erase Size'}</span>
                          <span className="font-mono font-bold text-indigo-500 tabular-nums">
                            {activeBrushConfig.size} px
                          </span>
                        </div>
                        <input
                          type="range"
                          min="4"
                          max="72"
                          step="2"
                          value={activeBrushConfig.size}
                          onChange={(e) => setActiveBrushConfig({ size: Number(e.target.value) })}
                          className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer touch-pan-x"
                        />
                      </div>

                      {/* Hardness */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>{activeTool === 'brush' ? 'Brush Hardness' : 'Erase Hardness'}</span>
                          <span className="font-mono font-bold text-emerald-500 tabular-nums">
                            {activeBrushConfig.hardness}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="2"
                          value={activeBrushConfig.hardness}
                          onChange={(e) =>
                            setActiveBrushConfig({ hardness: Number(e.target.value) })
                          }
                          className="w-full accent-emerald-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer touch-pan-x"
                        />
                      </div>

                      {/* Overlay */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>{activeTool === 'brush' ? 'Brush Overlay' : 'Erase Overlay'}</span>
                          <span className="font-mono font-bold text-rose-500 tabular-nums">
                            {activeBrushConfig.overlay}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="2"
                          value={activeBrushConfig.overlay}
                          onChange={(e) => {
                            setPeekPureCutout(false);
                            setActiveBrushConfig({ overlay: Number(e.target.value) });
                          }}
                          className="w-full accent-rose-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer touch-pan-x"
                        />
                      </div>
                    </div>
                  )}

                  {/* Overlay Tint Selector + Mask Actions */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        Overlay Tint Color
                      </span>
                      <div className="flex items-center gap-1.5">
                        {[
                          { id: 'rose' as const, bg: 'bg-rose-500', label: 'Red Overlay' },
                          { id: 'indigo' as const, bg: 'bg-indigo-500', label: 'Indigo Overlay' },
                          { id: 'emerald' as const, bg: 'bg-emerald-500', label: 'Green Overlay' },
                        ].map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setPeekPureCutout(false);
                              setOverlayTint(t.id);
                            }}
                            title={t.label}
                            className={`w-5 h-5 rounded-full ${t.bg} border-2 transition-transform ${
                              overlayTint === t.id
                                ? 'border-white ring-2 ring-indigo-500 scale-110'
                                : 'border-transparent opacity-70 hover:opacity-100'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handleMaskQuickAction('all')}
                        className="py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:border-indigo-400 flex items-center justify-center gap-1 whitespace-nowrap"
                        title="Select Full Image"
                      >
                        <CheckSquare className="w-3 h-3 shrink-0" />
                        <span>Select All</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMaskQuickAction('invert')}
                        className="py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:border-indigo-400 flex items-center justify-center gap-1 whitespace-nowrap"
                        title="Invert Selected & Excluded Area"
                      >
                        <Contrast className="w-3 h-3 shrink-0" />
                        <span>Invert</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMaskQuickAction('clear')}
                        className="py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:border-rose-400 flex items-center justify-center gap-1 whitespace-nowrap"
                        title="Clear Mask to Paint Clothe with Brush"
                      >
                        <Square className="w-3 h-3 shrink-0" />
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bottom Undo & Reset */}
                <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleUndoMask}
                    disabled={undoCount === 0}
                    className={`text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap ${
                      undoCount > 0
                        ? 'text-slate-700 dark:text-slate-200 hover:text-indigo-500'
                        : 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                    }`}
                  >
                    <Undo2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Undo{undoCount > 0 ? ` (${undoCount})` : ''}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMaskQuickAction('reset')}
                    className="text-[11px] font-semibold text-slate-500 hover:text-indigo-400 flex items-center gap-1 whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>Reset Cutout</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CATEGORY, CLOTHING TAG / CREATE NEW TAG, ANCHOR & MESH PHYSICS */}
          {activeStep === 'configure' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Asset Configuration */}
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Asset Display Name
                  </label>
                  <input
                    type="text"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder="e.g. Tailored Black Suit, Summer Bikini, Gold Watch"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-900 dark:text-white focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                {/* Primary Asset Category: Cloth | Jewelry | Object | Accessory */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Asset Category
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { id: 'clothing' as const, label: 'Cloth', icon: Shirt },
                      { id: 'jewelry' as const, label: 'Jewelry', icon: Gem },
                      { id: 'object' as const, label: 'Object', icon: Package },
                      { id: 'accessory' as const, label: 'Accessory', icon: Glasses },
                    ].map((c) => {
                      const Icon = c.icon;
                      return (
                        <button
                          key={c.id}
                          onClick={() => handleCategorySwitch(c.id)}
                          className={`py-2 px-1.5 rounded-xl text-[11px] font-bold border transition-all flex items-center justify-center gap-1 ${
                            category === c.id
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-xs'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* CLOTHING TYPE TAG PICKER + CREATE CUSTOM TAG */}
                {category === 'clothing' && (
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-indigo-500" />
                        Cloth Type / Wardrobe Tab Tag
                      </span>
                      <span className="text-[10px] font-mono text-indigo-500 capitalize">
                        {clothingTag}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {allClothingTags.map((tagDef) => {
                        const isSelected = clothingTag === tagDef.id;
                        return (
                          <button
                            key={tagDef.id}
                            type="button"
                            onClick={() => handleSelectClothingTag(tagDef)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                              isSelected
                                ? 'border-indigo-500 bg-indigo-600 text-white shadow-xs'
                                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
                            }`}
                          >
                            {tagDef.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="pt-1.5 border-t border-slate-200/70 dark:border-slate-800">
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                        Not in list? Create a new clothing category tag:
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newClothingTagInput}
                          onChange={(e) => setNewClothingTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCreateCustomClothingTag();
                            }
                          }}
                          placeholder="e.g. Kurta, Saree, Gown, Tracksuit"
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-hidden focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={handleCreateCustomClothingTag}
                          disabled={!newClothingTagInput.trim()}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-bold flex items-center gap-1 shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Create Tag
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* JEWELRY / OBJECT SUBTYPE QUICK PICKER */}
                {category !== 'clothing' && (
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                      {category === 'jewelry' ? 'Jewelry Type' : 'Object / Accessory Type'}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(category === 'jewelry' ? JEWELRY_SUBTYPES : OBJECT_SUBTYPES).map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            setSubCategory(sub.id);
                            setAnchorPoint(sub.anchor);
                            setDefaultScale(sub.scale);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                            subCategory === sub.id
                              ? 'border-indigo-500 bg-indigo-600 text-white'
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Body Anchor & Fabric Physics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Body Anchor Point
                    </label>
                    <select
                      value={anchorPoint}
                      onChange={(e) => setAnchorPoint(e.target.value as WardrobeAsset['anchorPoint'])}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-200"
                    >
                      <option value="shoulders">Shoulders / Full Torso (Cloth Mesh)</option>
                      <option value="chest">Chest / Bust Line (Bikini / Top Mesh)</option>
                      <option value="waist">Waist / Hips (Skirt / Pants / Belt Mesh)</option>
                      <option value="neck">Neck / Collarbone (Pendulum)</option>
                      <option value="head">Head / Face (Hat / Glasses / Crown)</option>
                      <option value="wrist">Wrist / Hand (Watch / Bag / Prop)</option>
                      <option value="ears">Ears (Earrings)</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      <span>Body Proportion Scale</span>
                      <span className="font-mono text-indigo-500 tabular-nums">
                        {defaultScale.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.3"
                      max="1.8"
                      step="0.02"
                      value={defaultScale}
                      onChange={(e) => setDefaultScale(Number(e.target.value))}
                      className="w-full accent-indigo-500 h-1.5 mt-2 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer touch-pan-x"
                    />
                  </div>
                </div>

                {/* Fabric Material Physics */}
                {category === 'clothing' && (
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Wind className="w-3.5 h-3.5 text-cyan-400" />
                      Cloth Mesh Material &amp; Physics
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { id: 'silk', label: 'Silk', desc: 'Fluid drape' },
                        { id: 'cotton', label: 'Cotton', desc: 'Balanced fit' },
                        { id: 'wool', label: 'Wool', desc: 'Tailored suit' },
                        { id: 'leather', label: 'Leather', desc: 'Structured' },
                      ].map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setFabricType(f.id as WardrobeAsset['fabricType'])}
                          className={`p-1.5 rounded-xl border text-center transition-all ${
                            fabricType === f.id
                              ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-300 font-bold'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <span className="block text-[11px] font-bold">{f.label}</span>
                          <span className="block text-[9px] text-slate-400">{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Asset Tags List */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Stored Asset Tags
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold border border-indigo-500/20"
                      >
                        #{t}
                        <button
                          type="button"
                          onClick={() => setTags((prev) => prev.filter((item) => item !== t))}
                          className="hover:text-rose-500"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                        placeholder="+ Add tag"
                        className="w-24 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-700 dark:text-slate-200"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Cloth Mesh & Physics Mannequin Preview */}
              <div className="flex flex-col items-center justify-center p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 min-h-[360px] relative overflow-hidden">
                <div className="absolute top-3 inset-x-4 flex items-center justify-between text-[11px] font-semibold text-cyan-400">
                  <span className="flex items-center gap-1.5">
                    <Wind className="w-3.5 h-3.5" />
                    Live Cloth Mesh &amp; Physics Preview
                  </span>
                  {category === 'clothing' && (
                    <button
                      type="button"
                      onClick={() => setPreviewMeshWireframe((v) => !v)}
                      className={`px-2 py-0.5 rounded text-[10px] border flex items-center gap-1 ${
                        previewMeshWireframe
                          ? 'border-cyan-500 bg-cyan-950/70 text-cyan-300'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      <Layers className="w-3 h-3" />
                      Mesh
                    </button>
                  )}
                </div>
                <canvas ref={mannequinCanvasRef} className="rounded-xl shadow-2xl max-w-full" />
                <span className="mt-2 text-[10px] text-slate-400">
                  {category === 'clothing'
                    ? '2D Verlet mass-spring cloth mesh anchored to scanned body landmarks'
                    : 'Proportional body landmark anchor & dynamic physics preview'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div>
            {activeStep !== 'source' && (
              <button
                onClick={() => {
                  if (activeStep === 'configure') setActiveStep('segment');
                  else if (activeStep === 'segment') setActiveStep('source');
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                stopActiveStream();
                setShowCustomAssetModal(false);
              }}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 whitespace-nowrap"
            >
              Cancel
            </button>

            {activeStep === 'segment' && (
              <button
                onClick={() => {
                  refreshFinalTrimmedExport();
                  setActiveStep('configure');
                }}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md flex items-center gap-2 whitespace-nowrap"
              >
                Configure Tag &amp; Mesh →
              </button>
            )}

            {activeStep === 'configure' && (
              <button
                onClick={handleSaveAsset}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 hover:brightness-110 text-white text-xs font-bold shadow-xl flex items-center gap-2 whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>Save Asset &amp; Mesh</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
