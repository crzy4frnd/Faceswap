import React from 'react';
import {
  Moon,
  Sun,
  Smartphone,
  Maximize2,
  Undo2,
  Redo2,
  Download,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const TopBar: React.FC = () => {
  const {
    theme,
    toggleTheme,
    viewMode,
    setViewMode,
    undo,
    redo,
    canUndo,
    canRedo,
    revertToOriginal,
    setShowExportModal,
    activeTab,
    setActiveTab,
  } = useFaceStudio();

  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md px-4 flex items-center justify-between gap-4 select-none shrink-0 z-30 transition-colors">
      {/* Zone 1: Wordmark */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <span className="font-semibold text-sm tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            FaceMorph
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
              Studio
            </span>
          </span>
        </div>
      </div>

      {/* Mode Switcher: Face Swap vs Body Fit */}
      <div className="flex items-center p-0.5 bg-slate-100/80 dark:bg-slate-950/80 rounded-xl border border-slate-200/80 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('studio')}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'studio'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Face
        </button>
        <button
          onClick={() => setActiveTab('body')}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'body'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Body & Jewelry
        </button>
      </div>

      {/* Zone 2: Fast Toolbar Actions */}
      <div className="flex items-center gap-1 sm:gap-2">
        {activeTab === 'studio' && (
          <div className="flex items-center border border-slate-200 dark:border-slate-800 rounded-lg p-0.5 bg-slate-100/70 dark:bg-slate-950/60">
            <button
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo edit"
              title="Undo edit"
              className="p-1.5 rounded text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo edit"
              title="Redo edit"
              className="p-1.5 rounded text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-800 mx-1" />
            <button
              onClick={revertToOriginal}
              aria-label="Revert to original"
              title="Revert to original"
              className="p-1.5 rounded text-slate-700 dark:text-slate-300 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* View Mode Switcher (Android Mobile Mock vs Expanded Desktop) */}
        <button
          onClick={() => setViewMode(viewMode === 'android' ? 'expanded' : 'android')}
          aria-label={viewMode === 'android' ? 'Switch to Studio View' : 'Switch to Android Mobile View'}
          title={viewMode === 'android' ? 'Expand to Studio Layout' : 'Preview Android Phone Layout'}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium transition-colors"
        >
          {viewMode === 'android' ? (
            <>
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Studio View</span>
            </>
          ) : (
            <>
              <Smartphone className="w-3.5 h-3.5" />
              <span>Mobile Mock</span>
            </>
          )}
        </button>

        {/* Dark / Night Mode Toggle */}
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Night Mode'}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Night Mode'}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
        </button>

        {/* Zone 3: Export Primary Action */}
        <button
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
};
