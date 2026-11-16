import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { loadImage } from '../utils/faceEngine';
import {
  buildCachedFacePatches,
  CachedFacePatches,
  computeRealTimeLuminanceHistogram,
} from '../utils/luminanceHistogram';

const CHART_W = 320;
const CHART_H = 104;
const PAD_TOP = 8;
const PAD_BOTTOM = 4;
const PLOT_H = CHART_H - PAD_TOP - PAD_BOTTOM;

function buildSmoothAreaPath(bins: number[], closeArea: boolean): string {
  const n = bins.length;
  if (n === 0) return '';

  const pts = bins.map((val, idx) => ({
    x: (idx / (n - 1)) * CHART_W,
    y: PAD_TOP + PLOT_H * (1 - Math.max(0, Math.min(1, val))),
  }));

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = Math.max(PAD_TOP, Math.min(CHART_H - PAD_BOTTOM, p1.y + (p2.y - p0.y) / 6));
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = Math.max(PAD_TOP, Math.min(CHART_H - PAD_BOTTOM, p2.y - (p3.y - p1.y) / 6));

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  if (closeArea) {
    d += ` L ${CHART_W} ${(CHART_H - PAD_BOTTOM).toFixed(2)} L 0 ${(CHART_H - PAD_BOTTOM).toFixed(2)} Z`;
  }
  return d;
}

