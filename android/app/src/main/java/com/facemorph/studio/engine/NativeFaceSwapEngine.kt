package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import com.facemorph.studio.model.DetectedFaceData
import com.facemorph.studio.model.FaceAdjustments
import com.facemorph.studio.model.FaceLandmarksData
import com.facemorph.studio.model.Point2D
import com.facemorph.studio.model.SegmentedTargetLayers
import com.facemorph.studio.model.SourceFaceMetrics
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceContour
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

object NativeFaceSwapEngine {

    private val detector by lazy {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setContourMode(FaceDetectorOptions.CONTOUR_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .build()
        FaceDetection.getClient(options)
    }

    private fun orderViewerEyes(a: PointF?, b: PointF?): Pair<PointF?, PointF?> {
        if (a == null || b == null) return a to b
        return if (a.x <= b.x) a to b else b to a
    }

    suspend fun detectSourceFaceMetrics(bitmap: Bitmap): SourceFaceMetrics {
        return suspendCancellableCoroutine { cont ->
            try {
                val image = InputImage.fromBitmap(bitmap, 0)
                detector.process(image)
                    .addOnSuccessListener { faces ->
                        val f = faces.firstOrNull()
                        if (f != null) {
                            val b = f.boundingBox
                            val w = max(1f, bitmap.width.toFloat())
                            val h = max(1f, bitmap.height.toFloat())
                            val rawLe = f.getLandmark(FaceLandmark.LEFT_EYE)?.position
                            val rawRe = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position
                            val (viewerLe, viewerRe) = orderViewerEyes(rawLe, rawRe)
                            val nosePos = f.getLandmark(FaceLandmark.NOSE_BASE)?.position
                            val mouthPos = f.getLandmark(FaceLandmark.MOUTH_BOTTOM)?.position

                            val bw = max(24f, b.width().toFloat())
                            val bh = max(24f, b.height().toFloat())

                            val eyeMidPxX = if (viewerLe != null && viewerRe != null) {
                                (viewerLe.x + viewerRe.x) * 0.5f
                            } else b.centerX().toFloat()
                            val eyeMidPxY = if (viewerLe != null && viewerRe != null) {
                                (viewerLe.y + viewerRe.y) * 0.5f
                            } else b.top + bh * 0.38f
                            val eyeDistPx = if (viewerLe != null && viewerRe != null) {
                                hypot((viewerRe.x - viewerLe.x).toDouble(), (viewerRe.y - viewerLe.y).toDouble()).toFloat()
                            } else bw * 0.44f

                            val faceContourPts = f.getContour(FaceContour.FACE)?.points
                            val hasContour = faceContourPts != null && faceContourPts.size >= 12
                            val cMinX = faceContourPts?.minOfOrNull { it.x }
                            val cMaxX = faceContourPts?.maxOfOrNull { it.x }
                            val cMinY = faceContourPts?.minOfOrNull { it.y }
                            val cMaxY = faceContourPts?.maxOfOrNull { it.y }

                            // Clean contour-anchored crop preserving exact donor face aspect ratio & jawline cutout
                            val rawHalfW = if (hasContour && cMinX != null && cMaxX != null) {
                                max(eyeDistPx * 1.05f, (cMaxX - cMinX) * 0.54f)
                            } else {
                                max(bw * 0.40f, eyeDistPx * 1.12f)
                            }
                            val rawTopPx = if (hasContour && cMinY != null) {
                                min(cMinY - eyeDistPx * 0.08f, eyeMidPxY - eyeDistPx * 0.72f)
                            } else {
                                min(b.top + bh * 0.09f, eyeMidPxY - eyeDistPx * 0.78f)
                            }
                            val rawBottomPx = if (hasContour && cMaxY != null) {
                                max(cMaxY + eyeDistPx * 0.06f, eyeMidPxY + eyeDistPx * 1.42f)
                            } else {
                                max(b.bottom - bh * 0.02f, eyeMidPxY + eyeDistPx * 1.48f)
                            }

                            val cropL = ((eyeMidPxX - rawHalfW) / w).coerceIn(0.01f, 0.85f)
                            val cropR = ((eyeMidPxX + rawHalfW) / w).coerceIn(cropL + 0.10f, 0.99f)
                            val cropT = (rawTopPx / h).coerceIn(0.01f, 0.85f)
                            val cropB = (rawBottomPx / h).coerceIn(cropT + 0.12f, 0.99f)

                            val cropW = max(1f, (cropR - cropL) * w)
                            val cropH = max(1f, (cropB - cropT) * h)
                            val eyeMidX = (eyeMidPxX - cropL * w) / cropW
                            val eyeMidY = (eyeMidPxY - cropT * h) / cropH
                            val eyeDist = eyeDistPx / cropW
                            val roll = if (viewerLe != null && viewerRe != null) {
                                Math.toDegrees(
                                    atan2(
                                        (viewerRe.y - viewerLe.y).toDouble(),
                                        (viewerRe.x - viewerLe.x).toDouble()
                                    )
                                ).toFloat()
                            } else {
                                (-f.headEulerAngleZ).coerceIn(-45f, 45f)
                            }
                            val noseY = nosePos?.let { (it.y - cropT * h) / cropH } ?: 0.56f
                            val mouthY = mouthPos?.let { ((it.y - bh * 0.05f) - cropT * h) / cropH } ?: 0.74f
                            val contourNorm = faceContourPts?.map { pt ->
                                Point2D(
                                    x = ((pt.x - cropL * w) / cropW).coerceIn(0.01f, 0.99f),
                                    y = ((pt.y - cropT * h) / cropH).coerceIn(0.01f, 0.99f)
                                )
                            } ?: emptyList()

                            if (cont.isActive) {
                                cont.resume(
                                    SourceFaceMetrics(
                                        cropLeft = cropL,
                                        cropTop = cropT,
                                        cropRight = cropR,
                                        cropBottom = cropB,
                                        eyeMidXRatio = eyeMidX.coerceIn(0.28f, 0.72f),
                                        eyeMidYRatio = eyeMidY.coerceIn(0.20f, 0.52f),
                                        eyeDistRatio = eyeDist.coerceIn(0.28f, 0.76f),
                                        rollDeg = roll.coerceIn(-45f, 45f),
                                        noseYRatio = noseY.coerceIn(0.40f, 0.72f),
                                        mouthYRatio = mouthY.coerceIn(0.58f, 0.88f),
                                        aspectRatio = (cropW / cropH).coerceIn(0.60f, 1.15f),
                                        contourNorm = contourNorm
                                    )
                                )
                            }
                        } else {
                            if (cont.isActive) cont.resume(defaultSourceMetrics())
                        }
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(defaultSourceMetrics())
                    }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(defaultSourceMetrics())
            }
        }
    }

    private fun defaultSourceMetrics() = SourceFaceMetrics(
        cropLeft = 0.25f,
        cropTop = 0.16f,
        cropRight = 0.75f,
        cropBottom = 0.68f,
        eyeMidXRatio = 0.5f,
        eyeMidYRatio = 0.36f,
        eyeDistRatio = 0.45f,
        rollDeg = 0f,
        noseYRatio = 0.56f,
        mouthYRatio = 0.74f
    )

    suspend fun detectFaces(bitmap: Bitmap, defaultProfileId: String? = null): List<DetectedFaceData> {
        return suspendCancellableCoroutine { cont ->
            try {
                val image = InputImage.fromBitmap(bitmap, 0)
                detector.process(image)
                    .addOnSuccessListener { faces ->
                        if (faces.isNotEmpty()) {
                            val mapped = faces.mapIndexed { idx, f ->
                                val b = f.boundingBox
                                val fw = max(40f, b.width().toFloat())
                                val fh = max(40f, b.height().toFloat())
                                val cx = b.centerX().toFloat()
                                val cy = b.centerY().toFloat()

                                val rawLe = f.getLandmark(FaceLandmark.LEFT_EYE)?.position
                                val rawRe = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position
                                val (viewerLe, viewerRe) = orderViewerEyes(rawLe, rawRe)
                                val nosePos = f.getLandmark(FaceLandmark.NOSE_BASE)?.position
                                val mouthPos = f.getLandmark(FaceLandmark.MOUTH_BOTTOM)?.position

                                val lm = FaceLandmarksData(
                                    forehead = Point2D(cx, b.top + fh * 0.16f),
                                    leftEye = viewerLe?.let { Point2D(it.x, it.y) }
                                        ?: Point2D(cx - fw * 0.21f, cy - fh * 0.10f),
                                    rightEye = viewerRe?.let { Point2D(it.x, it.y) }
                                        ?: Point2D(cx + fw * 0.21f, cy - fh * 0.10f),
                                    nose = nosePos?.let { Point2D(it.x, it.y) }
                                        ?: Point2D(cx, cy + fh * 0.05f),
                                    lips = mouthPos?.let { Point2D(it.x, it.y - fh * 0.05f) }
                                        ?: Point2D(cx, cy + fh * 0.24f),
                                    chin = Point2D(cx, b.bottom - fh * 0.04f)
                                )
                                val contourPts = f.getContour(FaceContour.FACE)?.points?.map { Point2D(it.x, it.y) } ?: emptyList()
                                val lbPts = f.getContour(FaceContour.LEFT_EYEBROW_TOP)?.points?.map { Point2D(it.x, it.y) } ?: emptyList()
                                val rbPts = f.getContour(FaceContour.RIGHT_EYEBROW_TOP)?.points?.map { Point2D(it.x, it.y) } ?: emptyList()
                                DetectedFaceData(
                                    id = "face-$idx",
                                    boxLeft = b.left.toFloat(),
                                    boxTop = b.top.toFloat(),
                                    boxRight = b.right.toFloat(),
                                    boxBottom = b.bottom.toFloat(),
                                    landmarks = lm,
                                    originalLandmarks = lm,
                                    assignedProfileId = defaultProfileId,
                                    enabled = true,
                                    strength = 100,
                                    smileScore = f.smilingProbability ?: 0.5f,
                                    faceContour = contourPts,
                                    leftBrowTop = lbPts,
                                    rightBrowTop = rbPts
                                )
                            }
                            if (cont.isActive) cont.resume(mapped)
                        } else {
                            if (cont.isActive) cont.resume(fallbackCenterFace(bitmap, defaultProfileId))
                        }
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(fallbackCenterFace(bitmap, defaultProfileId))
                    }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(fallbackCenterFace(bitmap, defaultProfileId))
            }
        }
    }

    private fun fallbackCenterFace(bitmap: Bitmap, profileId: String?): List<DetectedFaceData> {
        val w = bitmap.width.toFloat()
        val h = bitmap.height.toFloat()
        val fw = w * 0.34f
        val fh = fw * 1.25f
        val cx = w * 0.5f
        val cy = h * 0.32f
        val lm = FaceLandmarksData(
            forehead = Point2D(cx, cy - fh * 0.34f),
            leftEye = Point2D(cx - fw * 0.20f, cy - fh * 0.10f),
            rightEye = Point2D(cx + fw * 0.20f, cy - fh * 0.10f),
            nose = Point2D(cx, cy + fh * 0.05f),
            lips = Point2D(cx, cy + fh * 0.23f),
            chin = Point2D(cx, cy + fh * 0.44f)
        )
        return listOf(
            DetectedFaceData(
                id = "face-0",
                boxLeft = cx - fw / 2f,
                boxTop = cy - fh / 2f,
                boxRight = cx + fw / 2f,
                boxBottom = cy + fh / 2f,
                landmarks = lm,
                originalLandmarks = lm,
                assignedProfileId = profileId,
                strength = 100
            )
        )
    }

    fun sampleFacialSkinOnlyRgb(
        bmp: Bitmap,
        cx: Int,
        cy: Int,
        radiusX: Int,
        radiusY: Int
    ): Triple<Float, Float, Float> {
        var rSum = 0L
        var gSum = 0L
        var bSum = 0L
        var skinCount = 0
        var fallbackR = 0L
        var fallbackG = 0L
        var fallbackB = 0L
        var fallbackCount = 0

        val stepX = max(1, radiusX / 5)
        val stepY = max(1, radiusY / 5)
        for (dy in -radiusY..radiusY step stepY) {
            val py = (cy + dy).coerceIn(0, bmp.height - 1)
            for (dx in -radiusX..radiusX step stepX) {
                val px = (cx + dx).coerceIn(0, bmp.width - 1)
                val c = bmp.getPixel(px, py)
                val r = Color.red(c)
                val g = Color.green(c)
                val b = Color.blue(c)
                val lum = 0.299f * r + 0.587f * g + 0.114f * b
                if (lum in 45f..242f) {
                    fallbackR += r
                    fallbackG += g
                    fallbackB += b
                    fallbackCount++
                    if (r > 60 && g > 36 && b > 18 && r >= g && (r - b) > 8) {
                        rSum += r
                        gSum += g
                        bSum += b
                        skinCount++
                    }
                }
            }
        }
        return if (skinCount >= 4) {
            Triple(rSum.toFloat() / skinCount, gSum.toFloat() / skinCount, bSum.toFloat() / skinCount)
        } else {
            val n = max(1, fallbackCount).toFloat()
            Triple(
                if (fallbackCount > 0) fallbackR / n else 190f,
                if (fallbackCount > 0) fallbackG / n else 148f,
                if (fallbackCount > 0) fallbackB / n else 125f
            )
        }
    }

    private data class SkinSample(val r: Int, val g: Int, val b: Int, val lum: Float)

    fun sampleSkinPatchReferenceRgb(
        bmp: Bitmap,
        normX: Float,
        normY: Float,
        radiusRatio: Float = 0.032f
    ): Triple<Float, Float, Float> {
        val w = bmp.width
        val h = bmp.height
        if (w <= 1 || h <= 1) return Triple(190f, 148f, 125f)

        val cx = (normX.coerceIn(0f, 1f) * (w - 1)).toInt()
        val cy = (normY.coerceIn(0f, 1f) * (h - 1)).toInt()
        val radPx = max(4, (min(w, h) * radiusRatio.coerceIn(0.012f, 0.09f)).toInt())
        val radSq = radPx * radPx
        val step = max(1, radPx / 8)

        val samples = ArrayList<SkinSample>(256)

        val y0 = (cy - radPx).coerceIn(0, h - 1)
        val y1 = (cy + radPx).coerceIn(0, h - 1)
        val x0 = (cx - radPx).coerceIn(0, w - 1)
        val x1 = (cx + radPx).coerceIn(0, w - 1)

        var py = y0
        while (py <= y1) {
            val dy = py - cy
            val dySq = dy * dy
            var px = x0
            while (px <= x1) {
                val dx = px - cx
                if (dx * dx + dySq <= radSq) {
                    val c = bmp.getPixel(px, py)
                    if (Color.alpha(c) >= 25) {
                        val r = Color.red(c)
                        val g = Color.green(c)
                        val b = Color.blue(c)
                        val lum = 0.299f * r + 0.587f * g + 0.114f * b
                        samples.add(SkinSample(r, g, b, lum))
                    }
                }
                px += step
            }
            py += step
        }

        if (samples.isEmpty()) {
            val c = bmp.getPixel(cx, cy)
            return Triple(Color.red(c).toFloat(), Color.green(c).toFloat(), Color.blue(c).toFloat())
        }

        val slice = if (samples.size >= 8) {
            samples.sortBy { it.lum }
            val trim = (samples.size * 0.15f).toInt().coerceIn(1, samples.size / 4)
            samples.subList(trim, samples.size - trim)
        } else {
            samples
        }

        var rSum = 0L
        var gSum = 0L
        var bSum = 0L
        for (s in slice) {
            rSum += s.r
            gSum += s.g
            bSum += s.b
        }
        val count = max(1, slice.size).toFloat()
        return Triple(rSum / count, gSum / count, bSum / count)
    }

    /**
     * Shadow-preserving skin color grading + PicsArt-grade brightness/contrast/saturation/warmth.
     * Crucially protects deep shadows (pupils, eyelashes, eyebrows, nostrils) from getting washed out
     * gray when adapting darker skin tones to bright studio portraits.
     */
    private fun applyShadowPreservingColorGrade(
        patch: Bitmap,
        rGain: Float,
        gGain: Float,
        bGain: Float,
        brightness: Float,
        contrast: Float,
        saturation: Float,
        warmth: Float
    ) {
        val w = patch.width
        val h = patch.height
        val total = w * h
        if (total == 0) return

        val pixels = IntArray(total)
        patch.getPixels(pixels, 0, w, 0, 0, w, h)

        val contrastFactor = (1f + (contrast / 100f) * 0.72f).coerceIn(0.60f, 1.55f)
        val satFactor = (1f + (saturation / 100f) * 0.90f).coerceIn(0.55f, 1.55f)
        val brightShift = brightness * 1.15f
        val warmR = warmth * 0.55f
        val warmB = -warmth * 0.60f

        for (i in 0 until total) {
            val c = pixels[i]
            val a = Color.alpha(c)
            if (a < 10) continue

            val r0 = Color.red(c).toFloat()
            val g0 = Color.green(c).toFloat()
            val b0 = Color.blue(c).toFloat()

            val lumNorm = (0.299f * r0 + 0.587f * g0 + 0.114f * b0) / 255f
            // Smoothstep shadow protection: keeps eyes/brows dark & crisp (0.14 @ black -> 1.0 @ skin midtones)
            val st = ((lumNorm - 0.08f) / 0.28f).coerceIn(0f, 1f)
            val skinWeight = 0.14f + 0.86f * (st * st * (3f - 2f * st))
            // Soft highlight roll-off near pure white specular spots so forehead never blows out flat
            val ht = ((lumNorm - 0.78f) / 0.22f).coerceIn(0f, 1f)
            val hiCompress = 1f - 0.25f * ht

            val effRg = 1f + (rGain - 1f) * skinWeight * hiCompress
            val effGg = 1f + (gGain - 1f) * skinWeight * hiCompress
            val effBg = 1f + (bGain - 1f) * skinWeight * hiCompress

            var r = r0 * effRg + warmR * skinWeight + brightShift
            var g = g0 * effGg + brightShift
            var b = b0 * effBg + warmB * skinWeight + brightShift

            // Midtone S-contrast around 126
            r = (r - 126f) * contrastFactor + 126f
            g = (g - 126f) * contrastFactor + 126f
            b = (b - 126f) * contrastFactor + 126f

            // Saturation around pixel luminance
            val l = 0.299f * r + 0.587f * g + 0.114f * b
            r = l + (r - l) * satFactor
            g = l + (g - l) * satFactor
            b = l + (b - l) * satFactor

            pixels[i] = Color.argb(
                a,
                r.toInt().coerceIn(0, 255),
                g.toInt().coerceIn(0, 255),
                b.toInt().coerceIn(0, 255)
            )
        }
        patch.setPixels(pixels, 0, w, 0, 0, w, h)
    }

    private fun applyClaritySharpening(bitmap: Bitmap, clarityAmount: Float = 0.36f) {
        val w = bitmap.width
        val h = bitmap.height
        if (w < 8 || h < 8 || clarityAmount <= 0.01f) return

        val total = w * h
        val src = IntArray(total)
        bitmap.getPixels(src, 0, w, 0, 0, w, h)
        val lum = FloatArray(total)
        for (i in 0 until total) {
            val c = src[i]
            lum[i] = 0.299f * Color.red(c) + 0.587f * Color.green(c) + 0.114f * Color.blue(c)
        }

        val out = src.copyOf()
        val strength = clarityAmount * 1.15f
        for (y in 1 until h - 1) {
            val r0 = (y - 1) * w
            val r1 = y * w
            val r2 = (y + 1) * w
            for (x in 1 until w - 1) {
                val idx = r1 + x
                val c = src[idx]
                if (Color.alpha(c) < 25) continue

                val blurL = (
                    lum[r0 + x - 1] + 2f * lum[r0 + x] + lum[r0 + x + 1] +
                        2f * lum[r1 + x - 1] + 4f * lum[idx] + 2f * lum[r1 + x + 1] +
                        lum[r2 + x - 1] + 2f * lum[r2 + x] + lum[r2 + x + 1]
                    ) / 16f
                val detail = lum[idx] - blurL
                if (abs(detail) < 1.5f) continue

                val delta = (detail * strength).coerceIn(-24f, 24f)
                val nr = (Color.red(c) + delta).toInt().coerceIn(0, 255)
                val ng = (Color.green(c) + delta).toInt().coerceIn(0, 255)
                val nb = (Color.blue(c) + delta).toInt().coerceIn(0, 255)
                out[idx] = Color.argb(Color.alpha(c), nr, ng, nb)
            }
        }
        bitmap.setPixels(out, 0, w, 0, 0, w, h)
    }

    fun createFeatheredInnerFacePatch(
        srcBitmap: Bitmap,
        metrics: SourceFaceMetrics,
        patchW: Int,
        patchH: Int,
        featherRatio: Float,
        smartBlend: Boolean,
        targetSkinRgb: Triple<Float, Float, Float>? = null,
        applyDefaultRadialMask: Boolean = true,
        isManualSkinReference: Boolean = false,
        brightness: Float = 0f,
        contrast: Float = 14f,
        saturation: Float = 6f,
        warmth: Float = 0f
    ): Bitmap {
        val patch = Bitmap.createBitmap(patchW, patchH, Bitmap.Config.ARGB_8888)
        patch.setHasAlpha(true)
        val pCanvas = Canvas(patch)

        val sL = (srcBitmap.width * metrics.cropLeft).toInt().coerceIn(0, srcBitmap.width - 2)
        val sT = (srcBitmap.height * metrics.cropTop).toInt().coerceIn(0, srcBitmap.height - 2)
        val sR = (srcBitmap.width * metrics.cropRight).toInt().coerceIn(sL + 2, srcBitmap.width)
        val sB = (srcBitmap.height * metrics.cropBottom).toInt().coerceIn(sT + 2, srcBitmap.height)

        val srcRect = Rect(sL, sT, sR, sB)
        val dstRect = RectF(0f, 0f, patchW.toFloat(), patchH.toFloat())

        val facePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        pCanvas.drawBitmap(srcBitmap, srcRect, dstRect, facePaint)

        val rGain: Float
        val gGain: Float
        val bGain: Float
        if (targetSkinRgb != null) {
            val srcCenterX = (sL + sR) / 2
            val srcCenterY = (sT + (sB - sT) * 0.44f).toInt()
            val (sr, sg, sb) = sampleFacialSkinOnlyRgb(
                srcBitmap,
                srcCenterX,
                srcCenterY,
                max(4, (sR - sL) / 4),
                max(4, (sB - sT) / 5)
            )
            val (tr, tg, tb) = targetSkinRgb
            val srcLum = 0.299f * sr + 0.587f * sg + 0.114f * sb
            val dstLum = 0.299f * tr + 0.587f * tg + 0.114f * tb
            val lumRatio = dstLum / max(40f, srcLum)

            if (isManualSkinReference) {
                val rawR = tr / max(40f, sr)
                val rawG = tg / max(36f, sg)
                val rawB = tb / max(32f, sb)
                rGain = (rawR * 0.86f + lumRatio * 0.14f).coerceIn(0.65f, 1.48f)
                gGain = (rawG * 0.86f + lumRatio * 0.14f).coerceIn(0.65f, 1.48f)
                bGain = (rawB * 0.86f + lumRatio * 0.14f).coerceIn(0.62f, 1.46f)
            } else {
                rGain = (tr / max(45f, sr)).coerceIn(0.76f, 1.36f)
                gGain = (tg / max(42f, sg)).coerceIn(0.76f, 1.36f)
                bGain = (tb / max(38f, sb)).coerceIn(0.74f, 1.34f)
            }
        } else {
            rGain = 1.0f
            gGain = 1.0f
            bGain = 1.0f
        }

        applyShadowPreservingColorGrade(
            patch = patch,
            rGain = rGain,
            gGain = gGain,
            bGain = bGain,
            brightness = brightness,
            contrast = contrast,
            saturation = saturation,
            warmth = warmth
        )

        applyClaritySharpening(patch, clarityAmount = 0.38f)

        if (applyDefaultRadialMask) {
            val innerStop = (0.82f - featherRatio * 0.16f - (if (smartBlend) 0.03f else 0f)).coerceIn(0.62f, 0.86f)
            val gradient = RadialGradient(
                0f,
                0f,
                1f,
                intArrayOf(Color.WHITE, Color.WHITE, Color.argb(180, 255, 255, 255), Color.TRANSPARENT),
                floatArrayOf(0f, innerStop, (innerStop + 1f) * 0.52f, 1f),
                Shader.TileMode.CLAMP
            )
            val gradMatrix = Matrix().apply {
                setScale(patchW * 0.49f, patchH * 0.49f)
                postTranslate(patchW * 0.5f, patchH * 0.5f)
            }
            gradient.setLocalMatrix(gradMatrix)

            val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
                shader = gradient
            }
            pCanvas.drawRect(dstRect, maskPaint)
        }
        return patch
    }

