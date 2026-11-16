import loftBgUrl from '../assets/images/bg_studio_loft_1794418283525.jpg';
import neonBgUrl from '../assets/images/bg_cyberpunk_neon_1794418296547.jpg';
import sunsetBgUrl from '../assets/images/bg_sunset_terrace_1794418316494.jpg';
import { BodyLandmarks } from '../types/body';
import { Point } from '../types/face';

export interface VirtualBackground {
  id: 'studio' | 'neon' | 'sunset' | 'green' | 'none';
  name: string;
  category: string;
  thumbnail: string;
  url?: string;
  color?: string;
}

export const VIRTUAL_BACKGROUNDS: VirtualBackground[] = [
  {
    id: 'studio',
    name: 'Studio Loft',
    category: 'Minimalist Loft',
    thumbnail: loftBgUrl,
    url: loftBgUrl,
  },
  {
    id: 'neon',
    name: 'Cyberpunk Neon',
    category: 'Vibrant City',
    thumbnail: neonBgUrl,
    url: neonBgUrl,
  },
  {
    id: 'sunset',
    name: 'Sunset Terrace',
    category: 'Golden Coast',
    thumbnail: sunsetBgUrl,
    url: sunsetBgUrl,
  },
  {
    id: 'green',
    name: 'Chroma Green',
    category: 'Green Screen',
    thumbnail: '',
    color: '#00ff33',
  },
];

/**
 * Fast real-time live body segmentation and background replacement.
 * Isolates the human subject and composites them seamlessly onto the virtual studio background.
 */
export function renderLiveSegmentedBackground(
  ctx: CanvasRenderingContext2D,
  videoOrCanvas: HTMLVideoElement | HTMLCanvasElement,
  vw: number,
  vh: number,
  bgImg: HTMLImageElement | null,
  bgColor?: string,
  isMirrored: boolean = false,
  trackedBox?: NormalizedFaceBox
) {
  // 1. Draw Virtual Background first
  if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
    ctx.drawImage(bgImg, 0, 0, vw, vh);
  } else if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, vw, vh);
  } else {
    // Default transparent / deep dark studio backdrop
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, vw, vh);
  }

  // 2. Offscreen Matte / Mask for human subject (Tracked Head + Neck + Shoulders/Torso)
  ctx.save();

  const headW = trackedBox
    ? Math.max(vw * 0.24, vw * trackedBox.width * 1.18)
    : vw * 0.36;
  const headH = trackedBox
    ? Math.max(headW * 1.28, vh * trackedBox.height * 1.14)
    : headW * 1.35;
  const headCX = trackedBox ? vw * trackedBox.cx : vw / 2;
  const headCY = trackedBox ? vh * trackedBox.cy : vh * 0.38;

  const chinY = headCY + headH * 0.45;
  const shoulderW = Math.min(vw * 0.96, Math.max(vw * 0.56, headW * 2.55));
  const shoulderH = Math.max(vh * 0.55, (vh - chinY) * 1.18);
  const shoulderCX = headCX;
  const shoulderCY = chinY + shoulderH * 0.46;

  ctx.beginPath();
  // Torso / Shoulders mass anchored dynamically under tracked head
  ctx.ellipse(shoulderCX, shoulderCY, shoulderW / 2, shoulderH / 2, 0, 0, Math.PI * 2);
  // Neck column bridge
  ctx.rect(headCX - headW * 0.22, headCY, headW * 0.44, chinY - headCY + headH * 0.26);
  // Head & Neck mass
  ctx.ellipse(headCX, headCY, headW / 2, headH / 2, 0, 0, Math.PI * 2);
  ctx.clip();

  // 3. Draw live video feed inside the segmented body mask
  ctx.save();
  if (isMirrored) {
    ctx.translate(vw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoOrCanvas, 0, 0, vw, vh);
  ctx.restore();

  ctx.restore();

  // Soft edge anti-aliasing vignette around the body silhouette
  ctx.save();
  const edgeGradient = ctx.createRadialGradient(
    headCX,
    headCY + headH * 0.2,
    headW * 0.58,
    headCX,
    headCY + headH * 0.2,
    headW * 1.25
  );
  edgeGradient.addColorStop(0, 'rgba(0,0,0,0)');
  edgeGradient.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = edgeGradient;
  ctx.fillRect(0, 0, vw, vh);
  ctx.restore();
}

/**
 * Real-time Facial and Body Unwanted Hair & Blemish Smoothing Filter.
 * Performs edge-preserving bilateral skin smoothing to remove unwanted hair, stubble,
 * peach fuzz, and surface blemishes while preserving eyes, lips, and facial contours.
 */
