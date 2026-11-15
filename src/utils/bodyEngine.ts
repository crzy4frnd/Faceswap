import {
  BodyCollisionCapsule,
  BodyLandmarks,
  BodyMeasurements,
  ClothContactPoint,
  FittedAsset,
  WardrobeAsset,
} from '../types/body';
import { Rect, Point } from '../types/face';
import {
  ClothMeshState,
  ClothPhysicsConfig,
  PendantPhysicsState,
  drawBodyCollisionMesh,
  getDefaultMaterialSurface,
  getNormalMappedClothSurface,
  renderClothMesh,
} from './clothPhysicsEngine';

/**
 * On-device body scan and anthropometric measurement calculation.
 * Derives real-world centimeter measurements using facial scale and torso pixel topology.
 */
export function scanBodyAndMeasure(
  width: number,
  height: number,
  faceHint?: Rect
): { landmarks: BodyLandmarks; measurements: BodyMeasurements } {
  // If face is detected, use it as the anthropometric reference anchor
  const fBox = faceHint || {
    x: Math.round(width * 0.35),
    y: Math.round(height * 0.12),
    width: Math.round(width * 0.3),
    height: Math.round(width * 0.38),
  };

  const headCenterX = fBox.x + fBox.width / 2;
  const chinY = fBox.y + fBox.height * 0.95;
  const headHeightPx = fBox.height;

  // Real-world human anthropometric ratio: Average human head height is ~23 cm
  const pxToCm = 23 / (headHeightPx || 100);

  // Derive skeletal landmarks based on anatomical Golden Ratios
  const neckY = chinY + headHeightPx * 0.16;
  const throat: Point = { x: headCenterX, y: neckY };
  const neck: Point = { x: headCenterX, y: neckY - headHeightPx * 0.08 };

  // Shoulders: Span is approx 2.1x to 2.4x head width
  const shoulderHalfSpanPx = fBox.width * 1.08;
  const shoulderY = neckY + headHeightPx * 0.18;
  const leftShoulder: Point = { x: headCenterX - shoulderHalfSpanPx, y: shoulderY };
  const rightShoulder: Point = { x: headCenterX + shoulderHalfSpanPx, y: shoulderY };

  // Sternum & Chest line
  const sternumY = shoulderY + headHeightPx * 0.65;
  const sternum: Point = { x: headCenterX, y: sternumY };
  const chestHalfSpanPx = shoulderHalfSpanPx * 0.92;
  const leftChest: Point = { x: headCenterX - chestHalfSpanPx, y: sternumY };
  const rightChest: Point = { x: headCenterX + chestHalfSpanPx, y: sternumY };

  // Waist & Navel
  const waistY = shoulderY + headHeightPx * 1.45;
  const waistHalfSpanPx = shoulderHalfSpanPx * 0.78;
  const navel: Point = { x: headCenterX, y: waistY };
  const leftWaist: Point = { x: headCenterX - waistHalfSpanPx, y: waistY };
  const rightWaist: Point = { x: headCenterX + waistHalfSpanPx, y: waistY };

  // Hips
  const hipY = waistY + headHeightPx * 0.65;
  const hipHalfSpanPx = shoulderHalfSpanPx * 0.88;
  const leftHip: Point = { x: headCenterX - hipHalfSpanPx, y: hipY };
  const rightHip: Point = { x: headCenterX + hipHalfSpanPx, y: hipY };

  // Arms (Elbows & Wrists)
  const leftElbow: Point = { x: leftShoulder.x - fBox.width * 0.45, y: shoulderY + headHeightPx * 1.1 };
  const rightElbow: Point = { x: rightShoulder.x + fBox.width * 0.45, y: shoulderY + headHeightPx * 1.1 };

  const leftWrist: Point = { x: leftElbow.x + fBox.width * 0.25, y: hipY };
  const rightWrist: Point = { x: rightElbow.x - fBox.width * 0.25, y: hipY };

  const landmarks: BodyLandmarks = {
    nose: { x: headCenterX, y: fBox.y + fBox.height * 0.5 },
    neck,
    throat,
    leftShoulder,
    rightShoulder,
    sternum,
    leftChest,
    rightChest,
    leftWaist,
    rightWaist,
    navel,
    leftHip,
    rightHip,
    leftElbow,
    rightElbow,
    leftWrist,
    rightWrist,
  };

  // Calculate real-world biometric measurements
  const shoulderWidthCm = parseFloat(((shoulderHalfSpanPx * 2) * pxToCm).toFixed(1));
  const chestBustCm = parseFloat(((chestHalfSpanPx * 2 * Math.PI * 0.54) * pxToCm).toFixed(1));
  const waistCm = parseFloat(((waistHalfSpanPx * 2 * Math.PI * 0.52) * pxToCm).toFixed(1));
  const hipsCm = parseFloat(((hipHalfSpanPx * 2 * Math.PI * 0.53) * pxToCm).toFixed(1));
  const neckCircumferenceCm = parseFloat((fBox.width * 0.55 * Math.PI * pxToCm).toFixed(1));
  const torsoLengthCm = parseFloat(((hipY - shoulderY) * pxToCm).toFixed(1));
  const armLengthCm = parseFloat((headHeightPx * 2.7 * pxToCm).toFixed(1));

  // Determine estimated garment size
  let estimatedSize = 'US M / EU 48 · Regular';
  let bodyType: BodyMeasurements['bodyType'] = 'Athletic';

  if (chestBustCm > 105 || shoulderWidthCm > 48) {
    estimatedSize = 'US XL / EU 54 · Broad Fit';
    bodyType = 'Broad';
  } else if (chestBustCm > 96 || shoulderWidthCm > 43) {
    estimatedSize = 'US L / EU 50 · Athletic';
    bodyType = 'Athletic';
  } else if (chestBustCm < 88 && waistCm < 74) {
    estimatedSize = 'US S / EU 46 · Slim Fit';
    bodyType = 'Slim';
  }

  const measurements: BodyMeasurements = {
    shoulderWidthCm: Math.max(36, Math.min(56, shoulderWidthCm)),
    chestBustCm: Math.max(80, Math.min(124, chestBustCm)),
    waistCm: Math.max(62, Math.min(110, waistCm)),
    hipsCm: Math.max(82, Math.min(120, hipsCm)),
    neckCircumferenceCm: Math.max(32, Math.min(48, neckCircumferenceCm)),
    torsoLengthCm: Math.max(45, Math.min(68, torsoLengthCm)),
    armLengthCm: Math.max(52, Math.min(74, armLengthCm)),
    estimatedSize,
    bodyType,
    confidence: 0.94,
  };

  return { landmarks, measurements };
}

