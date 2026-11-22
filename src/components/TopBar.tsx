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
  Sliders,
  Shirt,
  Camera,
  Users,
  Layers,
  History,
  PanelRightClose,
  PanelRightOpen,
  GitBranch,
  ArrowLeft,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const TopBar: React.FC = () => {
  const {
    theme,
    toggleTheme,
    viewMode,
    setViewMode,
    isInspectorOpen,
    toggleInspector,
    undo,
    redo,
    canUndo,
    canRedo,
    revertToOriginal,
    setShowExportModal,
    setShowGitHubModal,
    activeTab,
    setActiveTab,
    onBackPress,
  } = useFaceStudio();

  const navItems = [
    { id: 'studio' as const, label: 'Face Swap', icon: Sliders },
    { id: 'body' as const, label: 'Body Fit', icon: Shirt },
    { id: 'camera' as const, label: 'Live Cam', icon: Camera },
    { id: 'vault' as const, label: 'Face Vault', icon: Users },
    { id: 'batch' as const, label: 'Batch', icon: Layers },
    { id: 'history' as const, label: 'History', icon: History },
  ];

  const showPanelToggle = activeTab === 'studio' || activeTab === 'body';

  return (
    <header className="h-12 sm:h-14 border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-2 sm:px-5 flex items-center justify-between gap-1.5 sm:gap-5 select-none shrink-0 z-30 transition-colors">
      {/* Zone 1: Back Guard & Brand Wordmark */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onBackPress()}
          aria-label="Back or exit current tool"
          title="Back / Exit tool (with confirmation)"
          className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('studio')}
          className="flex items-center gap-2 whitespace-nowrap shrink-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm sm:text-base tracking-tight text-slate-900 dark:text-slate-100">
            FaceMorph<span className="hidden sm:inline"> Studio</span>
          </span>
        </button>
      </div>

      {/* Zone 2: Clean Single-Line Studio Navigation (Desktop Expanded Mode) */}
      {viewMode === 'expanded' && (
        <nav
          aria-label="Workspace navigation"
          className="hidden md:flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-slate-950/80 rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-x-auto no-scrollbar"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isActive
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-800/40'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Zone 3: Editing Actions & Primary Export */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {activeTab === 'studio' && (
          <div className="flex items-center border border-slate-200 dark:border-slate-800 rounded-lg p-0.5 bg-slate-100/80 dark:bg-slate-950/70">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo edit"
              title="Undo edit"
              className="p-1.5 sm:p-2 rounded-md text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo edit"
              title="Redo edit"
              className="p-1.5 sm:p-2 rounded-md text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-800 mx-0.5" />
            <button
              type="button"
              onClick={revertToOriginal}
              aria-label="Revert all edits to original"
              title="Revert all edits to original"
              className="p-1.5 sm:p-2 rounded-md text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-slate-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Collapsible Inspector / Side-Sheet Drawer Toggle (All Viewports & Frame Modes) */}
        {showPanelToggle && (
          <button
            type="button"
            onClick={toggleInspector}
            aria-expanded={isInspectorOpen}
            aria-label={isInspectorOpen ? 'Close editing inspector' : 'Open editing inspector'}
            title={isInspectorOpen ? 'Close inspector drawer' : 'Open editing inspector'}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isInspectorOpen
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {isInspectorOpen ? (
              <>
                <PanelRightClose className="w-4 h-4 shrink-0" />
                <span className="hidden xl:inline">Hide Panel</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Inspector</span>
              </>
            )}
          </button>
        )}

        {/* View Mode Switcher (Full Studio vs Phone Mockup Preview) */}
        <button
          type="button"
          onClick={() => setViewMode(viewMode === 'android' ? 'expanded' : 'android')}
          aria-label={viewMode === 'android' ? 'Switch to Full Screen Studio' : 'Switch to Phone Frame Preview'}
          title={viewMode === 'android' ? 'Switch to Full Screen Studio' : 'Preview Phone Frame Layout'}
          className="hidden lg:flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0"
        >
          {viewMode === 'android' ? (
            <Maximize2 className="w-4 h-4" />
          ) : (
            <Smartphone className="w-4 h-4" />
          )}
        </button>

        {/* Dark / Light Mode Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Night Mode'}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Night Mode'}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
        </button>

        {/* GitHub All-Files Push Button */}
        <button
          type="button"
          onClick={() => setShowGitHubModal(true)}
          aria-label="Push all files to GitHub"
          title="Push all project files to GitHub"
          className="flex items-center gap-1.5 px-2 sm:px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 active:scale-[0.98] text-white text-xs font-semibold shadow-xs transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="hidden md:inline">GitHub Push</span>
        </button>

        {/* Primary Export CTA */}
        <button
          type="button"
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
};
