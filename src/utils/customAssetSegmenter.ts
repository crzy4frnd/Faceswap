/**
 * Custom Clothing, Jewelry & Object Asset Segmenter
 * Client-side edge-seeded background removal, inner-loop cutout support,
 * despeckle cleanup, anti-aliased alpha feathering, color de-fringing,
 * and tight bounding-box extraction for glitch-free body fitting.
 */

export interface SegmentationOptions {
  tolerance: number; // 10 - 90 (perceptual color threshold)
  featherRadius: number; // 0 - 8 px edge softness
  sampleCorners: boolean; // auto-sample image border for background color
  customBgColor?: { r: number; g: number; b: number };
  preserveInnerHoles: boolean; // true = protect white/bright interior details; false = also cut matching enclosed holes (e.g. necklace/arm loops)
  cropToBoundingBox: boolean;
  defringeStrength?: number; // 0 - 100
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentationResult {
  canvas: HTMLCanvasElement;
  workingCanvas: HTMLCanvasElement; // normalized full-frame canvas for accurate restore-brush offsets
  cropRect: CropRect;
  backgroundColor: { r: number; g: number; b: number };
  alreadyTransparent: boolean;
}

export const DEFAULT_SEGMENTATION_OPTIONS: SegmentationOptions = {
  tolerance: 34,
  featherRadius: 2,
  sampleCorners: true,
  preserveInnerHoles: true,
  cropToBoundingBox: true,
  defringeStrength: 85,
};

/**
 * Normalizes an input image/canvas to a crisp working resolution (<= 880px max side)
 * so segmentation, mesh rendering, and persistent storage are fast and glitch-free.
 */
export function createNormalizedWorkingCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxSide: number = 880
): HTMLCanvasElement {
  const srcW =
    source instanceof HTMLImageElement
      ? source.naturalWidth || source.width
      : source.width;
  const srcH =
    source instanceof HTMLImageElement
      ? source.naturalHeight || source.height
      : source.height;

  const safeW = Math.max(1, srcW);
  const safeH = Math.max(1, srcH);
  const scale = Math.min(1, maxSide / Math.max(safeW, safeH));
  const targetW = Math.max(1, Math.round(safeW * scale));
  const targetH = Math.max(1, Math.round(safeH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, targetW, targetH);
  }
  return canvas;
}

/**
 * Samples pixels along the entire outer border (top, bottom, left, right)
 * using trimmed median estimation to resist shadows or small border objects.
 */
export function sampleDominantBackgroundColor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  const data = ctx.getImageData(0, 0, width, height).data;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const stepX = Math.max(1, Math.floor(width / 24));
  const stepY = Math.max(1, Math.floor(height / 24));

  const pushPx = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] > 20) {
      rs.push(data[idx]);
      gs.push(data[idx + 1]);
      bs.push(data[idx + 2]);
    }
  };

  for (let x = 2; x < width - 2; x += stepX) {
    pushPx(x, 2);
    pushPx(x, Math.max(2, height - 3));
  }
  for (let y = 2; y < height - 2; y += stepY) {
    pushPx(2, y);
    pushPx(Math.max(2, width - 3), y);
  }

  if (rs.length === 0) return { r: 255, g: 255, b: 255 };

  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);

  return {
    r: rs[mid],
    g: gs[mid],
    b: bs[mid],
  };
}

/**
 * Weighted perceptual color distance squared (emphasizing luminance + chroma balance)
 */
function perceptualDistSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const rMean = (r1 + r2) * 0.5;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const wr = 2 + rMean / 256;
  const wg = 4.0;
  const wb = 2 + (255 - rMean) / 256;
  return (wr * dr * dr + wg * dg * dg + wb * db * db) / 3.0;
}

/**
 * Full-precision client-side asset segmentation with edge flood-fill,
 * despeckle cleanup, anti-aliased edge feathering, background color decontamination,
 * and tight bounding-box extraction.
 */
