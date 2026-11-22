import { LayerBlendMode } from '../types/face';

export interface PsdLayerInput {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  visible: boolean;
  opacity: number; // 0 - 100
  blendMode: LayerBlendMode;
}

export interface PsdDocumentInput {
  width: number;
  height: number;
  /** Layers ordered bottom-to-top (index 0 = bottom-most background, last = top-most foreground) */
  layers: PsdLayerInput[];
  /** Flattened composite RGBA canvas for PSD merged preview & QuickLook thumbnails */
  mergedCanvas: HTMLCanvasElement;
  dpi?: number;
}

const PSD_BLEND_MODE_KEYS: Record<LayerBlendMode, string> = {
  'source-over': 'norm',
  multiply: 'mul ',
  screen: 'scrn',
  overlay: 'over',
  'soft-light': 'sLit',
  'hard-light': 'hLit',
  darken: 'dark',
  lighten: 'lite',
  'color-dodge': 'div ',
  'color-burn': 'idiv',
};

function writeAscii(u8: Uint8Array, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    u8[offset + i] = str.charCodeAt(i) & 0x7f;
  }
}

/**
 * Standard Adobe/Apple PackBits RLE encoder for one 8-bit scanline.
 * Returns a tightly sliced Uint8Array containing the compressed scanline.
 */
function encodePackBitsRow(row: Uint8Array, scratch: Uint8Array): Uint8Array {
  const len = row.length;
  let i = 0;
  let out = 0;

  while (i < len) {
    const litStart = i;
    let litLen = 0;

    while (i < len && litLen < 128) {
      if (i + 2 < len && row[i] === row[i + 1] && row[i] === row[i + 2]) {
        break;
      }
      i++;
      litLen++;
    }

    if (litLen > 0) {
      scratch[out++] = litLen - 1;
      for (let k = 0; k < litLen; k++) {
        scratch[out++] = row[litStart + k];
      }
    }

    if (i < len) {
      const val = row[i];
      let runLen = 1;
      while (i + runLen < len && runLen < 128 && row[i + runLen] === val) {
        runLen++;
      }
      if (runLen >= 2) {
        scratch[out++] = (257 - runLen) & 0xff;
        scratch[out++] = val;
        i += runLen;
      }
    }
  }

  return scratch.slice(0, out);
}

interface EncodedChannel {
  channelId: number; // -1 alpha, 0 R, 1 G, 2 B
  compression: 0 | 1;
  rowByteCounts: Uint16Array;
  compressedRows: Uint8Array[];
  rawBytes?: Uint8Array;
  totalDataLength: number; // includes 2-byte compression header
}

function encodeChannelPlane(
  channelId: number,
  plane: Uint8Array,
  width: number,
  height: number,
  rowScratch: Uint8Array
): EncodedChannel {
  if (width <= 0 || height <= 0) {
    return {
      channelId,
      compression: 0,
      rowByteCounts: new Uint16Array(0),
      compressedRows: [],
      rawBytes: new Uint8Array(0),
      totalDataLength: 2,
    };
  }

  const rowByteCounts = new Uint16Array(height);
  const compressedRows: Uint8Array[] = new Array(height);
  let rlePayloadBytes = 0;

  for (let y = 0; y < height; y++) {
    const rowView = plane.subarray(y * width, (y + 1) * width);
    const encoded = encodePackBitsRow(rowView, rowScratch);
    compressedRows[y] = encoded;
    rowByteCounts[y] = encoded.length;
    rlePayloadBytes += encoded.length;
  }

  const rleTotalBytes = 2 + height * 2 + rlePayloadBytes;
  const rawTotalBytes = 2 + width * height;

  // Pick RLE whenever it saves space (almost always on segmented cutouts & composites),
  // otherwise store lossless raw bytes cleanly.
  if (rleTotalBytes <= rawTotalBytes) {
    return {
      channelId,
      compression: 1,
      rowByteCounts,
      compressedRows,
      totalDataLength: rleTotalBytes,
    };
  }

  return {
    channelId,
    compression: 0,
    rowByteCounts: new Uint16Array(0),
    compressedRows: [],
    rawBytes: plane,
    totalDataLength: rawTotalBytes,
  };
}

