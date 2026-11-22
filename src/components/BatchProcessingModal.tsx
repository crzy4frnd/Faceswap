import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  Play,
  Upload,
  CheckCircle2,
  Clock,
  Download,
  AlertCircle,
  Sparkles,
  Camera,
  ImagePlus,
  FileEdit,
  RotateCcw,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { BatchItem } from '../types/face';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';

const BATCH_RENAME_STORAGE_KEY = 'facemorph_batch_rename_v1';
const DEFAULT_RENAME_PATTERN = '{prefix}_{timestamp}_{index}';

interface BatchRenameConfig {
  pattern: string;
  prefix: string;
  startIndex: number;
  padDigits: 1 | 2 | 3;
}

const DEFAULT_RENAME_CONFIG: BatchRenameConfig = {
  pattern: DEFAULT_RENAME_PATTERN,
  prefix: 'facemorph',
  startIndex: 1,
  padDigits: 2,
};

function sanitizeFilenameSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function formatCompactTimestamp(date: Date): { timestamp: string; dateOnly: string } {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return {
    timestamp: `${yyyy}${mm}${dd}_${hh}${min}${ss}`,
    dateOnly: `${yyyy}${mm}${dd}`,
  };
}

function buildBatchExportFilename(
  item: Pick<BatchItem, 'name'>,
  queueIndex: number,
  renameConfig: BatchRenameConfig,
  profileName: string | undefined,
  exportDate: Date
): string {
  const { timestamp, dateOnly } = formatCompactTimestamp(exportDate);
  const safePrefix = sanitizeFilenameSegment(renameConfig.prefix, 'facemorph');
  const safeName = sanitizeFilenameSegment(item.name, 'image');
  const safeProfile = sanitizeFilenameSegment(
    (profileName || 'face').split(' ')[0] || 'face',
    'face'
  );
  const num = Math.max(0, Math.floor(renameConfig.startIndex) + queueIndex);
  const indexStr = String(num).padStart(renameConfig.padDigits, '0');

  const rawPattern = renameConfig.pattern.trim() || DEFAULT_RENAME_PATTERN;
  const resolved = rawPattern
    .replace(/\{prefix\}/gi, safePrefix)
    .replace(/\{timestamp\}/gi, timestamp)
    .replace(/\{date\}/gi, dateOnly)
    .replace(/\{index\}/gi, indexStr)
    .replace(/\{name\}/gi, safeName)
    .replace(/\{profile\}/gi, safeProfile);

  const safeBase = sanitizeFilenameSegment(resolved, `${safePrefix}_${timestamp}_${indexStr}`);
  return safeBase.toLowerCase().endsWith('.jpg') ? safeBase : `${safeBase}.jpg`;
}

function loadSavedRenameConfig(): BatchRenameConfig {
  try {
    const raw = localStorage.getItem(BATCH_RENAME_STORAGE_KEY);
    if (!raw) return DEFAULT_RENAME_CONFIG;
    const parsed = JSON.parse(raw) as Partial<BatchRenameConfig>;
    return {
      pattern:
        typeof parsed.pattern === 'string' && parsed.pattern.trim()
          ? parsed.pattern
          : DEFAULT_RENAME_PATTERN,
      prefix: typeof parsed.prefix === 'string' ? parsed.prefix : 'facemorph',
      startIndex:
        typeof parsed.startIndex === 'number' && Number.isFinite(parsed.startIndex)
          ? Math.max(0, Math.min(9999, Math.round(parsed.startIndex)))
          : 1,
      padDigits: parsed.padDigits === 1 || parsed.padDigits === 3 ? parsed.padDigits : 2,
    };
  } catch {
    return DEFAULT_RENAME_CONFIG;
  }
}

const RENAME_TOKENS = [
  { token: '{prefix}', label: 'Prefix' },
  { token: '{timestamp}', label: 'Timestamp' },
  { token: '{date}', label: 'Date' },
  { token: '{index}', label: 'Index' },
  { token: '{name}', label: 'Original' },
  { token: '{profile}', label: 'Face' },
] as const;

const RENAME_PRESETS = [
  { label: 'prefix_timestamp_index', pattern: '{prefix}_{timestamp}_{index}' },
  { label: 'prefix_name_index', pattern: '{prefix}_{name}_{index}' },
  { label: 'profile_date_index', pattern: '{profile}_{date}_{index}' },
] as const;

