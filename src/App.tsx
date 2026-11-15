/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { PanelRightOpen, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { FaceStudioProvider, useFaceStudio } from './context/FaceStudioContext';
import { AndroidFrame } from './components/AndroidFrame';
import { TopBar } from './components/TopBar';
import { BottomNavBar } from './components/BottomNavBar';
import { CanvasViewport } from './components/CanvasViewport';
import { MultiFaceSelector } from './components/MultiFaceSelector';
import { AdjustmentPanel } from './components/AdjustmentPanel';
import { LiveCameraModal } from './components/LiveCameraModal';
import { BodyFitStudio } from './components/BodyFitStudio';
import { FaceVaultModal } from './components/FaceVaultModal';
import { BatchProcessingModal } from './components/BatchProcessingModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { ExportModal } from './components/ExportModal';
import { GitHubPushModal } from './components/GitHubPushModal';
import { CustomAssetCaptureModal } from './components/CustomAssetCaptureModal';

const AppContent: React.FC = () => {
  const { activeTab, viewMode, isInspectorOpen, setIsInspectorOpen } = useFaceStudio();
  const [isMobileDeckOpen, setIsMobileDeckOpen] = useState(true);

  return (
    <AndroidFrame>
      <TopBar />

      <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {activeTab === 'studio' && (
          <>
            {viewMode === 'expanded' ? (
              /* Expanded Full-Screen Responsive Studio Split Layout */
              <div className="flex-1 flex flex-col lg:flex-row min-h-0 relative">
                {/* Main Big Canvas Stage */}
                <div
                  className={`flex-1 flex flex-col min-w-0 min-h-0 relative ${
                    isInspectorOpen ? 'lg:border-r border-slate-200 dark:border-slate-800' : ''
                  }`}
                >
                  <CanvasViewport />

                  {/* Floating Re-open Controls trigger when collapsed on desktop */}
                  {!isInspectorOpen && (
                    <button
                      type="button"
                      onClick={() => setIsInspectorOpen(true)}
                      className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-indigo-600 hover:text-white text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-lg backdrop-blur-md text-xs font-semibold absolute right-4 bottom-14 z-30 transition-all duration-150"
                      title="Show editing controls"
                    >
                      <PanelRightOpen className="w-4 h-4" />
                      <span>Controls</span>
                    </button>
                  )}
                </div>

                {/* Collapsible Inspector: Bottom Sheet on Mobile/Tablet (< lg), Sidebar on Desktop (>= lg) */}
                {isInspectorOpen && (
                  <aside
                    className={`w-full lg:w-[400px] xl:w-[430px] flex flex-col bg-white dark:bg-slate-900 overflow-hidden shrink-0 border-t lg:border-t-0 border-slate-200 dark:border-slate-800 transition-all ${
                      isMobileDeckOpen ? 'max-h-[42vh] lg:max-h-none' : 'lg:max-h-none'
                    }`}
                  >
                    {/* Mobile / Tablet Collapse Bar */}
                    <button
                      type="button"
                      onClick={() => setIsMobileDeckOpen((prev) => !prev)}
                      className="lg:hidden w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0"
                    >
                      <span className="flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                        <span>{isMobileDeckOpen ? 'Hide Controls for Larger View' : 'Faces & Adjustments'}</span>
                      </span>
                      {isMobileDeckOpen ? (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      ) : (
                        <ChevronUp className="w-4 h-4 text-indigo-500" />
                      )}
                    </button>

                    <div
                      className={`${
                        isMobileDeckOpen ? 'flex flex-col flex-1 min-h-0 overflow-y-auto' : 'hidden lg:flex lg:flex-col lg:flex-1 lg:min-h-0'
                      }`}
                    >
                      <MultiFaceSelector />
                      <AdjustmentPanel />
                    </div>
                  </aside>
                )}
              </div>
            ) : (
              /* Phone Preview Frame Layout with collapsible control deck */
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 min-h-0 relative">
                  <CanvasViewport />
                </div>
                <div className="shrink-0 flex flex-col bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsMobileDeckOpen((prev) => !prev)}
                    className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <span className="flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{isMobileDeckOpen ? 'Collapse Editing Controls' : 'Expand Faces & Controls'}</span>
                    </span>
                    {isMobileDeckOpen ? (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronUp className="w-4 h-4 text-indigo-500" />
                    )}
                  </button>
                  {isMobileDeckOpen && (
                    <div className="max-h-[38vh] overflow-y-auto flex flex-col">
                      <MultiFaceSelector />
                      <AdjustmentPanel />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'body' && <BodyFitStudio />}
        {activeTab === 'camera' && <LiveCameraModal />}
        {activeTab === 'vault' && <FaceVaultModal />}
        {activeTab === 'batch' && <BatchProcessingModal />}
        {activeTab === 'history' && <HistoryDrawer />}
      </main>

      <BottomNavBar />
      <ExportModal />
      <GitHubPushModal />
      <CustomAssetCaptureModal />
    </AndroidFrame>
  );
};

export default function App() {
  return (
    <FaceStudioProvider>
      <AppContent />
    </FaceStudioProvider>
  );
}