interface PreparedPsdLayer {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  blendKey: string;
  opacityByte: number;
  visible: boolean;
  pascalField: Uint8Array; // padded to 4 bytes
  unicodeName: string;
  luniBlockByteLength: number; // padded to 4 bytes
  channels: EncodedChannel[]; // [-1, 0, 1, 2]
}

function prepareLayer(layer: PsdLayerInput, docWidth: number, docHeight: number): PreparedPsdLayer {
  // Draw layer canvas into docWidth x docHeight normalized buffer if dimensions differ
  let srcCanvas = layer.canvas;
  if (srcCanvas.width !== docWidth || srcCanvas.height !== docHeight) {
    const resized = document.createElement('canvas');
    resized.width = docWidth;
    resized.height = docHeight;
    const rctx = resized.getContext('2d');
    if (rctx) {
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(srcCanvas, 0, 0, docWidth, docHeight);
    }
    srcCanvas = resized;
  }

  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const rgba = ctx ? ctx.getImageData(0, 0, docWidth, docHeight).data : new Uint8ClampedArray(docWidth * docHeight * 4);

  // Compute tight non-transparent bounding box to optimize PSD file size
  let minX = docWidth;
  let minY = docHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < docHeight; y++) {
    const rowOff = y * docWidth * 4;
    for (let x = 0; x < docWidth; x++) {
      if (rgba[rowOff + x * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  let top = 0;
  let left = 0;
  let bottom = 0;
  let right = 0;
  let layerW = 0;
  let layerH = 0;

  if (maxX >= minX && maxY >= minY) {
    top = minY;
    left = minX;
    bottom = maxY + 1;
    right = maxX + 1;
    layerW = right - left;
    layerH = bottom - top;
  }

  const planeLen = layerW * layerH;
  const alphaPlane = new Uint8Array(planeLen);
  const redPlane = new Uint8Array(planeLen);
  const greenPlane = new Uint8Array(planeLen);
  const bluePlane = new Uint8Array(planeLen);

  if (planeLen > 0) {
    for (let ly = 0; ly < layerH; ly++) {
      const srcY = top + ly;
      for (let lx = 0; lx < layerW; lx++) {
        const srcX = left + lx;
        const srcIdx = (srcY * docWidth + srcX) * 4;
        const dstIdx = ly * layerW + lx;
        redPlane[dstIdx] = rgba[srcIdx];
        greenPlane[dstIdx] = rgba[srcIdx + 1];
        bluePlane[dstIdx] = rgba[srcIdx + 2];
        alphaPlane[dstIdx] = rgba[srcIdx + 3];
      }
    }
  }

  const rowScratch = new Uint8Array(Math.max(16, layerW + Math.ceil(layerW / 128) + 8));
  const channels: EncodedChannel[] = [
    encodeChannelPlane(-1, alphaPlane, layerW, layerH, rowScratch),
    encodeChannelPlane(0, redPlane, layerW, layerH, rowScratch),
    encodeChannelPlane(1, greenPlane, layerW, layerH, rowScratch),
    encodeChannelPlane(2, bluePlane, layerW, layerH, rowScratch),
  ];

  // Pascal string name padded to 4-byte boundary (max 63 ASCII chars for broad PSD parser compatibility)
  const cleanName = (layer.name || 'Layer').trim() || 'Layer';
  const asciiTrunc = cleanName.slice(0, 63);
  const pascalRawLen = 1 + asciiTrunc.length;
  const pascalPaddedLen = (pascalRawLen + 3) & ~3;
  const pascalField = new Uint8Array(pascalPaddedLen);
  pascalField[0] = asciiTrunc.length;
  for (let i = 0; i < asciiTrunc.length; i++) {
    const code = asciiTrunc.charCodeAt(i);
    pascalField[1 + i] = code >= 32 && code <= 126 ? code : 95;
  }

  // 'luni' Unicode layer name tagged block (4-byte aligned payload)
  const unicodeName = cleanName.slice(0, 255);
  const luniRawDataLen = 4 + unicodeName.length * 2;
  const luniPaddedDataLen = (luniRawDataLen + 3) & ~3;
  const luniBlockByteLength = 12 + luniPaddedDataLen; // '8BIM' (4) + 'luni' (4) + size (4) + data

  const opacityPct = Math.max(0, Math.min(100, layer.opacity ?? 100));

  return {
    top,
    left,
    bottom,
    right,
    width: layerW,
    height: layerH,
    blendKey: PSD_BLEND_MODE_KEYS[layer.blendMode] || 'norm',
    opacityByte: Math.round((opacityPct / 100) * 255),
    visible: layer.visible !== false,
    pascalField,
    unicodeName,
    luniBlockByteLength,
    channels,
  };
}

/**
 * Encodes a multi-layered RGBA Adobe Photoshop (.psd v1) document with per-layer
 * tight bounding boxes, RLE PackBits compression, blend modes, opacities,
 * visibility flags, Unicode layer names, and a compressed merged preview composite.
 */
export function encodePsdBlob(doc: PsdDocumentInput): Blob {
  const width = Math.max(1, Math.min(30000, Math.round(doc.width)));
  const height = Math.max(1, Math.min(30000, Math.round(doc.height)));
  const dpi = Math.max(72, Math.min(1200, Math.round(doc.dpi ?? 300)));

  const preparedLayers = doc.layers.map((layer) => prepareLayer(layer, width, height));

  // Prepare merged composite (RGBA -> 4 PackBits-compressed channels)
  let mergedCanvas = doc.mergedCanvas;
  if (mergedCanvas.width !== width || mergedCanvas.height !== height) {
    const resized = document.createElement('canvas');
    resized.width = width;
    resized.height = height;
    const rctx = resized.getContext('2d');
    if (rctx) {
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(mergedCanvas, 0, 0, width, height);
    }
    mergedCanvas = resized;
  }
  const mCtx = mergedCanvas.getContext('2d', { willReadFrequently: true });
  const mRgba = mCtx
    ? mCtx.getImageData(0, 0, width, height).data
    : new Uint8ClampedArray(width * height * 4);

  const mTotal = width * height;
  const mRed = new Uint8Array(mTotal);
  const mGreen = new Uint8Array(mTotal);
  const mBlue = new Uint8Array(mTotal);
  const mAlpha = new Uint8Array(mTotal);
  for (let i = 0; i < mTotal; i++) {
    const p = i * 4;
    mRed[i] = mRgba[p];
    mGreen[i] = mRgba[p + 1];
    mBlue[i] = mRgba[p + 2];
    mAlpha[i] = mRgba[p + 3];
  }

  const mergedScratch = new Uint8Array(Math.max(16, width + Math.ceil(width / 128) + 8));
  const mergedChannelPlanes = [mRed, mGreen, mBlue, mAlpha];
  const mergedRowCounts = new Uint16Array(4 * height);
  const mergedEncodedRows: Uint8Array[][] = [[], [], [], []];
  let mergedPayloadBytes = 0;

  for (let c = 0; c < 4; c++) {
    const plane = mergedChannelPlanes[c];
    for (let y = 0; y < height; y++) {
      const encoded = encodePackBitsRow(plane.subarray(y * width, (y + 1) * width), mergedScratch);
      mergedRowCounts[c * height + y] = encoded.length;
      mergedEncodedRows[c].push(encoded);
      mergedPayloadBytes += encoded.length;
    }
  }

  // Image Resources Section: ResolutionInfo (ID 1005, 28 bytes)
  const imageResourcesLength = 28;

  // Compute Layer Info Section Size
  let layerInfoContentSize = 2; // layerCount (i16)
  for (const pl of preparedLayers) {
    const extraLen = 4 + 4 + pl.pascalField.length + pl.luniBlockByteLength;
    const recordSize =
      16 + // rect (top, left, bottom, right)
      2 + // numChannels
      pl.channels.length * 6 + // channel info entries
      4 + // '8BIM'
      4 + // blend key
      1 + // opacity
      1 + // clipping
      1 + // flags
      1 + // filler
      4 + // extraDataLength
      extraLen;
    layerInfoContentSize += recordSize;

    for (const ch of pl.channels) {
      layerInfoContentSize += ch.totalDataLength;
    }
  }

  // Pad Layer Info content to multiple of 4 bytes
  const layerInfoPaddedSize = (layerInfoContentSize + 3) & ~3;
  const globalLayerMaskInfoSize = 4; // length=0
  const layerAndMaskSectionContentSize = 4 + layerInfoPaddedSize + globalLayerMaskInfoSize;

  const mergedSectionSize = 2 + 4 * height * 2 + mergedPayloadBytes;

  const totalFileBytes =
    26 + // Header
    4 + // Color mode data (length 0)
    4 +
    imageResourcesLength + // Image resources
    4 +
    layerAndMaskSectionContentSize + // Layer and Mask Info
    mergedSectionSize; // Merged Image Data

  const buffer = new ArrayBuffer(totalFileBytes);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let pos = 0;

  // 1. FILE HEADER (26 bytes)
  writeAscii(u8, pos, '8BPS');
  pos += 4;
  view.setUint16(pos, 1, false); // version = 1
  pos += 2;
  pos += 6; // 6 reserved zero bytes
  view.setUint16(pos, 4, false); // channels = 4 (RGBA)
  pos += 2;
  view.setUint32(pos, height, false);
  pos += 4;
  view.setUint32(pos, width, false);
  pos += 4;
  view.setUint16(pos, 8, false); // depth = 8-bit
  pos += 2;
  view.setUint16(pos, 3, false); // colorMode = 3 (RGB)
  pos += 2;

  // 2. COLOR MODE DATA SECTION (4 bytes)
  view.setUint32(pos, 0, false);
  pos += 4;

  // 3. IMAGE RESOURCES SECTION (4 + 28 bytes)
  view.setUint32(pos, imageResourcesLength, false);
  pos += 4;
  // ResolutionInfo resource (ID 1005)
  writeAscii(u8, pos, '8BIM');
  pos += 4;
  view.setUint16(pos, 1005, false);
  pos += 2;
  view.setUint16(pos, 0, false); // empty Pascal string padded to even
  pos += 2;
  view.setUint32(pos, 16, false); // data size
  pos += 4;
  view.setUint32(pos, dpi * 65536, false); // hRes fixed 16.16
  pos += 4;
  view.setUint16(pos, 1, false); // hResUnit: px/inch
  pos += 2;
  view.setUint16(pos, 1, false); // widthUnit: inches
  pos += 2;
  view.setUint32(pos, dpi * 65536, false); // vRes fixed 16.16
  pos += 4;
  view.setUint16(pos, 1, false); // vResUnit: px/inch
  pos += 2;
  view.setUint16(pos, 1, false); // heightUnit: inches
  pos += 2;

  // 4. LAYER AND MASK INFORMATION SECTION
  view.setUint32(pos, layerAndMaskSectionContentSize, false);
  pos += 4;

  // Layer Info length
  view.setUint32(pos, layerInfoPaddedSize, false);
  pos += 4;
  const layerInfoStart = pos;

  // Negative layer count tells Photoshop the first merged alpha channel carries transparency
  view.setInt16(pos, -preparedLayers.length, false);
  pos += 2;

  // Layer Records (bottom-to-top)
  for (const pl of preparedLayers) {
    view.setInt32(pos, pl.top, false);
    pos += 4;
    view.setInt32(pos, pl.left, false);
    pos += 4;
    view.setInt32(pos, pl.bottom, false);
    pos += 4;
    view.setInt32(pos, pl.right, false);
    pos += 4;

    view.setUint16(pos, pl.channels.length, false);
    pos += 2;

    for (const ch of pl.channels) {
      view.setInt16(pos, ch.channelId, false);
      pos += 2;
      view.setUint32(pos, ch.totalDataLength, false);
      pos += 4;
    }

    writeAscii(u8, pos, '8BIM');
    pos += 4;
    writeAscii(u8, pos, pl.blendKey);
    pos += 4;

    u8[pos++] = pl.opacityByte;
    u8[pos++] = 0; // clipping: base
    u8[pos++] = pl.visible ? 0 : 0x02; // bit 1 (0x02) = hidden/not visible
    u8[pos++] = 0; // filler

    const extraLen = 4 + 4 + pl.pascalField.length + pl.luniBlockByteLength;
    view.setUint32(pos, extraLen, false);
    pos += 4;

    // Layer mask data (0 bytes) & Layer blending ranges (0 bytes)
    view.setUint32(pos, 0, false);
    pos += 4;
    view.setUint32(pos, 0, false);
    pos += 4;

    // Pascal name padded to 4 bytes
    u8.set(pl.pascalField, pos);
    pos += pl.pascalField.length;

    // 'luni' Unicode Layer Name tagged block
    writeAscii(u8, pos, '8BIM');
    pos += 4;
    writeAscii(u8, pos, 'luni');
    pos += 4;
    const luniDataSize = pl.luniBlockByteLength - 12;
    view.setUint32(pos, luniDataSize, false);
    pos += 4;
    view.setUint32(pos, pl.unicodeName.length, false);
    pos += 4;
    for (let c = 0; c < pl.unicodeName.length; c++) {
      view.setUint16(pos, pl.unicodeName.charCodeAt(c), false);
      pos += 2;
    }
    const luniPad = luniDataSize - (4 + pl.unicodeName.length * 2);
    pos += luniPad;
  }

  // Layer Channel Image Data (bottom-to-top, channel order [-1, 0, 1, 2])
  for (const pl of preparedLayers) {
    for (const ch of pl.channels) {
      view.setUint16(pos, ch.compression, false);
      pos += 2;

      if (ch.compression === 1) {
        for (let r = 0; r < ch.rowByteCounts.length; r++) {
          view.setUint16(pos, ch.rowByteCounts[r], false);
          pos += 2;
        }
        for (let r = 0; r < ch.compressedRows.length; r++) {
          const rowBytes = ch.compressedRows[r];
          u8.set(rowBytes, pos);
          pos += rowBytes.length;
        }
      } else if (ch.rawBytes && ch.rawBytes.length > 0) {
        u8.set(ch.rawBytes, pos);
        pos += ch.rawBytes.length;
      }
    }
  }

  // Pad Layer Info section to 4-byte boundary
  pos = layerInfoStart + layerInfoPaddedSize;

  // Global Layer Mask Info (4 zero bytes)
  view.setUint32(pos, 0, false);
  pos += 4;

  // 5. MERGED IMAGE DATA SECTION (R, G, B, A compressed with PackBits)
  view.setUint16(pos, 1, false); // compression = 1 (RLE PackBits)
  pos += 2;

  for (let i = 0; i < mergedRowCounts.length; i++) {
    view.setUint16(pos, mergedRowCounts[i], false);
    pos += 2;
  }

  for (let c = 0; c < 4; c++) {
    const rows = mergedEncodedRows[c];
    for (let y = 0; y < rows.length; y++) {
      const rowBytes = rows[y];
      u8.set(rowBytes, pos);
      pos += rowBytes.length;
    }
  }

  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
}

export async function downloadPsdDocument(
  doc: PsdDocumentInput,
  filename: string = 'facemorph_layer_composition',
  options?: { omitTimestamp?: boolean }
): Promise<void> {
  const blob = encodePsdBlob(doc);
  const safeBase =
    filename
      .trim()
      .replace(/\.(psd|png|jpg|jpeg|tiff?)$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'facemorph_layer_composition';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = options?.omitTimestamp ? `${safeBase}.psd` : `${safeBase}_${Date.now()}.psd`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
