import React from 'react';
import { Sliders, Camera, Users, Layers, History, Shirt } from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const BottomNavBar: React.FC = () => {
  const { activeTab, setActiveTab, viewMode } = useFaceStudio();

  const navItems = [
    { id: 'studio' as const, label: 'Face Swap', icon: Sliders },
    { id: 'body' as const, label: 'Body Fit', icon: Shirt },
    { id: 'camera' as const, label: 'Live Cam', icon: Camera },
    { id: 'vault' as const, label: 'Faces', icon: Users },
    { id: 'batch' as const, label: 'Batch', icon: Layers },
    { id: 'history' as const, label: 'History', icon: History },
  ];

  // On desktop expanded mode, TopBar renders the full navigation bar so the bottom bar stays hidden for maximum canvas height
  const visibilityClass = viewMode === 'expanded' ? 'md:hidden grid' : 'grid';

  return (
    <nav
      aria-label="Mobile navigation"
      className={`h-14 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-1 ${visibilityClass} grid-cols-6 items-center shrink-0 z-30 transition-colors`}
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center py-0.5 transition-colors duration-150 relative whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg ${
              isActive
                ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
            }`}
          >
            <div
              className={`px-2.5 py-1 rounded-xl transition-transform duration-150 ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/70'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <span className="text-[11px] tracking-tight mt-0.5 truncate max-w-full px-1">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
