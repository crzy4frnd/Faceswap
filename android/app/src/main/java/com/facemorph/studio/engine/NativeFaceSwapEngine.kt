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

    suspend fun detectFaces(bitmap: Bitmap, defaultProfileId: String): List<DetectedFaceData> {
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

    private fun fallbackCenterFace(bitmap: Bitmap, profileId: String): List<DetectedFaceData> {
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

    private fun sampleAverageSkinRgb(bmp: Bitmap, cx: Int, cy: Int, radius: Int): Triple<Float, Float, Float> {
        var r = 0L
        var g = 0L
        var b = 0L
        var count = 0
        val step = max(1, radius / 4)
        for (dy in -radius..radius step step) {
            val py = (cy + dy).coerceIn(0, bmp.height - 1)
            for (dx in -radius..radius step step) {
                val px = (cx + dx).coerceIn(0, bmp.width - 1)
                val c = bmp.getPixel(px, py)
                r += Color.red(c)
                g += Color.green(c)
                b += Color.blue(c)
                count++
            }
        }
        val n = max(1, count).toFloat()
        return Triple(r / n, g / n, b / n)
    }

    fun createFeatheredInnerFacePatch(
        srcBitmap: Bitmap,
        metrics: SourceFaceMetrics,
        patchW: Int,
        patchH: Int,
        featherRatio: Float,
        smartBlend: Boolean,
        targetSkinRgb: Triple<Float, Float, Float>? = null
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
        if (targetSkinRgb != null) {
            val srcCenterX = (sL + sR) / 2
            val srcCenterY = (sT + (sB - sT) * 0.56f).toInt()
            val (sr, sg, sb) = sampleAverageSkinRgb(srcBitmap, srcCenterX, srcCenterY, max(4, (sR - sL) / 8))
            val (tr, tg, tb) = targetSkinRgb
            val rGain = (tr / max(30f, sr)).coerceIn(0.76f, 1.32f)
            val gGain = (tg / max(30f, sg)).coerceIn(0.76f, 1.32f)
            val bGain = (tb / max(30f, sb)).coerceIn(0.74f, 1.30f)

            val cm = ColorMatrix().apply {
                set(
                    floatArrayOf(
                        rGain, 0f, 0f, 0f, 0f,
                        0f, gGain, 0f, 0f, 0f,
                        0f, 0f, bGain, 0f, 0f,
                        0f, 0f, 0f, 1f, 0f
                    )
                )
            }
            facePaint.colorFilter = ColorMatrixColorFilter(cm)
        }

        pCanvas.drawBitmap(srcBitmap, srcRect, dstRect, facePaint)

        // Elliptical anatomical face mask stretched cleanly to patchW x patchH
        val innerStop = (0.68f - featherRatio * 0.25f - (if (smartBlend) 0.12f else 0f)).coerceIn(0.24f, 0.72f)
        val gradient = RadialGradient(
            0f,
            0f,
            1f,
            intArrayOf(Color.WHITE, Color.WHITE, Color.argb(145, 255, 255, 255), Color.TRANSPARENT),
            floatArrayOf(0f, innerStop, (innerStop + 1f) * 0.5f, 1f),
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

            val targetSkinRgb = if (adjustments.skinToneMatch) {
                sampleAverageSkinRgb(
                    targetBitmap,
                    lm.nose.x.toInt(),
                    ((lm.nose.y + lm.lips.y) * 0.48f).toInt(),
                    max(4, (faceW * 0.11f).toInt())
                )
            } else null

            val patch = createFeatheredInnerFacePatch(
                srcBitmap = srcBitmap,
                metrics = metrics,
                patchW = patchW,
                patchH = patchH,
                featherRatio = (adjustments.featherRadius / 50f).coerceIn(0.15f, 0.85f),
                smartBlend = adjustments.smartBlend,
                targetSkinRgb = targetSkinRgb
            )

            val alpha = ((adjustments.swapStrength * face.strength) / 10000f * 255f).toInt().coerceIn(0, 255)
            val compositePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                this.alpha = alpha
            }

            canvas.save()
            canvas.translate(targetEyeMidX, targetEyeMidY)
            canvas.rotate(finalAngle)
            canvas.drawBitmap(
                patch,
                -patchW * metrics.eyeMidXRatio,
                -patchH * metrics.eyeMidYRatio,
                compositePaint
            )
            canvas.restore()
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
