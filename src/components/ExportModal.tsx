import React, { useState } from 'react';
import {
  X,
  Download,
  FileImage,
  Sparkles,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { downloadCanvasImage } from '../utils/tiffExporter';
import { ExportFormat, ExportResolution } from '../types/face';

export const ExportModal: React.FC = () => {
  const { showExportModal, setShowExportModal, outputCanvasRef } = useFaceStudio();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [resolution, setResolution] = useState<ExportResolution>('1x');
  const [filename, setFilename] = useState('facemorph_portrait');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  if (!showExportModal) return null;

  const canvas = outputCanvasRef.current;
  const baseW = canvas?.width || 1200;
  const baseH = canvas?.height || 1600;

  const scaleMultiplier = resolution === '4x' ? 4 : resolution === '2x' ? 2 : 1;
  const targetW = baseW * scaleMultiplier;
  const targetH = baseH * scaleMultiplier;

  // Approximate file size calculation
  let estSizeMb = (targetW * targetH * 4) / (1024 * 1024);
  if (format === 'jpeg') estSizeMb *= 0.12;
  else if (format === 'png') estSizeMb *= 0.45;
  else if (format === 'tiff') estSizeMb *= 0.75; // raw RGB

  const handleExport = async () => {
    if (!canvas) return;
    setIsExporting(true);
    setExportSuccess(false);

    try {
      await downloadCanvasImage(
        canvas,
        format,
        scaleMultiplier,
        filename.trim() || 'facemorph_export'
      );
      setExportSuccess(true);
      setTimeout(() => {
        setShowExportModal(false);
        setExportSuccess(false);
      }, 1400);
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
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Output File Format
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'png' as const, label: 'PNG', desc: 'Lossless Clarity' },
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
                  <span className="block text-[10px] font-mono text-slate-500 mt-0.5">
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

        {/* Metadata summary */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-950 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>On-device rendering</span>
          </div>
          <span className="font-mono">Est. ~{estSizeMb.toFixed(1)} MB</span>
        </div>

        {/* Action Button */}
        <button
          disabled={isExporting}
          onClick={handleExport}
          className={`w-full py-3 rounded-2xl text-white text-xs font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
            exportSuccess
              ? 'bg-emerald-600'
              : 'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]'
          }`}
        >
          {exportSuccess ? (
            <>
              <Check className="w-4 h-4" />
              <span>Export Downloaded!</span>
            </>
          ) : isExporting ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" />
              <span>Rendering {resolution} {format.toUpperCase()}...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Download {resolution} {format.toUpperCase()}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