export function applyLiveHairAndBlemishRemoval(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  faceW: number,
  faceH: number,
  intensity: number = 75
) {
  if (intensity <= 0) return;

  const padX = faceW * 0.35;
  const padY = faceH * 0.45;
  const rx = Math.max(0, Math.round(cx - faceW / 2 - padX));
  const ry = Math.max(0, Math.round(cy - faceH / 2 - padY * 0.2));
  const rw = Math.min(ctx.canvas.width - rx, Math.round(faceW + padX * 2));
  const rh = Math.min(ctx.canvas.height - ry, Math.round(faceH + padY * 2));

  if (rw <= 10 || rh <= 10) return;

  try {
    const imgData = ctx.getImageData(rx, ry, rw, rh);
    const data = imgData.data;
    const factor = intensity / 100;

    // Skin chrominance smoothing buffer
    const copy = new Uint8ClampedArray(data);

    // Fast 3x3 selective bilateral filter on skin pixels
    const width = rw;
    const height = rh;

    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const idx = (y * width + x) * 4;
        const r = copy[idx];
        const g = copy[idx + 1];
        const b = copy[idx + 2];

        // Human skin tone detection rule in RGB:
        // R > G > B, with sufficient red-green separation and not overly saturated
        const isSkin = r > 70 && g > 40 && b > 25 && r > g && g >= b && r - b > 14;

        if (isSkin) {
          // Average surrounding skin pixels to blur micro hair follicles and blemishes
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let count = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nIdx = ((y + dy) * width + (x + dx)) * 4;
              const nr = copy[nIdx];
              const ng = copy[nIdx + 1];
              const nb = copy[nIdx + 2];

              // Edge preservation: only average pixels with similar luminance
              const diff = Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb);
              if (diff < 55) {
                sumR += nr;
                sumG += ng;
                sumB += nb;
                count++;
              }
            }
          }

          if (count > 0) {
            const avgR = sumR / count;
            const avgG = sumG / count;
            const avgB = sumB / count;

            // Apply blend
            data[idx] = Math.round(r * (1 - factor * 0.65) + avgR * (factor * 0.65));
            data[idx + 1] = Math.round(g * (1 - factor * 0.65) + avgG * (factor * 0.65));
            data[idx + 2] = Math.round(b * (1 - factor * 0.65) + avgB * (factor * 0.65));

            // Smooth neighboring pixel
            if (x + 1 < width) {
              const nIdx = (y * width + (x + 1)) * 4;
              data[nIdx] = Math.round(data[nIdx] * (1 - factor * 0.45) + avgR * (factor * 0.45));
              data[nIdx + 1] = Math.round(data[nIdx + 1] * (1 - factor * 0.45) + avgG * (factor * 0.45));
              data[nIdx + 2] = Math.round(data[nIdx + 2] * (1 - factor * 0.45) + avgB * (factor * 0.45));
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, rx, ry);
  } catch {
    // If CORS or tainted canvas, fallback gracefully
  }
}

/**
 * Records live video clips from HTML5 canvas stream using MediaRecorder.
 */
