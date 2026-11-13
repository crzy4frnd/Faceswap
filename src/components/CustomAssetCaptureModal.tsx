import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  Sparkles,
  X,
  Scissors,
  Check,
  RotateCw,
  Sliders,
  Layers,
  Shirt,
  Gem,
  Eye,
  RefreshCw,
  Crop,
  Eraser,
  Paintbrush,
  Wind,
  Info,
  Maximize2,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { WardrobeAsset } from '../types/body';
import {
  removeAssetBackground,
  applyBrushToCanvas,
  exportTransparentAssetDataUrl,
  SegmentationOptions,
  DEFAULT_SEGMENTATION_OPTIONS,
} from '../utils/customAssetSegmenter';
import { loadImage } from '../utils/faceEngine';
import kimonoUrl from '../assets/images/costume_silk_kimono_1794472960844.jpg';
import emeraldPendantUrl from '../assets/images/costume_emerald_pendant_1794472974484.jpg';
import blazerUrl from '../assets/images/asset_tailored_blazer_1794417020215.jpg';
import goldNecklaceUrl from '../assets/images/asset_gold_necklace_1794417020572.jpg';

interface Props {
  onAssetAdded?: (assetId: string) => void;
}

export const CustomAssetCaptureModal: React.FC<Props> = ({ onAssetAdded }) => {
  const {
    showCustomAssetModal,
    setShowCustomAssetModal,
    addWardrobeAsset,
    customAssetInitialCategory,
  } = useFaceStudio();

  // Step flow: 'capture' (camera or file) -> 'refine' (segmentation & touch-up) -> 'configure' (anchor & physics)
  const [activeStep, setActiveStep] = useState<'source' | 'segment' | 'configure'>('source');
  const [sourceType, setSourceType] = useState<'camera' | 'upload' | 'samples'>('camera');

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Raw source image loaded
  const rawImageRef = useRef<HTMLImageElement | null>(null);
  const [rawImageUrl, setRawImageUrl] = useState<string | null>(null);

  // Segmented canvas ref
  const segmentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  // Segmentation options
  const [segOptions, setSegOptions] = useState<SegmentationOptions>(DEFAULT_SEGMENTATION_OPTIONS);
  const [brushMode, setBrushMode] = useState<'none' | 'erase' | 'restore'>('none');
  const [brushRadius, setBrushRadius] = useState<number>(24);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasBgPreview, setCanvasBgPreview] = useState<'checker' | 'dark' | 'light'>('checker');

  // Asset Metadata & Physics configuration
  const [assetName, setAssetName] = useState('');
  const [category, setCategory] = useState<'clothing' | 'jewelry' | 'accessory'>(customAssetInitialCategory || 'clothing');
  const [subCategory, setSubCategory] = useState<WardrobeAsset['subCategory']>('top');
  const [anchorPoint, setAnchorPoint] = useState<WardrobeAsset['anchorPoint']>('shoulders');
  const [fabricType, setFabricType] = useState<WardrobeAsset['fabricType']>('cotton');
  const [defaultScale, setDefaultScale] = useState<number>(1.0);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(['Custom Costume', 'Client-Side Cutout']);

  // Mannequin physics preview canvas
  const mannequinCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mannequinAnimRef = useRef<number | null>(null);

  // Initialize camera when source is camera
  useEffect(() => {
    if (!showCustomAssetModal) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
      return;
    }

    if (activeStep === 'source' && sourceType === 'camera') {
      let isMounted = true;
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
          if (isMounted) {
            setStream(s);
            if (videoRef.current) {
              videoRef.current.srcObject = s;
              videoRef.current.play().catch(() => {});
            }
            setCameraError(null);
          } else {
            s.getTracks().forEach((t) => t.stop());
          }
        })
        .catch((err) => {
          console.warn('Camera access denied or unavailable:', err);
          setCameraError('Camera access unavailable. You can upload an image or choose a sample.');
          setSourceType('upload');
        });

      return () => {
        isMounted = false;
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
      };
    }
  }, [showCustomAssetModal, activeStep, sourceType, facingMode]);

  // Adjust defaults when category changes
  useEffect(() => {
    if (category === 'clothing') {
      setAnchorPoint('shoulders');
      setSubCategory('top');
      setDefaultScale(1.05);
      setFabricType('cotton');
      if (!assetName || assetName.startsWith('Custom')) setAssetName('Custom Designer Top');
    } else if (category === 'jewelry') {
      setAnchorPoint('neck');
      setSubCategory('necklace');
      setDefaultScale(0.65);
      if (!assetName || assetName.startsWith('Custom')) setAssetName('Custom Gemstone Necklace');
    } else {
      setAnchorPoint('head');
      setSubCategory('hat');
      setDefaultScale(0.85);
      if (!assetName || assetName.startsWith('Custom')) setAssetName('Custom Royal Headwear');
    }
  }, [category]);

  // Handle capture snapshot from live camera
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

    const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.95);
    loadImage(dataUrl).then((img) => {
      rawImageRef.current = img;
      setRawImageUrl(dataUrl);
      processSegmentation(img, segOptions);
      setActiveStep('segment');
    });

    // Stop camera stream once captured
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  };

  // Handle local file upload (gallery or computer)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
  };

  // Handle quick sample selection
  const handleSelectSample = (url: string, name: string, cat: 'clothing' | 'jewelry' | 'accessory', anchor: WardrobeAsset['anchorPoint'], mat: WardrobeAsset['fabricType']) => {
    loadImage(url).then((img) => {
      rawImageRef.current = img;
      setRawImageUrl(url);
      setAssetName(name);
      setCategory(cat);
      setAnchorPoint(anchor);
      if (mat) setFabricType(mat);
      processSegmentation(img, segOptions);
      setActiveStep('segment');
    });
  };

  // Run the background removal algorithm
  const processSegmentation = (sourceImg: HTMLImageElement, opts: SegmentationOptions) => {
    const w = sourceImg.naturalWidth || sourceImg.width;
    const h = sourceImg.naturalHeight || sourceImg.height;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    const octx = offCanvas.getContext('2d');
    if (!octx) return;

    octx.drawImage(sourceImg, 0, 0);
    const transparentCanvas = removeAssetBackground(offCanvas, opts);

    // Copy to interactive segment canvas
    if (segmentCanvasRef.current) {
      segmentCanvasRef.current.width = transparentCanvas.width;
      segmentCanvasRef.current.height = transparentCanvas.height;
      const sctx = segmentCanvasRef.current.getContext('2d');
      if (sctx) {
        sctx.clearRect(0, 0, transparentCanvas.width, transparentCanvas.height);
        sctx.drawImage(transparentCanvas, 0, 0);
      }
    }

    const dataUrl = exportTransparentAssetDataUrl(transparentCanvas);
    setPreviewDataUrl(dataUrl);
  };

  // Re-run segmentation when tolerance slider changes
  const handleToleranceChange = (newTol: number) => {
    const updated = { ...segOptions, tolerance: newTol };
    setSegOptions(updated);
    if (rawImageRef.current) {
      processSegmentation(rawImageRef.current, updated);
    }
  };

  // Manual brush drawing on canvas for erasing or restoring
  const handleCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (brushMode === 'none' || !isDrawing || !segmentCanvasRef.current) return;
    const canvas = segmentCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    applyBrushToCanvas(ctx, x, y, brushRadius, brushMode, rawImageRef.current || undefined);
    setPreviewDataUrl(canvas.toDataURL('image/png'));
  };

  // Mannequin Physics Loop in Step 3
  useEffect(() => {
    if (activeStep !== 'configure' || !previewDataUrl) return;

    let isRunning = true;
    let imgEl: HTMLImageElement | null = null;
    loadImage(previewDataUrl).then((img) => {
      imgEl = img;
    });

    let startTime = performance.now();

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

          // Studio pedestal background
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, w, h);

          const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.75);
          grad.addColorStop(0, '#1e293b');
          grad.addColorStop(1, '#020617');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);

          const t = (timestamp - startTime) / 1000;
          const breathe = Math.sin(t * 1.8) * 3;
          const windSway = Math.sin(t * 2.5) * 4;

          // Stylized mannequin silhouette
          ctx.fillStyle = '#334155';
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 2;

          // Head
          ctx.beginPath();
          ctx.ellipse(w / 2, 85, 24, 30, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Neck
          ctx.fillRect(w / 2 - 8, 115, 16, 22);

          // Torso & Shoulders
          ctx.beginPath();
          ctx.moveTo(w / 2 - 75, 140);
          ctx.lineTo(w / 2 + 75, 140);
          ctx.lineTo(w / 2 + 55, 260 + breathe);
          ctx.lineTo(w / 2 - 55, 260 + breathe);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Render attached costume / jewelry with physics sway
          ctx.save();
          if (anchorPoint === 'shoulders') {
            // Garment with cloth physics drape & wind sway
            const gW = 190 * defaultScale;
            const gH = gW * (imgEl.height / imgEl.width);
            ctx.translate(w / 2 + windSway * 0.4, 135);
            ctx.rotate((windSway * 0.4 * Math.PI) / 180);

            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 14;
            ctx.shadowOffsetY = 8;
            ctx.drawImage(imgEl, -gW / 2, 0, gW, gH);
          } else if (anchorPoint === 'neck') {
            // Necklace with pendulum sway
            const nW = 100 * defaultScale;
            const nH = nW * (imgEl.height / imgEl.width);
            const pendAngle = Math.sin(t * 3.2) * 0.08;
            ctx.translate(w / 2 + Math.sin(t * 3.2) * 5, 142);
            ctx.rotate(pendAngle);

            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 8;
            ctx.drawImage(imgEl, -nW / 2, 0, nW, nH);
          } else if (anchorPoint === 'head') {
            // Hat / Headwear
            const hW = 120 * defaultScale;
            const hH = hW * (imgEl.height / imgEl.width);
            ctx.translate(w / 2, 70);
            ctx.drawImage(imgEl, -hW / 2, -hH * 0.7, hW, hH);
          } else if (anchorPoint === 'wrist') {
            // Wrist
            const rW = 45 * defaultScale;
            const rH = rW * (imgEl.height / imgEl.width);
            ctx.translate(w / 2 - 70, 240);
            ctx.drawImage(imgEl, -rW / 2, -rH / 2, rW, rH);
          } else if (anchorPoint === 'waist') {
            // Waist
            const sW = 140 * defaultScale;
            const sH = sW * (imgEl.height / imgEl.width);
            ctx.translate(w / 2, 255);
            ctx.drawImage(imgEl, -sW / 2, 0, sW, sH);
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
  }, [activeStep, previewDataUrl, anchorPoint, defaultScale]);

  // Finalize and save the custom asset
  const handleSaveAsset = () => {
    if (!previewDataUrl) return;

    const newId = `custom-asset-${Date.now()}`;
    const newAsset: WardrobeAsset = {
      id: newId,
      name: assetName.trim() || 'Custom Costume Asset',
      category,
      subCategory,
      imageUrl: previewDataUrl,
      anchorPoint,
      defaultScale,
      tags: tags.length ? tags : ['Custom', category],
      brand: 'Custom Atelier',
      isCustom: true,
      customCreatedAt: Date.now(),
      fabricType: category === 'clothing' ? fabricType : undefined,
    };

    addWardrobeAsset(newAsset);
    if (onAssetAdded) {
      onAssetAdded(newId);
    }

    setShowCustomAssetModal(false);
    setActiveStep('source');
    setRawImageUrl(null);
    setPreviewDataUrl(null);
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
                Scan & Convert Costume, Clothes & Jewelry
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/20">
                  Universal AR Asset
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Capture via camera or gallery, auto-extract transparency, set physical drape, and wear in Body Studio & Live Camera
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (stream) stream.getTracks().forEach((t) => t.stop());
              setShowCustomAssetModal(false);
            }}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress Tabs */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/40 px-6 py-2">
          {[
            { id: 'source', label: '1. Capture / Select', icon: Camera },
            { id: 'segment', label: '2. Auto-Extract Transparency', icon: Scissors },
            { id: 'configure', label: '3. Anchor & Physics Calibrate', icon: Sliders },
          ].map((s, idx) => {
            const Icon = s.icon;
            const isActive = activeStep === s.id;
            const isCompleted = (s.id === 'source' && (activeStep === 'segment' || activeStep === 'configure')) || (s.id === 'segment' && activeStep === 'configure');
            return (
              <button
                key={s.id}
                disabled={s.id !== 'source' && !rawImageUrl}
                onClick={() => setActiveStep(s.id as any)}
                className={`flex items-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold transition-all ${
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
              {/* Source Mode Selector */}
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
                  <span className="font-bold text-sm">Live Camera Capture</span>
                  <span className="text-[11px] text-slate-500">Snap garment or necklace with live reticle</span>
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
                  <span className="text-[11px] text-slate-500">Select JPG, PNG, or WEBP from device</span>
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
                  <span className="font-bold text-sm">Curated High-Fashion</span>
                  <span className="text-[11px] text-slate-500">Instant test with silk robe, emerald, or suit</span>
                </button>
              </div>

              {/* View 1A: Live Camera Feed */}
              {sourceType === 'camera' && (
                <div className="relative flex flex-col items-center justify-center bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 min-h-[380px]">
                  {cameraError ? (
                    <div className="p-6 text-center text-rose-400 space-y-2">
                      <p className="font-semibold">{cameraError}</p>
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

                      {/* Live Alignment Reticle Overlay */}
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                        <div className="w-64 h-72 border-2 border-dashed border-amber-400/80 rounded-3xl flex flex-col items-center justify-between p-4 bg-black/10 backdrop-blur-[1px]">
                          <span className="text-[11px] font-bold text-amber-300 bg-black/60 px-2 py-0.5 rounded-full">
                            Center Garment or Jewelry
                          </span>
                          <span className="text-[10px] text-white/80 bg-black/50 px-2 py-0.5 rounded text-center">
                            Hold flat against a neutral wall or table for optimal auto-cutout
                          </span>
                        </div>
                      </div>

                      {/* Camera Control HUD */}
                      <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-4">
                        <button
                          onClick={() => setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))}
                          className="p-3 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 backdrop-blur-md transition-transform active:scale-95"
                          title="Switch Front/Back Camera"
                        >
                          <RotateCw className="w-5 h-5" />
                        </button>

                        <button
                          onClick={handleCaptureCamera}
                          className="px-6 py-3 rounded-full bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:brightness-110 text-white font-bold text-sm shadow-xl flex items-center gap-2 transition-transform active:scale-95"
                        >
                          <Camera className="w-5 h-5" />
                          Snap & Auto-Cutout
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* View 1B: Gallery / File Upload */}
              {sourceType === 'upload' && (
                <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-3xl p-10 text-center hover:border-indigo-500 transition-colors bg-slate-50/50 dark:bg-slate-950/40">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-4">
                    <Upload className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                    Select a costume, clothing, or jewelry photo
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                    Photos on plain backgrounds (white, black, or chroma green) produce the cleanest edge cutouts!
                  </p>
                  <label className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer shadow-lg transition-transform active:scale-95">
                    <Upload className="w-4 h-4" />
                    Browse Photo Gallery / Files
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {/* View 1C: Curated High-Fashion Presets */}
              {sourceType === 'samples' && (
                <div className="space-y-3">
                  <span className="text-xs font-semibold text-slate-500">Pick a preset to test physics and live AR fitting:</span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      {
                        name: 'Royal Silk Kimono Robe',
                        url: kimonoUrl,
                        category: 'clothing' as const,
                        anchor: 'shoulders' as const,
                        mat: 'silk' as const,
                        tag: 'Silk · Fluid Drape',
                      },
                      {
                        name: 'Colombian Emerald Pendant',
                        url: emeraldPendantUrl,
                        category: 'jewelry' as const,
                        anchor: 'neck' as const,
                        mat: 'wool' as const,
                        tag: 'Gemstone · Pendulum',
                      },
                      {
                        name: 'Tailored Midnight Blazer',
                        url: blazerUrl,
                        category: 'clothing' as const,
                        anchor: 'shoulders' as const,
                        mat: 'wool' as const,
                        tag: 'Tailored Wool',
                      },
                      {
                        name: 'Solitaire Gold Necklace',
                        url: goldNecklaceUrl,
                        category: 'jewelry' as const,
                        anchor: 'neck' as const,
                        mat: 'wool' as const,
                        tag: '18K Gold Choker',
                      },
                    ].map((sample) => (
                      <button
                        key={sample.name}
                        onClick={() => handleSelectSample(sample.url, sample.name, sample.category, sample.anchor, sample.mat)}
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

          {/* STEP 2: AUTO-EXTRACTION & TRANSPARENCY REFINEMENT */}
          {activeStep === 'segment' && (
            <div className="space-y-4">
              {/* Studio Canvas Preview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 flex flex-col items-center justify-center p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 min-h-[380px] relative overflow-hidden">
                  {/* Background checkerboard or solid toggle */}
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
                      onPointerDown={() => setIsDrawing(true)}
                      onPointerUp={() => setIsDrawing(false)}
                      onPointerLeave={() => setIsDrawing(false)}
                      onPointerMove={handleCanvasPointer}
                      className={`max-w-full max-h-[340px] object-contain shadow-lg ${
                        brushMode !== 'none' ? 'cursor-crosshair' : 'cursor-default'
                      }`}
                    />
                  </div>

                  {/* Canvas Viewport Switcher */}
                  <div className="absolute top-6 right-6 flex items-center gap-1.5 bg-black/60 backdrop-blur-md p-1 rounded-xl border border-white/10">
                    <button
                      onClick={() => setCanvasBgPreview('checker')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        canvasBgPreview === 'checker' ? 'bg-indigo-600 text-white' : 'text-slate-300'
                      }`}
                    >
                      Checker
                    </button>
                    <button
                      onClick={() => setCanvasBgPreview('dark')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        canvasBgPreview === 'dark' ? 'bg-indigo-600 text-white' : 'text-slate-300'
                      }`}
                    >
                      Dark
                    </button>
                    <button
                      onClick={() => setCanvasBgPreview('light')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        canvasBgPreview === 'light' ? 'bg-indigo-600 text-white' : 'text-slate-300'
                      }`}
                    >
                      Light
                    </button>
                  </div>
                </div>

                {/* Refinement Controls Sidebar */}
                <div className="space-y-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Scissors className="w-4 h-4 text-amber-500" />
                    Auto-Cutout Calibration
                  </h4>

                  {/* Tolerance Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>Cutout Cleanliness</span>
                      <span className="font-mono text-indigo-500 font-bold">{segOptions.tolerance}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="75"
                      step="2"
                      value={segOptions.tolerance}
                      onChange={(e) => handleToleranceChange(Number(e.target.value))}
                      className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <p className="text-[10px] text-slate-400">
                      Adjust to remove any residual solid studio or room background.
                    </p>
                  </div>

                  {/* Manual Touch-Up Eraser / Restore Brush */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                      Manual Touch-up Brush:
                    </span>
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

                    {brushMode !== 'none' && (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>Brush Radius</span>
                          <span className="font-mono text-indigo-400">{brushRadius}px</span>
                        </div>
                        <input
                          type="range"
                          min="6"
                          max="60"
                          step="2"
                          value={brushRadius}
                          onChange={(e) => setBrushRadius(Number(e.target.value))}
                          className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                        />
                      </div>
                    )}
                  </div>

                  {/* Reset Extraction */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <button
                      onClick={() => {
                        if (rawImageRef.current) processSegmentation(rawImageRef.current, DEFAULT_SEGMENTATION_OPTIONS);
                      }}
                      className="text-[11px] text-slate-500 hover:text-indigo-400 flex items-center gap-1 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reset to Default
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CONFIGURE ANCHOR & PHYSICAL PROPERTIES */}
          {activeStep === 'configure' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Asset Configuration */}
              <div className="space-y-4">
                {/* Asset Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Asset Display Name
                  </label>
                  <input
                    type="text"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder="e.g. Royal Silk Kimono, Platinum Diamond Pendant"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-900 dark:text-white focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                {/* Category & Subcategory */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Category
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['clothing', 'jewelry', 'accessory'] as const).map((c) => (
                        <button
                          key={c}
                          onClick={() => setCategory(c)}
                          className={`py-1.5 rounded-lg text-[10px] font-bold capitalize border transition-all ${
                            category === c
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-xs'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Body Anchor Point
                    </label>
                    <select
                      value={anchorPoint}
                      onChange={(e) => setAnchorPoint(e.target.value as any)}
                      className="w-full px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-200"
                    >
                      <option value="shoulders">Shoulders / Torso (Cloth Physics)</option>
                      <option value="neck">Neck / Collarbone (Pendant Pendulum)</option>
                      <option value="head">Head (Hat / Crown / Cap)</option>
                      <option value="wrist">Wrist (Watch / Bracelet)</option>
                      <option value="waist">Waist / Hips (Skirt / Belt)</option>
                    </select>
                  </div>
                </div>

                {/* Physics Material Properties */}
                {category === 'clothing' && (
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Wind className="w-3.5 h-3.5 text-cyan-400" />
                      Fabric Drape & Physical Movement
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { id: 'silk', label: 'Silk', desc: 'Ultra-light flutter' },
                        { id: 'cotton', label: 'Cotton', desc: 'Balanced body drape' },
                        { id: 'wool', label: 'Wool', desc: 'Tailored inertia' },
                        { id: 'leather', label: 'Leather', desc: 'Rigid structure' },
                      ].map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setFabricType(f.id as any)}
                          className={`p-1.5 rounded-xl border text-center transition-all ${
                            fabricType === f.id
                              ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-300 font-bold'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <span className="block text-[11px] font-bold">{f.label}</span>
                          <span className="block text-[8px] text-slate-400">{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Scale Adjustment */}
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                    <span>Default Proportion Scale</span>
                    <span className="font-mono text-indigo-400 font-bold">{defaultScale.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="2.0"
                    step="0.05"
                    value={defaultScale}
                    onChange={(e) => setDefaultScale(Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Right Column: Live Physics Mannequin Preview */}
              <div className="flex flex-col items-center justify-center p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 min-h-[340px] relative overflow-hidden">
                <div className="absolute top-3 left-4 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-400">
                  <Wind className="w-3.5 h-3.5 animate-pulse" />
                  Live Mannequin Physics Preview
                </div>
                <canvas
                  ref={mannequinCanvasRef}
                  className="rounded-xl shadow-2xl max-w-full"
                />
                <span className="absolute bottom-3 text-[10px] text-slate-400 bg-black/60 px-3 py-1 rounded-full border border-white/10">
                  Responding to simulated gravity, breathing & breeze
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div>
            {activeStep !== 'source' && (
              <button
                onClick={() => {
                  if (activeStep === 'configure') setActiveStep('segment');
                  else if (activeStep === 'segment') setActiveStep('source');
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (stream) stream.getTracks().forEach((t) => t.stop());
                setShowCustomAssetModal(false);
              }}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>

            {activeStep === 'segment' && (
              <button
                onClick={() => setActiveStep('configure')}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md flex items-center gap-2 transition-transform active:scale-95"
              >
                Calibrate Anchor & Physics →
              </button>
            )}

            {activeStep === 'configure' && (
              <button
                onClick={handleSaveAsset}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 hover:brightness-110 text-white text-xs font-bold shadow-xl flex items-center gap-2 transition-transform active:scale-95"
              >
                <Sparkles className="w-4 h-4" />
                Convert & Add to Wardrobe
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
