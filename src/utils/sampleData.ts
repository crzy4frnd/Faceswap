import { FaceProfile } from '../types/face';
import portraitSingleUrl from '../assets/images/portrait_target_single_1794415666287.jpg';
import portraitDuoUrl from '../assets/images/portrait_target_duo_1794415666938.jpg';
import portraitGroupUrl from '../assets/images/portrait_target_group_1794415667821.jpg';
import sourceProfileAUrl from '../assets/images/source_face_profile_a_1794415668450.jpg';
import sourceProfileBUrl from '../assets/images/source_face_profile_b_1794415669004.jpg';

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

export const INITIAL_FACE_PROFILES: FaceProfile[] = [
  {
    id: 'profile-elena',
    name: 'Elena Vance',
    avatarUrl: sourceProfileAUrl,
    fullImageUrl: sourceProfileAUrl,
    dateAdded: '2026-11-10',
    isBuiltIn: true,
    tags: ['Studio', 'Frontal', 'Soft Light'],
    genderEstimate: 'female',
  },
  {
    id: 'profile-maya',
    name: 'Maya Lin',
    avatarUrl: sourceProfileBUrl,
    fullImageUrl: sourceProfileBUrl,
    dateAdded: '2026-11-11',
    isBuiltIn: true,
    tags: ['High Contrast', 'Sharp Contours', 'Beauty'],
    genderEstimate: 'female',
  },
];

export const DEFAULT_ADJUSTMENTS = {
  swapStrength: 92,
  skinToneMatch: true,
  skinToneStrength: 85,
  featherRadius: 22,
  brightness: 0,
  contrast: 6,
  shadows: 4,
  temperature: 2,
  saturation: 0,
  scale: 1.0,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  edgeSmoothing: 'natural' as const,
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
  showGeometricMesh: false,
};