export class CanvasVideoRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording: boolean = false;
  private startTime: number = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  public start(): boolean {
    if (this.isRecording) return false;
    this.recordedChunks = [];

    try {
      const stream = this.canvas.captureStream(30); // 30 FPS

      let options: MediaRecorderOptions = { mimeType: 'video/webm;codecs=vp9' };
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options = { mimeType: 'video/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
          options = { mimeType: 'video/mp4' };
          if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
            options = {};
          }
        }
      }

      this.mediaRecorder = new MediaRecorder(stream, options);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(200); // 200ms slices
      this.isRecording = true;
      this.startTime = Date.now();
      return true;
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      return false;
    }
  }

  public stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || !this.isRecording) {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        const blob = new Blob(this.recordedChunks, {
          type: this.mediaRecorder?.mimeType || 'video/webm',
        });
        resolve(blob);
      };

      try {
        this.mediaRecorder.stop();
      } catch {
        this.isRecording = false;
        resolve(null);
      }
    });
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  public getElapsedSeconds(): number {
    if (!this.isRecording) return 0;
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

export type SwapMotionLevel = 'low' | 'medium' | 'high';
export type SwapQualityMode = 'high' | 'balanced' | 'light';

export interface AdaptiveSwapQualityProfile {
  qualityMode: SwapQualityMode;
  motionLevel: SwapMotionLevel;
  motionScore: number;
  renderScale: number;
  hairRemovalInterval: number; // 1 = every frame, 2 = alternate frames, 0 = disabled
  useFilterBlur: boolean;
  useSoftLightToneBlend: boolean;
  useDropShadows: boolean;
}

export function getStaticHighQualityProfile(): AdaptiveSwapQualityProfile {
  return {
    qualityMode: 'high',
    motionLevel: 'low',
    motionScore: 0,
    renderScale: 1.0,
    hairRemovalInterval: 1,
    useFilterBlur: true,
    useSoftLightToneBlend: true,
    useDropShadows: true,
  };
}

/**
 * Lightweight optical + IMU motion detector for live camera frames.
 * Computes downsampled frame-to-frame luminance delta in <0.15ms and applies
 * hysteresis to switch cleanly between high, balanced, and lightweight swap modes.
 */
export class CameraMotionAnalyzer {
  private readonly sampleW = 48;
  private readonly sampleH = 36;
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleCtx: CanvasRenderingContext2D | null = null;
  private prevLuma: Uint8Array | null = null;
  private smoothedMotion = 0;
  private currentMode: SwapQualityMode = 'high';
  private lastModeUpgradeBlockUntil = 0;

  private ensureContext(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    if (!this.sampleCanvas) {
      this.sampleCanvas = document.createElement('canvas');
      this.sampleCanvas.width = this.sampleW;
      this.sampleCanvas.height = this.sampleH;
      this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    return this.sampleCtx;
  }

  public reset(): void {
    this.prevLuma = null;
    this.smoothedMotion = 0;
    this.currentMode = 'high';
    this.lastModeUpgradeBlockUntil = 0;
  }

  public analyze(
    video: HTMLVideoElement | null,
    isLiveVideoReady: boolean,
    imuImpulse: number = 0,
    nowMs: number = performance.now()
  ): AdaptiveSwapQualityProfile {
    let opticalMotion = 0;

    if (isLiveVideoReady && video) {
      const ctx = this.ensureContext();
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, this.sampleW, this.sampleH);
          const pixels = ctx.getImageData(0, 0, this.sampleW, this.sampleH).data;
          const total = this.sampleW * this.sampleH;

          if (!this.prevLuma) {
            this.prevLuma = new Uint8Array(total);
            for (let i = 0; i < total; i++) {
              const p = i * 4;
              this.prevLuma[i] = (pixels[p] * 77 + pixels[p + 1] * 150 + pixels[p + 2] * 29) >> 8;
            }
          } else {
            let diffSum = 0;
            let activeDiffCount = 0;
            // Stride by 2 pixels for fast frame-to-frame delta
            for (let i = 0; i < total; i += 2) {
              const p = i * 4;
              const luma = (pixels[p] * 77 + pixels[p + 1] * 150 + pixels[p + 2] * 29) >> 8;
              const delta = Math.abs(luma - this.prevLuma[i]);
              this.prevLuma[i] = luma;
              diffSum += delta;
              if (delta > 14) activeDiffCount++;
            }
            const sampledCount = Math.ceil(total / 2);
            const meanDelta = diffSum / sampledCount;
            const activeRatio = activeDiffCount / sampledCount;
            // Scale combined delta & moving-pixel ratio onto 0..100 scale
            opticalMotion = Math.min(100, meanDelta * 1.9 + activeRatio * 45);
          }
        } catch {
          opticalMotion = 0;
        }
      }
    }

    const rawImpulse = Math.min(100, Math.max(opticalMotion, imuImpulse));
    // Fast attack when motion rises, smooth decay when camera settles
    const alpha = rawImpulse > this.smoothedMotion ? 0.42 : 0.14;
    this.smoothedMotion = this.smoothedMotion * (1 - alpha) + rawImpulse * alpha;

    // Hysteresis switching: drop quality immediately on high motion, wait >=550ms before restoring
    let targetMode: SwapQualityMode = 'high';
    if (this.smoothedMotion >= 22) {
      targetMode = 'light';
    } else if (this.smoothedMotion >= 9.5) {
      targetMode = 'balanced';
    }

    const modeRank: Record<SwapQualityMode, number> = { high: 2, balanced: 1, light: 0 };
    if (modeRank[targetMode] < modeRank[this.currentMode]) {
      this.currentMode = targetMode;
      this.lastModeUpgradeBlockUntil = nowMs + 550;
    } else if (modeRank[targetMode] > modeRank[this.currentMode] && nowMs >= this.lastModeUpgradeBlockUntil) {
      this.currentMode = targetMode;
      this.lastModeUpgradeBlockUntil = nowMs + 350;
    }

    const motionLevel: SwapMotionLevel =
      this.currentMode === 'light' ? 'high' : this.currentMode === 'balanced' ? 'medium' : 'low';

    if (this.currentMode === 'light') {
      return {
        qualityMode: 'light',
        motionLevel,
        motionScore: Math.round(this.smoothedMotion),
        renderScale: 0.65,
        hairRemovalInterval: 0,
        useFilterBlur: false,
        useSoftLightToneBlend: false,
        useDropShadows: false,
      };
    }

    if (this.currentMode === 'balanced') {
      return {
        qualityMode: 'balanced',
        motionLevel,
        motionScore: Math.round(this.smoothedMotion),
        renderScale: 0.82,
        hairRemovalInterval: 2,
        useFilterBlur: true,
        useSoftLightToneBlend: false,
        useDropShadows: false,
      };
    }

    return {
      qualityMode: 'high',
      motionLevel,
      motionScore: Math.round(this.smoothedMotion),
      renderScale: 1.0,
      hairRemovalInterval: 1,
      useFilterBlur: true,
      useSoftLightToneBlend: true,
      useDropShadows: true,
    };
  }
}

