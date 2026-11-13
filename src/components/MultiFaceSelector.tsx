import React from 'react';
import { Users, Check, X, Sparkles, RefreshCw } from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const MultiFaceSelector: React.FC = () => {
  const {
    detectedFaces,
    selectedFaceId,
    setSelectedFaceId,
    profiles,
    activeProfileId,
    assignProfileToFace,
    assignProfileToAllFaces,
    toggleFaceEnabled,
    rescanFaces,
    setActiveTab,
  } = useFaceStudio();

  if (detectedFaces.length === 0) {
    return (
      <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <span className="text-xs text-slate-500">No faces detected yet</span>
        <button
          onClick={rescanFaces}
          className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Rescan</span>
        </button>
      </div>
    );
  }

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  return (
    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Detected People ({detectedFaces.length})
          </span>
          <span className="text-[11px] text-slate-500">· Tap to configure</span>
        </div>

        {detectedFaces.length > 1 && (
          <button
            onClick={() => assignProfileToAllFaces(activeProfileId)}
            className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 transition-colors flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>Apply {activeProfile?.name?.split(' ')[0] || 'Face'} to All</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {detectedFaces.map((face, index) => {
          const isSelected = selectedFaceId === face.id;
          const assignedProfile = profiles.find((p) => p.id === face.assignedProfileId);

          return (
            <div
              key={face.id}
              onClick={() => setSelectedFaceId(face.id)}
              className={`min-w-[170px] sm:min-w-[190px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              {/* Person Header */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Person #{index + 1}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFaceEnabled(face.id);
                  }}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                    face.enabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {face.enabled ? 'Enabled' : 'Bypassed'}
                </button>
              </div>

              {/* Assigned Profile Selector */}
              <div className="flex items-center gap-2">
                {assignedProfile ? (
                  <img
                    src={assignedProfile.avatarUrl}
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
                    {assignedProfile ? 'Swapped Face' : 'Untouched'}
                  </span>
                </div>
              </div>

              {/* Quick Profile Assignment Buttons */}
              <div className="flex items-center gap-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
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
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate flex-1 transition-colors ${
                        isAssigned
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
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
                  className={`px-1.5 py-0.5 rounded text-[10px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 ${
                    !face.assignedProfileId ? 'font-bold underline' : ''
                  }`}
                  title="Remove swap for this face"
                >
                  Clear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