    fun renderFaceSwapComposite(
        targetBitmap: Bitmap,
        faces: List<DetectedFaceData>,
        profileBitmaps: Map<String, Bitmap>,
        profileMetrics: Map<String, SourceFaceMetrics>,
        adjustments: FaceAdjustments,
        splitPercent: Float? = null,
        protectionMask: Bitmap? = null,
        segmentedLayers: SegmentedTargetLayers? = null
    ): Bitmap {
        val w = targetBitmap.width
        val h = targetBitmap.height
        val output = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)

        val hasDiscreteLayers = adjustments.preserveTargetLayers &&
            segmentedLayers != null &&
            !segmentedLayers.backgroundLayer.isRecycled &&
            !segmentedLayers.foreLayer.isRecycled

        val splitX = splitPercent?.let { w * (it / 100f) }

        // LAYER 1 (Background): Target photo with cheek-toned eye/lash cavity, or checkerboard when hidden
        if (adjustments.showBackgroundLayer) {
            if (splitX != null) {
                canvas.drawBitmap(targetBitmap, 0f, 0f, null)
                if (hasDiscreteLayers) {
                    val bgSave = canvas.save()
                    canvas.clipRect(splitX, 0f, w.toFloat(), h.toFloat())
                    canvas.drawBitmap(segmentedLayers!!.backgroundLayer, 0f, 0f, null)
                    canvas.restoreToCount(bgSave)
                }
            } else {
                val bgBmp = if (hasDiscreteLayers) segmentedLayers!!.backgroundLayer else targetBitmap
                canvas.drawBitmap(bgBmp, 0f, 0f, null)
            }
        } else {
            if (splitX != null) {
                canvas.drawBitmap(targetBitmap, 0f, 0f, null)
            }
            val bgSave = canvas.save()
            if (splitX != null) {
                canvas.clipRect(splitX, 0f, w.toFloat(), h.toFloat())
            }
            val darkPaint = Paint().apply { color = Color.rgb(15, 23, 42) }
            val lightPaint = Paint().apply { color = Color.rgb(30, 41, 59) }
            canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), darkPaint)
            val tile = max(18, min(w, h) / 26)
            var y = 0
            while (y < h) {
                var x = if ((y / tile) % 2 == 0) 0 else tile
                while (x < w) {
                    canvas.drawRect(
                        x.toFloat(),
                        y.toFloat(),
                        min(w, x + tile).toFloat(),
                        min(h, y + tile).toFloat(),
                        lightPaint
                    )
                    x += tile * 2
                }
                y += tile
            }
            canvas.restoreToCount(bgSave)
        }

        val swapLayer = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        swapLayer.setHasAlpha(true)
        val swapCanvas = Canvas(swapLayer)

        for (face in faces) {
            if (!adjustments.showFaceLayer) break
            if (!face.enabled) continue
            val profId = face.assignedProfileId ?: continue
            val srcBitmap = profileBitmaps[profId] ?: continue
            val metrics = profileMetrics[profId] ?: defaultSourceMetrics()

            val lm = face.landmarks
            val (viewerLeft, viewerRight) = if (lm.leftEye.x <= lm.rightEye.x) {
                lm.leftEye to lm.rightEye
            } else {
                lm.rightEye to lm.leftEye
            }
            val eyeDx = viewerRight.x - viewerLeft.x
            val eyeDy = viewerRight.y - viewerLeft.y
            val eyeDist = hypot(eyeDx.toDouble(), eyeDy.toDouble()).toFloat()
            val targetAngleDeg = Math.toDegrees(atan2(eyeDy.toDouble(), eyeDx.toDouble())).toFloat()
            val finalAngle = (targetAngleDeg - metrics.rollDeg) + adjustments.rotation

            val targetEyeMidX = (viewerLeft.x + viewerRight.x) * 0.5f + adjustments.offsetX
            val targetEyeMidY = (viewerLeft.y + viewerRight.y) * 0.5f + adjustments.offsetY

            // Strict isotropic scaling locked to donor aspectRatio -> keeps donor's true proportions (never stretched!)
            val safeAspect = metrics.aspectRatio.coerceIn(0.60f, 1.15f)
            val faceW = max(32f, eyeDist / max(0.22f, metrics.eyeDistRatio)) * adjustments.scale
            val faceH = max(36f, faceW / safeAspect)

            val patchW = max(20, faceW.toInt())
            val patchH = max(24, faceH.toInt())

            val manualPatch = adjustments.manualSkinPatch
            val autoCheekRgb = sampleFacialSkinOnlyRgb(
                targetBitmap,
                lm.nose.x.toInt(),
                (targetEyeMidY + (lm.nose.y - targetEyeMidY) * 0.55f).toInt(),
                max(6, (faceW * 0.24f).toInt()),
                max(6, (faceH * 0.16f).toInt())
            )
            val targetSkinRgb = if (adjustments.skinToneMatch) {
                if (manualPatch != null) {
                    Triple(manualPatch.sampledRed, manualPatch.sampledGreen, manualPatch.sampledBlue)
                } else {
                    autoCheekRgb
                }
            } else null

            val featherRatio = (adjustments.featherRadius / 50f).coerceIn(0.10f, 0.85f)
            val patch = createFeatheredInnerFacePatch(
                srcBitmap = srcBitmap,
                metrics = metrics,
                patchW = patchW,
                patchH = patchH,
                featherRatio = featherRatio,
                smartBlend = adjustments.smartBlend,
                targetSkinRgb = targetSkinRgb,
                applyDefaultRadialMask = false,
                isManualSkinReference = manualPatch != null,
                brightness = adjustments.brightness,
                contrast = adjustments.contrast,
                saturation = adjustments.saturation,
                warmth = adjustments.warmth
            )

            if (adjustments.virtualLight.enabled && adjustments.virtualLight.intensity > 0.015f) {
                val localLight = adjustments.virtualLight.copy(
                    directionDeg = adjustments.virtualLight.directionDeg - finalAngle
                )
                VirtualLightingStudioShader.applyFaceMeshRelighting(
                    patch = patch,
                    metrics = metrics,
                    light = localLight,
                    targetAmbientRgb = targetSkinRgb
                )
            }

            val swapMatrix = Matrix().apply {
                setTranslate(-patchW * metrics.eyeMidXRatio, -patchH * metrics.eyeMidYRatio)
                postRotate(finalAngle)
                postTranslate(targetEyeMidX, targetEyeMidY)
            }

            // Determine clean brow-top cut line in donor patch [0..1] so target's forehead/maang tikka/hair sits ON TOP
            val targetBrowAvgY = (face.leftBrowTop + face.rightBrowTop)
                .takeIf { it.isNotEmpty() }
                ?.let { pts -> pts.map { it.y }.average().toFloat() }
            val browBasedCut = if (targetBrowAvgY != null) {
                val offsetAboveEyes = (targetEyeMidY - targetBrowAvgY).coerceIn(eyeDist * 0.14f, eyeDist * 0.42f)
                (metrics.eyeMidYRatio - (offsetAboveEyes / max(1f, faceH)) - 0.035f).coerceIn(0.11f, 0.28f)
            } else {
                (metrics.eyeMidYRatio - metrics.eyeDistRatio * 0.34f).coerceIn(0.11f, 0.27f)
            }

            val autoOcclusions = (adjustments.autoMaskHair || adjustments.autoMaskAccessories || adjustments.autoMaskObjects) && !hasDiscreteLayers
            val useFallbackLayers = adjustments.preserveTargetLayers && !hasDiscreteLayers
            val foregroundPunch = FaceSwapEdgeBlendShader.applyContrastAwareEdgeBlend(
                patch = patch,
                targetSource = targetBitmap,
                swapMatrix = swapMatrix,
                featherRatio = featherRatio,
                smartBlend = adjustments.smartBlend,
                blendIntensity = (adjustments.smartBlendIntensity / 100f).coerceIn(0f, 1f),
                preserveHighContrastOcclusions = autoOcclusions,
                donorContourNorm = metrics.contourNorm,
                foreheadCutYRatio = browBasedCut,
                preserveTargetLayers = useFallbackLayers,
                returnForegroundPunch = useFallbackLayers || autoOcclusions
            )

            val alpha = ((adjustments.swapStrength / 100f) * (face.strength / 100f) * 255f)
                .toInt()
                .coerceIn(0, 255)
            val compositePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                this.alpha = alpha
            }

            // Fallback cavity fill only when discrete ML Kit backgroundLayer isn't active
            if (useFallbackLayers && alpha > 75) {
                val (sr, sg, sb) = targetSkinRgb ?: autoCheekRgb
                val cavityColor = Color.argb(
                    (alpha * 0.92f).toInt().coerceIn(0, 255),
                    sr.toInt().coerceIn(0, 255),
                    sg.toInt().coerceIn(0, 255),
                    sb.toInt().coerceIn(0, 255)
                )
                val cavityTrans = Color.argb(
                    0,
                    sr.toInt().coerceIn(0, 255),
                    sg.toInt().coerceIn(0, 255),
                    sb.toInt().coerceIn(0, 255)
                )
                val cavX = targetEyeMidX * 0.56f + lm.lips.x * 0.44f
                val cavY = targetEyeMidY * 0.58f + lm.lips.y * 0.42f
                val cavRx = max(10f, eyeDist * 0.78f * adjustments.scale)
                val cavRy = max(12f, abs(lm.lips.y - targetEyeMidY) * 0.86f * adjustments.scale)
                val cavShader = RadialGradient(
                    0f,
                    0f,
                    1f,
                    intArrayOf(cavityColor, cavityColor, cavityTrans),
                    floatArrayOf(0f, 0.56f, 1f),
                    Shader.TileMode.CLAMP
                )
                val cavPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    shader = cavShader
                }
                val cSave = swapCanvas.save()
                swapCanvas.translate(cavX, cavY)
                swapCanvas.rotate(targetAngleDeg)
                swapCanvas.scale(cavRx, cavRy)
                swapCanvas.drawCircle(0f, 0f, 1f, cavPaint)
                swapCanvas.restoreToCount(cSave)
            }

            // LAYER 2 (Face-behind-hair): Unstretched, sharp, color-matched donor face
            swapCanvas.drawBitmap(patch, swapMatrix, compositePaint)
            patch.recycle()

            if (foregroundPunch != null && !foregroundPunch.isRecycled) {
                if (adjustments.showForeLayers) {
                    val punchPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT)
                        this.alpha = alpha
                    }
                    swapCanvas.drawBitmap(foregroundPunch, swapMatrix, punchPaint)
                }
                foregroundPunch.recycle()
            }
        }

        // Apply manual Cutout Protection Mask (protects original hair, maang tikka, jewelry, veil)
        if (protectionMask != null && !protectionMask.isRecycled) {
            val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT)
            }
            if (protectionMask.width == w && protectionMask.height == h) {
                swapCanvas.drawBitmap(protectionMask, 0f, 0f, maskPaint)
            } else {
                swapCanvas.drawBitmap(
                    protectionMask,
                    null,
                    RectF(0f, 0f, w.toFloat(), h.toFloat()),
                    maskPaint
                )
            }
        }

        val saveCount = canvas.save()
        if (splitX != null) {
            canvas.clipRect(splitX, 0f, w.toFloat(), h.toFloat())
        }
        if (adjustments.showFaceLayer) {
            canvas.drawBitmap(swapLayer, 0f, 0f, null)
        }
        // LAYERS 3..N (Dynamic Object Cutouts: z-ordered forehead/hair/jewelry/hands/objects placed ON TOP non-destructively)
        if (hasDiscreteLayers && adjustments.showForeLayers) {
            val dynamicLayers = segmentedLayers!!.objectLayers
            if (dynamicLayers.isNotEmpty()) {
                for (objLayer in dynamicLayers) {
                    if (objLayer.id !in adjustments.hiddenLayerIds && !objLayer.bitmap.isRecycled) {
                        canvas.drawBitmap(objLayer.bitmap, 0f, 0f, null)
                    }
                }
            } else {
                canvas.drawBitmap(segmentedLayers.foreLayer, 0f, 0f, null)
            }
        }
        canvas.restoreToCount(saveCount)
        swapLayer.recycle()

        return output
    }

    fun drawGeometricMesh(canvas: Canvas, faces: List<DetectedFaceData>) {
        val wirePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(200, 34, 211, 238)
            strokeWidth = 2.2f
            style = Paint.Style.STROKE
        }
        val dotFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(34, 211, 238)
            style = Paint.Style.FILL
        }
        val dotRing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            strokeWidth = 2.2f
            style = Paint.Style.STROKE
        }

        for (face in faces) {
            val lm = face.landmarks
            val path = Path().apply {
                moveTo(lm.forehead.x, lm.forehead.y)
                lineTo(lm.leftEye.x, lm.leftEye.y)
                lineTo(lm.nose.x, lm.nose.y)
                lineTo(lm.rightEye.x, lm.rightEye.y)
                close()

                moveTo(lm.leftEye.x, lm.leftEye.y)
                lineTo(lm.lips.x, lm.lips.y)
                lineTo(lm.chin.x, lm.chin.y)
                lineTo(lm.rightEye.x, lm.rightEye.y)

                moveTo(lm.nose.x, lm.nose.y)
                lineTo(lm.lips.x, lm.lips.y)
            }
            canvas.drawPath(path, wirePaint)

            listOf(lm.forehead, lm.leftEye, lm.rightEye, lm.nose, lm.lips, lm.chin).forEach { pt ->
                canvas.drawCircle(pt.x, pt.y, 7.5f, dotFill)
                canvas.drawCircle(pt.x, pt.y, 7.5f, dotRing)
            }
        }
    }
}