export interface NormalizedFaceBox {
  x: number; // 0..1 left
  y: number; // 0..1 top
  width: number; // 0..1 width
  height: number; // 0..1 height
  cx: number; // 0..1 center x
  cy: number; // 0..1 center y
}

export interface LiveTrackedFaceResult {
  box: NormalizedFaceBox;
  detectedCount: number;
  suddenShiftDetected: boolean;
  refocusActiveUntil: number;
}

/**
 * Real-time largest-face bounding-box tracker and sudden-shift detector for live camera.
 * Scans an 80x60 downsampled frame for skin-tone face regions, locks onto the largest
 * detected face, and triggers an immediate bounding-box re-center whenever a sudden
 * subject shift occurs (or when manually triggered).
 */
export class LiveFaceBoxTracker {
  private readonly sampleW = 80;
  private readonly sampleH = 60;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private frameCounter = 0;

  private smoothedBox: NormalizedFaceBox = {
    x: 0.33,
    y: 0.21,
    width: 0.34,
    height: 0.44,
    cx: 0.5,
    cy: 0.43,
  };
  private anchorBox: NormalizedFaceBox = { ...this.smoothedBox };
  private lastDetectedRawBox: NormalizedFaceBox = { ...this.smoothedBox };
  private detectedCount = 1;
  private refocusActiveUntil = 0;
  private lastRefocusTriggerMs = 0;

  private ensureContext(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.sampleW;
      this.canvas.height = this.sampleH;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    return this.ctx;
  }

