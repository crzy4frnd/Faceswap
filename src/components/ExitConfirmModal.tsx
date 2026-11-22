import React from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const ExitConfirmModal: React.FC = () => {
  const {
    showExitConfirmModal,
    exitConfirmState,
    confirmExitAction,
    cancelExitAction,
  } = useFaceStudio();

  if (!showExitConfirmModal || !exitConfirmState) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exit-confirm-title"
      aria-describedby="exit-confirm-desc"
      onClick={cancelExitAction}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200/80 dark:border-white/15 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl shadow-2xl p-5 space-y-4 text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="exit-confirm-title"
              className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
            >
              {exitConfirmState.title}
            </h2>
            <p
              id="exit-confirm-desc"
              className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 mt-1"
            >
              {exitConfirmState.message}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={cancelExitAction}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="w-4 h-4 text-rose-500 shrink-0" />
            <span>No</span>
          </button>

          <button
            type="button"
            onClick={confirmExitAction}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>Yes</span>
          </button>
        </div>
      </div>
    </div>
  );
};
