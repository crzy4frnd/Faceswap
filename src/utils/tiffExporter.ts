/**
 * Pure client-side baseline TIFF 6.0 and High-Res image exporter.
 * Produces valid uncompressed RGB/RGBA TIFF files offline without external libraries.
 */

export function canvasToTiffBlob(canvas: HTMLCanvasElement): Blob {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas 2d context');

  const imgData = ctx.getImageData(0, 0, width, height);
  const rgba = imgData.data;

  // We write RGB (3 samples per pixel) or RGBA (4 samples). RGB is standard for TIFF.
  const samplesPerPixel = 3;
  const pixelByteCount = width * height * samplesPerPixel;

  // Header (8) + IFD tag count (2) + 12 tags * 12 bytes (144) + next IFD offset (4) = 158 bytes
  // Extra data:
  // BitsPerSample (3 * 2 bytes = 6 bytes)
  // XResolution rational (8 bytes)
  // YResolution rational (8 bytes)
  const headerAndIfdSize = 8 + 2 + 12 * 12 + 4;
  const extraDataOffset = headerAndIfdSize;
  const extraDataSize = 6 + 8 + 8; // 22 bytes
  const pixelDataOffset = extraDataOffset + extraDataSize;
  const totalFileSize = pixelDataOffset + pixelByteCount;

  const buffer = new ArrayBuffer(totalFileSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  let offset = 0;

  // Header: 'II' (Little-endian)
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true); // TIFF version 42
  view.setUint32(4, 8, true); // Offset to first IFD (byte 8)
  offset = 8;

  const numEntries = 12;
  view.setUint16(offset, numEntries, true);
  offset += 2;

  // Offsets for extra values
  const bitsPerSampleOffset = extraDataOffset;
  const xResOffset = extraDataOffset + 6;
  const yResOffset = extraDataOffset + 14;

  const writeTag = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    view.setUint32(offset + 8, valueOrOffset, true);
    offset += 12;
  };

  // Types: 1=BYTE, 2=ASCII, 3=SHORT, 4=LONG, 5=RATIONAL
  writeTag(256, 4, 1, width); // ImageWidth
  writeTag(257, 4, 1, height); // ImageLength
  writeTag(258, 3, 3, bitsPerSampleOffset); // BitsPerSample -> 8, 8, 8
  writeTag(259, 3, 1, 1); // Compression: 1 = uncompressed
  writeTag(262, 3, 1, 2); // PhotometricInterpretation: 2 = RGB
  writeTag(273, 4, 1, pixelDataOffset); // StripOffsets
  writeTag(277, 3, 1, samplesPerPixel); // SamplesPerPixel
  writeTag(278, 4, 1, height); // RowsPerStrip
  writeTag(279, 4, 1, pixelByteCount); // StripByteCounts
  writeTag(282, 5, 1, xResOffset); // XResolution
  writeTag(283, 5, 1, yResOffset); // YResolution
  writeTag(296, 3, 1, 2); // ResolutionUnit: 2 = inch

  // Next IFD offset: 0
  view.setUint32(offset, 0, true);
  offset += 4;

  // Extra data: BitsPerSample (8, 8, 8)
  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);

  // XResolution: 300 / 1 (300 DPI high-res)
  view.setUint32(xResOffset, 300, true);
  view.setUint32(xResOffset + 4, 1, true);

  // YResolution: 300 / 1
  view.setUint32(yResOffset, 300, true);
  view.setUint32(yResOffset + 4, 1, true);

  // Write RGB pixels
  let pixelPtr = pixelDataOffset;
  for (let i = 0; i < rgba.length; i += 4) {
    u8[pixelPtr++] = rgba[i]; // R
    u8[pixelPtr++] = rgba[i + 1]; // G
    u8[pixelPtr++] = rgba[i + 2]; // B
  }

  return new Blob([buffer], { type: 'image/tiff' });
}

export async function downloadCanvasImage(
  canvas: HTMLCanvasElement,
  format: 'png' | 'tiff' | 'jpeg',
  scale: number = 1,
  filename: string = 'facemorph_export'
): Promise<void> {
  let targetCanvas = canvas;

  if (scale > 1) {
    targetCanvas = document.createElement('canvas');
    targetCanvas.width = canvas.width * scale;
    targetCanvas.height = canvas.height * scale;
    const ctx = targetCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, targetCanvas.width, targetCanvas.height);
    }
  }

  let blob: Blob;
  let extension: string = format;

  if (format === 'tiff') {
    blob = canvasToTiffBlob(targetCanvas);
    extension = 'tiff';
  } else if (format === 'jpeg') {
    blob = await new Promise<Blob>((resolve, reject) => {
      targetCanvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('JPEG export failed'))),
        'image/jpeg',
        0.95
      );
    });
    extension = 'jpg';
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      targetCanvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('PNG export failed'))),
        'image/png'
      );
    });
    extension = 'png';
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${Date.now()}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
