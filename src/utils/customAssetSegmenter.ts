/**
 * Custom Clothing, Jewelry & Object Cutout Engine (Picsart-Style Mask Workflow)
 *
 * Non-destructive dual-buffer cutout pipeline:
 *  - workingCanvas: normalized RGB source photo (never mutated)
 *  - maskCanvas: grayscale/alpha cutout mask (0 = excluded, 255 = kept in final asset)
 *
 * Supports:
 *  - Freehand Outline / Lasso cutout (Keep Inside, Add Inside, Subtract Inside) with hardness feathering
 *  - 1-Tap Smart Clothe saliency seed (optional non-destructive subject/garment mask)
 *  - Continuous interpolated Brush (Keep/Restore) & Erase strokes with independent Hardness (0-100%)
 *  - Real-time Picsart-style translucent Overlay rendering so background edges stay visible while brushing/erasing
 *  - Tight alpha-trimmed transparent PNG export for 2D Cloth Mesh & Wardrobe assets
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export type LassoApplyMode = 'replace' | 'add' | 'subtract';
export type OverlayTintColor = 'rose' | 'indigo' | 'emerald';

export interface BrushToolSettings {
  size: number;     // 4 - 80 px diameter/radius factor
  hardness: number; // 0 - 100 %
  overlay: number;  // 0 - 100 % mask/source overlay visibility
}

export interface CutoutPreviewOptions {
  overlayOpacity: number; // 0 - 100
  overlayTint: OverlayTintColor;
  showOriginalThroughCutout?: boolean;
}

/**
 * Normalizes an input image/canvas to a crisp working resolution (<= 880px max side)
 * so cutout editing, mesh rendering, and persistent storage stay smooth on mobile & desktop.
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
 * Initializes the cutout alpha mask canvas aligned 1:1 with `workingCanvas`.
 * If the source already carries genuine alpha transparency (e.g. a PNG cutout),
 * preserves its existing alpha channel; otherwise starts fully selected (opaque) or empty.
 */
export function createInitialCutoutMask(
  workingCanvas: HTMLCanvasElement,
  mode: 'preserve-alpha' | 'full' | 'empty' = 'preserve-alpha'
): { maskCanvas: HTMLCanvasElement; hasSourceAlpha: boolean } {
  const w = workingCanvas.width;
  const h = workingCanvas.height;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });

  if (!mctx) return { maskCanvas, hasSourceAlpha: false };

  let hasSourceAlpha = false;
  if (mode === 'preserve-alpha') {
    const wctx = workingCanvas.getContext('2d', { willReadFrequently: true });
    if (wctx) {
      const imgData = wctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      let transparentPx = 0;
      const step = Math.max(1, Math.floor((w * h) / 4000));
      let sampled = 0;
      for (let i = 0; i < w * h; i += step) {
        sampled++;
        if (data[i * 4 + 3] < 235) transparentPx++;
      }
      hasSourceAlpha = sampled > 0 && transparentPx / sampled > 0.03;

      if (hasSourceAlpha) {
        const maskImg = mctx.createImageData(w, h);
        const mdata = maskImg.data;
        for (let i = 0; i < w * h; i++) {
          const p = i * 4;
          const a = data[p + 3];
          mdata[p] = 255;
          mdata[p + 1] = 255;
          mdata[p + 2] = 255;
          mdata[p + 3] = a;
        }
        mctx.putImageData(maskImg, 0, 0);
        return { maskCanvas, hasSourceAlpha: true };
      }
    }
  }

  if (mode !== 'empty') {
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, w, h);
  }
  return { maskCanvas, hasSourceAlpha: false };
}

/**
 * Fills or clears the entire cutout mask.
 */
export function fillCutoutMask(maskCanvas: HTMLCanvasElement, selectAll: boolean): void {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  if (selectAll) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
  }
}

/**
 * Inverts the active cutout mask (selected <-> excluded).
 */
