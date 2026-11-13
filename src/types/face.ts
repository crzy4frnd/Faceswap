export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceLandmarks {
  leftEye: Point;
  rightEye: Point;
  nose: Point;
  mouthLeft: Point;
  mouthRight: Point;
  mouthCenter: Point;
  chin: Point;
  forehead: Point;
  jawline: Point[];
  contour: Point[];
}

export interface DetectedFace {
  id: string;
  box: Rect;
  landmarks: FaceLandmarks;
  originalLandmarks?: FaceLandmarks; // pristine detected coordinates for instant reset
  isLandmarksEdited?: boolean;
  confidence: number;
  assignedProfileId?: string; // which face profile is mapped to this detected face
  enabled: boolean; // whether face swap is enabled for this detected face
  individualStrength?: number; // 0-100%
  yaw?: number;
  pitch?: number;
  roll?: number;
}

export interface FaceProfile {
  id: string;
  name: string;
  avatarUrl: string; // cutout transparent PNG or crop
  fullImageUrl: string;
  detectedLandmarks?: FaceLandmarks;
  dateAdded: string;
  isBuiltIn?: boolean;
  tags?: string[];
  genderEstimate?: 'female' | 'male' | 'neutral';
}

export interface FaceAdjustments {
  swapStrength: number; // 0 - 100
  skinToneMatch: boolean; // auto skin tone color matching
  skinToneStrength: number; // 0 - 100
  featherRadius: number; // 2 - 50 px
  brightness: number; // -100 to +100
  contrast: number; // -100 to +100
  shadows: number; // -100 to +100
  temperature: number; // -100 to +100 (warmth)
  saturation: number; // -100 to +100
  scale: number; // 0.8 - 1.2
  rotation: number; // -20 to +20 deg
  offsetX: number; // -50 to +50 px
  offsetY: number; // -50 to +50 px
  edgeSmoothing: 'soft' | 'natural' | 'sharp';
  // Hair & Accessory Auto-Masking & Fine-Tune Brush
  autoMaskHair: boolean; // auto-detect hair & bangs
  autoMaskAccessories: boolean; // auto-detect glasses, hats, jewelry
  maskSensitivity: number; // 0 - 100%
  showMaskOverlay: boolean; // visualize mask in rubylith/cyan
  brushMode: 'none' | 'protect' | 'reveal'; // manual fine-tune brush
  brushSize: number; // 5 - 80 px
  brushFeather: number; // 0 - 100%
  // Dynamic Skin Texture Topology Smart Blend
  smartBlend: boolean; // dynamic boundary texture & topology feathering
  smartBlendIntensity: number; // 0 - 100%
  textureMatching: boolean; // pore and grain frequency preservation
  // Geometric Mesh & Manual Landmark Nudge
  showGeometricMesh: boolean; // display geometric mesh overlay for manual landmark alignment
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  action: string;
  adjustments: FaceAdjustments;
  assignedFaces: Record<string, string>; // detectedFaceId -> profileId
}

export interface BatchItem {
  id: string;
  imageUrl: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  resultUrl?: string;
  facesDetected?: number;
  progress: number;
}

export type ExportFormat = 'png' | 'tiff' | 'jpeg';
export type ExportResolution = '1x' | '2x' | '4x';

export interface LiveTrackingState {
  fps: number;
  latencyMs: number;
  faceDetected: boolean;
  roll: number;
  pitch: number;
  yaw: number;
  smileScore: number;
  eyeOpenScore: number;
  box?: Rect;
}

export interface LiveCameraConfig {
  swapStrength: number;
  skinToneMatch: boolean;
  featherRadius: number;
  expressionWarp: number; // 0-100%
  showLandmarkMesh: boolean;
  splitPreview: boolean;
  splitPos: number; // 0-100%
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  expressionPreset: 'natural' | 'smile' | 'neutral' | 'vocal';
  // Live Background Removal & Replacement
  removeBackground: boolean;
  activeBackgroundId: 'none' | 'studio' | 'neon' | 'sunset' | 'green' | 'custom';
  customBackgroundUrl?: string;
  // Live Facial & Body Unwanted Hair / Blemish Removal
  removeHairAndBlemishes: boolean;
  hairRemovalIntensity: number; // 0 - 100%
  // Live Wardrobe & Jewelry Try-on
  wearClothes: boolean;
  wearJewelry: boolean;
  selectedClothingId: string;
  selectedJewelryId: string;
  // Capture Mode
  captureMode: 'photo' | 'video';
}
