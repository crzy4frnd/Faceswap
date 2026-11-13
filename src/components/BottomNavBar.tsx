import { Sliders, Camera, Users, Layers, History, Shirt } from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const BottomNavBar: React.FC = () => {
  const { activeTab, setActiveTab } = useFaceStudio();

  const navItems = [
    { id: 'studio' as const, label: 'Face Swap', icon: Sliders },
    { id: 'body' as const, label: 'Body Fit', icon: Shirt },
    { id: 'camera' as const, label: 'Live Cam', icon: Camera },
    { id: 'vault' as const, label: 'Faces', icon: Users },
    { id: 'batch' as const, label: 'Batch', icon: Layers },
    { id: 'history' as const, label: 'History', icon: History },
  ];

  return (
    <nav className="h-16 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-1 grid grid-cols-6 items-center shrink-0 z-30 transition-colors">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;

        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`min-h-[48px] min-w-[48px] flex flex-col items-center justify-center py-1 transition-colors relative ${
              isActive
                ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
            }`}
          >
            <div
              className={`p-1 rounded-xl transition-all ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 scale-105'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-5 h-5" />
            </div>
            <span className="text-[11px] tracking-tight mt-0.5 truncate max-w-full px-1">
              {item.label}
            </span>
            {isActive && (
              <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
            )}
          </button>
        );
      })}
    </nav>
  );
};
