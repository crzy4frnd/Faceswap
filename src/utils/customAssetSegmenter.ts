/**
 * Custom Costume & Jewelry Asset Segmenter
 * Client-side auto-background removal, edge feathering, and transparent PNG extraction
 * Designed for costume clothing, jewelry, hats, and accessories captured via camera or gallery.
 */

export interface SegmentationOptions {
  tolerance: number; // 10 - 100 (color difference threshold)
  featherRadius: number; // 0 - 15 px
  sampleCorners: boolean; // auto-sample 4 corners for background color
  customBgColor?: { r: number; g: number; b: number };
  preserveInnerHoles: boolean;
  cropToBoundingBox: boolean;
}

export const DEFAULT_SEGMENTATION_OPTIONS: SegmentationOptions = {
  tolerance: 35,
  featherRadius: 3,
  sampleCorners: true,
  preserveInnerHoles: true,
  cropToBoundingBox: true,
};

/**
 * Samples the 4 corners of an image to deduce the predominant background color
 */
export function sampleDominantBackgroundColor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  const samplePoints = [
    { x: 4, y: 4 },
    { x: width - 5, y: 4 },
    { x: 4, y: height - 5 },
    { x: width - 5, y: height - 5 },
    { x: Math.floor(width / 2), y: 4 },
    { x: 4, y: Math.floor(height / 2) },
    { x: width - 5, y: Math.floor(height / 2) },
  ];

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  samplePoints.forEach((pt) => {
    if (pt.x >= 0 && pt.x < width && pt.y >= 0 && pt.y < height) {
      const p = ctx.getImageData(pt.x, pt.y, 1, 1).data;
      rSum += p[0];
      gSum += p[1];
      bSum += p[2];
      count++;
    }
  });

  return {
    r: Math.round(rSum / (count || 1)),
    g: Math.round(gSum / (count || 1)),
    b: Math.round(bSum / (count || 1)),
  };
}

/**
 * Performs client-side automatic background removal on an image canvas
 * Creates true alpha transparency (RGBA) for clean costume & jewelry overlay
 */
export function removeAssetBackground(
  sourceCanvas: HTMLCanvasElement,
  options: Partial<SegmentationOptions> = {}
): HTMLCanvasElement {
  const opts = { ...DEFAULT_SEGMENTATION_OPTIONS, ...options };
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  // Work on an offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return sourceCanvas;

  // Draw source image
  ctx.drawImage(sourceCanvas, 0, 0);

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Determine target background color
  const bg = opts.customBgColor || (opts.sampleCorners ? sampleDominantBackgroundColor(ctx, width, height) : { r: 255, g: 255, b: 255 });
  const tolerance = opts.tolerance;
  const toleranceSq = (tolerance * 2.5) * (tolerance * 2.5);

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 10) continue;

    // Euclidean color distance to background
    const dr = r - bg.r;
    const dg = g - bg.g;
    const db = b - bg.b;
    const distSq = dr * dr + dg * dg + db * db;

    if (distSq < toleranceSq) {
      // Smooth feather alpha falloff
      const ratio = distSq / toleranceSq;
      if (ratio < 0.65) {
        data[i + 3] = 0; // Pure transparent
      } else {
        data[i + 3] = Math.round(255 * ((ratio - 0.65) / 0.35));
      }
    } else {
      // Solid foreground pixel, expand bounding box
      const pixelIdx = i / 4;
      const px = pixelIdx % width;
      const py = Math.floor(pixelIdx / width);

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // If cropToBoundingBox is enabled and valid foreground is detected, crop tightly with padding
  if (opts.cropToBoundingBox && maxX > minX && maxY > minY) {
    const pad = 12;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + pad * 2);

    if (cropW > 20 && cropH > 20) {
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropW;
      croppedCanvas.height = cropH;
      const cropCtx = croppedCanvas.getContext('2d');
      if (cropCtx) {
        cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        return croppedCanvas;
      }
    }
  }

  return canvas;
}

/**
 * Manually erase or restore pixels on the asset canvas using a brush tool
 */
export function applyBrushToCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  mode: 'erase' | 'restore',
  sourceImage?: CanvasImageSource
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  if (mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.fill();
  } else if (mode === 'restore' && sourceImage) {
    ctx.clip();
    ctx.drawImage(sourceImage, 0, 0);
  }

  ctx.restore();
}

/**
 * Converts a Canvas or Image to a high-quality transparent PNG Data URL
 */
export function exportTransparentAssetDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png', 1.0);
}
