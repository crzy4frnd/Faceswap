package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import com.facemorph.studio.model.DetectedFaceData
import com.facemorph.studio.model.FaceAdjustments
import com.facemorph.studio.model.FaceLandmarksData
import com.facemorph.studio.model.Point2D
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max

object NativeFaceSwapEngine {

    private val detector by lazy {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .build()
        FaceDetection.getClient(options)
    }

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
                                    chin = Point2D(cx, b.bottom - fh * 0.06f)
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
        val fh = fw * 1.28f
        val cx = w * 0.5f
        val cy = h * 0.34f
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

    fun renderFaceSwapComposite(
        targetBitmap: Bitmap,
        faces: List<DetectedFaceData>,
        profileBitmaps: Map<String, Bitmap>,
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

            val lm = face.landmarks
            val eyeDx = lm.rightEye.x - lm.leftEye.x
            val eyeDy = lm.rightEye.y - lm.leftEye.y
            val eyeDist = hypot(eyeDx.toDouble(), eyeDy.toDouble()).toFloat()
            val angleDeg = Math.toDegrees(atan2(eyeDy.toDouble(), eyeDx.toDouble())).toFloat() + adjustments.rotation

            val faceW = max(face.boxRight - face.boxLeft, eyeDist * 2.15f) * adjustments.scale
            val faceH = max(face.boxBottom - face.boxTop, (lm.chin.y - lm.forehead.y) * 1.28f) * adjustments.scale

            val centerX = (lm.leftEye.x + lm.rightEye.x) * 0.5f + adjustments.offsetX
            val centerY = (lm.forehead.y + lm.chin.y) * 0.5f + adjustments.offsetY

            // Create oval feathered face patch on offscreen layer
            val patchW = max(16, faceW.toInt())
            val patchH = max(16, faceH.toInt())
            val patch = Bitmap.createBitmap(patchW, patchH, Bitmap.Config.ARGB_8888)
            val pCanvas = Canvas(patch)

            val srcRect = RectF(
                srcBitmap.width * 0.14f,
                srcBitmap.height * 0.12f,
                srcBitmap.width * 0.86f,
                srcBitmap.height * 0.88f
            )
            val dstRect = RectF(0f, 0f, patchW.toFloat(), patchH.toFloat())

            val facePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            if (adjustments.skinToneMatch) {
                val cm = ColorMatrix().apply {
                    setSaturation(0.95f)
                    val scale = 1.02f
                    postConcat(
                        ColorMatrix(
                            floatArrayOf(
                                scale, 0f, 0f, 0f, 4f,
                                0f, scale, 0f, 0f, 2f,
                                0f, 0f, scale * 0.96f, 0f, 0f,
                                0f, 0f, 0f, 1f, 0f
                            )
                        )
                    )
                }
                facePaint.colorFilter = ColorMatrixColorFilter(cm)
            }

            pCanvas.drawBitmap(
                srcBitmap,
                android.graphics.Rect(
                    srcRect.left.toInt(),
                    srcRect.top.toInt(),
                    srcRect.right.toInt(),
                    srcRect.bottom.toInt()
                ),
                dstRect,
                facePaint
            )

            // Apply smooth oval radial feather mask (Auto-Mask + Smart Blend)
            val featherRatio = (adjustments.featherRadius / 50f).coerceIn(0.15f, 0.85f)
            val smartFactor = if (adjustments.smartBlend) 0.18f else 0f
            val innerStop = (0.72f - featherRatio * 0.25f - smartFactor).coerceIn(0.2f, 0.78f)
            val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
                shader = RadialGradient(
                    patchW * 0.5f,
                    patchH * 0.5f,
                    max(patchW, patchH) * 0.52f,
                    intArrayOf(Color.WHITE, Color.WHITE, Color.TRANSPARENT),
                    floatArrayOf(0f, innerStop, 1f),
                    Shader.TileMode.CLAMP
                )
            }
            pCanvas.drawRect(dstRect, maskPaint)

            // Draw onto target composite with rotation & alpha strength
            val alpha = ((adjustments.swapStrength * face.strength) / 10000f * 255f).toInt().coerceIn(0, 255)
            val compositePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                this.alpha = alpha
            }

            canvas.save()
            canvas.translate(centerX, centerY)
            canvas.rotate(angleDeg)
            canvas.drawBitmap(patch, -patchW * 0.5f, -patchH * 0.5f, compositePaint)
            canvas.restore()
            patch.recycle()
        }

        canvas.restoreToCount(saveCount)
        return output
    }

    fun drawGeometricMesh(canvas: Canvas, faces: List<DetectedFaceData>) {
        val wirePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(200, 34, 211, 238)
            strokeWidth = 2.4f
            style = Paint.Style.STROKE
        }
        val dotFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(34, 211, 238)
            style = Paint.Style.FILL
        }
        val dotRing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            strokeWidth = 2.5f
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
                canvas.drawCircle(pt.x, pt.y, 9f, dotFill)
                canvas.drawCircle(pt.x, pt.y, 9f, dotRing)
            }
        }
    }
}
