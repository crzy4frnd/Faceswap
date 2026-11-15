import { Point } from '../types/face';
import {
  BodyCollisionCapsule,
  BodyLandmarks,
  ClothContactPoint,
  ClothMotionPreset,
  ClothParticle,
  ClothPhysicsConfig,
  ClothSimulationMetrics,
  ClothSpring,
  MaterialSurfaceSettings,
} from '../types/body';

export type { ClothPhysicsConfig };

export interface UserBodyMotionInput {
  shiftX: number;
  shiftY: number;
  tiltDeg: number;
  turnDeg: number;
}

export const DEFAULT_CLOTH_CONFIG: ClothPhysicsConfig = {
  enabled: true,
  preset: 'breathing',
  fabricType: 'wool',
  gravity: 0.55,
  windStrength: 1.5,
  windTurbulence: 0.45,
  airResistance: 65,
  gustFrequency: 1.0,
  airFanActive: false,
  damping: 0.93,
  stiffness: 4,
  motionSpeed: 1.0,
  postureTilt: 0,
  postureTurn: 0,
  chestExpansion: 0,
  showPhysicsWireframe: false,
  showTensionStress: false,
  showBodyColliders: false,
  isSimulating: true,
};

export const FABRIC_PROPERTIES: Record<
  ClothPhysicsConfig['fabricType'],
  {
    label: string;
    description: string;
    damping: number;
    gravity: number;
    stiffness: number;
    windSusceptibility: number;
    friction: number;
    bendResistance: number;
    shearStiffness: number;
    stretchLimit: number;
  }
> = {
  silk: {
    label: 'Silk / Chiffon',
    description: 'Ultra-light, high fluidity, responsive to gentle air drafts',
    damping: 0.97,
    gravity: 0.32,
    stiffness: 2,
    windSusceptibility: 1.8,
    friction: 0.14,
    bendResistance: 0.28,
    shearStiffness: 0.45,
    stretchLimit: 1.18,
  },
  cotton: {
    label: 'Organic Cotton',
    description: 'Medium weight, balanced drape, moderate structure',
    damping: 0.94,
    gravity: 0.5,
    stiffness: 4,
    windSusceptibility: 1.0,
    friction: 0.32,
    bendResistance: 0.56,
    shearStiffness: 0.72,
    stretchLimit: 1.12,
  },
  wool: {
    label: 'Tailored Wool',
    description: 'Structured silhouette, higher inertia, stable tailored drape',
    damping: 0.9,
    gravity: 0.65,
    stiffness: 6,
    windSusceptibility: 0.6,
    friction: 0.48,
    bendResistance: 0.8,
    shearStiffness: 0.86,
    stretchLimit: 1.08,
  },
  leather: {
    label: 'Heavy Leather / Denim',
    description: 'Rigid structure, heavy drape, high stiffness and crease memory',
    damping: 0.86,
    gravity: 0.78,
    stiffness: 8,
    windSusceptibility: 0.35,
    friction: 0.62,
    bendResistance: 0.96,
    shearStiffness: 0.95,
    stretchLimit: 1.04,
  },
};

export function getDefaultMaterialSurface(
  fabricType: ClothPhysicsConfig['fabricType'] = 'wool'
): MaterialSurfaceSettings {
  switch (fabricType) {
    case 'silk':
      return { textureIntensity: 24, roughness: 18, shine: 74 };
    case 'leather':
      return { textureIntensity: 48, roughness: 32, shine: 66 };
    case 'cotton':
      return { textureIntensity: 56, roughness: 64, shine: 22 };
    case 'wool':
    default:
      return { textureIntensity: 72, roughness: 78, shine: 16 };
  }
}

export interface ClothMeshState {
  particles: ClothParticle[];
  springs: ClothSpring[];
  cols: number;
  rows: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorMode: 'shoulders' | 'chest' | 'waist';
  garmentType: string;
  fitTightness: number;
  grabbedIndex: number | null;
  grabbedPoint: Point | null;
  lastAnchorMid?: Point;
  contactPoints: ClothContactPoint[];
  metrics: ClothSimulationMetrics;
}

export interface PendantPhysicsState {
  links: Point[];
  oldLinks: Point[];
  lengths: number[];
  leftAnchor: Point;
  rightAnchor: Point;
  pendantWeight: number;
}

/**
 * Returns horizontal silhouette width multiplier [0.7..1.35] along normalized vertical coordinate v (0=top, 1=hem)
 * based on garment type and fit tightness (0=slim tailored, 100=relaxed drape).
 */
function getGarmentRowEnvelope(
  garmentType: string,
  v: number,
  fitTightness: number
): number {
  const ease = 0.94 + (fitTightness / 100) * 0.16;
  const gt = garmentType.toLowerCase();

  if (gt === 'suit' || gt === 'blazer' || gt === 'jacket') {
    // Structured shoulder pads, gentle waist nip, tailored hip flare
    const shoulderCap = Math.max(0, 1 - v * 3.0) * 0.06;
    const waistNip = Math.exp(-Math.pow((v - 0.56) / 0.22, 2)) * -0.09;
    const hipEase = Math.max(0, (v - 0.65) / 0.35) * 0.05;
    return (1 + shoulderCap + waistNip + hipEase) * ease;
  }
  if (gt === 'bikini') {
    // Form-fitting bust/midriff contour
    const contour = 1 - Math.sin(v * Math.PI) * 0.08;
    return contour * (0.9 + (fitTightness / 100) * 0.12);
  }
  if (gt === 'dress' || gt === 'robe') {
    // Fitted chest/waist transitioning into graceful flared skirt/hem
    const waistNip = Math.exp(-Math.pow((v - 0.36) / 0.18, 2)) * -0.08;
    const skirtFlare = Math.pow(Math.max(0, (v - 0.38) / 0.62), 1.35) * 0.24;
    return (1 + waistNip + skirtFlare) * ease;
  }
  if (gt === 'skirt') {
    // Anchored at waist, flaring gently downward over hips
    return (0.96 + Math.pow(v, 1.15) * 0.28) * ease;
  }
  if (gt === 'pants') {
    // Anchored at waist, hugging hips smoothly
    const hipCurve = Math.sin(Math.min(1, v * 1.4) * Math.PI * 0.6) * 0.08;
    return (0.98 + hipCurve) * ease;
  }
  // Default 'shirt' / 'top' / custom top
  const chestEase = Math.exp(-Math.pow((v - 0.22) / 0.25, 2)) * 0.03;
  const waistTaper = Math.exp(-Math.pow((v - 0.65) / 0.28, 2)) * -0.06;
  return (1 + chestEase + waistTaper) * ease;
}

/**
 * Creates a body-measurement-fitted mass-spring lattice grid for dynamic cloth simulation.
 */
