import React from 'react';
import {
  History,
  RotateCcw,
  Undo2,
  Redo2,
  Clock,
  CheckCircle,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const HistoryDrawer: React.FC = () => {
  const {
    history,
    historyIndex,
    jumpToHistory,
    undo,
    redo,
    revertToOriginal,
    canUndo,
    canRedo,
  } = useFaceStudio();

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 overflow-y-auto select-none transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Edit History & Rollback
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Click any snapshot to immediately revert adjustments and facial mappings
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium disabled:opacity-30 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium disabled:opacity-30 transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span>Redo</span>
          </button>
          <button
            onClick={revertToOriginal}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40 text-xs font-medium hover:bg-rose-100 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset All</span>
          </button>
        </div>
      </div>

      {/* History Timeline */}
      <div className="space-y-2 mt-4">
        {history.map((item, idx) => {
          const isCurrent = idx === historyIndex;
          const isFuture = idx > historyIndex;

          const date = new Date(item.timestamp);
          const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

          return (
            <div
              key={item.id}
              onClick={() => jumpToHistory(idx)}
              className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                isCurrent
                  ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 shadow-xs ring-1 ring-indigo-500/30'
                  : isFuture
                  ? 'opacity-40 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    isCurrent
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {isCurrent ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                </div>

                <div className="min-w-0">
                  <span
                    className={`block text-xs font-semibold truncate ${
                      isCurrent
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {item.action}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                    <span>{timeStr}</span>
                    <span>·</span>
                    <span>Strength: {item.adjustments.swapStrength}%</span>
                    <span>·</span>
                    <span>Feather: {item.adjustments.featherRadius}px</span>
                  </div>
                </div>
              </div>

              {isCurrent && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 shrink-0">
                  Current
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
