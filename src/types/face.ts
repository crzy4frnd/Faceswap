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

export type FaceAngleBucket =
  | 'front'
  | 'left-slight'
  | 'right-slight'
  | 'left-3quarter'
  | 'right-3quarter'
  | 'left-profile'
  | 'right-profile'
  | 'tilt-up'
  | 'tilt-down';

export interface FaceAngleVariant {
  id: string;
  label: string;
  bucket: FaceAngleBucket;
  avatarUrl: string;
  fullImageUrl: string;
  yaw: number; // -45..+45 deg
  pitch: number; // -30..+30 deg
  roll: number; // -30..+30 deg
  detectedLandmarks?: FaceLandmarks;
  visualSignature: number[]; // compact normalized 8x8 grayscale vector for duplicate prevention
  aspectRatio: number;
  dateAdded: string;
  sourceTag?: string;
}

export interface DuplicateAngleCheckResult {
  isDuplicate: boolean;
  reason?: string;
  existingAngle?: FaceAngleVariant;
  similarityPct: number;
}

export interface FaceAngleMatchResult {
  profileId: string;
  angleId: string | null;
  angleLabel: string;
  matchScore: number; // 0 - 100
  isMatch96To100: boolean;
  shouldFlip: boolean;
  yawDelta: number;
  pitchDelta: number;
  rollDelta: number;
  targetYaw: number;
  targetPitch: number;
  targetRoll: number;
  requiredAngleLabel: string;
  requiredBucket: FaceAngleBucket;
}

