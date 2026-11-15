import { Point } from './face';

export interface BodyMeasurements {
  shoulderWidthCm: number;
  chestBustCm: number;
  waistCm: number;
  hipsCm: number;
  neckCircumferenceCm: number;
  torsoLengthCm: number;
  armLengthCm: number;
  estimatedSize: string; // e.g. "US M / EU 48 · Regular"
  bodyType: 'Athletic' | 'Slim' | 'Regular' | 'Broad';
  confidence: number;
}

export interface BodyLandmarks {
  nose: Point;
  neck: Point;
  throat: Point;
  leftShoulder: Point;
  rightShoulder: Point;
  sternum: Point;
  leftChest: Point;
  rightChest: Point;
  leftWaist: Point;
  rightWaist: Point;
  navel: Point;
  leftHip: Point;
  rightHip: Point;
  leftElbow: Point;
  rightElbow: Point;
  leftWrist: Point;
  rightWrist: Point;
}

export type WardrobeCategory = 'clothing' | 'jewelry' | 'object' | 'accessory';

export type BuiltinClothingTag =
  | 'suit'
  | 'blazer'
  | 'shirt'
  | 'top'
  | 'bikini'
  | 'dress'
  | 'robe'
  | 'jacket'
  | 'hoodie'
  | 'pants'
  | 'skirt';

export interface WardrobeAsset {
  id: string;
  name: string;
  category: WardrobeCategory;
  subCategory:
    | BuiltinClothingTag
    | 'necklace'
    | 'watch'
    | 'bracelet'
    | 'earrings'
    | 'ring'
    | 'hat'
    | 'crown'
    | 'glasses'
    | 'waist'
    | 'handbag'
    | 'prop'
    | 'custom'
    | (string & {});
  clothingTag?: string; // Canonical clothing tab/tag (e.g. "Suit", "Shirt", "Bikini", or user-created tag)
  imageUrl: string;
  anchorPoint: 'shoulders' | 'neck' | 'wrist' | 'ears' | 'head' | 'waist' | 'chest';
  defaultScale: number;
  tags: string[];
  brand?: string;
  isCustom?: boolean;
  customCreatedAt?: number;
  fabricType?: 'silk' | 'cotton' | 'wool' | 'leather';
  thumbnailUrl?: string;
}

export interface MaterialSurfaceSettings {
  textureIntensity: number; // 0 - 100 (normal-mapped weave & surface relief)
  roughness: number; // 0 - 100 (0 = glossy, 100 = matte diffuse)
  shine: number; // 0 - 100 (specular highlight & Fresnel sheen intensity)
}

export interface FittedAsset {
  assetId: string;
  visible: boolean;
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  fitTightness: number; // 0 (slim) - 100 (relaxed)
  shadowDepth: number; // 0 - 100%
  lightingMatch: boolean;
  blendMode: 'natural' | 'stitch';
  fabricType?: 'silk' | 'cotton' | 'wool' | 'leather';
  physicsStiffness?: number; // 1 - 10
  materialSurface?: MaterialSurfaceSettings;
}

export type ClothMotionPreset = 'still' | 'breathing' | 'walking' | 'breeze' | 'dance';

export interface ClothPhysicsConfig {
  enabled: boolean;
  preset: ClothMotionPreset;
  fabricType: 'silk' | 'cotton' | 'wool' | 'leather';
  gravity: number; // 0.1 - 2.0 (fabric weight & gravitational pull)
  windStrength: number; // -10 - +10 (air velocity)
  windTurbulence: number; // 0 - 1 (air gusts and eddies)
  airResistance: number; // 0 - 100% (aerodynamic air drag)
  gustFrequency: number; // 0.2 - 3.0 Hz (periodic air puff frequency)
  airFanActive: boolean; // studio wind fan blower
  damping: number; // 0.85 - 0.99 (fabric kinetic damping)
  stiffness: number; // constraint relaxation passes: 2 - 8
  motionSpeed: number; // 0.5 - 2.5
  postureTilt: number; // -25 - +25 degrees
  postureTurn: number; // -20 - +20 degrees
  chestExpansion: number; // -10 - +20 px
  showPhysicsWireframe: boolean;
  showTensionStress: boolean;
  showBodyColliders?: boolean;
  isSimulating: boolean;
}

export interface BodyCollisionCapsule {
  id: string;
  zone: 'ribcage' | 'waist' | 'hips' | 'neck' | 'arm';
  p1: Point;
  p2: Point;
  r1: number;
  r2: number;
  friction: number;
}

export interface ClothContactPoint {
  x: number;
  y: number;
  zone: BodyCollisionCapsule['zone'];
  impulse: number;
}

export interface ClothSimulationMetrics {
  avgTensionN: number;
  peakStrainPct: number;
  activeCollisions: number;
  kineticEnergy: number;
}

export interface ClothParticle {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  initX: number;
  initY: number;
  pinned: boolean;
  pinOffsetX: number;
  pinOffsetY: number;
  u: number;
  v: number;
  mass: number;
}

export interface ClothSpring {
  p1: number;
  p2: number;
  restLength: number;
  stiffness: number;
  type: 'structural' | 'shear' | 'bending';
  strain?: number;
}

