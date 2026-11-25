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
import com.facemorph.studio.model.FaceAngleVariant
import com.facemorph.studio.model.FaceProfileItem
import com.facemorph.studio.model.LiveBodyMeasurementSummary
import com.facemorph.studio.model.LiveCameraConfig
import com.facemorph.studio.model.SourceFaceMetrics
import com.facemorph.studio.model.WardrobeAssetItem
import com.facemorph.studio.model.WardrobeSubCategory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
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
import kotlin.math.cos
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

    private val livePoseDetector by lazy {
        val opts = PoseDetectorOptions.Builder()
            .setDetectorMode(PoseDetectorOptions.STREAM_MODE)
            .setPreferredHardwareConfigs(PoseDetectorOptions.CPU_GPU)
            .build()
        PoseDetection.getClient(opts)
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
    private var reusableOcclFrame: Bitmap? = null
    private var reusableOcclOverlay: Bitmap? = null
    private var reusableOcclPixels: IntArray = IntArray(0)
    private var reusableOcclOutPixels: IntArray = IntArray(0)

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
        reusableOutput: Bitmap? = null,
        activeProfileAngles: List<Triple<FaceAngleVariant, Bitmap, SourceFaceMetrics>> = emptyList(),
        onBodyMeasurements: ((LiveBodyMeasurementSummary) -> Unit)? = null
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

        // Run ML Kit Selfie Segmentation, Face Detection, and Skeletal Pose Detection concurrently in parallel
        val needPose = (config.wearClothes && clothingAsset != null && clothingBitmap != null) ||
            (config.wearJewelry && jewelryAsset != null && jewelryBitmap != null) ||
            config.showLandmarkMesh ||
            config.showBodyMeasurements
        val needMatte = config.removeBackground || needPose

        val (matteBitmap, rawDetectedFace, detectedPose) = coroutineScope {
            val matteDeferred = if (needMatte) async(Dispatchers.Default) { extractPersonMatte(frame) } else null
            val faceDeferred = async(Dispatchers.Default) { detectFirstFaceFast(frame) }
            val poseDeferred = if (needPose) async(Dispatchers.Default) { detectPoseFast(frame) } else null
            Triple(matteDeferred?.await(), faceDeferred.await(), poseDeferred?.await())
        }
        val detectedFace = rawDetectedFace ?: detectedPose?.let { synthesizeFaceFromPose(it, w, h) }

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

        // 4. Real-Time Inner-Face Swap (Kalman-Stabilized Matrix) + Dynamic Multi-Angle Selection + Motion Trail
        var activeSwapTransform: StabilizedFaceSwapTransform? = null
        val canRunFaceSwap = config.faceSwapEnabled &&
            config.swapStrength > 0 &&
            (activeProfileAngles.isNotEmpty() || (swapProfileBitmap != null && swapProfileMetrics != null))
        if (canRunFaceSwap) {
            var chosenBitmap: Bitmap? = swapProfileBitmap
            var chosenMetrics: SourceFaceMetrics? = swapProfileMetrics
            var flippedTemp: Bitmap? = null

            if (activeProfileAngles.isNotEmpty()) {
                val tempProfile = FaceProfileItem(
                    id = "live-active",
                    name = "",
                    angles = activeProfileAngles.map { it.first }
                )
                val angleMetricsMap = activeProfileAngles.associate { it.first.id to it.third }
                val match = NativeFaceSwapEngine.findBestAngleForPose(
                    profile = tempProfile,
                    angleMetrics = angleMetricsMap,
                    targetYawDeg = smoothFace.yawDeg,
                    targetPitchDeg = smoothFace.pitchDeg,
                    targetRollDeg = smoothFace.rollDeg
                )
                val selectedTriple = activeProfileAngles.find { it.first.id == match.angleId }
                    ?: activeProfileAngles.first()
                if (match.shouldFlip) {
                    flippedTemp = NativeFaceSwapEngine.flipBitmapHorizontal(selectedTriple.second)
                    chosenBitmap = flippedTemp
                    chosenMetrics = NativeFaceSwapEngine.mirrorMetricsHorizontal(selectedTriple.third)
                } else {
                    chosenBitmap = selectedTriple.second
                    chosenMetrics = selectedTriple.third
                }
            }

            if (chosenBitmap != null && chosenMetrics != null) {
                val swapTransform = bodyPoseSmoother.buildStabilizedFaceSwapTransform(
                    stabilizedFace = smoothFace,
                    eyeDistRatio = chosenMetrics.eyeDistRatio,
                    eyeMidXRatio = chosenMetrics.eyeMidXRatio,
                    eyeMidYRatio = chosenMetrics.eyeMidYRatio,
                    sourceRollDeg = chosenMetrics.rollDeg,
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
                    srcBitmap = chosenBitmap,
                    metrics = chosenMetrics,
                    patchW = patchW,
                    patchH = patchH,
                    featherRatio = 0.42f,
                    smartBlend = true,
                    targetSkinRgb = targetSkinRgb,
                    applyDefaultRadialMask = false
                )
                flippedTemp?.recycle()

                if (config.virtualLight.enabled && config.virtualLight.intensity > 0.015f) {
                    val localLight = config.virtualLight.copy(
                        directionDeg = config.virtualLight.directionDeg - swapTransform.angleDeg
                    )
                    VirtualLightingStudioShader.applyFaceMeshRelighting(
                        patch = patch,
                        metrics = chosenMetrics,
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
                    metrics = chosenMetrics,
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
                    profileHash = System.identityHashCode(chosenBitmap),
                    timeSec = timeSec
                )

                val swapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                    alpha = swapAlpha
                }
                canvas.drawBitmap(patch, swapTransform.matrix, swapPaint)
                patch.recycle()
            } else {
                flippedTemp?.recycle()
                bodyPoseSmoother.resetFaceSwapKalman()
                clearFaceMotionTrail()
            }
        } else {
            bodyPoseSmoother.resetFaceSwapKalman()
            clearFaceMotionTrail()
        }

        // Measure skeletal pose + silhouette keypoints and interpolate face-to-pose transformation matrix
        val rawPose = extractRawBodyPoseKeypoints(
            pose = detectedPose,
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
                BodyAnchorPoint.EARRINGS -> {
                    val eW = faceW * 0.25f * scaleMul
                    val eH = eW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val earHalfW = faceW * 0.56f
                    val yawCos = cos(Math.toRadians(smoothFace.yawDeg.toDouble())).toFloat().coerceIn(0.45f, 1f)
                    val leftOffX = -earHalfW * (if (smoothFace.yawDeg < -10f) yawCos else 1f)
                    val rightOffX = earHalfW * (if (smoothFace.yawDeg > 10f) yawCos else 1f)
                    val earLocalY = faceH * 0.14f
                    val sway = sin(timeSec * 3.1f) * 2.4f
                    val scaledEarring = Bitmap.createScaledBitmap(jewelryBitmap, max(8, eW.toInt()), max(8, eH.toInt()), true)
                    scaledEarring.setHasAlpha(true)
                    val earPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

                    // Left earring
                    if (smoothFace.yawDeg > -42f) {
                        earPaint.alpha = if (smoothFace.yawDeg < -26f) 165 else 255
                        canvas.save()
                        canvas.translate(faceCX, faceCY)
                        canvas.rotate(rollDeg)
                        canvas.translate(leftOffX, earLocalY)
                        canvas.rotate(sway)
                        canvas.drawBitmap(scaledEarring, -eW * 0.5f, 0f, earPaint)
                        canvas.restore()
                    }
                    // Right earring (symmetrical mirror)
                    if (smoothFace.yawDeg < 42f) {
                        earPaint.alpha = if (smoothFace.yawDeg > 26f) 165 else 255
                        canvas.save()
                        canvas.translate(faceCX, faceCY)
                        canvas.rotate(rollDeg)
                        canvas.translate(rightOffX, earLocalY)
                        canvas.rotate(-sway)
                        canvas.scale(-1f, 1f)
                        canvas.drawBitmap(scaledEarring, -eW * 0.5f, 0f, earPaint)
                        canvas.restore()
                    }
                    if (scaledEarring !== jewelryBitmap) scaledEarring.recycle()
                }
                BodyAnchorPoint.WRIST -> {
                    val shoulderSpanPx = hypot(
                        (torso.shoulderRightX - torso.shoulderLeftX).toDouble(),
                        (torso.shoulderRightY - torso.shoulderLeftY).toDouble()
                    ).toFloat()
                    val jW = max(faceW * 0.44f, shoulderSpanPx * 0.17f) * scaleMul
                    val jH = jW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val scaledWrist = Bitmap.createScaledBitmap(jewelryBitmap, max(8, jW.toInt()), max(8, jH.toInt()), true)
                    scaledWrist.setHasAlpha(true)
                    val wristX = if (bodyFitState.wristTracked) {
                        torso.primaryWristX.coerceIn(jW * 0.35f, w - jW * 0.35f)
                    } else {
                        (torso.leftChestX - faceW * 0.18f).coerceIn(jW * 0.35f, w - jW * 0.35f)
                    }
                    val wristY = if (bodyFitState.wristTracked) {
                        torso.primaryWristY.coerceIn(jH * 0.35f, h - jH * 0.35f)
                    } else {
                        min(h - jH * 0.4f, torso.waistY)
                    }
                    val forearmDeg = if (bodyFitState.wristTracked) {
                        val dx = torso.primaryWristX - torso.primaryElbowX
                        val dy = torso.primaryWristY - torso.primaryElbowY
                        if (hypot(dx.toDouble(), dy.toDouble()) > 8.0) {
                            (Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat() - 90f)
                        } else {
                            bodyFitState.effectiveTiltDeg * 0.5f
                        }
                    } else {
                        bodyFitState.effectiveTiltDeg * 0.5f
                    }
                    canvas.save()
                    canvas.translate(wristX, wristY)
                    canvas.rotate(forearmDeg)
                    canvas.drawBitmap(scaledWrist, -jW * 0.5f, -jH * 0.5f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                    canvas.restore()
                    if (scaledWrist !== jewelryBitmap) scaledWrist.recycle()
                }
                else -> {
                    val shoulderSpanPx = hypot(
                        (torso.shoulderRightX - torso.shoulderLeftX).toDouble(),
                        (torso.shoulderRightY - torso.shoulderLeftY).toDouble()
                    ).toFloat()
                    val jW = max(faceW * 0.66f, shoulderSpanPx * 0.25f) * scaleMul
                    val jH = jW * (jewelryBitmap.height.toFloat() / jewelryBitmap.width.toFloat())
                    val pendSwing = sin(timeSec * 2.8f) * 1.8f
                    val shMidY = (torso.shoulderLeftY + torso.shoulderRightY) * 0.5f
                    val throatX = (torso.shoulderLeftX + torso.shoulderRightX) * 0.5f
                    val throatY = max(chinY + faceH * 0.08f, shMidY - faceH * 0.04f)
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

        // 6b. Restore foreground hands/forearms & hair hanging over collar in front of clothes & jewelry
        val hasOutfitOverlay = (config.wearClothes && clothingBitmap != null) ||
            (config.wearJewelry && jewelryBitmap != null)
        if (hasOutfitOverlay && matteBitmap != null) {
            restoreHandAndHairForegroundOcclusion(
                canvas = canvas,
                rawFrame = frame,
                matteBitmap = matteBitmap,
                frameW = w,
                frameH = h,
                face = smoothFace,
                pose = torso,
                wristTracked = bodyFitState.wristTracked
            )
        }

        // 7. Toggleable Real-Time 3D Face Mesh & Body Alignment Wireframe Overlay
        if (config.showLandmarkMesh) {
            val showTorsoWire = hasOutfitOverlay || bodyFitState.skeletonPoseActive
            FaceMeshWireframeRenderer.render(
                canvas = canvas,
                smoothFace = smoothFace,
                rawFace = detectedFace?.rawGeometry,
                swapTransform = activeSwapTransform,
                bodyFitState = bodyFitState,
                showBodyFitMesh = showTorsoWire
            )
        }

        onBodyMeasurements?.invoke(
            LiveBodyMeasurementSummary(
                shoulderCm = bodyFitState.shoulderCm,
                chestCm = bodyFitState.chestCm,
                waistCm = bodyFitState.waistCm,
                torsoCm = bodyFitState.torsoCm,
                estimatedSize = bodyFitState.estimatedSize,
                poseConfidence = bodyFitState.pose.poseConfidence,
                hasSkeletonPose = bodyFitState.skeletonPoseActive,
                hasHips = bodyFitState.hipTracked,
                hasWrists = bodyFitState.wristTracked
            )
        )

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
     * Extracts hybrid body pose keypoints combining real-time ML Kit skeletal landmarks
     * (shoulders, elbows, wrists, hips) with selfie segmentation matte contour widths so
     * garments and jewelry track exact body proportions, torso length, hips, and wrists live.
     */
    private fun extractRawBodyPoseKeypoints(
        pose: Pose?,
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

        var detectedLeftSh = faceCX - faceW * 1.48f
        var detectedRightSh = faceCX + faceW * 1.48f
        var chestY = chinY + 0.72f * faceH
        var waistY = chinY + 1.38f * faceH
        var detectedLeftChest = faceCX - faceW * 1.38f
        var detectedRightChest = faceCX + faceW * 1.38f
        var detectedLeftWaist = faceCX - faceW * 1.24f
        var detectedRightWaist = faceCX + faceW * 1.24f

        // 1. Query real skeletal keypoints from ML Kit Pose (sorted on screen X to handle front/rear camera mirror)
        var isSkeletonDetected = false
        var hipTracked = false
        var hipLeftX = detectedLeftWaist
        var hipRightX = detectedRightWaist
        var hipY = waistY

        var wristTracked = false
        var primaryWristX = detectedLeftWaist
        var primaryWristY = waistY
        var primaryElbowX = detectedLeftSh
        var primaryElbowY = chestY
        var wristScore = 0f

        var leftElbowX = detectedLeftSh
        var leftElbowY = chestY
        var rightElbowX = detectedRightSh
        var rightElbowY = chestY
        var leftWristX = detectedLeftWaist
        var leftWristY = waistY
        var rightWristX = detectedRightWaist
        var rightWristY = waistY

        if (pose != null) {
            val lShLm = pose.getPoseLandmark(PoseLandmark.LEFT_SHOULDER)
            val rShLm = pose.getPoseLandmark(PoseLandmark.RIGHT_SHOULDER)
            val shCandidates = listOfNotNull(
                lShLm?.takeIf { it.inFrameLikelihood >= 0.45f },
                rShLm?.takeIf { it.inFrameLikelihood >= 0.45f }
            )
            if (shCandidates.size == 2) {
                val (sLeft, sRight) = if (shCandidates[0].position.x <= shCandidates[1].position.x) {
                    shCandidates[0] to shCandidates[1]
                } else {
                    shCandidates[1] to shCandidates[0]
                }
                val rawMidX = (sLeft.position.x + sRight.position.x) * 0.5f
                val halfJointSpan = max(faceW * 0.90f, (sRight.position.x - sLeft.position.x) * 0.5f)
                // Acromion skeletal joints sit slightly inside outer deltoid sleeve contours (~1.16x outer span)
                val outerHalfSpan = halfJointSpan * 1.16f
                detectedLeftSh = rawMidX - outerHalfSpan
                detectedRightSh = rawMidX + outerHalfSpan
                leftShY = sLeft.position.y.coerceIn(chinY - faceH * 0.05f, frameH - 12f)
                rightShY = sRight.position.y.coerceIn(chinY - faceH * 0.05f, frameH - 12f)
                val shMidY = (leftShY + rightShY) * 0.5f
                dropRatio = ((shMidY - chinY) / max(18f, faceH)).coerceIn(0.05f, 0.55f)
                isSkeletonDetected = true
                validSignals += 2

                leftElbowX = detectedLeftSh
                leftElbowY = shMidY + faceH * 0.92f
                rightElbowX = detectedRightSh
                rightElbowY = shMidY + faceH * 0.92f
            }

            val lHipLm = pose.getPoseLandmark(PoseLandmark.LEFT_HIP)
            val rHipLm = pose.getPoseLandmark(PoseLandmark.RIGHT_HIP)
            val hipCandidates = listOfNotNull(
                lHipLm?.takeIf { it.inFrameLikelihood >= 0.42f },
                rHipLm?.takeIf { it.inFrameLikelihood >= 0.42f }
            )
            if (hipCandidates.size == 2) {
                val (hLeft, hRight) = if (hipCandidates[0].position.x <= hipCandidates[1].position.x) {
                    hipCandidates[0] to hipCandidates[1]
                } else {
                    hipCandidates[1] to hipCandidates[0]
                }
                val shMidY = (leftShY + rightShY) * 0.5f
                val rawHipY = (hLeft.position.y + hRight.position.y) * 0.5f
                if (rawHipY > shMidY + faceH * 0.55f) {
                    val rawHipMidX = (hLeft.position.x + hRight.position.x) * 0.5f
                    val hipHalf = max(faceW * 0.72f, (hRight.position.x - hLeft.position.x) * 0.5f * 1.24f)
                    hipLeftX = rawHipMidX - hipHalf
                    hipRightX = rawHipMidX + hipHalf
                    hipY = rawHipY.coerceIn(shMidY + faceH * 0.65f, frameH * 1.05f)
                    hipTracked = true
                    validSignals += 2
                }
            }

            val lElb = pose.getPoseLandmark(PoseLandmark.LEFT_ELBOW)?.takeIf { it.inFrameLikelihood >= 0.38f }
            val rElb = pose.getPoseLandmark(PoseLandmark.RIGHT_ELBOW)?.takeIf { it.inFrameLikelihood >= 0.38f }
            val elbPair = listOfNotNull(lElb, rElb)
            if (elbPair.size == 2) {
                val (eLeft, eRight) = if (elbPair[0].position.x <= elbPair[1].position.x) elbPair[0] to elbPair[1] else elbPair[1] to elbPair[0]
                leftElbowX = eLeft.position.x; leftElbowY = eLeft.position.y
                rightElbowX = eRight.position.x; rightElbowY = eRight.position.y
            } else if (elbPair.size == 1) {
                val single = elbPair[0]
                if (single.position.x <= faceCX) {
                    leftElbowX = single.position.x; leftElbowY = single.position.y
                } else {
                    rightElbowX = single.position.x; rightElbowY = single.position.y
                }
            }

            val lWr = pose.getPoseLandmark(PoseLandmark.LEFT_WRIST)?.takeIf { it.inFrameLikelihood >= 0.45f }
            val rWr = pose.getPoseLandmark(PoseLandmark.RIGHT_WRIST)?.takeIf { it.inFrameLikelihood >= 0.45f }
            val wrPair = listOfNotNull(lWr, rWr)
            if (wrPair.size == 2) {
                val (wLeft, wRight) = if (wrPair[0].position.x <= wrPair[1].position.x) wrPair[0] to wrPair[1] else wrPair[1] to wrPair[0]
                leftWristX = wLeft.position.x; leftWristY = wLeft.position.y
                rightWristX = wRight.position.x; rightWristY = wRight.position.y
            } else if (wrPair.size == 1) {
                val single = wrPair[0]
                if (single.position.x <= faceCX) {
                    leftWristX = single.position.x; leftWristY = single.position.y
                } else {
                    rightWristX = single.position.x; rightWristY = single.position.y
                }
            }

            // Track highest-confidence wrist + matching anatomical elbow for watch/bracelet placement
            val leftPairScore = lWr?.inFrameLikelihood ?: 0f
            val rightPairScore = rWr?.inFrameLikelihood ?: 0f
            val chosenWr = if (leftPairScore >= rightPairScore) lWr else rWr
            val chosenElb = if (leftPairScore >= rightPairScore) lElb else rElb
            if (chosenWr != null && chosenWr.inFrameLikelihood >= 0.45f &&
                chosenWr.position.x in 4f..(frameW - 4f) &&
                chosenWr.position.y in 4f..(frameH - 4f)
            ) {
                wristTracked = true
                primaryWristX = chosenWr.position.x
                primaryWristY = chosenWr.position.y
                primaryElbowX = chosenElb?.position?.x ?: chosenWr.position.x
                primaryElbowY = chosenElb?.position?.y ?: (chosenWr.position.y - faceH * 0.7f)
                wristScore = chosenWr.inFrameLikelihood
            }
        }

        val shMidY = if (isSkeletonDetected) (leftShY + rightShY) * 0.5f else chinY + dropRatio * faceH
        if (hipTracked) {
            chestY = shMidY + (hipY - shMidY) * 0.36f
            waistY = shMidY + (hipY - shMidY) * 0.74f
        } else {
            chestY = shMidY + faceH * 0.48f
            waistY = shMidY + faceH * 1.15f
        }

        // 2. Scan segmentation matte to cross-validate exact garment outer contour widths at chest & waist
        if (matteBitmap != null && matteBitmap.width > 12 && matteBitmap.height > 12) {
            val mw = matteBitmap.width
            val mh = matteBitmap.height
            val pixels = IntArray(mw * mh)
            matteBitmap.getPixels(pixels, 0, mw, 0, 0, mw, mh)

            val scaleX = mw.toFloat() / frameW
            val scaleY = mh.toFloat() / frameH
            val shMidFrameX = if (isSkeletonDetected) (detectedLeftSh + detectedRightSh) * 0.5f else faceCX
            val mCenterX = (shMidFrameX * scaleX).toInt().coerceIn(2, mw - 3)
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
            var shoulderAnchorMy = (shMidY * scaleY).toInt().coerceIn(scanStartY, mh - 2)

            if (!isSkeletonDetected) {
                for (my in scanStartY..scanEndY) {
                    val span = scanRowSpan(my, mCenterX) ?: continue
                    val spanW = span.second - span.first
                    if (spanW >= faceW * 1.62f) {
                        shoulderAnchorMy = my
                        val rowY = my / scaleY
                        dropRatio = ((rowY - chinY) / faceH).coerceIn(0.10f, 0.30f)

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

                val baseShoulderY = chinY + dropRatio * faceH
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
                val rawLeftShY = if (l1 != null && l2 != null) (l1 * 0.55f + l2 * 0.45f) else (l1 ?: l2 ?: baseShoulderY)
                val rawRightShY = if (r1 != null && r2 != null) (r1 * 0.55f + r2 * 0.45f) else (r1 ?: r2 ?: baseShoulderY)
                leftShY = rawLeftShY.coerceIn(chinY + faceH * 0.08f, chinY + faceH * 0.34f)
                rightShY = rawRightShY.coerceIn(chinY + faceH * 0.08f, chinY + faceH * 0.34f)
            }

            leftRatio = ((faceCX - detectedLeftSh) / max(18f, faceW)).coerceIn(0.95f, 2.75f)
            rightRatio = ((detectedRightSh - faceCX) / max(18f, faceW)).coerceIn(0.95f, 2.75f)

            val mChestY = (chestY * scaleY).toInt().coerceIn(shoulderAnchorMy, mh - 2)
            val chestSpan = scanRowSpan(mChestY, mCenterX)
            val skelHalfSh = (detectedRightSh - detectedLeftSh) * 0.5f
            if (chestSpan != null) {
                val cMid = (detectedLeftSh + detectedRightSh) * 0.5f
                val maxChestHalf = if (isSkeletonDetected) skelHalfSh * 1.15f else skelHalfSh * 1.10f
                val minChestHalf = if (isSkeletonDetected) skelHalfSh * 0.72f else skelHalfSh * 0.85f
                val rawHalfL = (cMid - chestSpan.first).coerceIn(minChestHalf, maxChestHalf)
                val rawHalfR = (chestSpan.second - cMid).coerceIn(minChestHalf, maxChestHalf)
                detectedLeftChest = cMid - rawHalfL
                detectedRightChest = cMid + rawHalfR
                validSignals++
            } else {
                val cMid = (detectedLeftSh + detectedRightSh) * 0.5f
                detectedLeftChest = cMid - skelHalfSh * 0.90f
                detectedRightChest = cMid + skelHalfSh * 0.90f
            }

            val mWaistY = (waistY * scaleY).toInt().coerceIn(mChestY, mh - 1)
            val waistSpan = if (mWaistY < mh - 2) scanRowSpan(mWaistY, mCenterX) else null
            val chestHalfW = (detectedRightChest - detectedLeftChest) * 0.5f
            if (waistSpan != null) {
                val wMid = if (hipTracked) (hipLeftX + hipRightX) * 0.5f else (detectedLeftChest + detectedRightChest) * 0.5f
                val matteHalfL = (wMid - waistSpan.first).coerceIn(chestHalfW * 0.70f, chestHalfW * 1.08f)
                val matteHalfR = (waistSpan.second - wMid).coerceIn(chestHalfW * 0.70f, chestHalfW * 1.08f)
                if (hipTracked) {
                    val hipHalf = (hipRightX - hipLeftX) * 0.5f
                    detectedLeftWaist = wMid - (matteHalfL * 0.55f + hipHalf * 0.45f)
                    detectedRightWaist = wMid + (matteHalfR * 0.55f + hipHalf * 0.45f)
                } else {
                    detectedLeftWaist = wMid - matteHalfL
                    detectedRightWaist = wMid + matteHalfR
                }
                validSignals++
            } else if (hipTracked) {
                val wMid = (hipLeftX + hipRightX) * 0.5f
                val hipHalf = (hipRightX - hipLeftX) * 0.5f
                detectedLeftWaist = wMid - hipHalf * 0.96f
                detectedRightWaist = wMid + hipHalf * 0.96f
            } else {
                val wMid = (detectedLeftChest + detectedRightChest) * 0.5f
                detectedLeftWaist = wMid - chestHalfW * 0.88f
                detectedRightWaist = wMid + chestHalfW * 0.88f
            }
        } else if (isSkeletonDetected) {
            val cMid = (detectedLeftSh + detectedRightSh) * 0.5f
            val shHalf = (detectedRightSh - detectedLeftSh) * 0.5f
            detectedLeftChest = cMid - shHalf * 0.88f
            detectedRightChest = cMid + shHalf * 0.88f
            if (hipTracked) {
                val hMid = (hipLeftX + hipRightX) * 0.5f
                val hHalf = (hipRightX - hipLeftX) * 0.5f
                detectedLeftWaist = hMid - hHalf * 0.95f
                detectedRightWaist = hMid + hHalf * 0.95f
            } else {
                detectedLeftWaist = cMid - shHalf * 0.80f
                detectedRightWaist = cMid + shHalf * 0.80f
            }
        }

        val poseConfidence = when {
            isSkeletonDetected && hipTracked -> 0.98f
            isSkeletonDetected -> (0.72f + (validSignals.coerceAtMost(5) / 5f) * 0.22f).coerceIn(0.72f, 0.95f)
            matteBitmap != null && validSignals > 0 -> (validSignals / 3f * 0.72f + 0.14f).coerceIn(0.25f, 0.86f)
            else -> 0f
        }

        return RawBodyPoseKeypoints(
            shoulderLeftX = detectedLeftSh,
            shoulderLeftY = leftShY,
            shoulderRightX = detectedRightSh,
            shoulderRightY = rightShY,
            leftChestX = detectedLeftChest,
            rightChestX = detectedRightChest,
            chestY = chestY,
            leftWaistX = detectedLeftWaist,
            rightWaistX = detectedRightWaist,
            waistY = waistY,
            poseConfidence = poseConfidence,
            isSkeletonDetected = isSkeletonDetected,
            hipTracked = hipTracked,
            hipLeftX = hipLeftX,
            hipRightX = hipRightX,
            hipY = hipY,
            wristTracked = wristTracked,
            primaryWristX = primaryWristX,
            primaryWristY = primaryWristY,
            primaryElbowX = primaryElbowX,
            primaryElbowY = primaryElbowY,
            wristScore = wristScore,
            leftElbowX = leftElbowX,
            leftElbowY = leftElbowY,
            rightElbowX = rightElbowX,
            rightElbowY = rightElbowY,
            leftWristX = leftWristX,
            leftWristY = leftWristY,
            rightWristX = rightWristX,
            rightWristY = rightWristY
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
        val widthScaleMul = clothingAsset.defaultScale * config.clothWidthScale.coerceIn(0.75f, 1.55f)
        val lengthScaleMul = clothingAsset.defaultScale * config.clothLengthScale.coerceIn(0.75f, 1.40f)
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

            val leftElbNormX = ((torso.leftElbowX - torso.shoulderLeftX) / garmentW).coerceIn(-0.22f, 0.16f)
            val leftWrNormX = ((torso.leftWristX - torso.shoulderLeftX) / garmentW).coerceIn(-0.28f, 0.20f)
            val rightElbNormX = ((torso.rightElbowX - torso.shoulderRightX) / garmentW).coerceIn(-0.16f, 0.22f)
            val rightWrNormX = ((torso.rightWristX - torso.shoulderRightX) / garmentW).coerceIn(-0.20f, 0.28f)
            val armFactor = ((v - seamV) / max(0.15f, 1f - seamV)).coerceIn(0f, 1f)

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

                // Sleeve & arm bending follow tracked elbows & wrists on outer garment sleeve columns
                val sleeveBendShift = if (!isWaist && fitState.skeletonPoseActive && v > seamV) {
                    val leftReach = if (armFactor < 0.55f) {
                        leftElbNormX * (armFactor / 0.55f)
                    } else {
                        val k = (armFactor - 0.55f) / 0.45f
                        leftElbNormX * (1f - k) + leftWrNormX * k
                    }
                    val rightReach = if (armFactor < 0.55f) {
                        rightElbNormX * (armFactor / 0.55f)
                    } else {
                        val k = (armFactor - 0.55f) / 0.45f
                        rightElbNormX * (1f - k) + rightWrNormX * k
                    }
                    when (c) {
                        0 -> leftReach * 0.65f
                        1 -> leftReach * 0.30f
                        cols - 2 -> rightReach * 0.30f
                        cols - 1 -> rightReach * 0.65f
                        else -> 0f
                    }
                } else 0f

                val yawShiftScale = 1f + yawAsym * centeredU * 0.28f
                val scaledV = if (isWaist) v * lengthScaleMul else seamV + (v - seamV) * lengthScaleMul
                val idx = (r * cols + c) * 2
                verts[idx] = (centerShiftX + sleeveBendShift + centeredU * widthRatio * yawShiftScale) * widthScaleMul
                verts[idx + 1] = scaledV + shoulderSlopeAdjust * lengthScaleMul
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
        if (!isWaist && face.trackingConfidence > 0.25f) {
            val chinY = face.bottomY
            val neckHalfW = face.width * 0.24f
            val headOvalPath = Path().apply {
                addOval(
                    RectF(
                        face.centerX - face.width * 0.45f,
                        face.centerY - face.height * 0.56f,
                        face.centerX + face.width * 0.45f,
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
            if (abs(face.rollDeg) > 1.5f) {
                val rollM = Matrix().apply {
                    setRotate(face.rollDeg, face.centerX, face.centerY)
                }
                headOvalPath.transform(rollM)
            }

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

    /**
     * Restores foreground skin on raised hands/forearms and long hair draped over the collarbone
     * back on top of AR clothing and necklaces using ML Kit matte + facial skin/hair color cues.
     */
    private fun restoreHandAndHairForegroundOcclusion(
        canvas: Canvas,
        rawFrame: Bitmap,
        matteBitmap: Bitmap,
        frameW: Int,
        frameH: Int,
        face: StabilizedFacePose,
        pose: RawBodyPoseKeypoints,
        wristTracked: Boolean
    ) {
        if (face.trackingConfidence <= 0.25f || matteBitmap.width < 16 || matteBitmap.height < 16) return
        val mw = matteBitmap.width
        val mh = matteBitmap.height
        val total = mw * mh

        val smallFrame = reusableOcclFrame?.takeIf { !it.isRecycled && it.width == mw && it.height == mh }
            ?: Bitmap.createBitmap(mw, mh, Bitmap.Config.ARGB_8888).also {
                reusableOcclFrame?.recycle()
                reusableOcclFrame = it
            }
        val occlOverlay = reusableOcclOverlay?.takeIf { !it.isRecycled && it.width == mw && it.height == mh }
            ?: Bitmap.createBitmap(mw, mh, Bitmap.Config.ARGB_8888).also {
                it.setHasAlpha(true)
                reusableOcclOverlay?.recycle()
                reusableOcclOverlay = it
            }
        val smallCanvas = Canvas(smallFrame)
        smallCanvas.drawBitmap(rawFrame, null, RectF(0f, 0f, mw.toFloat(), mh.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG))

        if (reusableOcclPixels.size < total) reusableOcclPixels = IntArray(total)
        if (reusableOcclOutPixels.size < total) reusableOcclOutPixels = IntArray(total)
        val framePx = reusableOcclPixels
        val outPx = reusableOcclOutPixels
        smallFrame.getPixels(framePx, 0, mw, 0, 0, mw, mh)
        if (reusableMatteAlphaPixels.size < total) return
        val mattePx = reusableMatteAlphaPixels

        val sx = mw.toFloat() / frameW
        val sy = mh.toFloat() / frameH

        // Sample facial skin tone & upper hair tone for selective person foreground isolation
        val (sr, sg, sb) = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(
            rawFrame,
            face.centerX.toInt().coerceIn(4, frameW - 5),
            (face.centerY + face.height * 0.10f).toInt().coerceIn(4, frameH - 5),
            max(5, (face.width * 0.16f).toInt()),
            max(5, (face.height * 0.12f).toInt())
        )
        val skinLum = 0.299f * sr + 0.587f * sg + 0.114f * sb
        val skinRG = sr - sg
        val skinRB = sr - sb

        val (hr, hg, hb) = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(
            rawFrame,
            (face.centerX - face.width * 0.26f).toInt().coerceIn(4, frameW - 5),
            (face.centerY - face.height * 0.48f).toInt().coerceIn(4, frameH - 5),
            max(4, (face.width * 0.12f).toInt()),
            max(4, (face.height * 0.08f).toInt())
        )
        val hairLum = 0.299f * hr + 0.587f * hg + 0.114f * hb
        val hasDistinctHairColor = abs(hairLum - skinLum) > 22f

        val collarMinX = ((face.centerX - face.width * 0.72f) * sx).toInt().coerceIn(0, mw - 1)
        val collarMaxX = ((face.centerX + face.width * 0.72f) * sx).toInt().coerceIn(collarMinX, mw - 1)
        val collarMinY = ((face.bottomY - face.height * 0.05f) * sy).toInt().coerceIn(0, mh - 1)
        val collarMaxY = ((face.bottomY + face.height * 0.56f) * sy).toInt().coerceIn(collarMinY, mh - 1)

        // Tracked forearm + handTip capsules in matte pixel coordinates
        val lwX = pose.leftWristX * sx
        val lwY = pose.leftWristY * sy
        val leX = pose.leftElbowX * sx
        val leY = pose.leftElbowY * sy
        val lTipX = lwX + (lwX - leX) * 0.34f
        val lTipY = lwY + (lwY - leY) * 0.34f

        val rwX = pose.rightWristX * sx
        val rwY = pose.rightWristY * sy
        val reX = pose.rightElbowX * sx
        val reY = pose.rightElbowY * sy
        val rTipX = rwX + (rwX - reX) * 0.34f
        val rTipY = rwY + (rwY - reY) * 0.34f

        val handRadius = max(5f, face.width * sx * 0.44f)
        val handRadiusSq = handRadius * handRadius
        val checkHands = wristTracked && pose.isSkeletonDetected

        fun distSqToSeg(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
            val dx = bx - ax
            val dy = by - ay
            val lenSq = dx * dx + dy * dy
            if (lenSq < 1f) return (px - ax) * (px - ax) + (py - ay) * (py - ay)
            val t = (((px - ax) * dx + (py - ay) * dy) / lenSq).coerceIn(0f, 1f)
            val projX = ax + t * dx
            val projY = ay + t * dy
            return (px - projX) * (px - projX) + (py - projY) * (py - projY)
        }

        var restoredCount = 0
        for (i in 0 until total) outPx[i] = 0

        for (y in 0 until mh) {
            val rowOff = y * mw
            val inCollarY = y in collarMinY..collarMaxY
            for (x in 0 until mw) {
                val idx = rowOff + x
                val ma = Color.alpha(mattePx[idx])
                if (ma < 120) continue

                val inHandZone = if (checkHands) {
                    val fy = y.toFloat()
                    val fx = x.toFloat()
                    (distSqToSeg(fx, fy, lwX, lwY, lTipX, lTipY) <= handRadiusSq) ||
                        (distSqToSeg(fx, fy, rwX, rwY, rTipX, rTipY) <= handRadiusSq)
                } else false

                val inCollarHairZone = inCollarY && (x in collarMinX..collarMaxX) && hasDistinctHairColor
                if (!inHandZone && !inCollarHairZone) continue

                val c = framePx[idx]
                val r = Color.red(c).toFloat()
                val g = Color.green(c).toFloat()
                val b = Color.blue(c).toFloat()
                val lum = 0.299f * r + 0.587f * g + 0.114f * b

                var keep = false
                if (inHandZone) {
                    val dRG = abs((r - g) - skinRG)
                    val dRB = abs((r - b) - skinRB)
                    if (dRG < 28f && dRB < 34f && abs(lum - skinLum) < 62f) {
                        keep = true
                    }
                }
                if (!keep && inCollarHairZone) {
                    val dSkin = abs(r - sr) + abs(g - sg) + abs(b - sb)
                    val dHair = abs(r - hr) + abs(g - hg) + abs(b - hb)
                    if (dHair < 84f && dHair < dSkin * 0.85f) {
                        keep = true
                    }
                }

                if (keep) {
                    val alpha = min(235, ma)
                    outPx[idx] = Color.argb(alpha, r.toInt(), g.toInt(), b.toInt())
                    restoredCount++
                }
            }
        }

        if (restoredCount > 6) {
            occlOverlay.setPixels(outPx, 0, mw, 0, 0, mw, mh)
            canvas.drawBitmap(
                occlOverlay,
                null,
                RectF(0f, 0f, frameW.toFloat(), frameH.toFloat()),
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            )
        }
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

    private suspend fun detectPoseFast(bitmap: Bitmap): Pose? {
        return suspendCancellableCoroutine { cont ->
            try {
                val input = InputImage.fromBitmap(bitmap, 0)
                livePoseDetector.process(input)
                    .addOnSuccessListener { pose ->
                        if (cont.isActive) cont.resume(pose)
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(null)
                    }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    private fun synthesizeFaceFromPose(pose: Pose, frameW: Int, frameH: Int): FastFaceResult? {
        val nose = pose.getPoseLandmark(PoseLandmark.NOSE)?.takeIf { it.inFrameLikelihood >= 0.45f } ?: return null
        val lEar = pose.getPoseLandmark(PoseLandmark.LEFT_EAR)?.takeIf { it.inFrameLikelihood >= 0.35f }
        val rEar = pose.getPoseLandmark(PoseLandmark.RIGHT_EAR)?.takeIf { it.inFrameLikelihood >= 0.35f }
        val lEyeRaw = pose.getPoseLandmark(PoseLandmark.LEFT_EYE)?.takeIf { it.inFrameLikelihood >= 0.40f }
        val rEyeRaw = pose.getPoseLandmark(PoseLandmark.RIGHT_EYE)?.takeIf { it.inFrameLikelihood >= 0.40f }
        val lMouth = pose.getPoseLandmark(PoseLandmark.LEFT_MOUTH)?.takeIf { it.inFrameLikelihood >= 0.35f }
        val rMouth = pose.getPoseLandmark(PoseLandmark.RIGHT_MOUTH)?.takeIf { it.inFrameLikelihood >= 0.35f }

        val earSpan = if (lEar != null && rEar != null) abs(rEar.position.x - lEar.position.x) else 0f
        val eyeSpan = if (lEyeRaw != null && rEyeRaw != null) abs(rEyeRaw.position.x - lEyeRaw.position.x) else 0f
        val shL = pose.getPoseLandmark(PoseLandmark.LEFT_SHOULDER)?.takeIf { it.inFrameLikelihood >= 0.45f }
        val shR = pose.getPoseLandmark(PoseLandmark.RIGHT_SHOULDER)?.takeIf { it.inFrameLikelihood >= 0.45f }
        val shSpan = if (shL != null && shR != null) abs(shR.position.x - shL.position.x) else 0f

        val fw = max(32f, when {
            earSpan > 16f -> earSpan * 0.92f
            eyeSpan > 12f -> eyeSpan * 2.25f
            shSpan > 24f -> shSpan * 0.40f
            else -> frameW * 0.16f
        })
        val fh = fw * 1.25f
        val eyePair = if (lEyeRaw != null && rEyeRaw != null) {
            if (lEyeRaw.position.x <= rEyeRaw.position.x) lEyeRaw.position to rEyeRaw.position
            else rEyeRaw.position to lEyeRaw.position
        } else null
        val eyeMidX = eyePair?.let { (it.first.x + it.second.x) * 0.5f } ?: nose.position.x
        val eyeMidY = eyePair?.let { (it.first.y + it.second.y) * 0.5f } ?: (nose.position.y - fh * 0.14f)
        val roll = eyePair?.let {
            Math.toDegrees(atan2((it.second.y - it.first.y).toDouble(), max(1f, it.second.x - it.first.x).toDouble())).toFloat()
        } ?: 0f
        val cx = nose.position.x
        val cy = eyeMidY + fh * 0.10f
        val mouthMidY = if (lMouth != null && rMouth != null) (lMouth.position.y + rMouth.position.y) * 0.5f else (nose.position.y + fh * 0.22f)
        val chinY = max(cy + fh * 0.48f, mouthMidY + fh * 0.22f)

        val rawGeom = RawDetectedFaceGeometry(
            boundingBox = RectF(cx - fw * 0.5f, cy - fh * 0.5f, cx + fw * 0.5f, chinY),
            leftEye = eyePair?.first?.let { PointF(it.x, it.y) },
            rightEye = eyePair?.second?.let { PointF(it.x, it.y) },
            noseBase = PointF(nose.position.x, nose.position.y),
            leftCheek = null,
            rightCheek = null,
            mouthLeft = lMouth?.let { PointF(it.position.x, it.position.y) },
            mouthRight = rMouth?.let { PointF(it.position.x, it.position.y) },
            mouthBottom = null,
            yawDeg = 0f,
            pitchDeg = 0f,
            rollDeg = roll
        )
        return FastFaceResult(
            centerX = cx,
            centerY = cy,
            bottomY = chinY,
            width = fw,
            height = fh,
            eyeMidX = eyeMidX,
            eyeMidY = eyeMidY,
            eyeDist = max(12f, eyePair?.let { hypot((it.second.x - it.first.x).toDouble(), (it.second.y - it.first.y).toDouble()).toFloat() } ?: fw * 0.44f),
            rollDeg = roll,
            yawDeg = 0f,
            pitchDeg = 0f,
            rawGeometry = rawGeom
        )
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
