import React, { useEffect, useRef, useState } from 'react';
import { Grid, Layers, ScanLine } from 'lucide-react';
import {
  CutoutLayerKind,
  DetectedFace,
  SegmentationVisualizationData,
  SegmentedCutoutLayerSummary,
} from '../types/face';

interface SegmentationVisualizerProps {
  visualization: SegmentationVisualizationData | null;
  cutoutLayers: SegmentedCutoutLayerSummary[];
  detectedFaces: DetectedFace[];
  hiddenLayerIds: string[];
  depthMappingEnabled: boolean;
  hasTargetImage: boolean;
  imageWidth?: number;
  imageHeight?: number;
}

type VizMode = 'heatmap' | 'wireframe';

const CATEGORY_LABEL: Record<number, string> = {
  0: 'Background',
  1: 'Forehead',
  2: 'Hair',
  3: 'Hand / Finger',
  4: 'Jewelry / Veil',
  5: 'Foreground Object',
  6: 'Face Plane',
};

function thermalDepthRgb(z: number, cat: number, depthEnabled: boolean): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, z));
  if (!depthEnabled && cat > 0) {
    switch (cat) {
      case 1:
        return [16, 185, 129];
      case 2:
        return [244, 63, 94];
      case 3:
        return [245, 158, 11];
      case 4:
        return [14, 165, 233];
      case 5:
        return [139, 92, 246];
      default:
        return [56, 189, 248];
    }
  }

  // Scientific thermal depth ramp: 0.0 Deep Slate -> 0.42 Cyan Face -> 0.72 Rose -> 0.90 Amber -> 1.0 Hot Gold
  if (clamped < 0.25) {
    const t = clamped / 0.25;
    return [
      Math.round(15 + t * 12),
      Math.round(23 + t * 44),
      Math.round(42 + t * 72),
    ];
  }
  if (clamped < 0.52) {
    const t = (clamped - 0.25) / 0.27;
    return [
      Math.round(27 + t * 29),
      Math.round(67 + t * 122),
      Math.round(114 + t * 126),
    ];
  }
  if (clamped < 0.75) {
    const t = (clamped - 0.52) / 0.23;
    return [
      Math.round(56 + t * 184),
      Math.round(189 - t * 114),
      Math.round(240 - t * 138),
    ];
  }
  if (clamped < 0.9) {
    const t = (clamped - 0.75) / 0.15;
    return [
      Math.round(240 + t * 12),
      Math.round(75 + t * 102),
      Math.round(102 - t * 76),
    ];
  }
  const t = (clamped - 0.9) / 0.1;
  return [
    Math.round(252 + t * 3),
    Math.round(177 + t * 66),
    Math.round(26 + t * 165),
  ];
}

function layerColorHex(kind: CutoutLayerKind): string {
  switch (kind) {
    case 'forehead':
      return '#10b981';
    case 'hair':
      return '#f43f5e';
    case 'hand_finger':
      return '#f59e0b';
    case 'accessory':
      return '#0ea5e9';
    default:
      return '#8b5cf6';
  }
}

