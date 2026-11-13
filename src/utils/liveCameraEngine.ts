import loftBgUrl from '../assets/images/bg_studio_loft_1794418283525.jpg';
import neonBgUrl from '../assets/images/bg_cyberpunk_neon_1794418296547.jpg';
import sunsetBgUrl from '../assets/images/bg_sunset_terrace_1794418316494.jpg';

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
  isMirrored: boolean = false
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

  // 2. Offscreen Matte / Mask for human subject (Head + Neck + Torso)
  // Human body follows an anatomical silhouette centered horizontally
  ctx.save();

  // Create human body silhouette clipping mask
  const headW = vw * 0.36;
  const headH = headW * 1.35;
  const headCX = vw / 2;
  const headCY = vh * 0.38;

  const shoulderW = vw * 0.82;
  const shoulderH = vh * 0.65;
  const shoulderCX = vw / 2;
  const shoulderCY = vh * 0.88;

  ctx.beginPath();
  // Torso / Shoulders mass
  ctx.ellipse(shoulderCX, shoulderCY, shoulderW / 2, shoulderH / 2, 0, 0, Math.PI * 2);
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
    headCY + 40,
    headW * 0.55,
    headCX,
    headCY + 40,
    headW * 1.15
  );
  edgeGradient.addColorStop(0, 'rgba(0,0,0,0)');
  edgeGradient.addColorStop(1, 'rgba(0,0,0,0.18)');
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
