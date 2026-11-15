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
  PanelRightOpen,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  SlidersHorizontal,
  Shield,
  Video,
  VideoOff,
} from 'lucide-react';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';
import { useFaceStudio } from '../context/FaceStudioContext';
import {
  BodyLandmarks,
  BodyMeasurements,
  ClothMotionPreset,
  ClothPhysicsConfig,
  ClothSimulationMetrics,
  FittedAsset,
  MaterialSurfaceSettings,
  WardrobeAsset,
  WardrobeCategory,
} from '../types/body';
import { getAssetClothingTagId } from '../utils/bodyAssets';
import {
  scanBodyAndMeasure,
  renderFittedAssetsOnBody,
  computeGarmentFitBox,
} from '../utils/bodyEngine';
import {
  ClothMeshState,
  DEFAULT_CLOTH_CONFIG,
  FABRIC_PROPERTIES,
  PendantPhysicsState,
  UserBodyMotionInput,
  buildBodyCollisionMesh,
  computePostureDynamics,
  createClothGrid,
  createPendantPhysics,
  getDefaultMaterialSurface,
  stepClothMesh,
  stepPendantPhysics,
} from '../utils/clothPhysicsEngine';
import { loadImage } from '../utils/faceEngine';

export const BodyFitStudio: React.FC = () => {
  const {
    targetImageElement,
    setTargetImageUrl,
    detectedFaces,
    outputCanvasRef,
    setShowExportModal,
    wardrobeAssets,
    addWardrobeAsset,
    openCustomAssetModal,
    removeWardrobeAsset,
    allClothingTags,
    viewMode,
    isInspectorOpen,
    setIsInspectorOpen,
  } = useFaceStudio();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetPhotoInputRef = useRef<HTMLInputElement>(null);
  const pinchTimeoutRef = useRef<number | null>(null);
  const [showTargetCamera, setShowTargetCamera] = useState(false);
  const [isMobileDeckOpen, setIsMobileDeckOpen] = useState(true);

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
  const [filterCategory, setFilterCategory] = useState<'all' | 'clothing' | 'jewelry' | 'object' | 'custom'>('all');
  const [clothingTagFilter, setClothingTagFilter] = useState<string>('all');
  const [inspectorTab, setInspectorTab] = useState<'fit' | 'physics' | 'posture'>('physics');

  // Cloth Physics & Motion Simulation State
  const [clothConfig, setClothConfig] = useState<ClothPhysicsConfig>(DEFAULT_CLOTH_CONFIG);
  const [interactionMode, setInteractionMode] = useState<'tug' | 'moveBody'>('tug');
  const [isTugging, setIsTugging] = useState<boolean>(false);
  const [isMovingBody, setIsMovingBody] = useState<boolean>(false);
  const [isMotionSyncActive, setIsMotionSyncActive] = useState<boolean>(false);
  const [motionSyncError, setMotionSyncError] = useState<string | null>(null);
  const [simMetrics, setSimMetrics] = useState<ClothSimulationMetrics>({
    avgTensionN: 0,
    peakStrainPct: 0,
    activeCollisions: 0,
    kineticEnergy: 0,
  });

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
  const lastMetricsPushRef = useRef<number>(0);

  // User Body Movement Refs (interactive canvas drag + optional webcam motion sync)
  const userMotionRef = useRef<UserBodyMotionInput>({
    shiftX: 0,
    shiftY: 0,
    tiltDeg: 0,
    turnDeg: 0,
  });
  const bodyDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isMovingBodyRef = useRef<boolean>(false);
  const isMotionSyncRef = useRef<boolean>(false);
  const motionStreamRef = useRef<MediaStream | null>(null);
  const motionVideoRef = useRef<HTMLVideoElement | null>(null);
  const motionBaselineRef = useRef<{ cx: number; cy: number } | null>(null);
  const motionSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
    if (!targetImageElement) {
      setBodyData(null);
      return;
    }
    const w = targetImageElement.naturalWidth || targetImageElement.width;
    const h = targetImageElement.naturalHeight || targetImageElement.height;
    const faceHint = detectedFaces[0]?.box;

    const scanned = scanBodyAndMeasure(w, h, faceHint);
    setBodyData(scanned);
  }, [targetImageElement, detectedFaces]);

  // Optional Webcam Body Motion Sync loop & cleanup
  useEffect(() => {
    isMotionSyncRef.current = isMotionSyncActive;
    if (!isMotionSyncActive) {
      if (motionStreamRef.current) {
        motionStreamRef.current.getTracks().forEach((track) => track.stop());
        motionStreamRef.current = null;
      }
      motionVideoRef.current = null;
      motionBaselineRef.current = null;
      return;
    }

    let cancelled = false;
    setMotionSyncError(null);

    navigator.mediaDevices
      ?.getUserMedia({
        video: { width: 160, height: 120, facingMode: 'user' },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        motionStreamRef.current = stream;
        const vid = document.createElement('video');
        vid.srcObject = stream;
        vid.muted = true;
        vid.playsInline = true;
        vid.play().catch(() => {});
        motionVideoRef.current = vid;

        if (!motionSampleCanvasRef.current) {
          const c = document.createElement('canvas');
          c.width = 32;
          c.height = 24;
          motionSampleCanvasRef.current = c;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMotionSyncError('Camera access unavailable for live motion tracking.');
          setIsMotionSyncActive(false);
        }
      });

    return () => {
      cancelled = true;
      if (motionStreamRef.current) {
        motionStreamRef.current.getTracks().forEach((track) => track.stop());
        motionStreamRef.current = null;
      }
      motionVideoRef.current = null;
      motionBaselineRef.current = null;
    };
  }, [isMotionSyncActive]);

  // 60 FPS Real-time Cloth Physics and Posture Simulation Animation Loop
  useEffect(() => {
    let isRunning = true;

    const loop = () => {
      if (!isRunning) return;

      if (targetImageElement && canvasRef.current && bodyData) {
        outputCanvasRef.current = canvasRef.current;
        const now = Date.now();
        const timeSec = (now - startTimeRef.current) / 1000;

        // 0. Sample webcam luminance centroid when Motion Sync is active, or gently spring back user drag motion
        if (
          isMotionSyncRef.current &&
          motionVideoRef.current &&
          motionVideoRef.current.readyState >= 2 &&
          motionSampleCanvasRef.current
        ) {
          const sCanvas = motionSampleCanvasRef.current;
          const sCtx = sCanvas.getContext('2d');
          if (sCtx) {
            sCtx.drawImage(motionVideoRef.current, 0, 0, sCanvas.width, sCanvas.height);
            const data = sCtx.getImageData(0, 0, sCanvas.width, sCanvas.height).data;
            let weightSum = 0;
            let sumX = 0;
            let sumY = 0;
            for (let y = 0; y < sCanvas.height; y++) {
              for (let x = 0; x < sCanvas.width; x++) {
                const idx = (y * sCanvas.width + x) * 4;
                const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
                const weight = luma * luma;
                weightSum += weight;
                sumX += (sCanvas.width - 1 - x) * weight; // mirrored natural webcam orientation
                sumY += y * weight;
              }
            }
            if (weightSum > 0) {
              const cx = sumX / weightSum / sCanvas.width;
              const cy = sumY / weightSum / sCanvas.height;
              if (!motionBaselineRef.current) {
                motionBaselineRef.current = { cx, cy };
              }
              const dx = cx - motionBaselineRef.current.cx;
              const dy = cy - motionBaselineRef.current.cy;
              const targetShiftX = Math.max(-36, Math.min(36, dx * 220));
              const targetShiftY = Math.max(-22, Math.min(22, dy * 150));
              const targetTilt = Math.max(-18, Math.min(18, dx * 95));
              const targetTurn = Math.max(-18, Math.min(18, dx * 110));

              const cur = userMotionRef.current;
              cur.shiftX += (targetShiftX - cur.shiftX) * 0.22;
              cur.shiftY += (targetShiftY - cur.shiftY) * 0.22;
              cur.tiltDeg += (targetTilt - cur.tiltDeg) * 0.22;
              cur.turnDeg += (targetTurn - cur.turnDeg) * 0.22;
            }
          }
        } else if (!isMovingBodyRef.current) {
          // Smooth damped spring-back when user finishes dragging body
          const cur = userMotionRef.current;
          cur.shiftX *= 0.88;
          cur.shiftY *= 0.88;
          cur.tiltDeg *= 0.88;
          cur.turnDeg *= 0.88;
          if (Math.abs(cur.shiftX) < 0.05) cur.shiftX = 0;
          if (Math.abs(cur.shiftY) < 0.05) cur.shiftY = 0;
          if (Math.abs(cur.tiltDeg) < 0.05) cur.tiltDeg = 0;
          if (Math.abs(cur.turnDeg) < 0.05) cur.turnDeg = 0;
        }

        // 1. Compute dynamic posture changes, arm/hip swing, 3D turn, breathing expansion & wind vector
        const posture = computePostureDynamics(
          timeSec,
          clothConfig,
          bodyData.landmarks,
          userMotionRef.current
        );

        // 2. Build anatomical body collision capsules matching the deformed skeleton
        const bodyColliders = buildBodyCollisionMesh(
          posture.dynamicLandmarks,
          posture.chestExp
        );

        // 3. Map current wardrobe assets
        const assetsMap: Record<string, WardrobeAsset> = {};
        wardrobeAssets.forEach((a) => (assetsMap[a.id] = a));

        // 4. Step physics simulation for each attached layer against body mesh & colliders
        if (clothConfig.enabled && clothConfig.isSimulating) {
          fittedAssets.forEach((item) => {
            if (!item.visible) return;
            const asset = assetsMap[item.assetId];
            const assetImg = cachedAssetImages[item.assetId];
            if (!asset || !assetImg) return;

            const isMeshClothing =
              asset.category === 'clothing' ||
              asset.anchorPoint === 'shoulders' ||
              asset.anchorPoint === 'chest' ||
              asset.anchorPoint === 'waist';

            if (isMeshClothing) {
              const geom = computeGarmentFitBox(posture.dynamicLandmarks, asset, assetImg, item);
              let mesh = clothMeshMapRef.current[item.assetId];

              // Re-initialize measurement-fitted mesh if dimensions, tightness, or garment type changed
              if (
                !mesh ||
                Math.abs(mesh.width - geom.targetW) > 4 ||
                Math.abs(mesh.height - geom.targetH) > 4 ||
                mesh.anchorMode !== geom.anchorMode ||
                mesh.garmentType !== geom.garmentType ||
                Math.abs(mesh.fitTightness - item.fitTightness) > 2
              ) {
                mesh = createClothGrid(
                  geom.centerX,
                  geom.topY,
                  geom.targetW,
                  geom.targetH,
                  8,
                  9,
                  Math.hypot(
                    geom.anchorRight.x - geom.anchorLeft.x,
                    geom.anchorRight.y - geom.anchorLeft.y
                  ),
                  geom.garmentType,
                  item.fitTightness,
                  geom.anchorMode
                );
                clothMeshMapRef.current[item.assetId] = mesh;
              }

              const assetFabricConfig: ClothPhysicsConfig = {
                ...clothConfig,
                fabricType: item.fabricType || asset.fabricType || clothConfig.fabricType,
              };

              stepClothMesh(
                mesh,
                assetFabricConfig,
                geom.anchorLeft,
                geom.anchorRight,
                posture.dynamicLandmarks,
                posture.wind,
                posture.chestExp,
                bodyColliders
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

        // 5. Render composite + optional body collider visualization to canvas
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
          pendantPhysicsMapRef.current,
          bodyColliders
        );

        // 6. Throttled metrics readout (~8Hz) for Cloth Physics inspector
        if (now - lastMetricsPushRef.current > 125) {
          lastMetricsPushRef.current = now;
          const activeMesh =
            clothMeshMapRef.current[selectedAssetId] ||
            Object.values(clothMeshMapRef.current)[0];
          if (activeMesh?.metrics) {
            setSimMetrics(activeMesh.metrics);
          }
        }
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
    selectedAssetId,
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

  // 4. Interactive Cloth Tug OR User Body Movement Drag on Canvas
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (!clothConfig.enabled || isDraggingCorner) return;

    if (interactionMode === 'moveBody') {
      bodyDragStartRef.current = { x: e.clientX, y: e.clientY };
      isMovingBodyRef.current = true;
      setIsMovingBody(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

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
    if (isMovingBody && bodyDragStartRef.current) {
      const dx = e.clientX - bodyDragStartRef.current.x;
      const dy = e.clientY - bodyDragStartRef.current.y;
      userMotionRef.current = {
        shiftX: Math.max(-48, Math.min(48, dx * 0.45)),
        shiftY: Math.max(-28, Math.min(28, dy * 0.35)),
        tiltDeg: Math.max(-20, Math.min(20, dx * 0.14)),
        turnDeg: Math.max(-20, Math.min(20, dx * 0.18)),
      };
      return;
    }

    if (!isTugging) return;
    const coords = getCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;

    const mesh = clothMeshMapRef.current[selectedAssetId];
    if (mesh && mesh.grabbedIndex !== null) {
      mesh.grabbedPoint = { x: coords.x, y: coords.y };
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    if (isMovingBody) {
      isMovingBodyRef.current = false;
      bodyDragStartRef.current = null;
      setIsMovingBody(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

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

  const handleUploadTargetPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setTargetImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const activeFitted = fittedAssets.find((f) => f.assetId === selectedAssetId);
  const activeAsset = wardrobeAssets.find((a) => a.id === selectedAssetId);

  const isClothingLayer = (asset?: WardrobeAsset) =>
    !!asset &&
    (asset.category === 'clothing' ||
      asset.anchorPoint === 'shoulders' ||
      asset.anchorPoint === 'chest' ||
      asset.anchorPoint === 'waist');

  const activeClothingFitted =
    (activeFitted && isClothingLayer(activeAsset) ? activeFitted : null) ||
    fittedAssets.find((f) => {
      if (!f.visible) return false;
      const a = wardrobeAssets.find((w) => w.id === f.assetId);
      return isClothingLayer(a);
    }) ||
    fittedAssets.find((f) => {
      const a = wardrobeAssets.find((w) => w.id === f.assetId);
      return isClothingLayer(a);
    });

  const activeClothingAsset = activeClothingFitted
    ? wardrobeAssets.find((a) => a.id === activeClothingFitted.assetId)
    : undefined;

  const activeSurface: MaterialSurfaceSettings =
    activeClothingFitted?.materialSurface ||
    getDefaultMaterialSurface(
      activeClothingFitted?.fabricType || activeClothingAsset?.fabricType || clothConfig.fabricType
    );

  const updateMaterialSurface = (partial: Partial<MaterialSurfaceSettings>) => {
    if (!activeClothingFitted) return;
    const targetId = activeClothingFitted.assetId;
    const nextSurface: MaterialSurfaceSettings = {
      ...activeSurface,
      ...partial,
    };
    setFittedAssets((prev) =>
      prev.map((f) => (f.assetId === targetId ? { ...f, materialSurface: nextSurface } : f))
    );
  };

  const resetMaterialSurface = () => {
    if (!activeClothingFitted) return;
    const targetId = activeClothingFitted.assetId;
    setFittedAssets((prev) =>
      prev.map((f) => {
        if (f.assetId !== targetId) return f;
        const { materialSurface: _removed, ...rest } = f;
        return rest;
      })
    );
  };

  const filteredAssets = wardrobeAssets.filter((a) => {
    if (filterCategory === 'custom') return a.isCustom;
    if (filterCategory === 'object') {
      return a.category === 'object' || a.category === 'accessory';
    }
    if (filterCategory === 'jewelry') return a.category === 'jewelry';
    if (filterCategory === 'clothing') {
      if (a.category !== 'clothing') return false;
      if (clothingTagFilter === 'all') return true;
      return getAssetClothingTagId(a) === clothingTagFilter;
    }
    if (clothingTagFilter !== 'all') {
      return a.category === 'clothing' && getAssetClothingTagId(a) === clothingTagFilter;
    }
    return true;
  });

  const scanInitialCategory: WardrobeCategory =
    filterCategory === 'jewelry'
      ? 'jewelry'
      : filterCategory === 'object'
      ? 'object'
      : 'clothing';

  const isSplitDesktop = viewMode === 'expanded';

  return (
    <div
      className={`flex-1 flex flex-col ${
        isSplitDesktop ? 'lg:flex-row' : ''
      } min-h-0 bg-slate-900/40 dark:bg-slate-950/80 relative select-none overflow-hidden`}
    >
      {/* Left / Main Body Fit Canvas Stage Column */}
      <div
        className={`flex-1 flex flex-col min-w-0 min-h-0 relative ${
          isSplitDesktop && isInspectorOpen ? 'lg:border-r border-slate-200 dark:border-slate-800' : ''
        }`}
      >
        {/* Top Measurements & Simulation Ribbon */}
        {bodyData && (
          <div className="px-3 sm:px-4 py-2 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md flex items-center justify-between gap-3 z-20 shrink-0">
            <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar text-xs">
              <span className="font-semibold text-slate-100 flex items-center gap-1.5 shrink-0">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                Body Scan
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-300 whitespace-nowrap">
                {bodyData.measurements.estimatedSize}
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-300 whitespace-nowrap">
                Shoulders {bodyData.measurements.shoulderWidthCm}cm
              </span>
              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-300 hidden sm:inline whitespace-nowrap">
                Chest {bodyData.measurements.chestBustCm}cm
              </span>
              {clothConfig.enabled && clothConfig.isSimulating && (
                <>
                  <span className="text-slate-600 hidden md:inline" aria-hidden="true">·</span>
                  <span className="text-[11px] font-medium text-emerald-400 capitalize hidden md:inline whitespace-nowrap">
                    {clothConfig.preset} Physics
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowScanHUD(!showScanHUD)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
                  showScanHUD
                    ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300'
                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
                <span>{showScanHUD ? 'Calipers On' : 'Calipers Off'}</span>
              </button>

              {isSplitDesktop && !isInspectorOpen && (
                <button
                  type="button"
                  onClick={() => setIsInspectorOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-100 text-[11px] font-semibold transition-colors whitespace-nowrap"
                >
                  <PanelRightOpen className="w-3.5 h-3.5" />
                  <span>Wardrobe &amp; Physics</span>
                </button>
              )}
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
          className={`flex-1 relative flex items-center justify-center p-2 sm:p-4 overflow-hidden touch-none min-h-0 ${
            clothConfig.enabled ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
        >
        {/* Floating Proportional Pinch Scale & Interaction HUD Badge */}
        {activeFitted && (
          <div
            className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full bg-slate-900/95 border border-indigo-500/50 backdrop-blur-md flex items-center gap-2 text-xs text-white shadow-xl transition-all duration-200 ${
              isPinching || isTugging || isMovingBody ? 'scale-105 opacity-100 ring-2 ring-indigo-400/40' : 'opacity-90'
            }`}
          >
            {isTugging ? (
              <>
                <Hand className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                <span className="font-semibold text-rose-300">Tugging Fabric Hem</span>
                <span className="text-[10px] text-slate-400">· Spring Tension Active</span>
              </>
            ) : isMovingBody ? (
              <>
                <Move className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span className="font-semibold text-cyan-300">Moving Body Posture</span>
                <span className="text-[10px] text-slate-400">· Cloth Drape &amp; Collision Active</span>
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

        {motionSyncError && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-lg bg-rose-950/90 border border-rose-500/50 text-[11px] text-rose-200 shadow-lg">
            {motionSyncError}
          </div>
        )}

        <input
          ref={targetPhotoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUploadTargetPhoto}
        />

        {!targetImageElement ? (
          <div className="max-w-md w-full mx-auto p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
              <ImagePlus className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-100">Load a Body / Portrait Photo</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Choose a photo from your gallery or take a photo with your camera to try on garments and jewelry.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => targetPhotoInputRef.current?.click()}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-md transition-colors whitespace-nowrap"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Gallery</span>
              </button>
              <button
                type="button"
                onClick={() => setShowTargetCamera(true)}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Camera</span>
              </button>
            </div>
          </div>
        ) : (
        <div className="relative max-h-full max-w-full flex items-center justify-center">
          <canvas
            ref={canvasRef}
            className="w-auto h-auto max-h-[60vh] md:max-h-[70vh] lg:max-h-[calc(100vh-10rem)] max-w-full object-contain rounded-2xl shadow-2xl block"
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
        )}

        {/* Floating Quick Action Overlay on Canvas */}
        {targetImageElement && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 bg-slate-900/90 border border-slate-700/80 rounded-xl p-1 backdrop-blur-md shadow-lg text-[11px]">
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
            onClick={() => setInteractionMode('tug')}
            className={`p-1.5 rounded-lg flex items-center gap-1 font-medium transition-colors ${
              interactionMode === 'tug'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white bg-slate-800'
            }`}
            title="Tug Fabric: Grab and pull clothing mesh directly"
          >
            <Hand className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tug Fabric</span>
          </button>

          {/* Interactive Move Body Toggle */}
          <button
            onClick={() => setInteractionMode('moveBody')}
            className={`p-1.5 rounded-lg flex items-center gap-1 font-medium transition-colors ${
              interactionMode === 'moveBody'
                ? 'bg-cyan-600 text-white'
                : 'text-slate-400 hover:text-white bg-slate-800'
            }`}
            title="Move Body: Drag to sway, tilt, and rotate body so cloth reacts dynamically"
          >
            <Move className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Move Body</span>
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
            <span className="hidden md:inline">{clothConfig.airFanActive ? 'Fan On' : 'Air Fan'}</span>
          </button>

          {/* Live Camera Motion Sync Toggle */}
          <button
            onClick={() => setIsMotionSyncActive((prev) => !prev)}
            className={`p-1.5 rounded-lg flex items-center gap-1 font-medium transition-colors ${
              isMotionSyncActive
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-white bg-slate-800'
            }`}
            title="Webcam Motion Sync: Track your live movement to sway garment physics"
          >
            {isMotionSyncActive ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            <span className="hidden lg:inline">{isMotionSyncActive ? 'Sync On' : 'Motion Sync'}</span>
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
        )}

        {/* Floating Zoom Step Buttons on Canvas */}
        {targetImageElement && activeFitted && (
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
      </div>

      {/* Wardrobe Tray & Comprehensive Physics Inspector Sidebar / Collapsible Drawer */}
      {(isInspectorOpen || !isSplitDesktop) && (
      <div
        className={`bg-white dark:bg-slate-900 border-t ${
          isSplitDesktop
            ? 'lg:border-t-0 lg:w-[400px] xl:w-[430px] lg:max-h-none'
            : ''
        } ${isMobileDeckOpen ? 'max-h-[42vh]' : ''} border-slate-200 dark:border-slate-800 flex flex-col z-20 shrink-0 transition-colors overflow-hidden`}
      >
        <button
          type="button"
          onClick={() => setIsMobileDeckOpen((prev) => !prev)}
          className={`${isSplitDesktop ? 'lg:hidden' : ''} w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0`}
        >
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
            <span>{isMobileDeckOpen ? 'Hide Wardrobe & Physics' : 'Wardrobe & Cloth Physics'}</span>
          </span>
          {isMobileDeckOpen ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronUp className="w-4 h-4 text-indigo-500" />
          )}
        </button>

        <div className={`${isMobileDeckOpen ? 'flex flex-col flex-1 min-h-0 overflow-y-auto' : isSplitDesktop ? 'hidden lg:flex lg:flex-col lg:flex-1 lg:min-h-0 lg:overflow-y-auto' : 'hidden'}`}>
        {/* Wardrobe Asset Picker Strip */}
        <div className="p-2.5 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          {/* Category Filter Chips */}
          <div className="flex items-center gap-1 shrink-0">
            {[
              { id: 'all' as const, label: 'All' },
              { id: 'clothing' as const, label: 'Clothes' },
              { id: 'jewelry' as const, label: 'Jewelry' },
              { id: 'object' as const, label: 'Objects' },
              {
                id: 'custom' as const,
                label: `Custom (${wardrobeAssets.filter((a) => a.isCustom).length})`,
              },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setFilterCategory(cat.id);
                  if (cat.id !== 'clothing' && cat.id !== 'all') {
                    setClothingTagFilter('all');
                  }
                }}
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

          {/* Action Buttons: Camera Scan & Gallery Studio */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => openCustomAssetModal(scanInitialCategory, 'camera')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 hover:brightness-110 text-white text-[11px] font-bold shadow-xs transition-transform active:scale-95"
              title="Scan cloth, jewelry, or object via camera"
            >
              <Camera className="w-3 h-3" />
              <span>Scan Asset</span>
            </button>

            <button
              onClick={() => openCustomAssetModal(scanInitialCategory, 'upload')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium hover:border-indigo-500 transition-colors"
              title="Upload cloth, jewelry, or object photo with edge cutout"
            >
              <Upload className="w-3 h-3" />
              <span>Gallery</span>
            </button>
          </div>
        </div>

        {/* Clothing Style Sub-Tabs (Suits, Shirts, Bikini, Dresses, Robes + Custom Tags) */}
        {(filterCategory === 'clothing' || filterCategory === 'all') && (
          <div className="px-2.5 py-1.5 bg-slate-50/80 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800/60 flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setClothingTagFilter('all')}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors ${
                clothingTagFilter === 'all'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              All Styles
            </button>
            {allClothingTags.map((tag) => {
              const count = wardrobeAssets.filter(
                (a) => a.category === 'clothing' && getAssetClothingTagId(a) === tag.id
              ).length;
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    setFilterCategory('clothing');
                    setClothingTagFilter(tag.id);
                  }}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                    clothingTagFilter === tag.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{tag.label}</span>
                  {count > 0 && (
                    <span className="text-[9px] opacity-75 font-mono">({count})</span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => openCustomAssetModal('clothing', 'upload')}
              className="px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-400/50 hover:bg-indigo-500/10"
              title="Scan or create a garment with a custom tag"
            >
              + Add / Tag
            </button>
          </div>
        )}

        {/* Assets Horizontal Scroll Strip */}
        <div className="p-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {filteredAssets.length === 0 ? (
            <div className="w-full py-3 px-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                No {clothingTagFilter !== 'all' ? clothingTagFilter : filterCategory} assets yet.
              </span>
              <button
                type="button"
                onClick={() => openCustomAssetModal(scanInitialCategory, 'camera')}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0"
              >
                + Scan &amp; Add
              </button>
            </div>
          ) : (
            filteredAssets.map((asset) => {
              const isFitted = fittedAssets.some((f) => f.assetId === asset.id && f.visible);
              const isSelected = selectedAssetId === asset.id;

              return (
                <div
                  key={asset.id}
                  onClick={() => {
                    setSelectedAssetId(asset.id);
                    if (!isFitted) toggleAttachAsset(asset.id);
                  }}
                  className={`min-w-[155px] p-2 rounded-xl border transition-all cursor-pointer flex items-center gap-2 relative group ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-xs ring-1 ring-indigo-500/30'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60'
                  }`}
                >
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
                    <span className="block text-[9px] text-slate-400 truncate capitalize">
                      {asset.category === 'clothing'
                        ? asset.clothingTag || asset.subCategory
                        : asset.subCategory}
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
            })
          )}
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

            {/* Material Surface: Normal Mapping & Specular Highlights */}
            {activeClothingFitted && activeClothingAsset && (
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Material Surface</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        Normal + Specular
                      </span>
                    </span>
                    <span className="block text-[10px] text-slate-400 truncate mt-0.5">
                      {activeClothingAsset.name}
                    </span>
                  </div>
                  {activeClothingFitted.materialSurface && (
                    <button
                      type="button"
                      onClick={resetMaterialSurface}
                      className="text-[10px] text-slate-400 hover:text-indigo-400 underline shrink-0"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Fabric Texture (Normal Map Relief Depth) */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                    <span>Fabric Texture (Normal Map)</span>
                    <span className="font-mono text-indigo-500 dark:text-indigo-400 font-semibold tabular-nums">
                      {Math.round(activeSurface.textureIntensity)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={activeSurface.textureIntensity}
                    onChange={(e) => updateMaterialSurface({ textureIntensity: Number(e.target.value) })}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Surface Roughness (Specular Lobe Width) */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                    <span>Roughness</span>
                    <span className="font-mono text-emerald-500 dark:text-emerald-400 font-semibold tabular-nums">
                      {Math.round(activeSurface.roughness)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={activeSurface.roughness}
                    onChange={(e) => updateMaterialSurface({ roughness: Number(e.target.value) })}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                    <span>Glossy Satin</span>
                    <span>Matte Weave</span>
                  </div>
                </div>

                {/* Specular Shine (Highlight & Fresnel Sheen) */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                    <span>Shine (Specular Highlight)</span>
                    <span className="font-mono text-amber-500 dark:text-amber-400 font-semibold tabular-nums">
                      {Math.round(activeSurface.shine)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={activeSurface.shine}
                    onChange={(e) => updateMaterialSurface({ shine: Number(e.target.value) })}
                    className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            )}

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

            {/* Physical Simulation Readout & Diagnostic Overlay Toggles */}
            <div className="space-y-2 pt-2 text-[11px] border-t border-slate-100 dark:border-slate-800/80">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="block text-[9px] text-slate-400 uppercase tracking-wider">Tension</span>
                  <span className="font-mono font-bold text-indigo-500 tabular-nums">
                    {simMetrics.avgTensionN.toFixed(1)} N
                  </span>
                </div>
                <div className="px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="block text-[9px] text-slate-400 uppercase tracking-wider">Peak Strain</span>
                  <span className="font-mono font-bold text-rose-500 tabular-nums">
                    {simMetrics.peakStrainPct.toFixed(1)}%
                  </span>
                </div>
                <div className="px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="block text-[9px] text-slate-400 uppercase tracking-wider">Collisions</span>
                  <span className="font-mono font-bold text-cyan-500 tabular-nums">
                    {simMetrics.activeCollisions} pts
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-slate-500">Physics View:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
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
                    onClick={() => updateClothConfig({ showBodyColliders: !clothConfig.showBodyColliders })}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border flex items-center gap-1 ${
                      clothConfig.showBodyColliders
                        ? 'border-purple-500 bg-purple-950/60 text-purple-300'
                        : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                    title="Visualize body mesh capsules & cloth contact points"
                  >
                    <Shield className="w-2.5 h-2.5" />
                    Body Mesh
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

            {/* 3D Body Turn / Yaw Rotation */}
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-300 mb-1">
                <span className="font-semibold">3D Body Turn (Yaw)</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-cyan-400 font-bold">
                    {clothConfig.postureTurn > 0 ? `+${clothConfig.postureTurn}°` : `${clothConfig.postureTurn}°`}
                  </span>
                  {clothConfig.postureTurn !== 0 && (
                    <button
                      onClick={() => updateClothConfig({ postureTurn: 0 })}
                      className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={clothConfig.postureTurn}
                onChange={(e) => updateClothConfig({ postureTurn: Number(e.target.value) })}
                className="w-full accent-cyan-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                <span>Turn Left (-20°)</span>
                <span>Front (0°)</span>
                <span>Turn Right (+20°)</span>
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

            <div className="flex items-center justify-between pt-1 border-t border-slate-200/70 dark:border-slate-800">
              <span className="text-[10px] text-slate-500">
                Tip: Switch to <strong className="text-cyan-400">Move Body</strong> or <strong className="text-amber-400">Motion Sync</strong> on canvas to drive live collisions.
              </span>
              <button
                type="button"
                onClick={() =>
                  updateClothConfig({
                    postureTilt: 0,
                    postureTurn: 0,
                    chestExpansion: 0,
                    motionSpeed: 1.0,
                  })
                }
                className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[10px] font-medium text-slate-600 dark:text-slate-300 hover:border-indigo-500 shrink-0"
              >
                Reset Pose
              </button>
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
      )}

      <WebcamCaptureDialog
        isOpen={showTargetCamera}
        mode="photo"
        onClose={() => setShowTargetCamera(false)}
        onCapture={(dataUrl) => setTargetImageUrl(dataUrl)}
      />
    </div>
  );
};
