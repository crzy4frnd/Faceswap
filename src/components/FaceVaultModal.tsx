import React, { useState, useRef } from 'react';
import {
  Users,
  Trash2,
  Check,
  Sparkles,
  Upload,
  Camera,
  Plus,
  AlertTriangle,
  ScanFace,
  X,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { FaceAngleVariant } from '../types/face';
import { analyzeFaceForAngleVariant } from '../utils/faceEngine';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';

export const FaceVaultModal: React.FC = () => {
  const {
    profiles,
    activeProfileId,
    setActiveProfileId,
    createPersonProfile,
    addAngleToProfile,
    removeAngleFromProfile,
    removeFaceProfile,
    assignProfileToAllFaces,
    scanAndMatchFaceAngle,
    selectedFaceId,
    detectedFaces,
    setActiveTab,
  } = useFaceStudio();

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileImageSrc, setNewProfileImageSrc] = useState<string | null>(null);
  const [cutoutPreview, setCutoutPreview] = useState<string | null>(null);
  const [detectedAnglePreview, setDetectedAnglePreview] = useState<FaceAngleVariant | null>(null);
  const [sourceTag, setSourceTag] = useState<'Gallery' | 'Camera'>('Gallery');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraTargetProfileId, setCameraTargetProfileId] = useState<string | null>(null);
  const [uploadTargetProfileId, setUploadTargetProfileId] = useState<string | null>(null);
  const [addingAngleToId, setAddingAngleToId] = useState<string | null>(null);
  const [vaultNotice, setVaultNotice] = useState<{
    type: 'duplicate' | 'success';
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const angleFileInputRef = useRef<HTMLInputElement>(null);

  const processDataUrlCutout = async (
    dataUrl: string,
    tag: 'Gallery' | 'Camera',
    defaultLabel?: string
  ) => {
    setIsAddingNew(true);
    setSourceTag(tag);
    setIsAnalyzing(true);
    setVaultNotice(null);
    setNewProfileImageSrc(dataUrl);
    try {
      const { angle } = await analyzeFaceForAngleVariant(dataUrl, tag);
      setCutoutPreview(angle.avatarUrl);
      setDetectedAnglePreview(angle);
      if (!newProfileName) {
        setNewProfileName(defaultLabel || `Person ${profiles.length + 1}`);
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

  const handleAddAngleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = uploadTargetProfileId;
    if (!file || !targetId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        await processAddAngle(targetId, reader.result, 'Gallery');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const processAddAngle = async (
    profileId: string,
    dataUrl: string,
    tag: 'Gallery' | 'Camera'
  ) => {
    setAddingAngleToId(profileId);
    setVaultNotice(null);
    try {
      const result = await addAngleToProfile(profileId, dataUrl, tag);
      const prof = profiles.find((p) => p.id === profileId);
      if (!result.added) {
        setVaultNotice({
          type: 'duplicate',
          message:
            result.duplicateCheck.reason ||
            `Duplicate angle rejected for ${prof?.name || 'Person'}.`,
        });
      } else if (result.angle) {
        setVaultNotice({
          type: 'success',
          message: `Saved "${result.angle.label}" angle (${result.angle.yaw >= 0 ? `+${result.angle.yaw}` : result.angle.yaw}° yaw) to ${prof?.name || 'Profile'}.`,
        });
      }
    } finally {
      setAddingAngleToId(null);
    }
  };

  const handleSaveNewProfile = async () => {
    if (!newProfileImageSrc) return;
    setIsAnalyzing(true);
    try {
      await createPersonProfile(
        newProfileImageSrc,
        newProfileName.trim() || `Person ${profiles.length + 1}`,
        sourceTag
      );
      setIsAddingNew(false);
      setNewProfileName('');
      setNewProfileImageSrc(null);
      setCutoutPreview(null);
      setDetectedAnglePreview(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyToCurrent = async (profileId: string) => {
    setActiveProfileId(profileId);
    const targetId = selectedFaceId || detectedFaces[0]?.id;
    if (targetId) {
      await scanAndMatchFaceAngle(targetId, profileId);
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
      <input
        ref={angleFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAddAngleUpload}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Multi-Person Face Vault
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Store profiles for different people with unique head-pose angles (duplicate photos &amp; angles blocked)
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setIsAddingNew(true);
              fileInputRef.current?.click();
            }}
            className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4 shrink-0" />
            <span>New Person (Gallery)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCameraTargetProfileId(null);
              setShowCameraModal(true);
            }}
            className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 shadow-sm transition-all whitespace-nowrap shrink-0"
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span>Camera</span>
          </button>
        </div>
      </div>

      {/* Duplicate Rejection / Angle Added Notice */}
      {vaultNotice && (
        <div
          className={`mt-3 p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
            vaultNotice.type === 'duplicate'
              ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-400/70 text-amber-900 dark:text-amber-200'
              : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400/70 text-emerald-900 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {vaultNotice.type === 'duplicate' ? (
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            )}
            <span className="font-medium leading-snug">{vaultNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setVaultNotice(null)}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0"
            aria-label="Dismiss message"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Create New Person Profile Panel */}
      {isAddingNew && (
        <div className="my-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/60 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              Create Person Profile ({sourceTag})
            </span>
            <button
              type="button"
              onClick={() => {
                setIsAddingNew(false);
                setCutoutPreview(null);
                setNewProfileImageSrc(null);
                setDetectedAnglePreview(null);
                setNewProfileName('');
              }}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-center min-h-[140px]">
              {cutoutPreview ? (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={cutoutPreview}
                    alt="Cutout Preview"
                    className="w-20 h-20 rounded-full object-cover border-2 border-indigo-500 shadow-md"
                  />
                  {detectedAnglePreview && (
                    <span className="text-[11px] font-mono tabular-nums text-indigo-600 dark:text-indigo-300">
                      {detectedAnglePreview.label} · Yaw{' '}
                      {detectedAnglePreview.yaw >= 0
                        ? `+${detectedAnglePreview.yaw}`
                        : detectedAnglePreview.yaw}
                      ° · Pitch{' '}
                      {detectedAnglePreview.pitch >= 0
                        ? `+${detectedAnglePreview.pitch}`
                        : detectedAnglePreview.pitch}
                      °
                    </span>
                  )}
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
                      onClick={() => {
                        setCameraTargetProfileId(null);
                        setShowCameraModal(true);
                      }}
                      className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Retake via Camera
                    </button>
                  </div>
                </div>
              ) : isAnalyzing ? (
                <div className="flex flex-col items-center gap-2 text-xs text-slate-500">
                  <Sparkles className="w-6 h-6 text-indigo-500 animate-spin" />
                  <span>Analyzing facial angle &amp; landmarks...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Choose initial face angle for this person
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
                      onClick={() => {
                        setCameraTargetProfileId(null);
                        setShowCameraModal(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold flex items-center gap-1"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Camera</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Person Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alex, Priya, Sam"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-slate-500 mt-2">
                  After creating this person profile, add Front, Left 3/4, Right 3/4, or Profile shots directly on their card so the auto-swapper hits 96–100% pose match.
                </p>
              </div>

              <button
                type="button"
                disabled={!cutoutPreview || isAnalyzing}
                onClick={handleSaveNewProfile}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Save Person Profile</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean Empty State */}
      {profiles.length === 0 && !isAddingNew ? (
        <div className="flex-1 flex items-center justify-center py-12">
          <div className="max-w-sm w-full p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-900 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                No Person Profiles Saved Yet
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create a profile for each person and store their unique head angles for 96–100% auto-matched face swapping.
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
                onClick={() => {
                  setCameraTargetProfileId(null);
                  setShowCameraModal(true);
                }}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Camera</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Person Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 mt-4">
          {profiles.map((profile) => {
            const isActive = activeProfileId === profile.id;
            const angles = profile.angles || [];
            const isAddingHere = addingAngleToId === profile.id;

            return (
              <div
                key={profile.id}
                className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/25 shadow-md'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {/* Top Person Summary */}
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
                        title="Delete person profile"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                      {angles.length} {angles.length === 1 ? 'unique angle' : 'unique angles'} · Added {profile.dateAdded}
                    </div>

                    {/* Add Unique Angle Actions */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <button
                        type="button"
                        disabled={isAddingHere}
                        onClick={() => {
                          setUploadTargetProfileId(profile.id);
                          angleFileInputRef.current?.click();
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-700 dark:text-slate-200 text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                        title="Add a different head angle photo for this person (duplicates rejected)"
                      >
                        <Plus className="w-3 h-3 shrink-0" />
                        <span>{isAddingHere ? 'Scanning...' : 'Add Angle (Gallery)'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isAddingHere}
                        onClick={() => {
                          setCameraTargetProfileId(profile.id);
                          setShowCameraModal(true);
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-700 dark:text-slate-200 text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                        title="Capture a new head angle using camera"
                      >
                        <Camera className="w-3 h-3 shrink-0" />
                        <span>Cam Angle</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Unique Stored Head Angles Strip */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Stored Pose Angles
                  </div>

                  {angles.length === 0 ? (
                    <div className="text-[11px] text-slate-500 py-1">
                      No angle snapshots stored yet.
                    </div>
                  ) : (
                    <div className="flex items-stretch gap-2 overflow-x-auto no-scrollbar pb-1">
                      {angles.map((ang) => (
                        <div
                          key={ang.id}
                          className="relative group shrink-0 w-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-1.5 flex flex-col items-center gap-1"
                        >
                          <button
                            type="button"
                            onClick={() => removeAngleFromProfile(profile.id, ang.id)}
                            aria-label={`Remove ${ang.label} angle`}
                            title="Delete this angle"
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-800 text-slate-200 hover:bg-rose-600 hover:text-white flex items-center justify-center shadow-xs opacity-85 group-hover:opacity-100 transition-colors"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>

                          <img
                            src={ang.avatarUrl}
                            alt={ang.label}
                            className="w-10 h-10 rounded-lg object-cover border border-slate-300/60 dark:border-slate-700"
                          />
                          <span className="text-[10px] font-semibold text-slate-800 dark:text-slate-100 truncate max-w-full">
                            {ang.label}
                          </span>
                          <span className="text-[9px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            Y{ang.yaw >= 0 ? `+${Math.round(ang.yaw)}` : Math.round(ang.yaw)}° · P
                            {ang.pitch >= 0 ? `+${Math.round(ang.pitch)}` : Math.round(ang.pitch)}°
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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
                    <ScanFace className="w-3.5 h-3.5 shrink-0" />
                    <span>Match &amp; Apply</span>
                  </button>

                  {detectedFaces.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        assignProfileToAllFaces(profile.id);
                        setActiveTab('studio');
                      }}
                      className="py-1.5 px-2.5 rounded-xl text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 font-medium transition-colors whitespace-nowrap shrink-0"
                      title="Apply this person profile to all detected faces"
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
        onClose={() => {
          setShowCameraModal(false);
          setCameraTargetProfileId(null);
        }}
        onCapture={(dataUrl) => {
          if (cameraTargetProfileId) {
            void processAddAngle(cameraTargetProfileId, dataUrl, 'Camera');
            setCameraTargetProfileId(null);
          } else {
            void processDataUrlCutout(dataUrl, 'Camera');
          }
        }}
      />
    </div>
  );
};