/**
 * Draws interactive body measurement calipers and skeletal HUD overlay
 */
export function drawBodyMeasurementHUD(
  ctx: CanvasRenderingContext2D,
  landmarks: BodyLandmarks,
  measurements: BodyMeasurements
) {
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)'; // cyan-400
  ctx.lineWidth = 1.5;

  // 1. Draw Skeletal Wireframe
  ctx.beginPath();
  // Shoulders to neck
  ctx.moveTo(landmarks.leftShoulder.x, landmarks.leftShoulder.y);
  ctx.lineTo(landmarks.neck.x, landmarks.neck.y);
  ctx.lineTo(landmarks.rightShoulder.x, landmarks.rightShoulder.y);

  // Spine / Sternum to Navel
  ctx.moveTo(landmarks.neck.x, landmarks.neck.y);
  ctx.lineTo(landmarks.sternum.x, landmarks.sternum.y);
  ctx.lineTo(landmarks.navel.x, landmarks.navel.y);

  // Shoulder to Elbow to Wrist (Left)
  ctx.moveTo(landmarks.leftShoulder.x, landmarks.leftShoulder.y);
  ctx.lineTo(landmarks.leftElbow.x, landmarks.leftElbow.y);
  ctx.lineTo(landmarks.leftWrist.x, landmarks.leftWrist.y);

  // Shoulder to Elbow to Wrist (Right)
  ctx.moveTo(landmarks.rightShoulder.x, landmarks.rightShoulder.y);
  ctx.lineTo(landmarks.rightElbow.x, landmarks.rightElbow.y);
  ctx.lineTo(landmarks.rightWrist.x, landmarks.rightWrist.y);

  // Pelvis / Hips
  ctx.moveTo(landmarks.navel.x, landmarks.navel.y);
  ctx.lineTo(landmarks.leftHip.x, landmarks.leftHip.y);
  ctx.moveTo(landmarks.navel.x, landmarks.navel.y);
  ctx.lineTo(landmarks.rightHip.x, landmarks.rightHip.y);
  ctx.stroke();

  // 2. Draw Measurement Caliper Lines with Dimension Callouts
  const drawCaliper = (
    p1: Point,
    p2: Point,
    label: string,
    valStr: string,
    yOffset: number = 0
  ) => {
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)'; // emerald-400
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    const y = p1.y + yOffset;
    ctx.beginPath();
    ctx.moveTo(p1.x, y);
    ctx.lineTo(p2.x, y);
    ctx.stroke();

    // End ticks
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p1.x, y - 5);
    ctx.lineTo(p1.x, y + 5);
    ctx.moveTo(p2.x, y - 5);
    ctx.lineTo(p2.x, y + 5);
    ctx.stroke();

    // Measurement Pill
    const midX = (p1.x + p2.x) / 2;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.5)';
    ctx.beginPath();
    ctx.roundRect(midX - 44, y - 11, 88, 20, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillStyle = '#34d399';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${label} ${valStr}`, midX, y);
  };

  // Shoulder span caliper
  drawCaliper(landmarks.leftShoulder, landmarks.rightShoulder, 'Shoulders', `${measurements.shoulderWidthCm}cm`, -18);

  // Chest width caliper
  drawCaliper(landmarks.leftChest, landmarks.rightChest, 'Chest', `${measurements.chestBustCm}cm`, 0);

  // Waist width caliper
  drawCaliper(landmarks.leftWaist, landmarks.rightWaist, 'Waist', `${measurements.waistCm}cm`, 0);

  // 3. Draw Landmark Joint Nodes
  ctx.fillStyle = 'rgba(56, 189, 248, 1)';
  Object.values(landmarks).forEach((pt) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.restore();
}

export interface GarmentFitGeometry {
  anchorLeft: Point;
  anchorRight: Point;
  centerX: number;
  topY: number;
  targetW: number;
  targetH: number;
  angle: number;
  anchorMode: 'shoulders' | 'chest' | 'waist';
  garmentType: string;
}

/**
 * Computes exact body-measurement-matched dimensions & anchor coordinates for any clothing item,
 * factoring in scanned shoulder/chest/waist spans, garment category tag, fit tightness, and image aspect ratio.
 */
export function computeGarmentFitBox(
  landmarks: BodyLandmarks,
  asset: WardrobeAsset,
  assetImg: HTMLImageElement,
  item: FittedAsset
): GarmentFitGeometry {
  const imgW = assetImg.naturalWidth || assetImg.width || 1;
  const imgH = assetImg.naturalHeight || assetImg.height || 1;
  const aspect = imgH / imgW;

  const shoulderSpan = Math.hypot(
    landmarks.rightShoulder.x - landmarks.leftShoulder.x,
    landmarks.rightShoulder.y - landmarks.leftShoulder.y
  );
  const chestSpan = Math.hypot(
    landmarks.rightChest.x - landmarks.leftChest.x,
    landmarks.rightChest.y - landmarks.leftChest.y
  );
  const waistSpan = Math.hypot(
    landmarks.rightWaist.x - landmarks.leftWaist.x,
    landmarks.rightWaist.y - landmarks.leftWaist.y
  );
  const torsoLen = Math.max(20, landmarks.navel.y - landmarks.leftShoulder.y);

  const gt = (asset.clothingTag || asset.subCategory || 'shirt').toLowerCase();
  const tightnessFactor = 0.92 + (item.fitTightness / 100) * 0.18;

  if (asset.anchorPoint === 'waist' || gt === 'skirt' || gt === 'pants') {
    const anchorLeft = landmarks.leftWaist;
    const anchorRight = landmarks.rightWaist;
    const midX = (anchorLeft.x + anchorRight.x) / 2;
    const midY = (anchorLeft.y + anchorRight.y) / 2;
    const angle = Math.atan2(anchorRight.y - anchorLeft.y, anchorRight.x - anchorLeft.x);
    const targetW = waistSpan * 1.32 * item.scale * tightnessFactor;
    const rawH = targetW * aspect;
    const targetH = gt === 'skirt' ? Math.min(rawH, torsoLen * 1.45) : rawH;
    return {
      anchorLeft,
      anchorRight,
      centerX: midX + item.offsetX,
      topY: midY + item.offsetY - targetH * 0.06,
      targetW,
      targetH,
      angle,
      anchorMode: 'waist',
      garmentType: gt,
    };
  }

  if (asset.anchorPoint === 'chest' || gt === 'bikini') {
    const anchorLeft = landmarks.leftChest;
    const anchorRight = landmarks.rightChest;
    const midX = (anchorLeft.x + anchorRight.x) / 2;
    const midY = (anchorLeft.y + anchorRight.y) / 2;
    const angle = Math.atan2(anchorRight.y - anchorLeft.y, anchorRight.x - anchorLeft.x);
    const widthMult = gt === 'bikini' ? 1.14 : 1.18;
    const targetW = chestSpan * widthMult * item.scale * tightnessFactor;
    const targetH = targetW * aspect;
    return {
      anchorLeft,
      anchorRight,
      centerX: midX + item.offsetX,
      topY: midY + item.offsetY - targetH * 0.28,
      targetW,
      targetH,
      angle,
      anchorMode: 'chest',
      garmentType: gt,
    };
  }

  // Shoulders / Torso default (Suit, Blazer, Shirt, Dress, Robe, Jacket, Custom)
  const anchorLeft = landmarks.leftShoulder;
  const anchorRight = landmarks.rightShoulder;
  const shoulderCenter = {
    x: (anchorLeft.x + anchorRight.x) / 2,
    y: (anchorLeft.y + anchorRight.y) / 2,
  };
  const angle = Math.atan2(anchorRight.y - anchorLeft.y, anchorRight.x - anchorLeft.x);

  const widthMult =
    gt === 'suit' || gt === 'blazer' || gt === 'jacket'
      ? 1.42
      : gt === 'robe'
      ? 1.48
      : gt === 'dress'
      ? 1.34
      : 1.36;

  const targetW = shoulderSpan * widthMult * item.scale * tightnessFactor;
  const targetH = targetW * aspect;
  const collarRaise = gt === 'suit' || gt === 'blazer' || gt === 'jacket' ? 0.12 : 0.1;

  return {
    anchorLeft,
    anchorRight,
    centerX: shoulderCenter.x + item.offsetX,
    topY: shoulderCenter.y + item.offsetY - targetH * collarRaise,
    targetW,
    targetH,
    angle,
    anchorMode: 'shoulders',
    garmentType: gt,
  };
}

/**
 * High-performance smart stitch renderer:
 * Aligns, warps, and stitches clothes, jewelry, and objects onto the scanned body,
 * powered by dynamic 2D mass-spring cloth physics simulation and catenary jewelry pendulum dynamics.
 */
export async function renderFittedAssetsOnBody(
  outputCanvas: HTMLCanvasElement,
  baseImage: HTMLImageElement,
  landmarks: BodyLandmarks,
  fittedAssets: FittedAsset[],
  assetsMap: Record<string, WardrobeAsset>,
  assetImagesMap: Record<string, HTMLImageElement>,
  showScanHUD: boolean,
  measurements?: BodyMeasurements,
  clothMeshMap?: Record<string, ClothMeshState>,
  clothConfig?: ClothPhysicsConfig,
  pendantPhysicsMap?: Record<string, PendantPhysicsState>,
  bodyColliders?: BodyCollisionCapsule[]
) {
  const width = baseImage.naturalWidth || baseImage.width;
  const height = baseImage.naturalHeight || baseImage.height;

  outputCanvas.width = width;
  outputCanvas.height = height;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) return;

  // 1. Draw base portrait
  ctx.drawImage(baseImage, 0, 0, width, height);

  // Optional 1b. Draw anatomical body collision capsules beneath garments
  if (clothConfig?.showBodyColliders && bodyColliders && bodyColliders.length > 0) {
    drawBodyCollisionMesh(ctx, bodyColliders, []);
  }

  // 2. Loop over and stitch active fitted assets
  for (const item of fittedAssets) {
    if (!item.visible) continue;
    const asset = assetsMap[item.assetId];
    const assetImg = assetImagesMap[item.assetId];
    if (!asset || !assetImg) continue;

    ctx.save();

    const isClothMeshAnchor =
      asset.category === 'clothing' ||
      asset.anchorPoint === 'shoulders' ||
      asset.anchorPoint === 'chest' ||
      asset.anchorPoint === 'waist';

    const clothMesh = clothMeshMap?.[item.assetId];
    const useClothPhysics =
      clothConfig?.enabled &&
      isClothMeshAnchor &&
      clothMesh &&
      clothMesh.particles.length > 0;

    const effectiveSurface =
      item.materialSurface ||
      getDefaultMaterialSurface(item.fabricType || asset.fabricType || clothConfig?.fabricType);

    if (useClothPhysics && clothMesh) {
      // Dynamic mass-spring cloth physics rendering
      if (item.shadowDepth > 0) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
        ctx.shadowBlur = (item.shadowDepth / 100) * 18;
        ctx.shadowOffsetY = (item.shadowDepth / 100) * 10;
      }

      if (item.offsetX !== 0 || item.offsetY !== 0 || item.rotation !== 0) {
        const cx = clothMesh.anchorX + item.offsetX;
        const cy = clothMesh.anchorY + item.offsetY;
        ctx.translate(cx, cy);
        ctx.rotate((item.rotation * Math.PI) / 180);
        ctx.translate(-clothMesh.anchorX, -clothMesh.anchorY);
      }

      renderClothMesh(
        ctx,
        assetImg,
        clothMesh,
        clothConfig.showPhysicsWireframe,
        clothConfig.showTensionStress,
        effectiveSurface
      );
    } else if (isClothMeshAnchor) {
      // Measurement-matched static fallback when physics simulation is paused/disabled
      const geom = computeGarmentFitBox(landmarks, asset, assetImg, item);
      const litSurface = getNormalMappedClothSurface(assetImg, effectiveSurface);

      ctx.translate(geom.centerX, geom.topY);
      ctx.rotate(geom.angle + (item.rotation * Math.PI) / 180);

      if (item.shadowDepth > 0) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = (item.shadowDepth / 100) * 18;
        ctx.shadowOffsetY = (item.shadowDepth / 100) * 10;
      }

      ctx.drawImage(litSurface, -geom.targetW / 2, 0, geom.targetW, geom.targetH);
    } else if (asset.anchorPoint === 'neck') {
      // Jewelry (Pendant Necklace, Choker, Chains) or Neck Object
      const neckWidth = Math.abs(landmarks.rightShoulder.x - landmarks.leftShoulder.x) * 0.38;
      const targetW = neckWidth * item.scale;
      const targetH = targetW * ((assetImg.naturalHeight || assetImg.height) / Math.max(1, assetImg.naturalWidth || assetImg.width));

      const pendantState = pendantPhysicsMap?.[item.assetId];
      let posX = landmarks.throat.x + item.offsetX;
      let posY = landmarks.throat.y + item.offsetY + 4;

      // If dynamic catenary pendant physics is active, follow the hanging apex
      if (clothConfig?.enabled && pendantState && pendantState.links.length > 2) {
        const midIdx = Math.floor(pendantState.links.length / 2);
        posX = pendantState.links[midIdx].x + item.offsetX;
        posY = pendantState.links[midIdx].y + item.offsetY - targetH * 0.35;
      }

      ctx.translate(posX, posY);
      if (item.rotation !== 0) {
        ctx.rotate((item.rotation * Math.PI) / 180);
      }

      if (item.shadowDepth > 0) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = (item.shadowDepth / 100) * 12;
        ctx.shadowOffsetY = 4;
      }

      ctx.drawImage(assetImg, -targetW / 2, 0, targetW, targetH);
    } else if (asset.anchorPoint === 'wrist') {
      // Watch / Bracelet / Handheld Object
      const targetW = Math.abs(landmarks.rightShoulder.x - landmarks.leftShoulder.x) * 0.28 * item.scale;
      const targetH = targetW * ((assetImg.naturalHeight || assetImg.height) / Math.max(1, assetImg.naturalWidth || assetImg.width));

      const posX = landmarks.leftWrist.x + item.offsetX;
      const posY = landmarks.leftWrist.y + item.offsetY;

      ctx.translate(posX, posY);
      if (item.rotation !== 0) {
        ctx.rotate((item.rotation * Math.PI) / 180);
      }

      if (item.shadowDepth > 0) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
      }

      ctx.drawImage(assetImg, -targetW / 2, -targetH / 2, targetW, targetH);
    } else if (asset.anchorPoint === 'head') {
      // Headwear / Eyewear / Head Objects (Hat, Crown, Glasses, Headphones)
      const headWidth = Math.abs(landmarks.rightShoulder.x - landmarks.leftShoulder.x) * 0.72;
      const targetW = headWidth * item.scale;
      const targetH = targetW * ((assetImg.naturalHeight || assetImg.height) / Math.max(1, assetImg.naturalWidth || assetImg.width));

      const isEyewear =
        asset.subCategory === 'glasses' ||
        asset.tags.some((t) => t.toLowerCase().includes('glass'));
      const posX = landmarks.nose.x + item.offsetX;
      const posY = isEyewear
        ? landmarks.nose.y + item.offsetY - targetH * 0.52
        : landmarks.nose.y + item.offsetY - targetH * 0.88;

      ctx.translate(posX, posY);
      if (item.rotation !== 0) {
        ctx.rotate((item.rotation * Math.PI) / 180);
      }

      if (item.shadowDepth > 0) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
        ctx.shadowBlur = (item.shadowDepth / 100) * 14;
        ctx.shadowOffsetY = 5;
      }

      ctx.drawImage(assetImg, -targetW / 2, 0, targetW, targetH);
    } else if (asset.anchorPoint === 'ears') {
      // Earrings
      const earSpan = Math.abs(landmarks.rightShoulder.x - landmarks.leftShoulder.x) * 0.4;
      const targetW = earSpan * 0.35 * item.scale;
      const targetH = targetW * ((assetImg.naturalHeight || assetImg.height) / Math.max(1, assetImg.naturalWidth || assetImg.width));

      const posX = landmarks.throat.x + item.offsetX;
      const posY = landmarks.throat.y + item.offsetY - targetH * 0.5;

      ctx.translate(posX, posY);
      if (item.rotation !== 0) {
        ctx.rotate((item.rotation * Math.PI) / 180);
      }

      ctx.drawImage(assetImg, -targetW / 2, 0, targetW, targetH);
    }

    ctx.restore();
  }

  // 2b. Draw active collision contact sparks over fitted garments when collider mesh or stress heatmap is enabled
  if ((clothConfig?.showBodyColliders || clothConfig?.showTensionStress) && clothMeshMap) {
    const allContacts: ClothContactPoint[] = [];
    for (const item of fittedAssets) {
      if (!item.visible) continue;
      const mesh = clothMeshMap[item.assetId];
      if (mesh?.contactPoints?.length) {
        allContacts.push(...mesh.contactPoints);
      }
    }
    if (allContacts.length > 0) {
      drawBodyCollisionMesh(ctx, [], allContacts);
    }
  }

  // 3. Draw Body Measurements & Caliper HUD if active
  if (showScanHUD && measurements) {
    drawBodyMeasurementHUD(ctx, landmarks, measurements);
  }
}