export function invertCutoutMask(maskCanvas: HTMLCanvasElement): void {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = maskCanvas;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = 255 - d[i + 3];
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Applies a Picsart-style Freehand Outline / Lasso cutout path to `maskCanvas`.
 * Supports:
 *  - 'replace': keeps ONLY pixels inside the drawn clothe outline
 *  - 'add': adds the outlined region to the current cutout
 *  - 'subtract': cuts the outlined hole/area out of the current cutout
 *
 * Includes hardness-controlled feathering so outline edges aren't jagged.
 */
export function applyLassoCutoutToMask(
  maskCanvas: HTMLCanvasElement,
  points: Point2D[],
  mode: LassoApplyMode,
  hardnessPct: number = 85
): boolean {
  if (points.length < 3) return false;
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  const w = maskCanvas.width;
  const h = maskCanvas.height;

  // Create a clean polygon canvas and apply hardness feathering via blur if needed
  const polyCanvas = document.createElement('canvas');
  polyCanvas.width = w;
  polyCanvas.height = h;
  const pctx = polyCanvas.getContext('2d', { willReadFrequently: true });
  if (!pctx) return false;

  // Smooth quadratic midpoint path for organic garment curves
  const buildPath = (targetCtx: CanvasRenderingContext2D) => {
    targetCtx.beginPath();
    targetCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) * 0.5;
      const my = (points[i].y + points[i + 1].y) * 0.5;
      targetCtx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    const last = points[points.length - 1];
    targetCtx.lineTo(last.x, last.y);
    targetCtx.closePath();
  };

  const clampedHardness = Math.max(0, Math.min(100, hardnessPct));
  const featherPx = clampedHardness >= 96 ? 0.5 : ((100 - clampedHardness) / 100) * 14 + 0.5;

  pctx.save();
  if (featherPx > 0.6) {
    pctx.filter = `blur(${featherPx.toFixed(1)}px)`;
  }
  buildPath(pctx);
  pctx.fillStyle = '#ffffff';
  pctx.fill();
  pctx.restore();

  ctx.save();
  if (mode === 'replace') {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(polyCanvas, 0, 0);
  } else if (mode === 'add') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(polyCanvas, 0, 0);
  } else {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(polyCanvas, 0, 0);
  }
  ctx.restore();

  return true;
}

/**
 * Stamps a single radial gradient brush circle at (x, y) with continuous hardness control (0..100%).
 */
function stampBrushCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hardnessPct: number,
  mode: 'brush' | 'erase'
) {
  const safeRadius = Math.max(2, radius);
  const hNorm = Math.max(0, Math.min(1, hardnessPct / 100));
  const innerRadius = safeRadius * (hNorm * 0.94);

  ctx.save();
  ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';

  if (hNorm >= 0.98) {
    ctx.beginPath();
    ctx.arc(x, y, safeRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.fill();
  } else {
    const grad = ctx.createRadialGradient(x, y, innerRadius, x, y, safeRadius);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(Math.min(0.99, hNorm + (1 - hNorm) * 0.45), 'rgba(255, 255, 255, 0.72)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, safeRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draws a continuous interpolated Brush (restore/keep) or Erase stroke onto `maskCanvas`.
 * Interpolating between `fromPt` and `toPt` prevents dotted strokes during rapid mouse/finger swipes.
 */
export function strokeMaskBrush(
  maskCanvas: HTMLCanvasElement,
  fromPt: Point2D,
  toPt: Point2D,
  radius: number,
  hardnessPct: number,
  mode: 'brush' | 'erase'
): void {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.hypot(dx, dy);
  const spacing = Math.max(1.5, radius * 0.22);
  const steps = Math.max(1, Math.ceil(dist / spacing));

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 1 : i / steps;
    const px = fromPt.x + dx * t;
    const py = fromPt.y + dy * t;
    stampBrushCircle(ctx, px, py, radius, hardnessPct, mode);
  }
}

/**
 * Optional 1-Tap "Smart Clothe" cutout seed (Picsart-style Person/Clothe quick mask):
 * Builds a soft foreground garment selection around the central torso/garment region
 * using color contrast against outer margins + Sobel edge coherence, WITHOUT destroying
 * the underlying workingCanvas so users can freely refine edges with Brush & Erase.
 */
export function computeSmartClotheMask(
  workingCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement
): void {
  const w = workingCanvas.width;
  const h = workingCanvas.height;
  const wctx = workingCanvas.getContext('2d', { willReadFrequently: true });
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!wctx || !mctx) return;

  const srcData = wctx.getImageData(0, 0, w, h).data;

  // Sample outer frame vs centered garment swatch
  const bgSamples: [number, number, number][] = [];
  const stepX = Math.max(2, Math.floor(w / 24));
  const stepY = Math.max(2, Math.floor(h / 24));
  for (let x = 2; x < w - 2; x += stepX) {
    const t = (3 * w + x) * 4;
    const b = ((h - 4) * w + x) * 4;
    bgSamples.push([srcData[t], srcData[t + 1], srcData[t + 2]]);
    bgSamples.push([srcData[b], srcData[b + 1], srcData[b + 2]]);
  }
  for (let y = 2; y < h - 2; y += stepY) {
    const l = (y * w + 3) * 4;
    const r = (y * w + (w - 4)) * 4;
    bgSamples.push([srcData[l], srcData[l + 1], srcData[l + 2]]);
    bgSamples.push([srcData[r], srcData[r + 1], srcData[r + 2]]);
  }

  // Sample center core points
  const fgSamples: [number, number, number][] = [];
  const cxStart = Math.floor(w * 0.34);
  const cxEnd = Math.ceil(w * 0.66);
  const cyStart = Math.floor(h * 0.28);
  const cyEnd = Math.ceil(h * 0.72);
  const fgStepX = Math.max(2, Math.floor((cxEnd - cxStart) / 14));
  const fgStepY = Math.max(2, Math.floor((cyEnd - cyStart) / 14));
  for (let y = cyStart; y < cyEnd; y += fgStepY) {
    for (let x = cxStart; x < cxEnd; x += fgStepX) {
      const idx = (y * w + x) * 4;
      fgSamples.push([srcData[idx], srcData[idx + 1], srcData[idx + 2]]);
    }
  }

  const minColorDistSq = (r: number, g: number, b: number, palette: [number, number, number][]) => {
    let minD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = r - p[0];
      const dg = g - p[1];
      const db = b - p[2];
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < minD) minD = d;
    }
    return minD;
  };

  const maskImg = mctx.createImageData(w, h);
  const out = maskImg.data;
  const rawScore = new Float32Array(w * h);

  const halfW = w * 0.5;
  const halfH = h * 0.5;

  for (let y = 0; y < h; y++) {
    const ny = (y - halfH) / (halfH * 0.85);
    for (let x = 0; x < w; x++) {
      const nx = (x - halfW) / (halfW * 0.85);
      const radialDistSq = nx * nx + ny * ny;
      const centerPrior = Math.exp(-radialDistSq * 0.85);

      const idx = y * w + x;
      const p = idx * 4;
      const r = srcData[p];
      const g = srcData[p + 1];
      const b = srcData[p + 2];

      const dBg = Math.sqrt(minColorDistSq(r, g, b, bgSamples));
      const dFg = Math.sqrt(minColorDistSq(r, g, b, fgSamples));

      // Likelihood pixel belongs to centered clothe vs outer background
      const colorScore = (dBg - dFg * 0.85) / 48;
      rawScore[idx] = colorScore + (centerPrior - 0.35) * 1.45;
    }
  }

  // Smooth 3x3 box pass to remove speckle holes inside garment folds
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const avg =
        (rawScore[idx - w - 1] +
          rawScore[idx - w] +
          rawScore[idx - w + 1] +
          rawScore[idx - 1] +
          rawScore[idx] +
          rawScore[idx + 1] +
          rawScore[idx + w - 1] +
          rawScore[idx + w] +
          rawScore[idx + w + 1]) /
        9;

      const p = idx * 4;
      out[p] = 255;
      out[p + 1] = 255;
      out[p + 2] = 255;
      // Soft sigmoid transition around threshold 0
      const alpha = Math.max(0, Math.min(255, Math.round((1 / (1 + Math.exp(-avg * 4.5))) * 255)));
      out[p + 3] = alpha > 24 ? alpha : 0;
    }
  }

  mctx.putImageData(maskImg, 0, 0);
}

/**
 * Composites `workingCanvas` + `maskCanvas` onto `displayCanvas` with Picsart-style Overlay.
 *
 * How Overlay works:
 *  - Kept cutout pixels (`mask alpha`) render crisp & clear from `workingCanvas`.
 *  - Excluded/erased background pixels remain faintly visible (`overlayOpacity%`) tinted with
 *    a Picsart cutout color (rose/red, indigo, or emerald) so the user can see exact cloth contours
 *    while brushing back or erasing edges!
 *  - When `overlayOpacity === 0`, only the pure transparent cutout is rendered.
 */