export function segmentAssetDetailed(
  sourceCanvas: HTMLCanvasElement,
  options: Partial<SegmentationOptions> = {}
): SegmentationResult {
  const opts = { ...DEFAULT_SEGMENTATION_OPTIONS, ...options };
  const workingCanvas = createNormalizedWorkingCanvas(sourceCanvas, 880);
  const width = workingCanvas.width;
  const height = workingCanvas.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      canvas: workingCanvas,
      workingCanvas,
      cropRect: { x: 0, y: 0, width, height },
      backgroundColor: { r: 255, g: 255, b: 255 },
      alreadyTransparent: false,
    };
  }

  ctx.drawImage(workingCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPx = width * height;

  // Check if source image already carries genuine alpha transparency (e.g. PNG cutout)
  let transparentBorderCount = 0;
  const cornerCoords = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
  ];
  cornerCoords.forEach(([cx, cy]) => {
    const sx = Math.max(0, Math.min(width - 1, cx));
    const sy = Math.max(0, Math.min(height - 1, cy));
    if (data[(sy * width + sx) * 4 + 3] < 40) transparentBorderCount++;
  });

  const bg =
    opts.customBgColor ||
    (opts.sampleCorners
      ? sampleDominantBackgroundColor(ctx, width, height)
      : { r: 255, g: 255, b: 255 });

  // Skip destructive bg removal if image already has transparent corners and no custom bg picker was forced
  const alreadyTransparent = transparentBorderCount >= 3 && !opts.customBgColor;

  if (!alreadyTransparent) {
    const tol = Math.max(6, Math.min(95, opts.tolerance));
    const hardDistSq = (tol * 2.15) * (tol * 2.15);
    const softDistSq = (tol * 2.95) * (tol * 2.95);
    const localStepMaxSq = (tol * 1.45) * (tol * 1.45);

    // 1. Edge-seeded flood fill to isolate exterior background while protecting interior bright details
    const bgMask = new Uint8Array(totalPx); // 1 = background, 0 = foreground
    const visited = new Uint8Array(totalPx);
    const queue = new Int32Array(totalPx);
    let qHead = 0;
    let qTail = 0;

    const trySeed = (idx: number) => {
      if (visited[idx]) return;
      visited[idx] = 1;
      const pIdx = idx * 4;
      if (data[pIdx + 3] < 20) {
        bgMask[idx] = 1;
        queue[qTail++] = idx;
        return;
      }
      const dSq = perceptualDistSq(data[pIdx], data[pIdx + 1], data[pIdx + 2], bg.r, bg.g, bg.b);
      if (dSq <= softDistSq) {
        bgMask[idx] = 1;
        queue[qTail++] = idx;
      }
    };

    for (let x = 0; x < width; x++) {
      trySeed(x);
      trySeed((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y++) {
      trySeed(y * width);
      trySeed(y * width + (width - 1));
    }

    const dirs = [-1, 1, -width, width];
    while (qHead < qTail) {
      const cur = queue[qHead++];
      const cx = cur % width;
      const cy = Math.floor(cur / width);
      const curP = cur * 4;
      const cr = data[curP];
      const cg = data[curP + 1];
      const cb = data[curP + 2];

      for (let d = 0; d < 4; d++) {
        if (d === 0 && cx === 0) continue;
        if (d === 1 && cx === width - 1) continue;
        if (d === 2 && cy === 0) continue;
        if (d === 3 && cy === height - 1) continue;

        const nxt = cur + dirs[d];
        if (visited[nxt]) continue;
        visited[nxt] = 1;

        const np = nxt * 4;
        if (data[np + 3] < 20) {
          bgMask[nxt] = 1;
          queue[qTail++] = nxt;
          continue;
        }

        const nr = data[np];
        const ng = data[np + 1];
        const nb = data[np + 2];
        const distBg = perceptualDistSq(nr, ng, nb, bg.r, bg.g, bg.b);
        const distNeighbor = perceptualDistSq(nr, ng, nb, cr, cg, cb);

        if (distBg <= hardDistSq || (distBg <= softDistSq && distNeighbor <= localStepMaxSq)) {
          bgMask[nxt] = 1;
          queue[qTail++] = nxt;
        }
      }
    }

    // 2. Optional enclosed hole removal (e.g. gap between sleeves/waist or inside necklace chain)
    if (!opts.preserveInnerHoles) {
      const innerHardSq = (tol * 1.65) * (tol * 1.65);
      for (let i = 0; i < totalPx; i++) {
        if (bgMask[i]) continue;
        const pIdx = i * 4;
        if (data[pIdx + 3] < 20) {
          bgMask[i] = 1;
          continue;
        }
        const dSq = perceptualDistSq(data[pIdx], data[pIdx + 1], data[pIdx + 2], bg.r, bg.g, bg.b);
        if (dSq <= innerHardSq) {
          bgMask[i] = 1;
        }
      }
    }

    // 3. Morphological despeckle: remove 1-2px isolated speckles & fill 1px pinholes
    const alphaRaw = new Uint8Array(totalPx);
    for (let i = 0; i < totalPx; i++) {
      if (bgMask[i]) {
        alphaRaw[i] = 0;
      } else {
        const pIdx = i * 4;
        const distBg = perceptualDistSq(data[pIdx], data[pIdx + 1], data[pIdx + 2], bg.r, bg.g, bg.b);
        if (distBg < softDistSq && distBg > hardDistSq) {
          const t = (distBg - hardDistSq) / Math.max(1, softDistSq - hardDistSq);
          alphaRaw[i] = Math.round(255 * Math.min(1, Math.max(0, t)));
        } else {
          alphaRaw[i] = data[pIdx + 3];
        }
      }
    }

    const alphaClean = new Uint8Array(alphaRaw);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        let fgNeighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (alphaRaw[(y + dy) * width + (x + dx)] > 128) fgNeighbors++;
          }
        }
        if (alphaRaw[idx] > 128 && fgNeighbors <= 1) {
          alphaClean[idx] = 0;
        } else if (alphaRaw[idx] < 64 && fgNeighbors >= 7) {
          alphaClean[idx] = 255;
        }
      }
    }

    // 4. Boundary-only anti-aliased feathering (keeps interior 100% solid & crisp)
    const featherPx = Math.max(0, Math.min(8, Math.round(opts.featherRadius ?? 2)));
    const alphaFinal = new Uint8Array(alphaClean);
    if (featherPx > 0) {
      const r = Math.min(3, featherPx);
      for (let y = r; y < height - r; y++) {
        for (let x = r; x < width - r; x++) {
          const idx = y * width + x;
          const selfA = alphaClean[idx];
          // Check if pixel lies on the foreground/background boundary band
          let hasTransNeighbor = false;
          let hasSolidNeighbor = false;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const na = alphaClean[(y + dy) * width + (x + dx)];
              if (na < 40) hasTransNeighbor = true;
              if (na > 215) hasSolidNeighbor = true;
            }
          }
          if (hasTransNeighbor && hasSolidNeighbor) {
            let sum = 0;
            let cnt = 0;
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                sum += alphaClean[(y + dy) * width + (x + dx)];
                cnt++;
              }
            }
            const smoothed = Math.round(sum / cnt);
            alphaFinal[idx] = selfA > 0 ? Math.min(selfA, Math.max(smoothed, Math.round(selfA * 0.45))) : Math.min(180, smoothed);
          }
        }
      }
    }

    // 5. Apply final alpha + background color decontamination (removes halo fringes)
    const defringe = Math.max(0, Math.min(1, (opts.defringeStrength ?? 85) / 100));
    for (let i = 0; i < totalPx; i++) {
      const pIdx = i * 4;
      const a = alphaFinal[i];
      data[pIdx + 3] = a;
      if (a > 8 && a < 245 && defringe > 0.05) {
        const alphaNorm = a / 255;
        const blend = (1 - alphaNorm) * defringe * 0.72;
        const inv = 1 / Math.max(0.28, 1 - blend);
        data[pIdx] = Math.max(0, Math.min(255, Math.round((data[pIdx] - bg.r * blend) * inv)));
        data[pIdx + 1] = Math.max(0, Math.min(255, Math.round((data[pIdx + 1] - bg.g * blend) * inv)));
        data[pIdx + 2] = Math.max(0, Math.min(255, Math.round((data[pIdx + 2] - bg.b * blend) * inv)));
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  // 6. Compute tight foreground bounding box (alpha > 24 so faint feather doesn't bloat size)
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const finalData = ctx.getImageData(0, 0, width, height).data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (finalData[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (opts.cropToBoundingBox && maxX > minX + 8 && maxY > minY + 8) {
    const pad = 4;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + 1 + pad * 2);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const cropCtx = croppedCanvas.getContext('2d', { willReadFrequently: true });
    if (cropCtx) {
      cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      return {
        canvas: croppedCanvas,
        workingCanvas,
        cropRect: { x: cropX, y: cropY, width: cropW, height: cropH },
        backgroundColor: bg,
        alreadyTransparent,
      };
    }
  }

  return {
    canvas,
    workingCanvas,
    cropRect: { x: 0, y: 0, width, height },
    backgroundColor: bg,
    alreadyTransparent,
  };
}

/**
 * Performs client-side automatic background removal on an image canvas.
 * Creates true alpha transparency (RGBA) for clean clothing, jewelry & object overlays.
 */
export function removeAssetBackground(
  sourceCanvas: HTMLCanvasElement,
  options: Partial<SegmentationOptions> = {}
): HTMLCanvasElement {
  return segmentAssetDetailed(sourceCanvas, options).canvas;
}

/**
 * Manually erase or restore pixels on the cropped asset canvas using a soft feathered brush
 */
export function applyBrushToCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  mode: 'erase' | 'restore',
  sourceCanvas?: CanvasImageSource,
  cropOffset: { x: number; y: number } = { x: 0, y: 0 }
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();

  if (mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    const grad = ctx.createRadialGradient(x, y, radius * 0.45, x, y, radius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  } else if (mode === 'restore' && sourceCanvas) {
    ctx.drawImage(sourceCanvas, -cropOffset.x, -cropOffset.y);
  }

  ctx.restore();
}

/**
 * Converts a Canvas to a compact transparent PNG Data URL suitable for crisp overlays & storage
 */
export function exportTransparentAssetDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png', 1.0);
}
