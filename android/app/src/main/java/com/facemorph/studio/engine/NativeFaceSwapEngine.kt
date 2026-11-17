package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
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
import com.facemorph.studio.model.SourceFaceMetrics
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

object NativeFaceSwapEngine {

    private val detector by lazy {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .build()
        FaceDetection.getClient(options)
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
                            val w = bitmap.width.toFloat()
                            val h = bitmap.height.toFloat()
                            val le = f.getLandmark(FaceLandmark.LEFT_EYE)?.position
                            val re = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position

                            // Crop tightly inside inner face (cheeks, brows to chin; excludes hair/background/shoulders)
                            val cropL = ((b.left + b.width() * 0.11f) / w).coerceIn(0.05f, 0.45f)
                            val cropR = ((b.right - b.width() * 0.11f) / w).coerceIn(cropL + 0.15f, 0.95f)
                            val cropT = ((b.top + b.height() * 0.12f) / h).coerceIn(0.05f, 0.45f)
                            val cropB = ((b.bottom - b.height() * 0.04f) / h).coerceIn(cropT + 0.15f, 0.95f)

                            val cropW = max(1f, (cropR - cropL) * w)
                            val cropH = max(1f, (cropB - cropT) * h)
                            val eyeMidX = if (le != null && re != null) ((le.x + re.x) * 0.5f - cropL * w) / cropW else 0.5f
                            val eyeMidY = if (le != null && re != null) ((le.y + re.y) * 0.5f - cropT * h) / cropH else 0.36f
                            val eyeDist = if (le != null && re != null) {
                                hypot((re.x - le.x).toDouble(), (re.y - le.y).toDouble()).toFloat() / cropW
                            } else 0.48f
                            val roll = if (le != null && re != null) {
                                Math.toDegrees(atan2((re.y - le.y).toDouble(), (re.x - le.x).toDouble())).toFloat()
                            } else -f.headEulerAngleZ

                            if (cont.isActive) {
                                cont.resume(
                                    SourceFaceMetrics(
                                        cropLeft = cropL,
                                        cropTop = cropT,
                                        cropRight = cropR,
                                        cropBottom = cropB,
                                        eyeMidXRatio = eyeMidX.coerceIn(0.3f, 0.7f),
                                        eyeMidYRatio = eyeMidY.coerceIn(0.22f, 0.52f),
                                        eyeDistRatio = eyeDist.coerceIn(0.3f, 0.75f),
                                        rollDeg = roll
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
        cropLeft = 0.33f,
        cropTop = 0.21f,
        cropRight = 0.67f,
        cropBottom = 0.57f,
        eyeMidXRatio = 0.5f,
        eyeMidYRatio = 0.36f,
        eyeDistRatio = 0.48f,
        rollDeg = 0f
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

                                val leftEyePos = f.getLandmark(FaceLandmark.LEFT_EYE)?.position
                                val rightEyePos = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position
                                val nosePos = f.getLandmark(FaceLandmark.NOSE_BASE)?.position
                                val mouthPos = f.getLandmark(FaceLandmark.MOUTH_BOTTOM)?.position

                                val lm = FaceLandmarksData(
                                    forehead = Point2D(cx, b.top + fh * 0.16f),
                                    leftEye = leftEyePos?.let { Point2D(it.x, it.y) }
                                        ?: Point2D(cx - fw * 0.21f, cy - fh * 0.10f),
                                    rightEye = rightEyePos?.let { Point2D(it.x, it.y) }
                                        ?: Point2D(cx + fw * 0.21f, cy - fh * 0.10f),
                                    nose = nosePos?.let { Point2D(it.x, it.y) }
                                        ?: Point2D(cx, cy + fh * 0.05f),
                                    lips = mouthPos?.let { Point2D(it.x, it.y - fh * 0.06f) }
                                        ?: Point2D(cx, cy + fh * 0.24f),
                                    chin = Point2D(cx, b.bottom - fh * 0.05f)
                                )
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
                                    strength = 92,
                                    smileScore = f.smilingProbability ?: 0.5f
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
                assignedProfileId = profileId
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
                    // Exclude dark beard/hair/eyes & gray background; target pure facial skin
                    if (r > 65 && g > 38 && b > 20 && r > g && (r - b) > 10) {
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

    /**
     * Samples a circular skin patch from the unmodified target body image using an interquartile
     * trimmed luminance filter so specular glare and stray hair/shadow specks do not skew color grading.
     */
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
     * Fast in-place luminance 3x3 unsharp clarity pass with coring threshold so eyes, brows,
     * and lips render crisp and vivid without amplifying noise or edge halos.
     */
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
                if (kotlin.math.abs(detail) < 1.6f) continue

                val delta = (detail * strength).coerceIn(-22f, 22f)
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
        isManualSkinReference: Boolean = false
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
        // Subtle clarity contrast & vibrance lift paired with skin-only or manual-patch color grading
        val rGain: Float
        val gGain: Float
        val bGain: Float
        val lumOffset: Float
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
                rGain = (rawR * 0.86f + lumRatio * 0.14f).coerceIn(0.64f, 1.48f)
                gGain = (rawG * 0.86f + lumRatio * 0.14f).coerceIn(0.64f, 1.48f)
                bGain = (rawB * 0.86f + lumRatio * 0.14f).coerceIn(0.62f, 1.46f)
                lumOffset = ((dstLum - srcLum) * 0.08f).coerceIn(-14f, 14f)
            } else {
                rGain = (tr / max(45f, sr)).coerceIn(0.82f, 1.26f)
                gGain = (tg / max(42f, sg)).coerceIn(0.82f, 1.26f)
                bGain = (tb / max(38f, sb)).coerceIn(0.80f, 1.24f)
                lumOffset = 0f
            }
        } else {
            rGain = 1.0f
            gGain = 1.0f
            bGain = 1.0f
            lumOffset = 0f
        }

        // Mild S-curve contrast pop (1.06x) prevents dull/washed appearance
        val cScale = 1.06f
        val cShift = -7.5f + lumOffset
        val cm = ColorMatrix().apply {
            set(
                floatArrayOf(
                    rGain * cScale, 0f, 0f, 0f, cShift,
                    0f, gGain * cScale, 0f, 0f, cShift,
                    0f, 0f, bGain * cScale, 0f, cShift,
                    0f, 0f, 0f, 1f, 0f
                )
            )
        }
        facePaint.colorFilter = ColorMatrixColorFilter(cm)

        pCanvas.drawBitmap(srcBitmap, srcRect, dstRect, facePaint)

        // Apply crisp luminance unsharp clarity filter before alpha perimeter mask
        applyClaritySharpening(patch, clarityAmount = 0.36f)

        // Solid opaque interior core (prevents blurry double-exposure ghosting on eyes/mouth), smooth edge feather
        if (applyDefaultRadialMask) {
            val innerStop = (0.76f - featherRatio * 0.24f - (if (smartBlend) 0.06f else 0f)).coerceIn(0.48f, 0.80f)
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
        splitPercent: Float? = null
    ): Bitmap {
        val w = targetBitmap.width
        val h = targetBitmap.height
        val output = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        canvas.drawBitmap(targetBitmap, 0f, 0f, null)

        val saveCount = canvas.save()
        if (splitPercent != null) {
            val splitX = w * (splitPercent / 100f)
            canvas.clipRect(splitX, 0f, w.toFloat(), h.toFloat())
        }

        for (face in faces) {
            if (!face.enabled) continue
            val profId = face.assignedProfileId ?: continue
            val srcBitmap = profileBitmaps[profId] ?: continue
            val metrics = profileMetrics[profId] ?: defaultSourceMetrics()

            val lm = face.landmarks
            val eyeDx = lm.rightEye.x - lm.leftEye.x
            val eyeDy = lm.rightEye.y - lm.leftEye.y
            val eyeDist = hypot(eyeDx.toDouble(), eyeDy.toDouble()).toFloat()
            val targetAngleDeg = Math.toDegrees(atan2(eyeDy.toDouble(), eyeDx.toDouble())).toFloat()
            val finalAngle = (targetAngleDeg - metrics.rollDeg) + adjustments.rotation

            // Inner face patch width & height derived from target inter-eye & brow-to-chin distances
            val faceW = max(32f, eyeDist / metrics.eyeDistRatio) * adjustments.scale
            val browToChin = max(face.boxBottom - face.boxTop, (lm.chin.y - lm.forehead.y) * 1.12f)
            val faceH = max(38f, browToChin * 0.86f) * adjustments.scale

            val targetEyeMidX = (lm.leftEye.x + lm.rightEye.x) * 0.5f + adjustments.offsetX
            val targetEyeMidY = (lm.leftEye.y + lm.rightEye.y) * 0.5f + adjustments.offsetY

            val patchW = max(20, faceW.toInt())
            val patchH = max(24, faceH.toInt())

            val manualPatch = adjustments.manualSkinPatch
            val targetSkinRgb = if (adjustments.skinToneMatch) {
                if (manualPatch != null) {
                    Triple(manualPatch.sampledRed, manualPatch.sampledGreen, manualPatch.sampledBlue)
                } else {
                    // Sample cheek & forehead bridge strictly inside clean skin oval (avoids moustaches/shadows)
                    sampleFacialSkinOnlyRgb(
                        targetBitmap,
                        lm.nose.x.toInt(),
                        ((lm.leftEye.y + lm.rightEye.y) * 0.5f + (lm.nose.y - lm.leftEye.y) * 0.35f).toInt(),
                        max(6, (faceW * 0.24f).toInt()),
                        max(6, (faceH * 0.16f).toInt())
                    )
                }
            } else null

            val featherRatio = (adjustments.featherRadius / 50f).coerceIn(0.15f, 0.85f)
            val patch = createFeatheredInnerFacePatch(
                srcBitmap = srcBitmap,
                metrics = metrics,
                patchW = patchW,
                patchH = patchH,
                featherRatio = featherRatio,
                smartBlend = adjustments.smartBlend,
                targetSkinRgb = targetSkinRgb,
                applyDefaultRadialMask = false,
                isManualSkinReference = manualPatch != null
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

            FaceSwapEdgeBlendShader.applyContrastAwareEdgeBlend(
                patch = patch,
                targetSource = targetBitmap,
                swapMatrix = swapMatrix,
                featherRatio = featherRatio,
                smartBlend = adjustments.smartBlend,
                blendIntensity = (adjustments.smartBlendIntensity / 100f).coerceIn(0f, 1f),
                preserveHighContrastOcclusions = adjustments.autoMaskHair || adjustments.autoMaskAccessories
            )

            val alpha = ((adjustments.swapStrength * face.strength) / 10000f * 255f).toInt().coerceIn(0, 255)
            val compositePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                this.alpha = alpha
            }

            canvas.drawBitmap(patch, swapMatrix, compositePaint)
            patch.recycle()
        }

        canvas.restoreToCount(saveCount)
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