export const SegmentationVisualizer: React.FC<SegmentationVisualizerProps> = ({
  visualization,
  cutoutLayers,
  detectedFaces,
  hiddenLayerIds,
  depthMappingEnabled,
  hasTargetImage,
  imageWidth = 1000,
  imageHeight = 1000,
}) => {
  const [vizMode, setVizMode] = useState<VizMode>('heatmap');
  const [hoveredCell, setHoveredCell] = useState<{
    xNorm: number;
    yNorm: number;
    depth: number;
    label: string;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (vizMode !== 'heatmap' || !canvasRef.current || !visualization) return;
    const canvas = canvasRef.current;
    const { gridWidth, gridHeight, depthGrid, categoryGrid } = visualization;
    const scale = 4;
    const cw = gridWidth * scale;
    const ch = gridHeight * scale;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const off = document.createElement('canvas');
    off.width = gridWidth;
    off.height = gridHeight;
    const octx = off.getContext('2d');
    if (!octx) return;

    const img = octx.createImageData(gridWidth, gridHeight);
    for (let i = 0; i < gridWidth * gridHeight; i++) {
      const z = depthGrid[i] ?? 0.08;
      const cat = categoryGrid[i] ?? 0;
      const [r, g, b] = thermalDepthRgb(z, cat, depthMappingEnabled);
      const p = i * 4;
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
      img.data[p + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, cw, ch);

    // Subtle crisp semantic contour lines over the heat map
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const idx = gy * gridWidth + gx;
        const cat = categoryGrid[idx];
        if (cat === 0) continue;
        if (gx < gridWidth - 1 && categoryGrid[idx + 1] !== cat) {
          const xPos = (gx + 1) * scale;
          ctx.moveTo(xPos, gy * scale);
          ctx.lineTo(xPos, (gy + 1) * scale);
        }
        if (gy < gridHeight - 1 && categoryGrid[idx + gridWidth] !== cat) {
          const yPos = (gy + 1) * scale;
          ctx.moveTo(gx * scale, yPos);
          ctx.lineTo((gx + 1) * scale, yPos);
        }
      }
    }
    ctx.stroke();

    // Overlay compact wireframe bounding rects for foreground object cutouts
    const hiddenSet = new Set(hiddenLayerIds);
    for (const layer of cutoutLayers) {
      if (hiddenSet.has(layer.id)) continue;
      const bx = layer.bboxNorm.x * cw;
      const by = layer.bboxNorm.y * ch;
      const bw = layer.bboxNorm.w * cw;
      const bh = layer.bboxNorm.h * ch;
      ctx.strokeStyle = layerColorHex(layer.kind);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }, [vizMode, visualization, cutoutLayers, hiddenLayerIds, depthMappingEnabled]);

  const handleHeatPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!visualization) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const gx = Math.min(
      visualization.gridWidth - 1,
      Math.floor(xNorm * visualization.gridWidth)
    );
    const gy = Math.min(
      visualization.gridHeight - 1,
      Math.floor(yNorm * visualization.gridHeight)
    );
    const idx = gy * visualization.gridWidth + gx;
    const depth = visualization.depthGrid[idx] ?? 0;
    const cat = visualization.categoryGrid[idx] ?? 0;
    setHoveredCell({
      xNorm,
      yNorm,
      depth,
      label: CATEGORY_LABEL[cat] || 'Foreground',
    });
  };

  if (!hasTargetImage || !visualization) {
    return (
      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <ScanLine className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
            <span>Depth Map &amp; Layer Wireframe</span>
          </span>
          <span className="text-[10px] text-slate-500 font-mono">No scan</span>
        </div>
        <p className="text-[10px] text-slate-500">
          Load a target photo to compute foreground depth planes and inspect the wireframe or heat map.
        </p>
      </div>
    );
  }

  const aspectStyle = {
    aspectRatio: `${Math.max(0.55, Math.min(2.2, visualization.aspectRatio))}`,
  };
  const hiddenSet = new Set(hiddenLayerIds);

  return (
    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
      {/* Header & Mode Switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <ScanLine className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
            <span className="truncate">Layer Depth Map &amp; Wireframe</span>
          </span>
        </div>

        <div className="flex items-center gap-0.5 p-0.5 bg-slate-200/80 dark:bg-slate-900 rounded-md shrink-0">
          <button
            type="button"
            onClick={() => setVizMode('heatmap')}
            className={`px-2 py-0.5 text-[10px] font-medium rounded whitespace-nowrap shrink-0 flex items-center gap-1 transition-colors ${
              vizMode === 'heatmap'
                ? 'bg-white dark:bg-slate-800 text-cyan-600 dark:text-cyan-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-3 h-3 shrink-0" />
            <span>Heat Map</span>
          </button>
          <button
            type="button"
            onClick={() => setVizMode('wireframe')}
            className={`px-2 py-0.5 text-[10px] font-medium rounded whitespace-nowrap shrink-0 flex items-center gap-1 transition-colors ${
              vizMode === 'wireframe'
                ? 'bg-white dark:bg-slate-800 text-cyan-600 dark:text-cyan-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Grid className="w-3 h-3 shrink-0" />
            <span>Wireframe</span>
          </button>
        </div>
      </div>

      {/* Visualization Surface */}
      <div
        onPointerMove={handleHeatPointerMove}
        onPointerLeave={() => setHoveredCell(null)}
        className="relative w-full max-h-44 mx-auto rounded-lg overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center"
        style={aspectStyle}
      >
        {vizMode === 'heatmap' ? (
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain block"
          />
        ) : (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="w-full h-full block bg-slate-950"
          >
            {/* Subtle calibration lattice */}
            {[20, 40, 60, 80].map((pos) => (
              <React.Fragment key={pos}>
                <line
                  x1={pos}
                  y1={0}
                  x2={pos}
                  y2={100}
                  stroke="rgba(148, 163, 184, 0.1)"
                  strokeWidth="0.35"
                />
                <line
                  x1={0}
                  y1={pos}
                  x2={100}
                  y2={pos}
                  stroke="rgba(148, 163, 184, 0.1)"
                  strokeWidth="0.35"
                />
              </React.Fragment>
            ))}

            {/* Semantic Region Contour Edges from Scan Grid */}
            {(() => {
              const { gridWidth, gridHeight, categoryGrid } = visualization;
              const cw = 100 / Math.max(1, gridWidth);
              const ch = 100 / Math.max(1, gridHeight);
              const edgeSegments: string[] = [];

              for (let gy = 0; gy < gridHeight; gy++) {
                for (let gx = 0; gx < gridWidth; gx++) {
                  const idx = gy * gridWidth + gx;
                  const cat = categoryGrid[idx];
                  if (cat === 0) continue;
                  const x0 = gx * cw;
                  const y0 = gy * ch;
                  if (gx < gridWidth - 1 && categoryGrid[idx + 1] !== cat) {
                    edgeSegments.push(
                      `M${(x0 + cw).toFixed(2)},${y0.toFixed(2)}V${(y0 + ch).toFixed(2)}`
                    );
                  }
                  if (gy < gridHeight - 1 && categoryGrid[idx + gridWidth] !== cat) {
                    edgeSegments.push(
                      `M${x0.toFixed(2)},${(y0 + ch).toFixed(2)}H${(x0 + cw).toFixed(2)}`
                    );
                  }
                }
              }

              return (
                <path
                  d={edgeSegments.join(' ')}
                  stroke="rgba(56, 189, 248, 0.48)"
                  strokeWidth="0.45"
                  fill="none"
                />
              );
            })()}

            {/* Detected Face Landmark Wireframes */}
            {detectedFaces.map((face, idx) => {
              const bx = (face.box.x / Math.max(1, imageWidth)) * 100;
              const by = (face.box.y / Math.max(1, imageHeight)) * 100;
              const bw = (face.box.width / Math.max(1, imageWidth)) * 100;
              const bh = (face.box.height / Math.max(1, imageHeight)) * 100;
              const lm = face.landmarks;
              const toX = (v: number) => (v / Math.max(1, imageWidth)) * 100;
              const toY = (v: number) => (v / Math.max(1, imageHeight)) * 100;

              return (
                <g key={face.id || idx}>
                  <rect
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    fill="rgba(56, 189, 248, 0.08)"
                    stroke="#38bdf8"
                    strokeWidth="0.7"
                    strokeDasharray="2 1.5"
                  />
                  {lm.contour.length > 2 && (
                    <polygon
                      points={lm.contour.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ')}
                      fill="none"
                      stroke="rgba(56, 189, 248, 0.72)"
                      strokeWidth="0.55"
                    />
                  )}
                  <line
                    x1={toX(lm.leftEye.x)}
                    y1={toY(lm.leftEye.y)}
                    x2={toX(lm.rightEye.x)}
                    y2={toY(lm.rightEye.y)}
                    stroke="#38bdf8"
                    strokeWidth="0.6"
                  />
                  <line
                    x1={toX(lm.forehead.x)}
                    y1={toY(lm.forehead.y)}
                    x2={toX(lm.nose.x)}
                    y2={toY(lm.nose.y)}
                    stroke="#818cf8"
                    strokeWidth="0.5"
                  />
                  <line
                    x1={toX(lm.nose.x)}
                    y1={toY(lm.nose.y)}
                    x2={toX(lm.chin.x)}
                    y2={toY(lm.chin.y)}
                    stroke="#34d399"
                    strokeWidth="0.5"
                  />
                  <line
                    x1={toX(lm.mouthLeft.x)}
                    y1={toY(lm.mouthLeft.y)}
                    x2={toX(lm.mouthRight.x)}
                    y2={toY(lm.mouthRight.y)}
                    stroke="#f43f5e"
                    strokeWidth="0.55"
                  />
                </g>
              );
            })}

            {/* Detected Foreground Cutout Object Wireframe Enclosures */}
            {cutoutLayers.map((layer) => {
              const hidden = hiddenSet.has(layer.id);
              const stroke = layerColorHex(layer.kind);
              const x = layer.bboxNorm.x * 100;
              const y = layer.bboxNorm.y * 100;
              const w = layer.bboxNorm.w * 100;
              const h = layer.bboxNorm.h * 100;
              return (
                <g key={layer.id} opacity={hidden ? 0.35 : 0.95}>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={`${stroke}1A`}
                    stroke={stroke}
                    strokeWidth="0.8"
                    strokeDasharray={hidden ? '1.5 1.5' : undefined}
                  />
                  <text
                    x={Math.min(72, x + 0.8)}
                    y={Math.max(4.5, y + 3.8)}
                    fill={stroke}
                    fontSize="3.4"
                    fontFamily="ui-monospace, monospace"
                    fontWeight="600"
                  >
                    {`z${Math.round(layer.meanDepth * 100)}`}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {/* Interactive Cell Inspection Readout */}
        {hoveredCell && (
          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 rounded bg-slate-950/90 text-[10px] font-mono tabular-nums text-slate-200 pointer-events-none border border-slate-800/80">
            <span className="truncate">{hoveredCell.label}</span>
            <span className="text-cyan-300 shrink-0 ml-2">
              z={hoveredCell.depth.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Depth Ramp Scale & Layer Distribution (Unboxed Tabular Readout) */}
      <div className="space-y-1">
        {vizMode === 'heatmap' && (
          <div className="flex items-center gap-2 text-[9px] font-mono tabular-nums text-slate-500">
            <span className="shrink-0">Far 0.0</span>
            <div
              className="flex-1 h-1.5 rounded-full"
              style={{
                background:
                  'linear-gradient(90deg, #0f172a 0%, #38bdf8 44%, #f43f5e 72%, #f59e0b 88%, #fef08a 100%)',
              }}
            />
            <span className="shrink-0">Near {visualization.peakForegroundDepth.toFixed(2)}</span>
          </div>
        )}

        <div className="flex items-center flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-sky-400 inline-block" />
            Face {visualization.faceCoveragePct}%
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-rose-500 inline-block" />
            Hair {visualization.hairCoveragePct}%
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" />
            Hand {visualization.handCoveragePct}%
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-cyan-500 inline-block" />
            Jewel {visualization.accessoryCoveragePct}%
          </span>
        </div>
      </div>
    </div>
  );
};
