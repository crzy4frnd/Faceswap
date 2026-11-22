import React, { useRef, useState } from 'react';
import {
  Users,
  Check,
  X,
  Sparkles,
  RefreshCw,
  Crosshair,
  Smile,
  Laugh,
  Meh,
  Eye,
  Radio,
  Video,
  Upload,
  Camera,
  Trash2,
  FlipHorizontal2,
  ScanFace,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import { classifyFaceAngle } from '../utils/faceEngine';
import { WebcamCaptureDialog } from './WebcamCaptureDialog';

export const MultiFaceSelector: React.FC = () => {
  const {
    targetImageUrl,
    detectedFaces,
    selectedFaceId,
    setSelectedFaceId,
    profiles,
    activeProfileId,
    setActiveProfileId,
    assignProfileToFace,
    assignProfileToAllFaces,
    createPersonProfile,
    addAngleToProfile,
    removeFaceProfile,
    toggleFaceEnabled,
    rescanFaces,
    setActiveTab,
    autoAlignFace,
    liveSyncedFaceId,
    syncFaceToLive,
    adjustments,
    angleScanResults,
    scanAndMatchFaceAngle,
    overrideClosestAngleMatch,
    flipFaceAndAdjust,
  } = useFaceStudio();

  const [aligningFaceId, setAligningFaceId] = useState<string | null>(null);
  const [scanningFaceId, setScanningFaceId] = useState<string | null>(null);
  const [justSyncedFaceId, setJustSyncedFaceId] = useState<string | null>(null);
  const [alignedInfo, setAlignedInfo] = useState<{
    faceId: string;
    rotation: number;
    scale: number;
  } | null>(null);
  const [showFaceCamera, setShowFaceCamera] = useState(false);
  const [cameraModeTarget, setCameraModeTarget] = useState<'new-person' | 'add-angle'>('new-person');
  const [cameraAngleProfileId, setCameraAngleProfileId] = useState<string | null>(null);
  const [isAddingFace, setIsAddingFace] = useState(false);
  const [angleNotice, setAngleNotice] = useState<{
    type: 'duplicate' | 'success';
    message: string;
  } | null>(null);

  const faceFileInputRef = useRef<HTMLInputElement>(null);
  const addAngleFileInputRef = useRef<HTMLInputElement>(null);
  const uploadAngleProfileIdRef = useRef<string | null>(null);

  const handleUploadFaceGallery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAddingFace(true);
    setAngleNotice(null);
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 18);
        await createPersonProfile(
          reader.result,
          cleanName || `Person ${profiles.length + 1}`,
          'Gallery'
        );
      }
      setIsAddingFace(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUploadAngleForProfile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetProfId = uploadAngleProfileIdRef.current || activeProfileId;
    if (!file || !targetProfId) return;
    setIsAddingFace(true);
    setAngleNotice(null);
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const res = await addAngleToProfile(targetProfId, reader.result, 'Gallery');
        if (!res.added) {
          setAngleNotice({
            type: 'duplicate',
            message: res.duplicateCheck.reason || 'Duplicate angle photo blocked.',
          });
        } else if (res.angle) {
          setAngleNotice({
            type: 'success',
            message: `Added unique "${res.angle.label}" angle to profile.`,
          });
        }
      }
      setIsAddingFace(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCaptureFaceCamera = async (dataUrl: string) => {
    setIsAddingFace(true);
    setAngleNotice(null);
    try {
      if (cameraModeTarget === 'add-angle' && (cameraAngleProfileId || activeProfileId)) {
        const targetProfId = cameraAngleProfileId || activeProfileId;
        const res = await addAngleToProfile(targetProfId, dataUrl, 'Camera');
        if (!res.added) {
          setAngleNotice({
            type: 'duplicate',
            message: res.duplicateCheck.reason || 'Duplicate angle photo blocked.',
          });
        } else if (res.angle) {
          setAngleNotice({
            type: 'success',
            message: `Captured unique "${res.angle.label}" angle.`,
          });
        }
      } else {
        await createPersonProfile(dataUrl, `Person ${profiles.length + 1}`, 'Camera');
      }
    } finally {
      setIsAddingFace(false);
      setCameraAngleProfileId(null);
    }
  };

  const handleAutoAlign = async (faceId?: string) => {
    const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
    if (!targetId) return;
    setAligningFaceId(targetId);
    try {
      const result = await autoAlignFace(targetId);
      if (result) {
        setAlignedInfo({
          faceId: targetId,
          rotation: result.rotation,
          scale: result.scale,
        });
        window.setTimeout(() => {
          setAlignedInfo((prev) => (prev?.faceId === targetId ? null : prev));
        }, 2200);
      }
    } finally {
      setAligningFaceId(null);
    }
  };

  const handleScanAngleMatch = async (faceId?: string, scope: 'current' | 'all' = 'current') => {
    const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
    if (!targetId) return;
    setScanningFaceId(targetId);
    try {
      await scanAndMatchFaceAngle(targetId, scope === 'all' ? '__all__' : undefined);
    } finally {
      setScanningFaceId(null);
    }
  };

  const handleSyncToLive = (faceId?: string) => {
    const targetId = faceId || selectedFaceId || detectedFaces[0]?.id;
    if (!targetId) return;
    setSelectedFaceId(targetId);
    syncFaceToLive(targetId);
    setJustSyncedFaceId(targetId);
    window.setTimeout(() => {
      setJustSyncedFaceId((prev) => (prev === targetId ? null : prev));
    }, 2000);
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const activeTargetId = selectedFaceId || detectedFaces[0]?.id;
  const activeTargetFace = detectedFaces.find((f) => f.id === activeTargetId) || null;
  const activeScan = activeTargetFace ? angleScanResults[activeTargetFace.id] : undefined;
  const activeAssignedProfile =
    profiles.find((p) => p.id === (activeTargetFace?.assignedProfileId || activeProfileId)) ||
    activeProfile;

  const isHeaderAligning = Boolean(aligningFaceId && aligningFaceId === activeTargetId);
  const isHeaderScanning = Boolean(scanningFaceId && scanningFaceId === activeTargetId);
  const isHeaderAligned = Boolean(alignedInfo && alignedInfo.faceId === activeTargetId);
  const isHeaderLiveSynced = Boolean(liveSyncedFaceId && liveSyncedFaceId === activeTargetId);
  const isHeaderJustSynced = Boolean(justSyncedFaceId && justSyncedFaceId === activeTargetId);

  const isActiveUnmatched =
    Boolean(adjustments.autoMatchAngle) &&
    Boolean(activeTargetFace) &&
    activeTargetFace?.angleMatchStatus === 'unmatched';

  const requiredPose = activeTargetFace
    ? classifyFaceAngle(activeTargetFace.yaw ?? 0, activeTargetFace.pitch ?? 0)
    : null;

  return (
    <div className="p-3 bg-transparent transition-colors space-y-3">
      {/* Hidden Gallery Inputs */}
      <input
        ref={faceFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUploadFaceGallery}
      />
      <input
        ref={addAngleFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUploadAngleForProfile}
      />

      {/* Duplicate / Success Angle Notice */}
      {angleNotice && (
        <div
          className={`px-2.5 py-2 rounded-xl border flex items-center justify-between gap-2 text-[11px] ${
            angleNotice.type === 'duplicate'
              ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-400/70 text-amber-900 dark:text-amber-200'
              : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400/70 text-emerald-900 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {angleNotice.type === 'duplicate' ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            ) : (
              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            )}
            <span className="font-medium truncate">{angleNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setAngleNotice(null)}
            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 1. Person Profiles Library with Multi-Angle Counts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
            Person Profiles ({profiles.length})
          </span>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {activeProfile && (
              <button
                type="button"
                disabled={isAddingFace}
                onClick={() => {
                  uploadAngleProfileIdRef.current = activeProfile.id;
                  addAngleFileInputRef.current?.click();
                }}
                className="min-h-[30px] px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                title={`Add another head angle photo for ${activeProfile.name} (duplicates blocked)`}
              >
                <Plus className="w-3 h-3 shrink-0" />
                <span>+ Angle ({activeProfile.name.split(' ')[0]})</span>
              </button>
            )}

            <button
              type="button"
              disabled={isAddingFace}
              onClick={() => faceFileInputRef.current?.click()}
              className="min-h-[30px] px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
              title="Create a new person profile from gallery"
            >
              <Upload className="w-3 h-3 shrink-0" />
              <span>New Person</span>
            </button>

            <button
              type="button"
              disabled={isAddingFace}
              onClick={() => {
                setCameraModeTarget('new-person');
                setCameraAngleProfileId(null);
                setShowFaceCamera(true);
              }}
              className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
              title="Capture a new person face with camera"
            >
              <Camera className="w-3 h-3 shrink-0" />
              <span>Camera</span>
            </button>
          </div>
        </div>

        {profiles.length === 0 ? (
          <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-dashed border-slate-300 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
            Create a person profile via <span className="font-semibold text-indigo-600 dark:text-indigo-400">New Person</span> or <span className="font-semibold text-indigo-600 dark:text-indigo-400">Camera</span>, then add multiple unique head angles.
          </div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {profiles.map((p) => {
              const isSelected = activeProfileId === p.id;
              const angleCount = p.angles?.length || 1;
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setActiveProfileId(p.id);
                    if (activeTargetId) {
                      assignProfileToFace(activeTargetId, p.id);
                    }
                  }}
                  className={`flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-xl border cursor-pointer shrink-0 transition-all ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-100 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <img
                    src={p.avatarUrl}
                    alt={p.name}
                    className="w-7 h-7 rounded-full object-cover border border-indigo-400/50 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="block text-[11px] font-semibold max-w-[92px] truncate whitespace-nowrap leading-tight">
                      {p.name}
                    </span>
                    <span className="block text-[9px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap leading-tight">
                      {angleCount} {angleCount === 1 ? 'angle' : 'angles'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFaceProfile(p.id);
                    }}
                    aria-label={`Remove ${p.name}`}
                    title="Delete person profile"
                    className="p-0.5 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Missing 96-100% Angle Prompt Banner (Instructs User to Create Matching Face Angle) */}
      {isActiveUnmatched && activeTargetFace && (
        <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-400/70 dark:border-amber-700/70 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0 text-[11px]">
                <p className="font-semibold text-amber-950 dark:text-amber-100 leading-snug">
                  No {adjustments.minAngleMatchScore}–100% matching angle in{' '}
                  {activeAssignedProfile?.name || 'profile'} (Closest:{' '}
                  <span className="font-mono tabular-nums">
                    {activeScan?.matchScore ?? activeTargetFace.angleMatchScore ?? 0}%
                  </span>
                  )
                </p>
                <p className="text-amber-800 dark:text-amber-300 mt-0.5 leading-snug">
                  Create or upload a{' '}
                  <span className="font-semibold">
                    {activeScan?.requiredAngleLabel || requiredPose?.label || 'matching'}
                  </span>{' '}
                  angle face (Target Yaw{' '}
                  <span className="font-mono tabular-nums">
                    {(activeTargetFace.yaw ?? 0) >= 0
                      ? `+${Math.round(activeTargetFace.yaw ?? 0)}`
                      : Math.round(activeTargetFace.yaw ?? 0)}
                    °
                  </span>
                  , Pitch{' '}
                  <span className="font-mono tabular-nums">
                    {(activeTargetFace.pitch ?? 0) >= 0
                      ? `+${Math.round(activeTargetFace.pitch ?? 0)}`
                      : Math.round(activeTargetFace.pitch ?? 0)}
                    °
                  </span>
                  ).
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {activeAssignedProfile && (
              <>
                <button
                  type="button"
                  disabled={isAddingFace}
                  onClick={() => {
                    uploadAngleProfileIdRef.current = activeAssignedProfile.id;
                    addAngleFileInputRef.current?.click();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Upload className="w-3 h-3 shrink-0" />
                  <span>Add Matching Angle (Gallery)</span>
                </button>
                <button
                  type="button"
                  disabled={isAddingFace}
                  onClick={() => {
                    setCameraModeTarget('add-angle');
                    setCameraAngleProfileId(activeAssignedProfile.id);
                    setShowFaceCamera(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Camera className="w-3 h-3 shrink-0" />
                  <span>Capture Angle</span>
                </button>
              </>
            )}

            {profiles.length > 1 && (
              <button
                type="button"
                onClick={() => handleScanAngleMatch(activeTargetFace.id, 'all')}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
              >
                <ScanFace className="w-3 h-3 shrink-0" />
                <span>Scan All People</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => flipFaceAndAdjust(activeTargetFace.id)}
              className="px-2 py-1 rounded-lg border border-amber-500/60 text-amber-900 dark:text-amber-200 hover:bg-amber-500/15 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
            >
              <FlipHorizontal2 className="w-3 h-3 shrink-0" />
              <span>Flip &amp; Adjust</span>
            </button>

            <button
              type="button"
              onClick={() => overrideClosestAngleMatch(activeTargetFace.id)}
              className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              Use Closest ({activeTargetFace.angleMatchScore ?? '--'}%)
            </button>
          </div>
        </div>
      )}

      {/* 3. Detected Faces Section */}
      {detectedFaces.length === 0 ? (
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {targetImageUrl ? 'No faces detected in photo' : 'Load a target photo above to detect faces'}
          </span>
          {targetImageUrl && (
            <button
              type="button"
              onClick={rescanFaces}
              className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 font-semibold whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Rescan</span>
            </button>
          )}
        </div>
      ) : (
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-2.5">
          {/* Header & Global Face Actions */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                Target Faces ({detectedFaces.length})
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => handleScanAngleMatch(activeTargetId, 'all')}
                disabled={isHeaderScanning || profiles.length === 0}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-indigo-500/50 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-all flex items-center gap-1 whitespace-nowrap disabled:opacity-40"
                title="Scan all saved person angles to find a 96-100% pose match with the target face"
              >
                <ScanFace className={`w-3 h-3 ${isHeaderScanning ? 'animate-spin' : ''}`} />
                <span>{isHeaderScanning ? 'Scanning...' : `Scan ${adjustments.minAngleMatchScore}–100%`}</span>
              </button>

              <button
                type="button"
                onClick={() => flipFaceAndAdjust(activeTargetId)}
                disabled={profiles.length === 0}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 whitespace-nowrap disabled:opacity-40 ${
                  adjustments.flipHorizontal
                    ? 'border-fuchsia-500 bg-fuchsia-600 text-white'
                    : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title="Flip source face horizontally and auto-adjust landmarks to match target face"
              >
                <FlipHorizontal2 className="w-3 h-3 shrink-0" />
                <span>{adjustments.flipHorizontal ? 'Flipped · Adjust' : 'Flip & Adjust'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAutoAlign(activeTargetId)}
                disabled={isHeaderAligning || profiles.length === 0}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 whitespace-nowrap disabled:opacity-40 ${
                  isHeaderAligned
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                    : 'border-cyan-500/50 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/60'
                }`}
                title="Automatically rotate, scale, and center source face to match detected target landmarks"
              >
                {isHeaderAligned ? (
                  <>
                    <Check className="w-3 h-3" />
                    <span className="tabular-nums">
                      Aligned ({alignedInfo!.rotation > 0 ? `+${alignedInfo!.rotation}` : alignedInfo!.rotation}° · {Math.round(alignedInfo!.scale * 100)}%)
                    </span>
                  </>
                ) : (
                  <>
                    <Crosshair className={`w-3 h-3 ${isHeaderAligning ? 'animate-spin' : ''}`} />
                    <span>{isHeaderAligning ? 'Aligning...' : 'Auto-Align'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSyncToLive(activeTargetId)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 whitespace-nowrap ${
                  isHeaderLiveSynced
                    ? 'border-rose-500/60 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
                    : 'border-violet-500/50 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/60'
                }`}
                title="Sync current adjustment settings for the selected face to Live Camera preview in real-time"
              >
                <Radio className={`w-3 h-3 ${isHeaderLiveSynced ? 'text-rose-500' : ''}`} />
                <span>
                  {isHeaderJustSynced
                    ? 'Synced!'
                    : isHeaderLiveSynced
                    ? 'Live Synced'
                    : 'Sync to Live'}
                </span>
              </button>

              {isHeaderLiveSynced && (
                <button
                  type="button"
                  onClick={() => setActiveTab('camera')}
                  className="text-[11px] font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-600 hover:text-white transition-colors flex items-center gap-1 whitespace-nowrap"
                  title="Open Live AR camera preview"
                >
                  <Video className="w-3 h-3" />
                  <span>Preview</span>
                </button>
              )}

              {detectedFaces.length > 1 && activeProfile && (
                <button
                  type="button"
                  onClick={() => assignProfileToAllFaces(activeProfile.id)}
                  className="text-[11px] font-medium px-2 py-1 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors flex items-center gap-1 whitespace-nowrap"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Apply {activeProfile.name.split(' ')[0]} to All</span>
                </button>
              )}
            </div>
          </div>

          {/* Detected Target People Cards */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {detectedFaces.map((face, index) => {
              const isSelected = selectedFaceId === face.id;
              const assignedProfile = profiles.find((p) => p.id === face.assignedProfileId);
              const assignedAngle = assignedProfile?.angles?.find((a) => a.id === face.assignedAngleId);
              const isCardAligning = aligningFaceId === face.id;
              const isCardAligned = alignedInfo?.faceId === face.id;
              const targetAngleInfo = classifyFaceAngle(face.yaw ?? 0, face.pitch ?? 0);

              return (
                <div
                  key={face.id}
                  onClick={() => setSelectedFaceId(face.id)}
                  className={`min-w-[196px] sm:min-w-[212px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      Person #{index + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={profiles.length === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAutoAlign(face.id);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors flex items-center gap-0.5 whitespace-nowrap disabled:opacity-40 ${
                          isCardAligned
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-cyan-100/80 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-200/80 dark:hover:bg-cyan-900/60'
                        }`}
                      >
                        <Crosshair className={`w-2.5 h-2.5 ${isCardAligning ? 'animate-spin' : ''}`} />
                        <span>{isCardAligned ? 'Aligned' : 'Align'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFaceEnabled(face.id);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
                          face.enabled
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                        }`}
                      >
                        {face.enabled ? 'On' : 'Off'}
                      </button>
                    </div>
                  </div>

                  {/* Pose Angle + Match Status Readout */}
                  <div className="flex items-center justify-between gap-1 text-[10px] font-mono tabular-nums">
                    <span className="text-slate-600 dark:text-slate-400 truncate">
                      {targetAngleInfo.label} (Y{Math.round(face.yaw ?? 0)}°)
                    </span>
                    {face.angleMatchScore !== undefined && (
                      <span
                        className={`font-semibold whitespace-nowrap ${
                          face.angleMatchStatus === 'matched'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : face.angleMatchStatus === 'unmatched'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        {face.angleMatchScore}%
                        {face.angleMatchFlipped ? ' · Flip' : ''}
                      </span>
                    )}
                  </div>

                  {/* Approximate Age & Expression */}
                  {(face.estimatedAge !== undefined || face.expression) && (
                    <div className="flex items-center">
                      {(() => {
                        const expr = face.expression || 'Neutral';
                        const ExprIcon =
                          expr === 'Laughing'
                            ? Laugh
                            : expr === 'Smiling'
                            ? Smile
                            : expr === 'Surprised'
                            ? Sparkles
                            : expr === 'Focused'
                            ? Eye
                            : Meh;
                        const chipStyle =
                          expr === 'Laughing' || expr === 'Smiling'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                            : expr === 'Surprised'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                            : expr === 'Focused'
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300'
                            : 'bg-slate-200/70 dark:bg-slate-800/80 border-slate-300/60 dark:border-slate-700 text-slate-600 dark:text-slate-300';

                        return (
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border whitespace-nowrap ${chipStyle}`}
                            title={`Detected age ~${face.estimatedAge ?? '--'} yrs · Expression: ${expr}`}
                          >
                            <ExprIcon className="w-2.5 h-2.5 shrink-0" />
                            <span className="tabular-nums">
                              {face.estimatedAge !== undefined ? `~${face.estimatedAge}y` : ''}
                              {face.estimatedAge !== undefined && expr ? ' · ' : ''}
                              {expr}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  )}

                  {/* Assigned Profile & Matched Angle Indicator */}
                  <div className="flex items-center gap-2">
                    {assignedProfile ? (
                      <img
                        src={assignedAngle?.avatarUrl || assignedProfile.avatarUrl}
                        alt={assignedProfile.name}
                        className="w-8 h-8 rounded-full object-cover border border-indigo-400/50 shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-400 text-xs shrink-0">
                        <X className="w-4 h-4" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <span className="block text-[11px] font-medium text-slate-900 dark:text-slate-100 truncate">
                        {assignedProfile ? assignedProfile.name : 'Original Face'}
                      </span>
                      <span className="block text-[10px] text-slate-500 truncate">
                        {assignedProfile
                          ? face.angleMatchStatus === 'unmatched'
                            ? `Need ${targetAngleInfo.label}`
                            : assignedAngle
                            ? `Angle: ${assignedAngle.label}`
                            : 'Swapped Face'
                          : 'Untouched'}
                      </span>
                    </div>
                  </div>

                  {/* Quick Profile Assignment Buttons */}
                  <div className="flex items-center gap-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                    {profiles.length > 0 ? (
                      <>
                        {profiles.slice(0, 3).map((p) => {
                          const isAssigned = face.assignedProfileId === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                assignProfileToFace(face.id, p.id);
                              }}
                              className={`px-2 py-1 rounded text-[10px] font-medium truncate flex-1 transition-colors ${
                                isAssigned
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                              }`}
                            >
                              {p.name.split(' ')[0]}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            assignProfileToFace(face.id, '');
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap ${
                            !face.assignedProfileId ? 'font-bold underline' : ''
                          }`}
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          faceFileInputRef.current?.click();
                        }}
                        className="w-full py-1 rounded text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-950/70 transition-colors"
                      >
                        + Add Person to Swap
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Camera Dialog for Creating Person or Adding New Angle */}
      <WebcamCaptureDialog
        isOpen={showFaceCamera}
        mode="face"
        onClose={() => {
          setShowFaceCamera(false);
          setCameraAngleProfileId(null);
        }}
        onCapture={handleCaptureFaceCamera}
      />
    </div>
  );
};