export function createClothGrid(
  startX: number,
  startY: number,
  width: number,
  height: number,
  cols = 8,
  rows = 9,
  shoulderSpan = width,
  garmentType: string = 'shirt',
  fitTightness: number = 50,
  anchorMode: 'shoulders' | 'chest' | 'waist' = 'shoulders'
): ClothMeshState {
  const particles: ClothParticle[] = [];
  const springs: ClothSpring[] = [];

  const safeW = Math.max(24, width);
  const safeH = Math.max(24, height);
  const dy = safeH / (rows - 1);

  // Initialize particles mapped to garment anatomical envelope
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    const rowWidth = safeW * getGarmentRowEnvelope(garmentType, v, fitTightness);
    const rowLeft = startX - rowWidth / 2;
    const rowDx = rowWidth / (cols - 1);

    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);

      // Subtle collar curve on shoulder/chest tops
      let collarCurveOffset = 0;
      if (r === 0 && anchorMode !== 'waist') {
        collarCurveOffset = Math.sin(u * Math.PI) * Math.min(dy * 0.35, 8);
      }

      const px = rowLeft + c * rowDx;
      const py = startY + r * dy + collarCurveOffset;

      const isPinned = r === 0;

      particles.push({
        x: px,
        y: py,
        oldX: px,
        oldY: py,
        initX: px,
        initY: py,
        pinned: isPinned,
        pinOffsetX: px - startX,
        pinOffsetY: py - startY,
        u,
        v,
        mass: isPinned ? 0 : 1.0,
      });
    }
  }

  const getIdx = (r: number, c: number) => r * cols + c;

  // Add structural, shear, and bending springs
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = getIdx(r, c);

      // Horizontal Structural
      if (c < cols - 1) {
        const rightIdx = getIdx(r, c + 1);
        const dist = Math.hypot(
          particles[rightIdx].x - particles[idx].x,
          particles[rightIdx].y - particles[idx].y
        );
        springs.push({ p1: idx, p2: rightIdx, restLength: dist, stiffness: 0.95, type: 'structural' });
      }

      // Vertical Structural
      if (r < rows - 1) {
        const downIdx = getIdx(r + 1, c);
        const dist = Math.hypot(
          particles[downIdx].x - particles[idx].x,
          particles[downIdx].y - particles[idx].y
        );
        springs.push({ p1: idx, p2: downIdx, restLength: dist, stiffness: 0.95, type: 'structural' });
      }

      // Diagonal Shear Springs (Anti-wrinkle / fabric warp resistance)
      if (r < rows - 1 && c < cols - 1) {
        const diag1 = getIdx(r + 1, c + 1);
        const dist1 = Math.hypot(
          particles[diag1].x - particles[idx].x,
          particles[diag1].y - particles[idx].y
        );
        springs.push({ p1: idx, p2: diag1, restLength: dist1, stiffness: 0.75, type: 'shear' });
      }
      if (r < rows - 1 && c > 0) {
        const diag2 = getIdx(r + 1, c - 1);
        const dist2 = Math.hypot(
          particles[diag2].x - particles[idx].x,
          particles[diag2].y - particles[idx].y
        );
        springs.push({ p1: idx, p2: diag2, restLength: dist2, stiffness: 0.75, type: 'shear' });
      }

      // Bending Springs (2 steps away, prevents cloth from crumbling like paper)
      if (c < cols - 2) {
        const bendH = getIdx(r, c + 2);
        const dist = Math.hypot(
          particles[bendH].x - particles[idx].x,
          particles[bendH].y - particles[idx].y
        );
        springs.push({ p1: idx, p2: bendH, restLength: dist, stiffness: 0.5, type: 'bending' });
      }
      if (r < rows - 2) {
        const bendV = getIdx(r + 2, c);
        const dist = Math.hypot(
          particles[bendV].x - particles[idx].x,
          particles[bendV].y - particles[idx].y
        );
        springs.push({ p1: idx, p2: bendV, restLength: dist, stiffness: 0.5, type: 'bending' });
      }
    }
  }

  return {
    particles,
    springs,
    cols,
    rows,
    width: safeW,
    height: safeH,
    anchorX: startX,
    anchorY: startY,
    anchorMode,
    garmentType,
    fitTightness,
    grabbedIndex: null,
    grabbedPoint: null,
    lastAnchorMid: { x: startX, y: startY },
    contactPoints: [],
    metrics: {
      avgTensionN: 0,
      peakStrainPct: 0,
      activeCollisions: 0,
      kineticEnergy: 0,
    },
  };
}

/**
 * Computes dynamic movement, breathing chest expansion, arm/hip swing, 3D yaw foreshortening,
 * and optional interactive/webcam user motion input.
 */
