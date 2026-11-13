import { Point } from '../types/face';
import {
  BodyLandmarks,
  ClothMotionPreset,
  ClothParticle,
  ClothPhysicsConfig,
  ClothSpring,
} from '../types/body';

export type { ClothPhysicsConfig };

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
  }
> = {
  silk: {
    label: 'Silk / Chiffon',
    description: 'Ultra-light, high fluidity, responsive to gentle air drafts',
    damping: 0.97,
    gravity: 0.32,
    stiffness: 2,
    windSusceptibility: 1.8,
  },
  cotton: {
    label: 'Organic Cotton',
    description: 'Medium weight, balanced drape, moderate structure',
    damping: 0.94,
    gravity: 0.5,
    stiffness: 4,
    windSusceptibility: 1.0,
  },
  wool: {
    label: 'Tailored Wool',
    description: 'Structured silhouette, higher inertia, stable tailored drape',
    damping: 0.9,
    gravity: 0.65,
    stiffness: 6,
    windSusceptibility: 0.6,
  },
  leather: {
    label: 'Heavy Leather / Denim',
    description: 'Rigid structure, heavy drape, high stiffness and crease memory',
    damping: 0.86,
    gravity: 0.78,
    stiffness: 8,
    windSusceptibility: 0.35,
  },
};

export interface ClothMeshState {
  particles: ClothParticle[];
  springs: ClothSpring[];
  cols: number;
  rows: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  grabbedIndex: number | null;
  grabbedPoint: Point | null;
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
 * Creates a mass-spring lattice grid for dynamic cloth simulation.
 */
export function createClothGrid(
  startX: number,
  startY: number,
  width: number,
  height: number,
  cols = 7,
  rows = 8,
  shoulderSpan = width
): ClothMeshState {
  const particles: ClothParticle[] = [];
  const springs: ClothSpring[] = [];

  const dx = width / (cols - 1);
  const dy = height / (rows - 1);

  // Initialize particles
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);

      // Natural anatomical curvature: top collar dips slightly in the middle
      let neckCurveOffset = 0;
      if (r === 0) {
        neckCurveOffset = Math.sin(u * Math.PI) * (dy * 0.45);
      }

      // Torso taper: slight hourglass narrowing towards the waist (rows 3..5)
      const waistTaper = 1 - Math.sin(v * Math.PI) * 0.08 * (u - 0.5);

      const px = startX - width / 2 + c * dx * waistTaper;
      const py = startY + r * dy + neckCurveOffset;

      const isPinned = r === 0; // Top row anchored to shoulder skeletal line

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
    width,
    height,
    anchorX: startX,
    anchorY: startY,
    grabbedIndex: null,
    grabbedPoint: null,
  };
}

/**
 * Computes dynamic movement, breathing chest expansion, and posture tilts.
 */