export const LuminanceHistogram: React.FC = () => {
  const {
    targetImageElement,
    targetImageUrl,
    detectedFaces,
    selectedFaceId,
    profiles,
    activeProfileId,
    adjustments,
    getProfileImage,
    profileImagesVersion,
  } = useFaceStudio();

  const [showRawCurve, setShowRawCurve] = useState(false);
  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const [fallbackSourceImg, setFallbackSourceImg] = useState<HTMLImageElement | null>(null);
  const patchCacheRef = useRef<CachedFacePatches | null>(null);

  const selectedFace = useMemo(
    () => detectedFaces.find((f) => f.id === selectedFaceId) || detectedFaces[0] || null,
    [detectedFaces, selectedFaceId]
  );

  const sourceProfileId = selectedFace?.assignedProfileId || activeProfileId;
  const sourceProfile = useMemo(
    () => profiles.find((p) => p.id === sourceProfileId) || null,
    [profiles, sourceProfileId]
  );

  const cachedSourceImg = useMemo(
    () => (sourceProfile ? getProfileImage(sourceProfile.id) : null),
    [sourceProfile, getProfileImage, profileImagesVersion]
  );

  useEffect(() => {
    if (!sourceProfile || cachedSourceImg) {
      setFallbackSourceImg(null);
      return;
    }
    let cancelled = false;
    loadImage(sourceProfile.fullImageUrl)
      .then((img) => {
        if (!cancelled) setFallbackSourceImg(img);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sourceProfile, cachedSourceImg]);

  const sourceImg = cachedSourceImg || fallbackSourceImg;

  const cachedPatches = useMemo(() => {
    if (!targetImageElement || !selectedFace || !sourceImg || !sourceProfile) {
      return null;
    }
    const cacheKey = [
      targetImageUrl || targetImageElement.src,
      selectedFace.id,
      Math.round(selectedFace.box.x),
      Math.round(selectedFace.box.y),
      Math.round(selectedFace.box.width),
      Math.round(selectedFace.box.height),
      sourceProfile.id,
    ].join('|');

    if (patchCacheRef.current?.key === cacheKey) {
      return patchCacheRef.current;
    }

    const built = buildCachedFacePatches(
      cacheKey,
      targetImageElement,
      selectedFace,
      sourceImg,
      sourceProfile.detectedLandmarks
    );
    patchCacheRef.current = built;
    return built;
  }, [targetImageElement, targetImageUrl, selectedFace, sourceImg, sourceProfile]);

  const histogram = useMemo(
    () => computeRealTimeLuminanceHistogram(cachedPatches, adjustments),
    [cachedPatches, adjustments]
  );

  const targetFillPath = useMemo(
    () => (histogram.hasTarget ? buildSmoothAreaPath(histogram.target.bins, true) : ''),
    [histogram.hasTarget, histogram.target.bins]
  );
  const targetStrokePath = useMemo(
    () => (histogram.hasTarget ? buildSmoothAreaPath(histogram.target.bins, false) : ''),
    [histogram.hasTarget, histogram.target.bins]
  );
  const sourceFillPath = useMemo(
    () => (histogram.hasSource ? buildSmoothAreaPath(histogram.sourceAdjusted.bins, true) : ''),
    [histogram.hasSource, histogram.sourceAdjusted.bins]
  );
  const sourceStrokePath = useMemo(
    () => (histogram.hasSource ? buildSmoothAreaPath(histogram.sourceAdjusted.bins, false) : ''),
    [histogram.hasSource, histogram.sourceAdjusted.bins]
  );
  const sourceRawPath = useMemo(
    () =>
      showRawCurve && histogram.hasSource
        ? buildSmoothAreaPath(histogram.sourceRaw.bins, false)
        : '',
    [showRawCurve, histogram.hasSource, histogram.sourceRaw.bins]
  );

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!histogram.hasTarget || !histogram.hasSource) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.min(histogram.binCount - 1, Math.max(0, Math.round(relX * (histogram.binCount - 1))));
    setHoverBin(idx);
  };

  const isReady = histogram.hasTarget && histogram.hasSource;
  const targetMeanX = (histogram.target.meanLum / 255) * CHART_W;
  const sourceMeanX = (histogram.sourceAdjusted.meanLum / 255) * CHART_W;

  const matchToneClass =
    histogram.matchScore >= 82
      ? 'text-emerald-600 dark:text-emerald-400'
      : histogram.matchScore >= 62
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-rose-600 dark:text-rose-400';

  const hoverTargetPct =
    hoverBin !== null && isReady
      ? (histogram.target.density[hoverBin] * 100).toFixed(1)
      : null;
  const hoverSourcePct =
    hoverBin !== null && isReady
      ? (histogram.sourceAdjusted.density[hoverBin] * 100).toFixed(1)
      : null;
  const hoverLuma =
    hoverBin !== null ? Math.round((hoverBin / (histogram.binCount - 1)) * 255) : null;

  return (
    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
              Luminance Histogram
            </span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {isReady ? (
              <>
                <span className={`font-mono tabular-nums font-semibold ${matchToneClass}`}>
                  {histogram.matchScore}% match
                </span>
                {' · '}
                <span className="font-mono tabular-nums">
                  {histogram.deltaEv >= 0 ? `+${histogram.deltaEv.toFixed(2)}` : histogram.deltaEv.toFixed(2)} EV
                </span>
                {' · '}
                <span className="font-mono tabular-nums">
                  Contrast {histogram.contrastDelta >= 0 ? `+${histogram.contrastDelta}` : histogram.contrastDelta}
                </span>
              </>
            ) : (
              'Real-time tonal comparison between target & swapped face'
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowRawCurve((prev) => !prev)}
          disabled={!isReady}
          aria-pressed={showRawCurve}
          className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            showRawCurve
              ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-800 dark:border-slate-200'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
          }`}
          title="Overlay original unadjusted source face curve"
        >
          {showRawCurve ? 'Hide Raw' : 'Compare Raw'}
        </button>
      </div>

      {/* Histogram Plot Surface */}
      <div className="relative rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        {isReady ? (
          <>
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              preserveAspectRatio="none"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverBin(null)}
              role="img"
              aria-label="Real-time source and target face luminance histogram"
              className="w-full h-[104px] block cursor-crosshair touch-none"
            >
              <defs>
                <linearGradient id="hist-target-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id="hist-source-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.04" />
                </linearGradient>
              </defs>

              {/* Subtle tonal zone shading: Shadows (0..75), Midtones (75..185), Highlights (185..255) */}
              <rect x="0" y="0" width={CHART_W * (75 / 255)} height={CHART_H} className="fill-slate-900/[0.03] dark:fill-white/[0.025]" />
              <rect x={CHART_W * (185 / 255)} y="0" width={CHART_W * (70 / 255)} height={CHART_H} className="fill-slate-900/[0.02] dark:fill-white/[0.02]" />

              {/* Zone & reference hairlines */}
              <line x1={CHART_W * (75 / 255)} y1="0" x2={CHART_W * (75 / 255)} y2={CHART_H} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
              <line x1={CHART_W * 0.5} y1="0" x2={CHART_W * 0.5} y2={CHART_H} className="stroke-slate-200/70 dark:stroke-slate-800/70" strokeWidth="1" strokeDasharray="2 3" />
              <line x1={CHART_W * (185 / 255)} y1="0" x2={CHART_W * (185 / 255)} y2={CHART_H} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
              <line x1="0" y1={CHART_H * 0.5} x2={CHART_W} y2={CHART_H * 0.5} className="stroke-slate-200/60 dark:stroke-slate-800/60" strokeWidth="1" strokeDasharray="2 3" />

              {/* Target Face distribution (Reference) */}
              <path d={targetFillPath} fill="url(#hist-target-grad)" />
              <path
                d={targetStrokePath}
                fill="none"
                stroke="#0ea5e9"
                strokeWidth="1.6"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* Optional Unadjusted Source Raw Curve */}
              {sourceRawPath && (
                <path
                  d={sourceRawPath}
                  fill="none"
                  className="stroke-slate-400 dark:stroke-slate-500"
                  strokeWidth="1.25"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* Source Face (Live Adjusted) distribution */}
              <path d={sourceFillPath} fill="url(#hist-source-grad)" />
              <path
                d={sourceStrokePath}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.75"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* Mean Luminance Markers */}
              <line
                x1={targetMeanX}
                y1={PAD_TOP}
                x2={targetMeanX}
                y2={CHART_H - PAD_BOTTOM}
                stroke="#0ea5e9"
                strokeOpacity="0.65"
                strokeWidth="1"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={sourceMeanX}
                y1={PAD_TOP}
                x2={sourceMeanX}
                y2={CHART_H - PAD_BOTTOM}
                stroke="#f59e0b"
                strokeOpacity="0.8"
                strokeWidth="1"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />

              {/* Hover Inspection Crosshair */}
              {hoverBin !== null && (
                <>
                  <line
                    x1={(hoverBin / (histogram.binCount - 1)) * CHART_W}
                    y1="0"
                    x2={(hoverBin / (histogram.binCount - 1)) * CHART_W}
                    y2={CHART_H}
                    className="stroke-slate-500 dark:stroke-slate-300"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={(hoverBin / (histogram.binCount - 1)) * CHART_W}
                    cy={PAD_TOP + PLOT_H * (1 - histogram.target.bins[hoverBin])}
                    r="2.8"
                    fill="#0ea5e9"
                  />
                  <circle
                    cx={(hoverBin / (histogram.binCount - 1)) * CHART_W}
                    cy={PAD_TOP + PLOT_H * (1 - histogram.sourceAdjusted.bins[hoverBin])}
                    r="2.8"
                    fill="#f59e0b"
                  />
                </>
              )}
            </svg>

            {/* Axis / Hover Readout Strip */}
            <div className="px-2 py-1 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
              {hoverBin !== null ? (
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                  Luma {hoverLuma} · Target {hoverTargetPct}% · Source {hoverSourcePct}%
                </span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 bg-sky-500 inline-block" />
                    <span>Target ({histogram.target.meanLum})</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 bg-amber-500 inline-block" />
                    <span>Source ({histogram.sourceAdjusted.meanLum})</span>
                  </span>
                </div>
              )}

              <span className="font-mono tabular-nums text-[9px] text-slate-400 dark:text-slate-500 shrink-0">
                0–255 Y
              </span>
            </div>
          </>
        ) : (
          <div className="h-[112px] px-4 flex flex-col items-center justify-center text-center gap-1">
            <BarChart3 className="w-4 h-4 text-slate-400 dark:text-slate-600" />
            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              No active face pair to plot
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 max-w-[240px]">
              Load a target photo and select a source face profile to inspect live lighting overlap.
            </p>
          </div>
        )}
      </div>

      {/* Tonal Zone Summary Grid (Shadows · Midtones · Highlights) */}
      {isReady && (
        <div className="grid grid-cols-3 divide-x divide-slate-200/80 dark:divide-slate-800/80 pt-0.5 text-[10px]">
          <div className="pr-2">
            <span className="block text-slate-400 dark:text-slate-500">Shadows</span>
            <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
              {histogram.sourceAdjusted.shadowPct}%{' '}
              <span className="text-slate-400 dark:text-slate-500">
                / {histogram.target.shadowPct}%
              </span>
            </span>
          </div>
          <div className="px-2">
            <span className="block text-slate-400 dark:text-slate-500">Midtones</span>
            <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
              {histogram.sourceAdjusted.midtonePct}%{' '}
              <span className="text-slate-400 dark:text-slate-500">
                / {histogram.target.midtonePct}%
              </span>
            </span>
          </div>
          <div className="pl-2">
            <span className="block text-slate-400 dark:text-slate-500">Highlights</span>
            <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
              {histogram.sourceAdjusted.highlightPct}%{' '}
              <span className="text-slate-400 dark:text-slate-500">
                / {histogram.target.highlightPct}%
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
