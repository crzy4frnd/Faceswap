import React, { useState } from 'react';
import {
  Sliders,
  Palette,
  Move,
  RotateCcw,
  Sparkles,
  Sun,
  Contrast,
  CloudMoon,
  Thermometer,
  Wand2,
  Paintbrush,
  Glasses,
  Eye,
  Eraser,
  ShieldCheck,
  Check,
  Network,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

export const AdjustmentPanel: React.FC = () => {
  const {
    adjustments,
    updateAdjustments,
    resetAdjustments,
    clearManualMask,
    hasManualMaskStrokes,
  } = useFaceStudio();

  const [activeSubTab, setActiveSubTab] = useState<'blend' | 'masking' | 'lighting' | 'transform'>('blend');

  return (
    <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col shrink-0 select-none transition-colors">
      {/* Sub Tabs */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 border-b border-slate-100 dark:border-slate-800/60 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-950 rounded-lg shrink-0">
          <button
            onClick={() => setActiveSubTab('blend')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'blend'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Blend & Skin
          </button>
          <button
            onClick={() => setActiveSubTab('masking')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-all flex items-center gap-1 ${
              activeSubTab === 'masking'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span>Auto-Mask & Brush</span>
          </button>
          <button
            onClick={() => setActiveSubTab('lighting')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'lighting'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Lighting & Tone
          </button>
          <button
            onClick={() => setActiveSubTab('transform')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'transform'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Alignment
          </button>
        </div>

        <button
          onClick={resetAdjustments}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors ml-2 shrink-0"
          title="Reset sliders to default"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Sliders & Tools Container */}
      <div className="p-3 space-y-3 max-h-[225px] overflow-y-auto no-scrollbar">
        {/* TAB 1: BLEND & SKIN */}
        {activeSubTab === 'blend' && (
          <>
            {/* Swap Strength Slider */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                  Swap Strength
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 text-[11px]">
                  {adjustments.swapStrength}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.swapStrength}
                onChange={(e) =>
                  updateAdjustments({ swapStrength: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Swap Strength: ${adjustments.swapStrength}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Swap Strength: ${adjustments.swapStrength}%`)
                }
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Auto Skin Tone Matching Toggle + Strength */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-emerald-500" />
                  <div>
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Automatic Skin Tone Matching
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Reinhard statistical color matching in Lab space
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adjustments.skinToneMatch}
                    onChange={(e) =>
                      updateAdjustments(
                        { skinToneMatch: e.target.checked },
                        e.target.checked ? 'Skin Tone Matching Enabled' : 'Skin Tone Matching Disabled'
                      )
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {adjustments.skinToneMatch && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600 dark:text-slate-400">Tone Match Intensity</span>
                    <span className="font-mono text-slate-500">{adjustments.skinToneStrength}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={adjustments.skinToneStrength}
                    onChange={(e) =>
                      updateAdjustments({ skinToneStrength: Number(e.target.value) })
                    }
                    className="w-full accent-emerald-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Edge Feathering Tool */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-indigo-500" />
                  Base Feather Radius
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 text-[11px]">
                  {adjustments.featherRadius}px
                </span>
              </div>
              <input
                type="range"
                min="4"
                max="50"
                value={adjustments.featherRadius}
                onChange={(e) =>
                  updateAdjustments({ featherRadius: Number(e.target.value) })
                }
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Smart Blend: Dynamic Skin Texture & Boundary Topology Feathering */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  <div>
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Smart Blend (Topology-Aware)
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Dynamically adapts feathering based on facial curvature & texture
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adjustments.smartBlend}
                    onChange={(e) =>
                      updateAdjustments(
                        { smartBlend: e.target.checked },
                        e.target.checked ? 'Smart Blend Enabled' : 'Smart Blend Disabled'
                      )
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {adjustments.smartBlend && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 space-y-2">
                  {/* Topology Adaptiveness Slider */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-600 dark:text-slate-400">Topology Adaptiveness</span>
                      <span className="font-mono text-slate-500">{adjustments.smartBlendIntensity}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={adjustments.smartBlendIntensity}
                      onChange={(e) =>
                        updateAdjustments({ smartBlendIntensity: Number(e.target.value) })
                      }
                      className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Texture & Pore Frequency Matching */}
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={adjustments.textureMatching}
                      onChange={(e) =>
                        updateAdjustments({ textureMatching: e.target.checked })
                      }
                      className="accent-indigo-600 rounded"
                    />
                    <span>Skin Pore & Micro-Grain Matching (Anti-Plastic Blur)</span>
                  </label>

                  {/* Real-time Topology Breakdown Badges */}
                  <div className="flex items-center gap-1.5 pt-1 text-[10px] text-slate-500 font-mono">
                    <span className="bg-slate-200/70 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                      Jaw: Crisp ({Math.round(adjustments.featherRadius * 0.45)}px)
                    </span>
                    <span className="bg-slate-200/70 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                      Cheeks: Soft ({Math.round(adjustments.featherRadius * 1.38)}px)
                    </span>
                    <span className="bg-slate-200/70 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                      Forehead: Natural ({Math.round(adjustments.featherRadius * 0.92)}px)
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 2: AUTO-MASKING & FINE-TUNE BRUSH */}
        {activeSubTab === 'masking' && (
          <div className="space-y-3">
            {/* Auto Detection Toggles Box */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  Auto Hair & Accessory Boundary Detection
                </span>
                <button
                  onClick={() =>
                    updateAdjustments({ showMaskOverlay: !adjustments.showMaskOverlay })
                  }
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 ${
                    adjustments.showMaskOverlay
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-300 dark:border-slate-700 text-slate-500'
                  }`}
                  title="Toggle visual mask display"
                >
                  <Eye className="w-3 h-3" />
                  <span>{adjustments.showMaskOverlay ? 'Hide Mask' : 'View Mask'}</span>
                </button>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adjustments.autoMaskHair}
                    onChange={(e) =>
                      updateAdjustments(
                        { autoMaskHair: e.target.checked },
                        'Hair & Bangs Mask Toggled'
                      )
                    }
                    className="accent-indigo-600 rounded"
                  />
                  <span>Protect Hair & Bangs</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adjustments.autoMaskAccessories}
                    onChange={(e) =>
                      updateAdjustments(
                        { autoMaskAccessories: e.target.checked },
                        'Accessory Mask Toggled'
                      )
                    }
                    className="accent-indigo-600 rounded"
                  />
                  <span>Glasses & Jewelry</span>
                </label>
              </div>

              {/* Sensitivity Slider */}
              <div className="pt-1.5">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-600 dark:text-slate-400">Detection Sensitivity</span>
                  <span className="font-mono text-slate-500">{adjustments.maskSensitivity}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={adjustments.maskSensitivity}
                  onChange={(e) =>
                    updateAdjustments({ maskSensitivity: Number(e.target.value) })
                  }
                  className="w-full accent-emerald-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Manual Fine-Tune Brush Option */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Paintbrush className="w-3.5 h-3.5 text-indigo-500" />
                  Manual 'Fine-Tune' Brush
                </span>

                {hasManualMaskStrokes && (
                  <button
                    onClick={clearManualMask}
                    className="text-[10px] text-rose-500 hover:text-rose-600 font-medium flex items-center gap-1"
                    title="Clear painted strokes"
                  >
                    <Eraser className="w-3 h-3" />
                    <span>Clear Brush</span>
                  </button>
                )}
              </div>

              {/* Brush Mode Segmented Control */}
              <div className="grid grid-cols-3 gap-1.5 p-0.5 bg-slate-200/70 dark:bg-slate-900 rounded-lg">
                <button
                  onClick={() => updateAdjustments({ brushMode: 'none' })}
                  className={`py-1 text-[11px] font-medium rounded-md transition-all ${
                    adjustments.brushMode === 'none'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Cursor (Off)
                </button>
                <button
                  onClick={() => updateAdjustments({ brushMode: 'protect', showMaskOverlay: true })}
                  className={`py-1 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
                    adjustments.brushMode === 'protect'
                      ? 'bg-emerald-600 text-white shadow-xs font-bold'
                      : 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-800'
                  }`}
                  title="Paint on image to protect hair or accessory"
                >
                  <span>Protect Hair</span>
                </button>
                <button
                  onClick={() => updateAdjustments({ brushMode: 'reveal', showMaskOverlay: true })}
                  className={`py-1 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
                    adjustments.brushMode === 'reveal'
                      ? 'bg-indigo-600 text-white shadow-xs font-bold'
                      : 'text-indigo-700 dark:text-indigo-400 hover:text-indigo-800'
                  }`}
                  title="Paint on image to reveal swapped face"
                >
                  <span>Reveal Face</span>
                </button>
              </div>

              {/* Brush Settings if active */}
              {adjustments.brushMode !== 'none' && (
                <div className="space-y-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">Brush Radius</span>
                    <span className="font-mono text-slate-500">{adjustments.brushSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="6"
                    max="80"
                    value={adjustments.brushSize}
                    onChange={(e) =>
                      updateAdjustments({ brushSize: Number(e.target.value) })
                    }
                    className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-500 italic">
                    Tip: Click and paint directly onto the photo above to preserve or reveal boundaries.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: LIGHTING & TONE */}
        {activeSubTab === 'lighting' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Brightness */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  Brightness
                </span>
                <span className="font-mono text-slate-500 text-[11px]">
                  {adjustments.brightness > 0 ? `+${adjustments.brightness}` : adjustments.brightness}
                </span>
              </div>
              <input
                type="range"
                min="-60"
                max="60"
                value={adjustments.brightness}
                onChange={(e) => updateAdjustments({ brightness: Number(e.target.value) })}
                className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Shadows */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <CloudMoon className="w-3.5 h-3.5 text-indigo-400" />
                  Shadow Lift
                </span>
                <span className="font-mono text-slate-500 text-[11px]">
                  {adjustments.shadows > 0 ? `+${adjustments.shadows}` : adjustments.shadows}
                </span>
              </div>
              <input
                type="range"
                min="-50"
                max="50"
                value={adjustments.shadows}
                onChange={(e) => updateAdjustments({ shadows: Number(e.target.value) })}
                className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Contrast */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Contrast className="w-3.5 h-3.5 text-blue-500" />
                  Contrast
                </span>
                <span className="font-mono text-slate-500 text-[11px]">
                  {adjustments.contrast > 0 ? `+${adjustments.contrast}` : adjustments.contrast}
                </span>
              </div>
              <input
                type="range"
                min="-50"
                max="50"
                value={adjustments.contrast}
                onChange={(e) => updateAdjustments({ contrast: Number(e.target.value) })}
                className="w-full accent-blue-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Warmth / Color Temperature */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5 text-orange-500" />
                  Warmth
                </span>
                <span className="font-mono text-slate-500 text-[11px]">
                  {adjustments.temperature > 0 ? `+${adjustments.temperature}` : adjustments.temperature}
                </span>
              </div>
              <input
                type="range"
                min="-40"
                max="40"
                value={adjustments.temperature}
                onChange={(e) => updateAdjustments({ temperature: Number(e.target.value) })}
                className="w-full accent-orange-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* TAB 4: ALIGNMENT & TRANSFORM */}
        {activeSubTab === 'transform' && (
          <div className="space-y-3">
            {/* Scale & Rotation */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Face Scale</span>
                  <span className="font-mono text-slate-500 text-[11px]">
                    {Math.round(adjustments.scale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.25"
                  step="0.01"
                  value={adjustments.scale}
                  onChange={(e) => updateAdjustments({ scale: Number(e.target.value) })}
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Rotation</span>
                  <span className="font-mono text-slate-500 text-[11px]">
                    {adjustments.rotation}°
                  </span>
                </div>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  value={adjustments.rotation}
                  onChange={(e) => updateAdjustments({ rotation: Number(e.target.value) })}
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Geometric Landmark Mesh & Manual Alignment Toggle */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-cyan-500" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Geometric Landmark Mesh
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Drag eyes, nose, lips or jawline directly on photo to correct auto-alignment
                </span>
              </div>

              <button
                onClick={() =>
                  updateAdjustments({ showGeometricMesh: !adjustments.showGeometricMesh })
                }
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  adjustments.showGeometricMesh
                    ? 'bg-cyan-600 text-white shadow-xs'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-white'
                }`}
              >
                {adjustments.showGeometricMesh ? 'Mesh Active' : 'Show Mesh'}
              </button>
            </div>

            {/* Micro Alignment Nudge Pad */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Position Nudge
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  ({adjustments.offsetX}px, {adjustments.offsetY}px)
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateAdjustments({ offsetX: adjustments.offsetX - 3 })}
                  className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold hover:bg-slate-300 flex items-center justify-center"
                >
                  ←
                </button>
                <button
                  onClick={() => updateAdjustments({ offsetX: adjustments.offsetX + 3 })}
                  className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold hover:bg-slate-300 flex items-center justify-center"
                >
                  →
                </button>
                <button
                  onClick={() => updateAdjustments({ offsetY: adjustments.offsetY - 3 })}
                  className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold hover:bg-slate-300 flex items-center justify-center"
                >
                  ↑
                </button>
                <button
                  onClick={() => updateAdjustments({ offsetY: adjustments.offsetY + 3 })}
                  className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-800 text-xs font-bold hover:bg-slate-300 flex items-center justify-center"
                >
                  ↓
                </button>
                <button
                  onClick={() => updateAdjustments({ offsetX: 0, offsetY: 0 })}
                  className="px-1.5 py-1 text-[10px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Center
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