export function computePostureDynamics(
  timeSec: number,
  config: ClothPhysicsConfig,
  baseLandmarks: BodyLandmarks
) {
  const speed = config.motionSpeed;
  const t = timeSec * speed;

  let dynamicTiltDeg = config.postureTilt;
  let dynamicTurnDeg = config.postureTurn;
  let shiftX = 0;
  let shiftY = 0;
  let chestExp = config.chestExpansion;

  if (config.isSimulating) {
    switch (config.preset) {
      case 'breathing': {
        // Subtle natural chest rise & fall (every ~3.5 seconds)
        const breath = Math.sin(t * 1.8);
        chestExp += breath * 4.5;
        shiftY += breath * 1.5;
        dynamicTiltDeg += Math.sin(t * 0.9) * 0.6;
        break;
      }
      case 'walking': {
        // Rhythmic shoulder dip & hip counter-sway
        shiftX += Math.sin(t * 3.2) * 9.0;
        shiftY += Math.abs(Math.sin(t * 6.4)) * 4.0;
        dynamicTiltDeg += Math.sin(t * 3.2) * 3.8;
        dynamicTurnDeg += Math.cos(t * 3.2) * 4.2;
        break;
      }
      case 'breeze': {
        // Natural wind sway
        shiftX += Math.sin(t * 1.4) * 3.0;
        dynamicTiltDeg += Math.sin(t * 2.1) * 1.4;
        break;
      }
      case 'dance': {
        // Flowing expressive body rhythm
        shiftX += Math.sin(t * 2.5) * 14.0;
        shiftY += Math.cos(t * 5.0) * 6.0;
        dynamicTiltDeg += Math.sin(t * 2.5) * 6.5;
        dynamicTurnDeg += Math.cos(t * 2.5) * 7.0;
        chestExp += Math.sin(t * 3.5) * 6.0;
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

  // Compute dynamic skeletal positions based on posture tilts
  const rad = (dynamicTiltDeg * Math.PI) / 180;
  const cosT = Math.cos(rad);
  const sinT = Math.sin(rad);

  const pivotX = (baseLandmarks.leftShoulder.x + baseLandmarks.rightShoulder.x) / 2;
  const pivotY = (baseLandmarks.leftShoulder.y + baseLandmarks.rightShoulder.y) / 2;

  const rotatePt = (p: Point): Point => {
    const rx = p.x - pivotX;
    const ry = p.y - pivotY;
    return {
      x: pivotX + (rx * cosT - ry * sinT) + shiftX,
      y: pivotY + (rx * sinT + ry * cosT) + shiftY,
    };
  };

  const dynamicLandmarks: BodyLandmarks = {
    ...baseLandmarks,
    leftShoulder: rotatePt(baseLandmarks.leftShoulder),
    rightShoulder: rotatePt(baseLandmarks.rightShoulder),
    neck: rotatePt(baseLandmarks.neck),
    throat: rotatePt(baseLandmarks.throat),
    sternum: rotatePt(baseLandmarks.sternum),
    leftChest: rotatePt(baseLandmarks.leftChest),
    rightChest: rotatePt(baseLandmarks.rightChest),
    leftWaist: rotatePt(baseLandmarks.leftWaist),
    rightWaist: rotatePt(baseLandmarks.rightWaist),
    navel: rotatePt(baseLandmarks.navel),
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
 * Updates cloth mass-spring simulation using Verlet integration with anatomical body collision.
 */
export function stepClothMesh(
  mesh: ClothMeshState,
  config: ClothPhysicsConfig,
  shoulderLeft: Point,
  shoulderRight: Point,
  sternum: Point,
  wind: Point,
  chestExpansion: number
) {
  const fabric = FABRIC_PROPERTIES[config.fabricType] || FABRIC_PROPERTIES.wool;
  const airDrag = 1.0 - ((config.airResistance ?? 65) / 100) * 0.12;
  const damping = fabric.damping * config.damping * airDrag;
  const gravity = fabric.gravity * config.gravity;
  const stiffnessPasses = Math.min(8, Math.max(1, config.stiffness));
  const windSusceptibility = fabric.windSusceptibility;

  const shoulderVecX = shoulderRight.x - shoulderLeft.x;
  const shoulderVecY = shoulderRight.y - shoulderLeft.y;
  const shoulderLen = Math.hypot(shoulderVecX, shoulderVecY) || 1;
  const normX = shoulderVecX / shoulderLen;
  const normY = shoulderVecY / shoulderLen;
  const perpX = -normY;
  const perpY = normX;

  const shoulderMidX = (shoulderLeft.x + shoulderRight.x) / 2;
  const shoulderMidY = (shoulderLeft.y + shoulderRight.y) / 2;

  // 1. Position pinned particles along the dynamic shoulder / clavicle arc
  for (let c = 0; c < mesh.cols; c++) {
    const p = mesh.particles[c]; // top row
    const u = c / (mesh.cols - 1);
    const spanOffset = (u - 0.5) * (shoulderLen * 1.25);
    const collarDip = Math.sin(u * Math.PI) * (mesh.height * 0.05);

    p.x = shoulderMidX + normX * spanOffset + perpX * collarDip;
    p.y = shoulderMidY + normY * spanOffset + perpY * collarDip;
    p.oldX = p.x;
    p.oldY = p.y;
  }

  // 2. Verlet integration on unpinned particles
  for (let i = mesh.cols; i < mesh.particles.length; i++) {
    const p = mesh.particles[i];

    // If particle is user-grabbed, keep at pointer position
    if (mesh.grabbedIndex === i && mesh.grabbedPoint) {
      p.x = mesh.grabbedPoint.x;
      p.y = mesh.grabbedPoint.y;
      continue;
    }

    const vx = (p.x - p.oldX) * damping;
    const vy = (p.y - p.oldY) * damping;

    p.oldX = p.x;
    p.oldY = p.y;

    // Aerodynamic Air Lift, Turbulence & Gravity
    const hemRatio = p.v; // 0 at top collar, 1 at bottom hem
    const airFlutter = Math.sin(p.u * Math.PI * 4 + p.x * 0.04) * (config.windTurbulence || 0.45) * (hemRatio * 1.6);
    const windFx = (wind.x + airFlutter) * windSusceptibility * (0.25 + hemRatio * 1.1);
    const windFy = wind.y * windSusceptibility * (0.15 + hemRatio * 0.6);

    p.x += vx + windFx;
    p.y += vy + gravity + windFy;

    // 3. Torso Ellipsoidal Collision Constraint
    // Prevents cloth from collapsing inside the body silhouette
    const torsoCenterX = shoulderMidX;
    const torsoCenterY = sternum.y + (p.v - 0.3) * (mesh.height * 0.4);
    const torsoRadiusX = (shoulderLen * 0.48) + chestExpansion * 0.3;
    const torsoRadiusY = mesh.height * 0.45;

    const dx = p.x - torsoCenterX;
    const dy = p.y - torsoCenterY;
    const normDist = (dx * dx) / (torsoRadiusX * torsoRadiusX) + (dy * dy) / (torsoRadiusY * torsoRadiusY);

    if (normDist < 0.65) {
      // Particle entered inner torso volume: project outward
      const angle = Math.atan2(dy, dx);
      const targetRadiusX = torsoRadiusX * 0.82;
      p.x = torsoCenterX + Math.cos(angle) * targetRadiusX;
      p.y = torsoCenterY + Math.sin(angle) * (torsoRadiusY * 0.82);
    }
  }

  // 4. Relaxation passes for distance spring constraints
  for (let pass = 0; pass < stiffnessPasses; pass++) {
    for (let s = 0; s < mesh.springs.length; s++) {
      const spring = mesh.springs[s];
      const p1 = mesh.particles[spring.p1];
      const p2 = mesh.particles[spring.p2];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const diff = (dist - spring.restLength) / dist;

      const stiffness = spring.stiffness * (spring.type === 'structural' ? 1.0 : 0.7);

      const offsetX = dx * 0.5 * diff * stiffness;
      const offsetY = dy * 0.5 * diff * stiffness;

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
}

/**
 * Affine texture triangle rasterizer for HTML5 Canvas 2D.
 * Maps texture triangle (u0,v0)-(u1,v1)-(u2,v2) from image into destination screen coordinates (x0,y0)-(x1,y1)-(x2,y2).
 */
export function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
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
  // Convert relative UV coordinates (0..1) to source image pixel coordinates
  const sx0 = u0 * img.naturalWidth;
  const sy0 = v0 * img.naturalHeight;
  const sx1 = u1 * img.naturalWidth;
  const sy1 = v1 * img.naturalHeight;
  const sx2 = u2 * img.naturalWidth;
  const sy2 = v2 * img.naturalHeight;

  ctx.save();

  // Clip to destination screen triangle
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();

  // Compute 2D Affine transformation mapping from (sx, sy) -> (x, y)
  // [ x ]   [ a c e ] [ sx ]
  // [ y ] = [ b d f ] [ sy ]
  // [ 1 ]   [ 0 0 1 ] [ 1  ]
  const delta = sx0 * (sy1 - sy2) - sy0 * (sx1 - sx2) + (sx1 * sy2 - sx2 * sy1);

  if (Math.abs(delta) > 0.001) {
    const a = -(sy0 * (x1 - x2) - sy1 * x0 + sy2 * x0 + (x1 * sy2 - x2 * sy1)) / delta;
    const b = -(sy0 * (y1 - y2) - sy1 * y0 + sy2 * y0 + (y1 * sy2 - x2 * sy1)) / delta;
    const c = (sx0 * (x1 - x2) - sx1 * x0 + sx2 * x0 + (x1 * sx2 - sx2 * sx1)) / delta;
    const d = (sx0 * (y1 - y2) - sx1 * y0 + sx2 * y0 + (y1 * sy2 - sy2 * sy1)) / delta;
    const e =
      (sx0 * (sy1 * x2 - sy2 * x1) - sy0 * (sx1 * x2 - sx2 * x1) + (sx1 * sy2 - sx2 * sy1) * x0) / delta;
    const f =
      (sx0 * (sy1 * y2 - sy2 * y1) - sy0 * (sx1 * y2 - sx2 * y1) + (sx1 * sy2 - sx2 * sy1) * y0) / delta;

    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
  }

  ctx.restore();
}

/**
 * Renders the deformed cloth mesh onto the canvas with optional spring wireframe & tension heatmap.
 */
export function renderClothMesh(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  mesh: ClothMeshState,
  showWireframe: boolean = false,
  showTensionStress: boolean = false
) {
  const getIdx = (r: number, c: number) => r * mesh.cols + c;

  // 1. Render all quad cells as 2 textured triangles
  for (let r = 0; r < mesh.rows - 1; r++) {
    for (let c = 0; c < mesh.cols - 1; c++) {
      const pTL = mesh.particles[getIdx(r, c)];
      const pTR = mesh.particles[getIdx(r, c + 1)];
      const pBL = mesh.particles[getIdx(r + 1, c)];
      const pBR = mesh.particles[getIdx(r + 1, c + 1)];

      // Triangle 1 (TL -> BL -> TR)
      drawTexturedTriangle(
        ctx,
        img,
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

      // Triangle 2 (TR -> BL -> BR)
      drawTexturedTriangle(
        ctx,
        img,
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
    }
  }

  // 2. Optional: Draw dynamic spring wireframe overlay
  if (showWireframe) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'; // cyan-400 wireframe

    for (const spring of mesh.springs) {
      if (spring.type === 'bending') continue; // keep visual wireframe clean
      const p1 = mesh.particles[spring.p1];
      const p2 = mesh.particles[spring.p2];

      if (showTensionStress) {
        const curDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const strain = (curDist - spring.restLength) / spring.restLength;
        // Green = neutral, Red = tension stretch, Blue = compression
        if (strain > 0.1) {
          ctx.strokeStyle = `rgba(239, 68, 68, ${Math.min(0.9, strain * 4)})`;
        } else if (strain < -0.1) {
          ctx.strokeStyle = `rgba(99, 102, 241, ${Math.min(0.9, -strain * 4)})`;
        } else {
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
        }
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Joint Particles
    for (const p of mesh.particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.pinned ? 3.5 : 2.0, 0, Math.PI * 2);
      ctx.fillStyle = p.pinned ? '#38bdf8' : 'rgba(255, 255, 255, 0.8)';
      ctx.fill();
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