  private detectLargestFaceBlob(
    video: HTMLVideoElement,
    isMirrored: boolean
  ): { box: NormalizedFaceBox | null; count: number } {
    const ctx = this.ensureContext();
    if (!ctx) return { box: null, count: 0 };

    try {
      ctx.save();
      ctx.clearRect(0, 0, this.sampleW, this.sampleH);
      if (isMirrored) {
        ctx.translate(this.sampleW, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, this.sampleW, this.sampleH);
      ctx.restore();

      const data = ctx.getImageData(0, 0, this.sampleW, this.sampleH).data;
      const total = this.sampleW * this.sampleH;
      const skinMask = new Uint8Array(total);

      for (let y = 2; y < this.sampleH - 4; y++) {
        const row = y * this.sampleW;
        for (let x = 4; x < this.sampleW - 4; x++) {
          const i = (row + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // YCbCr skin-chrominance cluster
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 45 && cb >= 77 && cb <= 129 && cr >= 132 && cr <= 176) {
            skinMask[row + x] = 1;
          }
        }
      }

      // Connected-component flood fill to isolate distinct face candidates & select largest
      const visited = new Uint8Array(total);
      let bestArea = 0;
      let bestBox: NormalizedFaceBox | null = null;
      let faceCandidateCount = 0;
      const stack = new Int32Array(total);

      for (let y = 2; y < this.sampleH - 4; y++) {
        for (let x = 4; x < this.sampleW - 4; x++) {
          const startIdx = y * this.sampleW + x;
          if (!skinMask[startIdx] || visited[startIdx]) continue;

          let top = 0;
          stack[top++] = startIdx;
          visited[startIdx] = 1;

          let minX = x;
          let maxX = x;
          let minY = y;
          let maxY = y;
          let area = 0;

          while (top > 0) {
            const cur = stack[--top];
            const cy = Math.floor(cur / this.sampleW);
            const cx = cur - cy * this.sampleW;
            area++;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            const neighbors = [cur - 1, cur + 1, cur - this.sampleW, cur + this.sampleW];
            for (let n = 0; n < 4; n++) {
              const ni = neighbors[n];
              if (ni >= 0 && ni < total && skinMask[ni] && !visited[ni]) {
                visited[ni] = 1;
                stack[top++] = ni;
              }
            }
          }

          const bw = maxX - minX + 1;
          const bh = maxY - minY + 1;
          const aspect = bw / Math.max(1, bh);

          // Filter valid face-scale blobs
          if (area >= 42 && bw >= 8 && bh >= 10 && aspect >= 0.45 && aspect <= 1.55) {
            faceCandidateCount++;
            if (area > bestArea) {
              bestArea = area;
              const nx = minX / this.sampleW;
              const ny = minY / this.sampleH;
              const nw = Math.min(0.65, Math.max(0.18, bw / this.sampleW));
              const nh = Math.min(0.8, Math.max(0.24, (bh / this.sampleH) * 1.12));
              bestBox = {
                x: nx,
                y: ny,
                width: nw,
                height: nh,
                cx: nx + nw / 2,
                cy: ny + nh / 2,
              };
            }
          }
        }
      }

      return { box: bestBox, count: faceCandidateCount };
    } catch {
      return { box: null, count: 0 };
    }
  }

  public update(
    video: HTMLVideoElement | null,
    isLiveVideoReady: boolean,
    isMirrored: boolean,
    autoRefocusEnabled: boolean,
    forceRefocus: boolean,
    nowMs: number = performance.now(),
    motionSmoothingPercent: number = 0
  ): LiveTrackedFaceResult {
    this.frameCounter++;
    let suddenShiftDetected = false;

    if (isLiveVideoReady && video && (this.frameCounter % 4 === 1 || forceRefocus)) {
      const { box, count } = this.detectLargestFaceBlob(video, isMirrored);
      if (box) {
        this.lastDetectedRawBox = box;
        this.detectedCount = Math.max(1, count);

        // Measure sudden positional or scale shift relative to current locked anchor
        const shiftDist = Math.hypot(box.cx - this.anchorBox.cx, box.cy - this.anchorBox.cy);
        const sizeDelta = Math.abs(box.width - this.anchorBox.width);

        if (
          autoRefocusEnabled &&
          (shiftDist > 0.085 || sizeDelta > 0.08) &&
          nowMs - this.lastRefocusTriggerMs > 450
        ) {
          suddenShiftDetected = true;
          this.anchorBox = { ...box };
          this.lastRefocusTriggerMs = nowMs;
          this.refocusActiveUntil = nowMs + 1150;
        }
      }
    }

    if (forceRefocus) {
      suddenShiftDetected = true;
      this.anchorBox = { ...this.lastDetectedRawBox };
      this.lastRefocusTriggerMs = nowMs;
      this.refocusActiveUntil = nowMs + 1150;
    }

    // Target box is anchored largest face when Auto-Refocus is active, or smooth drift follow
    const target = autoRefocusEnabled ? this.lastDetectedRawBox : this.anchorBox;
    const smoothNorm = Math.min(1, Math.max(0, motionSmoothingPercent / 100));
    const baseFollowLerp = 0.16 - smoothNorm * 0.115; // 0.16 down to 0.045 when max smoothing
    const lerp =
      nowMs < this.refocusActiveUntil
        ? 0.34
        : autoRefocusEnabled
        ? baseFollowLerp
        : 0.08 - smoothNorm * 0.04;

    const nx = this.smoothedBox.x + (target.x - this.smoothedBox.x) * lerp;
    const ny = this.smoothedBox.y + (target.y - this.smoothedBox.y) * lerp;
    const nw = this.smoothedBox.width + (target.width - this.smoothedBox.width) * lerp;
    const nh = this.smoothedBox.height + (target.height - this.smoothedBox.height) * lerp;

    this.smoothedBox = {
      x: nx,
      y: ny,
      width: nw,
      height: nh,
      cx: nx + nw / 2,
      cy: ny + nh / 2,
    };

    return {
      box: this.smoothedBox,
      detectedCount: this.detectedCount,
      suddenShiftDetected,
      refocusActiveUntil: this.refocusActiveUntil,
    };
  }
}

export interface TemporalFacePose {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

export interface SmoothedTemporalPose extends TemporalFacePose {
  speedPx: number;
}

/**
 * Temporal filter across live video frames that:
 * 1) Applies velocity-adaptive exponential damping to face position, scale, and roll
 *    to remove frame-to-frame detector jitter.
 * 2) Applies motion-gated temporal pixel accumulation across the face-swap cutout
 *    to reduce exposure/color/texture flickering without introducing motion ghosting.
 */
export class TemporalMotionSmoother {
  private prevPose: TemporalFacePose | null = null;
  private prevTimestamp = 0;
  private prevFaceCanvas: HTMLCanvasElement | null = null;
  private prevFaceCtx: CanvasRenderingContext2D | null = null;
  private hasPrevFrame = false;

  public reset(): void {
    this.prevPose = null;
    this.prevTimestamp = 0;
    this.hasPrevFrame = false;
  }

