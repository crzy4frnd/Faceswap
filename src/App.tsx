/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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
import { CustomAssetCaptureModal } from './components/CustomAssetCaptureModal';

const AppContent: React.FC = () => {
  const { activeTab, viewMode } = useFaceStudio();

  return (
    <AndroidFrame>
      <TopBar />

      <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {activeTab === 'studio' && (
          <>
            {viewMode === 'expanded' ? (
              /* Expanded Desktop Studio Split Layout */
              <div className="flex-1 flex flex-col lg:flex-row min-h-0">
                {/* Left: Canvas Stage */}
                <div className="flex-1 flex flex-col min-h-0 border-r border-slate-200 dark:border-slate-800">
                  <CanvasViewport />
                </div>

                {/* Right: Multi-Face Strip + Adjustments Inspector */}
                <div className="w-full lg:w-[420px] flex flex-col bg-white dark:bg-slate-900 overflow-y-auto shrink-0 border-t lg:border-t-0 border-slate-200 dark:border-slate-800">
                  <MultiFaceSelector />
                  <div className="flex-1">
                    <AdjustmentPanel />
                  </div>
                </div>
              </div>
            ) : (
              /* Mobile Phone View */
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 min-h-0 relative">
                  <CanvasViewport />
                </div>
                <MultiFaceSelector />
                <AdjustmentPanel />
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
