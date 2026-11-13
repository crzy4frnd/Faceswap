import React, { useRef } from 'react';
import {
  Layers,
  Play,
  Upload,
  CheckCircle2,
  Clock,
  Download,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { BatchItem } from '../types/face';

export const BatchProcessingModal: React.FC = () => {
  const {
    batchQueue,
    setBatchQueue,
    runBatchProcessing,
    isBatchRunning,
    profiles,
    activeProfileId,
    setActiveProfileId,
    setTargetImageUrl,
    setActiveTab,
  } = useFaceStudio();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle adding user images to batch queue
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
  };

  const handleDownloadSingle = (item: BatchItem) => {
    if (!item.resultUrl) return;
    const a = document.createElement('a');
    a.href = item.resultUrl;
    a.download = `facemorph_batch_${item.name}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadAll = () => {
    batchQueue.forEach((item, idx) => {
      if (item.resultUrl) {
        setTimeout(() => {
          handleDownloadSingle(item);
        }, idx * 250);
      }
    });
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 overflow-y-auto select-none transition-colors">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Batch Face Swap Processor
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Automatically detect and swap faces across multiple target photos simultaneously
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Add Photos</span>
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
            disabled={isBatchRunning || batchQueue.length === 0}
            onClick={() => runBatchProcessing(activeProfileId)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-sm transition-all"
          >
            {isBatchRunning ? (
              <>
                <Sparkles className="w-3.5 h-3.5 animate-spin" />
                <span>Processing Batch...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Process All ({batchQueue.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Target Profile Bar */}
      <div className="my-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">Batch Profile Source:</span>
          {activeProfile && (
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
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveProfileId(p.id)}
              className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors ${
                activeProfileId === p.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {p.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Batch Items List */}
      <div className="space-y-3 mt-1">
        {batchQueue.map((item, index) => {
          return (
            <div
              key={item.id}
              className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-center gap-3 w-full sm:w-auto">
                {/* Original Thumbnail */}
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-800 shrink-0"
                />

                {/* Arrow & Swapped Result Thumbnail if completed */}
                {item.resultUrl && (
                  <>
                    <span className="text-slate-400 font-bold">→</span>
                    <img
                      src={item.resultUrl}
                      alt="Processed result"
                      className="w-16 h-16 rounded-xl object-cover border border-indigo-500/60 shadow-sm shrink-0"
                    />
                  </>
                )}

                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    #{index + 1} {item.name}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    {item.status === 'completed' && (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Completed ({item.facesDetected} faces swapped)</span>
                      </span>
                    )}
                    {item.status === 'processing' && (
                      <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium">
                        <Sparkles className="w-3.5 h-3.5 animate-spin" />
                        <span>Swapping on-device...</span>
                      </span>
                    )}
                    {item.status === 'pending' && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Waiting</span>
                      </span>
                    )}
                    {item.status === 'failed' && (
                      <span className="flex items-center gap-1 text-rose-500">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Failed</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress bar or Download Action */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
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
                      onClick={() => {
                        setTargetImageUrl(item.imageUrl);
                        setActiveTab('studio');
                      }}
                      className="px-2.5 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-lg transition-colors"
                    >
                      Open in Studio
                    </button>
                    <button
                      onClick={() => handleDownloadSingle(item)}
                      className="flex items-center gap-1 px-3 py-1 bg-slate-900 dark:bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bulk Download Footer */}
      {batchQueue.some((b) => b.resultUrl) && (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={handleDownloadAll}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md transition-all"
          >
            <Download className="w-4 h-4" />
            <span>Download All Completed Results</span>
          </button>
        </div>
      )}
    </div>
  );
};
