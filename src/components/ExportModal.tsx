import React, { useState } from 'react';
import {
  X,
  Download,
  Sparkles,
  Check,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { downloadCanvasImage } from '../utils/tiffExporter';
import { ExportFormat, ExportResolution } from '../types/face';

export const ExportModal: React.FC = () => {
  const {
    showExportModal,
    setShowExportModal,
    outputCanvasRef,
    adjustments,
    updateAdjustments,
    detectedCutoutLayers,
    exportBatchMasksAndResult,
    isBatchExportingMasks,
    isExportingPsd,
    exportLayerCompositionPsd,
  } = useFaceStudio();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [resolution, setResolution] = useState<ExportResolution>('1x');
  const [filename, setFilename] = useState('facemorph_portrait');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportedBatchCount, setExportedBatchCount] = useState<number>(0);

  if (!showExportModal) return null;

  const canvas = outputCanvasRef.current;
  const baseW = canvas?.width || 1200;
  const baseH = canvas?.height || 1600;

  const scaleMultiplier = resolution === '4x' ? 4 : resolution === '2x' ? 2 : 1;
  const targetW = baseW * scaleMultiplier;
  const targetH = baseH * scaleMultiplier;

  const visibleSegmentCount = detectedCutoutLayers.filter(
    (l) => !(adjustments.hiddenCutoutLayerIds || []).includes(l.id)
  ).length;
  // Face layer + detected object segment layers (+ final morphed image)
  const batchPngCount = 2 + visibleSegmentCount;
  // Total non-destructive PSD layers (Background + Face + all detected segments)
  const psdLayerCount = 2 + detectedCutoutLayers.length;

  // Approximate file size calculation
  let estSizeMb = (targetW * targetH * 4) / (1024 * 1024);
  if (format === 'jpeg') estSizeMb *= 0.12;
  else if (format === 'png') estSizeMb *= 0.45;
  else if (format === 'psd') estSizeMb *= Math.max(0.65, 0.38 * (1 + detectedCutoutLayers.length * 0.35));
  else if (format === 'tiff') estSizeMb *= 0.75; // raw RGB

  const handleExport = async () => {
    if (!canvas) return;
    setIsExporting(true);
    setExportSuccess(false);
    setExportedBatchCount(0);

    const safeBase = filename.trim() || 'facemorph_export';

    try {
      if (format === 'psd') {
        const psdResult = await exportLayerCompositionPsd(safeBase, scaleMultiplier);
        if (psdResult) {
          setExportedBatchCount(psdResult.layerCount);
        }
      } else {
        await downloadCanvasImage(canvas, format, scaleMultiplier, safeBase);

        if (adjustments.batchExportMasks) {
          // Primary download already saved the final composite if format === 'png',
          // otherwise include the lossless final PNG alongside the segment masks.
          const savedSegments = await exportBatchMasksAndResult(
            safeBase,
            scaleMultiplier,
            format !== 'png'
          );
          setExportedBatchCount(savedSegments + (format === 'png' ? 1 : 0));
        }
      }

      setExportSuccess(true);
      setTimeout(() => {
        setShowExportModal(false);
        setExportSuccess(false);
        setExportedBatchCount(0);
      }, 1500);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                High-Resolution Export
              </h3>
              <span className="text-[11px] text-slate-500">
                100% On-Device · No Watermarks
              </span>
            </div>
          </div>

          <button
            onClick={() => setShowExportModal(false)}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label="Close Export Modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Output File Format
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { id: 'png' as const, label: 'PNG', desc: 'Lossless Clarity' },
              { id: 'psd' as const, label: 'PSD', desc: 'Multi-Layer Pro' },
              { id: 'tiff' as const, label: 'TIFF', desc: 'Pro Studio 6.0' },
              { id: 'jpeg' as const, label: 'JPEG', desc: 'Compact Web' },
            ].map((f) => {
              const isSelected = format === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`p-2.5 rounded-2xl border text-left transition-all ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold shadow-xs ring-1 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <span className="block text-xs font-bold">{f.label}</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">{f.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Resolution Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Resolution Scaling
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: '1x' as const, label: '1x Standard', spec: `${baseW} × ${baseH}` },
              { id: '2x' as const, label: '2x High-Res', spec: `${baseW * 2} × ${baseH * 2}` },
              { id: '4x' as const, label: '4x Ultra-HD', spec: `${baseW * 4} × ${baseH * 4}` },
            ].map((r) => {
              const isSelected = resolution === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setResolution(r.id)}
                  className={`p-2.5 rounded-2xl border text-left transition-all ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold shadow-xs ring-1 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <span className="block text-xs font-bold">{r.label}</span>
                  <span className="block text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
                    {r.spec}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filename Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Filename
          </label>
          <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs">
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none"
              placeholder="facemorph_export"
            />
            <span className="text-slate-400 font-mono text-[11px]">.{format}</span>
          </div>
        </div>

        {/* Automated PSD Layer Composition Summary OR Batch Export Masks Synced Toggle */}
        {format === 'psd' ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-violet-500/35 bg-violet-50/60 dark:bg-violet-950/25">
            <Layers className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                Automated Layer Composition ({psdLayerCount} Layers)
              </span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5 tabular-nums">
                Packages Background, Swapped Face Layer, and {detectedCutoutLayers.length} cutout segments (hand, hair, accessories) with blend modes &amp; RLE compression.
              </span>
            </div>
          </div>
        ) : (
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer">
            <div className="flex items-start gap-2 min-w-0">
              <Layers className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Batch Export Masks
                </span>
                <span className="block text-[10px] text-slate-500 tabular-nums">
                  Also save {batchPngCount - 1} separate transparent segment PNGs (Face{visibleSegmentCount > 0 ? ` + ${visibleSegmentCount} cutouts` : ''})
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={adjustments.batchExportMasks}
              onChange={(e) =>
                updateAdjustments(
                  { batchExportMasks: e.target.checked },
                  e.target.checked ? 'Batch Export Masks Enabled' : 'Batch Export Masks Disabled'
                )
              }
              aria-label="Include Batch Export Masks PNG files"
              className="w-4 h-4 accent-indigo-600 rounded shrink-0"
            />
          </label>
        )}

        {/* Metadata summary */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-950 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>On-device rendering</span>
          </div>
          <span className="font-mono tabular-nums">
            {format === 'psd'
              ? `${psdLayerCount} PSD Layers · ~${estSizeMb.toFixed(1)} MB`
              : adjustments.batchExportMasks
              ? `${batchPngCount} PNGs · ~${estSizeMb.toFixed(1)} MB base`
              : `Est. ~${estSizeMb.toFixed(1)} MB`}
          </span>
        </div>

        {/* Action Button */}
        <button
          disabled={isExporting || isBatchExportingMasks || isExportingPsd}
          onClick={handleExport}
          className={`w-full py-3 rounded-2xl text-white text-xs font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
            exportSuccess
              ? 'bg-emerald-600'
              : format === 'psd'
              ? 'bg-violet-600 hover:bg-violet-500 active:scale-[0.98]'
              : 'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]'
          }`}
        >
          {exportSuccess ? (
            <>
              <Check className="w-4 h-4" />
              <span>
                {format === 'psd'
                  ? `Exported ${exportedBatchCount || psdLayerCount}-Layer .PSD!`
                  : exportedBatchCount > 1
                  ? `Exported ${exportedBatchCount} Files!`
                  : 'Export Downloaded!'}
              </span>
            </>
          ) : isExporting || isBatchExportingMasks || isExportingPsd ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" />
              <span>
                {format === 'psd'
                  ? `Packaging ${psdLayerCount}-Layer .PSD...`
                  : adjustments.batchExportMasks
                  ? `Exporting ${batchPngCount} PNG Layers...`
                  : `Rendering ${resolution} ${format.toUpperCase()}...`}
              </span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>
                {format === 'psd'
                  ? `Download ${resolution} .PSD (${psdLayerCount} Layers)`
                  : adjustments.batchExportMasks
                  ? `Download ${resolution} ${format.toUpperCase()} + ${batchPngCount - 1} Mask PNGs`
                  : `Download ${resolution} ${format.toUpperCase()}`}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
