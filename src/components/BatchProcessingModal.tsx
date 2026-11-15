import React, { useRef, useState } from 'react';
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
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { BatchItem } from '../types/face';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';

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
  const [showFaceCam, setShowFaceCam] = useState(false);

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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:border-slate-300 dark:hover:border-slate-600 transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap"
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
          {batchQueue.map((item, index) => (
            <div
              key={item.id}
              className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-800 shrink-0"
                />

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
                      type="button"
                      onClick={() => {
                        setTargetImageUrl(item.imageUrl);
                        setActiveTab('studio');
                      }}
                      className="px-2.5 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-lg transition-colors"
                    >
                      Open in Studio
                    </button>
                    <button
                      type="button"
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
          ))}
        </div>
      )}

      {batchQueue.some((b) => b.resultUrl) && (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={handleDownloadAll}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md transition-all"
          >
            <Download className="w-4 h-4" />
            <span>Download All Completed Results</span>
          </button>
        </div>
      )}

      <WebcamCaptureDialog
        isOpen={showFaceCam}
        mode="face"
        onClose={() => setShowFaceCam(false)}
        onCapture={(dataUrl) => addFaceFromDataUrl(dataUrl, `Camera Face ${profiles.length + 1}`, 'Camera')}
      />
    </div>
  );
};
