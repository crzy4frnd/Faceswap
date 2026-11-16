/**
 * Custom Clothing, Jewelry & Object Asset Segmenter
 * Multi-cluster border palette extraction, Sobel edge-barrier geodesic flood fill,
 * foreground core saliency separation, disconnected stray object removal,
 * interactive magic-wand region zap, anti-aliased edge feathering, and color defringing.
 */

export interface SegmentationOptions {
  tolerance: number; // 8 - 90 (perceptual color threshold)
  featherRadius: number; // 0 - 8 px edge softness
  sampleCorners: boolean; // auto-sample multi-cluster image border for background
  customBgColor?: { r: number; g: number; b: number };
  preserveInnerHoles: boolean; // true = keep interior details; false = cut enclosed loops matching background clusters
  removeExtraneousObjects?: boolean; // true = isolate centered primary asset and strip peripheral stray objects
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
  tolerance: 36,
  featherRadius: 2,
  sampleCorners: true,
  preserveInnerHoles: false,
  removeExtraneousObjects: true,
  cropToBoundingBox: true,
  defringeStrength: 88,
};

interface BgCluster {
  r: number;
  g: number;
  b: number;
  count: number;
}

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
 * Samples pixels along a multi-pixel perimeter ribbon and clusters them into
 * representative background swatches so uneven lighting, shadows, gradients,
 * and multi-tone backgrounds strip cleanly without stalling on a single median color.
 */
function extractBorderBackgroundClusters(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxClusters: number = 10
): BgCluster[] {
  const samples: { r: number; g: number; b: number }[] = [];
  const ribbon = Math.max(2, Math.min(6, Math.round(Math.min(width, height) * 0.015)));
  const stepX = Math.max(2, Math.floor(width / 36));
  const stepY = Math.max(2, Math.floor(height / 36));

  const pushSample = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 4;
    if (data[idx + 3] > 25) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  };

  for (let d = 1; d <= ribbon; d += 2) {
    for (let x = 1; x < width - 1; x += stepX) {
      pushSample(x, d);
      pushSample(x, height - 1 - d);
    }
    for (let y = 1; y < height - 1; y += stepY) {
      pushSample(d, y);
      pushSample(width - 1 - d, y);
    }
  }

  if (samples.length === 0) return [{ r: 255, g: 255, b: 255, count: 1 }];

  // Greedy quantized clustering (merge samples within perceptual distance ~24 RGB)
  const mergeThreshSq = 24 * 24 * 2.4;
  const clusters: { rSum: number; gSum: number; bSum: number; count: number; r: number; g: number; b: number }[] = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c];
      const d = perceptualDistSq(s.r, s.g, s.b, cl.r, cl.g, cl.b);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = c;
      }
    }

    if (bestIdx !== -1 && bestDist <= mergeThreshSq) {
      const cl = clusters[bestIdx];
      cl.rSum += s.r;
      cl.gSum += s.g;
      cl.bSum += s.b;
      cl.count += 1;
      cl.r = Math.round(cl.rSum / cl.count);
      cl.g = Math.round(cl.gSum / cl.count);
      cl.b = Math.round(cl.bSum / cl.count);
    } else if (clusters.length < maxClusters * 2) {
      clusters.push({
        rSum: s.r,
        gSum: s.g,
        bSum: s.b,
        count: 1,
        r: s.r,
        g: s.g,
        b: s.b,
      });
    }
  }

  clusters.sort((a, b) => b.count - a.count);
  const minSignificant = Math.max(2, Math.floor(samples.length * 0.025));
  const filtered = clusters
    .filter((c, idx) => idx === 0 || c.count >= minSignificant)
    .slice(0, maxClusters)
    .map((c) => ({ r: c.r, g: c.g, b: c.b, count: c.count }));

  return filtered.length > 0 ? filtered : [{ r: 255, g: 255, b: 255, count: 1 }];
}

/**
 * Samples dominant background color along the outer border (median representative).
 */
export function sampleDominantBackgroundColor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  const data = ctx.getImageData(0, 0, width, height).data;
  const clusters = extractBorderBackgroundClusters(data, width, height, 6);
  const primary = clusters[0];
  return { r: primary.r, g: primary.g, b: primary.b };
}

