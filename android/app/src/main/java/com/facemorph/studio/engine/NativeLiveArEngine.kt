package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.LiveCameraConfig
import com.facemorph.studio.model.SourceFaceMetrics
import com.facemorph.studio.model.WardrobeAssetItem
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.atan2
import kotlin.math.hypot
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
        swapProfileMetrics: SourceFaceMetrics?,
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
                canvas.drawColor(Color.rgb(0, 214, 70))
            } else {
                canvas.drawColor(Color.rgb(11, 17, 32))
            }

            if (matteBitmap != null) {
                val fgLayer = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                fgLayer.setHasAlpha(true)
                val fgCanvas = Canvas(fgLayer)
                fgCanvas.drawBitmap(frame, 0f, 0f, null)
                val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
                }
                val scaledMatte = Bitmap.createScaledBitmap(matteBitmap, w, h, true)
                scaledMatte.setHasAlpha(true)
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

        // 2. Detect live face landmarks on raw camera frame for accurate alignment
        val detectedFace = detectFirstFaceFast(frame)
        val faceCX = detectedFace?.centerX ?: (w * 0.5f)
        val faceCY = detectedFace?.centerY ?: (h * 0.38f)
        val faceW = detectedFace?.width ?: (w * 0.34f)
        val faceH = detectedFace?.height ?: (faceW * 1.25f)
        val rollDeg = detectedFace?.rollDeg ?: 0f
        val eyeMidX = detectedFace?.eyeMidX ?: faceCX
        val eyeMidY = detectedFace?.eyeMidY ?: (faceCY - faceH * 0.10f)
        val eyeDist = detectedFace?.eyeDist ?: (faceW * 0.44f)

        // 3. Soft Feathered Skin & Lower-Face Hair Smoothing (never leaks background wall onto hair!)
        if (config.removeHairAndBlemishes && config.hairRemovalIntensity > 0 && detectedFace != null) {
            applyFeatheredSkinSmooth(canvas, frame, faceCX, faceCY, faceW, faceH, config.hairRemovalIntensity)
        }

        // 4. Real-Time Inner-Face Swap (strictly inner face, no background/hair/shoulders)
        if (config.faceSwapEnabled && swapProfileBitmap != null && swapProfileMetrics != null && config.swapStrength > 0) {
            val patchW = max(20, (eyeDist / swapProfileMetrics.eyeDistRatio).toInt())
            val patchH = max(24, (faceH * 0.86f).toInt())
            val patch = NativeFaceSwapEngine.createFeatheredInnerFacePatch(
                srcBitmap = swapProfileBitmap,
                metrics = swapProfileMetrics,
                patchW = patchW,
                patchH = patchH,
                featherRatio = 0.52f,
                smartBlend = true,
                targetSkinRgb = null
            )

            val swapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                alpha = ((config.swapStrength / 100f) * 255f).toInt().coerceIn(0, 255)
            }
            val finalAngle = rollDeg - swapProfileMetrics.rollDeg
            canvas.save()
            canvas.translate(eyeMidX, eyeMidY)
            canvas.rotate(finalAngle)
            canvas.drawBitmap(
                patch,
                -patchW * swapProfileMetrics.eyeMidXRatio,
                -patchH * swapProfileMetrics.eyeMidYRatio,
                swapPaint
            )
            canvas.restore()
            patch.recycle()
        }

        // 5. Live Clothing & Costumes anchored cleanly at collarbone/shoulders (below chin)
        if (config.wearClothes && clothingAsset != null && clothingBitmap != null) {
            val scaleMul = clothingAsset.defaultScale
            val gW = faceW * 2.55f * scaleMul
            val gH = gW * (clothingBitmap.height.toFloat() / clothingBitmap.width.toFloat())
            val breathe = sin(timeSec * 1.9f) * 2.2f
            val hemSway = sin(timeSec * 2.4f) * if (clothingAsset.fabricType.name == "SILK") 3.2f else 1.4f

            val scaledGarment = Bitmap.createScaledBitmap(clothingBitmap, max(8, gW.toInt()), max(8, gH.toInt()), true)
            scaledGarment.setHasAlpha(true)
            canvas.save()
            canvas.translate(faceCX + hemSway * 0.4f, faceCY + faceH * 0.62f + breathe * 0.4f)
            canvas.rotate(rollDeg * 0.35f + hemSway * 0.25f)
            canvas.drawBitmap(scaledGarment, -gW * 0.5f, 0f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            canvas.restore()
            if (scaledGarment !== clothingBitmap) scaledGarment.recycle()
        }

        // 6. Live Jewelry & Accessories anchored cleanly at collarbone or crown
        if (config.wearJewelry && jewelryAsset != null && jewelryBitmap != null) {
            val scaleMul = jewelryAsset.defaultScale
            when (jewelryAsset.anchorPoint) {
                BodyAnchorPoint.HEAD -> {
                    val hW = faceW * 1.25f * scaleMul
                    val hH = hW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val scaledHat = Bitmap.createScaledBitmap(jewelryBitmap, max(8, hW.toInt()), max(8, hH.toInt()), true)
                    scaledHat.setHasAlpha(true)
                    canvas.save()
                    canvas.translate(faceCX, faceCY - faceH * 0.52f)
                    canvas.rotate(rollDeg)
                    canvas.drawBitmap(scaledHat, -hW * 0.5f, -hH * 0.72f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                    canvas.restore()
                    if (scaledHat !== jewelryBitmap) scaledHat.recycle()
                }
                else -> {
                    val jW = faceW * 0.84f * scaleMul
                    val jH = jW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val pendSwing = sin(timeSec * 3.1f) * 2.2f
                    val scaledJewel = Bitmap.createScaledBitmap(jewelryBitmap, max(8, jW.toInt()), max(8, jH.toInt()), true)
                    scaledJewel.setHasAlpha(true)
                    canvas.save()
                    canvas.translate(faceCX + pendSwing, faceCY + faceH * 0.58f)
                    canvas.rotate(rollDeg * 0.25f + pendSwing * 0.6f)
                    canvas.drawBitmap(scaledJewel, -jW * 0.5f, 0f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                    canvas.restore()
                    if (scaledJewel !== jewelryBitmap) scaledJewel.recycle()
                }
            }
        }

        // 7. Optional Landmark Mesh Overlay
        if (config.showLandmarkMesh && detectedFace != null) {
            val meshPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(190, 34, 211, 238)
                style = Paint.Style.STROKE
                strokeWidth = 2.2f
            }
            canvas.drawOval(
                RectF(faceCX - faceW * 0.45f, faceCY - faceH * 0.48f, faceCX + faceW * 0.45f, faceCY + faceH * 0.48f),
                meshPaint
            )
            canvas.drawCircle(eyeMidX - eyeDist * 0.5f, eyeMidY, 4.5f, meshPaint)
            canvas.drawCircle(eyeMidX + eyeDist * 0.5f, eyeMidY, 4.5f, meshPaint)
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
                            val a = ((conf - 0.40f) / 0.42f * 255f).toInt().coerceIn(0, 255)
                            alphaPixels[i] = Color.argb(a, 255, 255, 255)
                        }
                        val matte = Bitmap.createBitmap(mw, mh, Bitmap.Config.ARGB_8888)
                        matte.setHasAlpha(true)
                        matte.setPixels(alphaPixels, 0, mw, 0, 0, mw, mh)
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
        val eyeMidX: Float,
        val eyeMidY: Float,
        val eyeDist: Float,
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
                            val fw = max(40f, b.width().toFloat())
                            val fh = max(40f, b.height().toFloat())
                            val le = f.getLandmark(FaceLandmark.LEFT_EYE)?.position
                            val re = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position
                            val roll = if (le != null && re != null) {
                                Math.toDegrees(atan2((re.y - le.y).toDouble(), (re.x - le.x).toDouble())).toFloat()
                            } else {
                                -f.headEulerAngleZ
                            }
                            val eyeMidX = if (le != null && re != null) (le.x + re.x) * 0.5f else b.centerX().toFloat()
                            val eyeMidY = if (le != null && re != null) (le.y + re.y) * 0.5f else b.centerY() - fh * 0.1f
                            val eyeDist = if (le != null && re != null) {
                                hypot((re.x - le.x).toDouble(), (re.y - le.y).toDouble()).toFloat()
                            } else fw * 0.44f

                            if (cont.isActive) {
                                cont.resume(
                                    FastFaceResult(
                                        centerX = b.centerX().toFloat(),
                                        centerY = b.centerY().toFloat(),
                                        width = fw,
                                        height = fh,
                                        eyeMidX = eyeMidX,
                                        eyeMidY = eyeMidY,
                                        eyeDist = eyeDist,
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

    private fun applyFeatheredSkinSmooth(
        canvas: Canvas,
        rawFrame: Bitmap,
        cx: Float,
        cy: Float,
        faceW: Float,
        faceH: Float,
        intensity: Int
    ) {
        val factor = (intensity / 100f).coerceIn(0f, 1f)
        val l = (cx - faceW * 0.38f).toInt().coerceIn(0, rawFrame.width - 10)
        val t = (cy - faceH * 0.15f).toInt().coerceIn(0, rawFrame.height - 10)
        val r = (cx + faceW * 0.38f).toInt().coerceIn(l + 8, rawFrame.width)
        val b = (cy + faceH * 0.45f).toInt().coerceIn(t + 8, rawFrame.height)
        val rw = r - l
        val rh = b - t

        val crop = Bitmap.createBitmap(rawFrame, l, t, rw, rh)
        val tiny = Bitmap.createScaledBitmap(crop, max(8, rw / 6), max(8, rh / 6), true)
        val soft = Bitmap.createScaledBitmap(tiny, rw, rh, true)
        crop.recycle()
        tiny.recycle()

        val smoothPatch = Bitmap.createBitmap(rw, rh, Bitmap.Config.ARGB_8888)
        smoothPatch.setHasAlpha(true)
        val spCanvas = Canvas(smoothPatch)
        spCanvas.drawBitmap(soft, 0f, 0f, null)
        soft.recycle()

        val gradient = RadialGradient(
            0f, 0f, 1f,
            intArrayOf(Color.WHITE, Color.argb(140, 255, 255, 255), Color.TRANSPARENT),
            floatArrayOf(0f, 0.55f, 1f),
            Shader.TileMode.CLAMP
        )
        gradient.setLocalMatrix(Matrix().apply {
            setScale(rw * 0.48f, rh * 0.48f)
            postTranslate(rw * 0.5f, rh * 0.5f)
        })
        spCanvas.drawRect(
            0f, 0f, rw.toFloat(), rh.toFloat(),
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
                shader = gradient
            }
        )

        val alphaPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            alpha = (factor * 110f).toInt().coerceIn(0, 120)
        }
        canvas.drawBitmap(smoothPatch, l.toFloat(), t.toFloat(), alphaPaint)
        smoothPatch.recycle()
    }
}
