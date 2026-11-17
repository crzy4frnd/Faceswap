import { FaceAdjustments } from '../types/face';
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

const NUMERIC_BOUNDS: Partial<Record<keyof FaceAdjustments, [number, number]>> = {
  swapStrength: [0, 100],
  skinToneStrength: [0, 100],
  featherRadius: [2, 60],
  edgeSoftness: [0, 100],
  brightness: [-100, 100],
  contrast: [-100, 100],
  shadows: [-100, 100],
  temperature: [-100, 100],
  saturation: [-100, 100],
  hue: [-180, 180],
  vibrance: [-100, 100],
  scale: [0.5, 1.8],
  rotation: [-45, 45],
  headPitch: [-30, 30],
  headYaw: [-30, 30],
  offsetX: [-120, 120],
  offsetY: [-120, 120],
  maskSensitivity: [0, 100],
  brushSize: [4, 120],
  brushFeather: [0, 100],
  smartBlendIntensity: [0, 100],
  skinSmoothing: [0, 100],
  skinTextureSmoothing: [0, 100],
  lightingAdjustment: [0, 100],
  shadowMatcher: [0, 100],
  softBloom: [0, 100],
  genderMorph: [-100, 100],
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