/**
 * Full-precision client-side asset segmentation with:
 * 1. Multi-cluster border palette modeling (handles uneven lighting, gradients & complex surfaces)
 * 2. Sobel luminance+chroma edge barrier map (stops bleed at sharp item outlines)
 * 3. Geodesic edge-aware exterior flood fill + shadow/gradient traversal
 * 4. Smart enclosed-loop hole cutting using center-foreground vs border-cluster comparison
 * 5. Connected-component extraneous object filtering (removes stray background objects)
 * 6. Despeckle, anti-aliased edge feathering, multi-cluster color defringing & tight cropping
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

  const borderClusters = opts.sampleCorners
    ? extractBorderBackgroundClusters(data, width, height, 10)
    : [{ r: 255, g: 255, b: 255, count: 1 }];

  const bgClusters: BgCluster[] = opts.customBgColor
    ? [{ r: opts.customBgColor.r, g: opts.customBgColor.g, b: opts.customBgColor.b, count: 9999 }, ...borderClusters.slice(0, 4)]
    : borderClusters;
  const bg = { r: bgClusters[0].r, g: bgClusters[0].g, b: bgClusters[0].b };

  const nearestBgClusterDistSq = (r: number, g: number, b: number) => {
    let minD = Infinity;
    let bestCluster = bgClusters[0];
    for (let c = 0; c < bgClusters.length; c++) {
      const cl = bgClusters[c];
      const d = perceptualDistSq(r, g, b, cl.r, cl.g, cl.b);
      if (d < minD) {
        minD = d;
        bestCluster = cl;
      }
    }
    return { distSq: minD, cluster: bestCluster };
  };

  // Skip destructive bg removal if image already has transparent corners and no custom bg picker was forced
  const alreadyTransparent = transparentBorderCount >= 3 && !opts.customBgColor;

  if (!alreadyTransparent) {
    const tol = Math.max(6, Math.min(95, opts.tolerance));
    const hardDistSq = (tol * 2.15) * (tol * 2.15);
    const softDistSq = (tol * 3.15) * (tol * 3.15);
    const extendedGradientDistSq = (tol * 4.4) * (tol * 4.4);
    const localStepMaxSq = (tol * 1.55) * (tol * 1.55);
    const smoothStepMaxSq = (tol * 0.72) * (tol * 0.72);

    // 1. Precompute Sobel luminance + chroma edge magnitude to protect real object outlines
    const lum = new Float32Array(totalPx);
    for (let i = 0; i < totalPx; i++) {
      const p = i * 4;
      lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    const edgeMag = new Float32Array(totalPx);
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = row + x;
        const gx =
          -lum[i - width - 1] +
          lum[i - width + 1] -
          2 * lum[i - 1] +
          2 * lum[i + 1] -
          lum[i + width - 1] +
          lum[i + width + 1];
        const gy =
          -lum[i - width - 1] -
          2 * lum[i - width] -
          lum[i - width + 1] +
          lum[i + width - 1] +
          2 * lum[i + width] +
          lum[i + width + 1];
        const lumEdge = Math.hypot(gx, gy) * 0.25;

        const pL = (i - 1) * 4;
        const pR = (i + 1) * 4;
        const pU = (i - width) * 4;
        const pD = (i + width) * 4;
        const cX =
          Math.abs(data[pR] - data[pL]) +
          Math.abs(data[pR + 1] - data[pL + 1]) +
          Math.abs(data[pR + 2] - data[pL + 2]);
        const cY =
          Math.abs(data[pD] - data[pU]) +
          Math.abs(data[pD + 1] - data[pU + 1]) +
          Math.abs(data[pD + 2] - data[pU + 2]);
        const chromaEdge = Math.hypot(cX, cY) * 0.14;
        edgeMag[i] = Math.min(255, lumEdge * 0.68 + chromaEdge * 0.32);
      }
    }

    const edgeBarrier = Math.max(20, 44 - tol * 0.25);

    // 2. Edge-seeded multi-cluster + gradient-aware geodesic flood fill
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
      const { distSq } = nearestBgClusterDistSq(data[pIdx], data[pIdx + 1], data[pIdx + 2]);
      if (distSq <= softDistSq || opts.sampleCorners) {
        // Perimeter edge seeds anchor background stripping even on cluttered or shadowed borders
        if (distSq <= extendedGradientDistSq || edgeMag[idx] < edgeBarrier) {
          bgMask[idx] = 1;
          queue[qTail++] = idx;
        }
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

        const np = nxt * 4;
        if (data[np + 3] < 20) {
          visited[nxt] = 1;
          bgMask[nxt] = 1;
          queue[qTail++] = nxt;
          continue;
        }

        const nr = data[np];
        const ng = data[np + 1];
        const nb = data[np + 2];
        const { distSq: distBg } = nearestBgClusterDistSq(nr, ng, nb);
        const distNeighbor = perceptualDistSq(nr, ng, nb, cr, cg, cb);
        const nEdge = edgeMag[nxt];

        const matchesClusterHard = distBg <= hardDistSq && (nEdge < edgeBarrier * 1.45 || distBg <= hardDistSq * 0.55);
        const matchesClusterSoft = distBg <= softDistSq && distNeighbor <= localStepMaxSq && nEdge < edgeBarrier;
        // Smooth illumination/shadow/surface walk: strips tabletops, shadowed walls & gradients until hitting an object edge
        const isSmoothGradientSurface =
          nEdge < edgeBarrier * 0.65 &&
          distNeighbor <= smoothStepMaxSq &&
          distBg <= extendedGradientDistSq;

        if (matchesClusterHard || matchesClusterSoft || isSmoothGradientSurface) {
          visited[nxt] = 1;
          bgMask[nxt] = 1;
          queue[qTail++] = nxt;
        }
      }
    }

    // 3. Build foreground core palette (inner 36% x 44%) to prevent cutting real interior bright clothes/prints
    const fgClusters: { r: number; g: number; b: number }[] = [];
    const fgSamples: { r: number; g: number; b: number }[] = [];
    const cx0 = Math.floor(width * 0.32);
    const cx1 = Math.ceil(width * 0.68);
    const cy0 = Math.floor(height * 0.28);
    const cy1 = Math.ceil(height * 0.72);
    for (let y = cy0; y < cy1; y += 3) {
      for (let x = cx0; x < cx1; x += 3) {
        const idx = y * width + x;
        if (bgMask[idx]) continue;
        const pIdx = idx * 4;
        if (data[pIdx + 3] > 60) {
          fgSamples.push({ r: data[pIdx], g: data[pIdx + 1], b: data[pIdx + 2] });
        }
      }
    }
    for (let i = 0; i < fgSamples.length && fgClusters.length < 8; i++) {
      const s = fgSamples[i];
      if (!fgClusters.some((fc) => perceptualDistSq(s.r, s.g, s.b, fc.r, fc.g, fc.b) < 28 * 28 * 2.4)) {
        fgClusters.push(s);
      }
    }

    // 4. Smart interior enclosed-loop removal (armholes, collar loops, necklaces, ring/bag gaps)
    if (!opts.preserveInnerHoles) {
      const holeVisited = new Uint8Array(totalPx);
      const holeQueue = new Int32Array(totalPx);
      const innerHardSq = (tol * 1.85) * (tol * 1.85);

      for (let i = 0; i < totalPx; i++) {
        if (bgMask[i] || holeVisited[i]) continue;
        const pIdx = i * 4;
        const { distSq: dBg } = nearestBgClusterDistSq(data[pIdx], data[pIdx + 1], data[pIdx + 2]);
        if (dBg > innerHardSq) continue;

        // Connected component of bg-colored interior pocket
        let hHead = 0;
        let hTail = 0;
        holeQueue[hTail++] = i;
        holeVisited[i] = 1;
        let sumR = 0, sumG = 0, sumB = 0;
        let touchesOuterBg = false;

        while (hHead < hTail) {
          const cur = holeQueue[hHead++];
          const cp = cur * 4;
          sumR += data[cp];
          sumG += data[cp + 1];
          sumB += data[cp + 2];

          const hx = cur % width;
          const hy = Math.floor(cur / width);
          for (let d = 0; d < 4; d++) {
            if (d === 0 && hx === 0) { touchesOuterBg = true; continue; }
            if (d === 1 && hx === width - 1) { touchesOuterBg = true; continue; }
            if (d === 2 && hy === 0) { touchesOuterBg = true; continue; }
            if (d === 3 && hy === height - 1) { touchesOuterBg = true; continue; }

            const nxt = cur + dirs[d];
            if (bgMask[nxt]) {
              touchesOuterBg = true;
              continue;
            }
            if (holeVisited[nxt]) continue;
            const np = nxt * 4;
            const { distSq: ndBg } = nearestBgClusterDistSq(data[np], data[np + 1], data[np + 2]);
            if (ndBg <= innerHardSq && edgeMag[nxt] < edgeBarrier * 1.2) {
              holeVisited[nxt] = 1;
              holeQueue[hTail++] = nxt;
            }
          }
        }

        // Compute mean pocket color and remove if it aligns closely with background vs core foreground
        const count = hTail;
        if (count >= 16) {
          const mr = sumR / count;
          const mg = sumG / count;
          const mb = sumB / count;
          const { distSq: pocketBgDist } = nearestBgClusterDistSq(mr, mg, mb);
          let pocketFgDist = Infinity;
          for (let f = 0; f < fgClusters.length; f++) {
            const fd = perceptualDistSq(mr, mg, mb, fgClusters[f].r, fgClusters[f].g, fgClusters[f].b);
            if (fd < pocketFgDist) pocketFgDist = fd;
          }

          // Clear enclosed background pocket if enclosed or clearly matching border background
          if (pocketBgDist <= innerHardSq && (touchesOuterBg || pocketBgDist < pocketFgDist * 0.72 || count < totalPx * 0.08)) {
            for (let k = 0; k < hTail; k++) {
              bgMask[holeQueue[k]] = 1;
            }
          }
        }
      }
    }

    // 5. Extraneous / Disconnected Stray Object Filtering (removes corner clutter, hands, props)
    if (opts.removeExtraneousObjects !== false) {
      const compLabel = new Int32Array(totalPx); // 0 = bg / unvisited
      const compAreas: number[] = [0];
      const compCenterScore: number[] = [0];
      const compQueue = new Int32Array(totalPx);
      let labelId = 0;

      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const normInvX = 1 / (width * 0.5 || 1);
      const normInvY = 1 / (height * 0.5 || 1);

      for (let i = 0; i < totalPx; i++) {
        if (bgMask[i] || compLabel[i] !== 0) continue;
        labelId++;
        let cHead = 0;
        let cTail = 0;
        compQueue[cTail++] = i;
        compLabel[i] = labelId;

        let sumX = 0;
        let sumY = 0;
        let touchesCenterBox = 0;

        while (cHead < cTail) {
          const cur = compQueue[cHead++];
          const px = cur % width;
          const py = Math.floor(cur / width);
          sumX += px;
          sumY += py;
          if (px >= width * 0.25 && px <= width * 0.75 && py >= height * 0.2 && py <= height * 0.8) {
            touchesCenterBox++;
          }

          for (let d = 0; d < 4; d++) {
            if (d === 0 && px === 0) continue;
            if (d === 1 && px === width - 1) continue;
            if (d === 2 && py === 0) continue;
            if (d === 3 && py === height - 1) continue;
            const nxt = cur + dirs[d];
            if (!bgMask[nxt] && compLabel[nxt] === 0) {
              compLabel[nxt] = labelId;
              compQueue[cTail++] = nxt;
            }
          }
        }

        const area = cTail;
        const meanX = sumX / area;
        const meanY = sumY / area;
        const distNorm = Math.hypot((meanX - centerX) * normInvX, (meanY - centerY) * normInvY);
        const centerWeight = (1 + (touchesCenterBox / area) * 1.8) * Math.exp(-distNorm * distNorm * 0.9);
        compAreas[labelId] = area;
        compCenterScore[labelId] = area * centerWeight;
      }

      if (labelId > 1) {
        let bestLabel = 1;
        for (let l = 2; l <= labelId; l++) {
          if (compCenterScore[l] > compCenterScore[bestLabel]) {
            bestLabel = l;
          }
        }
        const primaryArea = compAreas[bestLabel];
        // Keep primary centered component + large twin elements (e.g. pair of earrings >= 20% of primary) inside center zone
        const keep = new Uint8Array(labelId + 1);
        keep[bestLabel] = 1;
        for (let l = 1; l <= labelId; l++) {
          if (l === bestLabel) continue;
          if (compAreas[l] >= primaryArea * 0.2 && compCenterScore[l] >= compCenterScore[bestLabel] * 0.16) {
            keep[l] = 1;
          }
        }

        for (let i = 0; i < totalPx; i++) {
          const lbl = compLabel[i];
          if (lbl > 0 && !keep[lbl]) {
            bgMask[i] = 1;
          }
        }
      }
    }

    // 6. Soft boundary alpha transition + morphological despeckle
    const alphaRaw = new Uint8Array(totalPx);
    for (let i = 0; i < totalPx; i++) {
      if (bgMask[i]) {
        alphaRaw[i] = 0;
      } else {
        const pIdx = i * 4;
        const { distSq: distBg } = nearestBgClusterDistSq(data[pIdx], data[pIdx + 1], data[pIdx + 2]);
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

    // 7. Boundary-only anti-aliased feathering (keeps interior 100% solid & crisp)
    const featherPx = Math.max(0, Math.min(8, Math.round(opts.featherRadius ?? 2)));
    const alphaFinal = new Uint8Array(alphaClean);
    if (featherPx > 0) {
      const r = Math.min(3, featherPx);
      for (let y = r; y < height - r; y++) {
        for (let x = r; x < width - r; x++) {
          const idx = y * width + x;
          const selfA = alphaClean[idx];
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

    // 8. Apply final alpha + nearest-cluster background color decontamination (eliminates edge halo)
    const defringe = Math.max(0, Math.min(1, (opts.defringeStrength ?? 88) / 100));
    for (let i = 0; i < totalPx; i++) {
      const pIdx = i * 4;
      const a = alphaFinal[i];
      data[pIdx + 3] = a;
      if (a > 6 && a < 245 && defringe > 0.05) {
        const { cluster: nearBg } = nearestBgClusterDistSq(data[pIdx], data[pIdx + 1], data[pIdx + 2]);
        const alphaNorm = a / 255;
        const blend = (1 - alphaNorm) * defringe * 0.78;
        const inv = 1 / Math.max(0.22, 1 - blend);
        data[pIdx] = Math.max(0, Math.min(255, Math.round((data[pIdx] - nearBg.r * blend) * inv)));
        data[pIdx + 1] = Math.max(0, Math.min(255, Math.round((data[pIdx + 1] - nearBg.g * blend) * inv)));
        data[pIdx + 2] = Math.max(0, Math.min(255, Math.round((data[pIdx + 2] - nearBg.b * blend) * inv)));
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  // 9. Compute tight foreground bounding box (alpha > 24 so faint feather doesn't bloat size)
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
 * Click-to-remove (Magic Wand) flood fill on the segmented cutout canvas:
 * removes any unwanted connected region (extra object, hand, interior gap) matching the tapped pixel.
 */