export interface DetectedFace {
  id: string;
  box: Rect;
  landmarks: FaceLandmarks;
  originalLandmarks?: FaceLandmarks; // pristine detected coordinates for instant reset
  isLandmarksEdited?: boolean;
  confidence: number;
  assignedProfileId?: string; // which person's face profile is mapped to this detected face
  assignedAngleId?: string; // which stored angle variant in that profile is placed
  angleMatchScore?: number; // 0-100 match confidence with target head pose angle
  angleMatchFlipped?: boolean; // true if horizontal flip was needed to achieve match
  angleMatchStatus?: 'matched' | 'unmatched' | 'manual';
  flipHorizontal?: boolean; // optional per-face horizontal flip override
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
  avatarUrl: string; // primary cutout transparent PNG or crop
  fullImageUrl: string; // primary full photo
  detectedLandmarks?: FaceLandmarks;
  angles?: FaceAngleVariant[]; // deduplicated library of multiple head angles for this person
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

export type CutoutLayerKind = 'forehead' | 'hair' | 'hand_finger' | 'accessory' | 'object';

export interface NormalizedLayerBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SegmentedCutoutLayerSummary {
  id: string;
  name: string;
  kind: CutoutLayerKind;
  zOrder: number;
  coveragePct: number;
  pixelCount: number;
  faceIndex: number;
  meanDepth: number; // 0..1 relative camera proximity (higher = closer foreground)
  bboxNorm: NormalizedLayerBox;
}

export interface SegmentationVisualizationData {
  gridWidth: number;
  gridHeight: number;
  aspectRatio: number;
  depthGrid: number[]; // normalized 0..1 foreground depth per cell
  categoryGrid: number[]; // 0=bg, 1=forehead, 2=hair, 3=hand_finger, 4=accessory, 5=object, 6=face
  faceBoxNorm: NormalizedLayerBox | null;
  peakForegroundDepth: number;
  faceCoveragePct: number;
  hairCoveragePct: number;
  handCoveragePct: number;
  accessoryCoveragePct: number;
}

export const FACE_COMPOSITE_LAYER_ID = '__face__';

export type LayerBlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn';

export interface BatchMaskExportAsset {
  filename: string;
  label: string;
  kind: string;
  canvas: HTMLCanvasElement;
}

export interface SkinTextureAnalysisReport {
  poreDensityScore: number; // 0-100 spatial pore & micro-texture density on target skin
  dominantFreqBand: 'fine' | 'medium' | 'coarse'; // target skin pore spatial frequency classification
  targetGrainSigma: number; // target skin micro-variance sigma
  matchedVarianceRatio: number; // post-transfer spectrum ratio toward target skin
}

export interface OcclusionHeatmapStats {
  intersectionCoveragePct: number; // % of face mesh area intersecting foreground edges/depth
  peakHeatPct: number; // 0-100 peak occlusion collision intensity
  edgeCollisionPixels: number; // high-gradient intersection pixel count along face mesh
  occluderCategories: string[]; // detected overlapping foreground segments (Hair, Hand/Finger, Accessory, etc.)
}

export type FocusPeakingColor = 'crimson' | 'cyan' | 'amber' | 'emerald';

export interface FocusPeakingStats {
  sharpEdgePct: number; // % of total canvas pixels peaking as sharp high-contrast edges
  faceSharpnessPct: number; // % of detected active face ROI peaking as sharp
  peakIntensityScore: number; // 0-100 normalized sharpness score inside active face(s)
}

export interface FaceMetricsReport {
  symmetryScore: number; // 0-100% bilateral ML Kit landmark symmetry score
  ipdPx: number; // interpupillary distance in canvas pixels
  ipdMm: number; // anthropometrically calibrated interpupillary distance in mm
  hydrationScore: number; // 0-100% dermal luminosity & micro-texture hydration estimate
  hydrationStatus: 'Dehydrated' | 'Balanced' | 'Hydrated' | 'Dewy';
  eyeLineTiltDeg: number; // bilateral eye axis tilt angle in degrees
  midlineDeviationPx: number; // nose/mouth lateral offset from midline in pixels
}

export interface LightingCalibrationSuggestion {
  ambientKelvin: number; // detected target scene ambient light temperature (Kelvin)
  sourceKelvin: number; // detected source face color temperature (Kelvin)
  kelvinDelta: number; // ambientKelvin - sourceKelvin
  ambientCondition: string; // human-readable ambient light condition
  whiteBalanceLabel: string; // summary of white balance shift needed
  suggestedTemperature: number; // recommended temperature slider value (-50..+50)
  suggestedHue: number; // recommended green-magenta tint shift (-25..+25)
  suggestedBrightness: number; // recommended brightness exposure compensation (-60..+60)
  suggestedSaturation: number; // recommended chroma balance (-50..+50)
  tintAxisLabel: string; // e.g. '+3° Magenta Tint' or 'Neutral Tint'
  confidencePct: number; // 0-100 calibration confidence
}

export interface SmartCleanupStats {
  removedIslands: number;
  removedPixels: number;
  refinedEdgePixels: number;
  layersCleaned: number;
}

export interface TargetLightingFilter {
  enabled: boolean;
  sourceKelvin: number;
  sourceIntensity: number; // 0-100%
  targetKelvin: number;
  targetIntensity: number; // 0-100%
  brightnessShift: number; // -45 to +45
  contrastScale: number; // 0.72 to 1.35
  temperatureShift: number; // -45 to +45
  saturateScale: number; // 0.78 to 1.25
}

export interface FaceAdjustments {
  swapStrength: number; // 0 - 100
  skinToneMatch: boolean; // auto skin tone color matching
  skinToneStrength: number; // 0 - 100
  skinReference?: SkinReferenceSample | null; // manual target-body baseline color reference
  featherRadius: number; // 2 - 50 px
  edgeSoftness: number; // 0 - 100% feathering intensity of the face mask
  boundaryRefinement: boolean; // alpha-matte feathering & luminance-based edge matching layer
  boundaryRefinementStrength: number; // 0 - 100% boundary luminance & alpha integration intensity
  boundaryTemporalStabilizer: boolean; // temporal alpha-matte averaging across 3-5 video frames
  boundaryStabilizerFrames: number; // 3 - 5 consecutive video frames averaged for stable edges
  brightness: number; // -100 to +100
  contrast: number; // -100 to +100
  shadows: number; // -100 to +100
  temperature: number; // -100 to +100 (warmth)
  saturation: number; // -100 to +100
  hue: number; // -180 to +180 deg hue shift
  vibrance: number; // -100 to +100 intelligent skin-safe saturation boost
  globalColorHarmony: number; // 0 - 100% unified palette & ambient lighting harmony across all active layers
  scale: number; // 0.8 - 1.2
  rotation: number; // -30 to +30 deg (head roll)
  headPitch: number; // -30 to +30 deg (vertical tilt up/down)
  headYaw: number; // -30 to +30 deg (horizontal turn left/right)
  offsetX: number; // -50 to +50 px
  offsetY: number; // -50 to +50 px
  flipHorizontal: boolean; // horizontally flip source face & align to target face
  autoMatchAngle: boolean; // scan profile angles for 96-100% pose match before placing
  minAngleMatchScore: number; // 85 - 100% required angle similarity threshold (default 96%)
  edgeSmoothing: 'soft' | 'natural' | 'sharp';
  // Hair & Accessory Auto-Masking & Fine-Tune Brush
  smartMasking: boolean; // edge-detection swap boundary refinement & anti-halo decontamination
  smartCleanup: boolean; // automatically removes stray floating hair specks & edge blurriness in segmented layers
  autoMaskHair: boolean; // auto-detect hair & bangs
  autoMaskAccessories: boolean; // auto-detect glasses, hats, jewelry
  autoMaskObjects: boolean; // auto-detect foreground hands, fingers & crossing objects
  preserveTargetLayers: boolean; // adaptive non-destructive N-layer Background -> Face -> Object Cutouts stack
  showBackgroundLayer: boolean; // toggle Background layer visibility
  showFaceLayer: boolean; // toggle Face-behind-hair donor layer visibility
  showForeLayers: boolean; // toggle all Fore-Layers visibility
  hiddenCutoutLayerIds: string[]; // individual dynamic object cutout layers toggled off
  cutoutLayerOpacities: Record<string, number>; // per-layer opacity (0-100) keyed by cutout id or FACE_COMPOSITE_LAYER_ID
  cutoutLayerOrder: string[]; // front-to-back compositing order (index 0 = top-most/front, includes FACE_COMPOSITE_LAYER_ID)
  cutoutLayerBlendModes: Record<string, LayerBlendMode>; // per-layer Canvas 2D compositing blend mode
  batchExportMasks: boolean; // export individual PNG files for all detected segment layers alongside final morph
  targetLightingFilter: TargetLightingFilter | null; // color temperature & intensity correction applied to target layer from source face
  previewSegmentation: boolean; // highlight detected hand, hair, and face layers before full swap
  depthMappingEnabled: boolean; // analyze depth planes for foreground hair, hands, and jewelry
  depthThreshold: number; // 20 - 90% depth separation sensitivity for foreground occluders
  maskSensitivity: number; // 0 - 100%
  showMaskOverlay: boolean; // visualize mask in rubylith/cyan
  brushMode: 'none' | 'protect' | 'reveal'; // manual fine-tune brush
  brushSize: number; // 5 - 80 px
  brushFeather: number; // 0 - 100%
  // Dynamic Skin Texture Topology Smart Blend
  smartBlend: boolean; // dynamic boundary texture & topology feathering
  smartBlendIntensity: number; // 0 - 100%
  textureMatching: boolean; // pore and grain frequency preservation
  skinTextureSync: boolean; // analyzes target face skin pore pattern & applies GAN-style multi-band transfer
  skinTextureSyncStrength: number; // 0 - 100% GAN-based skin pore & frequency transfer intensity
  textureDenoise: number; // 0 - 100% smooths synthetic swap noise while preserving pores & skin texture
  skinSmoothing: number; // 0 - 100% real-time edge-preserving bilateral filter
  skinTextureSmoothing: number; // 0 - 100% blur-masking noise reduction preserving facial edges
  autoAmbientLight: boolean; // auto-harmonize exposure & color temperature to target light source
  // Geometric Mesh, Wireframe Landmarks & Manual Landmark Nudge
  showFaceLandmarks: boolean; // overlay real-time wireframe grid on detected face for adjustment visualization
  showGeometricMesh: boolean; // display geometric mesh overlay for manual landmark alignment
  showAngleGuide: boolean; // display 3D rotation & tilt angle alignment guidelines on target face
  showOcclusionHeatmap: boolean; // real-time edge + depth heatmap highlighting foreground/mesh intersections
  isolatedLayerId: string | null; // null = full composite; '__background__', '__face__', 'cat:<kind>', or cutout layer ID
  // Adaptive Motion-Aware Swap Quality & Directional Motion Blur
  motionSensitivity: boolean; // automatically scale down swap processing intensity during high camera motion
  motionBlur: boolean; // adaptive camera-movement detector applying directional motion blur to morphed face layer
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
  // Localized Facial Age Progression (Texture Overlay + Subtle Warping)
  ageProgression: number; // 0 (natural) to 100 (aged skin texture & facial contour warp)
  // Border Local Contrast Separation
  edgeContrast: number; // 0 - 100% local contrast enhancement along the swap-to-target border
  // Temporal Video Frame Stabilization
  motionSmoothingEnabled: boolean; // master toggle for temporal video stabilization
  motionSmoothing: number; // 0 - 100% temporal stabilizer sensitivity across video frames to reduce jitter & flicker
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

export type ExportFormat = 'png' | 'psd' | 'tiff' | 'jpeg';
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
  motionBlurPx?: number;
  motionAngleDeg?: number;
  stabilizedBoundaryFrames?: number;
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
  motionBlur?: boolean;
  lightingAdjustment?: number;
  shadowMatcher?: number;
  softBloom?: number;
  autoRefocus?: boolean;
  antiAliasing?: boolean;
  genderMorph?: number;
  edgeContrast?: number;
  motionSmoothingEnabled?: boolean;
  motionSmoothing?: number;
  edgeSoftness?: number;
  boundaryRefinement?: boolean;
  boundaryRefinementStrength?: number;
  boundaryTemporalStabilizer?: boolean;
  boundaryStabilizerFrames?: number;
  flipHorizontal?: boolean;
  // Capture Mode
  captureMode: 'photo' | 'video';
}