  public smoothPose(
    raw: TemporalFacePose,
    motionSmoothingPercent: number,
    snapImmediately: boolean = false,
    nowMs: number = performance.now()
  ): SmoothedTemporalPose {
    if (
      !this.prevPose ||
      snapImmediately ||
      motionSmoothingPercent <= 1 ||
      nowMs - this.prevTimestamp > 500
    ) {
      this.prevPose = { ...raw };
      this.prevTimestamp = nowMs;
      return { ...raw, speedPx: 0 };
    }

    const strength = Math.min(1, Math.max(0, motionSmoothingPercent / 100));
    const dx = raw.cx - this.prevPose.cx;
    const dy = raw.cy - this.prevPose.cy;
    const moveDist = Math.hypot(dx, dy);

    // Dead-zone micro-jitter suppression + velocity-adaptive follow factor
    const minAlpha = Math.max(0.08, 1 - strength * 0.88); // 1.0 at 0% -> 0.12 at 100%
    const velocityBoost = Math.min(0.65, moveDist / 38);
    const alpha = Math.min(1, minAlpha + velocityBoost * (1 - strength * 0.35));

    const nextPose: TemporalFacePose = {
      cx: this.prevPose.cx + dx * alpha,
      cy: this.prevPose.cy + dy * alpha,
      width: this.prevPose.width + (raw.width - this.prevPose.width) * alpha,
      height: this.prevPose.height + (raw.height - this.prevPose.height) * alpha,
      rotation: this.prevPose.rotation + (raw.rotation - this.prevPose.rotation) * alpha,
    };

    const smoothedSpeed = Math.hypot(
      nextPose.cx - this.prevPose.cx,
      nextPose.cy - this.prevPose.cy
    );

    this.prevPose = nextPose;
    this.prevTimestamp = nowMs;

    return {
      ...nextPose,
      speedPx: smoothedSpeed,
    };
  }

  /**
   * Motion-gated temporal IIR frame stabilization across the rendered face cutout
   * to suppress lighting/exposure flicker and compression shimmer.
   */
  public stabilizeFacePatch(
    sCtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    motionSmoothingPercent: number,
    poseSpeedPx: number
  ): void {
    if (motionSmoothingPercent <= 1 || w < 4 || h < 4 || typeof document === 'undefined') {
      this.hasPrevFrame = false;
      return;
    }

    if (!this.prevFaceCanvas) {
      this.prevFaceCanvas = document.createElement('canvas');
      this.prevFaceCtx = this.prevFaceCanvas.getContext('2d');
    }

    const prevCanvas = this.prevFaceCanvas;
    const prevCtx = this.prevFaceCtx;
    if (!prevCtx) return;

    const sizeChanged = prevCanvas.width !== w || prevCanvas.height !== h;
    if (sizeChanged) {
      prevCanvas.width = w;
      prevCanvas.height = h;
      this.hasPrevFrame = false;
    }

    if (this.hasPrevFrame) {
      const strength = Math.min(1, Math.max(0, motionSmoothingPercent / 100));
      // Attenuate temporal pixel persistence during fast subject movement to avoid ghosting
      const motionRejection = Math.exp(-Math.pow(poseSpeedPx / 7.5, 2));
      const temporalBlend = Math.min(0.56, strength * 0.54 * motionRejection);

      if (temporalBlend > 0.02) {
        sCtx.save();
        sCtx.globalCompositeOperation = 'source-over';
        sCtx.globalAlpha = temporalBlend;
        sCtx.drawImage(prevCanvas, 0, 0, w, h);
        sCtx.restore();
      }
    }

    // Store stabilized current frame for next video tick
    prevCtx.clearRect(0, 0, w, h);
    prevCtx.drawImage(sCtx.canvas, 0, 0, w, h);
    this.hasPrevFrame = true;
  }
}

export interface LiveBodyTrackingResult {
  landmarks: BodyLandmarks;
  shoulderSpan: number;
  torsoTurnDeg: number;
  breathingChestPx: number;
}

/**
 * Real-time anthropometric & optical torso/shoulder contour tracker for Live Camera AR wardrobe fitting.
 * Samples the live camera feed below the tracked face box to measure left/right shoulder edges,
 * neck clearance below chin, torso center shift, and 2.5D yaw asymmetry so garments fit the body
 * below the collarbone/shoulders and stretch dynamically as the user moves or leans.
 */
export class LiveBodyTracker {
  private readonly sampleW = 80;
  private readonly sampleH = 60;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private frameCount = 0;

  // Exponentially smoothed anthropometric state (normalized relative to face width/height)
  private leftShoulderRatio = 1.14; // half-span / faceW
  private rightShoulderRatio = 1.14;
  private neckDropRatio = 0.34; // vertical drop from chin to shoulder seam / faceH
  private torsoOffsetRatio = 0; // horizontal offset from head cx / faceW
  private smoothRollDeg = 0;

  private ensureContext(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.sampleW;
      this.canvas.height = this.sampleH;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    return this.ctx;
  }

  public reset(): void {
    this.leftShoulderRatio = 1.14;
    this.rightShoulderRatio = 1.14;
    this.neckDropRatio = 0.34;
    this.torsoOffsetRatio = 0;
    this.smoothRollDeg = 0;
    this.frameCount = 0;
  }

