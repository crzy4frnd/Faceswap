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
  Pipette,
  Plus,
  Package,
  Glasses,
  Tag,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { WardrobeAsset, WardrobeCategory } from '../types/body';
import {
  segmentAssetDetailed,
  applyBrushToCanvas,
  exportTransparentAssetDataUrl,
  SegmentationOptions,
  SegmentationResult,
  DEFAULT_SEGMENTATION_OPTIONS,
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

const JEWELRY_SUBTYPES: { id: WardrobeAsset['subCategory']; label: string; anchor: WardrobeAsset['anchorPoint']; scale: number }[] = [
  { id: 'necklace', label: 'Necklace', anchor: 'neck', scale: 0.65 },
  { id: 'watch', label: 'Watch', anchor: 'wrist', scale: 0.4 },
  { id: 'bracelet', label: 'Bracelet', anchor: 'wrist', scale: 0.42 },
  { id: 'earrings', label: 'Earrings', anchor: 'ears', scale: 0.55 },
  { id: 'ring', label: 'Ring', anchor: 'wrist', scale: 0.35 },
];

const OBJECT_SUBTYPES: { id: WardrobeAsset['subCategory']; label: string; anchor: WardrobeAsset['anchorPoint']; scale: number }[] = [
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

  // Source & Segmentation buffers
  const rawImageRef = useRef<HTMLImageElement | null>(null);
  const segResultRef = useRef<SegmentationResult | null>(null);
  const [rawImageUrl, setRawImageUrl] = useState<string | null>(null);

  const segmentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [cutoutDimensions, setCutoutDimensions] = useState<{ w: number; h: number } | null>(null);

  // Segmentation options & brush tools
  const [segOptions, setSegOptions] = useState<SegmentationOptions>(DEFAULT_SEGMENTATION_OPTIONS);
  const [brushMode, setBrushMode] = useState<'none' | 'erase' | 'restore' | 'eyedropper'>('none');
  const [brushRadius, setBrushRadius] = useState<number>(22);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasBgPreview, setCanvasBgPreview] = useState<'checker' | 'dark' | 'light'>('checker');

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
      setBrushMode('none');
      setCameraError(null);
      setSegOptions(DEFAULT_SEGMENTATION_OPTIONS);
      setRawImageUrl(null);
      setPreviewDataUrl(null);
      setCutoutDimensions(null);
      rawImageRef.current = null;
      segResultRef.current = null;
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

  // Paint segmented canvas result whenever Step 2 mounts or segmentation updates
  const syncCanvasFromSegResult = useCallback((result: SegmentationResult) => {
    const dest = segmentCanvasRef.current;
    if (dest) {
      dest.width = result.canvas.width;
      dest.height = result.canvas.height;
      const sctx = dest.getContext('2d', { willReadFrequently: true });
      if (sctx) {
        sctx.clearRect(0, 0, dest.width, dest.height);
        sctx.drawImage(result.canvas, 0, 0);
      }
    }
    setCutoutDimensions({ w: result.canvas.width, h: result.canvas.height });
    setPreviewDataUrl(exportTransparentAssetDataUrl(result.canvas));
  }, []);

  useEffect(() => {
    if (activeStep === 'segment' && segResultRef.current && segmentCanvasRef.current) {
      syncCanvasFromSegResult(segResultRef.current);
    }
  }, [activeStep, syncCanvasFromSegResult]);

  // Execute segmentation on source image
  const processSegmentation = useCallback(
    (sourceImg: HTMLImageElement, opts: SegmentationOptions) => {
      const w = sourceImg.naturalWidth || sourceImg.width;
      const h = sourceImg.naturalHeight || sourceImg.height;
      if (!w || !h) return;

      const offCanvas = document.createElement('canvas');
      offCanvas.width = w;
      offCanvas.height = h;
      const octx = offCanvas.getContext('2d');
      if (!octx) return;
      octx.drawImage(sourceImg, 0, 0, w, h);

      const result = segmentAssetDetailed(offCanvas, opts);
      segResultRef.current = result;
      syncCanvasFromSegResult(result);
    },
    [syncCanvasFromSegResult]
  );

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
      processSegmentation(img, segOptions);
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
        processSegmentation(img, segOptions);
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
      processSegmentation(img, segOptions);
      setActiveStep('segment');
    });
  };

  const updateSegOptionsAndRun = (partial: Partial<SegmentationOptions>) => {
    const updated = { ...segOptions, ...partial };
    setSegOptions(updated);
    if (rawImageRef.current) {
      processSegmentation(rawImageRef.current, updated);
    }
  };

  // Canvas interaction: manual brush or eyedropper background pick
  const applyPointerOnCanvas = (e: React.PointerEvent<HTMLCanvasElement>, isClickStart: boolean) => {
    const canvas = segmentCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.max(0, Math.min(canvas.width - 1, (e.clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(canvas.height - 1, (e.clientY - rect.top) * scaleY));

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    if (brushMode === 'eyedropper' && isClickStart && segResultRef.current) {
      // Sample color from the original un-erased workingCanvas at the cropped coordinates
      const crop = segResultRef.current.cropRect;
      const wCtx = segResultRef.current.workingCanvas.getContext('2d', { willReadFrequently: true });
      if (wCtx) {
        const sx = Math.max(0, Math.min(segResultRef.current.workingCanvas.width - 1, Math.round(crop.x + x)));
        const sy = Math.max(0, Math.min(segResultRef.current.workingCanvas.height - 1, Math.round(crop.y + y)));
        const px = wCtx.getImageData(sx, sy, 1, 1).data;
        updateSegOptionsAndRun({ customBgColor: { r: px[0], g: px[1], b: px[2] } });
        setBrushMode('none');
      }
      return;
    }

    if ((brushMode === 'erase' || brushMode === 'restore') && (isDrawing || isClickStart)) {
      const seg = segResultRef.current;
      applyBrushToCanvas(
        ctx,
        x,
        y,
        brushRadius,
        brushMode,
        seg?.workingCanvas || rawImageRef.current || undefined,
        seg?.cropRect || { x: 0, y: 0 }
      );
      if (seg) {
        const sctx = seg.canvas.getContext('2d');
        if (sctx) {
          sctx.clearRect(0, 0, seg.canvas.width, seg.canvas.height);
          sctx.drawImage(canvas, 0, 0);
        }
      }
      setPreviewDataUrl(canvas.toDataURL('image/png'));
    }
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
      setTags((prev) => [tagDef.label, ...prev.filter((p) => !allClothingTags.some((a) => a.label === p))]);
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

          // Mannequin skeletal landmarks
          const shoulderL = { x: w / 2 - 64, y: 140 };
          const shoulderR = { x: w / 2 + 64, y: 140 };
          const chestL = { x: w / 2 - 58, y: 185 };
          const chestR = { x: w / 2 + 58, y: 185 };
          const waistL = { x: w / 2 - 48, y: 245 + breathe * 0.5 };
          const waistR = { x: w / 2 + 48, y: 245 + breathe * 0.5 };
          const sternum = { x: w / 2, y: 190 };
          const throat = { x: w / 2, y: 128 };

          // Mannequin silhouette
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
            const gW = span * (anchorMode === 'shoulders' ? 1.42 : anchorMode === 'chest' ? 1.18 : 1.32) * defaultScale;
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
            const midPt = previewPendantRef.current.links[Math.floor(previewPendantRef.current.links.length / 2)];
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

  // Save asset with tag & physics configuration
  const handleSaveAsset = () => {
    if (!previewDataUrl) return;

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
      imageUrl: previewDataUrl,
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
    segResultRef.current = null;
  };

  if (!showCustomAssetModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 text-white shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Scan &amp; Create Cloth, Jewelry &amp; Object Assets
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Edge-clean cutout, tag by clothing category (or create custom tags), and build a body-fitted cloth mesh
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopActiveStream();
              setShowCustomAssetModal(false);
            }}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress Tabs */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/40 px-6 py-2 gap-2 overflow-x-auto">
          {[
            { id: 'source', label: '1. Capture / Select', icon: Camera },
            { id: 'segment', label: '2. Clean Edge Cutout', icon: Scissors },
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
                onClick={() => setActiveStep(s.id as 'source' | 'segment' | 'configure')}
                className={`flex items-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : isCompleted
                    ? 'text-slate-600 dark:text-slate-300 hover:text-indigo-500'
                    : 'text-slate-400 cursor-not-allowed opacity-60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 1: CAPTURE / SOURCE SELECTION */}
          {activeStep === 'source' && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-3">
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
                  <span className="text-[11px] text-slate-500">Snap suit, shirt, bikini, jewelry or object</span>
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
                  <span className="text-[11px] text-slate-500">JPG, WEBP, or transparent PNG</span>
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
                  <span className="text-[11px] text-slate-500">Test cutout &amp; physics mesh instantly</span>
                </button>
              </div>

              {sourceType === 'camera' && (
                <div className="relative flex flex-col items-center justify-center bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 min-h-[380px]">
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
                        className={`w-full max-h-[420px] object-contain ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                      />
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                        <div className="w-64 h-72 border-2 border-dashed border-amber-400/80 rounded-3xl flex flex-col items-center justify-between p-4 bg-black/10">
                          <span className="text-[11px] font-bold text-amber-300 bg-black/60 px-2.5 py-0.5 rounded-full">
                            Center Item Inside Frame
                          </span>
                          <span className="text-[10px] text-white/80 bg-black/50 px-2 py-0.5 rounded text-center">
                            Place on a plain wall or table for cleanest edge cutout
                          </span>
                        </div>
                      </div>
                      <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-4">
                        <button
                          onClick={() => setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))}
                          className="p-3 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 backdrop-blur-md"
                          title="Switch Camera"
                        >
                          <RotateCw className="w-5 h-5" />
                        </button>
                        <button
                          onClick={handleCaptureCamera}
                          className="px-6 py-3 rounded-full bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:brightness-110 text-white font-bold text-sm shadow-xl flex items-center gap-2"
                        >
                          <Camera className="w-5 h-5" />
                          Snap &amp; Extract Edge
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
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                    Supports transparent PNGs or regular photos — edge flood-fill removes the background while protecting inner details.
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
                  <span className="text-xs font-semibold text-slate-500">Pick a sample to test edge cleanup and cloth mesh fitting:</span>
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

          {/* STEP 2: EDGE-CLEAN TRANSPARENCY EXTRACTION */}
          {activeStep === 'segment' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 flex flex-col items-center justify-center p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 min-h-[380px] relative overflow-hidden">
                <div
                  className={`w-full h-[360px] flex items-center justify-center rounded-xl overflow-hidden ${
                    canvasBgPreview === 'checker'
                      ? 'bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] bg-[size:14px_14px]'
                      : canvasBgPreview === 'dark'
                      ? 'bg-slate-950'
                      : 'bg-white'
                  }`}
                >
                  <canvas
                    ref={segmentCanvasRef}
                    onPointerDown={(e) => {
                      setIsDrawing(true);
                      applyPointerOnCanvas(e, true);
                    }}
                    onPointerUp={() => setIsDrawing(false)}
                    onPointerLeave={() => setIsDrawing(false)}
                    onPointerMove={(e) => applyPointerOnCanvas(e, false)}
                    className={`max-w-full max-h-[340px] object-contain shadow-lg ${
                      brushMode === 'eyedropper'
                        ? 'cursor-copy'
                        : brushMode !== 'none'
                        ? 'cursor-crosshair'
                        : 'cursor-default'
                    }`}
                  />
                </div>

                {/* Cutout dimensions & preview bg switcher */}
                <div className="absolute top-6 left-6 bg-black/65 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-mono text-emerald-300">
                  {cutoutDimensions ? `${cutoutDimensions.w} × ${cutoutDimensions.h} px · Auto-Trimmed` : 'Ready'}
                </div>

                <div className="absolute top-6 right-6 flex items-center gap-1.5 bg-black/60 backdrop-blur-md p-1 rounded-xl border border-white/10">
                  {(['checker', 'dark', 'light'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setCanvasBgPreview(mode)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors ${
                        canvasBgPreview === mode ? 'bg-indigo-600 text-white' : 'text-slate-300'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Refinement Sidebar */}
              <div className="space-y-3.5 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Scissors className="w-4 h-4 text-amber-500" />
                  Precision Edge &amp; Size Cutout
                </h4>

                {/* Background Tolerance */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                    <span>Background Tolerance</span>
                    <span className="font-mono text-indigo-500 font-bold">{segOptions.tolerance}</span>
                  </div>
                  <input
                    type="range"
                    min="8"
                    max="85"
                    step="2"
                    value={segOptions.tolerance}
                    onChange={(e) => updateSegOptionsAndRun({ tolerance: Number(e.target.value) })}
                    className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Edge Softness / Anti-Aliasing */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                    <span>Edge Feather Smoothness</span>
                    <span className="font-mono text-indigo-500 font-bold">{segOptions.featherRadius} px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="6"
                    step="1"
                    value={segOptions.featherRadius}
                    onChange={(e) => updateSegOptionsAndRun({ featherRadius: Number(e.target.value) })}
                    className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Segmentation Behavior Toggles */}
                <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                    <span>Protect Inner White / Details</span>
                    <input
                      type="checkbox"
                      checked={segOptions.preserveInnerHoles}
                      onChange={(e) => updateSegOptionsAndRun({ preserveInnerHoles: e.target.checked })}
                      className="accent-indigo-600 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                    <span>Auto-Crop to Tight Bounds</span>
                    <input
                      type="checkbox"
                      checked={segOptions.cropToBoundingBox}
                      onChange={(e) => updateSegOptionsAndRun({ cropToBoundingBox: e.target.checked })}
                      className="accent-indigo-600 rounded"
                    />
                  </label>
                </div>

                {/* Eyedropper + Manual Brushes */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <button
                    onClick={() => setBrushMode((prev) => (prev === 'eyedropper' ? 'none' : 'eyedropper'))}
                    className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      brushMode === 'eyedropper'
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-300 ring-2 ring-amber-500/20'
                        : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-amber-400'
                    }`}
                  >
                    <Pipette className="w-3.5 h-3.5" />
                    {brushMode === 'eyedropper' ? 'Click Background Color on Canvas...' : 'Pick Background Color'}
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setBrushMode((prev) => (prev === 'erase' ? 'none' : 'erase'))}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        brushMode === 'erase'
                          ? 'border-rose-500 bg-rose-50/70 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 ring-2 ring-rose-500/20'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      Erase Stray
                    </button>

                    <button
                      onClick={() => setBrushMode((prev) => (prev === 'restore' ? 'none' : 'restore'))}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        brushMode === 'restore'
                          ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      <Paintbrush className="w-3.5 h-3.5" />
                      Restore Detail
                    </button>
                  </div>

                  {(brushMode === 'erase' || brushMode === 'restore') && (
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Brush Radius</span>
                        <span className="font-mono text-indigo-400">{brushRadius}px</span>
                      </div>
                      <input
                        type="range"
                        min="6"
                        max="56"
                        step="2"
                        value={brushRadius}
                        onChange={(e) => setBrushRadius(Number(e.target.value))}
                        className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setSegOptions(DEFAULT_SEGMENTATION_OPTIONS);
                      setBrushMode('none');
                      if (rawImageRef.current) processSegmentation(rawImageRef.current, DEFAULT_SEGMENTATION_OPTIONS);
                    }}
                    className="text-[11px] text-slate-500 hover:text-indigo-400 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset Cutout
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
                {/* Asset Display Name */}
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
                      <span className="text-[10px] font-mono text-indigo-500 capitalize">{clothingTag}</span>
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

                    {/* Create New Clothing Tag if not in list */}
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
                      <span className="font-mono text-indigo-500">{defaultScale.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.3"
                      max="1.8"
                      step="0.02"
                      value={defaultScale}
                      onChange={(e) => setDefaultScale(Number(e.target.value))}
                      className="w-full accent-indigo-500 h-1.5 mt-2 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
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
                    <Wind className="w-3.5 h-3.5 animate-pulse" />
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div>
            {activeStep !== 'source' && (
              <button
                onClick={() => {
                  if (activeStep === 'configure') setActiveStep('segment');
                  else if (activeStep === 'segment') setActiveStep('source');
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Cancel
            </button>

            {activeStep === 'segment' && (
              <button
                onClick={() => setActiveStep('configure')}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md flex items-center gap-2"
              >
                Configure Tag &amp; Mesh →
              </button>
            )}

            {activeStep === 'configure' && (
              <button
                onClick={handleSaveAsset}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 hover:brightness-110 text-white text-xs font-bold shadow-xl flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Save Asset &amp; Mesh
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
