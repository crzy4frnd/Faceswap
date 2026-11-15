import { FaceProfile } from '../types/face';
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
  featherRadius: 22,
  edgeSoftness: 50,
  brightness: 0,
  contrast: 6,
  shadows: 4,
  temperature: 2,
  saturation: 0,
  hue: 0,
  vibrance: 0,
  scale: 1.0,
  rotation: 0,
  headPitch: 0,
  headYaw: 0,
  offsetX: 0,
  offsetY: 0,
  edgeSmoothing: 'natural' as const,
  smartMasking: true,
  autoMaskHair: true,
  autoMaskAccessories: true,
  maskSensitivity: 70,
  showMaskOverlay: false,
  brushMode: 'none' as const,
  brushSize: 28,
  brushFeather: 40,
  smartBlend: true,
  smartBlendIntensity: 80,
  textureMatching: true,
  skinSmoothing: 30,
  skinTextureSmoothing: 25,
  autoAmbientLight: false,
  showFaceLandmarks: false,
  showGeometricMesh: false,
  motionSensitivity: true,
  lightingAdjustment: 40,
  shadowMatcher: 50,
  softBloom: 15,
  autoRefocus: true,
  antiAliasing: true,
  genderMorph: 0,
  edgeContrast: 0,
  motionSmoothing: 35,
};