export function computePostureDynamics(
  timeSec: number,
  config: ClothPhysicsConfig,
  baseLandmarks: BodyLandmarks,
  userMotion?: UserBodyMotionInput
) {
  const speed = config.motionSpeed;
  const t = timeSec * speed;

  let dynamicTiltDeg = config.postureTilt + (userMotion?.tiltDeg || 0);
  let dynamicTurnDeg = config.postureTurn + (userMotion?.turnDeg || 0);
  let shiftX = userMotion?.shiftX || 0;
  let shiftY = userMotion?.shiftY || 0;
  let chestExp = config.chestExpansion;
  let leftArmSwingX = 0;
  let rightArmSwingX = 0;
  let leftArmSwingY = 0;
  let rightArmSwingY = 0;
  let hipCounterX = 0;

  if (config.isSimulating) {
    switch (config.preset) {
      case 'breathing': {
        const breath = Math.sin(t * 1.8);
        chestExp += breath * 4.5;
        shiftY += breath * 1.5;
        dynamicTiltDeg += Math.sin(t * 0.9) * 0.6;
        leftArmSwingX = breath * -2.2;
        rightArmSwingX = breath * 2.2;
        break;
      }
      case 'walking': {
        const walkPhase = t * 3.2;
        shiftX += Math.sin(walkPhase) * 9.0;
        shiftY += Math.abs(Math.sin(walkPhase * 2)) * 4.0;
        dynamicTiltDeg += Math.sin(walkPhase) * 3.8;
        dynamicTurnDeg += Math.cos(walkPhase) * 5.2;
        hipCounterX = -Math.sin(walkPhase) * 5.5;
        leftArmSwingX = Math.cos(walkPhase) * 14.0;
        rightArmSwingX = -Math.cos(walkPhase) * 14.0;
        leftArmSwingY = Math.sin(walkPhase) * 6.0;
        rightArmSwingY = -Math.sin(walkPhase) * 6.0;
        break;
      }
      case 'breeze': {
        shiftX += Math.sin(t * 1.4) * 3.0;
        dynamicTiltDeg += Math.sin(t * 2.1) * 1.4;
        leftArmSwingX = Math.sin(t * 1.6) * 3.5;
        rightArmSwingX = Math.sin(t * 1.6 + 0.4) * 3.5;
        break;
      }
      case 'dance': {
        const dancePhase = t * 2.5;
        shiftX += Math.sin(dancePhase) * 14.0;
        shiftY += Math.cos(dancePhase * 2) * 6.0;
        dynamicTiltDeg += Math.sin(dancePhase) * 6.5;
        dynamicTurnDeg += Math.cos(dancePhase) * 8.0;
        chestExp += Math.sin(t * 3.5) * 6.0;
        hipCounterX = Math.sin(dancePhase + 1.2) * 8.0;
        leftArmSwingX = Math.sin(dancePhase) * 18.0;
        rightArmSwingX = -Math.cos(dancePhase) * 18.0;
        leftArmSwingY = -Math.abs(Math.sin(dancePhase)) * 11.0;
        rightArmSwingY = -Math.abs(Math.cos(dancePhase)) * 11.0;
        break;
      }
      case 'still':
      default:
        break;
    }
  }

  // Calculate dynamic aerodynamic air flow with gust frequency and studio fan
  const gustFreq = config.gustFrequency || 1.0;
  const windT = t * 2.2 * gustFreq;
  const fanBoost = config.airFanActive ? 5.0 : 0;
  const baseWind = config.windStrength + fanBoost;
  const windVariance =
    Math.sin(windT * 1.7) * Math.cos(windT * 0.9) * (config.windTurbulence || 0.45) * 4.2;
  const dynamicWindX = baseWind * 1.4 + windVariance;
  const dynamicWindY = Math.sin(windT * 2.4) * (config.windTurbulence || 0.45) * 1.6;

  // Compute dynamic skeletal positions based on posture tilt + 3D yaw turn
  const rad = (dynamicTiltDeg * Math.PI) / 180;
  const cosT = Math.cos(rad);
  const sinT = Math.sin(rad);

  const clampedTurn = Math.max(-35, Math.min(35, dynamicTurnDeg));
  const turnRad = (clampedTurn * Math.PI) / 180;
  const yawCompress = Math.cos(turnRad);
  const yawShiftScale = Math.sin(turnRad);

  const pivotX = (baseLandmarks.leftShoulder.x + baseLandmarks.rightShoulder.x) / 2;
  const pivotY = (baseLandmarks.leftShoulder.y + baseLandmarks.rightShoulder.y) / 2;

  const transformPt = (p: Point, extraX = 0, extraY = 0, depthOffset = 0): Point => {
    const rx = (p.x - pivotX) * yawCompress + depthOffset * yawShiftScale;
    const ry = p.y - pivotY;
    return {
      x: pivotX + (rx * cosT - ry * sinT) + shiftX + extraX,
      y: pivotY + (rx * sinT + ry * cosT) + shiftY + extraY,
    };
  };

  const chestDelta = chestExp * 0.35;
  const shoulderSpan = Math.hypot(
    baseLandmarks.rightShoulder.x - baseLandmarks.leftShoulder.x,
    baseLandmarks.rightShoulder.y - baseLandmarks.leftShoulder.y
  );
  const torsoDepth = shoulderSpan * 0.18;

  const dynamicLandmarks: BodyLandmarks = {
    ...baseLandmarks,
    nose: transformPt(baseLandmarks.nose, 0, 0, torsoDepth * 0.35),
    neck: transformPt(baseLandmarks.neck),
    throat: transformPt(baseLandmarks.throat, 0, 0, torsoDepth * 0.2),
    leftShoulder: transformPt(baseLandmarks.leftShoulder),
    rightShoulder: transformPt(baseLandmarks.rightShoulder),
    sternum: transformPt(baseLandmarks.sternum, 0, 0, torsoDepth * 0.55),
    leftChest: transformPt(baseLandmarks.leftChest, -chestDelta, 0, torsoDepth * 0.4),
    rightChest: transformPt(baseLandmarks.rightChest, chestDelta, 0, torsoDepth * 0.4),
    leftWaist: transformPt(baseLandmarks.leftWaist, hipCounterX * 0.45, 0, torsoDepth * 0.25),
    rightWaist: transformPt(baseLandmarks.rightWaist, hipCounterX * 0.45, 0, torsoDepth * 0.25),
    navel: transformPt(baseLandmarks.navel, hipCounterX * 0.5, 0, torsoDepth * 0.35),
    leftHip: transformPt(baseLandmarks.leftHip, hipCounterX, 0, torsoDepth * 0.2),
    rightHip: transformPt(baseLandmarks.rightHip, hipCounterX, 0, torsoDepth * 0.2),
    leftElbow: transformPt(baseLandmarks.leftElbow, leftArmSwingX * 0.55, leftArmSwingY * 0.45),
    rightElbow: transformPt(baseLandmarks.rightElbow, rightArmSwingX * 0.55, rightArmSwingY * 0.45),
    leftWrist: transformPt(baseLandmarks.leftWrist, leftArmSwingX, leftArmSwingY),
    rightWrist: transformPt(baseLandmarks.rightWrist, rightArmSwingX, rightArmSwingY),
  };

  return {
    dynamicLandmarks,
    dynamicTiltDeg,
    dynamicTurnDeg,
    shiftX,
    shiftY,
    chestExp,
    wind: { x: dynamicWindX, y: dynamicWindY },
  };
}

/**
 * Builds anatomical body collision capsules from scanned landmarks for torso, waist, hips, neck, and arms.
 */
export function buildBodyCollisionMesh(
  landmarks: BodyLandmarks,
  chestExpansion: number = 0
): BodyCollisionCapsule[] {
  const shoulderSpan = Math.max(
    40,
    Math.hypot(
      landmarks.rightShoulder.x - landmarks.leftShoulder.x,
      landmarks.rightShoulder.y - landmarks.leftShoulder.y
    )
  );
  const waistSpan = Math.max(
    30,
    Math.hypot(
      landmarks.rightWaist.x - landmarks.leftWaist.x,
      landmarks.rightWaist.y - landmarks.leftWaist.y
    )
  );
  const hipSpan = Math.max(
    34,
    Math.hypot(
      landmarks.rightHip.x - landmarks.leftHip.x,
      landmarks.rightHip.y - landmarks.leftHip.y
    )
  );

  const waistMid: Point = {
    x: (landmarks.leftWaist.x + landmarks.rightWaist.x) / 2,
    y: (landmarks.leftWaist.y + landmarks.rightWaist.y) / 2,
  };
  const hipMid: Point = {
    x: (landmarks.leftHip.x + landmarks.rightHip.x) / 2,
    y: (landmarks.leftHip.y + landmarks.rightHip.y) / 2,
  };

  const chestRadius = Math.max(18, shoulderSpan * 0.34 + chestExpansion * 0.35);
  const waistRadius = Math.max(14, waistSpan * 0.44);
  const hipRadius = Math.max(16, hipSpan * 0.44);
  const armRadiusUpper = Math.max(8, shoulderSpan * 0.13);
  const armRadiusLower = Math.max(6, shoulderSpan * 0.095);
  const neckRadius = Math.max(9, shoulderSpan * 0.14);

  return [
    {
      id: 'neck-column',
      zone: 'neck',
      p1: landmarks.neck,
      p2: landmarks.throat,
      r1: neckRadius,
      r2: neckRadius * 1.15,
      friction: 0.25,
    },
    {
      id: 'ribcage-core',
      zone: 'ribcage',
      p1: landmarks.sternum,
      p2: waistMid,
      r1: chestRadius,
      r2: waistRadius,
      friction: 0.42,
    },
    {
      id: 'waist-pelvis-core',
      zone: 'hips',
      p1: waistMid,
      p2: hipMid,
      r1: waistRadius,
      r2: hipRadius,
      friction: 0.48,
    },
    {
      id: 'left-upper-arm',
      zone: 'arm',
      p1: landmarks.leftShoulder,
      p2: landmarks.leftElbow,
      r1: armRadiusUpper * 1.1,
      r2: armRadiusUpper * 0.9,
      friction: 0.35,
    },
    {
      id: 'left-forearm',
      zone: 'arm',
      p1: landmarks.leftElbow,
      p2: landmarks.leftWrist,
      r1: armRadiusUpper * 0.85,
      r2: armRadiusLower,
      friction: 0.3,
    },
    {
      id: 'right-upper-arm',
      zone: 'arm',
      p1: landmarks.rightShoulder,
      p2: landmarks.rightElbow,
      r1: armRadiusUpper * 1.1,
      r2: armRadiusUpper * 0.9,
      friction: 0.35,
    },
    {
      id: 'right-forearm',
      zone: 'arm',
      p1: landmarks.rightElbow,
      p2: landmarks.rightWrist,
      r1: armRadiusUpper * 0.85,
      r2: armRadiusLower,
      friction: 0.3,
    },
  ];
}

