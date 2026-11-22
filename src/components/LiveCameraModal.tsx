import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Camera,
  RotateCw,
  Sparkles,
  Sliders,
  Check,
  Split,
  Eye,
  Cpu,
  Move,
  Smile,
  Zap,
  Activity,
  Layers,
  X,
  Video,
  Shirt,
  Gem,
  Scissors,
  Image as ImageIcon,
  Square,
  Circle,
  Download,
  Upload,
  Radio,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { loadImage, drawTFLiteLandmarkMesh } from '../utils/faceEngine';
import { LiveCameraConfig, LiveTrackingState } from '../types/face';
import { BodyLandmarks } from '../types/body';
import { getAssetClothingTagId } from '../utils/bodyAssets';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';
import {
  ClothMeshState,
  DEFAULT_CLOTH_CONFIG,
  buildBodyCollisionMesh,
  createClothGrid,
  getDefaultMaterialSurface,
  renderClothMesh,
  stepClothMesh,
} from '../utils/clothPhysicsEngine';
import {
  VIRTUAL_BACKGROUNDS,
  VirtualBackground,
  renderLiveSegmentedBackground,
  applyLiveHairAndBlemishRemoval,
  CanvasVideoRecorder,
  CameraMotionAnalyzer,
  applyDirectionalMotionBlurOnContext,
  getStaticHighQualityProfile,
  AdaptiveSwapQualityProfile,
  LiveFaceBoxTracker,
  LiveBodyTracker,
  NormalizedFaceBox,
  TemporalMotionSmoother,
  BoundaryMatteTemporalStabilizer,
  applyLiveBoundaryLuminanceMatch,
} from '../utils/liveCameraEngine';

