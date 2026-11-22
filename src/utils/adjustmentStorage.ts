import { FaceAdjustments, LayerBlendMode } from '../types/face';
import { DEFAULT_ADJUSTMENTS } from './sampleData';

export type AdjustmentSubTab = 'blend' | 'masking' | 'lighting' | 'transform';
export type LightingPresetCategory = 'all' | 'studio' | 'outdoor' | 'cinematic';

export interface AdjustmentPanelUIState {
  activeSubTab: AdjustmentSubTab;
  presetCategory: LightingPresetCategory;
}

const ADJUSTMENTS_STORAGE_KEY = 'facemorph_adjustments_v1';
const PANEL_UI_STORAGE_KEY = 'facemorph_adjustment_panel_ui_v1';

const VALID_SUB_TABS: readonly AdjustmentSubTab[] = [
  'blend',
  'masking',
  'lighting',
  'transform',
];
const VALID_PRESET_CATEGORIES: readonly LightingPresetCategory[] = [
  'all',
  'studio',
  'outdoor',
  'cinematic',
];
const VALID_EDGE_SMOOTHING = ['soft', 'natural', 'sharp'] as const;
const VALID_BRUSH_MODES = ['none', 'protect', 'reveal'] as const;
const VALID_BLEND_MODES: readonly LayerBlendMode[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
];