/**
 * Closest point and radius interpolation along a tapered 2D capsule.
 */
function closestPointOnCapsule(px: number, py: number, cap: BodyCollisionCapsule) {
  const vx = cap.p2.x - cap.p1.x;
  const vy = cap.p2.y - cap.p1.y;
  const lenSq = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - cap.p1.x) * vx + (py - cap.p1.y) * vy) / lenSq));
  const cx = cap.p1.x + vx * t;
  const cy = cap.p1.y + vy * t;
  const radius = cap.r1 + (cap.r2 - cap.r1) * t;
  return { cx, cy, radius, t };
}

/**
 * Updates cloth mass-spring simulation using Verlet integration, inertial frame coupling,
 * material tension/strain constraints, and anatomical body-mesh collision with Coulomb friction.
 */
export function stepClothMesh(
  mesh: ClothMeshState,
  config: ClothPhysicsConfig,
  anchorLeft: Point,
  anchorRight: Point,
  landmarksOrSternum: BodyLandmarks | Point,
  wind: Point,
  chestExpansion: number,
  colliders?: BodyCollisionCapsule[]
) {
  const fabric = FABRIC_PROPERTIES[config.fabricType] || FABRIC_PROPERTIES.wool;
  const airDrag = 1.0 - ((config.airResistance ?? 65) / 100) * 0.12;
  const damping = fabric.damping * config.damping * airDrag;
  const gravity = fabric.gravity * config.gravity * 0.9;
  const stiffnessPasses = Math.min(8, Math.max(2, config.stiffness));
  const windSusceptibility = fabric.windSusceptibility;

  const anchorVecX = anchorRight.x - anchorLeft.x;
  const anchorVecY = anchorRight.y - anchorLeft.y;
  const anchorSpan = Math.hypot(anchorVecX, anchorVecY) || 1;
  const normX = anchorVecX / anchorSpan;
  const normY = anchorVecY / anchorSpan;
  const perpX = -normY;
  const perpY = normX;

  const anchorMidX = (anchorLeft.x + anchorRight.x) / 2;
  const anchorMidY = (anchorLeft.y + anchorRight.y) / 2;

  // Track frame-to-frame body movement inertia so moving the body creates real swing & lag
  const prevMid = mesh.lastAnchorMid || { x: anchorMidX, y: anchorMidY };
  const frameAnchorDx = Math.max(-18, Math.min(18, anchorMidX - prevMid.x));
  const frameAnchorDy = Math.max(-18, Math.min(18, anchorMidY - prevMid.y));
  mesh.lastAnchorMid = { x: anchorMidX, y: anchorMidY };
  mesh.anchorX = anchorMidX;
  mesh.anchorY = anchorMidY;

  // Dynamic top row span matches mesh width
  const topWidth = mesh.width * getGarmentRowEnvelope(mesh.garmentType, 0, mesh.fitTightness);
  const topYOffset = mesh.anchorMode === 'waist' ? 0 : -mesh.height * 0.04;

  // 1. Pin row 0 cleanly along dynamic body anchor line
  for (let c = 0; c < mesh.cols; c++) {
    const p = mesh.particles[c];
    const u = c / (mesh.cols - 1);
    const spanOffset = (u - 0.5) * topWidth;
    const collarDip =
      mesh.anchorMode === 'waist' ? 0 : Math.sin(u * Math.PI) * Math.min(mesh.height * 0.035, 8);

    p.x = anchorMidX + normX * spanOffset + perpX * (collarDip + topYOffset);
    p.y = anchorMidY + normY * spanOffset + perpY * (collarDip + topYOffset);
    p.oldX = p.x;
    p.oldY = p.y;
  }

  // Derive anatomical spine & torso colliders if Landmarks passed
  const hasFullLandmarks = 'leftShoulder' in landmarksOrSternum;
  const activeColliders =
    colliders ||
    (hasFullLandmarks
      ? buildBodyCollisionMesh(landmarksOrSternum as BodyLandmarks, chestExpansion)
      : []);

  const sternumPt = hasFullLandmarks
    ? (landmarksOrSternum as BodyLandmarks).sternum
    : (landmarksOrSternum as Point);

  // 2. Verlet integration on unpinned particles with body-motion inertia & drag
  const turnShiftRatio = Math.sin(((config.postureTurn || 0) * Math.PI) / 180);
  let totalKinetic = 0;

  for (let i = mesh.cols; i < mesh.particles.length; i++) {
    const p = mesh.particles[i];

    if (mesh.grabbedIndex === i && mesh.grabbedPoint) {
      p.x = mesh.grabbedPoint.x;
      p.y = mesh.grabbedPoint.y;
      p.oldX = p.x;
      p.oldY = p.y;
      continue;
    }

    const rawVx = (p.x - p.oldX) * damping;
    const rawVy = (p.y - p.oldY) * damping;
    const vx = Math.max(-14, Math.min(14, rawVx));
    const vy = Math.max(-14, Math.min(14, rawVy));
    totalKinetic += vx * vx + vy * vy;

    p.oldX = p.x;
    p.oldY = p.y;

    const hemRatio = p.v;
    const airFlutter =
      Math.sin(p.u * Math.PI * 3.5 + p.x * 0.035) *
      (config.windTurbulence || 0.45) *
      (hemRatio * 1.15);
    const windFx = (wind.x + airFlutter) * windSusceptibility * (0.18 + hemRatio * 0.9);
    const windFy = wind.y * windSusceptibility * (0.1 + hemRatio * 0.45);

    // Couple inertial lag when user or preset moves shoulders quickly
    const inertiaFollow = Math.max(0.08, 1 - hemRatio * 0.65);
    p.x += vx + windFx + frameAnchorDx * inertiaFollow * 0.25 + turnShiftRatio * hemRatio * 0.72;
    p.y += vy + gravity + windFy + frameAnchorDy * inertiaFollow * 0.2;

    // 3. Anatomical 2.5D drape contour guidance (chest fullness + waist contour)
    const chestBump = Math.exp(-Math.pow((p.v - 0.26) / 0.22, 2)) * chestExpansion * 0.38;
    const targetHalfW =
      mesh.width * getGarmentRowEnvelope(mesh.garmentType, p.v, mesh.fitTightness) * 0.5 + chestBump;
    const spineMidX = hasFullLandmarks
      ? anchorMidX +
        (((landmarksOrSternum as BodyLandmarks).navel.x - anchorMidX) * Math.min(1, p.v * 1.25))
      : anchorMidX + perpX * (p.v * mesh.height) * 0.15;
    const targetX = spineMidX + (p.u - 0.5) * 2 * targetHalfW;
    const lateralPull = fabric.stiffness >= 6 ? 0.075 : 0.032;
    p.x += (targetX - p.x) * lateralPull;

    // Prevent upper torso cloth from collapsing upward past sternum
    const minY = Math.min(sternumPt.y, anchorMidY) + p.v * mesh.height * 0.72;
    if (p.y < minY) {
      p.y = minY + (p.y - minY) * 0.25;
    }
  }

  // 4. Multi-pass spring constraint relaxation + per-material stretch/bend enforcement
  for (let pass = 0; pass < stiffnessPasses; pass++) {
    for (let s = 0; s < mesh.springs.length; s++) {
      const spring = mesh.springs[s];
      const p1 = mesh.particles[spring.p1];
      const p2 = mesh.particles[spring.p2];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const strain = (dist - spring.restLength) / spring.restLength;
      spring.strain = strain;

      // Scale effective spring stiffness by fabric properties
      let typeWeight = 1.0;
      if (spring.type === 'shear') {
        typeWeight = fabric.shearStiffness;
      } else if (spring.type === 'bending') {
        typeWeight = fabric.bendResistance * 0.72;
      }

      // Enforce stretch resistance stronger than compression so cloth folds cleanly rather than rubber-banding
      const stretchFactor = dist > spring.restLength ? 1.0 : 0.65;
      const correction = (strain * spring.stiffness * typeWeight * stretchFactor) / 2;
      const offsetX = dx * correction;
      const offsetY = dy * correction;

      if (!p1.pinned && mesh.grabbedIndex !== spring.p1) {
        p1.x += offsetX;
        p1.y += offsetY;
      }
      if (!p2.pinned && mesh.grabbedIndex !== spring.p2) {
        p2.x -= offsetX;
        p2.y -= offsetY;
      }
    }
  }

  // 5. Anatomical Body Mesh Collision Detection & Coulomb Friction Resolution
  const contactPoints: ClothContactPoint[] = [];
  if (activeColliders.length > 0) {
    const neckCap = activeColliders.find((c) => c.zone === 'neck');
    const armCaps = activeColliders.filter((c) => c.zone === 'arm');
    const torsoCaps = activeColliders.filter((c) => c.zone === 'ribcage' || c.zone === 'hips');

    for (let i = mesh.cols; i < mesh.particles.length; i++) {
      const p = mesh.particles[i];
      if (mesh.grabbedIndex === i) continue;

      const isOuterEdge = p.u <= 0.16 || p.u >= 0.84;
      const isLeftSide = p.u < 0.5;

      // A) Arm Collision Capsules: sleeves / sides collide with moving upper arms & forearms
      for (const armCap of armCaps) {
        const isLeftArm = armCap.id.startsWith('left');
        if ((isLeftSide && !isLeftArm) || (!isLeftSide && isLeftArm)) continue;
        // Only outer cloth columns (sleeves/sides) interact with arms
        if (p.u > 0.25 && p.u < 0.75) continue;

        const { cx, cy, radius } = closestPointOnCapsule(p.x, p.y, armCap);
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minClearance = radius * 0.78;

        if (dist < minClearance) {
          const overlap = minClearance - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          p.x += nx * overlap * 0.85;
          p.y += ny * overlap * 0.85;

          // Tangential Coulomb friction along the arm surface
          const vx = p.x - p.oldX;
          const vy = p.y - p.oldY;
          const vn = vx * nx + vy * ny;
          const tx = vx - vn * nx;
          const ty = vy - vn * ny;
          const mu = Math.min(0.85, fabric.friction * armCap.friction * 1.4);
          p.oldX = p.x - tx * (1 - mu);
          p.oldY = p.y - ty * (1 - mu);

          contactPoints.push({ x: p.x, y: p.y, zone: 'arm', impulse: overlap });
        }
      }

      // B) Lateral Torso / Hip Contour Collision: prevents swinging side hems from clipping inside body silhouette
      if (isOuterEdge) {
        for (const bodyCap of torsoCaps) {
          const { cx, cy, radius } = closestPointOnCapsule(p.x, p.y, bodyCap);
          // Only push if particle is inside vertical span of this torso/hip capsule
          const minYCap = Math.min(bodyCap.p1.y, bodyCap.p2.y) - 6;
          const maxYCap = Math.max(bodyCap.p1.y, bodyCap.p2.y) + 18;
          if (p.y < minYCap || p.y > maxYCap) continue;

          const sideSign = isLeftSide ? -1 : 1;
          const wallRadius = radius * 0.68;
          const targetWallX = cx + sideSign * wallRadius;
          const penetration = isLeftSide ? p.x - targetWallX : targetWallX - p.x;

          if (penetration > 0) {
            p.x = targetWallX;
            // Sliding friction against ribcage / hips
            const vy = p.y - p.oldY;
            const mu = Math.min(0.8, fabric.friction * bodyCap.friction);
            p.oldX = p.x;
            p.oldY = p.y - vy * (1 - mu * 0.65);
            contactPoints.push({
              x: p.x,
              y: p.y,
              zone: bodyCap.zone,
              impulse: penetration,
            });
          }
        }
      }

      // C) Neck / Collarbone Guard: stops fabric riding across throat
      if (neckCap && p.v < 0.25 && p.u > 0.3 && p.u < 0.7) {
        const { cx, cy, radius } = closestPointOnCapsule(p.x, p.y, neckCap);
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist < radius * 0.85 && p.y < cy + radius * 0.4) {
          p.y = cy + radius * 0.4;
          contactPoints.push({ x: p.x, y: p.y, zone: 'neck', impulse: radius - dist });
        }
      }

      // D) Front Torso Ribcage Friction Contact: fabric resting over ribcage feels subtle surface friction
      if (!isOuterEdge && p.v > 0.1 && p.v < 0.55) {
        const ribCap = torsoCaps[0];
        if (ribCap) {
          const { cy } = closestPointOnCapsule(p.x, p.y, ribCap);
          if (Math.abs(p.y - cy) < ribCap.r1 * 1.1) {
            const dragOnChest = 1 - fabric.friction * 0.045;
            const vx = p.x - p.oldX;
            const vy = p.y - p.oldY;
            p.oldX = p.x - vx * dragOnChest;
            p.oldY = p.y - vy * dragOnChest;
          }
        }
      }
    }
  }

  mesh.contactPoints = contactPoints;

  // 6. Compute Real-Time Tension, Strain, and Energy Metrics
  let sumTension = 0;
  let peakStrain = 0;
  let structuralCount = 0;
  const youngModulus = 12 + fabric.stiffness * 3.5;

  for (let s = 0; s < mesh.springs.length; s++) {
    const sp = mesh.springs[s];
    if (sp.type !== 'structural') continue;
    const p1 = mesh.particles[sp.p1];
    const p2 = mesh.particles[sp.p2];
    const curDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const strain = (curDist - sp.restLength) / (sp.restLength || 1);
    sp.strain = strain;

    const absStrain = Math.abs(strain);
    if (absStrain > peakStrain) peakStrain = absStrain;
    sumTension += Math.max(0, strain) * youngModulus;
    structuralCount++;
  }

  mesh.metrics = {
    avgTensionN: structuralCount > 0 ? parseFloat(((sumTension / structuralCount) * 10).toFixed(2)) : 0,
    peakStrainPct: parseFloat((peakStrain * 100).toFixed(1)),
    activeCollisions: contactPoints.length,
    kineticEnergy: parseFloat((totalKinetic / Math.max(1, mesh.particles.length)).toFixed(2)),
  };
}

