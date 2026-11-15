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
  Droplets,
  SunMedium,
  Camera,
  Trees,
  Film,
  Activity,
  Crosshair,
  Compass,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';
import {
  AdjustmentSubTab,
  LightingPresetCategory,
  loadSavedPanelUIState,
  savePanelUIState,
} from '../utils/adjustmentStorage';

interface LightingPreset {
  id: string;
  name: string;
  category: Exclude<LightingPresetCategory, 'all'>;
  subtitle: string;
  swatchClass: string;
  values: {
    brightness: number;
    shadows: number;
    contrast: number;
    temperature: number;
    saturation: number;
  };
}

const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'studio-softbox',
    name: 'Studio Softbox',
    category: 'studio',
    subtitle: 'Even key & lifted shadows',
    swatchClass: 'from-slate-100 via-amber-50 to-slate-300',
    values: { brightness: 6, shadows: 14, contrast: 4, temperature: 2, saturation: 2 },
  },
  {
    id: 'studio-rembrandt',
    name: 'Rembrandt Key',
    category: 'studio',
    subtitle: 'Sculpted editorial contrast',
    swatchClass: 'from-amber-200 via-stone-500 to-slate-900',
    values: { brightness: -4, shadows: -8, contrast: 22, temperature: 6, saturation: -4 },
  },
  {
    id: 'outdoor-golden-hour',
    name: 'Golden Hour',
    category: 'outdoor',
    subtitle: 'Warm sunlit rim glow',
    swatchClass: 'from-amber-300 via-orange-400 to-rose-400',
    values: { brightness: 8, shadows: 12, contrast: 8, temperature: 24, saturation: 14 },
  },
  {
    id: 'outdoor-overcast',
    name: 'Overcast Shade',
    category: 'outdoor',
    subtitle: 'Cool diffused daylight',
    swatchClass: 'from-sky-200 via-cyan-300 to-slate-400',
    values: { brightness: 2, shadows: 18, contrast: -6, temperature: -14, saturation: -6 },
  },
  {
    id: 'cinematic-noir',
    name: 'Noir Contrast',
    category: 'cinematic',
    subtitle: 'Deep shadow & crisp highlights',
    swatchClass: 'from-slate-300 via-slate-700 to-slate-950',
    values: { brightness: -10, shadows: -22, contrast: 34, temperature: -8, saturation: -28 },
  },
  {
    id: 'cinematic-film',
    name: 'Cinema Warm',
    category: 'cinematic',
    subtitle: 'Rich tungsten & deep tone',
    swatchClass: 'from-orange-300 via-amber-600 to-cyan-900',
    values: { brightness: -2, shadows: 8, contrast: 18, temperature: 14, saturation: 10 },
  },
];