export const BatchProcessingModal: React.FC = () => {
  const {
    batchQueue,
    setBatchQueue,
    runBatchProcessing,
    isBatchRunning,
    profiles,
    activeProfileId,
    setActiveProfileId,
    addFaceFromDataUrl,
    setTargetImageUrl,
    setActiveTab,
  } = useFaceStudio();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const faceGalleryRef = useRef<HTMLInputElement>(null);
  const patternInputRef = useRef<HTMLInputElement>(null);
  const [showFaceCam, setShowFaceCam] = useState(false);
  const [renameConfig, setRenameConfig] = useState<BatchRenameConfig>(() => loadSavedRenameConfig());
  const [isRenameOpen, setIsRenameOpen] = useState(true);
  const [previewClock, setPreviewClock] = useState<Date>(() => new Date());

  useEffect(() => {
    try {
      localStorage.setItem(BATCH_RENAME_STORAGE_KEY, JSON.stringify(renameConfig));
    } catch {
      // ignore storage quota errors
    }
  }, [renameConfig]);

  useEffect(() => {
    const id = window.setInterval(() => setPreviewClock(new Date()), 10000);
    return () => window.clearInterval(id);
  }, []);

  const handleAddPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const newItem: BatchItem = {
            id: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            imageUrl: reader.result,
            name: file.name.replace(/\.[^/.]+$/, ''),
            status: 'pending',
            progress: 0,
          };
          setBatchQueue((prev) => [...prev, newItem]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleFaceFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        await addFaceFromDataUrl(
          reader.result,
          file.name.replace(/\.[^/.]+$/, '').slice(0, 18),
          'Gallery'
        );
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const samplePreviewFilename = useMemo(() => {
    const sampleItem = batchQueue[0] ?? { name: 'portrait' };
    return buildBatchExportFilename(
      sampleItem,
      0,
      renameConfig,
      activeProfile?.name,
      previewClock
    );
  }, [batchQueue, renameConfig, activeProfile?.name, previewClock]);

  const handleInsertToken = (token: string) => {
    setRenameConfig((prev) => {
      const current = prev.pattern;
      const needsSep = current.length > 0 && !/[_\-.]$/.test(current);
      return {
        ...prev,
        pattern: `${current}${needsSep ? '_' : ''}${token}`,
      };
    });
    patternInputRef.current?.focus();
  };

  const handleDownloadSingle = (
    item: BatchItem,
    queueIndex: number,
    sharedExportDate: Date = new Date()
  ) => {
    if (!item.resultUrl) return;
    const filename = buildBatchExportFilename(
      item,
      queueIndex,
      renameConfig,
      activeProfile?.name,
      sharedExportDate
    );
    const a = document.createElement('a');
    a.href = item.resultUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadAll = () => {
    const batchExportDate = new Date();
    let delayStep = 0;
    batchQueue.forEach((item, idx) => {
      if (item.resultUrl) {
        const currentDelay = delayStep * 250;
        delayStep++;
        setTimeout(() => {
          handleDownloadSingle(item, idx, batchExportDate);
        }, currentDelay);
      }
    });
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 overflow-y-auto select-none transition-colors">
      <input
        ref={faceGalleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFaceFileUpload}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Batch Face Swap Processor
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Select target photos from your gallery and swap them using a saved face
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsRenameOpen((prev) => !prev)}
            className={`min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              isRenameOpen
                ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-400/60 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <FileEdit className="w-3.5 h-3.5 shrink-0" />
            <span>Batch Rename</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:border-slate-300 dark:hover:border-slate-600 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>Add Target Photos</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleAddPhotos}
          />

          <button
            type="button"
            disabled={isBatchRunning || batchQueue.length === 0 || !activeProfile}
            onClick={() => activeProfile && runBatchProcessing(activeProfile.id)}
            className="min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap shrink-0"
          >
            {isBatchRunning ? (
              <>
                <Sparkles className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>Processing Batch...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span>Process All ({batchQueue.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Target Profile Bar */}
      <div className="my-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Source Face:</span>
          {activeProfile ? (
            <div className="flex items-center gap-2">
              <img
                src={activeProfile.avatarUrl}
                alt={activeProfile.name}
                className="w-6 h-6 rounded-full object-cover border border-indigo-500"
              />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {activeProfile.name}
              </span>
            </div>
          ) : (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              No face added yet
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveProfileId(p.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                activeProfileId === p.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {p.name.split(' ')[0]}
            </button>
          ))}

          <button
            type="button"
            onClick={() => faceGalleryRef.current?.click()}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 whitespace-nowrap"
          >
            <Upload className="w-3 h-3" />
            <span>Face Gallery</span>
          </button>

          <button
            type="button"
            onClick={() => setShowFaceCam(true)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1 whitespace-nowrap"
          >
            <Camera className="w-3 h-3" />
            <span>Face Camera</span>
          </button>
        </div>
      </div>

      {/* Batch Rename Tool Panel */}
      {isRenameOpen && (
        <div className="mb-3 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <FileEdit className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>Batch Export Rename Pattern</span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Automatically applied to every processed photo downloaded individually or in batch
              </p>
            </div>

            <button
              type="button"
              onClick={() => setRenameConfig(DEFAULT_RENAME_CONFIG)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span>Reset Pattern</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-6 space-y-1">
              <label
                htmlFor="batch-rename-pattern"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
              >
                Naming Pattern
              </label>
              <input
                id="batch-rename-pattern"
                ref={patternInputRef}
                type="text"
                value={renameConfig.pattern}
                onChange={(e) =>
                  setRenameConfig((prev) => ({ ...prev, pattern: e.target.value }))
                }
                placeholder="{prefix}_{timestamp}_{index}"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>

            <div className="sm:col-span-3 space-y-1">
              <label
                htmlFor="batch-rename-prefix"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
              >
                Prefix
              </label>
              <input
                id="batch-rename-prefix"
                type="text"
                value={renameConfig.prefix}
                onChange={(e) =>
                  setRenameConfig((prev) => ({ ...prev, prefix: e.target.value }))
                }
                placeholder="facemorph"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>

            <div className="sm:col-span-3 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label
                  htmlFor="batch-rename-start"
                  className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                >
                  Start #
                </label>
                <input
                  id="batch-rename-start"
                  type="number"
                  min={0}
                  max={9999}
                  value={renameConfig.startIndex}
                  onChange={(e) =>
                    setRenameConfig((prev) => ({
                      ...prev,
                      startIndex: Math.max(0, Math.min(9999, Number(e.target.value) || 0)),
                    }))
                  }
                  className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div className="space-y-1">
                <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Padding
                </span>
                <div className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 h-[34px]">
                  {([1, 2, 3] as const).map((digits) => (
                    <button
                      key={digits}
                      type="button"
                      onClick={() => setRenameConfig((prev) => ({ ...prev, padDigits: digits }))}
                      className={`flex-1 h-full rounded-lg text-[10px] font-mono tabular-nums font-semibold transition-colors ${
                        renameConfig.padDigits === digits
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                      title={`${digits}-digit zero padding`}
                    >
                      {String(1).padStart(digits, '0')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500 font-medium mr-0.5">Insert token:</span>
              {RENAME_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => handleInsertToken(t.token)}
                  className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 border border-slate-200 dark:border-slate-700 text-[11px] font-medium transition-colors whitespace-nowrap"
                >
                  + {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {RENAME_PRESETS.map((preset) => {
                const isSelected = renameConfig.pattern === preset.pattern;
                return (
                  <button
                    key={preset.pattern}
                    type="button"
                    onClick={() =>
                      setRenameConfig((prev) => ({ ...prev, pattern: preset.pattern }))
                    }
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-500 dark:text-slate-400 shrink-0">Live preview:</span>
            <span className="font-mono tabular-nums text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 truncate">
              {samplePreviewFilename}
            </span>
          </div>
        </div>
      )}

      {/* Empty Queue Prompt */}
      {batchQueue.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-10">
          <div className="max-w-sm w-full p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 shadow-sm">
            <ImagePlus className="w-8 h-8 text-indigo-500 mx-auto" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Queue Is Empty
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add one or more photos from your gallery to swap faces in batch.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>Select Photos from Gallery</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 mt-1">
          {batchQueue.map((item, index) => {
            const resolvedOutputName = buildBatchExportFilename(
              item,
              index,
              renameConfig,
              activeProfile?.name,
              previewClock
            );
            return (
              <div
                key={item.id}
                className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-800 shrink-0"
                  />

                  {item.resultUrl && (
                    <>
                      <span className="text-slate-400 font-bold shrink-0">→</span>
                      <img
                        src={item.resultUrl}
                        alt="Processed result"
                        className="w-16 h-16 rounded-xl object-cover border border-indigo-500/60 shadow-sm shrink-0"
                      />
                    </>
                  )}

                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate tabular-nums">
                      #{index + 1} {item.name}
                    </h4>
                    <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                      Export: {resolvedOutputName}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      {item.status === 'completed' && (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Completed ({item.facesDetected} faces swapped)</span>
                        </span>
                      )}
                      {item.status === 'processing' && (
                        <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium">
                          <Sparkles className="w-3.5 h-3.5 animate-spin shrink-0" />
                          <span>Swapping on-device...</span>
                        </span>
                      )}
                      {item.status === 'pending' && (
                        <span className="flex items-center gap-1 text-slate-400">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>Waiting</span>
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span className="flex items-center gap-1 text-rose-500">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Failed</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                  {item.status === 'processing' && (
                    <div className="w-32 bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}

                  {item.resultUrl && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setTargetImageUrl(item.imageUrl);
                          setActiveTab('studio');
                        }}
                        className="px-2.5 py-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Open in Studio
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadSingle(item, index)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 dark:bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Download className="w-3 h-3 shrink-0" />
                        <span>Download</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {batchQueue.some((b) => b.resultUrl) && (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
            Pattern: {renameConfig.pattern || DEFAULT_RENAME_PATTERN}
          </span>
          <button
            type="button"
            onClick={handleDownloadAll}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md transition-all whitespace-nowrap"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Download All Completed Results</span>
          </button>
        </div>
      )}

      <WebcamCaptureDialog
        isOpen={showFaceCam}
        mode="face"
        onClose={() => setShowFaceCam(false)}
        onCapture={(dataUrl) =>
          addFaceFromDataUrl(dataUrl, `Camera Face ${profiles.length + 1}`, 'Camera')
        }
      />
    </div>
  );
};