interface CachedNormalSource {
  w: number;
  h: number;
  basePixels: Uint8ClampedArray;
  sobelNx: Float32Array;
  sobelNy: Float32Array;
  weaveX: Float32Array;
  weaveY: Float32Array;
  outputCanvas: HTMLCanvasElement;
  lastKey: string;
}

const normalSourceCache = new WeakMap<HTMLImageElement, CachedNormalSource>();

/**
 * Generates and caches a tangent-space normal-mapped & specular-lit garment surface texture.
 * Uses precomputed Sobel image normals combined with procedural anisotropic textile weave micro-normals
 * and roughness-controlled Blinn-Phong specular highlights.
 */
export function getNormalMappedClothSurface(
  img: HTMLImageElement,
  surface?: MaterialSurfaceSettings
): HTMLImageElement | HTMLCanvasElement {
  if (!surface) return img;
  const { textureIntensity, roughness, shine } = surface;
  if (textureIntensity <= 1 && shine <= 1) return img;

  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return img;

  let cached = normalSourceCache.get(img);
  if (!cached) {
    const maxDim = 240;
    const scale = Math.min(1, maxDim / Math.max(natW, natH));
    const w = Math.max(16, Math.round(natW * scale));
    const h = Math.max(16, Math.round(natH * scale));

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return img;

    srcCtx.drawImage(img, 0, 0, w, h);
    const imgData = srcCtx.getImageData(0, 0, w, h);
    const basePixels = imgData.data;

    // Derive grayscale heightfield
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
      luma[i] =
        (basePixels[p] * 0.299 + basePixels[p + 1] * 0.587 + basePixels[p + 2] * 0.114) / 255;
    }

    const sobelNx = new Float32Array(w * h);
    const sobelNy = new Float32Array(w * h);
    const weaveX = new Float32Array(w * h);
    const weaveY = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
      const ym1 = y > 0 ? y - 1 : 0;
      const yp1 = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        const xm1 = x > 0 ? x - 1 : 0;
        const xp1 = x < w - 1 ? x + 1 : w - 1;

        const tl = luma[ym1 * w + xm1];
        const tc = luma[ym1 * w + x];
        const tr = luma[ym1 * w + xp1];
        const ml = luma[y * w + xm1];
        const mr = luma[y * w + xp1];
        const bl = luma[yp1 * w + xm1];
        const bc = luma[yp1 * w + x];
        const br = luma[yp1 * w + xp1];

        const idx = y * w + x;
        // Sobel tangent-space slopes
        sobelNx[idx] = tr + 2 * mr + br - (tl + 2 * ml + bl);
        sobelNy[idx] = bl + 2 * bc + br - (tl + 2 * tc + tr);

        // Anisotropic woven textile warp/weft + twill micro-normals
        const warp = Math.cos(x * 1.55 + Math.sin(y * 0.45) * 0.35);
        const weft = Math.cos(y * 1.55 + Math.sin(x * 0.45) * 0.35);
        const twill = Math.sin((x + y) * 1.05) * 0.45;
        weaveX[idx] = warp * 0.65 + twill;
        weaveY[idx] = weft * 0.65 - twill;
      }
    }

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = w;
    outputCanvas.height = h;

    cached = {
      w,
      h,
      basePixels,
      sobelNx,
      sobelNy,
      weaveX,
      weaveY,
      outputCanvas,
      lastKey: '',
    };
    normalSourceCache.set(img, cached);
  }

  const key = `${Math.round(textureIntensity)}_${Math.round(roughness)}_${Math.round(shine)}`;
  if (cached.lastKey === key) {
    return cached.outputCanvas;
  }

  const { w, h, basePixels, sobelNx, sobelNy, weaveX, weaveY, outputCanvas } = cached;
  const outCtx = outputCanvas.getContext('2d');
  if (!outCtx) return img;

  const outData = outCtx.createImageData(w, h);
  const out = outData.data;

  // Normalized studio key light direction L and Blinn-Phong half vector H (view V = [0, 0, 1])
  const rawLx = -0.44;
  const rawLy = -0.58;
  const rawLz = 0.686;
  const lLen = Math.hypot(rawLx, rawLy, rawLz);
  const lx = rawLx / lLen;
  const ly = rawLy / lLen;
  const lz = rawLz / lLen;

  const hxRaw = lx;
  const hyRaw = ly;
  const hzRaw = lz + 1.0;
  const hLen = Math.hypot(hxRaw, hyRaw, hzRaw);
  const hx = hxRaw / hLen;
  const hy = hyRaw / hLen;
  const hz = hzRaw / hLen;

  const texRatio = Math.max(0, Math.min(1, textureIntensity / 100));
  const rough01 = Math.max(0.05, Math.min(0.98, roughness / 100));
  const shineRatio = Math.max(0, Math.min(1, shine / 100));

  const sobelAmp = 0.45 + texRatio * 2.15;
  const microAmp = texRatio * 0.42;
  const shininess = 4 + Math.pow(1 - rough01, 2.2) * 58;
  const specGain = shineRatio * (0.35 + (1 - rough01) * 0.9) * 190;
  const fresnelGain = shineRatio * (1 - rough01 * 0.45) * 68;
  const reliefStrength = 0.14 + texRatio * 0.56;

  for (let i = 0, p = 0; i < sobelNx.length; i++, p += 4) {
    const a = basePixels[p + 3];
    if (a < 4) {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
      continue;
    }

    const nxRaw = sobelNx[i] * sobelAmp + weaveX[i] * microAmp;
    const nyRaw = sobelNy[i] * sobelAmp + weaveY[i] * microAmp;
    const nzRaw = 1.0;
    const invN = 1 / Math.hypot(nxRaw, nyRaw, nzRaw);
    const nx = nxRaw * invN;
    const ny = nyRaw * invN;
    const nz = nzRaw * invN;

    // Lambertian normal relief modulation
    const ndotl = Math.max(0.05, nx * lx + ny * ly + nz * lz);
    const diffuseMod = 1.0 + (ndotl - 0.72) * reliefStrength;

    // Blinn-Phong specular highlight + grazing Fresnel fabric sheen
    const ndoth = Math.max(0, nx * hx + ny * hy + nz * hz);
    const spec = Math.pow(ndoth, shininess) * specGain;
    const fresnel = Math.pow(Math.max(0, 1 - nz * 0.92), 2.2) * fresnelGain;
    const highlight = spec + fresnel;

    out[p] = Math.min(255, Math.max(0, basePixels[p] * diffuseMod + highlight));
    out[p + 1] = Math.min(255, Math.max(0, basePixels[p + 1] * diffuseMod + highlight));
    out[p + 2] = Math.min(255, Math.max(0, basePixels[p + 2] * diffuseMod + highlight));
    out[p + 3] = a;
  }

  outCtx.putImageData(outData, 0, 0);
  cached.lastKey = key;
  return outputCanvas;
}