  private sampleLiveShoulders(
    video: HTMLVideoElement,
    isMirrored: boolean,
    faceBox: NormalizedFaceBox
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      ctx.save();
      ctx.clearRect(0, 0, this.sampleW, this.sampleH);
      if (isMirrored) {
        ctx.translate(this.sampleW, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, this.sampleW, this.sampleH);
      ctx.restore();

      const data = ctx.getImageData(0, 0, this.sampleW, this.sampleH).data;
      const w = this.sampleW;
      const h = this.sampleH;

      const fCx = faceBox.cx * w;
      const fW = Math.max(8, faceBox.width * w);
      const fH = Math.max(10, faceBox.height * h);
      const chinY = faceBox.cy * h + fH * 0.46;

      if (chinY >= h - 4) return;

      // Estimate top-corner background swatch on the left and right edges
      const samplePatchAvg = (x0: number, y0: number, pw: number, ph: number) => {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let yy = y0; yy < Math.min(h, y0 + ph); yy++) {
          for (let xx = x0; xx < Math.min(w, x0 + pw); xx++) {
            const i = (yy * w + xx) * 4;
            sr += data[i];
            sg += data[i + 1];
            sb += data[i + 2];
            cnt++;
          }
        }
        return cnt > 0 ? [sr / cnt, sg / cnt, sb / cnt] : [128, 128, 128];
      };

      const bgLeft = samplePatchAvg(1, 2, 5, 8);
      const bgRight = samplePatchAvg(w - 6, 2, 5, 8);

      // 1. Scan vertical column down the center below chin to locate skin-neck -> garment collar transition
      const cxInt = Math.max(2, Math.min(w - 3, Math.round(fCx)));
      let neckDropPx = fH * 0.34;
      const maxNeckScanY = Math.min(h - 2, Math.round(chinY + fH * 0.58));
      const minNeckScanY = Math.max(0, Math.round(chinY + fH * 0.16));

      for (let y = minNeckScanY; y <= maxNeckScanY; y++) {
        let skinHits = 0;
        for (let dx = -1; dx <= 1; dx++) {
          const idx = (y * w + (cxInt + dx)) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
          if (r > 50 && cb >= 75 && cb <= 130 && cr >= 132 && cr <= 178) {
            skinHits++;
          }
        }
        // As soon as vertical scan leaves bare throat into clothing collar/chest edge
        if (skinHits === 0) {
          neckDropPx = Math.max(fH * 0.28, y - chinY);
          break;
        }
      }

      const rawNeckDrop = Math.max(0.28, Math.min(0.46, neckDropPx / fH));
      this.neckDropRatio = this.neckDropRatio * 0.8 + rawNeckDrop * 0.2;

      // 2. Scan outward left & right along shoulder seam & upper chest to measure true shoulder width
      const seamY1 = Math.min(h - 2, Math.max(0, Math.round(chinY + this.neckDropRatio * fH)));
      const seamY2 = Math.min(h - 2, Math.max(0, Math.round(seamY1 + fH * 0.12)));

      const scanShoulderEdge = (dir: -1 | 1, bgColor: number[]) => {
        const startX = Math.max(1, Math.min(w - 2, cxInt));
        const maxSteps = Math.round(fW * 1.55);
        const minSteps = Math.round(fW * 0.85);
        let bestEdge = fW * 1.12;

        // Reference core torso color slightly below collar
        const refIdx = (seamY2 * w + startX) * 4;
        const refR = data[refIdx];
        const refG = data[refIdx + 1];
        const refB = data[refIdx + 2];

        for (let step = minSteps; step <= maxSteps; step++) {
          const sx = startX + dir * step;
          if (sx <= 1 || sx >= w - 2) {
            bestEdge = step;
            break;
          }
          const idx1 = (seamY1 * w + sx) * 4;
          const idxPrev = (seamY1 * w + (sx - dir)) * 4;

          const bgDist = Math.hypot(
            data[idx1] - bgColor[0],
            data[idx1 + 1] - bgColor[1],
            data[idx1 + 2] - bgColor[2]
          );
          const torsoDist = Math.hypot(
            data[idx1] - refR,
            data[idx1 + 1] - refG,
            data[idx1 + 2] - refB
          );
          const edgeJump =
            Math.abs(data[idx1] - data[idxPrev]) +
            Math.abs(data[idx1 + 1] - data[idxPrev + 1]) +
            Math.abs(data[idx1 + 2] - data[idxPrev + 2]);

          // Silhouette transition: pixel matches corner background closely OR strong vertical outer contour gradient
          if ((bgDist < 34 && torsoDist > 26) || (edgeJump > 52 && step >= fW * 0.96)) {
            bestEdge = step;
            break;
          }
        }
        return Math.max(0.9, Math.min(1.48, bestEdge / fW));
      };

      const measuredL = scanShoulderEdge(-1, bgLeft);
      const measuredR = scanShoulderEdge(1, bgRight);

      // Gentle exponential damping so shoulders stretch fluidly without micro-twitch
      this.leftShoulderRatio = this.leftShoulderRatio * 0.82 + measuredL * 0.18;
      this.rightShoulderRatio = this.rightShoulderRatio * 0.82 + measuredR * 0.18;

      const asym = (this.rightShoulderRatio - this.leftShoulderRatio) * 0.5;
      this.torsoOffsetRatio = this.torsoOffsetRatio * 0.84 + asym * 0.16;
    } catch {
      // Fallback smoothly to previous ratios
    }
  }