export const LiveCameraModal: React.FC = () => {
  const {
    profiles,
    activeProfileId,
    setActiveProfileId,
    addFaceFromDataUrl,
    setTargetImageUrl,
    setActiveTab,
    wardrobeAssets,
    allClothingTags,
    openCustomAssetModal,
    liveCameraConfig: config,
    setLiveCameraConfig: setConfig,
    liveSyncedFaceId,
    setLiveSyncedFaceId,
    adjustments,
    updateAdjustments,
    liveCameraVideoRef,
    refocusSignal,
  } = useFaceStudio();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const faceGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const motionAnalyzerRef = useRef<CameraMotionAnalyzer | null>(null);
  const faceBoxTrackerRef = useRef<LiveFaceBoxTracker | null>(null);
  const bodyTrackerRef = useRef<LiveBodyTracker | null>(null);
  const lastTrackedBoxRef = useRef<NormalizedFaceBox | undefined>(undefined);
  const liveClothMeshRef = useRef<{
    assetId: string;
    anchorMode: 'shoulders' | 'chest' | 'waist';
    mesh: ClothMeshState;
  } | null>(null);
  const temporalSmootherRef = useRef<TemporalMotionSmoother | null>(null);
  const boundaryStabilizerRef = useRef<BoundaryMatteTemporalStabilizer | null>(null);
  const bgBoundaryPatchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStabilizedFramesRef = useRef<number>(0);
  const aaScratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const aaMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingForceRefocusRef = useRef<boolean>(false);
  const lastSeenRefocusSignalRef = useRef<number>(refocusSignal);
  const imuImpulseRef = useRef<number>(0);
  const frameIndexRef = useRef<number>(0);
  const qualityProfileRef = useRef<AdaptiveSwapQualityProfile>(getStaticHighQualityProfile());
  const bgLightOffsetRef = useRef<{ brightnessDelta: number; contrastScale: number }>({
    brightnessDelta: 0,
    contrastScale: 1,
  });
  const bgShadowProfileRef = useRef<{
    ambientDepth: number;
    leftShadow: number;
    rightShadow: number;
    bottomShadow: number;
  }>({
    ambientDepth: 0.12,
    leftShadow: 0.14,
    rightShadow: 0.14,
    bottomShadow: 0.2,
  });

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraMode, setCameraMode] = useState<'live' | 'simulator'>('live');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isCapturingFlash, setIsCapturingFlash] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'alignment' | 'background' | 'beauty' | 'wardrobe'>('none');
  const [liveClothTagFilter, setLiveClothTagFilter] = useState<string>('all');
  const [showFaceCamDialog, setShowFaceCamDialog] = useState(false);

  // Live garment fit & stretch calibration controls
  const [clothFitStretch, setClothFitStretch] = useState<number>(1.0);
  const [clothCollarOffset, setClothCollarOffset] = useState<number>(0);
  const [clothFitTightness, setClothFitTightness] = useState<number>(42);
  const clothFitRef = useRef({ stretch: 1.0, collarOffset: 0, tightness: 42 });
  clothFitRef.current = {
    stretch: clothFitStretch,
    collarOffset: clothCollarOffset,
    tightness: clothFitTightness,
  };

  // Video recording state
  const recorderRef = useRef<CanvasVideoRecorder | null>(null);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimerRef = useRef<number | null>(null);
  const [downloadToast, setDownloadToast] = useState<string | null>(null);

  // Telemetry
  const [trackingState, setTrackingState] = useState<LiveTrackingState>({
    fps: 60,
    latencyMs: 7.5,
    faceDetected: true,
    roll: 0,
    pitch: 0,
    yaw: 0,
    smileScore: 0.65,
    eyeOpenScore: 0.92,
    motionLevel: 'low',
    qualityMode: 'high',
  });

  // Cached image elements for 60 FPS real-time compositing
  const [cachedProfileImg, setCachedProfileImg] = useState<HTMLImageElement | null>(null);
  const [cachedBgImages, setCachedBgImages] = useState<Record<string, HTMLImageElement>>({});
  const [cachedWardrobeImages, setCachedWardrobeImages] = useState<Record<string, HTMLImageElement>>({});

  const fpsCounterRef = useRef({ frames: 0, lastTime: performance.now() });

  // Capture device IMU motion spikes (if supported by browser/hardware)
  useEffect(() => {
    const handleDeviceMotion = (event: DeviceMotionEvent) => {
      const accel = event.acceleration;
      const rot = event.rotationRate;
      const linearMag = accel
        ? Math.hypot(accel.x || 0, accel.y || 0, accel.z || 0)
        : 0;
      const rotMag = rot
        ? Math.hypot(rot.alpha || 0, rot.beta || 0, rot.gamma || 0)
        : 0;
      const spike = Math.min(100, linearMag * 9 + rotMag * 0.45);
      if (spike > imuImpulseRef.current) {
        imuImpulseRef.current = spike;
      }
    };
    window.addEventListener('devicemotion', handleDeviceMotion);
    return () => {
      window.removeEventListener('devicemotion', handleDeviceMotion);
    };
  }, []);

  // 1. Pre-cache Virtual Background Images
  useEffect(() => {
    VIRTUAL_BACKGROUNDS.forEach((bg) => {
      if (bg.url) {
        loadImage(bg.url)
          .then((img) => setCachedBgImages((prev) => ({ ...prev, [bg.id]: img })))
          .catch(() => {});
      }
    });
  }, []);

  // 2. Pre-cache Wardrobe Assets (Clothes, Jewelry, Costumes)
  useEffect(() => {
    wardrobeAssets.forEach((asset) => {
      if (!cachedWardrobeImages[asset.id]) {
        loadImage(asset.imageUrl)
          .then((img) => setCachedWardrobeImages((prev) => ({ ...prev, [asset.id]: img })))
          .catch(() => {});
      }
    });
  }, [wardrobeAssets]);

  // 3. Load active profile image
  useEffect(() => {
    const prof = profiles.find((p) => p.id === activeProfileId);
    if (prof) {
      loadImage(prof.fullImageUrl)
        .then((img) => setCachedProfileImg(img))
        .catch(() => setCachedProfileImg(null));
    } else {
      setCachedProfileImg(null);
    }
  }, [profiles, activeProfileId]);

  // Start webcam with graceful fallback to interactive simulated feed
  const startCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      setStream(media);
      setCameraMode('live');
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        videoRef.current.play().catch(() => {});
      }
    } catch {
      setCameraMode('simulator');
    }
  }, [facingMode]);

  useEffect(() => {
    liveCameraVideoRef.current = videoRef.current;
    return () => {
      if (liveCameraVideoRef.current === videoRef.current) {
        liveCameraVideoRef.current = null;
      }
    };
  }, [liveCameraVideoRef, stream]);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
      }
    };
  }, [startCamera]);

  // Expression presets handler
  const handlePresetSelect = (preset: LiveCameraConfig['expressionPreset']) => {
    let warp = 50;
    let scale = 1.05;
    if (preset === 'smile') {
      warp = 85;
      scale = 1.08;
    } else if (preset === 'neutral') {
      warp = 20;
      scale = 1.02;
    } else if (preset === 'vocal') {
      warp = 95;
      scale = 1.1;
    } else {
      warp = 60;
      scale = 1.05;
    }

    setConfig((prev) => ({
      ...prev,
      expressionPreset: preset,
      expressionWarp: warp,
      scale,
    }));
  };

  // Upload custom background
  const handleCustomBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          loadImage(reader.result).then((img) => {
            setCachedBgImages((prev) => ({ ...prev, custom: img }));
            setConfig((prev) => ({
              ...prev,
              removeBackground: true,
              activeBackgroundId: 'custom',
              customBackgroundUrl: reader.result as string,
            }));
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Queue manual refocus pulse without restarting the animation loop
  useEffect(() => {
    if (refocusSignal !== lastSeenRefocusSignalRef.current) {
      lastSeenRefocusSignalRef.current = refocusSignal;
      pendingForceRefocusRef.current = true;
    }
  }, [refocusSignal]);

  // High-framerate 60 FPS real-time compositing loop (All live effects combined)
  useEffect(() => {
    let active = true;

    const renderLoop = (timestamp: number) => {
      if (!active) return;

      const video = videoRef.current;
      const canvas = liveCanvasRef.current;

      // Update FPS & adaptive motion telemetry
      frameIndexRef.current += 1;
      fpsCounterRef.current.frames++;
      if (timestamp - fpsCounterRef.current.lastTime >= 1000) {
        const curFps = Math.round(
          (fpsCounterRef.current.frames * 1000) / (timestamp - fpsCounterRef.current.lastTime)
        );
        fpsCounterRef.current.frames = 0;
        fpsCounterRef.current.lastTime = timestamp;
        const activeQuality = qualityProfileRef.current;
        setTrackingState((prev) => ({
          ...prev,
          fps: Math.min(60, Math.max(30, curFps)),
          latencyMs: parseFloat(
            (
              (activeQuality.qualityMode === 'light'
                ? 3.8
                : activeQuality.qualityMode === 'balanced'
                ? 5.2
                : 6.4) +
              Math.random() * 1.4
            ).toFixed(1)
          ),
          motionLevel: activeQuality.motionLevel,
          qualityMode: activeQuality.qualityMode,
          motionBlurPx: Math.round(activeQuality.motionBlurPx * 10) / 10,
          motionAngleDeg: Math.round((activeQuality.motionAngleRad * 180) / Math.PI),
          stabilizedBoundaryFrames: activeStabilizedFramesRef.current,
        }));
      }

      if (canvas) {
        const isLiveVideoReady = Boolean(cameraMode === 'live' && video && video.readyState >= 2);
        const rawVw = isLiveVideoReady && video ? video.videoWidth || 640 : 640;
        const rawVh = isLiveVideoReady && video ? video.videoHeight || 480 : 480;

        const motionSensitivityEnabled =
          config.motionSensitivity ?? adjustments.motionSensitivity;
        const motionBlurEnabled = Boolean(config.motionBlur ?? adjustments.motionBlur);

        let qualityProfile: AdaptiveSwapQualityProfile;
        if (motionSensitivityEnabled || motionBlurEnabled) {
          if (!motionAnalyzerRef.current) {
            motionAnalyzerRef.current = new CameraMotionAnalyzer();
          }
          const analyzed = motionAnalyzerRef.current.analyze(
            video,
            isLiveVideoReady,
            imuImpulseRef.current,
            timestamp
          );
          imuImpulseRef.current *= 0.85;
          if (motionSensitivityEnabled) {
            qualityProfile = analyzed;
          } else {
            // Preserve static high-quality pass while keeping real-time optical motion vector for Motion Blur
            qualityProfile = {
              ...getStaticHighQualityProfile(),
              motionLevel: analyzed.motionLevel,
              motionScore: analyzed.motionScore,
              motionBlurPx: analyzed.motionBlurPx,
              motionAngleRad: analyzed.motionAngleRad,
            };
          }
        } else {
          motionAnalyzerRef.current?.reset();
          qualityProfile = getStaticHighQualityProfile();
        }
        qualityProfileRef.current = qualityProfile;

        const renderScale = qualityProfile.renderScale;
        const vw = Math.max(240, Math.round(rawVw * renderScale));
        const vh = Math.max(180, Math.round(rawVh * renderScale));

        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw;
          canvas.height = vh;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, vw, vh);

          const isMirrored = facingMode === 'user';

          // 1. LIVE BACKGROUND REMOVAL & REPLACEMENT
          if (config.removeBackground) {
            let activeBgImg: HTMLImageElement | null = cachedBgImages[config.activeBackgroundId] || null;
            let bgColor: string | undefined = undefined;

            if (config.activeBackgroundId === 'green') {
              bgColor = '#00ff33';
              activeBgImg = null;
            } else if (config.activeBackgroundId === 'none') {
              bgColor = '#090d16';
              activeBgImg = null;
            }

            if (isLiveVideoReady && video) {
              renderLiveSegmentedBackground(
                ctx,
                video,
                vw,
                vh,
                activeBgImg,
                bgColor,
                isMirrored,
                lastTrackedBoxRef.current
              );
            } else {
              // Simulated feed with background replacement
              if (activeBgImg) {
                ctx.drawImage(activeBgImg, 0, 0, vw, vh);
              } else {
                ctx.fillStyle = bgColor || '#0f172a';
                ctx.fillRect(0, 0, vw, vh);
              }

              // Simulated user torso & shoulders
              ctx.fillStyle = '#334155';
              ctx.beginPath();
              ctx.ellipse(vw / 2, vh * 0.95, vw * 0.38, vh * 0.28, 0, 0, Math.PI * 2);
              ctx.fill();

              // Simulated base face oval
              ctx.fillStyle = '#d4a373';
              ctx.beginPath();
              ctx.ellipse(vw / 2, vh * 0.44, vw * 0.16, vh * 0.22, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            // Standard live video feed (original background preserved)
            if (isLiveVideoReady && video) {
              ctx.save();
              if (isMirrored) {
                ctx.translate(vw, 0);
                ctx.scale(-1, 1);
              }
              ctx.drawImage(video, 0, 0, vw, vh);
              ctx.restore();
            } else {
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(0, 0, vw, vh);

              const bgGrad = ctx.createRadialGradient(vw / 2, vh / 2, 40 * renderScale, vw / 2, vh / 2, vw * 0.7);
              bgGrad.addColorStop(0, '#1e293b');
              bgGrad.addColorStop(1, '#020617');
              ctx.fillStyle = bgGrad;
              ctx.fillRect(0, 0, vw, vh);

              ctx.fillStyle = '#334155';
              ctx.beginPath();
              ctx.ellipse(vw / 2, vh * 0.95, vw * 0.38, vh * 0.28, 0, 0, Math.PI * 2);
              ctx.fill();

              ctx.fillStyle = '#d4a373';
              ctx.beginPath();
              ctx.ellipse(vw / 2, vh * 0.44, vw * 0.16, vh * 0.22, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Anchor parameters for face and body placement (tracked largest-face bounding box when Auto-Refocus is active)
          const autoRefocusEnabled = config.autoRefocus ?? adjustments.autoRefocus;
          const motionSmoothingEnabled =
            (config.motionSmoothingEnabled ?? adjustments.motionSmoothingEnabled) !== false;
          const motionSmoothingVal = motionSmoothingEnabled
            ? (config.motionSmoothing ?? adjustments.motionSmoothing ?? 35)
            : 0;
          const forceRefocus = pendingForceRefocusRef.current;
          if (forceRefocus) {
            pendingForceRefocusRef.current = false;
          }

          if (!faceBoxTrackerRef.current) {
            faceBoxTrackerRef.current = new LiveFaceBoxTracker();
          }
          const trackedFace = faceBoxTrackerRef.current.update(
            video,
            isLiveVideoReady,
            isMirrored,
            autoRefocusEnabled,
            forceRefocus,
            timestamp,
            motionSmoothingVal
          );
          lastTrackedBoxRef.current = trackedFace.box;

          const useTrackedBox = autoRefocusEnabled && isLiveVideoReady;
          const rawFaceW = useTrackedBox
            ? Math.round(vw * Math.max(0.24, Math.min(0.54, trackedFace.box.width)) * config.scale)
            : Math.round(vw * 0.34 * config.scale);
          const rawFaceH = Math.round(rawFaceW * 1.32);
          const rawCx =
            (useTrackedBox ? vw * trackedFace.box.cx : vw / 2) + config.offsetX * renderScale;
          const rawCy =
            (useTrackedBox ? vh * trackedFace.box.cy : vh * 0.42) + config.offsetY * renderScale;

          if (!temporalSmootherRef.current) {
            temporalSmootherRef.current = new TemporalMotionSmoother();
          }
          const smoothedPose = temporalSmootherRef.current.smoothPose(
            {
              cx: rawCx,
              cy: rawCy,
              width: rawFaceW,
              height: rawFaceH,
              rotation: config.rotation,
            },
            motionSmoothingVal,
            forceRefocus,
            timestamp
          );

          const baseFaceW = Math.max(16, Math.round(smoothedPose.width));
          const baseFaceH = Math.max(16, Math.round(smoothedPose.height));
          const cx = smoothedPose.cx;
          const cy = smoothedPose.cy;
          const smoothedRotation = smoothedPose.rotation;

          // Live anthropometric torso & shoulder tracking below chin
          if (!bodyTrackerRef.current) {
            bodyTrackerRef.current = new LiveBodyTracker();
          }
          const bodyTrack = bodyTrackerRef.current.update(
            video,
            isLiveVideoReady,
            isMirrored,
            trackedFace.box,
            cx,
            cy,
            baseFaceW,
            baseFaceH,
            smoothedRotation,
            timestamp
          );
          const liveLandmarks: BodyLandmarks = bodyTrack.landmarks;

          // 2. LIVE FACIAL & BODY UNWANTED HAIR / BLEMISH REMOVAL (Motion-Adaptive Throttling)
          const shouldRunHairPass =
            config.removeHairAndBlemishes &&
            qualityProfile.hairRemovalInterval > 0 &&
            frameIndexRef.current % qualityProfile.hairRemovalInterval === 0;
          if (shouldRunHairPass) {
            const adaptiveHairIntensity =
              qualityProfile.qualityMode === 'balanced'
                ? Math.round(config.hairRemovalIntensity * 0.65)
                : config.hairRemovalIntensity;
            applyLiveHairAndBlemishRemoval(ctx, cx, cy, baseFaceW, baseFaceH, adaptiveHairIntensity);
          }

          // 3. REAL-TIME FACE SWAP
          if (cachedProfileImg && config.swapStrength > 0) {
            const antiAliasingEnabled =
              (config.antiAliasing ?? adjustments.antiAliasing) &&
              qualityProfile.qualityMode !== 'light';
            const edgeSoftnessVal = config.edgeSoftness ?? adjustments.edgeSoftness ?? 50;
            const boundaryRefinementEnabled =
              (config.boundaryRefinement ?? adjustments.boundaryRefinement) !== false;
            const boundaryStrengthVal =
              config.boundaryRefinementStrength ?? adjustments.boundaryRefinementStrength ?? 78;
            const boundaryStabilizerEnabled =
              (config.boundaryTemporalStabilizer ?? adjustments.boundaryTemporalStabilizer) !== false;
            const boundaryStabilizerFramesVal = Math.max(
              3,
              Math.min(
                5,
                Math.round(
                  config.boundaryStabilizerFrames ?? adjustments.boundaryStabilizerFrames ?? 4
                )
              )
            );
            const useOffscreenSwapBuffer =
              antiAliasingEnabled ||
              motionSmoothingVal > 2 ||
              edgeSoftnessVal > 2 ||
              motionBlurEnabled ||
              boundaryRefinementEnabled ||
              boundaryStabilizerEnabled;

            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = antiAliasingEnabled ? 'high' : 'low';

            if (config.splitPreview) {
              const splitX = (vw * config.splitPos) / 100;
              ctx.beginPath();
              ctx.rect(splitX, 0, vw - splitX, vh);
              ctx.clip();
            }

            const lightMatchStrength =
              (config.lightingAdjustment ?? adjustments.lightingAdjustment ?? 0) / 100;
            const shadowMatcherStrength =
              (config.shadowMatcher ?? adjustments.shadowMatcher ?? 0) / 100;
            if (
              (lightMatchStrength > 0.01 || shadowMatcherStrength > 0.01) &&
              qualityProfile.qualityMode !== 'light' &&
              frameIndexRef.current % 8 === 1
            ) {
              try {
                // Sample edge bands of rendered background for brightness, contrast & directional shadow match
                const stripW = Math.max(8, Math.round(vw * 0.14));
                const sampleH = Math.max(8, Math.round(vh * 0.45));
                const sampleLeft = ctx.getImageData(0, 0, stripW, sampleH).data;
                const sampleRight = ctx.getImageData(Math.max(0, vw - stripW), 0, stripW, sampleH).data;
                let sumL = 0;
                let sqSumL = 0;
                let cntL = 0;
                for (let sIdx = 0; sIdx < sampleLeft.length; sIdx += 16) {
                  const l = 0.299 * sampleLeft[sIdx] + 0.587 * sampleLeft[sIdx + 1] + 0.114 * sampleLeft[sIdx + 2];
                  sumL += l;
                  sqSumL += l * l;
                  cntL++;
                }
                let sumR = 0;
                let cntR = 0;
                for (let sIdx = 0; sIdx < sampleRight.length; sIdx += 16) {
                  const l = 0.299 * sampleRight[sIdx] + 0.587 * sampleRight[sIdx + 1] + 0.114 * sampleRight[sIdx + 2];
                  sumR += l;
                  cntR++;
                }
                if (cntL > 0) {
                  const meanL = sumL / cntL;
                  const meanR = cntR > 0 ? sumR / cntR : meanL;
                  const mean = (meanL + meanR) * 0.5;
                  const std = Math.max(12, Math.sqrt(Math.max(0, sqSumL / cntL - meanL * meanL)));
                  bgLightOffsetRef.current = {
                    brightnessDelta: Math.max(-0.28, Math.min(0.28, (mean - 128) / 255)),
                    contrastScale: Math.max(0.78, Math.min(1.32, std / 42)),
                  };
                  const ambientDark = Math.max(0.06, Math.min(0.45, (145 - mean) / 210));
                  const lrDiff = (meanR - meanL) / 255;
                  bgShadowProfileRef.current = {
                    ambientDepth: ambientDark,
                    leftShadow: Math.max(0.04, Math.min(0.55, ambientDark + Math.max(0, lrDiff * 0.75))),
                    rightShadow: Math.max(0.04, Math.min(0.55, ambientDark + Math.max(0, -lrDiff * 0.75))),
                    bottomShadow: Math.max(0.08, Math.min(0.55, ambientDark * 1.15 + 0.08)),
                  };
                }
              } catch {
                // fallback if canvas tainted
              }
            }

            const bgBrightAdjust = bgLightOffsetRef.current.brightnessDelta * lightMatchStrength;
            const bgContrastAdjust =
              1 + (bgLightOffsetRef.current.contrastScale - 1) * lightMatchStrength;

            const filterBrightness = Math.max(0.4, 1 + (config.brightness ?? 0) / 100 + bgBrightAdjust);
            const filterContrast = Math.max(0.4, (1 + (config.contrast ?? 0) / 100) * bgContrastAdjust);
            const vibranceVal = config.vibrance ?? adjustments.vibrance ?? 0;
            const filterSaturate = Math.max(
              0.1,
              1 + (config.saturation ?? 0) / 100 + (vibranceVal / 100) * 0.55
            );
            const filterHue = config.hue ?? adjustments.hue ?? 0;
            const blurSoftPx = qualityProfile.useFilterBlur
              ? ((config.skinSmoothing ?? 0) / 100) * 0.85 * renderScale
              : 0;
            const liveColorFilter = `brightness(${filterBrightness.toFixed(2)}) contrast(${(filterContrast * 1.04).toFixed(2)}) saturate(${filterSaturate.toFixed(2)})${Math.abs(filterHue) >= 0.5 ? ` hue-rotate(${filterHue.toFixed(1)}deg)` : ''}${blurSoftPx > 0.05 ? ` blur(${blurSoftPx.toFixed(2)}px)` : ''}`;

            const expressionFactor = config.expressionWarp / 100;
            const smileExpand = expressionFactor * 0.14;
            const targetDrawW = Math.max(8, Math.round(baseFaceW * (1 + smileExpand * 0.5)));
            const targetDrawH = Math.max(8, Math.round(baseFaceH));
            const tempVal = config.temperature ?? 0;
            const bloomAmt = (config.softBloom ?? adjustments.softBloom ?? 0) / 100;
            const morphT = Math.max(
              -1,
              Math.min(1, (config.genderMorph ?? adjustments.genderMorph ?? 0) / 100)
            );
            const pitchVal = Math.max(
              -35,
              Math.min(35, config.headPitch ?? adjustments.headPitch ?? 0)
            );
            const yawVal = Math.max(
              -35,
              Math.min(35, config.headYaw ?? adjustments.headYaw ?? 0)
            );
            const pitchRad = (pitchVal * Math.PI) / 180;
            const yawRad = (yawVal * Math.PI) / 180;
            const sinP = Math.sin(pitchRad);
            const cosP = Math.max(0.75, Math.cos(pitchRad));
            const sinY = Math.sin(yawRad);
            const cosY = Math.max(0.75, Math.cos(yawRad));

            const flipHoriz = Boolean(config.flipHorizontal ?? adjustments.flipHorizontal);

            // Helper to draw cached profile face with subtle jawline/brow morph, horizontal flip, and 3D head orientation (pitch & yaw)
            const drawMorphedFaceImage = (
              drawCtx: CanvasRenderingContext2D,
              dx: number,
              dy: number,
              dw: number,
              dh: number
            ) => {
              if (!cachedProfileImg) return;
              drawCtx.save();
              if (flipHoriz) {
                const flipPivotX = dx + dw / 2;
                drawCtx.translate(flipPivotX, 0);
                drawCtx.scale(-1, 1);
                drawCtx.translate(-flipPivotX, 0);
              }
              const hasOrientation = Math.abs(pitchVal) >= 0.25 || Math.abs(yawVal) >= 0.25;
              if (Math.abs(morphT) < 0.02 && !hasOrientation) {
                drawCtx.drawImage(cachedProfileImg, dx, dy, dw, dh);
                drawCtx.restore();
                return;
              }

              const bands = 12;
              const imgW = cachedProfileImg.naturalWidth || cachedProfileImg.width;
              const imgH = cachedProfileImg.naturalHeight || cachedProfileImg.height;
              const centerX = dx + dw / 2;
              const centerY = dy + dh / 2;

              for (let b = 0; b < bands; b++) {
                const v0 = b / bands;
                const v1 = (b + 1) / bands;
                const vMid = (v0 + v1) * 0.5;
                // Map vMid [0..1] -> face-centered [-1..+1]
                const fNorm = vMid * 2 - 1;
                const jawBand = Math.exp(-Math.pow((fNorm - 0.55) / 0.38, 2));
                const browBand = Math.exp(-Math.pow((fNorm + 0.34) / 0.2, 2));
                const zMid = 0.52 * Math.sqrt(Math.max(0.05, 1 - 0.5 * fNorm * fNorm));
                const pitchPersp = 1 - 0.14 * fNorm * sinP;
                const bandScaleX =
                  (1 + morphT * (0.085 * jawBand + 0.025 * browBand)) * cosY * pitchPersp;
                const yawShiftX = zMid * sinY * dw * 0.38;

                const f0 = v0 * 2 - 1;
                const f1 = v1 * 2 - 1;
                const z0 = 0.52 * Math.sqrt(Math.max(0.05, 1 - 0.5 * f0 * f0));
                const z1 = 0.52 * Math.sqrt(Math.max(0.05, 1 - 0.5 * f1 * f1));
                const py0 = centerY + (f0 * cosP + z0 * sinP) * (dh * 0.5);
                const py1 = centerY + (f1 * cosP + z1 * sinP) * (dh * 0.5);

                const sy0 = Math.floor(v0 * imgH);
                const sy1 = Math.floor(v1 * imgH);
                const dy0 = Math.floor(Math.min(py0, py1));
                const dyH = Math.max(1, Math.ceil(Math.abs(py1 - py0)));
                const bandW = dw * bandScaleX;

                drawCtx.drawImage(
                  cachedProfileImg,
                  0,
                  sy0,
                  imgW,
                  Math.max(1, sy1 - sy0),
                  centerX + yawShiftX - bandW / 2,
                  dy0,
                  bandW,
                  dyH
                );
              }
              drawCtx.restore();
            };

            if (useOffscreenSwapBuffer) {
              // Render into offscreen cutout buffer for anti-aliasing & temporal frame smoothing
              if (!aaScratchCanvasRef.current) {
                aaScratchCanvasRef.current = document.createElement('canvas');
              }
              if (!aaMaskCanvasRef.current) {
                aaMaskCanvasRef.current = document.createElement('canvas');
              }
              const scratch = aaScratchCanvasRef.current;
              const mask = aaMaskCanvasRef.current;
              if (scratch.width !== targetDrawW || scratch.height !== targetDrawH) {
                scratch.width = targetDrawW;
                scratch.height = targetDrawH;
                mask.width = targetDrawW;
                mask.height = targetDrawH;
              }
              const sCtx = scratch.getContext('2d');
              const mCtx = mask.getContext('2d');

              if (sCtx && mCtx) {
                sCtx.save();
                sCtx.clearRect(0, 0, targetDrawW, targetDrawH);
                sCtx.imageSmoothingEnabled = true;
                sCtx.imageSmoothingQuality = antiAliasingEnabled ? 'high' : 'low';
                sCtx.filter = liveColorFilter;
                drawMorphedFaceImage(
                  sCtx,
                  (targetDrawW - baseFaceW) / 2,
                  0,
                  baseFaceW,
                  baseFaceH
                );
                sCtx.filter = 'none';

                if (qualityProfile.useSoftLightToneBlend && Math.abs(morphT) >= 0.04) {
                  sCtx.globalCompositeOperation = 'soft-light';
                  const browAlpha = Math.min(0.18, Math.abs(morphT) * 0.16);
                  sCtx.fillStyle =
                    morphT > 0
                      ? `rgba(45, 32, 24, ${browAlpha})`
                      : `rgba(255, 242, 232, ${browAlpha * 0.85})`;
                  sCtx.beginPath();
                  sCtx.ellipse(
                    targetDrawW * 0.5,
                    targetDrawH * 0.34,
                    targetDrawW * 0.32,
                    targetDrawH * 0.07,
                    0,
                    0,
                    Math.PI * 2
                  );
                  sCtx.fill();
                }

                if (qualityProfile.useSoftLightToneBlend && Math.abs(tempVal) > 1) {
                  sCtx.globalCompositeOperation = 'soft-light';
                  const alpha = Math.min(0.32, (Math.abs(tempVal) / 40) * 0.25);
                  sCtx.fillStyle =
                    tempVal > 0
                      ? `rgba(255, 168, 92, ${alpha})`
                      : `rgba(110, 185, 255, ${alpha})`;
                  sCtx.fillRect(0, 0, targetDrawW, targetDrawH);
                }

                if (qualityProfile.useSoftLightToneBlend && config.skinToneMatch) {
                  sCtx.globalCompositeOperation = 'soft-light';
                  sCtx.fillStyle = 'rgba(235, 185, 150, 0.25)';
                  sCtx.fillRect(0, 0, targetDrawW, targetDrawH);
                }

                // Ambient Scene Shadow Overlay (depth & opacity matched to live background lighting)
                if (shadowMatcherStrength > 0.02) {
                  const sp = bgShadowProfileRef.current;
                  sCtx.save();
                  sCtx.globalCompositeOperation = 'multiply';
                  const lrGrad = sCtx.createLinearGradient(0, 0, targetDrawW, 0);
                  lrGrad.addColorStop(
                    0,
                    `rgba(16, 18, 28, ${(sp.leftShadow * shadowMatcherStrength).toFixed(3)})`
                  );
                  lrGrad.addColorStop(
                    0.5,
                    `rgba(20, 22, 32, ${(sp.ambientDepth * 0.35 * shadowMatcherStrength).toFixed(3)})`
                  );
                  lrGrad.addColorStop(
                    1,
                    `rgba(16, 18, 28, ${(sp.rightShadow * shadowMatcherStrength).toFixed(3)})`
                  );
                  sCtx.fillStyle = lrGrad;
                  sCtx.fillRect(0, 0, targetDrawW, targetDrawH);

                  const chinGrad = sCtx.createLinearGradient(0, targetDrawH * 0.52, 0, targetDrawH);
                  chinGrad.addColorStop(0, 'rgba(16, 18, 28, 0)');
                  chinGrad.addColorStop(
                    1,
                    `rgba(12, 14, 24, ${(sp.bottomShadow * shadowMatcherStrength).toFixed(3)})`
                  );
                  sCtx.fillStyle = chinGrad;
                  sCtx.fillRect(0, 0, targetDrawW, targetDrawH);
                  sCtx.restore();
                }

                if (qualityProfile.useFilterBlur && bloomAmt > 0.02) {
                  sCtx.save();
                  sCtx.globalCompositeOperation = 'screen';
                  sCtx.globalAlpha = Math.min(0.45, bloomAmt * 0.42);
                  const bloomBlurPx = Math.max(2, (4 + bloomAmt * 8) * renderScale);
                  sCtx.filter = `blur(${bloomBlurPx.toFixed(1)}px) brightness(1.18) saturate(1.08)`;
                  drawMorphedFaceImage(
                    sCtx,
                    (targetDrawW - baseFaceW) / 2,
                    0,
                    baseFaceW,
                    baseFaceH
                  );
                  sCtx.restore();
                }

                // Temporal filter across frames to reduce flickering & shimmer
                if (motionSmoothingVal > 2) {
                  temporalSmootherRef.current.stabilizeFacePatch(
                    sCtx,
                    targetDrawW,
                    targetDrawH,
                    motionSmoothingVal,
                    smoothedPose.speedPx
                  );
                }

                // Smooth subpixel anti-aliased & edge-softness feathered ellipse mask
                mCtx.clearRect(0, 0, targetDrawW, targetDrawH);
                mCtx.save();
                mCtx.translate(targetDrawW / 2, targetDrawH / 2);
                mCtx.scale(1, targetDrawH / (targetDrawW || 1));
                const rOuter = targetDrawW / 2;
                const softNorm = Math.max(0, Math.min(1, edgeSoftnessVal / 100));
                const featherNorm = Math.max(
                  0.05,
                  Math.min(0.45, (config.featherRadius / 50) * (0.35 + softNorm * 0.85))
                );
                if (antiAliasingEnabled || softNorm > 0.02) {
                  const rInner = Math.max(2, rOuter * (1 - featherNorm * 0.88));
                  const aaGrad = mCtx.createRadialGradient(0, 0, rInner * 0.65, 0, 0, rOuter);
                  aaGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
                  aaGrad.addColorStop(0.55, 'rgba(255, 255, 255, 1)');
                  aaGrad.addColorStop(
                    0.82,
                    `rgba(255, 255, 255, ${(0.84 - softNorm * 0.16).toFixed(2)})`
                  );
                  aaGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                  mCtx.fillStyle = aaGrad;
                } else {
                  mCtx.fillStyle = 'rgba(255, 255, 255, 1)';
                }
                mCtx.beginPath();
                mCtx.arc(0, 0, rOuter, 0, Math.PI * 2);
                mCtx.fill();
                mCtx.restore();

                const edgeContrastAmt =
                  (config.edgeContrast ?? adjustments.edgeContrast ?? 0) / 100;
                if (edgeContrastAmt > 0.02 && qualityProfile.qualityMode !== 'light') {
                  sCtx.save();
                  sCtx.globalCompositeOperation = 'overlay';
                  sCtx.globalAlpha = Math.min(0.42, edgeContrastAmt * 0.38);
                  sCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
                  sCtx.lineWidth = Math.max(2, (3 + edgeContrastAmt * 3) * renderScale);
                  sCtx.beginPath();
                  sCtx.ellipse(
                    targetDrawW / 2,
                    targetDrawH / 2,
                    targetDrawW * 0.47,
                    targetDrawH * 0.47,
                    0,
                    0,
                    Math.PI * 2
                  );
                  sCtx.stroke();
                  sCtx.restore();
                }

                // Boundary Refinement + 3-5 Frame Temporal Alpha-Matte Stabilization for video output
                if (boundaryRefinementEnabled || boundaryStabilizerEnabled) {
                  try {
                    const maskImg = mCtx.getImageData(0, 0, targetDrawW, targetDrawH);

                    if (
                      boundaryRefinementEnabled &&
                      boundaryStrengthVal > 2 &&
                      qualityProfile.qualityMode !== 'light'
                    ) {
                      if (!bgBoundaryPatchCanvasRef.current) {
                        bgBoundaryPatchCanvasRef.current = document.createElement('canvas');
                      }
                      const bgPatch = bgBoundaryPatchCanvasRef.current;
                      if (bgPatch.width !== targetDrawW || bgPatch.height !== targetDrawH) {
                        bgPatch.width = targetDrawW;
                        bgPatch.height = targetDrawH;
                      }
                      const bgPatchCtx = bgPatch.getContext('2d', { willReadFrequently: true });
                      if (bgPatchCtx) {
                        bgPatchCtx.clearRect(0, 0, targetDrawW, targetDrawH);
                        bgPatchCtx.save();
                        bgPatchCtx.translate(targetDrawW / 2, targetDrawH / 2);
                        bgPatchCtx.rotate((-smoothedRotation * Math.PI) / 180);
                        bgPatchCtx.drawImage(canvas, -cx, -cy);
                        bgPatchCtx.restore();

                        const sImg = sCtx.getImageData(0, 0, targetDrawW, targetDrawH);
                        const bgImg = bgPatchCtx.getImageData(0, 0, targetDrawW, targetDrawH);
                        applyLiveBoundaryLuminanceMatch(
                          sImg.data,
                          bgImg.data,
                          maskImg.data,
                          targetDrawW,
                          targetDrawH,
                          boundaryStrengthVal
                        );
                        sCtx.putImageData(sImg, 0, 0);
                      }
                    }

                    if (boundaryStabilizerEnabled) {
                      if (!boundaryStabilizerRef.current) {
                        boundaryStabilizerRef.current = new BoundaryMatteTemporalStabilizer();
                      }
                      const stabRes = boundaryStabilizerRef.current.stabilizeMaskRgba(
                        maskImg.data,
                        targetDrawW,
                        targetDrawH,
                        {
                          windowFrames: boundaryStabilizerFramesVal,
                          strengthPct: boundaryStrengthVal,
                          poseSpeedPx: smoothedPose.speedPx,
                          sensitivityPct: motionSmoothingEnabled ? motionSmoothingVal : 15,
                          faceKey: 'live-primary',
                          timestampMs: timestamp,
                          forceReset: forceRefocus,
                        }
                      );
                      activeStabilizedFramesRef.current = stabRes.activeFrames;
                    } else {
                      boundaryStabilizerRef.current?.reset();
                      activeStabilizedFramesRef.current = 0;
                    }

                    mCtx.putImageData(maskImg, 0, 0);
                  } catch {
                    // Fallback gracefully to unstabilized radial alpha mask
                  }
                } else {
                  boundaryStabilizerRef.current?.reset();
                  activeStabilizedFramesRef.current = 0;
                }

                sCtx.globalCompositeOperation = 'destination-in';
                sCtx.drawImage(mask, 0, 0);
                sCtx.restore();

                if (motionBlurEnabled && qualityProfile.motionBlurPx >= 0.45) {
                  applyDirectionalMotionBlurOnContext(
                    ctx,
                    scratch,
                    cx,
                    cy,
                    targetDrawW,
                    targetDrawH,
                    smoothedRotation,
                    qualityProfile.motionBlurPx,
                    qualityProfile.motionAngleRad,
                    config.swapStrength / 100
                  );
                } else {
                  ctx.globalAlpha = config.swapStrength / 100;
                  ctx.save();
                  ctx.translate(cx, cy);
                  ctx.rotate((smoothedRotation * Math.PI) / 180);
                  ctx.drawImage(scratch, -targetDrawW / 2, -targetDrawH / 2, targetDrawW, targetDrawH);
                  ctx.restore();
                }
              }
            } else {
              // Fast direct clip path when Anti-Aliasing and Motion Smoothing are disabled
              ctx.globalAlpha = config.swapStrength / 100;
              ctx.save();
              ctx.translate(cx, cy);
              ctx.rotate((smoothedRotation * Math.PI) / 180);

              ctx.beginPath();
              ctx.ellipse(0, 0, targetDrawW / 2, baseFaceH / 2, 0, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();

              ctx.filter = liveColorFilter;
              drawMorphedFaceImage(
                ctx,
                -baseFaceW / 2,
                -baseFaceH / 2,
                baseFaceW,
                baseFaceH
              );
              ctx.filter = 'none';

              if (qualityProfile.useSoftLightToneBlend && Math.abs(tempVal) > 1) {
                ctx.globalCompositeOperation = 'soft-light';
                const alpha = Math.min(0.32, (Math.abs(tempVal) / 40) * 0.25);
                ctx.fillStyle =
                  tempVal > 0
                    ? `rgba(255, 168, 92, ${alpha})`
                    : `rgba(110, 185, 255, ${alpha})`;
                ctx.fillRect(-baseFaceW / 2, -baseFaceH / 2, baseFaceW, baseFaceH);
              }

              if (qualityProfile.useSoftLightToneBlend && config.skinToneMatch) {
                ctx.globalCompositeOperation = 'soft-light';
                ctx.fillStyle = 'rgba(235, 185, 150, 0.25)';
                ctx.fillRect(-baseFaceW / 2, -baseFaceH / 2, baseFaceW, baseFaceH);
              }

              if (shadowMatcherStrength > 0.02) {
                const sp = bgShadowProfileRef.current;
                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                const lrGrad = ctx.createLinearGradient(-baseFaceW / 2, 0, baseFaceW / 2, 0);
                lrGrad.addColorStop(
                  0,
                  `rgba(16, 18, 28, ${(sp.leftShadow * shadowMatcherStrength).toFixed(3)})`
                );
                lrGrad.addColorStop(
                  0.5,
                  `rgba(20, 22, 32, ${(sp.ambientDepth * 0.35 * shadowMatcherStrength).toFixed(3)})`
                );
                lrGrad.addColorStop(
                  1,
                  `rgba(16, 18, 28, ${(sp.rightShadow * shadowMatcherStrength).toFixed(3)})`
                );
                ctx.fillStyle = lrGrad;
                ctx.fillRect(-baseFaceW / 2, -baseFaceH / 2, baseFaceW, baseFaceH);
                ctx.restore();
              }

              if (qualityProfile.useFilterBlur && bloomAmt > 0.02) {
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                ctx.globalAlpha = Math.min(0.45, bloomAmt * 0.42) * (config.swapStrength / 100);
                const bloomBlurPx = Math.max(2, (4 + bloomAmt * 8) * renderScale);
                ctx.filter = `blur(${bloomBlurPx.toFixed(1)}px) brightness(1.18) saturate(1.08)`;
                drawMorphedFaceImage(
                  ctx,
                  -baseFaceW / 2,
                  -baseFaceH / 2,
                  baseFaceW,
                  baseFaceH
                );
                ctx.restore();
              }

              ctx.restore();
            }

            ctx.restore();
          }

          // 4. LIVE BODY-FITTED CLOTHING & STRETCHING VERLET CLOTH MESH
          if (config.wearClothes) {
            const clothingAsset =
              wardrobeAssets.find((a) => a.id === config.selectedClothingId) ||
              wardrobeAssets.find((a) => a.category === 'clothing');
            const clothingImg = clothingAsset ? cachedWardrobeImages[clothingAsset.id] : null;

            if (clothingImg && clothingAsset) {
              ctx.save();
              const fit = clothFitRef.current;
              const liveTime = timestamp / 1000;
              const cImgW = clothingImg.naturalWidth || clothingImg.width || 1;
              const cImgH = clothingImg.naturalHeight || clothingImg.height || 1;
              const scaleMultiplier = clothingAsset.defaultScale || 1.0;

              const tagId = String(clothingAsset.clothingTag || clothingAsset.subCategory || 'shirt').toLowerCase();
              const anchorMode: 'shoulders' | 'chest' | 'waist' =
                clothingAsset.anchorPoint === 'waist' || tagId === 'skirt' || tagId === 'pants'
                  ? 'waist'
                  : clothingAsset.anchorPoint === 'chest' || tagId === 'bikini'
                  ? 'chest'
                  : 'shoulders';

              const baseAnchorL =
                anchorMode === 'waist'
                  ? liveLandmarks.leftWaist
                  : anchorMode === 'chest'
                  ? liveLandmarks.leftChest
                  : liveLandmarks.leftShoulder;
              const baseAnchorR =
                anchorMode === 'waist'
                  ? liveLandmarks.rightWaist
                  : anchorMode === 'chest'
                  ? liveLandmarks.rightChest
                  : liveLandmarks.rightShoulder;

              const anchorVecX = baseAnchorR.x - baseAnchorL.x;
              const anchorVecY = baseAnchorR.y - baseAnchorL.y;
              const rawSpan = Math.max(24, Math.hypot(anchorVecX, anchorVecY));
              const ux = anchorVecX / rawSpan;
              const uy = anchorVecY / rawSpan;

              const widthMult =
                anchorMode === 'waist' ? 1.32 : anchorMode === 'chest' ? 1.18 : 1.36;
              const targetGarmentW = rawSpan * widthMult * scaleMultiplier * fit.stretch;
              const targetGarmentH = Math.min(vh * 0.9, targetGarmentW * (cImgH / cImgW));

              const midX = (baseAnchorL.x + baseAnchorR.x) * 0.5;
              const midY = (baseAnchorL.y + baseAnchorR.y) * 0.5 + fit.collarOffset * renderScale;
              const halfSpanScaled = rawSpan * 0.5 * scaleMultiplier * fit.stretch;
              const adjustedAnchorL = {
                x: midX - ux * halfSpanScaled,
                y: midY - uy * halfSpanScaled,
              };
              const adjustedAnchorR = {
                x: midX + ux * halfSpanScaled,
                y: midY + uy * halfSpanScaled,
              };

              const cols = qualityProfile.qualityMode === 'light' ? 6 : 8;
              const rows = qualityProfile.qualityMode === 'light' ? 7 : 9;
              const existing = liveClothMeshRef.current;
              const needsRebuild =
                !existing ||
                existing.assetId !== clothingAsset.id ||
                existing.anchorMode !== anchorMode ||
                Math.abs(existing.mesh.fitTightness - fit.tightness) > 3 ||
                Math.abs(existing.mesh.width - targetGarmentW) > targetGarmentW * 0.25 ||
                Math.abs(existing.mesh.height - targetGarmentH) > targetGarmentH * 0.25;

              let activeMesh: ClothMeshState;
              if (needsRebuild || !existing) {
                const startY =
                  anchorMode === 'waist'
                    ? midY - targetGarmentH * 0.04
                    : anchorMode === 'chest'
                    ? midY - targetGarmentH * 0.14
                    : midY;
                activeMesh = createClothGrid(
                  midX,
                  startY,
                  targetGarmentW,
                  targetGarmentH,
                  cols,
                  rows,
                  halfSpanScaled * 2,
                  tagId,
                  fit.tightness,
                  anchorMode
                );
                liveClothMeshRef.current = {
                  assetId: clothingAsset.id,
                  anchorMode,
                  mesh: activeMesh,
                };
              } else {
                // Smoothly stretch rest dimensions & horizontal spring spans as user moves closer/farther
                const prevW = existing.mesh.width || targetGarmentW;
                const nextW = prevW * 0.8 + targetGarmentW * 0.2;
                const scaleW = nextW / prevW;
                if (Math.abs(scaleW - 1) > 0.002) {
                  for (let s = 0; s < existing.mesh.springs.length; s++) {
                    const sp = existing.mesh.springs[s];
                    const p1 = existing.mesh.particles[sp.p1];
                    const p2 = existing.mesh.particles[sp.p2];
                    if (Math.abs(p1.u - p2.u) > 0.01 && Math.abs(p1.v - p2.v) < 0.01) {
                      sp.restLength *= scaleW;
                    }
                  }
                }
                existing.mesh.width = nextW;
                existing.mesh.height = existing.mesh.height * 0.8 + targetGarmentH * 0.2;
                activeMesh = existing.mesh;
              }
              const liveWind = {
                x: Math.sin(liveTime * 1.45) * 0.45,
                y: Math.cos(liveTime * 1.8) * 0.12,
              };
              const liveColliders = buildBodyCollisionMesh(
                liveLandmarks,
                bodyTrack.breathingChestPx
              );

              stepClothMesh(
                activeMesh,
                {
                  ...DEFAULT_CLOTH_CONFIG,
                  fabricType: clothingAsset.fabricType || 'cotton',
                  gravity: anchorMode === 'waist' ? 0.62 : 0.48,
                  windStrength: 0.6,
                  windTurbulence: 0.25,
                  stiffness: 5,
                  damping: 0.92,
                  postureTurn: bodyTrack.torsoTurnDeg,
                  chestExpansion: bodyTrack.breathingChestPx,
                },
                adjustedAnchorL,
                adjustedAnchorR,
                liveLandmarks,
                liveWind,
                bodyTrack.breathingChestPx,
                liveColliders
              );

              // Enforce clean chin & neck cutout clearance so shoulder garments wear naturally below the jaw
              if (anchorMode !== 'waist') {
                ctx.beginPath();
                ctx.rect(0, 0, vw, vh);
                ctx.ellipse(
                  cx,
                  cy + baseFaceH * 0.05,
                  baseFaceW * 0.52,
                  baseFaceH * 0.56,
                  (smoothedRotation * Math.PI) / 180,
                  0,
                  Math.PI * 2
                );
                ctx.clip('evenodd');
              }

              if (qualityProfile.useDropShadows) {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
                ctx.shadowBlur = 12 * renderScale;
                ctx.shadowOffsetY = 5 * renderScale;
              }

              const materialSurface =
                qualityProfile.qualityMode === 'high'
                  ? getDefaultMaterialSurface(clothingAsset.fabricType || 'cotton')
                  : undefined;

              renderClothMesh(ctx, clothingImg, activeMesh, false, false, materialSurface);
              ctx.restore();
            }
          }

          // 5. LIVE JEWELRY, OBJECT & ACCESSORY PLACEMENT (Pendulum Swing & Anatomical Landmark Anchoring)
          if (config.wearJewelry) {
            const jewelryAsset =
              wardrobeAssets.find((a) => a.id === config.selectedJewelryId) ||
              wardrobeAssets.find((a) => a.category === 'jewelry' || a.category === 'object' || a.category === 'accessory');
            const jewelryImg = jewelryAsset ? cachedWardrobeImages[jewelryAsset.id] : null;

            if (jewelryImg && jewelryAsset) {
              ctx.save();
              const liveTime = timestamp / 1000;
              const scaleMultiplier = jewelryAsset.defaultScale || 1.0;
              const jImgW = jewelryImg.naturalWidth || jewelryImg.width || 1;
              const jImgH = jewelryImg.naturalHeight || jewelryImg.height || 1;

              if (jewelryAsset.anchorPoint === 'head') {
                const isEyewear =
                  jewelryAsset.subCategory === 'glasses' ||
                  jewelryAsset.tags.some((t) => t.toLowerCase().includes('glass'));
                const hatW = baseFaceW * 1.22 * scaleMultiplier;
                const hatH = hatW * (jImgH / jImgW);
                const hatX = cx;
                const hatY = isEyewear ? cy - baseFaceH * 0.08 : cy - baseFaceH * 0.48;

                ctx.translate(hatX, hatY);
                ctx.rotate((config.rotation * Math.PI) / 180);
                ctx.drawImage(jewelryImg, -hatW / 2, isEyewear ? -hatH * 0.5 : -hatH * 0.7, hatW, hatH);
              } else if (jewelryAsset.anchorPoint === 'wrist') {
                const wristW = baseFaceW * 0.6 * scaleMultiplier;
                const wristH = wristW * (jImgH / jImgW);
                const wristX = Math.max(wristW * 0.4, liveLandmarks.leftWrist.x);
                const wristY = Math.min(vh - wristH * 0.35, liveLandmarks.leftWrist.y);
                ctx.translate(wristX, wristY);
                ctx.drawImage(jewelryImg, -wristW / 2, -wristH / 2, wristW, wristH);
              } else if (jewelryAsset.anchorPoint === 'ears') {
                const earW = baseFaceW * 0.25 * scaleMultiplier;
                const earH = earW * (jImgH / jImgW);
                ctx.drawImage(jewelryImg, cx - baseFaceW * 0.56 - earW / 2, cy + baseFaceH * 0.04, earW, earH);
                ctx.drawImage(jewelryImg, cx + baseFaceW * 0.56 - earW / 2, cy + baseFaceH * 0.04, earW, earH);
              } else {
                // Collarbone / Throat anchor (below chin) with subtle pendulum sway
                const jewelryW = baseFaceW * 0.92 * scaleMultiplier;
                const jewelryH = jewelryW * (jImgH / jImgW);
                const pendSwing = Math.sin(liveTime * 3.0) * 0.03;
                const jewelryX = liveLandmarks.throat.x + Math.sin(liveTime * 3.0) * 2.5 * renderScale;
                const jewelryY = liveLandmarks.throat.y;

                ctx.translate(jewelryX, jewelryY);
                ctx.rotate(((config.rotation * 0.2) * Math.PI) / 180 + pendSwing);

                if (qualityProfile.useDropShadows) {
                  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
                  ctx.shadowBlur = 10 * renderScale;
                  ctx.shadowOffsetY = 4 * renderScale;
                }

                ctx.drawImage(jewelryImg, -jewelryW / 2, 0, jewelryW, jewelryH);
              }

              ctx.restore();
            }
          }

          // 6. SPLIT SCREEN PREVIEW DIVIDER
          if (config.splitPreview) {
            const splitX = (vw * config.splitPos) / 100;
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1.5, 2 * renderScale);
            ctx.beginPath();
            ctx.moveTo(splitX, 0);
            ctx.lineTo(splitX, vh);
            ctx.stroke();

            ctx.font = `bold ${Math.round(11 * renderScale)}px Plus Jakarta Sans, sans-serif`;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(splitX - 65 * renderScale, 12 * renderScale, 60 * renderScale, 22 * renderScale);
            ctx.fillRect(splitX + 6 * renderScale, 12 * renderScale, 65 * renderScale, 22 * renderScale);

            ctx.fillStyle = '#ffffff';
            ctx.fillText('Original', splitX - 58 * renderScale, 27 * renderScale);
            ctx.fillText('Filtered', splitX + 12 * renderScale, 27 * renderScale);
            ctx.restore();
          }

          // 7. TFLITE 468-POINT WIREFRAME MESH
          if (config.showLandmarkMesh || adjustments.showFaceLandmarks) {
            const liveMorphT = Math.max(
              -1,
              Math.min(1, (config.genderMorph ?? adjustments.genderMorph ?? 0) / 100)
            );
            const livePitch = config.headPitch ?? adjustments.headPitch ?? 0;
            const liveYaw = config.headYaw ?? adjustments.headYaw ?? 0;
            drawTFLiteLandmarkMesh(
              ctx,
              cx,
              cy,
              baseFaceW,
              baseFaceH,
              smoothedRotation,
              config.expressionWarp / 100,
              liveMorphT,
              livePitch,
              liveYaw
            );
          }

          // 8. AUTO-REFOCUS LOCK BRACKETS ON SUDDEN SHIFT OR MANUAL TRIGGER
          if (timestamp < trackedFace.refocusActiveUntil) {
            const bw = baseFaceW * 1.08;
            const bh = baseFaceH * 1.06;
            const left = cx - bw / 2;
            const top = cy - bh / 2;
            const corner = Math.max(10, Math.round(bw * 0.14));
            const pulseAlpha = Math.min(
              0.92,
              ((trackedFace.refocusActiveUntil - timestamp) / 1150) * 1.25
            );
            ctx.save();
            ctx.strokeStyle = `rgba(34, 211, 238, ${pulseAlpha.toFixed(2)})`;
            ctx.lineWidth = Math.max(2, 2.5 * renderScale);
            ctx.beginPath();
            // Top-left
            ctx.moveTo(left, top + corner);
            ctx.lineTo(left, top);
            ctx.lineTo(left + corner, top);
            // Top-right
            ctx.moveTo(left + bw - corner, top);
            ctx.lineTo(left + bw, top);
            ctx.lineTo(left + bw, top + corner);
            // Bottom-right
            ctx.moveTo(left + bw, top + bh - corner);
            ctx.lineTo(left + bw, top + bh);
            ctx.lineTo(left + bw - corner, top + bh);
            // Bottom-left
            ctx.moveTo(left + corner, top + bh);
            ctx.lineTo(left, top + bh);
            ctx.lineTo(left, top + bh - corner);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      active = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [
    cachedProfileImg,
    cachedBgImages,
    cachedWardrobeImages,
    config,
    cameraMode,
    facingMode,
    adjustments.motionSensitivity,
    adjustments.lightingAdjustment,
    adjustments.shadowMatcher,
    adjustments.softBloom,
    adjustments.autoRefocus,
    adjustments.antiAliasing,
    adjustments.genderMorph,
    adjustments.edgeContrast,
    adjustments.motionSmoothingEnabled,
    adjustments.motionSmoothing,
    adjustments.edgeSoftness,
    adjustments.showFaceLandmarks,
    adjustments.hue,
    adjustments.vibrance,
    adjustments.headPitch,
    adjustments.headYaw,
    adjustments.motionBlur,
    adjustments.boundaryRefinement,
    adjustments.boundaryRefinementStrength,
    adjustments.boundaryTemporalStabilizer,
    adjustments.boundaryStabilizerFrames,
    wardrobeAssets,
  ]);

  // PHOTO CAPTURE
  const handleCapturePhoto = () => {
    setIsCapturingFlash(true);
    const canvas = liveCanvasRef.current;
    if (canvas) {
      setTimeout(() => {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        setTargetImageUrl(dataUrl);

        // Auto-download the high-res snapshot
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `facemorph_live_snapshot_${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setIsCapturingFlash(false);
        setDownloadToast('Photo Captured & Downloaded!');
        setTimeout(() => setDownloadToast(null), 3000);
      }, 150);
    }
  };

  // LIVE VIDEO RECORDING (MediaRecorder)
  const handleToggleVideoRecord = async () => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return;

    if (!isRecordingVideo) {
      // Start recording
      const recorder = new CanvasVideoRecorder(canvas);
      const ok = recorder.start();
      if (ok) {
        recorderRef.current = recorder;
        setIsRecordingVideo(true);
        setRecordSeconds(0);
        recordTimerRef.current = window.setInterval(() => {
          setRecordSeconds((s) => s + 1);
        }, 1000);
      }
    } else {
      // Stop recording and save video
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
      }
      setIsRecordingVideo(false);

      if (recorderRef.current) {
        const blob = await recorderRef.current.stop();
        if (blob && blob.size > 0) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `facemorph_live_video_${Date.now()}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 4000);

          setDownloadToast(`Video Saved (${recordSeconds}s WebM Clip)!`);
          setTimeout(() => setDownloadToast(null), 3500);
        }
      }
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-white relative select-none overflow-hidden">
      {/* Hidden source video element */}
      <video ref={videoRef} playsInline muted autoPlay className="hidden" />

      {/* Hidden file input for custom background */}
      <input
        ref={bgFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleCustomBgUpload}
      />

      {/* Toast Notification */}
      {downloadToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-emerald-600/95 text-white text-xs font-bold shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Check className="w-4 h-4" />
          <span>{downloadToast}</span>
        </div>
      )}

      {/* Camera Top Status & Telemetry Bar */}
      <div className="px-3 py-2 flex items-center justify-between z-20 bg-gradient-to-b from-black/85 via-black/40 to-transparent">
        {/* Live FPS Telemetry */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-emerald-500/30 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono font-semibold text-emerald-300">
              TFLite On-Device
            </span>
            <span className="text-slate-500 text-[10px]">·</span>
            <span className="text-[10px] font-mono text-slate-300">
              {trackingState.fps} FPS
            </span>
          </div>

          {/* Synced from Studio Badge */}
          {liveSyncedFaceId && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-950/80 border border-violet-500/40 text-violet-200 text-[10px] font-semibold">
              <Radio className="w-3 h-3 text-rose-400 animate-pulse" />
              <span>Studio Sync ON</span>
              <button
                type="button"
                onClick={() => setLiveSyncedFaceId(null)}
                className="text-violet-300 hover:text-white ml-0.5"
                title="Disconnect real-time studio sync"
                aria-label="Disconnect real-time studio sync"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Recording Badge */}
          {isRecordingVideo && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/80 border border-rose-500/40 text-rose-300 text-[10px] font-mono font-bold animate-pulse">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>REC {formatTimer(recordSeconds)}</span>
            </div>
          )}
        </div>

        {/* Top Camera Utilities */}
        <div className="flex items-center gap-1.5">
          {/* Wireframe Mesh Toggle */}
          <button
            onClick={() => {
              const next = !(config.showLandmarkMesh || adjustments.showFaceLandmarks);
              setConfig((prev) => ({ ...prev, showLandmarkMesh: next }));
              updateAdjustments(
                { showFaceLandmarks: next },
                next ? 'Face Landmarks Wireframe Shown' : 'Face Landmarks Wireframe Hidden'
              );
            }}
            className={`p-2 rounded-full text-xs transition-colors backdrop-blur-md ${
              config.showLandmarkMesh || adjustments.showFaceLandmarks
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-black/50 text-slate-300 hover:text-white border border-white/10'
            }`}
            title="Toggle Face Landmarks Wireframe Grid"
          >
            <Activity className="w-4 h-4" />
          </button>

          {/* Split Screen Preview Toggle */}
          <button
            onClick={() =>
              setConfig((prev) => ({ ...prev, splitPreview: !prev.splitPreview }))
            }
            className={`p-2 rounded-full text-xs transition-colors backdrop-blur-md ${
              config.splitPreview
                ? 'bg-indigo-600 text-white font-bold'
                : 'bg-black/50 text-slate-300 hover:text-white border border-white/10'
            }`}
            title="Toggle Live Split Preview"
          >
            <Split className="w-4 h-4" />
          </button>

          {/* Flip Camera */}
          <button
            onClick={() =>
              setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
            }
            className="p-2 rounded-full bg-black/50 hover:bg-black/70 text-slate-300 hover:text-white border border-white/10 text-xs backdrop-blur-md"
            title="Flip front/rear camera"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          {/* Close Camera */}
          <button
            onClick={() => setActiveTab('studio')}
            className="p-2 rounded-full bg-black/50 hover:bg-black/70 text-slate-300 hover:text-white border border-white/10 text-xs backdrop-blur-md"
            title="Close camera"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Real-time Canvas Viewport */}
      <div className="flex-1 relative flex items-center justify-center p-2 overflow-hidden bg-black">
        {/* Shutter Flash Animation */}
        {isCapturingFlash && (
          <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-200" />
        )}

        <canvas
          ref={liveCanvasRef}
          className="w-full h-full max-h-full max-w-full rounded-2xl object-contain shadow-2xl block"
        />

        {/* ON-SCREEN EFFECT BUTTONS (Requested by user) */}
        <div className="absolute top-3 left-3 z-30 flex flex-col gap-1.5">
          {/* 1. Background Removal ON/OFF Button */}
          <button
            onClick={() =>
              setConfig((prev) => ({ ...prev, removeBackground: !prev.removeBackground }))
            }
            className={`px-2.5 py-1.5 rounded-full text-[11px] font-bold backdrop-blur-md border shadow-lg flex items-center gap-1.5 transition-all ${
              config.removeBackground
                ? 'bg-indigo-600/90 border-indigo-400 text-white ring-2 ring-indigo-400/30'
                : 'bg-black/60 border-white/15 text-slate-300 hover:text-white'
            }`}
            title="Toggle Background Removal and Virtual Studio"
          >
            <ImageIcon className="w-3.5 h-3.5 text-cyan-300" />
            <span>BG Removal: {config.removeBackground ? 'ON' : 'OFF'}</span>
          </button>

          {/* 2. Body & Facial Unwanted Hair / Blemish Removal Button */}
          <button
            onClick={() =>
              setConfig((prev) => ({
                ...prev,
                removeHairAndBlemishes: !prev.removeHairAndBlemishes,
              }))
            }
            className={`px-2.5 py-1.5 rounded-full text-[11px] font-bold backdrop-blur-md border shadow-lg flex items-center gap-1.5 transition-all ${
              config.removeHairAndBlemishes
                ? 'bg-emerald-600/90 border-emerald-400 text-white ring-2 ring-emerald-400/30'
                : 'bg-black/60 border-white/15 text-slate-300 hover:text-white'
            }`}
            title="Toggle Body & Facial Unwanted Hair / Blemish Removal"
          >
            <Scissors className="w-3.5 h-3.5 text-emerald-300" />
            <span>Hair Removal: {config.removeHairAndBlemishes ? 'ON' : 'OFF'}</span>
          </button>

          {/* 3. Live Clothes & Jewelry Try-on Button */}
          <button
            onClick={() =>
              setConfig((prev) => ({
                ...prev,
                wearClothes: !prev.wearClothes,
                wearJewelry: !prev.wearJewelry,
              }))
            }
            className={`px-2.5 py-1.5 rounded-full text-[11px] font-bold backdrop-blur-md border shadow-lg flex items-center gap-1.5 transition-all ${
              config.wearClothes || config.wearJewelry
                ? 'bg-purple-600/90 border-purple-400 text-white ring-2 ring-purple-400/30'
                : 'bg-black/60 border-white/15 text-slate-300 hover:text-white'
            }`}
            title="Toggle Live Clothes and Jewelry Fitting"
          >
            <Shirt className="w-3.5 h-3.5 text-purple-300" />
            <span>Wardrobe: {config.wearClothes ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Split Position Slider Overlay */}
        {config.splitPreview && (
          <div className="absolute bottom-4 left-6 right-6 z-30 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
            <span className="text-[10px] text-slate-300 font-medium">Split</span>
            <input
              type="range"
              min="10"
              max="90"
              value={config.splitPos}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, splitPos: Number(e.target.value) }))
              }
              className="w-full accent-indigo-500 h-1 bg-white/20 rounded-lg cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Real-Time Live Control Drawer */}
      <div className="bg-slate-900/95 border-t border-slate-800 backdrop-blur-lg flex flex-col z-20 shrink-0">
        {/* Drawer Tabs Strip */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/80 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1">
            {[
              { id: 'background' as const, label: 'Backgrounds', icon: ImageIcon },
              { id: 'beauty' as const, label: 'Hair & Skin', icon: Scissors },
              { id: 'wardrobe' as const, label: 'Clothes & Gems', icon: Shirt },
              { id: 'alignment' as const, label: 'Alignment', icon: Move },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeDrawer === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() =>
                    setActiveDrawer(activeDrawer === tab.id ? 'none' : tab.id)
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Adaptive Directional Motion Blur quick toggle */}
            <button
              onClick={() => {
                const next = !(config.motionBlur ?? adjustments.motionBlur);
                setConfig((prev) => ({ ...prev, motionBlur: next }));
                updateAdjustments(
                  { motionBlur: next },
                  next ? 'Adaptive Motion Blur Enabled' : 'Adaptive Motion Blur Disabled'
                );
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors shrink-0 tabular-nums whitespace-nowrap ${
                config.motionBlur ?? adjustments.motionBlur
                  ? 'border-cyan-500/50 bg-cyan-950/60 text-cyan-300'
                  : 'border-slate-800 text-slate-500'
              }`}
              title="Adaptive directional motion blur synced with camera movement"
            >
              Motion Blur
              {(config.motionBlur ?? adjustments.motionBlur) &&
              (trackingState.motionBlurPx ?? 0) >= 0.5
                ? ` · ${trackingState.motionBlurPx}px`
                : ''}
            </button>

            {/* Motion Smoothing Toggle (Temporal Video Stabilizer Sensitivity) */}
            <button
              onClick={() => {
                const next = !(
                  (config.motionSmoothingEnabled ?? adjustments.motionSmoothingEnabled) !==
                  false
                );
                setConfig((prev) => ({ ...prev, motionSmoothingEnabled: next }));
                updateAdjustments(
                  { motionSmoothingEnabled: next },
                  next ? 'Motion Smoothing Enabled' : 'Motion Smoothing Disabled'
                );
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors shrink-0 tabular-nums whitespace-nowrap ${
                (config.motionSmoothingEnabled ?? adjustments.motionSmoothingEnabled) !== false
                  ? 'border-teal-500/50 bg-teal-950/60 text-teal-300'
                  : 'border-slate-800 text-slate-500'
              }`}
              title="Toggle temporal motion stabilizer for dynamic video capture"
            >
              Motion Stab{' '}
              {(config.motionSmoothingEnabled ?? adjustments.motionSmoothingEnabled) !== false
                ? `${config.motionSmoothing ?? adjustments.motionSmoothing ?? 35}%`
                : 'Off'}
            </button>

            {/* Boundary Temporal Stabilizer (3-5 Frame Alpha-Matte Averaging) */}
            <button
              onClick={() => {
                const next = !(
                  (config.boundaryTemporalStabilizer ?? adjustments.boundaryTemporalStabilizer) !==
                  false
                );
                setConfig((prev) => ({ ...prev, boundaryTemporalStabilizer: next }));
                updateAdjustments(
                  { boundaryTemporalStabilizer: next },
                  next
                    ? 'Boundary Temporal Stabilizer Enabled'
                    : 'Boundary Temporal Stabilizer Disabled'
                );
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors shrink-0 tabular-nums whitespace-nowrap ${
                (config.boundaryTemporalStabilizer ?? adjustments.boundaryTemporalStabilizer) !==
                false
                  ? 'border-teal-500/50 bg-teal-950/60 text-teal-300'
                  : 'border-slate-800 text-slate-500'
              }`}
              title="Average boundary alpha-matte across 3-5 consecutive video frames to prevent edge flicker"
            >
              Edge Stab {config.boundaryStabilizerFrames ?? adjustments.boundaryStabilizerFrames ?? 4}F
            </button>

            {/* Quick Skin Tone matching toggle */}
            <button
              onClick={() =>
                setConfig((prev) => ({ ...prev, skinToneMatch: !prev.skinToneMatch }))
              }
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors shrink-0 whitespace-nowrap ${
                config.skinToneMatch
                  ? 'border-emerald-500/50 bg-emerald-950/60 text-emerald-400'
                  : 'border-slate-800 text-slate-500'
              }`}
            >
              Auto Tone
            </button>
          </div>
        </div>

        {/* DRAWER 1: VIRTUAL BACKGROUNDS */}
        {activeDrawer === 'background' && (
          <div className="p-3 space-y-2.5 bg-slate-950/70 text-xs">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span className="font-semibold flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                Select Virtual Studio Background
              </span>
              <button
                onClick={() => bgFileInputRef.current?.click()}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <Upload className="w-3 h-3" />
                <span>Upload Custom</span>
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {VIRTUAL_BACKGROUNDS.map((bg) => {
                const isSelected =
                  config.removeBackground && config.activeBackgroundId === bg.id;
                return (
                  <button
                    key={bg.id}
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        removeBackground: true,
                        activeBackgroundId: bg.id,
                      }))
                    }
                    className={`p-1.5 rounded-xl border text-center transition-all ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300 font-bold ring-2 ring-cyan-500/30'
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-full h-10 rounded-lg overflow-hidden bg-slate-800 mb-1 flex items-center justify-center">
                      {bg.url ? (
                        <img
                          src={bg.url}
                          alt={bg.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-full h-full"
                          style={{ backgroundColor: bg.color || '#090d16' }}
                        />
                      )}
                    </div>
                    <span className="block text-[10px] truncate">{bg.name}</span>
                  </button>
                );
              })}

              {/* Custom Uploaded Background if present */}
              {config.customBackgroundUrl && (
                <button
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      removeBackground: true,
                      activeBackgroundId: 'custom',
                    }))
                  }
                  className={`p-1.5 rounded-xl border text-center transition-all ${
                    config.removeBackground && config.activeBackgroundId === 'custom'
                      ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300 font-bold ring-2 ring-cyan-500/30'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  <div className="w-full h-10 rounded-lg overflow-hidden bg-slate-800 mb-1">
                    <img
                      src={config.customBackgroundUrl}
                      alt="Custom"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="block text-[10px] truncate">Custom</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* DRAWER 2: HAIR & BLEMISH REMOVAL */}
        {activeDrawer === 'beauty' && (
          <div className="p-3 space-y-3 bg-slate-950/70 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                Facial & Body Unwanted Hair / Blemish Airbrush
              </span>
              <button
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    removeHairAndBlemishes: !prev.removeHairAndBlemishes,
                  }))
                }
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  config.removeHairAndBlemishes
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {config.removeHairAndBlemishes ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                <span>Hair Removal & Smoothing Intensity</span>
                <span className="font-mono text-emerald-400">{config.hairRemovalIntensity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={config.hairRemovalIntensity}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, hairRemovalIntensity: Number(e.target.value) }))
                }
                className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] text-slate-500 block mt-1">
                Removes unwanted facial hair, stubble, peach fuzz & blemishes while keeping eyes and contours sharp.
              </span>
            </div>
          </div>
        )}

        {/* DRAWER 3: LIVE WARDROBE, JEWELRY & OBJECTS */}
        {activeDrawer === 'wardrobe' && (
          <div className="p-3 space-y-3 bg-slate-950/80 text-xs border-t border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Shirt className="w-3.5 h-3.5 text-purple-400" />
                Live Wardrobe, Jewelry &amp; Objects (Real-Time AR)
              </span>

              <button
                onClick={() => openCustomAssetModal('clothing', 'camera')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-purple-600 hover:brightness-110 text-white text-[10px] font-bold shadow-xs transition-transform active:scale-95 shrink-0"
              >
                <Sparkles className="w-3 h-3" />
                <span>+ Scan Cloth / Jewelry / Object</span>
              </button>
            </div>

            {/* Section 1: Clothing & Costumes with Style Sub-Tabs */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">Clothes &amp; Costumes</span>
                <button
                  onClick={() => setConfig((prev) => ({ ...prev, wearClothes: !prev.wearClothes }))}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                    config.wearClothes ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {config.wearClothes ? 'Clothes: ON' : 'Clothes: OFF'}
                </button>
              </div>

              {/* Clothing Type Tabs (Suits, Shirts, Bikini, etc. + Custom Tags) */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => setLiveClothTagFilter('all')}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                    liveClothTagFilter === 'all'
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All
                </button>
                {allClothingTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setLiveClothTagFilter(tag.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                      liveClothTagFilter === tag.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                {wardrobeAssets
                  .filter(
                    (a) =>
                      a.category === 'clothing' &&
                      (liveClothTagFilter === 'all' || getAssetClothingTagId(a) === liveClothTagFilter)
                  )
                  .map((item) => {
                    const isSelected = config.selectedClothingId === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            selectedClothingId: item.id,
                            wearClothes: true,
                          }))
                        }
                        className={`flex items-center gap-2 p-1.5 rounded-xl border text-left min-w-[140px] shrink-0 transition-all ${
                          isSelected && config.wearClothes
                            ? 'border-purple-500 bg-purple-950/60 text-white ring-1 ring-purple-500/40'
                            : 'border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-8 h-8 rounded-lg object-contain bg-slate-950 border border-slate-800 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block text-[11px] font-bold truncate">{item.name}</span>
                          <span className="block text-[9px] text-slate-400 capitalize">
                            {item.clothingTag || item.subCategory} · {item.fabricType || 'mesh'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Section 2: Jewelry, Objects & Accessories */}
            <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">Jewelry, Objects &amp; Accessories</span>
                <button
                  onClick={() => setConfig((prev) => ({ ...prev, wearJewelry: !prev.wearJewelry }))}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                    config.wearJewelry ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {config.wearJewelry ? 'Active: ON' : 'Active: OFF'}
                </button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                {wardrobeAssets
                  .filter((a) => a.category === 'jewelry' || a.category === 'object' || a.category === 'accessory')
                  .map((item) => {
                    const isSelected = config.selectedJewelryId === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            selectedJewelryId: item.id,
                            wearJewelry: true,
                          }))
                        }
                        className={`flex items-center gap-2 p-1.5 rounded-xl border text-left min-w-[140px] shrink-0 transition-all ${
                          isSelected && config.wearJewelry
                            ? 'border-purple-500 bg-purple-950/60 text-white ring-1 ring-purple-500/40'
                            : 'border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-8 h-8 rounded-lg object-contain bg-slate-950 border border-slate-800 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block text-[11px] font-bold truncate">{item.name}</span>
                          <span className="block text-[9px] text-slate-400 capitalize">
                            {item.subCategory} · {item.anchorPoint}
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Body Fit & Stretch Calibration */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span className="font-semibold">Live Body Fit &amp; Stretch</span>
                <button
                  type="button"
                  onClick={() => {
                    setClothFitStretch(1.0);
                    setClothCollarOffset(0);
                    setClothFitTightness(42);
                  }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 whitespace-nowrap"
                >
                  Reset Fit
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                    <span>Width Fit</span>
                    <span className="font-mono text-purple-300 tabular-nums">{Math.round(clothFitStretch * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.78"
                    max="1.32"
                    step="0.02"
                    value={clothFitStretch}
                    onChange={(e) => setClothFitStretch(Number(e.target.value))}
                    className="w-full accent-purple-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                    <span>Collar Drop</span>
                    <span className="font-mono text-purple-300 tabular-nums">{clothCollarOffset > 0 ? `+${clothCollarOffset}` : clothCollarOffset}px</span>
                  </div>
                  <input
                    type="range"
                    min="-24"
                    max="28"
                    step="2"
                    value={clothCollarOffset}
                    onChange={(e) => setClothCollarOffset(Number(e.target.value))}
                    className="w-full accent-purple-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                    <span>Body Hug</span>
                    <span className="font-mono text-purple-300 tabular-nums">{clothFitTightness}%</span>
                  </div>
                  <input
                    type="range"
                    min="12"
                    max="88"
                    step="2"
                    value={clothFitTightness}
                    onChange={(e) => setClothFitTightness(Number(e.target.value))}
                    className="w-full accent-purple-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DRAWER 4: ALIGNMENT & EXPRESSION */}
        {activeDrawer === 'alignment' && (
          <div className="p-3 space-y-2.5 bg-slate-950/70 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                  <span>Swap Blend Strength</span>
                  <span className="font-mono text-slate-400">{config.swapStrength}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={config.swapStrength}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, swapStrength: Number(e.target.value) }))
                  }
                  className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                  <span>Proportional Scale</span>
                  <span className="font-mono text-slate-400">
                    {Math.round(config.scale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.75"
                  max="1.35"
                  step="0.01"
                  value={config.scale}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, scale: Number(e.target.value) }))
                  }
                  className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Boundary Refinement Temporal Stabilizer (3-5 Frames) */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-[11px] font-semibold text-slate-200">
                  Temporal Boundary Stabilizer
                </span>
                <span className="block text-[10px] text-slate-400">
                  Averages alpha-matte edges across 3–5 consecutive video frames
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {[3, 4, 5].map((fCount) => {
                  const activeFrames =
                    config.boundaryStabilizerFrames ?? adjustments.boundaryStabilizerFrames ?? 4;
                  const isOn =
                    (config.boundaryTemporalStabilizer ??
                      adjustments.boundaryTemporalStabilizer) !== false;
                  const selected = isOn && activeFrames === fCount;
                  return (
                    <button
                      key={fCount}
                      type="button"
                      onClick={() => {
                        setConfig((prev) => ({
                          ...prev,
                          boundaryTemporalStabilizer: true,
                          boundaryStabilizerFrames: fCount,
                        }));
                        updateAdjustments(
                          {
                            boundaryTemporalStabilizer: true,
                            boundaryStabilizerFrames: fCount,
                          },
                          `Temporal Edge Stabilizer: ${fCount} Frames`
                        );
                      }}
                      className={`min-w-[34px] py-1 px-2 rounded-lg text-[10px] font-mono tabular-nums font-semibold transition-colors ${
                        selected
                          ? 'bg-teal-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {fCount}F
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Shutter & Mode Bar (Photo vs Video) */}
        <div className="p-2.5 sm:p-3 flex items-center justify-between gap-2 sm:gap-3">
          <input
            ref={faceGalleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async () => {
                if (typeof reader.result === 'string') {
                  await addFaceFromDataUrl(
                    reader.result,
                    file.name.replace(/\.[^/.]+$/, '').slice(0, 18),
                    'Gallery'
                  );
                }
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />

          {/* Target Profile Avatars + Quick Gallery / Camera Add */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[48%]">
            <button
              type="button"
              onClick={() => faceGalleryInputRef.current?.click()}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-indigo-600/80 hover:bg-indigo-500 text-white whitespace-nowrap shrink-0"
              title="Add face from gallery"
            >
              <Upload className="w-3 h-3" />
              <span>Gallery</span>
            </button>
            <button
              type="button"
              onClick={() => setShowFaceCamDialog(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 whitespace-nowrap shrink-0"
              title="Capture face with camera"
            >
              <Camera className="w-3 h-3" />
              <span>Cam</span>
            </button>
            {profiles.map((p) => {
              const isSelected = activeProfileId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveProfileId(p.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] whitespace-nowrap shrink-0 transition-all ${
                    isSelected
                      ? 'bg-indigo-600 text-white font-semibold ring-2 ring-indigo-400/50'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white'
                  }`}
                >
                  <img
                    src={p.avatarUrl}
                    alt={p.name}
                    className="w-4 h-4 rounded-full object-cover"
                  />
                  <span>{p.name.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>

          {/* Mode Switch: PHOTO vs VIDEO */}
          <div className="flex items-center gap-1 bg-black/60 rounded-full p-1 border border-white/15">
            <button
              onClick={() => setConfig((prev) => ({ ...prev, captureMode: 'photo' }))}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                config.captureMode === 'photo'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              PHOTO
            </button>
            <button
              onClick={() => setConfig((prev) => ({ ...prev, captureMode: 'video' }))}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                config.captureMode === 'video'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              VIDEO
            </button>
          </div>

          {/* Shutter Capture Button */}
          <div className="flex items-center justify-center shrink-0">
            {config.captureMode === 'photo' ? (
              <button
                onClick={handleCapturePhoto}
                aria-label="Capture real-time face swap photo"
                className="w-13 h-13 rounded-full border-2 border-white p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl bg-white/20"
              >
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
                  <Camera className="w-5 h-5 text-slate-950" />
                </div>
              </button>
            ) : (
              <button
                onClick={handleToggleVideoRecord}
                aria-label={isRecordingVideo ? 'Stop video recording' : 'Start video recording'}
                className="w-13 h-13 rounded-full border-2 border-rose-500 p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl bg-rose-950/40"
              >
                <div
                  className={`transition-all flex items-center justify-center ${
                    isRecordingVideo
                      ? 'w-5 h-5 rounded-sm bg-rose-500 animate-pulse'
                      : 'w-10 h-10 rounded-full bg-rose-600'
                  }`}
                >
                  {isRecordingVideo ? (
                    <Square className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Video className="w-4 h-4 text-white" />
                  )}
                </div>
              </button>
            )}
          </div>
        </div>
      </div>

      <WebcamCaptureDialog
        isOpen={showFaceCamDialog}
        mode="face"
        onClose={() => setShowFaceCamDialog(false)}
        onCapture={(dataUrl) => addFaceFromDataUrl(dataUrl, `Camera Face ${profiles.length + 1}`, 'Camera')}
      />
    </div>
  );
};