/**
 * Exact 2D affine texture triangle rasterizer for HTML5 Canvas 2D.
 * Expands the clip boundary by 0.55px outward from centroid to eliminate sub-pixel seams.
 */
export function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  x0: number,
  y0: number,
  u0: number,
  v0: number,
  x1: number,
  y1: number,
  u1: number,
  v1: number,
  x2: number,
  y2: number,
  u2: number,
  v2: number
) {
  const imgW = img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
  const imgH = img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
  if (!imgW || !imgH) return;

  const sx0 = u0 * imgW;
  const sy0 = v0 * imgH;
  const sx1 = u1 * imgW;
  const sy1 = v1 * imgH;
  const sx2 = u2 * imgW;
  const sy2 = v2 * imgH;

  const dsx1 = sx1 - sx0;
  const dsy1 = sy1 - sy0;
  const dsx2 = sx2 - sx0;
  const dsy2 = sy2 - sy0;
  const det = dsx1 * dsy2 - dsy1 * dsx2;
  if (Math.abs(det) < 1e-4) return;

  const dx1 = x1 - x0;
  const dy1 = y1 - y0;
  const dx2 = x2 - x0;
  const dy2 = y2 - y0;

  const inv00 = dsy2 / det;
  const inv01 = -dsx2 / det;
  const inv10 = -dsy1 / det;
  const inv11 = dsx1 / det;

  const a = dx1 * inv00 + dx2 * inv10;
  const b = dy1 * inv00 + dy2 * inv10;
  const c = dx1 * inv01 + dx2 * inv11;
  const d = dy1 * inv01 + dy2 * inv11;
  const e = x0 - a * sx0 - c * sy0;
  const f = y0 - b * sx0 - d * sy0;

  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    return;
  }

  // Expand clip polygon slightly (0.55px) from centroid to seal anti-aliased triangle seams
  const cx = (x0 + x1 + x2) / 3;
  const cy = (y0 + y1 + y2) / 3;
  const expand = (px: number, py: number) => {
    const vx = px - cx;
    const vy = py - cy;
    const len = Math.hypot(vx, vy) || 1;
    return [px + (vx / len) * 0.55, py + (vy / len) * 0.55] as const;
  };
  const [ex0, ey0] = expand(x0, y0);
  const [ex1, ey1] = expand(x1, y1);
  const [ex2, ey2] = expand(x2, y2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ex0, ey0);
  ctx.lineTo(ex1, ey1);
  ctx.lineTo(ex2, ey2);
  ctx.closePath();
  ctx.clip();

  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Renders the deformed cloth mesh onto the canvas with tangent-space normal mapping,
 * dynamic fold drape shading, Blinn-Phong specular fold highlights, optional wireframe & stress heatmap.
 */