const NUMERIC_BOUNDS: Partial<Record<keyof FaceAdjustments, [number, number]>> = {
  swapStrength: [0, 100],
  skinToneStrength: [0, 100],
  featherRadius: [2, 60],
  edgeSoftness: [0, 100],
  boundaryRefinementStrength: [0, 100],
  boundaryStabilizerFrames: [3, 5],
  brightness: [-100, 100],
  contrast: [-100, 100],
  shadows: [-100, 100],
  temperature: [-100, 100],
  saturation: [-100, 100],
  hue: [-180, 180],
  vibrance: [-100, 100],
  globalColorHarmony: [0, 100],
  scale: [0.5, 1.8],
  rotation: [-45, 45],
  headPitch: [-30, 30],
  headYaw: [-30, 30],
  offsetX: [-120, 120],
  offsetY: [-120, 120],
  minAngleMatchScore: [85, 100],
  depthThreshold: [20, 90],
  maskSensitivity: [0, 100],
  brushSize: [4, 120],
  brushFeather: [0, 100],
  smartBlendIntensity: [0, 100],
  skinTextureSyncStrength: [0, 100],
  textureDenoise: [0, 100],
  skinSmoothing: [0, 100],
  skinTextureSmoothing: [0, 100],
  lightingAdjustment: [0, 100],
  shadowMatcher: [0, 100],
  softBloom: [0, 100],
  genderMorph: [-100, 100],
  ageProgression: [0, 100],
  edgeContrast: [0, 100],
  motionSmoothing: [0, 100],
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function loadSavedAdjustments(): FaceAdjustments {
  const defaults: FaceAdjustments = { ...DEFAULT_ADJUSTMENTS };
  if (typeof window === 'undefined') return defaults;

  try {
    const raw = window.localStorage.getItem(ADJUSTMENTS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return defaults;

    const restored: Record<string, unknown> = { ...defaults };

    for (const key of Object.keys(defaults) as (keyof FaceAdjustments)[]) {
      const candidate = parsed[key];
      const defaultVal = defaults[key];

      if (key === 'edgeSmoothing') {
        if (
          typeof candidate === 'string' &&
          (VALID_EDGE_SMOOTHING as readonly string[]).includes(candidate)
        ) {
          restored[key] = candidate;
        }
        continue;
      }

      if (key === 'brushMode') {
        if (
          typeof candidate === 'string' &&
          (VALID_BRUSH_MODES as readonly string[]).includes(candidate)
        ) {
          restored[key] = candidate;
        }
        continue;
      }

      if (key === 'isolatedLayerId') {
        restored[key] = null;
        continue;
      }

      if (key === 'skinReference') {
        if (candidate && typeof candidate === 'object') {
          const s = candidate as Record<string, unknown>;
          const nums = [s.normX, s.normY, s.radiusRatio, s.r, s.g, s.b, s.stdR, s.stdG, s.stdB];
          if (nums.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            restored[key] = {
              normX: clamp(s.normX as number, 0, 1),
              normY: clamp(s.normY as number, 0, 1),
              radiusRatio: clamp(s.radiusRatio as number, 0.01, 0.12),
              r: clamp(s.r as number, 0, 255),
              g: clamp(s.g as number, 0, 255),
              b: clamp(s.b as number, 0, 255),
              stdR: clamp(s.stdR as number, 4, 80),
              stdG: clamp(s.stdG as number, 4, 80),
              stdB: clamp(s.stdB as number, 4, 80),
            };
          }
        } else {
          restored[key] = null;
        }
        continue;
      }

      if (key === 'hiddenCutoutLayerIds' || key === 'cutoutLayerOrder') {
        if (Array.isArray(candidate)) {
          const seen = new Set<string>();
          const clean: string[] = [];
          for (const item of candidate) {
            if (typeof item === 'string' && !seen.has(item)) {
              seen.add(item);
              clean.push(item);
            }
          }
          restored[key] = clean;
        }
        continue;
      }

      if (key === 'cutoutLayerOpacities') {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          const cleanMap: Record<string, number> = {};
          for (const [layerId, opVal] of Object.entries(candidate as Record<string, unknown>)) {
            if (typeof opVal === 'number' && Number.isFinite(opVal)) {
              cleanMap[layerId] = Math.round(clamp(opVal, 0, 100));
            }
          }
          restored[key] = cleanMap;
        }
        continue;
      }

      if (key === 'cutoutLayerBlendModes') {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          const cleanModes: Record<string, LayerBlendMode> = {};
          for (const [layerId, modeVal] of Object.entries(candidate as Record<string, unknown>)) {
            if (
              typeof modeVal === 'string' &&
              (VALID_BLEND_MODES as readonly string[]).includes(modeVal)
            ) {
              cleanModes[layerId] = modeVal as LayerBlendMode;
            }
          }
          restored[key] = cleanModes;
        }
        continue;
      }

      if (key === 'targetLightingFilter') {
        if (candidate && typeof candidate === 'object') {
          const f = candidate as Record<string, unknown>;
          const nums = [
            f.sourceKelvin,
            f.sourceIntensity,
            f.targetKelvin,
            f.targetIntensity,
            f.brightnessShift,
            f.contrastScale,
            f.temperatureShift,
            f.saturateScale,
          ];
          if (typeof f.enabled === 'boolean' && nums.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            restored[key] = {
              enabled: f.enabled,
              sourceKelvin: Math.round(clamp(f.sourceKelvin as number, 2200, 9500)),
              sourceIntensity: Math.round(clamp(f.sourceIntensity as number, 0, 100)),
              targetKelvin: Math.round(clamp(f.targetKelvin as number, 2200, 9500)),
              targetIntensity: Math.round(clamp(f.targetIntensity as number, 0, 100)),
              brightnessShift: Math.round(clamp(f.brightnessShift as number, -45, 45)),
              contrastScale: Math.round(clamp(f.contrastScale as number, 0.72, 1.35) * 100) / 100,
              temperatureShift: Math.round(clamp(f.temperatureShift as number, -45, 45)),
              saturateScale: Math.round(clamp(f.saturateScale as number, 0.78, 1.25) * 100) / 100,
            };
          } else {
            restored[key] = null;
          }
        } else {
          restored[key] = null;
        }
        continue;
      }

      if (typeof defaultVal === 'boolean' && typeof candidate === 'boolean') {
        restored[key] = candidate;
      } else if (
        typeof defaultVal === 'number' &&
        typeof candidate === 'number' &&
        Number.isFinite(candidate)
      ) {
        const bounds = NUMERIC_BOUNDS[key];
        restored[key] = bounds ? clamp(candidate, bounds[0], bounds[1]) : candidate;
      }
    }

    return restored as unknown as FaceAdjustments;
  } catch {
    return defaults;
  }
}

export function saveAdjustmentsToStorage(adjustments: FaceAdjustments): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ADJUSTMENTS_STORAGE_KEY, JSON.stringify(adjustments));
  } catch {
    // ignore quota or privacy mode errors
  }
}

export function loadSavedPanelUIState(): AdjustmentPanelUIState {
  const defaults: AdjustmentPanelUIState = {
    activeSubTab: 'blend',
    presetCategory: 'all',
  };
  if (typeof window === 'undefined') return defaults;

  try {
    const raw = window.localStorage.getItem(PANEL_UI_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AdjustmentPanelUIState>;
    if (!parsed || typeof parsed !== 'object') return defaults;

    return {
      activeSubTab: VALID_SUB_TABS.includes(parsed.activeSubTab as AdjustmentSubTab)
        ? (parsed.activeSubTab as AdjustmentSubTab)
        : defaults.activeSubTab,
      presetCategory: VALID_PRESET_CATEGORIES.includes(
        parsed.presetCategory as LightingPresetCategory
      )
        ? (parsed.presetCategory as LightingPresetCategory)
        : defaults.presetCategory,
    };
  } catch {
    return defaults;
  }
}

export function savePanelUIState(state: AdjustmentPanelUIState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PANEL_UI_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}
