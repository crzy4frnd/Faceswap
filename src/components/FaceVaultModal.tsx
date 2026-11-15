import React, { useState, useRef } from 'react';
import {
  Users,
  Trash2,
  Check,
  Sparkles,
  Upload,
  Camera,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { FaceProfile } from '../types/face';
import { createFaceCutout, detectFacesOnCanvas, loadImage } from '../utils/faceEngine';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';

export const FaceVaultModal: React.FC = () => {
  const {
    profiles,
    activeProfileId,
    setActiveProfileId,
    addFaceProfile,
    removeFaceProfile,
    assignProfileToFace,
    assignProfileToAllFaces,
    selectedFaceId,
    detectedFaces,
    setActiveTab,
  } = useFaceStudio();

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileImageSrc, setNewProfileImageSrc] = useState<string | null>(null);
  const [cutoutPreview, setCutoutPreview] = useState<string | null>(null);
  const [sourceTag, setSourceTag] = useState<'Gallery' | 'Camera'>('Gallery');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processDataUrlCutout = async (dataUrl: string, tag: 'Gallery' | 'Camera', defaultLabel?: string) => {
    setIsAddingNew(true);
    setSourceTag(tag);
    setIsAnalyzing(true);
    setNewProfileImageSrc(dataUrl);
    try {
      const img = await loadImage(dataUrl);
      const off = document.createElement('canvas');
      off.width = img.naturalWidth || img.width;
      off.height = img.naturalHeight || img.height;
      const ctx = off.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const faces = await detectFacesOnCanvas(off);
        const primaryFace = faces[0] || {
          box: {
            x: Math.round(off.width * 0.2),
            y: Math.round(off.height * 0.15),
            width: Math.round(off.width * 0.6),
            height: Math.round(off.height * 0.65),
          },
        };

        const cutout = await createFaceCutout(img, primaryFace.box, 256);
        setCutoutPreview(cutout);
        if (!newProfileName) {
          setNewProfileName(defaultLabel || `Face ${profiles.length + 1}`);
        }
      }
    } catch (err) {
      console.error('Cutout generation error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 20);
        await processDataUrlCutout(reader.result, 'Gallery', cleanName || undefined);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveNewProfile = () => {
    if (!cutoutPreview || !newProfileImageSrc) return;

    const newProfile: FaceProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim() || `Face ${profiles.length + 1}`,
      avatarUrl: cutoutPreview,
      fullImageUrl: newProfileImageSrc,
      dateAdded: new Date().toISOString().split('T')[0],
      isBuiltIn: false,
      tags: [sourceTag],
    };

    addFaceProfile(newProfile);
    setIsAddingNew(false);
    setNewProfileName('');
    setNewProfileImageSrc(null);
    setCutoutPreview(null);
  };

  const handleApplyToCurrent = (profileId: string) => {
    setActiveProfileId(profileId);
    if (selectedFaceId) {
      assignProfileToFace(selectedFaceId, profileId);
    } else if (detectedFaces.length > 0) {
      assignProfileToFace(detectedFaces[0].id, profileId);
    }
    setActiveTab('studio');
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 overflow-y-auto select-none transition-colors">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Face Vault
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Save your own faces from Gallery or Camera for face swapping and batch processing
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setIsAddingNew(true);
              fileInputRef.current?.click();
            }}
            className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap"
          >
            <Upload className="w-4 h-4 shrink-0" />
            <span>Add from Gallery</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCameraModal(true)}
            className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 shadow-sm transition-all whitespace-nowrap"
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span>Camera</span>
          </button>
        </div>
      </div>

      {/* Add / Extract Face Cutout Panel */}
      {isAddingNew && (
        <div className="my-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/60 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              Save Face Cutout ({sourceTag})
            </span>
            <button
              type="button"
              onClick={() => {
                setIsAddingNew(false);
                setCutoutPreview(null);
                setNewProfileImageSrc(null);
                setNewProfileName('');
              }}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Preview & Re-pick */}
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-center min-h-[140px]">
              {cutoutPreview ? (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={cutoutPreview}
                    alt="Cutout Preview"
                    className="w-20 h-20 rounded-full object-cover border-2 border-indigo-500 shadow-md"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Change via Gallery
                    </button>
                    <span className="text-slate-400">·</span>
                    <button
                      type="button"
                      onClick={() => setShowCameraModal(true)}
                      className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Retake via Camera
                    </button>
                  </div>
                </div>
              ) : isAnalyzing ? (
                <div className="flex flex-col items-center gap-2 text-xs text-slate-500">
                  <Sparkles className="w-6 h-6 text-indigo-500 animate-spin" />
                  <span>Isolating facial features...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Choose source photo for face cutout
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Gallery</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCameraModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold flex items-center gap-1"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Camera</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Form Fields */}
            <div className="flex flex-col justify-between gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Face Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alex, Portrait 1"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="button"
                disabled={!cutoutPreview}
                onClick={handleSaveNewProfile}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Save to Face Vault</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean Empty State when no faces saved */}
      {profiles.length === 0 && !isAddingNew ? (
        <div className="flex-1 flex items-center justify-center py-12">
          <div className="max-w-sm w-full p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-900 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                No Faces Saved Yet
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Upload a headshot from your gallery or snap a face photo using your camera.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setIsAddingNew(true);
                  fileInputRef.current?.click();
                }}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Gallery</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCameraModal(true)}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Camera</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Profile Cards Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-4">
          {profiles.map((profile) => {
            const isActive = activeProfileId === profile.id;

            return (
              <div
                key={profile.id}
                className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 shadow-md'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    className="w-14 h-14 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {profile.name}
                      </h3>
                      <button
                        type="button"
                        onClick={() => removeFaceProfile(profile.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors shrink-0"
                        title="Delete face profile"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                      <span>Added {profile.dateAdded}</span>
                    </div>

                    {profile.tags && profile.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {profile.tags.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleApplyToCurrent(profile.id)}
                    className={`flex-1 py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isActive ? 'Active Face' : 'Select Face'}</span>
                  </button>

                  {detectedFaces.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        assignProfileToAllFaces(profile.id);
                        setActiveTab('studio');
                      }}
                      className="py-1.5 px-2.5 rounded-xl text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 font-medium transition-colors whitespace-nowrap"
                      title="Apply this face to all detected people"
                    >
                      Swap All
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <WebcamCaptureDialog
        isOpen={showCameraModal}
        mode="face"
        onClose={() => setShowCameraModal(false)}
        onCapture={(dataUrl) => processDataUrlCutout(dataUrl, 'Camera')}
      />
    </div>
  );
};
