package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.LiveCameraConfig
import com.facemorph.studio.model.SourceFaceMetrics
import com.facemorph.studio.model.WardrobeAssetItem
import com.facemorph.studio.model.WardrobeSubCategory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
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

    private val bodyPoseSmoother = BodyPoseMatrixSmoother()

    private data class FaceTrailNode(
        val eyeMidX: Float,
        val eyeMidY: Float,
        val patchW: Float,
        val patchH: Float,
        val angleDeg: Float,
        val timestampSec: Float
    )

    private val faceTrailHistory = ArrayDeque<FaceTrailNode>(8)
    private var prevTrailProfileHash: Int = 0
    private var prevTrailUseFront: Boolean = true
    private var prevTrailFrameW: Int = -1
    private var prevTrailFrameH: Int = -1
    private var smoothedTrailIntensity: Float = 0f
    private var lastTrailTimeSec: Float = -1f

    // Reusable offscreen compositing caches for asynchronous frame pipeline (zero per-frame large allocations)
    private var reusableFgLayer: Bitmap? = null
    private var cachedBgSourceRef: Bitmap? = null
    private var cachedBgW: Int = -1
    private var cachedBgH: Int = -1
    private var cachedScaledBg: Bitmap? = null
    private var reusableMatteAlphaPixels: IntArray = IntArray(0)

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
        timeSec: Float,
        reusableOutput: Bitmap? = null
    ): Bitmap {
        val w = frame.width
        val h = frame.height
        val reusingOutput = reusableOutput != null &&
            !reusableOutput.isRecycled &&
            reusableOutput.isMutable &&
            reusableOutput.width == w &&
            reusableOutput.height == h
        val output = if (reusingOutput) {
            reusableOutput!!
        } else {
            Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        }
        val canvas = Canvas(output)
        if (reusingOutput) {
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        }
        val dtSec = bodyPoseSmoother.checkContextAndGetDt(w, h, config.useFrontCamera, timeSec)

        // Run ML Kit Selfie Segmentation & Face Detection concurrently in parallel (eliminates sequential JNI latency)
        val needMatte = config.removeBackground ||
            (config.wearClothes && clothingAsset != null && clothingBitmap != null) ||
            (config.wearJewelry && jewelryAsset != null && jewelryBitmap != null)

        val (matteBitmap, detectedFace) = coroutineScope {
            val matteDeferred = if (needMatte) async(Dispatchers.Default) { extractPersonMatte(frame) } else null
            val faceDeferred = async(Dispatchers.Default) { detectFirstFaceFast(frame) }
            matteDeferred?.await() to faceDeferred.await()
        }

        // 1. Live Background Removal & Replacement (with cached scaled background & pooled fgLayer)
        if (config.removeBackground) {
            if (bgBitmap != null) {
                val scaledBg = getOrScaleBackground(bgBitmap, w, h)
                canvas.drawBitmap(scaledBg, 0f, 0f, null)
            } else if (config.activeBgId == "green") {
                canvas.drawColor(Color.rgb(0, 214, 70))
            } else {
                canvas.drawColor(Color.rgb(11, 17, 32))
            }

            if (matteBitmap != null) {
                val fgLayer = ensureReusableFgLayer(w, h)
                val fgCanvas = Canvas(fgLayer)
                fgCanvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
                fgCanvas.drawBitmap(frame, 0f, 0f, null)
                val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
                }
                val scaledMatte = Bitmap.createScaledBitmap(matteBitmap, w, h, true)
                scaledMatte.setHasAlpha(true)
                fgCanvas.drawBitmap(scaledMatte, 0f, 0f, maskPaint)
                canvas.drawBitmap(fgLayer, 0f, 0f, null)
                if (scaledMatte !== matteBitmap) scaledMatte.recycle()
            } else {
                canvas.drawBitmap(frame, 0f, 0f, null)
            }
        } else {
            canvas.drawBitmap(frame, 0f, 0f, null)
        }

        // 2. Temporally stabilize live face landmarks (prevents hand-shake jitter & 1-frame misses)
        val smoothFace = bodyPoseSmoother.stabilizeFace(
            rawCenterX = detectedFace?.centerX,
            rawCenterY = detectedFace?.centerY,
            rawBottomY = detectedFace?.bottomY,
            rawWidth = detectedFace?.width,
            rawHeight = detectedFace?.height,
            rawEyeMidX = detectedFace?.eyeMidX,
            rawEyeMidY = detectedFace?.eyeMidY,
            rawEyeDist = detectedFace?.eyeDist,
            rawRollDeg = detectedFace?.rollDeg,
            rawYawDeg = detectedFace?.yawDeg,
            rawPitchDeg = detectedFace?.pitchDeg,
            frameW = w,
            frameH = h,
            dtSec = dtSec
        )
        val faceCX = smoothFace.centerX
        val faceCY = smoothFace.centerY
        val faceW = smoothFace.width
        val faceH = smoothFace.height
        val chinY = smoothFace.bottomY
        val rollDeg = smoothFace.rollDeg

        // 3. Soft Feathered Skin & Lower-Face Hair Smoothing (never leaks background wall onto hair)
        if (config.removeHairAndBlemishes && config.hairRemovalIntensity > 0 && smoothFace.trackingConfidence > 0.25f) {
            applyFeatheredSkinSmooth(canvas, frame, faceCX, faceCY, faceW, faceH, config.hairRemovalIntensity)
        }

        // 4. Real-Time Inner-Face Swap (Kalman-Stabilized Matrix) + Velocity-Triggered Motion Trail
        var activeSwapTransform: StabilizedFaceSwapTransform? = null
        if (config.faceSwapEnabled && swapProfileBitmap != null && swapProfileMetrics != null && config.swapStrength > 0) {
            val swapTransform = bodyPoseSmoother.buildStabilizedFaceSwapTransform(
                stabilizedFace = smoothFace,
                eyeDistRatio = swapProfileMetrics.eyeDistRatio,
                eyeMidXRatio = swapProfileMetrics.eyeMidXRatio,
                eyeMidYRatio = swapProfileMetrics.eyeMidYRatio,
                sourceRollDeg = swapProfileMetrics.rollDeg,
                dtSec = dtSec
            )
            activeSwapTransform = swapTransform
            val patchW = swapTransform.patchWidth
            val patchH = swapTransform.patchHeight
            val targetSkinRgb = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(
                bmp = frame,
                cx = faceCX.toInt(),
                cy = (swapTransform.eyeMidY + faceH * 0.14f).toInt(),
                radiusX = max(6, (faceW * 0.24f).toInt()),
                radiusY = max(6, (faceH * 0.16f).toInt())
            )
            val patch = NativeFaceSwapEngine.createFeatheredInnerFacePatch(
                srcBitmap = swapProfileBitmap,
                metrics = swapProfileMetrics,
                patchW = patchW,
                patchH = patchH,
                featherRatio = 0.42f,
                smartBlend = true,
                targetSkinRgb = targetSkinRgb,
                applyDefaultRadialMask = false
            )

            if (config.virtualLight.enabled && config.virtualLight.intensity > 0.015f) {
                val localLight = config.virtualLight.copy(
                    directionDeg = config.virtualLight.directionDeg - swapTransform.angleDeg
                )
                VirtualLightingStudioShader.applyFaceMeshRelighting(
                    patch = patch,
                    metrics = swapProfileMetrics,
                    light = localLight,
                    targetAmbientRgb = targetSkinRgb
                )
            }

            FaceSwapEdgeBlendShader.applyContrastAwareEdgeBlend(
                patch = patch,
                targetSource = frame,
                swapMatrix = swapTransform.matrix,
                featherRatio = 0.42f,
                smartBlend = true,
                blendIntensity = 0.85f,
                preserveHighContrastOcclusions = true
            )

            val swapAlpha = ((config.swapStrength / 100f) * 255f).toInt().coerceIn(0, 255)

            // Render fluid motion trail behind the swapped face during rapid camera pans/rotations
            renderFaceSwapMotionTrailIfMoving(
                canvas = canvas,
                patch = patch,
                metrics = swapProfileMetrics,
                eyeMidX = swapTransform.eyeMidX,
                eyeMidY = swapTransform.eyeMidY,
                patchW = patchW.toFloat(),
                patchH = patchH.toFloat(),
                faceW = faceW,
                finalAngle = swapTransform.angleDeg,
                swapAlpha = swapAlpha,
                trackingConfidence = smoothFace.trackingConfidence,
                frameW = w,
                frameH = h,
                config = config,
                profileHash = System.identityHashCode(swapProfileBitmap),
                timeSec = timeSec
            )

            val swapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                alpha = swapAlpha
            }
            canvas.drawBitmap(patch, swapTransform.matrix, swapPaint)
            patch.recycle()
        } else {
            bodyPoseSmoother.resetFaceSwapKalman()
            clearFaceMotionTrail()
        }

        // Measure body pose keypoints from segmentation matte & interpolate face-to-pose transformation matrix
        val rawPose = extractRawBodyPoseKeypoints(
            matteBitmap = matteBitmap,
            frameW = w,
            frameH = h,
            face = smoothFace
        )
        val clothAspectRatio = if (clothingBitmap != null && clothingBitmap.width > 0) {
            clothingBitmap.height.toFloat() / clothingBitmap.width.toFloat()
        } else 1.0f
        val garmentMetrics = clothingBitmap?.let { GarmentStructureAnalyzer.analyze(it) }
        val bodyFitState = bodyPoseSmoother.updateAndInterpolateBodyTransform(
            stabilizedFace = smoothFace,
            rawPose = rawPose,
            garmentAspectRatio = clothAspectRatio,
            garmentShoulderSeamV = garmentMetrics?.shoulderSeamV ?: 0.14f,
            garmentShoulderWidthRatio = garmentMetrics?.shoulderWidthRatio ?: 0.80f,
            isWaistGarment = clothingAsset?.anchorPoint == BodyAnchorPoint.WAIST,
            dtSec = dtSec
        )
        val torso = bodyFitState.pose

        // 5. Real-Time Body-Fitted & Stretching Clothing Mesh using smoothed Face<->Pose Matrix
        if (config.wearClothes && clothingAsset != null && clothingBitmap != null) {
            renderBodyFittedClothingMesh(
                canvas = canvas,
                rawFrame = frame,
                frameW = w,
                frameH = h,
                clothingAsset = clothingAsset,
                clothingBitmap = clothingBitmap,
                config = config,
                fitState = bodyFitState,
                timeSec = timeSec
            )
        }

        // 6. Live Jewelry & Accessories anchored cleanly using stabilized pose keypoints
        if (config.wearJewelry && jewelryAsset != null && jewelryBitmap != null) {
            val scaleMul = jewelryAsset.defaultScale
            when (jewelryAsset.anchorPoint) {
                BodyAnchorPoint.HEAD -> {
                    if (jewelryAsset.subCategory == WardrobeSubCategory.GLASSES) {
                        val gW = faceW * 0.94f * scaleMul
                        val gH = gW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                        val scaledGlasses = Bitmap.createScaledBitmap(jewelryBitmap, max(8, gW.toInt()), max(8, gH.toInt()), true)
                        scaledGlasses.setHasAlpha(true)
                        canvas.save()
                        canvas.translate(smoothFace.eyeMidX, smoothFace.eyeMidY)
                        canvas.rotate(rollDeg)
                        canvas.drawBitmap(scaledGlasses, -gW * 0.5f, -gH * 0.5f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                        canvas.restore()
                        if (scaledGlasses !== jewelryBitmap) scaledGlasses.recycle()
                    } else {
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
                }
                BodyAnchorPoint.WRIST -> {
                    val jW = faceW * 0.58f * scaleMul
                    val jH = jW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val scaledWrist = Bitmap.createScaledBitmap(jewelryBitmap, max(8, jW.toInt()), max(8, jH.toInt()), true)
                    scaledWrist.setHasAlpha(true)
                    canvas.save()
                    canvas.translate(torso.leftChestX - faceW * 0.18f, min(h - jH * 0.4f, torso.waistY))
                    canvas.rotate(bodyFitState.effectiveTiltDeg * 0.5f)
                    canvas.drawBitmap(scaledWrist, -jW * 0.5f, -jH * 0.5f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                    canvas.restore()
                    if (scaledWrist !== jewelryBitmap) scaledWrist.recycle()
                }
                else -> {
                    val jW = faceW * 0.68f * scaleMul
                    val jH = jW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val pendSwing = sin(timeSec * 2.8f) * 1.8f
                    val shMidY = (torso.shoulderLeftY + torso.shoulderRightY) * 0.5f
                    val throatX = (torso.shoulderLeftX + torso.shoulderRightX) * 0.5f
                    val throatY = max(chinY + faceH * 0.08f, shMidY - faceH * 0.05f)
                    val scaledJewel = Bitmap.createScaledBitmap(jewelryBitmap, max(8, jW.toInt()), max(8, jH.toInt()), true)
                    scaledJewel.setHasAlpha(true)
                    canvas.save()
                    canvas.translate(throatX + pendSwing, throatY)
                    canvas.rotate(bodyFitState.effectiveTiltDeg * 0.5f + pendSwing * 0.45f)
                    canvas.drawBitmap(scaledJewel, -jW * 0.5f, 0f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                    canvas.restore()
                    if (scaledJewel !== jewelryBitmap) scaledJewel.recycle()
                }
            }
        }

        // 7. Toggleable Real-Time 3D Face Mesh & Body Alignment Wireframe Overlay
        if (config.showLandmarkMesh) {
            val hasOutfitOverlay = (config.wearClothes && clothingBitmap != null) ||
                (config.wearJewelry && jewelryBitmap != null)
            FaceMeshWireframeRenderer.render(
                canvas = canvas,
                smoothFace = smoothFace,
                rawFace = detectedFace?.rawGeometry,
                swapTransform = activeSwapTransform,
                bodyFitState = bodyFitState,
                showBodyFitMesh = hasOutfitOverlay
            )
        }

        matteBitmap?.recycle()
        return output
    }

    private fun clearFaceMotionTrail() {
        faceTrailHistory.clear()
        smoothedTrailIntensity = 0f
        lastTrailTimeSec = -1f
    }

    /**
     * Tracks recent swapped face poses and renders decaying, sub-step interpolated afterimages
     * strictly during rapid camera translation or rotation to give fluid alignment feedback.
     */
    private fun renderFaceSwapMotionTrailIfMoving(
        canvas: Canvas,
        patch: Bitmap,
        metrics: SourceFaceMetrics,
        eyeMidX: Float,
        eyeMidY: Float,
        patchW: Float,
        patchH: Float,
        faceW: Float,
        finalAngle: Float,
        swapAlpha: Int,
        trackingConfidence: Float,
        frameW: Int,
        frameH: Int,
        config: LiveCameraConfig,
        profileHash: Int,
        timeSec: Float
    ) {
        if (!config.faceMotionTrail || trackingConfidence < 0.25f) {
            clearFaceMotionTrail()
            return
        }

        if (profileHash != prevTrailProfileHash ||
            config.useFrontCamera != prevTrailUseFront ||
            frameW != prevTrailFrameW ||
            frameH != prevTrailFrameH ||
            (lastTrailTimeSec >= 0f && timeSec < lastTrailTimeSec - 0.1f)
        ) {
            clearFaceMotionTrail()
        }
        prevTrailProfileHash = profileHash
        prevTrailUseFront = config.useFrontCamera
        prevTrailFrameW = frameW
        prevTrailFrameH = frameH
        lastTrailTimeSec = timeSec

        // Purge expired trail nodes (>185ms old)
        while (faceTrailHistory.isNotEmpty() && (timeSec - faceTrailHistory.first().timestampSec) > 0.185f) {
            faceTrailHistory.removeFirst()
        }

        val lastNode = faceTrailHistory.lastOrNull()
        if (lastNode != null) {
            val movePx = hypot((eyeMidX - lastNode.eyeMidX).toDouble(), (eyeMidY - lastNode.eyeMidY).toDouble()).toFloat()
            val maxJumpPx = hypot(frameW.toDouble(), frameH.toDouble()).toFloat() * 0.42f
            if (movePx > maxJumpPx) {
                clearFaceMotionTrail()
            } else {
                val dt = (timeSec - lastNode.timestampSec).coerceIn(1f / 120f, 0.25f)
                val normLinSpeed = (movePx / max(1f, faceW)) / dt
                var angDelta = (finalAngle - lastNode.angleDeg) % 360f
                if (angDelta > 180f) angDelta -= 360f
                if (angDelta < -180f) angDelta += 360f
                val angSpeed = abs(angDelta) / dt

                val linActivity = ((normLinSpeed - 0.22f) / 1.55f).coerceIn(0f, 1f)
                val rotActivity = ((angSpeed - 14f) / 76f).coerceIn(0f, 1f)
                val targetIntensity = max(linActivity, rotActivity)

                val blendRate = if (targetIntensity > smoothedTrailIntensity) 0.56f else 0.22f
                smoothedTrailIntensity += (targetIntensity - smoothedTrailIntensity) * blendRate

                if (smoothedTrailIntensity > 0.04f && faceTrailHistory.isNotEmpty()) {
                    val trailPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
                    val renderSamples = ArrayList<Pair<FaceTrailNode, Float>>(faceTrailHistory.size + 1)

                    val histCount = faceTrailHistory.size
                    faceTrailHistory.forEachIndexed { idx, node ->
                        // Normalized age: oldest near 0.92, newest near 0.20
                        val age = 1f - ((idx + 1).toFloat() / (histCount + 1))
                        renderSamples.add(node to age)
                    }

                    // Add a sub-frame midpoint between last pose and current pose for silky continuity on fast pans
                    if (movePx > 6f) {
                        var midAng = (finalAngle - lastNode.angleDeg) % 360f
                        if (midAng > 180f) midAng -= 360f
                        if (midAng < -180f) midAng += 360f
                        val midNode = FaceTrailNode(
                            eyeMidX = (lastNode.eyeMidX + eyeMidX) * 0.5f,
                            eyeMidY = (lastNode.eyeMidY + eyeMidY) * 0.5f,
                            patchW = (lastNode.patchW + patchW) * 0.5f,
                            patchH = (lastNode.patchH + patchH) * 0.5f,
                            angleDeg = lastNode.angleDeg + midAng * 0.5f,
                            timestampSec = timeSec
                        )
                        renderSamples.add(midNode to 0.14f)
                    }

                    for ((sample, age) in renderSamples) {
                        val decay = (1f - age) * (1f - age)
                        val ghostAlpha = (swapAlpha * 0.36f * smoothedTrailIntensity * decay).toInt().coerceIn(0, 110)
                        if (ghostAlpha < 6) continue

                        val scaleShrink = 1f - age * 0.06f
                        val sx = (sample.patchW / max(1f, patch.width.toFloat())) * scaleShrink
                        val sy = (sample.patchH / max(1f, patch.height.toFloat())) * scaleShrink

                        trailPaint.alpha = ghostAlpha
                        canvas.save()
                        canvas.translate(sample.eyeMidX, sample.eyeMidY)
                        canvas.rotate(sample.angleDeg)
                        canvas.scale(sx, sy)
                        canvas.drawBitmap(
                            patch,
                            -patch.width * metrics.eyeMidXRatio,
                            -patch.height * metrics.eyeMidYRatio,
                            trailPaint
                        )
                        canvas.restore()
                    }
                }
            }
        }

        faceTrailHistory.addLast(
            FaceTrailNode(
                eyeMidX = eyeMidX,
                eyeMidY = eyeMidY,
                patchW = patchW,
                patchH = patchH,
                angleDeg = finalAngle,
                timestampSec = timeSec
            )
        )
        while (faceTrailHistory.size > 5) {
            faceTrailHistory.removeFirst()
        }
    }

    /**
     * Extracts raw shoulder (x, y), chest, and waist pose keypoints from the ML Kit selfie matte
     * along with a confidence score used to interpolate between face-tracking and body-pose transforms.
     */
    private fun extractRawBodyPoseKeypoints(
        matteBitmap: Bitmap?,
        frameW: Int,
        frameH: Int,
        face: StabilizedFacePose
    ): RawBodyPoseKeypoints {
        val faceCX = face.centerX
        val chinY = face.bottomY
        val faceW = face.width
        val faceH = face.height

        var leftRatio = 1.48f
        var rightRatio = 1.48f
        var dropRatio = 0.24f
        var leftShY = chinY + 0.24f * faceH
        var rightShY = chinY + 0.24f * faceH
        var leftChestRatio = 1.38f
        var rightChestRatio = 1.38f
        var leftWaistRatio = 1.24f
        var rightWaistRatio = 1.24f
        var validSignals = 0

        if (matteBitmap != null && matteBitmap.width > 12 && matteBitmap.height > 12) {
            val mw = matteBitmap.width
            val mh = matteBitmap.height
            val pixels = IntArray(mw * mh)
            matteBitmap.getPixels(pixels, 0, mw, 0, 0, mw, mh)

            val scaleX = mw.toFloat() / frameW
            val scaleY = mh.toFloat() / frameH
            val mCenterX = (faceCX * scaleX).toInt().coerceIn(2, mw - 3)
            val mChinY = (chinY * scaleY).toInt().coerceIn(1, mh - 4)
            val mFaceW = max(6f, faceW * scaleX)
            val mFaceH = max(8f, faceH * scaleY)

            fun scanRowSpan(my: Int, anchorX: Int): Pair<Float, Float>? {
                val ry = my.coerceIn(0, mh - 1)
                val row = ry * mw
                var seedX = -1
                if (Color.alpha(pixels[row + anchorX]) > 95) {
                    seedX = anchorX
                } else {
                    for (offset in 1..max(4, (mFaceW * 0.45f).toInt())) {
                        if (anchorX - offset >= 0 && Color.alpha(pixels[row + anchorX - offset]) > 95) {
                            seedX = anchorX - offset; break
                        }
                        if (anchorX + offset < mw && Color.alpha(pixels[row + anchorX + offset]) > 95) {
                            seedX = anchorX + offset; break
                        }
                    }
                }
                if (seedX < 0) return null

                var lx = seedX
                var gapsL = 0
                while (lx > 0) {
                    if (Color.alpha(pixels[row + lx - 1]) > 85) {
                        lx--
                        gapsL = 0
                    } else {
                        gapsL++
                        if (gapsL > 2) break
                        lx--
                    }
                }
                var rx = seedX
                var gapsR = 0
                while (rx < mw - 1) {
                    if (Color.alpha(pixels[row + rx + 1]) > 85) {
                        rx++
                        gapsR = 0
                    } else {
                        gapsR++
                        if (gapsR > 2) break
                        rx++
                    }
                }
                return (lx / scaleX) to (rx / scaleX)
            }

            fun sampleTopEdgeY(mx: Int, startMy: Int, endMy: Int): Float? {
                val cx = mx.coerceIn(0, mw - 1)
                val y0 = startMy.coerceIn(0, mh - 1)
                val y1 = endMy.coerceIn(y0, mh - 1)
                for (my in y0..y1) {
                    if (Color.alpha(pixels[my * mw + cx]) > 95) {
                        return my / scaleY
                    }
                }
                return null
            }

            val scanStartY = (mChinY + (mFaceH * 0.04f).toInt()).coerceIn(1, mh - 4)
            val scanEndY = (mChinY + (mFaceH * 0.95f).toInt()).coerceIn(scanStartY + 2, mh - 2)
            var shoulderAnchorMy = -1
            var detectedLeftSh = faceCX - faceW * 1.56f
            var detectedRightSh = faceCX + faceW * 1.56f

            // Locate collar-to-shoulder flare first, then measure full deltoid/upper-arm span slightly lower
            for (my in scanStartY..scanEndY) {
                val span = scanRowSpan(my, mCenterX) ?: continue
                val spanW = span.second - span.first
                if (spanW >= faceW * 1.62f) {
                    shoulderAnchorMy = my
                    val rowY = my / scaleY
                    dropRatio = ((rowY - chinY) / faceH).coerceIn(0.10f, 0.30f)

                    // Scan full shoulder-cap to upper-arm shelf to capture widest deltoid contour
                    val capStart = min(mh - 2, my + max(1, (mFaceH * 0.12f).toInt()))
                    val capEnd = min(mh - 1, my + max(3, (mFaceH * 0.42f).toInt()))
                    var bestSpanW = spanW
                    var bestL = span.first
                    var bestR = span.second
                    for (sy in capStart..capEnd) {
                        val capSpan = scanRowSpan(sy, mCenterX) ?: continue
                        val cw = capSpan.second - capSpan.first
                        if (cw > bestSpanW) {
                            bestSpanW = cw
                            bestL = capSpan.first
                            bestR = capSpan.second
                        }
                    }
                    detectedLeftSh = bestL
                    detectedRightSh = bestR
                    validSignals++
                    break
                }
            }

            leftRatio = ((faceCX - detectedLeftSh) / faceW).coerceIn(1.36f, 2.75f)
            rightRatio = ((detectedRightSh - faceCX) / faceW).coerceIn(1.36f, 2.75f)

            val baseShoulderY = chinY + dropRatio * faceH
            // Sample shoulder ridge height along both inner & mid-shoulder columns (stays tightly at collarbone level)
            val innerL = ((faceCX - faceW * 0.68f) * scaleX).toInt()
            val midL = ((faceCX - faceW * 0.96f) * scaleX).toInt()
            val innerR = ((faceCX + faceW * 0.68f) * scaleX).toInt()
            val midR = ((faceCX + faceW * 0.96f) * scaleX).toInt()
            val edgeScanTop = (mChinY + (mFaceH * 0.03f).toInt()).coerceIn(0, mh - 2)
            val edgeScanBot = min(mh - 1, (baseShoulderY * scaleY).toInt() + max(4, (mFaceH * 0.20f).toInt()))
            val l1 = sampleTopEdgeY(innerL, edgeScanTop, edgeScanBot)
            val l2 = sampleTopEdgeY(midL, edgeScanTop, edgeScanBot)
            val r1 = sampleTopEdgeY(innerR, edgeScanTop, edgeScanBot)
            val r2 = sampleTopEdgeY(midR, edgeScanTop, edgeScanBot)
            val rawLeftShY = when {
                l1 != null && l2 != null -> (l1 * 0.55f + l2 * 0.45f)
                else -> l1 ?: l2 ?: baseShoulderY
            }
            val rawRightShY = when {
                r1 != null && r2 != null -> (r1 * 0.55f + r2 * 0.45f)
                else -> r1 ?: r2 ?: baseShoulderY
            }
            leftShY = rawLeftShY.coerceIn(chinY + faceH * 0.08f, chinY + faceH * 0.34f)
            rightShY = rawRightShY.coerceIn(chinY + faceH * 0.08f, chinY + faceH * 0.34f)

            val chestStart = if (shoulderAnchorMy > 0) shoulderAnchorMy else scanStartY
            val mChestY = ((baseShoulderY + faceH * 0.48f) * scaleY).toInt().coerceIn(chestStart, mh - 2)
            val chestSpan = scanRowSpan(mChestY, mCenterX)
            if (chestSpan != null) {
                leftChestRatio = ((faceCX - chestSpan.first) / faceW).coerceIn(leftRatio * 0.90f, leftRatio * 1.12f)
                rightChestRatio = ((chestSpan.second - faceCX) / faceW).coerceIn(rightRatio * 0.90f, rightRatio * 1.12f)
                validSignals++
            } else {
                leftChestRatio = leftRatio * 0.98f
                rightChestRatio = rightRatio * 0.98f
            }

            val mWaistY = ((baseShoulderY + faceH * 1.05f) * scaleY).toInt().coerceIn(mChestY, mh - 1)
            val waistSpan = if (mWaistY < mh - 2) scanRowSpan(mWaistY, mCenterX) else null
            if (waistSpan != null) {
                leftWaistRatio = ((faceCX - waistSpan.first) / faceW).coerceIn(leftChestRatio * 0.84f, leftChestRatio * 1.04f)
                rightWaistRatio = ((waistSpan.second - faceCX) / faceW).coerceIn(rightChestRatio * 0.84f, rightChestRatio * 1.04f)
                validSignals++
            } else {
                leftWaistRatio = leftChestRatio * 0.92f
                rightWaistRatio = rightChestRatio * 0.92f
            }
        }

        val shoulderTopY = chinY + dropRatio * faceH
        val chestY = shoulderTopY + faceH * 0.48f
        val waistY = shoulderTopY + faceH * 1.15f
        val poseConfidence = if (matteBitmap != null && validSignals > 0) {
            (validSignals / 3f * 0.85f + 0.15f).coerceIn(0.25f, 1.0f)
        } else 0f

        return RawBodyPoseKeypoints(
            shoulderLeftX = faceCX - leftRatio * faceW,
            shoulderLeftY = leftShY,
            shoulderRightX = faceCX + rightRatio * faceW,
            shoulderRightY = rightShY,
            leftChestX = faceCX - leftChestRatio * faceW,
            rightChestX = faceCX + rightChestRatio * faceW,
            chestY = chestY,
            leftWaistX = faceCX - leftWaistRatio * faceW,
            rightWaistX = faceCX + rightWaistRatio * faceW,
            waistY = waistY,
            poseConfidence = poseConfidence
        )
    }

    /**
     * Samples ambient lighting luminance and color cast from the person's neck/upper-chest skin area
     * so AR garments match the live room's warmth & exposure naturally instead of looking flatly pasted.
     */
    private fun buildAmbientLightingColorFilter(
        rawFrame: Bitmap,
        faceCenterX: Float,
        chinY: Float,
        faceW: Float,
        faceH: Float
    ): ColorMatrixColorFilter {
        val sx = faceCenterX.toInt().coerceIn(4, rawFrame.width - 5)
        val sy = (chinY - faceH * 0.12f).toInt().coerceIn(4, rawFrame.height - 5)
        val rx = max(6, (faceW * 0.18f).toInt())
        val ry = max(6, (faceH * 0.12f).toInt())
        val (r, g, b) = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(rawFrame, sx, sy, rx, ry)
        val lum = (0.299f * r + 0.587f * g + 0.114f * b).coerceIn(55f, 225f)
        // Subtle 30% luminance adaptation + mild room warmth tint (keeps dark suits rich dark navy)
        val exposureScale = (1f + ((lum / 145f) - 1f) * 0.28f).coerceIn(0.82f, 1.18f)
        val meanC = max(1f, (r + g + b) / 3f)
        val rTint = (1f + ((r / meanC) - 1f) * 0.16f).coerceIn(0.92f, 1.08f)
        val gTint = (1f + ((g / meanC) - 1f) * 0.16f).coerceIn(0.92f, 1.08f)
        val bTint = (1f + ((b / meanC) - 1f) * 0.16f).coerceIn(0.92f, 1.08f)

        val cm = ColorMatrix().apply {
            setScale(exposureScale * rTint, exposureScale * gTint, exposureScale * bTint, 1f)
        }
        return ColorMatrixColorFilter(cm)
    }

    /**
     * Deforms the garment across an 8x9 local mesh transformed by the temporally smoothed
     * Face <-> Body Pose affine transformation matrix, anchoring garment shoulder seams directly
     * onto detected shoulders, wrapping the collar cleanly around the neck/jaw, and harmonizing lighting.
     */
    private fun renderBodyFittedClothingMesh(
        canvas: Canvas,
        rawFrame: Bitmap,
        frameW: Int,
        frameH: Int,
        clothingAsset: WardrobeAssetItem,
        clothingBitmap: Bitmap,
        config: LiveCameraConfig,
        fitState: StabilizedBodyFitState,
        timeSec: Float
    ) {
        val face = fitState.face
        val torso = fitState.pose
        val isWaist = clothingAsset.anchorPoint == BodyAnchorPoint.WAIST
        val scaleMul = clothingAsset.defaultScale * config.clothWidthScale.coerceIn(0.75f, 1.55f)
        val hug = config.clothFitHug.coerceIn(0.0f, 1.0f)

        val garmentW = max(1f, fitState.fittedShoulderWidth)
        val garmentH = max(1f, fitState.fittedGarmentHeight)
        val chestRatio = fitState.fittedChestRatio
        val waistRatio = fitState.fittedWaistRatio * (1.01f - hug * 0.08f)

        val cols = 8
        val rows = 9
        val verts = FloatArray(cols * rows * 2)

        val breatheNorm = (sin(timeSec * 1.8f) * max(1.6f, face.width * 0.022f)) / garmentW
        val hemSwayNorm = (sin(timeSec * 2.3f) * if (clothingAsset.fabricType.name == "SILK") 3.4f else 1.4f) / garmentW

        val torsoCenterX = (torso.shoulderLeftX + torso.shoulderRightX) * 0.5f
        val leftHalfSh = max(1f, torsoCenterX - torso.shoulderLeftX)
        val rightHalfSh = max(1f, torso.shoulderRightX - torsoCenterX)
        val yawAsym = ((rightHalfSh - leftHalfSh) / (rightHalfSh + leftHalfSh)).coerceIn(-0.18f, 0.18f)
        val seamV = fitState.shoulderSeamV.coerceIn(0.04f, 0.28f)
        val shoulderSlopeNorm = fitState.shoulderSlopeDiffY / garmentH

        for (r in 0 until rows) {
            val v = r.toFloat() / (rows - 1)

            val widthRatio = when {
                isWaist -> 0.98f + v * 0.16f
                v <= 0.36f -> {
                    val t = v / 0.36f
                    val st = t * t * (3f - 2f * t)
                    1.0f * (1f - st) + chestRatio * st
                }
                v <= 0.76f -> {
                    val t = (v - 0.36f) / 0.40f
                    val st = t * t * (3f - 2f * t)
                    chestRatio * (1f - st) + waistRatio * st
                }
                else -> {
                    val t = (v - 0.76f) / 0.24f
                    waistRatio * (1f + t * (0.06f - hug * 0.04f))
                }
            } + sin(v * PI.toFloat()) * breatheNorm * 1.25f

            val centerShiftX = when {
                isWaist -> fitState.waistOffsetRatioX + hemSwayNorm * v
                v <= 0.42f -> {
                    val t = v / 0.42f
                    fitState.chestOffsetRatioX * t
                }
                else -> {
                    val t = (v - 0.42f) / 0.58f
                    fitState.chestOffsetRatioX * (1f - t) + fitState.waistOffsetRatioX * t + hemSwayNorm * v * v
                }
            } + sin(v * PI.toFloat()) * yawAsym * (face.width / garmentW) * 0.16f

            for (c in 0 until cols) {
                val u = c.toFloat() / (cols - 1)
                val centeredU = u - 0.5f

                // Adapt upper shoulders subtly to real shoulder tilt/trapezius curve without pushing coat down off shoulders
                val shoulderSlopeAdjust = if (!isWaist && v < 0.42f) {
                    val falloff = 1f - (v / 0.42f)
                    val slopeFollow = centeredU * shoulderSlopeNorm * 0.45f
                    val armDropHint = if (v > seamV) (abs(centeredU) * 0.025f * falloff) else 0f
                    slopeFollow + armDropHint
                } else 0f

                val yawShiftScale = 1f + yawAsym * centeredU * 0.28f
                val scaledV = if (isWaist) v * scaleMul else seamV + (v - seamV) * scaleMul
                val idx = (r * cols + c) * 2
                verts[idx] = (centerShiftX + centeredU * widthRatio * yawShiftScale) * scaleMul
                verts[idx + 1] = scaledV + shoulderSlopeAdjust * scaleMul
            }
        }

        // Apply smoothed affine transformation matrix interpolated between Face Tracking and Body Pose Keypoints
        fitState.bodyFitMatrix.mapPoints(verts)

        // Apply immediate user collar vertical slider offset without damping lag
        val collarOffsetPx = config.clothCollarOffset
        if (collarOffsetPx != 0f) {
            for (i in 1 until verts.size step 2) {
                verts[i] += collarOffsetPx
            }
        }

        val meshPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            colorFilter = buildAmbientLightingColorFilter(rawFrame, face.centerX, face.bottomY, face.width, face.height)
            setShadowLayer(10f, 0f, 4f, Color.argb(85, 0, 0, 0))
        }

        canvas.save()
        // Anatomical Head + Chin + Front-Throat Cutout (EVEN_ODD):
        // Reveals jaw/beard/front-neck in front of back-collar while coat lapels hug sides of neck & cover shoulders!
        if (!isWaist) {
            val chinY = face.bottomY
            val neckHalfW = face.width * 0.25f
            val headOvalPath = Path().apply {
                addOval(
                    RectF(
                        face.centerX - face.width * 0.46f,
                        face.centerY - face.height * 0.56f,
                        face.centerX + face.width * 0.46f,
                        chinY + face.height * 0.02f
                    ),
                    Path.Direction.CW
                )
            }
            val throatDipPath = Path().apply {
                moveTo(face.centerX - neckHalfW, chinY - face.height * 0.08f)
                quadTo(
                    face.centerX - neckHalfW * 0.58f,
                    chinY + face.height * 0.14f,
                    face.centerX,
                    chinY + face.height * 0.17f
                )
                quadTo(
                    face.centerX + neckHalfW * 0.58f,
                    chinY + face.height * 0.14f,
                    face.centerX + neckHalfW,
                    chinY - face.height * 0.08f
                )
                close()
            }
            headOvalPath.op(throatDipPath, Path.Op.UNION)

            val jawHole = Path().apply {
                fillType = Path.FillType.EVEN_ODD
                addRect(0f, 0f, frameW.toFloat(), frameH.toFloat(), Path.Direction.CW)
                addPath(headOvalPath)
            }
            canvas.clipPath(jawHole)
        }

        canvas.drawBitmapMesh(
            clothingBitmap,
            cols - 1,
            rows - 1,
            verts,
            0,
            null,
            0,
            meshPaint
        )

        // Soft cast shadow under chin/throat onto collar lapels for physical 3D wearing depth
        if (!isWaist) {
            val shCenterY = face.bottomY + face.height * 0.14f
            val shRadius = max(12f, face.width * 0.48f)
            val collarShadowGrad = RadialGradient(
                0f, 0f, 1f,
                intArrayOf(Color.argb(95, 4, 6, 14), Color.argb(42, 4, 6, 14), Color.TRANSPARENT),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            ).apply {
                setLocalMatrix(
                    Matrix().apply {
                        setScale(shRadius, shRadius * 0.52f)
                        postTranslate(face.centerX, shCenterY)
                    }
                )
            }
            val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = collarShadowGrad
            }
            canvas.drawOval(
                RectF(
                    face.centerX - shRadius,
                    shCenterY - shRadius * 0.52f,
                    face.centerX + shRadius,
                    shCenterY + shRadius * 0.52f
                ),
                shadowPaint
            )
        }

        canvas.restore()
    }

    private fun getOrScaleBackground(bgBitmap: Bitmap, w: Int, h: Int): Bitmap {
        val cached = cachedScaledBg
        if (cachedBgSourceRef === bgBitmap && cachedBgW == w && cachedBgH == h && cached != null && !cached.isRecycled) {
            return cached
        }
        val scaled = if (bgBitmap.width == w && bgBitmap.height == h) bgBitmap else Bitmap.createScaledBitmap(bgBitmap, w, h, true)
        if (cached != null && cached !== cachedBgSourceRef && !cached.isRecycled) {
            cached.recycle()
        }
        cachedBgSourceRef = bgBitmap
        cachedBgW = w
        cachedBgH = h
        cachedScaledBg = scaled
        return scaled
    }

    private fun ensureReusableFgLayer(w: Int, h: Int): Bitmap {
        val existing = reusableFgLayer
        if (existing != null && !existing.isRecycled && existing.width == w && existing.height == h) {
            return existing
        }
        existing?.recycle()
        return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply {
            setHasAlpha(true)
            reusableFgLayer = this
        }
    }

    private suspend fun extractPersonMatte(bitmap: Bitmap): Bitmap? {
        return suspendCancellableCoroutine { cont ->
            try {
                val input = InputImage.fromBitmap(bitmap, 0)
                segmenter.process(input)
                    .addOnSuccessListener { mask ->
                        val mw = mask.width
                        val mh = mask.height
                        val total = mw * mh
                        val buf = mask.buffer
                        buf.rewind()
                        if (reusableMatteAlphaPixels.size < total) {
                            reusableMatteAlphaPixels = IntArray(total)
                        }
                        val alphaPixels = reusableMatteAlphaPixels
                        for (i in 0 until total) {
                            val conf = buf.float
                            val t = ((conf - 0.35f) / 0.45f).coerceIn(0f, 1f)
                            val smooth = t * t * (3f - 2f * t)
                            val a = (smooth * 255f).toInt().coerceIn(0, 255)
                            alphaPixels[i] = Color.argb(a, 255, 255, 255)
                        }
                        val matte = Bitmap.createBitmap(mw, mh, Bitmap.Config.ARGB_8888)
                        matte.setHasAlpha(true)
                        matte.setPixels(alphaPixels, 0, mw, 0, 0, mw, mh)
                        val down = Bitmap.createScaledBitmap(matte, max(16, mw / 2), max(16, mh / 2), true)
                        val featheredMatte = Bitmap.createScaledBitmap(down, mw, mh, true)
                        down.recycle()
                        matte.recycle()
                        if (cont.isActive) cont.resume(featheredMatte)
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
        val bottomY: Float,
        val width: Float,
        val height: Float,
        val eyeMidX: Float,
        val eyeMidY: Float,
        val eyeDist: Float,
        val rollDeg: Float,
        val yawDeg: Float,
        val pitchDeg: Float,
        val rawGeometry: RawDetectedFaceGeometry
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
                            val rawLe = f.getLandmark(FaceLandmark.LEFT_EYE)?.position
                            val rawRe = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position
                            val (le, re) = if (rawLe != null && rawRe != null && rawLe.x > rawRe.x) {
                                rawRe to rawLe
                            } else {
                                rawLe to rawRe
                            }
                            val noseBase = f.getLandmark(FaceLandmark.NOSE_BASE)?.position
                            val leftCheek = f.getLandmark(FaceLandmark.LEFT_CHEEK)?.position
                            val rightCheek = f.getLandmark(FaceLandmark.RIGHT_CHEEK)?.position
                            val mouthLeft = f.getLandmark(FaceLandmark.MOUTH_LEFT)?.position
                            val mouthRight = f.getLandmark(FaceLandmark.MOUTH_RIGHT)?.position
                            val mouthBottom = f.getLandmark(FaceLandmark.MOUTH_BOTTOM)?.position

                            val roll = if (le != null && re != null) {
                                Math.toDegrees(atan2((re.y - le.y).toDouble(), (re.x - le.x).toDouble())).toFloat()
                            } else {
                                -f.headEulerAngleZ
                            }
                            val yaw = f.headEulerAngleY
                            val pitch = f.headEulerAngleX
                            val eyeMidX = if (le != null && re != null) (le.x + re.x) * 0.5f else b.centerX().toFloat()
                            val eyeMidY = if (le != null && re != null) (le.y + re.y) * 0.5f else b.centerY() - fh * 0.1f
                            val eyeDist = if (le != null && re != null) {
                                hypot((re.x - le.x).toDouble(), (re.y - le.y).toDouble()).toFloat()
                            } else fw * 0.44f

                            val rawGeom = RawDetectedFaceGeometry(
                                boundingBox = RectF(b),
                                leftEye = le?.let { PointF(it.x, it.y) },
                                rightEye = re?.let { PointF(it.x, it.y) },
                                noseBase = noseBase?.let { PointF(it.x, it.y) },
                                leftCheek = leftCheek?.let { PointF(it.x, it.y) },
                                rightCheek = rightCheek?.let { PointF(it.x, it.y) },
                                mouthLeft = mouthLeft?.let { PointF(it.x, it.y) },
                                mouthRight = mouthRight?.let { PointF(it.x, it.y) },
                                mouthBottom = mouthBottom?.let { PointF(it.x, it.y) },
                                yawDeg = yaw,
                                pitchDeg = pitch,
                                rollDeg = roll
                            )

                            if (cont.isActive) {
                                cont.resume(
                                    FastFaceResult(
                                        centerX = b.centerX().toFloat(),
                                        centerY = b.centerY().toFloat(),
                                        bottomY = b.bottom.toFloat(),
                                        width = fw,
                                        height = fh,
                                        eyeMidX = eyeMidX,
                                        eyeMidY = eyeMidY,
                                        eyeDist = eyeDist,
                                        rollDeg = roll,
                                        yawDeg = yaw,
                                        pitchDeg = pitch,
                                        rawGeometry = rawGeom
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
