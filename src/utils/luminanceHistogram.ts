import { DetectedFace, FaceAdjustments, FaceLandmarks, Rect } from '../types/face';
import {
  applyBackgroundLightingMatch,
  applyPhotoAdjustments,
  applyShadowMatcher,
  applySkinToneColorMatch,
  applySoftBloomEffect,
  BackgroundLightingStats,
  computeBackgroundLightingStats,
} from './faceEngine';

export interface LuminanceChannelStats {
  /** 64 smoothed bins normalized to [0..1] against the shared global peak */
  bins: number[];
  /** Raw 64 normalized density bins summing to 1.0 (for distribution similarity) */
  density: number[];
  meanLum: number;
  stdLum: number;
  shadowPct: number;
  midtonePct: number;
  highlightPct: number;
}

export interface LuminanceHistogramData {
  hasTarget: boolean;
  hasSource: boolean;
  binCount: number;
  target: LuminanceChannelStats;
  sourceAdjusted: LuminanceChannelStats;
  sourceRaw: LuminanceChannelStats;
  /** 0 - 100% Bhattacharyya distribution overlap between target and adjusted source face */
  matchScore: number;
  /** Exposure offset in EV (positive = source is brighter than target) */
  deltaEv: number;
  /** Contrast spread delta (positive = source has higher contrast than target) */
  contrastDelta: number;
}

export interface CachedFacePatches {
  key: string;
  sampleSize: number;
  targetPatch: ImageData;
  sourceRawPatch: ImageData;
  bgStats: BackgroundLightingStats;
  maskWeights: Float32Array;
  targetStats: {
    bins64: Float32Array;
    density64: Float32Array;
    meanLum: number;
    stdLum: number;
    shadowPct: number;
    midtonePct: number;
    highlightPct: number;
  };
  sourceRawStats: {
    bins64: Float32Array;
    density64: Float32Array;
    meanLum: number;
    stdLum: number;
    shadowPct: number;
    midtonePct: number;
    highlightPct: number;
  };
}

const BIN_COUNT = 64;
const SAMPLE_SIZE = 56;

const EMPTY_STATS: LuminanceChannelStats = {
  bins: new Array(BIN_COUNT).fill(0),
  density: new Array(BIN_COUNT).fill(0),
  meanLum: 0,
  stdLum: 0,
  shadowPct: 0,
  midtonePct: 0,
  highlightPct: 0,
};

export const EMPTY_HISTOGRAM_DATA: LuminanceHistogramData = {
  hasTarget: false,
  hasSource: false,
  binCount: BIN_COUNT,
  target: EMPTY_STATS,
  sourceAdjusted: EMPTY_STATS,
  sourceRaw: EMPTY_STATS,
  matchScore: 0,
  deltaEv: 0,
  contrastDelta: 0,
};

function createFaceMaskWeights(size: number): Float32Array {
  const weights = new Float32Array(size * size);
  const half = (size - 1) * 0.5 || 1;
  for (let y = 0; y < size; y++) {
    const dy = (y - half) / (half * 0.88);
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / (half * 0.78);
      const r2 = dx * dx + dy * dy;
      if (r2 <= 1.0) {
        // Smooth radial weighting emphasizing core skin & facial plane over perimeter hair/background
        weights[y * size + x] = r2 < 0.55 ? 1.0 : Math.max(0.15, 1 - (r2 - 0.55) / 0.55);
      }
    }
  }
  return weights;
}