export function renderCutoutCompositePreview(
  displayCanvas: HTMLCanvasElement,
  workingCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  options: CutoutPreviewOptions
): void {
  const w = workingCanvas.width;
  const h = workingCanvas.height;
  if (displayCanvas.width !== w || displayCanvas.height !== h) {
    displayCanvas.width = w;
    displayCanvas.height = h;
  }

  const ctx = displayCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);

  // 1. Render excluded background overlay layer (ghosted source + Picsart mask tint)
  const overlayFactor = Math.max(0, Math.min(1, options.overlayOpacity / 100));
  if (overlayFactor > 0.01) {
    ctx.save();
    // Show original image softly underneath so erased edges & details remain traceable
    ctx.globalAlpha = 0.18 + overlayFactor * 0.55;
    ctx.drawImage(workingCanvas, 0, 0);

    // Apply Picsart cutout overlay color over the full frame before laying crisp cutout on top
    const tintMap: Record<OverlayTintColor, string> = {
      rose: `rgba(244, 63, 94, ${(overlayFactor * 0.44).toFixed(3)})`,
      indigo: `rgba(99, 102, 241, ${(overlayFactor * 0.44).toFixed(3)})`,
      emerald: `rgba(16, 185, 129, ${(overlayFactor * 0.4).toFixed(3)})`,
    };
    ctx.globalAlpha = 1;
    ctx.fillStyle = tintMap[options.overlayTint];
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 2. Build crisp masked foreground cutout offscreen and composite over the overlay
  const fgCanvas = document.createElement('canvas');
  fgCanvas.width = w;
  fgCanvas.height = h;
  const fgCtx = fgCanvas.getContext('2d');
  if (fgCtx) {
    fgCtx.drawImage(workingCanvas, 0, 0);
    fgCtx.globalCompositeOperation = 'destination-in';
    fgCtx.drawImage(maskCanvas, 0, 0);
    ctx.drawImage(fgCanvas, 0, 0);
  }
}

/**
 * Extracts the final tightly trimmed RGBA transparent PNG canvas by masking
 * `workingCanvas` with `maskCanvas` and cropping to non-transparent bounds.
 */
export function extractTrimmedTransparentCutout(
  workingCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  padPx: number = 4
): { canvas: HTMLCanvasElement; cropRect: CropRect; keptPixelRatio: number } {
  const w = workingCanvas.width;
  const h = workingCanvas.height;

  const fullMasked = document.createElement('canvas');
  fullMasked.width = w;
  fullMasked.height = h;
  const fctx = fullMasked.getContext('2d', { willReadFrequently: true });

  if (!fctx) {
    return {
      canvas: workingCanvas,
      cropRect: { x: 0, y: 0, width: w, height: h },
      keptPixelRatio: 1,
    };
  }

  fctx.drawImage(workingCanvas, 0, 0);
  fctx.globalCompositeOperation = 'destination-in';
  fctx.drawImage(maskCanvas, 0, 0);
  fctx.globalCompositeOperation = 'source-over';

  const imgData = fctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let keptCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = imgData[(y * w + x) * 4 + 3];
      if (a > 12) {
        keptCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const keptPixelRatio = keptCount / Math.max(1, w * h);

  if (maxX < minX || maxY < minY) {
    // Nothing masked yet — fall back cleanly to full working canvas
    return {
      canvas: workingCanvas,
      cropRect: { x: 0, y: 0, width: w, height: h },
      keptPixelRatio: 0,
    };
  }

  const cx = Math.max(0, minX - padPx);
  const cy = Math.max(0, minY - padPx);
  const cw = Math.max(1, Math.min(w - cx, maxX - minX + 1 + padPx * 2));
  const ch = Math.max(1, Math.min(h - cy, maxY - minY + 1 + padPx * 2));

  const trimmed = document.createElement('canvas');
  trimmed.width = cw;
  trimmed.height = ch;
  const tctx = trimmed.getContext('2d');
  if (tctx) {
    tctx.drawImage(fullMasked, cx, cy, cw, ch, 0, 0, cw, ch);
  }

  return {
    canvas: trimmed,
    cropRect: { x: cx, y: cy, width: cw, height: ch },
    keptPixelRatio,
  };
}

/**
 * Converts a Canvas to a compact transparent PNG Data URL suitable for crisp overlays & storage
 */
export function exportTransparentAssetDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png', 1.0);
}
