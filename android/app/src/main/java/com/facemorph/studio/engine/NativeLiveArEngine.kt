package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.LiveCameraConfig
import com.facemorph.studio.model.WardrobeAssetItem
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.sin

object NativeLiveArEngine {

    private val segmenter by lazy {
        val opts = SelfieSegmenterOptions.Builder()
            .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE)
            .build()
        Segmentation.getClient(opts)
    }

    private val liveFaceDetector by lazy {
        val opts = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .build()
        FaceDetection.getClient(opts)
    }

    fun rotateAndMirrorBitmap(source: Bitmap, rotationDegrees: Int, mirrorHorizontal: Boolean): Bitmap {
        if (rotationDegrees == 0 && !mirrorHorizontal) return source
        val matrix = Matrix().apply {
            if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
            if (mirrorHorizontal) postScale(-1f, 1f)
        }
        return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    }

    suspend fun processLiveFrame(
        frame: Bitmap,
        config: LiveCameraConfig,
        bgBitmap: Bitmap?,
        swapProfileBitmap: Bitmap?,
        clothingAsset: WardrobeAssetItem?,
        clothingBitmap: Bitmap?,
        jewelryAsset: WardrobeAssetItem?,
        jewelryBitmap: Bitmap?,
        timeSec: Float
    ): Bitmap {
        val w = frame.width
        val h = frame.height
        val output = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)

        // 1. Live Background Removal & Replacement (ML Kit Selfie Segmentation)
        if (config.removeBackground) {
            val matteBitmap = extractPersonMatte(frame)
            if (bgBitmap != null) {
                val scaledBg = Bitmap.createScaledBitmap(bgBitmap, w, h, true)
                canvas.drawBitmap(scaledBg, 0f, 0f, null)
                if (scaledBg !== bgBitmap) scaledBg.recycle()
            } else if (config.activeBgId == "green") {
                canvas.drawColor(Color.rgb(0, 255, 51))
            } else {
                canvas.drawColor(Color.rgb(9, 13, 22))
            }

            if (matteBitmap != null) {
                val fgLayer = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val fgCanvas = Canvas(fgLayer)
                fgCanvas.drawBitmap(frame, 0f, 0f, null)
                val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
                }
                val scaledMatte = Bitmap.createScaledBitmap(matteBitmap, w, h, true)
                fgCanvas.drawBitmap(scaledMatte, 0f, 0f, maskPaint)
                canvas.drawBitmap(fgLayer, 0f, 0f, null)
                fgLayer.recycle()
                if (scaledMatte !== matteBitmap) scaledMatte.recycle()
                matteBitmap.recycle()
            } else {
                canvas.drawBitmap(frame, 0f, 0f, null)
            }
        } else {
            canvas.drawBitmap(frame, 0f, 0f, null)
        }

        // 2. Detect live face box & eyes for real-time alignment
        val detectedFace = detectFirstFaceFast(frame)
        val faceCX = detectedFace?.centerX ?: (w * 0.5f)
        val faceCY = detectedFace?.centerY ?: (h * 0.42f)
        val faceW = detectedFace?.width ?: (w * 0.34f)
        val faceH = detectedFace?.height ?: (faceW * 1.30f)
        val rollDeg = detectedFace?.rollDeg ?: 0f

        // 3. Unwanted Facial & Body Hair / Blemish Airbrushing
        if (config.removeHairAndBlemishes) {
            applySkinHairSmoothingOverlay(canvas, output, faceCX, faceCY, faceW, faceH, config.hairRemovalIntensity)
        }

        // 4. Real-Time Face Swap
        if (config.faceSwapEnabled && swapProfileBitmap != null && config.swapStrength > 0) {
            val patchW = max(16, faceW.toInt())
            val patchH = max(16, faceH.toInt())
            val patch = Bitmap.createBitmap(patchW, patchH, Bitmap.Config.ARGB_8888)
            val pCanvas = Canvas(patch)

            val srcRect = android.graphics.Rect(
                (swapProfileBitmap.width * 0.14f).toInt(),
                (swapProfileBitmap.height * 0.12f).toInt(),
                (swapProfileBitmap.width * 0.86f).toInt(),
                (swapProfileBitmap.height * 0.88f).toInt()
            )
            val dstRect = RectF(0f, 0f, patchW.toFloat(), patchH.toFloat())
            pCanvas.drawBitmap(swapProfileBitmap, srcRect, dstRect, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))

            val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
                shader = RadialGradient(
                    patchW * 0.5f,
                    patchH * 0.5f,
                    max(patchW, patchH) * 0.5f,
                    intArrayOf(Color.WHITE, Color.WHITE, Color.TRANSPARENT),
                    floatArrayOf(0f, 0.56f, 1f),
                    Shader.TileMode.CLAMP
                )
            }
            pCanvas.drawRect(dstRect, maskPaint)

            val swapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                alpha = ((config.swapStrength / 100f) * 255f).toInt().coerceIn(0, 255)
            }
            canvas.save()
            canvas.translate(faceCX, faceCY)
            canvas.rotate(rollDeg)
            canvas.drawBitmap(patch, -patchW * 0.5f, -patchH * 0.5f, swapPaint)
            canvas.restore()
            patch.recycle()
        }

        // 5. Live Clothing & Costumes with Physics Sway
        if (config.wearClothes && clothingAsset != null && clothingBitmap != null) {
            val scaleMul = clothingAsset.defaultScale
            val gW = faceW * 2.35f * scaleMul
            val gH = gW * (clothingBitmap.height.toFloat() / clothingBitmap.width.toFloat())
            val breathe = sin(timeSec * 1.9f) * 3f
            val hemSway = sin(timeSec * 2.4f) * if (clothingAsset.fabricType.name == "SILK") 4.2f else 1.8f

            val scaledGarment = Bitmap.createScaledBitmap(clothingBitmap, max(8, gW.toInt()), max(8, gH.toInt()), true)
            canvas.save()
            canvas.translate(faceCX + hemSway * 0.5f, faceCY + faceH * 0.44f + breathe * 0.5f)
            canvas.rotate(rollDeg * 0.4f + hemSway * 0.35f)
            canvas.drawBitmap(scaledGarment, -gW * 0.5f, 0f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            canvas.restore()
            if (scaledGarment !== clothingBitmap) scaledGarment.recycle()
        }

        // 6. Live Jewelry & Accessories (Pendulum Swing / Head / Wrist Anchoring)
        if (config.wearJewelry && jewelryAsset != null && jewelryBitmap != null) {
            val scaleMul = jewelryAsset.defaultScale
            when (jewelryAsset.anchorPoint) {
                BodyAnchorPoint.HEAD -> {
                    val hW = faceW * 1.25f * scaleMul
                    val hH = hW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val scaledHat = Bitmap.createScaledBitmap(jewelryBitmap, max(8, hW.toInt()), max(8, hH.toInt()), true)
                    canvas.save()
                    canvas.translate(faceCX, faceCY - faceH * 0.48f)
                    canvas.rotate(rollDeg)
                    canvas.drawBitmap(scaledHat, -hW * 0.5f, -hH * 0.7f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                    canvas.restore()
                    if (scaledHat !== jewelryBitmap) scaledHat.recycle()
                }
                else -> {
                    val jW = faceW * 0.95f * scaleMul
                    val jH = jW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val pendSwing = sin(timeSec * 3.1f) * 2.8f
                    val scaledJewel = Bitmap.createScaledBitmap(jewelryBitmap, max(8, jW.toInt()), max(8, jH.toInt()), true)
                    canvas.save()
                    canvas.translate(faceCX + pendSwing, faceCY + faceH * 0.48f)
                    canvas.rotate(rollDeg * 0.25f + pendSwing * 0.8f)
                    canvas.drawBitmap(scaledJewel, -jW * 0.5f, 0f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                    canvas.restore()
                    if (scaledJewel !== jewelryBitmap) scaledJewel.recycle()
                }
            }
        }

        // 7. Optional Landmark Mesh Overlay
        if (config.showLandmarkMesh) {
            val meshPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(190, 34, 211, 238)
                style = Paint.Style.STROKE
                strokeWidth = 2.5f
            }
            canvas.drawOval(
                RectF(faceCX - faceW * 0.5f, faceCY - faceH * 0.5f, faceCX + faceW * 0.5f, faceCY + faceH * 0.5f),
                meshPaint
            )
            canvas.drawCircle(faceCX - faceW * 0.2f, faceCY - faceH * 0.1f, 5f, meshPaint)
            canvas.drawCircle(faceCX + faceW * 0.2f, faceCY - faceH * 0.1f, 5f, meshPaint)
            canvas.drawCircle(faceCX, faceCY + faceH * 0.05f, 5f, meshPaint)
        }

        return output
    }

    private suspend fun extractPersonMatte(bitmap: Bitmap): Bitmap? {
        return suspendCancellableCoroutine { cont ->
            try {
                val input = InputImage.fromBitmap(bitmap, 0)
                segmenter.process(input)
                    .addOnSuccessListener { mask ->
                        val mw = mask.width
                        val mh = mask.height
                        val buf = mask.buffer
                        buf.rewind()
                        val alphaPixels = IntArray(mw * mh)
                        for (i in 0 until mw * mh) {
                            val conf = buf.float
                            val a = ((conf - 0.35f) / 0.45f * 255f).toInt().coerceIn(0, 255)
                            alphaPixels[i] = Color.argb(a, 255, 255, 255)
                        }
                        val matte = Bitmap.createBitmap(alphaPixels, mw, mh, Bitmap.Config.ARGB_8888)
                        if (cont.isActive) cont.resume(matte)
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(null)
                    }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    private data class FastFaceResult(
        val centerX: Float,
        val centerY: Float,
        val width: Float,
        val height: Float,
        val rollDeg: Float
    )

    private suspend fun detectFirstFaceFast(bitmap: Bitmap): FastFaceResult? {
        return suspendCancellableCoroutine { cont ->
            try {
                val input = InputImage.fromBitmap(bitmap, 0)
                liveFaceDetector.process(input)
                    .addOnSuccessListener { faces ->
                        val f = faces.firstOrNull()
                        if (f != null) {
                            val b = f.boundingBox
                            val le = f.getLandmark(FaceLandmark.LEFT_EYE)?.position
                            val re = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position
                            val roll = if (le != null && re != null) {
                                Math.toDegrees(atan2((re.y - le.y).toDouble(), (re.x - le.x).toDouble())).toFloat()
                            } else {
                                -f.headEulerAngleZ
                            }
                            if (cont.isActive) {
                                cont.resume(
                                    FastFaceResult(
                                        centerX = b.centerX().toFloat(),
                                        centerY = b.centerY().toFloat(),
                                        width = max(40f, b.width().toFloat()),
                                        height = max(40f, b.height().toFloat()),
                                        rollDeg = roll
                                    )
                                )
                            }
                        } else {
                            if (cont.isActive) cont.resume(null)
                        }
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(null)
                    }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    private fun applySkinHairSmoothingOverlay(
        canvas: Canvas,
        currentComposite: Bitmap,
        cx: Float,
        cy: Float,
        faceW: Float,
        faceH: Float,
        intensity: Int
    ) {
        if (intensity <= 0) return
        val factor = (intensity / 100f).coerceIn(0f, 1f)
        // Downsample and upsample cheek/chin/neck area for fast soft-focus bilateral smoothing
        val smallW = max(12, currentComposite.width / 8)
        val smallH = max(12, currentComposite.height / 8)
        val blurred = Bitmap.createScaledBitmap(currentComposite, smallW, smallH, true)
        val soft = Bitmap.createScaledBitmap(blurred, currentComposite.width, currentComposite.height, true)
        blurred.recycle()

        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            alpha = (factor * 115f).toInt().coerceIn(0, 140)
            colorFilter = ColorMatrixColorFilter(ColorMatrix().apply {
                set(
                    floatArrayOf(
                        1.03f, 0f, 0f, 0f, 4f,
                        0f, 1.01f, 0f, 0f, 2f,
                        0f, 0f, 0.98f, 0f, 0f,
                        0f, 0f, 0f, 1f, 0f
                    )
                )
            })
        }

        // Clip to lower face/jaw/neck zone to airbrush stubble & stray hair while keeping eyes crisp
        canvas.save()
        canvas.clipRect(
            cx - faceW * 0.7f,
            cy + faceH * 0.08f,
            cx + faceW * 0.7f,
            cy + faceH * 0.85f
        )
        canvas.drawBitmap(soft, 0f, 0f, paint)
        canvas.restore()
        soft.recycle()
    }
}
