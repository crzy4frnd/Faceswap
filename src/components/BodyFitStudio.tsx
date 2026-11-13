import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Shirt,
  Gem,
  Watch,
  Activity,
  Sliders,
  RotateCcw,
  Upload,
  Check,
  Eye,
  Trash2,
  Move,
  Ruler,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Scale,
  Download,
  Play,
  Pause,
  Wind,
  Flame,
  Waves,
  Feather,
  RefreshCw,
  Compass,
  Hand,
  Camera,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import {
  BodyLandmarks,
  BodyMeasurements,
  ClothMotionPreset,
  ClothPhysicsConfig,
  FittedAsset,
  WardrobeAsset,
} from '../types/body';
import { INITIAL_WARDROBE_ASSETS } from '../utils/bodyAssets';
import { scanBodyAndMeasure, renderFittedAssetsOnBody } from '../utils/bodyEngine';
import {
  ClothMeshState,
  DEFAULT_CLOTH_CONFIG,
  FABRIC_PROPERTIES,
  PendantPhysicsState,
  computePostureDynamics,
  createClothGrid,
  createPendantPhysics,
  stepClothMesh,
  stepPendantPhysics,
} from '../utils/clothPhysicsEngine';
import { loadImage } from '../utils/faceEngine';

export const BodyFitStudio: React.FC = () => {
  const {
    targetImageElement,
    detectedFaces,
    outputCanvasRef,
    setShowExportModal,
    wardrobeAssets,
    addWardrobeAsset,
    openCustomAssetModal,
    removeWardrobeAsset,
  } = useFaceStudio();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pinchTimeoutRef = useRef<number | null>(null);

  const [cachedAssetImages, setCachedAssetImages] = useState<Record<string, HTMLImageElement>>({});

  // Active fitted layers
  const [fittedAssets, setFittedAssets] = useState<FittedAsset[]>([
    {
      assetId: 'asset-blazer-navy',
      visible: true,
      scale: 1.0,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      fitTightness: 45,
      shadowDepth: 60,
      lightingMatch: true,
      blendMode: 'stitch',
    },
    {
      assetId: 'asset-necklace-diamond',
      visible: true,
      scale: 0.65,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      fitTightness: 50,
      shadowDepth: 40,
      lightingMatch: true,
      blendMode: 'stitch',
    },
  ]);

  const [selectedAssetId, setSelectedAssetId] = useState<string>('asset-blazer-navy');
  const [showScanHUD, setShowScanHUD] = useState<boolean>(true);
  const [filterCategory, setFilterCategory] = useState<'all' | 'clothing' | 'jewelry' | 'custom'>('all');
  const [inspectorTab, setInspectorTab] = useState<'fit' | 'physics' | 'posture'>('physics');

  // Cloth Physics & Motion Simulation State
  const [clothConfig, setClothConfig] = useState<ClothPhysicsConfig>(DEFAULT_CLOTH_CONFIG);
  const [isTugMode, setIsTugMode] = useState<boolean>(true);
  const [isTugging, setIsTugging] = useState<boolean>(false);

  // Pinch-to-zoom multi-touch state
  const [initialTouchDist, setInitialTouchDist] = useState<number | null>(null);
  const [initialPinchScale, setInitialPinchScale] = useState<number>(1.0);
  const [isPinching, setIsPinching] = useState<boolean>(false);

  // Mouse corner drag scaling state
  const [isDraggingCorner, setIsDraggingCorner] = useState<boolean>(false);
  const [cornerDragStart, setCornerDragStart] = useState<{ x: number; y: number; initialScale: number } | null>(null);

  // Body Scan State
  const [bodyData, setBodyData] = useState<{
    landmarks: BodyLandmarks;
    measurements: BodyMeasurements;
  } | null>(null);

  // Physics Mesh and Simulation Loop Refs
  const clothMeshMapRef = useRef<Record<string, ClothMeshState>>({});
  const pendantPhysicsMapRef = useRef<Record<string, PendantPhysicsState>>({});
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  // Pre-cache wardrobe asset images
  useEffect(() => {
    wardrobeAssets.forEach((asset) => {
      if (!cachedAssetImages[asset.id]) {
        loadImage(asset.imageUrl)
          .then((img) => {
            setCachedAssetImages((prev) => ({ ...prev, [asset.id]: img }));
          })
          .catch(() => {});
      }
    });
  }, [wardrobeAssets]);

  // Scan body whenever target image changes
  useEffect(() => {
    if (!targetImageElement) return;
    const w = targetImageElement.naturalWidth || targetImageElement.width;
    const h = targetImageElement.naturalHeight || targetImageElement.height;
    const faceHint = detectedFaces[0]?.box;

    const scanned = scanBodyAndMeasure(w, h, faceHint);
    setBodyData(scanned);
  }, [targetImageElement, detectedFaces]);

  // 60 FPS Real-time Cloth Physics and Posture Simulation Animation Loop
  useEffect(() => {
    let isRunning = true;

    const loop = () => {
      if (!isRunning) return;

      if (targetImageElement && canvasRef.current && bodyData) {
        outputCanvasRef.current = canvasRef.current;
        const now = Date.now();
        const timeSec = (now - startTimeRef.current) / 1000;

        // 1. Compute dynamic posture changes, tilt, breathing expansion, and wind vector
        const posture = computePostureDynamics(timeSec, clothConfig, bodyData.landmarks);

        // 2. Map current wardrobe assets
        const assetsMap: Record<string, WardrobeAsset> = {};
        wardrobeAssets.forEach((a) => (assetsMap[a.id] = a));

        // 3. Step physics simulation for each attached layer
        if (clothConfig.enabled && clothConfig.isSimulating) {
          fittedAssets.forEach((item) => {
            if (!item.visible) return;
            const asset = assetsMap[item.assetId];
            const assetImg = cachedAssetImages[item.assetId];
            if (!asset || !assetImg) return;

            if (asset.anchorPoint === 'shoulders') {
              let mesh = clothMeshMapRef.current[item.assetId];
              const shoulderWidth = Math.abs(
                posture.dynamicLandmarks.rightShoulder.x - posture.dynamicLandmarks.leftShoulder.x
              );
              const shoulderCenter = {
                x: (posture.dynamicLandmarks.leftShoulder.x + posture.dynamicLandmarks.rightShoulder.x) / 2,
                y: (posture.dynamicLandmarks.leftShoulder.y + posture.dynamicLandmarks.rightShoulder.y) / 2,
              };
              const tightnessFactor = 0.95 + (item.fitTightness / 100) * 0.18;
              const targetW = shoulderWidth * 1.45 * item.scale * tightnessFactor;
              const targetH = targetW * (assetImg.height / assetImg.width);

              // Initialize or re-create mesh if dimensions shifted significantly
              if (!mesh || Math.abs(mesh.width - targetW) > 6) {
                mesh = createClothGrid(
                  shoulderCenter.x + item.offsetX,
                  shoulderCenter.y + item.offsetY - targetH * 0.14,
                  targetW,
                  targetH,
                  7,
                  8,
                  shoulderWidth
                );
                clothMeshMapRef.current[item.assetId] = mesh;
              }

              // Step Verlet mass-spring simulation with torso collision
              stepClothMesh(
                mesh,
                clothConfig,
                posture.dynamicLandmarks.leftShoulder,
                posture.dynamicLandmarks.rightShoulder,
                posture.dynamicLandmarks.sternum,
                posture.wind,
                posture.chestExp
              );
            } else if (asset.anchorPoint === 'neck') {
              // Dynamic catenary chain pendulum physics
              let pendant = pendantPhysicsMapRef.current[item.assetId];
              const neckWidth =
                Math.abs(
                  posture.dynamicLandmarks.rightShoulder.x - posture.dynamicLandmarks.leftShoulder.x
                ) * 0.38;
              const targetW = neckWidth * item.scale;
              if (!pendant) {
                pendant = createPendantPhysics(
                  posture.dynamicLandmarks.throat,
                  posture.dynamicLandmarks.throat,
                  targetW * 0.9,
                  6
                );
                pendantPhysicsMapRef.current[item.assetId] = pendant;
              }
              stepPendantPhysics(
                pendant,
                posture.dynamicLandmarks.throat,
                posture.dynamicLandmarks.throat,
                posture.wind,
                clothConfig.damping
              );
            }
          });
        }

        // 4. Render composite to canvas
        renderFittedAssetsOnBody(
          canvasRef.current,
          targetImageElement,
          posture.dynamicLandmarks,
          fittedAssets,
          assetsMap,
          cachedAssetImages,
          showScanHUD,
          bodyData.measurements,
          clothMeshMapRef.current,
          clothConfig,
          pendantPhysicsMapRef.current
        );
      }

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    targetImageElement,
    bodyData,
    fittedAssets,
    wardrobeAssets,
    cachedAssetImages,
    showScanHUD,
    clothConfig,
  ]);

  // Update parameters of the active fitted asset
  const updateActiveFitting = useCallback(
    (partial: Partial<FittedAsset>) => {
      setFittedAssets((prev) =>
        prev.map((f) => (f.assetId === selectedAssetId ? { ...f, ...partial } : f))
      );
    },
    [selectedAssetId]
  );

  // Update cloth physics configuration
  const updateClothConfig = (partial: Partial<ClothPhysicsConfig>) => {
    setClothConfig((prev) => ({ ...prev, ...partial }));
  };

  const handleResetPhysics = () => {
    clothMeshMapRef.current = {};
    pendantPhysicsMapRef.current = {};
  };

  // Toggle wearing/attaching an asset
  const toggleAttachAsset = (assetId: string) => {
    const existing = fittedAssets.find((f) => f.assetId === assetId);
    if (existing) {
      setFittedAssets((prev) =>
        prev.map((f) => (f.assetId === assetId ? { ...f, visible: !f.visible } : f))
      );
    } else {
      const asset = wardrobeAssets.find((a) => a.id === assetId);
      const newFitted: FittedAsset = {
        assetId,
        visible: true,
        scale: asset?.defaultScale || 1.0,
        rotation: 0,
        offsetX: 0,
        offsetY: 0,
        fitTightness: 50,
        shadowDepth: 50,
        lightingMatch: true,
        blendMode: 'stitch',
      };
      setFittedAssets((prev) => [...prev, newFitted]);
    }
    setSelectedAssetId(assetId);
  };

  // Convert client pointer coordinates to canvas image coordinates
  const getCanvasCoords = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  // 1. Mobile Pinch-to-Zoom Touch Gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      setInitialTouchDist(dist);

      const current = fittedAssets.find((f) => f.assetId === selectedAssetId);
      setInitialPinchScale(current?.scale || 1.0);
      setIsPinching(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialTouchDist !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);

      const ratio = currentDist / (initialTouchDist || 1);
      const newScale = Math.max(0.3, Math.min(2.2, parseFloat((initialPinchScale * ratio).toFixed(3))));
      updateActiveFitting({ scale: newScale });

      setIsPinching(true);
      if (pinchTimeoutRef.current) clearTimeout(pinchTimeoutRef.current);
    }
  };

  const handleTouchEnd = () => {
    setInitialTouchDist(null);
    if (pinchTimeoutRef.current) clearTimeout(pinchTimeoutRef.current);
    pinchTimeoutRef.current = window.setTimeout(() => setIsPinching(false), 800);
  };

  // 2. Desktop Mouse Wheel / Trackpad Pinch Scaling
  const handleWheel = (e: React.WheelEvent) => {
    const current = fittedAssets.find((f) => f.assetId === selectedAssetId);
    if (!current) return;

    const step = e.deltaY > 0 ? -0.04 : 0.04;
    const newScale = Math.max(0.3, Math.min(2.2, parseFloat((current.scale + step).toFixed(3))));
    updateActiveFitting({ scale: newScale });

    setIsPinching(true);
    if (pinchTimeoutRef.current) clearTimeout(pinchTimeoutRef.current);
    pinchTimeoutRef.current = window.setTimeout(() => setIsPinching(false), 900);
  };

  // 3. Desktop Interactive Corner Drag Handle Scaling
  const handleCornerPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const current = fittedAssets.find((f) => f.assetId === selectedAssetId);
    setIsDraggingCorner(true);
    setCornerDragStart({
      x: e.clientX,
      y: e.clientY,
      initialScale: current?.scale || 1.0,
    });
    setIsPinching(true);
  };

  const handleCornerPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingCorner || !cornerDragStart) return;
    const deltaY = cornerDragStart.y - e.clientY;
    const deltaX = e.clientX - cornerDragStart.x;
    const avgDelta = (deltaX + deltaY) / 120;

    const newScale = Math.max(0.3, Math.min(2.2, parseFloat((cornerDragStart.initialScale + avgDelta).toFixed(3))));
    updateActiveFitting({ scale: newScale });
  };

  const handleCornerPointerUp = (e: React.PointerEvent) => {
    setIsDraggingCorner(false);
    setCornerDragStart(null);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (pinchTimeoutRef.current) clearTimeout(pinchTimeoutRef.current);
    pinchTimeoutRef.current = window.setTimeout(() => setIsPinching(false), 800);
  };

  // 4. Interactive Cloth Tug / Pull on Canvas
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (!isTugMode || !clothConfig.enabled || isDraggingCorner) return;

    const coords = getCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;

    const mesh = clothMeshMapRef.current[selectedAssetId];
    if (!mesh) return;

    // Search for closest unpinned particle within radius
    let closestIdx: number | null = null;
    let minDist = 55; // hit radius

    for (let i = mesh.cols; i < mesh.particles.length; i++) {
      const p = mesh.particles[i];
      const dist = Math.hypot(p.x - coords.x, p.y - coords.y);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }

    if (closestIdx !== null) {
      mesh.grabbedIndex = closestIdx;
      mesh.grabbedPoint = { x: coords.x, y: coords.y };
      setIsTugging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!isTugging) return;
    const coords = getCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;

    const mesh = clothMeshMapRef.current[selectedAssetId];
    if (mesh && mesh.grabbedIndex !== null) {
      mesh.grabbedPoint = { x: coords.x, y: coords.y };
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    if (!isTugging) return;
    const mesh = clothMeshMapRef.current[selectedAssetId];
    if (mesh) {
      mesh.grabbedIndex = null;
      mesh.grabbedPoint = null;
    }
    setIsTugging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Upload custom asset
  const handleUploadAsset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const newAsset: WardrobeAsset = {
            id: `custom-asset-${Date.now()}`,
            name: file.name.replace(/\.[^/.]+$/, ''),
            category: 'clothing',
            subCategory: 'top',
            imageUrl: reader.result,
            anchorPoint: 'shoulders',
            defaultScale: 1.0,
            tags: ['Custom Upload', 'Costume'],
            isCustom: true,
            customCreatedAt: Date.now(),
          };
          addWardrobeAsset(newAsset);
          toggleAttachAsset(newAsset.id);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const activeFitted = fittedAssets.find((f) => f.assetId === selectedAssetId);
  const activeAsset = wardrobeAssets.find((a) => a.id === selectedAssetId);

  const filteredAssets = wardrobeAssets.filter((a) => {
    if (filterCategory === 'all') return true;
    if (filterCategory === 'custom') return a.isCustom;
    return a.category === filterCategory;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/40 dark:bg-slate-950/80 relative select-none overflow-hidden">
      {/* Top Measurements & Simulation Ribbon */}
      {bodyData && (
        <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md flex items-center justify-between z-20">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[11px] font-bold text-slate-100 flex items-center gap-1 shrink-0">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              Body Scan
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300">
              <span className="bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                {bodyData.measurements.estimatedSize}
              </span>
              <span className="bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                Shoulders: {bodyData.measurements.shoulderWidthCm}cm
              </span>
              <span className="bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 hidden sm:inline">
                Chest: {bodyData.measurements.chestBustCm}cm
              </span>
            </div>

            {/* Live Simulation Pulse Indicator */}
            {clothConfig.enabled && clothConfig.isSimulating && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 text-[10px] font-mono shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="capitalize">{clothConfig.preset} Physics</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Calipers HUD Button */}
            <button
              onClick={() => setShowScanHUD(!showScanHUD)}
              className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors flex items-center gap-1 shrink-0 ${
                showScanHUD
                  ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              <Ruler className="w-3 h-3" />
              <span>{showScanHUD ? 'Calipers' : 'Calipers Off'}</span>
            </button>

            {/* Direct High-Res Export */}
            <button
              onClick={() => setShowExportModal(true)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center gap-1 shrink-0 shadow-sm active:scale-95"
              title="Export High-Res Render (PNG, TIFF, JPG)"
            >
              <Download className="w-3 h-3" />
              <span>Export</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Interactive Stage with Multi-Touch Pinch, Tug & Wheel Zoom */}
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        className={`flex-1 relative flex items-center justify-center p-2 sm:p-4 overflow-hidden touch-none ${
          isTugMode && clothConfig.enabled ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        {/* Floating Proportional Pinch Scale HUD Badge */}
        {activeFitted && (
          <div
            className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full bg-slate-900/95 border border-indigo-500/50 backdrop-blur-md flex items-center gap-2 text-xs text-white shadow-xl transition-all duration-200 ${
              isPinching || isTugging ? 'scale-105 opacity-100 ring-2 ring-indigo-400/40' : 'opacity-90'
            }`}
          >
            {isTugging ? (
              <>
                <Hand className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                <span className="font-semibold text-rose-300">Tugging Fabric Hem</span>
                <span className="text-[10px] text-slate-400">· Spring Tension Active</span>
              </>
            ) : (
              <>
                <Scale className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-semibold">{activeAsset?.name}</span>
                <span className="text-slate-500">·</span>
                <span className="font-mono text-indigo-300 font-bold">
                  {Math.round(activeFitted.scale * 100)}% Scale
                </span>
                <span className="text-[10px] text-slate-400 hidden sm:inline">
                  (Pinch or Scroll to Resize)
                </span>
              </>
            )}
          </div>
        )}

        <div className="relative max-h-full max-w-full flex items-center justify-center">
          <canvas
            ref={canvasRef}
            className="max-h-[48vh] sm:max-h-[55vh] max-w-full object-contain rounded-2xl shadow-2xl block"
          />

          {/* Interactive Bounding Box & Corner Pinch-Resize Handles */}
          {activeFitted && activeFitted.visible && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                className="relative border border-dashed border-indigo-400/60 rounded-xl transition-all duration-75"
                style={{
                  width: `${Math.min(260, Math.max(90, 160 * activeFitted.scale))}px`,
                  height: `${Math.min(320, Math.max(90, 190 * activeFitted.scale))}px`,
                  transform: `translate(${activeFitted.offsetX}px, ${activeFitted.offsetY}px) rotate(${
                    activeFitted.rotation + clothConfig.postureTilt
                  }deg)`,
                }}
              >
                {/* 4 Interactive Corner Pinch Handles for Desktop & Touch */}
                {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => {
                  const isTop = corner.includes('top');
                  const isLeft = corner.includes('left');

                  return (
                    <div
                      key={corner}
                      onPointerDown={handleCornerPointerDown}
                      onPointerMove={handleCornerPointerMove}
                      onPointerUp={handleCornerPointerUp}
                      className={`absolute w-5 h-5 rounded-full bg-white text-slate-900 border-2 border-indigo-600 shadow-md flex items-center justify-center pointer-events-auto cursor-nwse-resize hover:scale-125 transition-transform ${
                        isTop ? '-top-2.5' : '-bottom-2.5'
                      } ${isLeft ? '-left-2.5' : '-right-2.5'}`}
                      title="Drag to resize asset proportionally (or pinch with 2 fingers)"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Floating Quick Action Overlay on Canvas */}
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 rounded-xl p-1 backdrop-blur-md shadow-lg text-[11px]">
          {/* Simulation Toggle */}
          <button
            onClick={() => updateClothConfig({ isSimulating: !clothConfig.isSimulating })}
            className={`p-1.5 rounded-lg flex items-center gap-1 font-medium transition-colors ${
              clothConfig.isSimulating
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:text-white bg-slate-800'
            }`}
            title={clothConfig.isSimulating ? 'Pause Cloth Dynamics' : 'Start Cloth Dynamics'}
          >
            {clothConfig.isSimulating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{clothConfig.isSimulating ? 'Live' : 'Paused'}</span>
          </button>

          {/* Interactive Tug Toggle */}
          <button
            onClick={() => setIsTugMode(!isTugMode)}
            className={`p-1.5 rounded-lg flex items-center gap-1 font-medium transition-colors ${
              isTugMode
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white bg-slate-800'
            }`}
            title="Interactive Cloth Tug: Click and pull fabric on canvas"
          >
            <Hand className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tug Fabric</span>
          </button>

          {/* Studio Air Fan Blower Toggle */}
          <button
            onClick={() => updateClothConfig({ airFanActive: !clothConfig.airFanActive })}
            className={`p-1.5 rounded-lg flex items-center gap-1 font-medium transition-colors ${
              clothConfig.airFanActive
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-white bg-slate-800'
            }`}
            title="Toggle Studio Air Fan (blows realistic air breeze across garment)"
          >
            <Wind className={`w-3.5 h-3.5 ${clothConfig.airFanActive ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{clothConfig.airFanActive ? 'Fan On' : 'Air Fan'}</span>
          </button>

          {/* Wireframe Toggle */}
          <button
            onClick={() => updateClothConfig({ showPhysicsWireframe: !clothConfig.showPhysicsWireframe })}
            className={`p-1.5 rounded-lg transition-colors ${
              clothConfig.showPhysicsWireframe
                ? 'bg-cyan-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Toggle Mass-Spring Wireframe Mesh"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Floating Zoom Step Buttons on Canvas */}
        {activeFitted && (
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-slate-900/90 border border-slate-700/80 rounded-xl p-1 backdrop-blur-md shadow-lg">
            <button
              onClick={() =>
                updateActiveFitting({
                  scale: Math.max(0.3, parseFloat((activeFitted.scale - 0.05).toFixed(2))),
                })
              }
              className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Scale down 5%"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] text-slate-200 px-1.5 font-bold">
              {Math.round(activeFitted.scale * 100)}%
            </span>
            <button
              onClick={() =>
                updateActiveFitting({
                  scale: Math.min(2.2, parseFloat((activeFitted.scale + 0.05).toFixed(2))),
                })
              }
              className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Scale up 5%"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => updateActiveFitting({ scale: 1.0 })}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 text-[10px] font-mono"
              title="Reset scale to 100%"
            >
              1:1
            </button>
          </div>
        )}
      </div>

      {/* Wardrobe Tray & Comprehensive Physics Inspector Drawer */}
      <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col z-20 shrink-0">
        {/* Wardrobe Asset Picker Strip */}
        <div className="p-2.5 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          {/* Category Filter Chips */}
          <div className="flex items-center gap-1 shrink-0">
            {[
              { id: 'all' as const, label: 'All Items' },
              { id: 'clothing' as const, label: 'Clothes' },
              { id: 'jewelry' as const, label: 'Jewelry' },
              {
                id: 'custom' as const,
                label: `Custom (${wardrobeAssets.filter((a) => a.isCustom).length})`,
              },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setFilterCategory(cat.id)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors ${
                  filterCategory === cat.id
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Action Buttons: Camera Snap & Gallery Studio */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => openCustomAssetModal('clothing')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 hover:brightness-110 text-white text-[11px] font-bold shadow-xs transition-transform active:scale-95"
              title="Snap live photo of costume or jewelry to auto-extract and fit"
            >
              <Camera className="w-3 h-3" />
              <span>Camera Scan</span>
            </button>

            <button
              onClick={() => openCustomAssetModal('clothing')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium hover:border-indigo-500 transition-colors"
              title="Upload costume photo from gallery with background remover"
            >
              <Upload className="w-3 h-3" />
              <span>From Gallery</span>
            </button>
          </div>
        </div>

        {/* Assets Horizontal Scroll Strip */}
        <div className="p-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {filteredAssets.map((asset) => {
            const isFitted = fittedAssets.some((f) => f.assetId === asset.id && f.visible);
            const isSelected = selectedAssetId === asset.id;

            return (
              <div
                key={asset.id}
                onClick={() => {
                  setSelectedAssetId(asset.id);
                  if (!isFitted) toggleAttachAsset(asset.id);
                }}
                className={`min-w-[145px] p-2 rounded-xl border transition-all cursor-pointer flex items-center gap-2 relative group ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-xs ring-1 ring-indigo-500/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60'
                }`}
              >
                {/* Custom Badge */}
                {asset.isCustom && (
                  <span className="absolute -top-1.5 -right-1 px-1.5 py-0.2 rounded-full text-[8px] font-extrabold bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-xs">
                    CUSTOM
                  </span>
                )}

                <img
                  src={asset.imageUrl}
                  alt={asset.name}
                  className="w-10 h-10 rounded-lg object-contain bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <span className="block text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {asset.name}
                  </span>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAttachAsset(asset.id);
                      }}
                      className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        isFitted
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      {isFitted ? 'Stitched' : 'Attach'}
                    </button>

                    {/* Delete Custom Asset */}
                    {asset.isCustom && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeWardrobeAsset(asset.id);
                        }}
                        className="text-slate-400 hover:text-rose-500 p-0.5 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete custom asset"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Inspector Sub-Tabs: Fit & Scale | Cloth Physics | Posture & Motion */}
        <div className="px-3 pt-2 pb-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-1">
            {[
              { id: 'physics' as const, label: 'Cloth Physics', icon: Waves },
              { id: 'posture' as const, label: 'Posture & Motion', icon: Compass },
              { id: 'fit' as const, label: 'Stitch & Fit', icon: Sliders },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = inspectorTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setInspectorTab(tab.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {activeAsset && (
            <button
              onClick={() => toggleAttachAsset(activeAsset.id)}
              className="text-[11px] text-rose-500 hover:text-rose-600 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>Remove</span>
            </button>
          )}
        </div>

        {/* TAB 1: CLOTH PHYSICS SIMULATION */}
        {inspectorTab === 'physics' && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/90 space-y-2.5 text-xs">
            {/* Motion Dynamics Presets */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="flex items-center gap-1">
                  <Waves className="w-3.5 h-3.5 text-indigo-500" />
                  Movement Simulation Preset
                </span>
                <span className="text-[10px] text-indigo-500 font-mono capitalize">
                  {clothConfig.preset}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { id: 'breathing' as ClothMotionPreset, label: 'Breathing', desc: 'Chest rise' },
                  { id: 'walking' as ClothMotionPreset, label: 'Walking', desc: 'Sway & inertia' },
                  { id: 'breeze' as ClothMotionPreset, label: 'Breeze', desc: 'Hem flutter' },
                  { id: 'dance' as ClothMotionPreset, label: 'Dance', desc: 'Flowing sway' },
                  { id: 'still' as ClothMotionPreset, label: 'Still', desc: 'Static drape' },
                ].map((p) => {
                  const isSelected = clothConfig.preset === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => updateClothConfig({ preset: p.id, isSimulating: true })}
                      className={`p-1.5 rounded-xl border text-center transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold shadow-xs ring-1 ring-indigo-500/30'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      <span className="block text-[11px] truncate">{p.label}</span>
                      <span className="block text-[9px] text-slate-400 truncate">{p.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fabric Material Selection */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="flex items-center gap-1">
                  <Feather className="w-3.5 h-3.5 text-emerald-500" />
                  Fabric Weight & Texture
                </span>
                <span className="text-[10px] text-emerald-500 font-medium">
                  {FABRIC_PROPERTIES[clothConfig.fabricType].label}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'silk' as const, label: 'Silk / Chiffon' },
                    { id: 'cotton' as const, label: 'Cotton' },
                    { id: 'wool' as const, label: 'Tailored Wool' },
                    { id: 'leather' as const, label: 'Heavy Leather' },
                  ] as const
                ).map((f) => {
                  const isSelected = clothConfig.fabricType === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => updateClothConfig({ fabricType: f.id })}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold shadow-xs ring-1 ring-emerald-500/30'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      <span className="block text-[10px] font-bold">{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Gravity & Mass Section */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                <span className="font-medium flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  Downward Gravity & Mass
                </span>
                <span className="font-mono text-amber-600 dark:text-amber-400 font-semibold">{clothConfig.gravity.toFixed(2)}G</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.05"
                value={clothConfig.gravity}
                onChange={(e) => updateClothConfig({ gravity: Number(e.target.value) })}
                className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center gap-1.5 pt-0.5">
                {[
                  { label: 'Zero-G', val: 0.2 },
                  { label: 'Earth (0.55G)', val: 0.55 },
                  { label: 'Heavy Wool (1.20G)', val: 1.2 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => updateClothConfig({ gravity: preset.val })}
                    className={`flex-1 py-1 rounded text-[10px] font-medium border transition-colors ${
                      Math.abs(clothConfig.gravity - preset.val) < 0.05
                        ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Aerodynamic Air Resistance / Drag */}
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                <span className="font-medium flex items-center gap-1.5">
                  <Feather className="w-3.5 h-3.5 text-indigo-500" />
                  Aerodynamic Air Drag (Resistance)
                </span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">{clothConfig.airResistance ?? 65}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={clothConfig.airResistance ?? 65}
                onChange={(e) => updateClothConfig({ airResistance: Number(e.target.value) })}
                className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Opposing air resistance dampens fabric whipping and stabilizes natural body drape.
              </p>
            </div>

            {/* Wind Dynamics & Studio Fan */}
            <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                <span className="font-medium flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-cyan-400" />
                  Wind Velocity & Direction
                </span>
                <span className="font-mono text-cyan-500 font-semibold">
                  {clothConfig.windStrength > 0 ? `+${clothConfig.windStrength.toFixed(1)} m/s (Right)` : clothConfig.windStrength < 0 ? `${clothConfig.windStrength.toFixed(1)} m/s (Left)` : '0.0 m/s (Calm)'}
                </span>
              </div>
              <input
                type="range"
                min="-8"
                max="8"
                step="0.5"
                value={clothConfig.windStrength}
                onChange={(e) => updateClothConfig({ windStrength: Number(e.target.value) })}
                className="w-full accent-cyan-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />

              <div className="grid grid-cols-2 gap-3 pt-0.5">
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span>Air Turbulence</span>
                    <span className="font-mono text-cyan-400">{Math.round((clothConfig.windTurbulence || 0.4) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={clothConfig.windTurbulence || 0.4}
                    onChange={(e) => updateClothConfig({ windTurbulence: Number(e.target.value) })}
                    className="w-full accent-cyan-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span>Gust Frequency</span>
                    <span className="font-mono text-cyan-400">{(clothConfig.gustFrequency || 1.0).toFixed(1)} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="3.0"
                    step="0.2"
                    value={clothConfig.gustFrequency || 1.0}
                    onChange={(e) => updateClothConfig({ gustFrequency: Number(e.target.value) })}
                    className="w-full accent-cyan-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Studio Air Blower Fan Quick Toggle */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-cyan-50/60 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800/60 mt-1">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg transition-colors ${clothConfig.airFanActive ? 'bg-cyan-500 text-white animate-spin' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                    <Wind className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-800 dark:text-slate-200">Studio Wind Blower Fan</span>
                    <span className="block text-[10px] text-slate-500">Injects directional air gusts into garment hems</span>
                  </div>
                </div>
                <button
                  onClick={() => updateClothConfig({ airFanActive: !clothConfig.airFanActive })}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all border ${
                    clothConfig.airFanActive
                      ? 'border-cyan-500 bg-cyan-500 text-white shadow-xs'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {clothConfig.airFanActive ? 'ACTIVE (ON)' : 'OFF'}
                </button>
              </div>
            </div>

            {/* Diagnostic Toggles & Mesh Reset */}
            <div className="flex items-center justify-between pt-2 text-[11px] border-t border-slate-100 dark:border-slate-800/80">
              <span className="text-slate-500">Physics Tools:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateClothConfig({ showPhysicsWireframe: !clothConfig.showPhysicsWireframe })}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                    clothConfig.showPhysicsWireframe
                      ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300'
                      : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Spring Lattice
                </button>
                <button
                  onClick={() => updateClothConfig({ showTensionStress: !clothConfig.showTensionStress })}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                    clothConfig.showTensionStress
                      ? 'border-rose-500 bg-rose-950/60 text-rose-300'
                      : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Stress Heatmap
                </button>
                <button
                  onClick={handleResetPhysics}
                  title="Reset cloth physics meshes to initial rest positions"
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-indigo-400 hover:border-indigo-400 transition-colors"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: POSTURE & BODY MOVEMENT */}
        {inspectorTab === 'posture' && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/90 space-y-3 text-xs">
            {/* Interactive Posture Tilt / Lean Slider */}
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-300 mb-1">
                <span className="flex items-center gap-1 font-semibold">
                  <Compass className="w-3.5 h-3.5 text-indigo-500" />
                  Posture Lean / Tilt Angle
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-indigo-400 font-bold">
                    {clothConfig.postureTilt > 0 ? `+${clothConfig.postureTilt}°` : `${clothConfig.postureTilt}°`}
                  </span>
                  {clothConfig.postureTilt !== 0 && (
                    <button
                      onClick={() => updateClothConfig({ postureTilt: 0 })}
                      className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min="-22"
                max="22"
                step="1"
                value={clothConfig.postureTilt}
                onChange={(e) => updateClothConfig({ postureTilt: Number(e.target.value) })}
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                <span>Lean Left (-22°)</span>
                <span>Neutral (0°)</span>
                <span>Lean Right (+22°)</span>
              </div>
            </div>

            {/* Chest Breathing Expansion */}
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-300 mb-1">
                <span className="font-semibold">Chest Expansion / Inhalation</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {clothConfig.chestExpansion > 0 ? `+${clothConfig.chestExpansion}px` : `${clothConfig.chestExpansion}px`}
                </span>
              </div>
              <input
                type="range"
                min="-8"
                max="18"
                step="1"
                value={clothConfig.chestExpansion}
                onChange={(e) => updateClothConfig({ chestExpansion: Number(e.target.value) })}
                className="w-full accent-emerald-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Motion Speed Multiplier */}
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-300 mb-1">
                <span className="font-semibold">Dynamic Sway Speed</span>
                <span className="font-mono text-indigo-400 font-bold">
                  {clothConfig.motionSpeed.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.2"
                step="0.1"
                value={clothConfig.motionSpeed}
                onChange={(e) => updateClothConfig({ motionSpeed: Number(e.target.value) })}
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* TAB 3: SMART STITCH & PROPORTIONAL FIT */}
        {inspectorTab === 'fit' && activeFitted && activeAsset && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/80 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                Stitch & Proportions: {activeAsset.name}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Scale / Proportions with Pinch Callout */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                  <span className="flex items-center gap-1">
                    <Scale className="w-3 h-3 text-indigo-500" />
                    Proportional Scale
                  </span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                    {Math.round(activeFitted.scale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="2.2"
                  step="0.01"
                  value={activeFitted.scale}
                  onChange={(e) => updateActiveFitting({ scale: Number(e.target.value) })}
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Fit Tightness (Slim vs Relaxed) */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                  <span>Body Fit (Slim - Relaxed)</span>
                  <span className="font-mono">{activeFitted.fitTightness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={activeFitted.fitTightness}
                  onChange={(e) => updateActiveFitting({ fitTightness: Number(e.target.value) })}
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Micro Nudge Alignment */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500">Stitch Position Nudge</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateActiveFitting({ offsetX: activeFitted.offsetX - 4 })}
                  className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold"
                >
                  ←
                </button>
                <button
                  onClick={() => updateActiveFitting({ offsetX: activeFitted.offsetX + 4 })}
                  className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold"
                >
                  →
                </button>
                <button
                  onClick={() => updateActiveFitting({ offsetY: activeFitted.offsetY - 4 })}
                  className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold"
                >
                  ↑
                </button>
                <button
                  onClick={() => updateActiveFitting({ offsetY: activeFitted.offsetY + 4 })}
                  className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold"
                >
                  ↓
                </button>
                <button
                  onClick={() => updateActiveFitting({ offsetX: 0, offsetY: 0, rotation: 0 })}
                  className="px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200"
                >
                  Center
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