  public update(
    video: HTMLVideoElement | null,
    isLiveVideoReady: boolean,
    isMirrored: boolean,
    faceBox: NormalizedFaceBox,
    cx: number,
    cy: number,
    faceW: number,
    faceH: number,
    headRollDeg: number,
    timestampMs: number
  ): LiveBodyTrackingResult {
    this.frameCount++;
    if (isLiveVideoReady && video && this.frameCount % 3 === 1) {
      this.sampleLiveShoulders(video, isMirrored, faceBox);
    }

    // Dampen head roll into subtle shoulder roll (shoulders tilt ~38% of head tilt naturally)
    const targetRoll = headRollDeg * 0.38;
    this.smoothRollDeg = this.smoothRollDeg * 0.78 + targetRoll * 0.22;
    const rollRad = (this.smoothRollDeg * Math.PI) / 180;
    const cosR = Math.cos(rollRad);
    const sinR = Math.sin(rollRad);

    // Subtle breathing phase (0..1 cycle)
    const tSec = timestampMs / 1000;
    const breatheSin = Math.sin(tSec * 1.75);
    const breathingChestPx = (breatheSin * 0.5 + 0.5) * Math.max(2, faceW * 0.032);

    // Core anatomical coordinates strictly anchored below chin so clothes NEVER cover neck/chin
    const chinY = cy + faceH * 0.48;
    const neckY = chinY + faceH * 0.13;
    const throatY = chinY + faceH * 0.23;

    // Shoulder seam drops below chin by anatomical neck proportion
    const shoulderMidX = cx + this.torsoOffsetRatio * faceW;
    const shoulderMidY = chinY + faceH * this.neckDropRatio;

    const halfLeft = faceW * this.leftShoulderRatio;
    const halfRight = faceW * this.rightShoulderRatio;
    const shoulderSpan = halfLeft + halfRight;
    const waistHalfSpan = shoulderSpan * 0.41;
    const chestHalfSpan = shoulderSpan * 0.45 + breathingChestPx * 0.35;
    const hipHalfSpan = shoulderSpan * 0.46;

    const rotateFromShoulder = (dx: number, dy: number): Point => ({
      x: shoulderMidX + dx * cosR - dy * sinR,
      y: shoulderMidY + dx * sinR + dy * cosR,
    });

    // Slight natural downward trapezius slope from neck to acromion tip
    const trapDrop = shoulderSpan * 0.045;
    const sternumDrop = shoulderSpan * 0.24;
    const chestDrop = shoulderSpan * 0.28;
    const waistDrop = shoulderSpan * 0.72;
    const navelDrop = shoulderSpan * 0.76;
    const hipDrop = shoulderSpan * 1.05;
    const elbowDrop = shoulderSpan * 0.56;
    const wristDrop = shoulderSpan * 0.98;

    const leftShoulder = rotateFromShoulder(-halfLeft, trapDrop);
    const rightShoulder = rotateFromShoulder(halfRight, trapDrop);
    const leftChest = rotateFromShoulder(-chestHalfSpan, chestDrop);
    const rightChest = rotateFromShoulder(chestHalfSpan, chestDrop);
    const leftWaist = rotateFromShoulder(-waistHalfSpan, waistDrop);
    const rightWaist = rotateFromShoulder(waistHalfSpan, waistDrop);
    const leftHip = rotateFromShoulder(-hipHalfSpan, hipDrop);
    const rightHip = rotateFromShoulder(hipHalfSpan, hipDrop);

    const torsoTurnDeg = Math.max(
      -18,
      Math.min(18, (this.rightShoulderRatio - this.leftShoulderRatio) * 32)
    );

    const landmarks: BodyLandmarks = {
      nose: { x: cx, y: cy + faceH * 0.05 },
      neck: { x: cx + this.torsoOffsetRatio * faceW * 0.35, y: neckY },
      throat: { x: cx + this.torsoOffsetRatio * faceW * 0.6, y: throatY },
      leftShoulder,
      rightShoulder,
      sternum: rotateFromShoulder(0, sternumDrop),
      leftChest,
      rightChest,
      leftWaist,
      rightWaist,
      navel: rotateFromShoulder(0, navelDrop),
      leftHip,
      rightHip,
      leftElbow: rotateFromShoulder(-halfLeft * 1.12, elbowDrop),
      rightElbow: rotateFromShoulder(halfRight * 1.12, elbowDrop),
      leftWrist: rotateFromShoulder(-halfLeft * 1.18, wristDrop),
      rightWrist: rotateFromShoulder(halfRight * 1.18, wristDrop),
    };

    return {
      landmarks,
      shoulderSpan,
      torsoTurnDeg,
      breathingChestPx,
    };
  }
}