export function applyMagicWandRemoval(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  tolerance: number = 32
): boolean {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const sx = Math.max(0, Math.min(width - 1, Math.round(startX)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(startY)));

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const startIdx = sy * width + sx;
  const sp = startIdx * 4;
  if (data[sp + 3] < 15) return false;

  const targetR = data[sp];
  const targetG = data[sp + 1];
  const targetB = data[sp + 2];
  const maxDistSq = (tolerance * 2.25) * (tolerance * 2.25);
  const stepDistSq = (tolerance * 1.45) * (tolerance * 1.45);

  const totalPx = width * height;
  const visited = new Uint8Array(totalPx);
  const queue = new Int32Array(totalPx);
  const removed = new Uint8Array(totalPx);

  let qHead = 0;
  let qTail = 0;
  visited[startIdx] = 1;
  removed[startIdx] = 1;
  queue[qTail++] = startIdx;

  const dirs = [-1, 1, -width, width];
  while (qHead < qTail) {
    const cur = queue[qHead++];
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    const cp = cur * 4;
    const cr = data[cp];
    const cg = data[cp + 1];
    const cb = data[cp + 2];

    for (let d = 0; d < 4; d++) {
      if (d === 0 && cx === 0) continue;
      if (d === 1 && cx === width - 1) continue;
      if (d === 2 && cy === 0) continue;
      if (d === 3 && cy === height - 1) continue;
      const nxt = cur + dirs[d];
      if (visited[nxt]) continue;
      const np = nxt * 4;
      if (data[np + 3] < 15) continue;

      const nr = data[np];
      const ng = data[np + 1];
      const nb = data[np + 2];
      const dTarget = perceptualDistSq(nr, ng, nb, targetR, targetG, targetB);
      const dStep = perceptualDistSq(nr, ng, nb, cr, cg, cb);

      if (dTarget <= maxDistSq || dStep <= stepDistSq * 0.65) {
        visited[nxt] = 1;
        removed[nxt] = 1;
        queue[qTail++] = nxt;
      }
    }
  }

  for (let i = 0; i < totalPx; i++) {
    if (removed[i]) {
      data[i * 4 + 3] = 0;
    }
  }

  // Soften 1px seam around removed wand boundary
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (removed[idx] || data[idx * 4 + 3] < 40) continue;
      if (
        removed[idx - 1] ||
        removed[idx + 1] ||
        removed[idx - width] ||
        removed[idx + width]
      ) {
        data[idx * 4 + 3] = Math.round(data[idx * 4 + 3] * 0.55);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return true;
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
