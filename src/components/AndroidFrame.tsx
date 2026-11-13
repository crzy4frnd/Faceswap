import React from 'react';
import { Wifi, BatteryMedium, Signal } from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const AndroidFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { viewMode } = useFaceStudio();

  // If user toggles to full expanded studio mode, render edge-to-edge
  if (viewMode === 'expanded') {
    return (
      <div className="w-full h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
        {children}
      </div>
    );
  }

  // Native Android Phone Frame mode (with responsive fallback for small screens)
  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-0 sm:p-4 lg:p-6 select-none overflow-x-hidden">
      {/* Outer Phone Hardware Mockup */}
      <div className="w-full sm:max-w-[430px] sm:h-[880px] h-screen bg-slate-900 sm:rounded-[44px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] sm:border-[10px] sm:border-slate-800 flex flex-col relative overflow-hidden ring-1 ring-white/10">
        {/* Android Punch Hole Camera & Speaker */}
        <div className="hidden sm:flex absolute top-3 left-1/2 -translate-x-1/2 z-40 items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full bg-black border border-slate-800 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-950/80" />
          </div>
        </div>

        {/* Android Status Bar */}
        <div className="h-7 px-6 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between text-[11px] font-medium text-slate-700 dark:text-slate-300 shrink-0 z-30 transition-colors">
          <span className="font-mono tracking-tight font-semibold">9:41</span>
          <div className="flex items-center gap-2">
            <Signal className="w-3 h-3" />
            <Wifi className="w-3 h-3" />
            <div className="flex items-center gap-0.5">
              <span className="font-mono text-[10px]">98%</span>
              <BatteryMedium className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        {/* App Content */}
        <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden bg-slate-50 dark:bg-slate-950">
          {children}
        </div>

        {/* Android Gesture Navigation Pill */}
        <div className="h-4 bg-white/95 dark:bg-slate-900/95 flex items-center justify-center shrink-0 z-30 transition-colors">
          <div className="w-28 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
      </div>
    </div>
  );
};