function summarizePatchHistogram(data: Uint8ClampedArray, weights: Float32Array) {
  const raw256 = new Float32Array(256);
  let wSum = 0;
  let lumSum = 0;
  let lumSqSum = 0;
  let shadowW = 0;
  let midW = 0;
  let highW = 0;

  const pixelCount = weights.length;
  for (let p = 0; p < pixelCount; p++) {
    const w = weights[p];
    if (w <= 0) continue;

    const i = p * 4;
    if (data[i + 3] < 20) continue;

    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const bin = Math.min(255, Math.max(0, Math.round(lum)));

    raw256[bin] += w;
    wSum += w;
    lumSum += lum * w;
    lumSqSum += lum * lum * w;

    if (lum < 75) shadowW += w;
    else if (lum <= 185) midW += w;
    else highW += w;
  }

  const safeW = wSum || 1;
  const meanLum = lumSum / safeW;
  const stdLum = Math.sqrt(Math.max(0, lumSqSum / safeW - meanLum * meanLum));

  // Collapse 256 bins into 64 crisp tonal buckets
  const buckets = new Float32Array(BIN_COUNT);
  for (let b = 0; b < BIN_COUNT; b++) {
    const base = b * 4;
    buckets[b] = raw256[base] + raw256[base + 1] + raw256[base + 2] + raw256[base + 3];
  }

  // Smooth slightly with [0.22, 0.56, 0.22] kernel for clean curve rendering while preserving peaks
  const smoothed = new Float32Array(BIN_COUNT);
  const density64 = new Float32Array(BIN_COUNT);
  let smoothSum = 0;
  for (let b = 0; b < BIN_COUNT; b++) {
    const prev = buckets[Math.max(0, b - 1)];
    const cur = buckets[b];
    const next = buckets[Math.min(BIN_COUNT - 1, b + 1)];
    const val = prev * 0.22 + cur * 0.56 + next * 0.22;
    smoothed[b] = val;
    smoothSum += val;
  }

  const invSmooth = smoothSum > 0 ? 1 / smoothSum : 0;
  for (let b = 0; b < BIN_COUNT; b++) {
    density64[b] = smoothed[b] * invSmooth;
  }

  return {
    bins64: smoothed,
    density64,
    meanLum,
    stdLum,
    shadowPct: Math.round((shadowW / safeW) * 100),
    midtonePct: Math.round((midW / safeW) * 100),
    highlightPct: Math.round((highW / safeW) * 100),
  };
}

function getSourceFaceBox(sourceImg: HTMLImageElement, landmarks?: FaceLandmarks): Rect {
  const sW = sourceImg.naturalWidth || sourceImg.width || 512;
  const sH = sourceImg.naturalHeight || sourceImg.height || 512;
  if (landmarks) {
    return {
      x: landmarks.contour[0]?.x ?? sW * 0.18,
      y: landmarks.forehead.y,
      width: Math.abs(landmarks.rightEye.x - landmarks.leftEye.x) * 3 || sW * 0.64,
      height: Math.abs(landmarks.chin.y - landmarks.forehead.y) * 1.3 || sH * 0.72,
    };
  }
  return {
    x: Math.round(sW * 0.18),
    y: Math.round(sH * 0.12),
    width: Math.round(sW * 0.64),
    height: Math.round(sH * 0.72),
  };
}

/**
 * Extracts and caches 56x56 face patches + background lighting stats once per
 * (targetImage, face, sourceProfile) combination so live slider drags stay < 1ms.
 */
export function buildCachedFacePatches(
  key: string,
  targetImage: HTMLImageElement,
  targetFace: DetectedFace,
  sourceImg: HTMLImageElement,
  sourceLandmarks?: FaceLandmarks
): CachedFacePatches | null {
  const tCanvas = document.createElement('canvas');
  tCanvas.width = SAMPLE_SIZE;
  tCanvas.height = SAMPLE_SIZE;
  const tCtx = tCanvas.getContext('2d');

  const sCanvas = document.createElement('canvas');
  sCanvas.width = SAMPLE_SIZE;
  sCanvas.height = SAMPLE_SIZE;
  const sCtx = sCanvas.getContext('2d');

  if (!tCtx || !sCtx) return null;

  const tBox = targetFace.box;
  tCtx.drawImage(
    targetImage,
    tBox.x,
    tBox.y,
    Math.max(4, tBox.width),
    Math.max(4, tBox.height),
    0,
    0,
    SAMPLE_SIZE,
    SAMPLE_SIZE
  );

  const sBox = getSourceFaceBox(sourceImg, sourceLandmarks);
  sCtx.drawImage(
    sourceImg,
    sBox.x,
    sBox.y,
    Math.max(4, sBox.width),
    Math.max(4, sBox.height),
    0,
    0,
    SAMPLE_SIZE,
    SAMPLE_SIZE
  );

  const targetPatch = tCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const sourceRawPatch = sCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  const origW = targetImage.naturalWidth || targetImage.width || 640;
  const origH = targetImage.naturalHeight || targetImage.height || 640;
  const bgStats = computeBackgroundLightingStats(targetImage, origW, origH, [targetFace]);

  const maskWeights = createFaceMaskWeights(SAMPLE_SIZE);
  const targetStats = summarizePatchHistogram(targetPatch.data, maskWeights);
  const sourceRawStats = summarizePatchHistogram(sourceRawPatch.data, maskWeights);

  return {
    key,
    sampleSize: SAMPLE_SIZE,
    targetPatch,
    sourceRawPatch,
    bgStats,
    maskWeights,
    targetStats,
    sourceRawStats,
  };
}

