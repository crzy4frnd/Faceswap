import { FaceProfile, LayerBlendMode, SkinReferenceSample, TargetLightingFilter } from '../types/face';
import portraitSingleUrl from '../assets/images/portrait_target_single_1794415666287.jpg';
import portraitDuoUrl from '../assets/images/portrait_target_duo_1794415666938.jpg';
import portraitGroupUrl from '../assets/images/portrait_target_group_1794415667821.jpg';

export interface SampleTarget {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  faceCount: number;
}

export const SAMPLE_TARGETS: SampleTarget[] = [
  {
    id: 'sample-single',
    title: 'Studio Portrait',
    subtitle: 'High-detail studio lighting · 1 Person',
    url: portraitSingleUrl,
    faceCount: 1,
  },
  {
    id: 'sample-duo',
    title: 'Urban Café Duo',
    subtitle: 'Natural daylight · 2 People',
    url: portraitDuoUrl,
    faceCount: 2,
  },
  {
    id: 'sample-group',
    title: 'Park Friends Group',
    subtitle: 'Outdoor sunny afternoon · 3 People',
    url: portraitGroupUrl,
    faceCount: 3,
  },
];

// No preloaded dummy faces — users add faces directly from Gallery or Camera
export const INITIAL_FACE_PROFILES: FaceProfile[] = [];

export const DEFAULT_ADJUSTMENTS = {
  swapStrength: 92,
  skinToneMatch: true,
  skinToneStrength: 85,
  skinReference: null as SkinReferenceSample | null,
  featherRadius: 22,
  brightness: 0,
  contrast: 10,
  shadows: 4,
  temperature: 2,
  saturation: 0,
  hue: 0,
  vibrance: 8,
  globalColorHarmony: 0,
  scale: 1.0,
  rotation: 0,
  headPitch: 0,
  headYaw: 0,
  offsetX: 0,
  offsetY: 0,
  flipHorizontal: false,
  autoMatchAngle: true,
  minAngleMatchScore: 96,
  edgeSmoothing: 'natural' as const,
  smartMasking: true,
  smartCleanup: false,
  autoMaskHair: true,
  autoMaskAccessories: true,
  autoMaskObjects: true,
  preserveTargetLayers: true,
  showBackgroundLayer: true,
  showFaceLayer: true,
  showForeLayers: true,
  hiddenCutoutLayerIds: [] as string[],
  cutoutLayerOpacities: {} as Record<string, number>,
  cutoutLayerOrder: [] as string[],
  cutoutLayerBlendModes: {} as Record<string, LayerBlendMode>,
  batchExportMasks: false,
  targetLightingFilter: null as TargetLightingFilter | null,
  previewSegmentation: false,
  depthMappingEnabled: true,
  depthThreshold: 52,
  maskSensitivity: 70,
  showMaskOverlay: false,
  brushMode: 'none' as const,
  brushSize: 28,
  brushFeather: 40,
  smartBlend: true,
  smartBlendIntensity: 80,
  textureMatching: true,
  skinTextureSync: true,
  skinTextureSyncStrength: 75,
  textureDenoise: 18,
  skinSmoothing: 10,
  skinTextureSmoothing: 8,
  autoAmbientLight: false,
  showFaceLandmarks: false,
  showGeometricMesh: false,
  showAngleGuide: false,
  showOcclusionHeatmap: false,
  isolatedLayerId: null as string | null,
  motionSensitivity: true,
  motionBlur: false,
  lightingAdjustment: 28,
  shadowMatcher: 34,
  softBloom: 6,
  autoRefocus: true,
  antiAliasing: true,
  genderMorph: 0,
  ageProgression: 0,
  edgeContrast: 0,
  motionSmoothingEnabled: true,
  motionSmoothing: 35,
  edgeSoftness: 42,
  boundaryRefinement: true,
  boundaryRefinementStrength: 78,
  boundaryTemporalStabilizer: true,
  boundaryStabilizerFrames: 4,
};