export const AdjustmentPanel: React.FC = () => {
  const {
    adjustments,
    updateAdjustments,
    resetAdjustments,
    clearManualMask,
    hasManualMaskStrokes,
    matchAmbientLight,
    ambientLightReport,
    autoOptimizeReport,
    autoOptimizeWithCamera,
    triggerAutoRefocus,
  } = useFaceStudio();

  const [activeSubTab, setActiveSubTab] = useState<AdjustmentSubTab>(
    () => loadSavedPanelUIState().activeSubTab
  );
  const [presetCategory, setPresetCategory] = useState<LightingPresetCategory>(
    () => loadSavedPanelUIState().presetCategory
  );
  const [isMatchingLight, setIsMatchingLight] = useState(false);
  const [isAutoOptimizing, setIsAutoOptimizing] = useState(false);

  React.useEffect(() => {
    savePanelUIState({ activeSubTab, presetCategory });
  }, [activeSubTab, presetCategory]);

  const visiblePresets =
    presetCategory === 'all'
      ? LIGHTING_PRESETS
      : LIGHTING_PRESETS.filter((p) => p.category === presetCategory);

  const applyLightingPreset = (preset: LightingPreset) => {
    updateAdjustments(
      {
        brightness: preset.values.brightness,
        shadows: preset.values.shadows,
        contrast: preset.values.contrast,
        temperature: preset.values.temperature,
        saturation: preset.values.saturation,
        autoAmbientLight: false,
      },
      `Lighting Preset: ${preset.name}`
    );
  };

  const handleMatchAmbientLight = async () => {
    setIsMatchingLight(true);
    try {
      await matchAmbientLight();
    } finally {
      setIsMatchingLight(false);
    }
  };

  const handleAutoOptimize = async () => {
    setIsAutoOptimizing(true);
    try {
      await autoOptimizeWithCamera();
    } finally {
      setIsAutoOptimizing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col flex-1 min-h-0 select-none transition-colors">
      {/* Sub Tabs */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1.5 border-b border-slate-100 dark:border-slate-800/60 overflow-x-auto no-scrollbar shrink-0">
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-950 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setActiveSubTab('blend')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'blend'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Blend & Skin
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('masking')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all flex items-center gap-1 ${
              activeSubTab === 'masking'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span>Auto-Mask & Brush</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('lighting')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'lighting'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Lighting & Tone
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('transform')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
              activeSubTab === 'transform'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Alignment
          </button>
        </div>

        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <button
            type="button"
            onClick={handleAutoOptimize}
            disabled={isAutoOptimizing}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] text-[11px] font-semibold text-white shadow-xs transition-all whitespace-nowrap disabled:opacity-70"
            title="Analyze scene lighting via camera and balance Edge Softness, Shadow Matcher, and Color Correction"
          >
            <Sparkles className={`w-3 h-3 ${isAutoOptimizing ? 'animate-spin' : ''}`} />
            <span>{isAutoOptimizing ? 'Analyzing...' : 'Auto-Optimize'}</span>
          </button>

          <button
            type="button"
            onClick={handleMatchAmbientLight}
            disabled={isMatchingLight}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-300/70 dark:border-amber-700/60 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors whitespace-nowrap"
            title="Match source color temperature and exposure to target image ambient light"
          >
            <SunMedium className={`w-3 h-3 ${isMatchingLight ? 'animate-spin' : ''}`} />
            <span>{isMatchingLight ? 'Matching...' : 'Match Light'}</span>
          </button>

          <button
            type="button"
            onClick={resetAdjustments}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors whitespace-nowrap"
            title="Reset sliders to default"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {autoOptimizeReport && (
        <div className="px-3 py-1.5 bg-indigo-50/80 dark:bg-indigo-950/35 border-b border-indigo-200/70 dark:border-indigo-800/50 flex items-center justify-between gap-2 text-[10px] shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 text-indigo-800 dark:text-indigo-200">
            <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="font-semibold truncate">
              {autoOptimizeReport.source} · {autoOptimizeReport.lightingProfile} ({autoOptimizeReport.sceneKelvin}K)
            </span>
          </div>
          <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-300 whitespace-nowrap shrink-0">
            Edge {autoOptimizeReport.edgeSoftness}% · Shadow {autoOptimizeReport.shadowMatcher}% · Sat{' '}
            {autoOptimizeReport.saturation > 0
              ? `+${autoOptimizeReport.saturation}`
              : autoOptimizeReport.saturation}
          </span>
        </div>
      )}

      {/* Sliders & Tools Container */}
      <div className="p-3 space-y-3 flex-1 min-h-0 max-h-[240px] lg:max-h-none overflow-y-auto">
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

            {/* Edge Softness (Face Mask Feathering Intensity) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  Edge Softness
                </span>
                <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400 text-[11px] font-medium">
                  {adjustments.edgeSoftness}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Controls the feathering intensity of the face mask for a seamless transition between swapped face and original skin
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.edgeSoftness}
                onChange={(e) =>
                  updateAdjustments({ edgeSoftness: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Edge Softness: ${adjustments.edgeSoftness}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Edge Softness: ${adjustments.edgeSoftness}%`)
                }
                aria-label="Edge Softness"
                className="w-full accent-sky-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* AI Skin Smoothing (Real-Time Bilateral Filter) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5 text-cyan-500" />
                  AI Skin Smoothing
                </span>
                <span className="font-mono text-cyan-600 dark:text-cyan-400 text-[11px] font-medium">
                  {adjustments.skinSmoothing}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Real-time bilateral filter smooths skin while preserving eyes &amp; lips and matching target texture
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.skinSmoothing}
                onChange={(e) =>
                  updateAdjustments({ skinSmoothing: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `AI Skin Smoothing: ${adjustments.skinSmoothing}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `AI Skin Smoothing: ${adjustments.skinSmoothing}%`)
                }
                aria-label="AI Skin Smoothing"
                className="w-full accent-cyan-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Skin Texture Smoothing (Edge-Masked Gaussian Blur) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                  Skin Texture Smoothing
                </span>
                <span className="font-mono tabular-nums text-violet-600 dark:text-violet-400 text-[11px] font-medium">
                  {adjustments.skinTextureSmoothing}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Real-time Gaussian blur mask blends synthetic skin texture with the original image while keeping eyes &amp; lips crisp
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.skinTextureSmoothing}
                onChange={(e) =>
                  updateAdjustments({ skinTextureSmoothing: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments(
                    {},
                    `Skin Texture Smoothing: ${adjustments.skinTextureSmoothing}%`
                  )
                }
                onTouchEnd={() =>
                  updateAdjustments(
                    {},
                    `Skin Texture Smoothing: ${adjustments.skinTextureSmoothing}%`
                  )
                }
                aria-label="Skin Texture Smoothing"
                className="w-full accent-violet-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
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

            {/* Motion Sensitivity: Adaptive Live Swap Quality */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Activity className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Motion Sensitivity
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Automatically adjusts swap quality using lighter processing when camera movement is high
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.motionSensitivity}
                    onChange={(e) =>
                      updateAdjustments(
                        { motionSensitivity: e.target.checked },
                        e.target.checked
                          ? 'Motion Sensitivity Enabled'
                          : 'Motion Sensitivity Disabled'
                      )
                    }
                    aria-label="Toggle Motion Sensitivity"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-amber-500"></div>
                </label>
              </div>

              {adjustments.motionSensitivity && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                  Steady camera uses full HD &amp; bilateral filtering · High motion switches to a lightweight fast pass for frame stability.
                </p>
              )}
            </div>

            {/* Motion Smoothing: Temporal Video Frame Stabilization */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                  Motion Smoothing
                </span>
                <span className="font-mono tabular-nums text-teal-600 dark:text-teal-400 text-[11px] font-medium">
                  {adjustments.motionSmoothing}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Temporal filter across video frames reduces flickering and jitter for smoother playback
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.motionSmoothing}
                onChange={(e) =>
                  updateAdjustments({ motionSmoothing: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Motion Smoothing: ${adjustments.motionSmoothing}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Motion Smoothing: ${adjustments.motionSmoothing}%`)
                }
                aria-label="Motion Smoothing"
                className="w-full accent-teal-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          </>
        )}

        {/* TAB 2: AUTO-MASKING & FINE-TUNE BRUSH */}
        {activeSubTab === 'masking' && (
          <div className="space-y-3">
            {/* Smart Masking: Edge-Detection Boundary Refinement & Anti-Halo */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Smart Masking (Edge-Detection)
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Refines swap boundaries on complex hair & ear transitions to prevent halos
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.smartMasking}
                    onChange={(e) =>
                      updateAdjustments(
                        { smartMasking: e.target.checked },
                        e.target.checked ? 'Smart Masking Enabled' : 'Smart Masking Disabled'
                      )
                    }
                    aria-label="Toggle Smart Masking"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            </div>

            {/* Anti-Aliasing: Post-Processing Cutout Edge Smoothing */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Wand2 className="w-4 h-4 text-cyan-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Anti-Aliasing
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Post-processing filter smooths jagged edges around the face-swap cutout
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={adjustments.antiAliasing}
                    onChange={(e) =>
                      updateAdjustments(
                        { antiAliasing: e.target.checked },
                        e.target.checked ? 'Anti-Aliasing Enabled' : 'Anti-Aliasing Disabled'
                      )
                    }
                    aria-label="Toggle Anti-Aliasing"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-cyan-600"></div>
                </label>
              </div>
            </div>

            {/* Edge Contrast: Local Contrast Enhancement Along Swap/Target Border */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Contrast className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  Edge Contrast
                </span>
                <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400 text-[11px] font-medium">
                  {adjustments.edgeContrast}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Enhances local contrast along the border between the swap and target image for a sharper separation
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.edgeContrast}
                onChange={(e) =>
                  updateAdjustments({ edgeContrast: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Edge Contrast: ${adjustments.edgeContrast}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Edge Contrast: ${adjustments.edgeContrast}%`)
                }
                aria-label="Edge Contrast"
                className="w-full accent-sky-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

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
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
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
          <div className="space-y-3">
            {/* Match Ambient Light Harmonizer Card */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <SunMedium className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      Match Ambient Light
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Harmonizes color temperature and exposure to target scene lighting
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleMatchAmbientLight}
                  disabled={isMatchingLight}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-slate-950 text-xs font-semibold shadow-xs transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isMatchingLight ? 'Analyzing...' : 'Auto-Match'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-[11px]">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adjustments.autoAmbientLight}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      updateAdjustments(
                        { autoAmbientLight: enabled },
                        enabled ? 'Auto Ambient Light Sync Enabled' : 'Auto Ambient Light Sync Disabled'
                      );
                    }}
                    className="accent-amber-500 rounded"
                  />
                  <span>Auto-sync on photo change</span>
                </label>

                {ambientLightReport && (
                  <span className="font-mono tabular-nums text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
                    {ambientLightReport.sceneKelvin}K · {ambientLightReport.lightCondition} ·{' '}
                    {ambientLightReport.exposureShiftEv >= 0
                      ? `+${ambientLightReport.exposureShiftEv}`
                      : ambientLightReport.exposureShiftEv}{' '}
                    EV
                  </span>
                )}
              </div>
            </div>

            {/* Real-Time Lighting Adjustment Slider */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Lighting Adjustment</span>
                </span>
                <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                  {adjustments.lightingAdjustment}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                Matches swapped face brightness and contrast to the original background in real-time
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.lightingAdjustment}
                onChange={(e) =>
                  updateAdjustments({ lightingAdjustment: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments(
                    {},
                    `Lighting Adjustment: ${adjustments.lightingAdjustment}%`
                  )
                }
                onTouchEnd={() =>
                  updateAdjustments(
                    {},
                    `Lighting Adjustment: ${adjustments.lightingAdjustment}%`
                  )
                }
                aria-label="Lighting Adjustment"
                className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>0% Source Face</span>
                <span>50% Balanced</span>
                <span>100% Background Match</span>
              </div>
            </div>

            {/* Shadow Matcher Intensity Slider */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <CloudMoon className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>Shadow Matcher</span>
                </span>
                <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px] font-medium">
                  {adjustments.shadowMatcher}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                Automatically adjusts shadow overlay depth and opacity on the replaced face to match original scene ambient lighting
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.shadowMatcher}
                onChange={(e) =>
                  updateAdjustments({ shadowMatcher: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Shadow Matcher: ${adjustments.shadowMatcher}%`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Shadow Matcher: ${adjustments.shadowMatcher}%`)
                }
                aria-label="Shadow Matcher"
                className="w-full accent-indigo-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>0% Off</span>
                <span>50% Natural</span>
                <span>100% Full Scene Depth</span>
              </div>
            </div>

            {/* Lighting Presets Gallery */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Lighting Presets</span>
                </span>

                <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-900 p-0.5 rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'studio', label: 'Studio' },
                      { id: 'outdoor', label: 'Outdoor' },
                      { id: 'cinematic', label: 'Cinematic' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setPresetCategory(cat.id)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                        presetCategory === cat.id
                          ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {visiblePresets.map((preset) => {
                  const isActive =
                    adjustments.brightness === preset.values.brightness &&
                    adjustments.shadows === preset.values.shadows &&
                    adjustments.contrast === preset.values.contrast &&
                    adjustments.temperature === preset.values.temperature &&
                    adjustments.saturation === preset.values.saturation;

                  const CategoryIcon =
                    preset.category === 'studio'
                      ? Camera
                      : preset.category === 'outdoor'
                      ? Trees
                      : Film;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyLightingPreset(preset)}
                      className={`group text-left p-2 rounded-lg border transition-all flex flex-col gap-1.5 ${
                        isActive
                          ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 shadow-xs'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                      title={`Apply ${preset.name}: ${preset.subtitle}`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div
                          className={`w-6 h-6 rounded-md bg-gradient-to-br ${preset.swatchClass} border border-black/10 dark:border-white/15 shrink-0 flex items-center justify-center`}
                        >
                          {isActive && <Check className="w-3 h-3 text-slate-900 drop-shadow-xs" />}
                        </div>
                        <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                          <CategoryIcon className="w-2.5 h-2.5" />
                          {preset.category}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <span
                          className={`block text-[11px] font-semibold leading-tight truncate ${
                            isActive
                              ? 'text-indigo-700 dark:text-indigo-300'
                              : 'text-slate-800 dark:text-slate-100'
                          }`}
                        >
                          {preset.name}
                        </span>
                        <span className="block text-[9px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {preset.subtitle}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Brightness */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    Brightness
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                    {adjustments.brightness > 0 ? `+${adjustments.brightness}` : adjustments.brightness}
                  </span>
                </div>
                <input
                  type="range"
                  min="-60"
                  max="60"
                  value={adjustments.brightness}
                  onChange={(e) => updateAdjustments({ brightness: Number(e.target.value) })}
                  onMouseUp={() => updateAdjustments({}, `Brightness: ${adjustments.brightness}`)}
                  onTouchEnd={() => updateAdjustments({}, `Brightness: ${adjustments.brightness}`)}
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
                  <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                    {adjustments.shadows > 0 ? `+${adjustments.shadows}` : adjustments.shadows}
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={adjustments.shadows}
                  onChange={(e) => updateAdjustments({ shadows: Number(e.target.value) })}
                  onMouseUp={() => updateAdjustments({}, `Shadow Lift: ${adjustments.shadows}`)}
                  onTouchEnd={() => updateAdjustments({}, `Shadow Lift: ${adjustments.shadows}`)}
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
                  <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                    {adjustments.contrast > 0 ? `+${adjustments.contrast}` : adjustments.contrast}
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={adjustments.contrast}
                  onChange={(e) => updateAdjustments({ contrast: Number(e.target.value) })}
                  onMouseUp={() => updateAdjustments({}, `Contrast: ${adjustments.contrast}`)}
                  onTouchEnd={() => updateAdjustments({}, `Contrast: ${adjustments.contrast}`)}
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
                <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                  {adjustments.temperature > 0 ? `+${adjustments.temperature}` : adjustments.temperature}
                </span>
              </div>
              <input
                type="range"
                min="-40"
                max="40"
                value={adjustments.temperature}
                onChange={(e) => updateAdjustments({ temperature: Number(e.target.value) })}
                onMouseUp={() => updateAdjustments({}, `Warmth: ${adjustments.temperature}`)}
                onTouchEnd={() => updateAdjustments({}, `Warmth: ${adjustments.temperature}`)}
                className="w-full accent-orange-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Color Correction Section (Saturation, Hue, Vibrance) */}
            <div className="sm:col-span-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    Color Correction
                  </span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    Fine-tune Saturation, Hue, and Vibrance to match the source image color profile
                  </span>
                </div>

                {(adjustments.saturation !== 0 ||
                  adjustments.hue !== 0 ||
                  adjustments.vibrance !== 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      updateAdjustments(
                        { saturation: 0, hue: 0, vibrance: 0 },
                        'Color Correction Reset'
                      )
                    }
                    className="text-[10px] font-medium text-rose-500 hover:text-rose-400 whitespace-nowrap shrink-0"
                  >
                    Reset Color
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                {/* Saturation */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Saturation
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                      {adjustments.saturation > 0
                        ? `+${adjustments.saturation}`
                        : adjustments.saturation}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={adjustments.saturation}
                    onChange={(e) =>
                      updateAdjustments({ saturation: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments({}, `Saturation: ${adjustments.saturation}`)
                    }
                    onTouchEnd={() =>
                      updateAdjustments({}, `Saturation: ${adjustments.saturation}`)
                    }
                    aria-label="Saturation"
                    className="w-full accent-rose-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Hue */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Hue
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                      {adjustments.hue > 0 ? `+${adjustments.hue}°` : `${adjustments.hue}°`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={adjustments.hue}
                    onChange={(e) =>
                      updateAdjustments({ hue: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments({}, `Hue: ${adjustments.hue}°`)
                    }
                    onTouchEnd={() =>
                      updateAdjustments({}, `Hue: ${adjustments.hue}°`)
                    }
                    aria-label="Hue"
                    className="w-full accent-violet-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Vibrance */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Vibrance
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 text-[11px]">
                      {adjustments.vibrance > 0
                        ? `+${adjustments.vibrance}`
                        : adjustments.vibrance}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={adjustments.vibrance}
                    onChange={(e) =>
                      updateAdjustments({ vibrance: Number(e.target.value) })
                    }
                    onMouseUp={() =>
                      updateAdjustments({}, `Vibrance: ${adjustments.vibrance}`)
                    }
                    onTouchEnd={() =>
                      updateAdjustments({}, `Vibrance: ${adjustments.vibrance}`)
                    }
                    aria-label="Vibrance"
                    className="w-full accent-fuchsia-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Soft Bloom (Cinematic Skin Highlight Glow) */}
            <div className="sm:col-span-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  Soft Bloom
                </span>
                <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                  {adjustments.softBloom}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-1.5">
                Adds a subtle halation glow to skin highlights for a polished cinematic finish
              </p>
              <input
                type="range"
                min="0"
                max="100"
                value={adjustments.softBloom}
                onChange={(e) => updateAdjustments({ softBloom: Number(e.target.value) })}
                onMouseUp={() => updateAdjustments({}, `Soft Bloom: ${adjustments.softBloom}%`)}
                onTouchEnd={() => updateAdjustments({}, `Soft Bloom: ${adjustments.softBloom}%`)}
                aria-label="Soft Bloom"
                className="w-full accent-amber-400 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
            </div>
          </div>
        )}

        {/* TAB 4: ALIGNMENT & TRANSFORM */}
        {activeSubTab === 'transform' && (
          <div className="space-y-3">
            {/* Face Scale */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">Face Scale</span>
                <span className="font-mono tabular-nums text-slate-500 text-[11px]">
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
                onMouseUp={() => updateAdjustments({}, `Face Scale: ${Math.round(adjustments.scale * 100)}%`)}
                onTouchEnd={() => updateAdjustments({}, `Face Scale: ${Math.round(adjustments.scale * 100)}%`)}
                aria-label="Face Scale"
                className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Head Rotation (Pitch, Yaw, Roll Orientation) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Head Rotation
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Manually correct pitch, yaw &amp; roll when ML detection is off-axis
                  </p>
                </div>
                {((adjustments.headPitch ?? 0) !== 0 ||
                  (adjustments.headYaw ?? 0) !== 0 ||
                  adjustments.rotation !== 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      updateAdjustments(
                        { headPitch: 0, headYaw: 0, rotation: 0 },
                        'Reset Head Rotation'
                      )
                    }
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Pitch */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Pitch <span className="text-[10px] text-slate-400 font-normal">(Up / Down)</span>
                  </span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px]">
                    {(adjustments.headPitch ?? 0) > 0 ? `+${adjustments.headPitch}` : adjustments.headPitch ?? 0}°
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={adjustments.headPitch ?? 0}
                  onChange={(e) => updateAdjustments({ headPitch: Number(e.target.value) })}
                  onMouseUp={() =>
                    updateAdjustments({}, `Head Pitch: ${adjustments.headPitch ?? 0}°`)
                  }
                  onTouchEnd={() =>
                    updateAdjustments({}, `Head Pitch: ${adjustments.headPitch ?? 0}°`)
                  }
                  aria-label="Head Pitch"
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Yaw */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Yaw <span className="text-[10px] text-slate-400 font-normal">(Left / Right)</span>
                  </span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px]">
                    {(adjustments.headYaw ?? 0) > 0 ? `+${adjustments.headYaw}` : adjustments.headYaw ?? 0}°
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={adjustments.headYaw ?? 0}
                  onChange={(e) => updateAdjustments({ headYaw: Number(e.target.value) })}
                  onMouseUp={() =>
                    updateAdjustments({}, `Head Yaw: ${adjustments.headYaw ?? 0}°`)
                  }
                  onTouchEnd={() =>
                    updateAdjustments({}, `Head Yaw: ${adjustments.headYaw ?? 0}°`)
                  }
                  aria-label="Head Yaw"
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Roll */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Roll <span className="text-[10px] text-slate-400 font-normal">(Tilt)</span>
                  </span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 text-[11px]">
                    {adjustments.rotation > 0 ? `+${adjustments.rotation}` : adjustments.rotation}°
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={adjustments.rotation}
                  onChange={(e) => updateAdjustments({ rotation: Number(e.target.value) })}
                  onMouseUp={() =>
                    updateAdjustments({}, `Head Roll: ${adjustments.rotation}°`)
                  }
                  onTouchEnd={() =>
                    updateAdjustments({}, `Head Roll: ${adjustments.rotation}°`)
                  }
                  aria-label="Head Roll"
                  className="w-full accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Gender Morph (Jawline & Brow Ridge Prominence) */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-500 shrink-0" />
                  Gender Morph
                </span>
                <span className="font-mono tabular-nums text-fuchsia-600 dark:text-fuchsia-400 text-[11px] font-medium">
                  {adjustments.genderMorph === 0
                    ? 'Neutral (0)'
                    : adjustments.genderMorph > 0
                    ? `Define (+${adjustments.genderMorph})`
                    : `Soften (${adjustments.genderMorph})`}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">
                Subtly adjusts jawline &amp; brow ridge prominence when swapping faces across different features
              </p>
              <input
                type="range"
                min="-100"
                max="100"
                value={adjustments.genderMorph}
                onChange={(e) =>
                  updateAdjustments({ genderMorph: Number(e.target.value) })
                }
                onMouseUp={() =>
                  updateAdjustments({}, `Gender Morph: ${adjustments.genderMorph}`)
                }
                onTouchEnd={() =>
                  updateAdjustments({}, `Gender Morph: ${adjustments.genderMorph}`)
                }
                aria-label="Gender Morph"
                className="w-full accent-fuchsia-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                <span>Softer Jaw &amp; Brow</span>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ genderMorph: 0 }, 'Gender Morph: Neutral')}
                  className="text-fuchsia-600 dark:text-fuchsia-400 hover:underline font-medium"
                >
                  Reset Neutral
                </button>
                <span>Defined Jaw &amp; Brow</span>
              </div>
            </div>

            {/* Show Face Landmarks Wireframe Grid Toggle */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Show Face Landmarks
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Overlays a real-time wireframe grid on the detected face for precise adjustment visualization
                </span>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={adjustments.showFaceLandmarks}
                  onChange={(e) =>
                    updateAdjustments(
                      { showFaceLandmarks: e.target.checked },
                      e.target.checked
                        ? 'Face Landmarks Wireframe Shown'
                        : 'Face Landmarks Wireframe Hidden'
                    )
                  }
                  aria-label="Show Face Landmarks"
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-sky-500"></div>
              </label>
            </div>

            {/* Geometric Landmark Mesh & Manual Alignment Toggle */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
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
                type="button"
                onClick={() =>
                  updateAdjustments({ showGeometricMesh: !adjustments.showGeometricMesh })
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  adjustments.showGeometricMesh
                    ? 'bg-cyan-600 text-white shadow-xs'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {adjustments.showGeometricMesh ? 'Mesh Active' : 'Show Mesh'}
              </button>
            </div>

            {/* Auto-Refocus Trigger & Sudden-Shift Tracking */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Auto-Refocus
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Re-centers camera bounding box on the largest detected face on sudden subject shifts
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label
                  className="relative inline-flex items-center cursor-pointer"
                  title="Automatically re-center bounding box on sudden subject shifts"
                >
                  <input
                    type="checkbox"
                    checked={adjustments.autoRefocus}
                    onChange={(e) =>
                      updateAdjustments(
                        { autoRefocus: e.target.checked },
                        e.target.checked ? 'Auto-Refocus Enabled' : 'Auto-Refocus Disabled'
                      )
                    }
                    aria-label="Auto-Refocus on shift"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-cyan-600"></div>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    if (!adjustments.autoRefocus) {
                      updateAdjustments({ autoRefocus: true }, 'Auto-Refocus Enabled');
                    }
                    triggerAutoRefocus();
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 bg-cyan-600 hover:bg-cyan-500 text-white shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  <span>Auto-Refocus</span>
                </button>
              </div>
            </div>

            {/* Micro Alignment Nudge Pad */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Move className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  Position Nudge
                </span>
                <span className="text-[10px] text-slate-500 font-mono tabular-nums truncate">
                  ({adjustments.offsetX}px, {adjustments.offsetY}px)
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetX: adjustments.offsetX - 3 })}
                  aria-label="Nudge left"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetX: adjustments.offsetX + 3 })}
                  aria-label="Nudge right"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetY: adjustments.offsetY - 3 })}
                  aria-label="Nudge up"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetY: adjustments.offsetY + 3 })}
                  aria-label="Nudge down"
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => updateAdjustments({ offsetX: 0, offsetY: 0 })}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
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
