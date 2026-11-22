/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { PanelRightOpen } from 'lucide-react';
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
import { ExitConfirmModal } from './components/ExitConfirmModal';

const AppContent: React.FC = () => {
  const {
    activeTab,
    isInspectorOpen,
    setIsInspectorOpen,
    showExitConfirmModal,
    cancelExitAction,
    onBackPress,
  } = useFaceStudio();

  const studioStageRef = useRef<HTMLDivElement | null>(null);

  // Route hardware/keyboard Escape through global onBackPress or dismiss Exit modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showExitConfirmModal) {
        cancelExitAction();
        return;
      }
      onBackPress();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showExitConfirmModal, cancelExitAction, onBackPress]);

  return (
    <AndroidFrame>
      <TopBar />

      <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {activeTab === 'studio' && (
          <div
            ref={studioStageRef}
            className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden"
          >
            {/* Full-Bleed Canvas Viewport behind translucent floating AdjustmentPanel */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 relative z-0">
              <CanvasViewport />
            </div>

            {/* Draggable Floating Glass-Morphism Adjustment & Face Inspector Container with Slide Transition */}
            <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
              <div
                className={`pointer-events-none absolute inset-0 transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none will-change-transform ${
                  isInspectorOpen
                    ? 'translate-x-0 opacity-100'
                    : 'translate-x-[calc(100%+24px)] opacity-0'
                }`}
              >
                <AdjustmentPanel
                  facesSlot={<MultiFaceSelector />}
                  stageRef={studioStageRef}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsInspectorOpen(true)}
              tabIndex={isInspectorOpen ? -1 : 0}
              aria-hidden={isInspectorOpen}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/80 hover:bg-indigo-600/90 text-slate-100 hover:text-white border border-white/15 backdrop-blur-md shadow-xl text-xs font-semibold absolute right-3.5 bottom-10 z-30 transition-[transform,opacity,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none whitespace-nowrap ${
                isInspectorOpen
                  ? 'translate-y-3 opacity-0 pointer-events-none'
                  : 'translate-y-0 opacity-100 pointer-events-auto'
              }`}
              title="Open floating glass adjustments panel"
            >
              <PanelRightOpen className="w-4 h-4 shrink-0" />
              <span>Adjustments</span>
            </button>
          </div>
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
      <ExitConfirmModal />
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