export function renderClothMesh(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  mesh: ClothMeshState,
  showWireframe: boolean = false,
  showTensionStress: boolean = false,
  surface?: MaterialSurfaceSettings
) {
  const getIdx = (r: number, c: number) => r * mesh.cols + c;
  const restCellW = mesh.width / Math.max(1, mesh.cols - 1);
  const surfaceTex = getNormalMappedClothSurface(img, surface);

  const shine01 = surface ? Math.max(0, Math.min(1, surface.shine / 100)) : 0.25;
  const rough01 = surface ? Math.max(0.05, Math.min(0.98, surface.roughness / 100)) : 0.6;
  const quadShininess = 3 + Math.pow(1 - rough01, 2.0) * 32;

  // Half-vector matching studio key light
  const hx = -0.35;
  const hy = -0.46;
  const hz = 0.816;

  // 1. Render all quad cells as 2 textured triangles + dynamic fold drape & specular sheen
  for (let r = 0; r < mesh.rows - 1; r++) {
    for (let c = 0; c < mesh.cols - 1; c++) {
      const pTL = mesh.particles[getIdx(r, c)];
      const pTR = mesh.particles[getIdx(r, c + 1)];
      const pBL = mesh.particles[getIdx(r + 1, c)];
      const pBR = mesh.particles[getIdx(r + 1, c + 1)];

      drawTexturedTriangle(
        ctx,
        surfaceTex,
        pTL.x,
        pTL.y,
        pTL.u,
        pTL.v,
        pBL.x,
        pBL.y,
        pBL.u,
        pBL.v,
        pTR.x,
        pTR.y,
        pTR.u,
        pTR.v
      );

      drawTexturedTriangle(
        ctx,
        surfaceTex,
        pTR.x,
        pTR.y,
        pTR.u,
        pTR.v,
        pBL.x,
        pBL.y,
        pBL.u,
        pBL.v,
        pBR.x,
        pBR.y,
        pBR.u,
        pBR.v
      );

      // Compute dynamic fold compression & macro quad surface normal for fold shadows + specular highlights
      const curWidth = ((pTR.x - pTL.x) + (pBR.x - pBL.x)) * 0.5;
      const compression = (restCellW - curWidth) / (restCellW || 1);

      if (r > 0 && Math.abs(compression) > 0.06) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pTL.x, pTL.y);
        ctx.lineTo(pTR.x, pTR.y);
        ctx.lineTo(pBR.x, pBR.y);
        ctx.lineTo(pBL.x, pBL.y);
        ctx.closePath();
        if (compression > 0) {
          ctx.fillStyle = `rgba(15, 23, 42, ${Math.min(0.22, compression * 0.45)})`;
        } else {
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.12, -compression * 0.28)})`;
        }
        ctx.fill();
        ctx.restore();
      }

      // Dynamic macro Blinn-Phong specular highlight ribbon along torso contour & deformed cloth folds
      if (surface && shine01 > 0.04) {
        const uMid = (pTL.u + pTR.u) * 0.5;
        const vMid = (pTL.v + pBL.v) * 0.5;
        const slopeY = ((pTR.y - pTL.y) + (pBR.y - pBL.y)) / (restCellW || 1);
        const qnxRaw = (uMid - 0.5) * 1.45 - compression * 1.1;
        const qnyRaw = (vMid - 0.34) * 0.85 + slopeY * 0.55;
        const qnzRaw = 1.0;
        const qInv = 1 / Math.hypot(qnxRaw, qnyRaw, qnzRaw);
        const ndoth = Math.max(0, (qnxRaw * hx + qnyRaw * hy + qnzRaw * hz) * qInv);
        const specAlpha = Math.pow(ndoth, quadShininess) * shine01 * (0.14 + (1 - rough01) * 0.24);

        if (specAlpha > 0.025) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.beginPath();
          ctx.moveTo(pTL.x, pTL.y);
          ctx.lineTo(pTR.x, pTR.y);
          ctx.lineTo(pBR.x, pBR.y);
          ctx.lineTo(pBL.x, pBL.y);
          ctx.closePath();
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.38, specAlpha)})`;
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  // 2. Optional: Draw dynamic spring wireframe & tension stress heatmap overlay
  if (showWireframe || showTensionStress) {
    ctx.save();
    ctx.lineWidth = showTensionStress ? 1.5 : 1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';

    for (const spring of mesh.springs) {
      if (spring.type === 'bending') continue;
      const p1 = mesh.particles[spring.p1];
      const p2 = mesh.particles[spring.p2];

      if (showTensionStress) {
        const curDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const strain = (curDist - spring.restLength) / (spring.restLength || 1);
        if (strain > 0.04) {
          ctx.strokeStyle = `rgba(244, 63, 94, ${Math.min(0.95, 0.35 + strain * 4.5)})`;
        } else if (strain < -0.04) {
          ctx.strokeStyle = `rgba(59, 130, 246, ${Math.min(0.9, 0.3 + -strain * 4.0)})`;
        } else {
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.42)';
        }
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    if (showWireframe) {
      for (const p of mesh.particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.pinned ? 3.5 : 2.0, 0, Math.PI * 2);
        ctx.fillStyle = p.pinned ? '#38bdf8' : 'rgba(255, 255, 255, 0.8)';
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // 3. Draw active cursor grab tug target
  if (mesh.grabbedIndex !== null && mesh.grabbedPoint) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(mesh.grabbedPoint.x, mesh.grabbedPoint.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f43f5e';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Visualizes anatomical body collision capsules and live garment contact points.
 */
export function drawBodyCollisionMesh(
  ctx: CanvasRenderingContext2D,
  colliders: BodyCollisionCapsule[],
  contactPoints: ClothContactPoint[] = []
) {
  ctx.save();

  for (const cap of colliders) {
    const dx = cap.p2.x - cap.p1.x;
    const dy = cap.p2.y - cap.p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    ctx.beginPath();
    ctx.moveTo(cap.p1.x + nx * cap.r1, cap.p1.y + ny * cap.r1);
    ctx.lineTo(cap.p2.x + nx * cap.r2, cap.p2.y + ny * cap.r2);
    ctx.lineTo(cap.p2.x - nx * cap.r2, cap.p2.y - ny * cap.r2);
    ctx.lineTo(cap.p1.x - nx * cap.r1, cap.p1.y - ny * cap.r1);
    ctx.closePath();

    ctx.fillStyle =
      cap.zone === 'arm'
        ? 'rgba(168, 85, 247, 0.08)'
        : 'rgba(34, 211, 238, 0.09)';
    ctx.fill();

    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle =
      cap.zone === 'arm'
        ? 'rgba(192, 132, 252, 0.55)'
        : 'rgba(34, 211, 238, 0.55)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const cp of contactPoints) {
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, Math.min(5.5, 2.5 + cp.impulse * 0.25), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 146, 60, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Creates a dynamic catenary pendulum chain for jewelry/necklaces.
 */
export function createPendantPhysics(
  leftAnchor: Point,
  rightAnchor: Point,
  chainLengthPx: number,
  numLinks: number = 6
): PendantPhysicsState {
  const links: Point[] = [];
  const oldLinks: Point[] = [];
  const lengths: number[] = [];

  const dx = (rightAnchor.x - leftAnchor.x) / (numLinks - 1);
  const segLen = chainLengthPx / (numLinks - 1);

  for (let i = 0; i < numLinks; i++) {
    const u = i / (numLinks - 1);
    const sag = Math.sin(u * Math.PI) * (chainLengthPx * 0.4);
    const x = leftAnchor.x + i * dx;
    const y = leftAnchor.y + sag;

    links.push({ x, y });
    oldLinks.push({ x, y });
    lengths.push(segLen);
  }

  return {
    links,
    oldLinks,
    lengths,
    leftAnchor,
    rightAnchor,
    pendantWeight: 1.2,
  };
}

/**
 * Steps catenary pendulum physics simulation for necklaces.
 */
export function stepPendantPhysics(
  state: PendantPhysicsState,
  leftAnchor: Point,
  rightAnchor: Point,
  wind: Point,
  damping: number = 0.94
) {
  state.leftAnchor = leftAnchor;
  state.rightAnchor = rightAnchor;
  state.links[0] = { ...leftAnchor };
  state.links[state.links.length - 1] = { ...rightAnchor };

  const num = state.links.length;
  const apexIdx = Math.floor(num / 2);

  // Verlet step on interior links
  for (let i = 1; i < num - 1; i++) {
    const p = state.links[i];
    const old = state.oldLinks[i];

    const vx = (p.x - old.x) * damping;
    const vy = (p.y - old.y) * damping;

    state.oldLinks[i] = { ...p };

    const weight = i === apexIdx ? state.pendantWeight : 0.6;
    p.x += vx + wind.x * 0.3;
    p.y += vy + 0.45 * weight + wind.y * 0.2;
  }

  // Constraint relaxation
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < num - 1; i++) {
      const p1 = state.links[i];
      const p2 = state.links[i + 1];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const diff = (dist - state.lengths[i]) / dist;

      const ox = dx * 0.5 * diff;
      const oy = dy * 0.5 * diff;

      if (i > 0) {
        p1.x += ox;
        p1.y += oy;
      }
      if (i + 1 < num - 1) {
        p2.x -= ox;
        p2.y -= oy;
      }
    }
  }
}