/**
 * Applies the exact face-swap tonal & lighting pipeline to the cached 56x56 source
 * patch and returns normalized Target, Raw Source, and Adjusted Source luminance curves.
 */
export function computeRealTimeLuminanceHistogram(
  cached: CachedFacePatches | null,
  adjustments: FaceAdjustments
): LuminanceHistogramData {
  if (!cached) return EMPTY_HISTOGRAM_DATA;

  const adjustedPatch = new ImageData(
    new Uint8ClampedArray(cached.sourceRawPatch.data),
    cached.sampleSize,
    cached.sampleSize
  );

  if (adjustments.skinToneMatch) {
    applySkinToneColorMatch(
      adjustedPatch,
      cached.targetPatch,
      adjustments.skinToneStrength / 100,
      adjustments.skinReference
    );
  }
  if (adjustments.lightingAdjustment > 0) {
    applyBackgroundLightingMatch(
      adjustedPatch,
      cached.targetPatch,
      cached.bgStats,
      adjustments.lightingAdjustment / 100
    );
  }
  applyPhotoAdjustments(adjustedPatch, adjustments);
  if ((adjustments.shadowMatcher ?? 0) > 0) {
    applyShadowMatcher(
      adjustedPatch,
      cached.targetPatch,
      cached.bgStats,
      adjustments.shadowMatcher
    );
  }
  if (adjustments.softBloom > 0) {
    applySoftBloomEffect(adjustedPatch, adjustments.softBloom);
  }

  const adjSummary = summarizePatchHistogram(adjustedPatch.data, cached.maskWeights);

  // Normalize all curves cleanly against a shared peak density so relative heights compare truthfully
  let peakDensity = 0.001;
  for (let b = 0; b < BIN_COUNT; b++) {
    if (cached.targetStats.density64[b] > peakDensity) peakDensity = cached.targetStats.density64[b];
    if (adjSummary.density64[b] > peakDensity) peakDensity = adjSummary.density64[b];
    if (cached.sourceRawStats.density64[b] > peakDensity) {
      peakDensity = cached.sourceRawStats.density64[b];
    }
  }

  const toChannelStats = (raw: {
    density64: Float32Array;
    meanLum: number;
    stdLum: number;
    shadowPct: number;
    midtonePct: number;
    highlightPct: number;
  }): LuminanceChannelStats => {
    const bins = new Array<number>(BIN_COUNT);
    const density = new Array<number>(BIN_COUNT);
    for (let b = 0; b < BIN_COUNT; b++) {
      density[b] = raw.density64[b];
      bins[b] = Math.min(1, raw.density64[b] / peakDensity);
    }
    return {
      bins,
      density,
      meanLum: Math.round(raw.meanLum),
      stdLum: Math.round(raw.stdLum),
      shadowPct: raw.shadowPct,
      midtonePct: raw.midtonePct,
      highlightPct: raw.highlightPct,
    };
  };

  // Bhattacharyya coefficient between target & adjusted source luma PDFs -> 0..100% overlap
  let bc = 0;
  for (let b = 0; b < BIN_COUNT; b++) {
    bc += Math.sqrt(cached.targetStats.density64[b] * adjSummary.density64[b]);
  }
  const matchScore = Math.round(Math.min(100, Math.max(0, bc * 100)));

  const deltaEv =
    Math.round(((adjSummary.meanLum - cached.targetStats.meanLum) / 48) * 100) / 100;
  const contrastDelta = Math.round(adjSummary.stdLum - cached.targetStats.stdLum);

  return {
    hasTarget: true,
    hasSource: true,
    binCount: BIN_COUNT,
    target: toChannelStats(cached.targetStats),
    sourceAdjusted: toChannelStats(adjSummary),
    sourceRaw: toChannelStats(cached.sourceRawStats),
    matchScore,
    deltaEv,
    contrastDelta,
  };
}
