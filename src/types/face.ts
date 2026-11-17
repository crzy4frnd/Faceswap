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
  estimatedAge?: number;
  expression?: 'Smiling' | 'Laughing' | 'Neutral' | 'Focused' | 'Surprised';
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

export interface SkinReferenceSample {
  normX: number; // 0..1 normalized target image X coordinate
  normY: number; // 0..1 normalized target image Y coordinate
  radiusRatio: number; // sampling circle radius ratio relative to min(width, height)
  r: number; // baseline sampled RGB (0..255)
  g: number;
  b: number;
  stdR: number;
  stdG: number;
  stdB: number;
}

export interface FaceAdjustments {
  swapStrength: number; // 0 - 100
  skinToneMatch: boolean; // auto skin tone color matching
  skinToneStrength: number; // 0 - 100
  skinReference?: SkinReferenceSample | null; // manual target-body baseline color reference
  featherRadius: number; // 2 - 50 px
  edgeSoftness: number; // 0 - 100% feathering intensity of the face mask
  brightness: number; // -100 to +100
  contrast: number; // -100 to +100
  shadows: number; // -100 to +100
  temperature: number; // -100 to +100 (warmth)
  saturation: number; // -100 to +100
  hue: number; // -180 to +180 deg hue shift
  vibrance: number; // -100 to +100 intelligent skin-safe saturation boost
  scale: number; // 0.8 - 1.2
  rotation: number; // -30 to +30 deg (head roll)
  headPitch: number; // -30 to +30 deg (vertical tilt up/down)
  headYaw: number; // -30 to +30 deg (horizontal turn left/right)
  offsetX: number; // -50 to +50 px
  offsetY: number; // -50 to +50 px
  edgeSmoothing: 'soft' | 'natural' | 'sharp';
  // Hair & Accessory Auto-Masking & Fine-Tune Brush
  smartMasking: boolean; // edge-detection swap boundary refinement & anti-halo decontamination
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
  skinSmoothing: number; // 0 - 100% real-time edge-preserving bilateral filter
  skinTextureSmoothing: number; // 0 - 100% blur-masking noise reduction preserving facial edges
  autoAmbientLight: boolean; // auto-harmonize exposure & color temperature to target light source
  // Geometric Mesh, Wireframe Landmarks & Manual Landmark Nudge
  showFaceLandmarks: boolean; // overlay real-time wireframe grid on detected face for adjustment visualization
  showGeometricMesh: boolean; // display geometric mesh overlay for manual landmark alignment
  // Adaptive Motion-Aware Swap Quality
  motionSensitivity: boolean; // automatically scale down swap processing intensity during high camera motion
  // Real-time Background Brightness & Contrast Matching
  lightingAdjustment: number; // 0 - 100% real-time brightness & contrast match to target background
  // Ambient Scene Shadow Overlay Depth & Opacity Matching
  shadowMatcher: number; // 0 - 100% adjusts depth & opacity of shadow overlays to match scene ambient lighting
  // Cinematic Skin Highlight Glow
  softBloom: number; // 0 - 100% subtle bloom glow on skin highlights
  // Subject Tracking Camera Refocus
  autoRefocus: boolean; // auto re-center bounding box on largest face on sudden subject shift
  // Post-Processing Cutout Edge Anti-Aliasing
  antiAliasing: boolean; // post-processing FXAA-style filter to smooth jagged cutout edges
  // Cross-Feature Jawline & Brow Ridge Morphing
  genderMorph: number; // -100 (softer/tapered) to +100 (stronger/defined) jaw & brow prominence
  // Border Local Contrast Separation
  edgeContrast: number; // 0 - 100% local contrast enhancement along the swap-to-target border
  // Temporal Video Frame Stabilization
  motionSmoothing: number; // 0 - 100% temporal filter across video frames to reduce jitter & flicker
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
  motionLevel?: 'low' | 'medium' | 'high';
  qualityMode?: 'high' | 'balanced' | 'light';
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
  headPitch?: number;
  headYaw?: number;
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
  // Synced Studio Tone, Lighting & Smoothing Adjustments
  brightness?: number;
  contrast?: number;
  temperature?: number;
  saturation?: number;
  hue?: number;
  vibrance?: number;
  skinSmoothing?: number;
  motionSensitivity?: boolean;
  lightingAdjustment?: number;
  shadowMatcher?: number;
  softBloom?: number;
  autoRefocus?: boolean;
  antiAliasing?: boolean;
  genderMorph?: number;
  edgeContrast?: number;
  motionSmoothing?: number;
  edgeSoftness?: number;
  // Capture Mode
  captureMode: 'photo' | 'video';
}
