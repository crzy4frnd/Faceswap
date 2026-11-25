package com.facemorph.studio.engine

import android.graphics.Matrix
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Velocity-adaptive One-Euro scalar filter.
 * Suppresses high-frequency hand/sensor jitter when the camera is nearly stationary while
 * raising its cutoff dynamically during fast camera pans to minimize lag.
 */
class OneEuroFilter1D(
    private val minCutoff: Float = 1.35f,
    private val beta: Float = 0.015f,
    private val dCutoff: Float = 1.0f
) {
    private var initialized = false
    private var prevRaw = 0f
    private var prevFiltered = 0f
    private var prevDeriv = 0f

    fun reset() {
        initialized = false
        prevRaw = 0f
        prevFiltered = 0f
        prevDeriv = 0f
    }

    fun filter(raw: Float, dtSec: Float): Float {
        if (!raw.isFinite()) return if (initialized) prevFiltered else 0f
        if (!initialized) {
            initialized = true
            prevRaw = raw
            prevFiltered = raw
            prevDeriv = 0f
            return raw
        }
        val dt = dtSec.coerceIn(1f / 120f, 0.25f)
        val rawDeriv = (raw - prevRaw) / dt
        val aD = alphaFromCutoff(dCutoff, dt)
        val ed = aD * rawDeriv + (1f - aD) * prevDeriv
        val cutoff = minCutoff + beta * abs(ed)
        val a = alphaFromCutoff(cutoff, dt)
        val filtered = a * raw + (1f - a) * prevFiltered
        prevRaw = raw
        prevFiltered = filtered
        prevDeriv = ed
        return filtered
    }

    fun filterAngleDeg(rawDeg: Float, dtSec: Float): Float {
        if (!rawDeg.isFinite()) return if (initialized) prevFiltered else 0f
        if (!initialized) {
            return filter(rawDeg, dtSec)
        }
        // Unwrap shortest angular delta relative to current state
        var delta = (rawDeg - prevRaw) % 360f
        if (delta > 180f) delta -= 360f
        if (delta < -180f) delta += 360f
        return filter(prevRaw + delta, dtSec)
    }

    private fun alphaFromCutoff(cutoff: Float, dt: Float): Float {
        val tau = 1f / (2f * PI.toFloat() * max(0.05f, cutoff))
        return (dt / (dt + tau)).coerceIn(0.01f, 1f)
    }
}

/**
 * 2-state Constant-Velocity Kalman Filter ([position, velocity]) with adaptive innovation gating.
 * Eliminates high-frequency speech/blink bounding-box flicker while predicting trajectory ahead
 * through fast head and handheld camera motion.
 */
class KalmanFilter1D(
    private val processNoisePos: Float,
    private val processNoiseVel: Float,
    private val baseMeasurementNoise: Float,
    private val outlierZThreshold: Float = 2.2f
) {
    private var initialized = false
    private var x = 0f
    private var v = 0f
    private var p00 = 1f
    private var p01 = 0f
    private var p11 = 1f

    fun reset() {
        initialized = false
        x = 0f
        v = 0f
        p00 = 1f
        p01 = 0f
        p11 = 1f
    }

    fun isInitialized(): Boolean = initialized
    fun currentValue(): Float = x

    fun predict(dtSec: Float): Float {
        if (!initialized) return 0f
        val dt = dtSec.coerceIn(1f / 120f, 0.25f)
        val dt2 = dt * dt

        x += v * dt
        v *= (1f - 0.14f * dt).coerceIn(0.84f, 1f)

        val newP00 = p00 + 2f * dt * p01 + dt2 * p11 + processNoisePos * dt
        val newP01 = p01 + dt * p11
        val newP11 = p11 + processNoiseVel * dt

        p00 = newP00
        p01 = newP01
        p11 = newP11
        return x
    }

    fun update(measurement: Float, dtSec: Float, measurementNoiseScale: Float = 1f): Float {
        if (!measurement.isFinite()) return if (initialized) predict(dtSec) else 0f
        if (!initialized) {
            initialized = true
            x = measurement
            v = 0f
            p00 = baseMeasurementNoise
            p01 = 0f
            p11 = processNoiseVel
            return x
        }

        val dt = dtSec.coerceIn(1f / 120f, 0.25f)
        predict(dt)

        val innovation = measurement - x
        var r = max(1e-4f, baseMeasurementNoise * measurementNoiseScale)

        val expectedStd = sqrt(max(1e-4f, p00 + r))
        val zScore = abs(innovation) / expectedStd
        if (zScore > outlierZThreshold) {
            val excess = (zScore - outlierZThreshold).coerceIn(0f, 6f)
            r *= (1f + excess * excess * 1.4f)
        }

        val s = p00 + r
        val k0 = p00 / s
        val k1 = p01 / s

        x += k0 * innovation
        v += k1 * innovation

        val oldP00 = p00
        val oldP01 = p01
        p00 = (1f - k0) * oldP00
        p01 = (1f - k0) * oldP01
        p11 = max(1e-5f, p11 - k1 * oldP01)

        return x
    }

    fun updateAngleDeg(rawDeg: Float, dtSec: Float, measurementNoiseScale: Float = 1f): Float {
        if (!rawDeg.isFinite()) return if (initialized) predict(dtSec) else 0f
        if (!initialized) return update(rawDeg, dtSec, measurementNoiseScale)
        var delta = (rawDeg - x) % 360f
        if (delta > 180f) delta -= 360f
        if (delta < -180f) delta += 360f
        return update(x + delta, dtSec, measurementNoiseScale)
    }
}

data class StabilizedFaceSwapTransform(
    val matrix: Matrix,
    val eyeMidX: Float,
    val eyeMidY: Float,
    val patchWidth: Int,
    val patchHeight: Int,
    val angleDeg: Float
)

data class StabilizedFacePose(
    val centerX: Float,
    val centerY: Float,
    val bottomY: Float,
    val width: Float,
    val height: Float,
    val eyeMidX: Float,
    val eyeMidY: Float,
    val eyeDist: Float,
    val rollDeg: Float,
    val yawDeg: Float = 0f,
    val pitchDeg: Float = 0f,
    val trackingConfidence: Float
)

data class RawBodyPoseKeypoints(
    val shoulderLeftX: Float,
    val shoulderLeftY: Float,
    val shoulderRightX: Float,
    val shoulderRightY: Float,
    val leftChestX: Float,
    val rightChestX: Float,
    val chestY: Float,
    val leftWaistX: Float,
    val rightWaistX: Float,
    val waistY: Float,
    val poseConfidence: Float,
    val isSkeletonDetected: Boolean = false,
    val hipTracked: Boolean = false,
    val hipLeftX: Float = leftWaistX,
    val hipRightX: Float = rightWaistX,
    val hipY: Float = waistY,
    val wristTracked: Boolean = false,
    val primaryWristX: Float = leftWaistX,
    val primaryWristY: Float = waistY,
    val primaryElbowX: Float = shoulderLeftX,
    val primaryElbowY: Float = chestY,
    val wristScore: Float = 0f,
    val leftElbowX: Float = shoulderLeftX,
    val leftElbowY: Float = chestY,
    val rightElbowX: Float = shoulderRightX,
    val rightElbowY: Float = chestY,
    val leftWristX: Float = leftWaistX,
    val leftWristY: Float = waistY,
    val rightWristX: Float = rightWaistX,
    val rightWristY: Float = waistY
)

data class StabilizedBodyFitState(
    val face: StabilizedFacePose,
    val pose: RawBodyPoseKeypoints,
    val bodyFitMatrix: Matrix,
    val collarPivotX: Float,
    val collarPivotY: Float,
    val fittedShoulderWidth: Float,
    val fittedGarmentHeight: Float,
    val fittedChestRatio: Float,
    val fittedWaistRatio: Float,
    val chestOffsetRatioX: Float,
    val waistOffsetRatioX: Float,
    val effectiveTiltDeg: Float,
    val poseBlendAlpha: Float,
    val shoulderSeamV: Float,
    val shoulderSlopeDiffY: Float,
    val shoulderCm: Int = 44,
    val chestCm: Int = 96,
    val waistCm: Int = 79,
    val torsoCm: Int = 52,
    val estimatedSize: String = "M",
    val skeletonPoseActive: Boolean = false,
    val hipTracked: Boolean = false,
    val wristTracked: Boolean = false,
    val torsoLengthRatio: Float = 1.0f
)

/**
 * Temporal smoother & affine transformation matrix interpolator between ML Kit face tracking
 * and body pose silhouette keypoints. Eliminates frame-to-frame micro-jitter and single-frame
 * detection dropouts during handheld camera motion.
 */
class BodyPoseMatrixSmoother {

    private data class DecomposedAffine(
        val tx: Float,
        val ty: Float,
        val scaleX: Float,
        val scaleY: Float,
        val rotDeg: Float,
        val skewX: Float
    )

    private var lastTimeSec = -1f
    private var lastFrameW = -1
    private var lastFrameH = -1
    private var lastFrontCamera = true
    private var missedFaceFrames = 0
    private var lastValidFace: StabilizedFacePose? = null

    // Primary Face Tracking Constant-Velocity Kalman Filter bank
    private val kfCx = KalmanFilter1D(processNoisePos = 18f, processNoiseVel = 620f, baseMeasurementNoise = 3.2f, outlierZThreshold = 3.6f)
    private val kfCy = KalmanFilter1D(processNoisePos = 18f, processNoiseVel = 620f, baseMeasurementNoise = 3.2f, outlierZThreshold = 3.6f)
    private val kfBottomY = KalmanFilter1D(processNoisePos = 10f, processNoiseVel = 320f, baseMeasurementNoise = 7.5f, outlierZThreshold = 1.75f)
    private val kfW = KalmanFilter1D(processNoisePos = 8f, processNoiseVel = 240f, baseMeasurementNoise = 5.5f, outlierZThreshold = 1.85f)
    private val kfH = KalmanFilter1D(processNoisePos = 8f, processNoiseVel = 240f, baseMeasurementNoise = 8.5f, outlierZThreshold = 1.65f)
    private val kfEyeX = KalmanFilter1D(processNoisePos = 22f, processNoiseVel = 740f, baseMeasurementNoise = 2.6f, outlierZThreshold = 3.8f)
    private val kfEyeY = KalmanFilter1D(processNoisePos = 22f, processNoiseVel = 740f, baseMeasurementNoise = 2.6f, outlierZThreshold = 3.8f)
    private val kfEyeDist = KalmanFilter1D(processNoisePos = 6f, processNoiseVel = 180f, baseMeasurementNoise = 5.2f, outlierZThreshold = 1.75f)
    private val kfRoll = KalmanFilter1D(processNoisePos = 9f, processNoiseVel = 280f, baseMeasurementNoise = 3.8f, outlierZThreshold = 2.1f)
    private val kfYaw = KalmanFilter1D(processNoisePos = 10f, processNoiseVel = 310f, baseMeasurementNoise = 4.2f, outlierZThreshold = 2.2f)
    private val kfPitch = KalmanFilter1D(processNoisePos = 10f, processNoiseVel = 310f, baseMeasurementNoise = 4.2f, outlierZThreshold = 2.2f)

    // Face-Swap Transformation Matrix component Kalman filters (anti-flicker during speech & whip-pans)
    private val swapKfX = KalmanFilter1D(processNoisePos = 20f, processNoiseVel = 680f, baseMeasurementNoise = 2.2f, outlierZThreshold = 3.5f)
    private val swapKfY = KalmanFilter1D(processNoisePos = 20f, processNoiseVel = 680f, baseMeasurementNoise = 2.2f, outlierZThreshold = 3.5f)
    private val swapKfPatchW = KalmanFilter1D(processNoisePos = 5f, processNoiseVel = 140f, baseMeasurementNoise = 6.0f, outlierZThreshold = 1.6f)
    private val swapKfPatchH = KalmanFilter1D(processNoisePos = 5f, processNoiseVel = 140f, baseMeasurementNoise = 7.8f, outlierZThreshold = 1.5f)
    private val swapKfAngle = KalmanFilter1D(processNoisePos = 8f, processNoiseVel = 240f, baseMeasurementNoise = 3.4f, outlierZThreshold = 1.9f)

    // Face anchor One-Euro fine polish
    private val fCx = OneEuroFilter1D(minCutoff = 1.75f, beta = 0.020f)
    private val fCy = OneEuroFilter1D(minCutoff = 1.75f, beta = 0.020f)
    private val fChinY = OneEuroFilter1D(minCutoff = 1.55f, beta = 0.016f)
    private val fW = OneEuroFilter1D(minCutoff = 1.35f, beta = 0.014f)
    private val fH = OneEuroFilter1D(minCutoff = 1.35f, beta = 0.014f)
    private val fEyeX = OneEuroFilter1D(minCutoff = 2.10f, beta = 0.024f)
    private val fEyeY = OneEuroFilter1D(minCutoff = 2.10f, beta = 0.024f)
    private val fEyeDist = OneEuroFilter1D(minCutoff = 1.45f, beta = 0.014f)
    private val fRoll = OneEuroFilter1D(minCutoff = 1.55f, beta = 0.016f)
    private val fYaw = OneEuroFilter1D(minCutoff = 1.60f, beta = 0.018f)
    private val fPitch = OneEuroFilter1D(minCutoff = 1.60f, beta = 0.018f)

    // Body pose keypoint One-Euro filters
    private val pShLX = OneEuroFilter1D(minCutoff = 1.15f, beta = 0.014f)
    private val pShLY = OneEuroFilter1D(minCutoff = 1.15f, beta = 0.014f)
    private val pShRX = OneEuroFilter1D(minCutoff = 1.15f, beta = 0.014f)
    private val pShRY = OneEuroFilter1D(minCutoff = 1.15f, beta = 0.014f)
    private val pChLX = OneEuroFilter1D(minCutoff = 1.10f, beta = 0.012f)
    private val pChRX = OneEuroFilter1D(minCutoff = 1.10f, beta = 0.012f)
    private val pChY = OneEuroFilter1D(minCutoff = 1.10f, beta = 0.012f)
    private val pWaLX = OneEuroFilter1D(minCutoff = 1.05f, beta = 0.010f)
    private val pWaRX = OneEuroFilter1D(minCutoff = 1.05f, beta = 0.010f)
    private val pWaY = OneEuroFilter1D(minCutoff = 1.05f, beta = 0.010f)
    private val pHipLX = OneEuroFilter1D(minCutoff = 1.05f, beta = 0.011f)
    private val pHipRX = OneEuroFilter1D(minCutoff = 1.05f, beta = 0.011f)
    private val pHipY = OneEuroFilter1D(minCutoff = 1.05f, beta = 0.011f)
    private val pPrWrX = OneEuroFilter1D(minCutoff = 1.45f, beta = 0.018f)
    private val pPrWrY = OneEuroFilter1D(minCutoff = 1.45f, beta = 0.018f)
    private val pPrElbX = OneEuroFilter1D(minCutoff = 1.25f, beta = 0.015f)
    private val pPrElbY = OneEuroFilter1D(minCutoff = 1.25f, beta = 0.015f)
    private val pElbLX = OneEuroFilter1D(minCutoff = 1.25f, beta = 0.015f)
    private val pElbLY = OneEuroFilter1D(minCutoff = 1.25f, beta = 0.015f)
    private val pElbRX = OneEuroFilter1D(minCutoff = 1.25f, beta = 0.015f)
    private val pElbRY = OneEuroFilter1D(minCutoff = 1.25f, beta = 0.015f)
    private val pWrLX = OneEuroFilter1D(minCutoff = 1.45f, beta = 0.018f)
    private val pWrLY = OneEuroFilter1D(minCutoff = 1.45f, beta = 0.018f)
    private val pWrRX = OneEuroFilter1D(minCutoff = 1.45f, beta = 0.018f)
    private val pWrRY = OneEuroFilter1D(minCutoff = 1.45f, beta = 0.018f)
    private val pConfFilter = OneEuroFilter1D(minCutoff = 0.90f, beta = 0.005f)

    // Physical body measurement One-Euro filters (in centimeters)
    private val mShoulderCm = OneEuroFilter1D(minCutoff = 0.65f, beta = 0.003f)
    private val mChestCm = OneEuroFilter1D(minCutoff = 0.65f, beta = 0.003f)
    private val mWaistCm = OneEuroFilter1D(minCutoff = 0.65f, beta = 0.003f)
    private val mTorsoCm = OneEuroFilter1D(minCutoff = 0.65f, beta = 0.003f)

    // Interpolated Transformation Matrix (Face <-> Body Pose) filters
    private val mTx = OneEuroFilter1D(minCutoff = 1.30f, beta = 0.016f)
    private val mTy = OneEuroFilter1D(minCutoff = 1.30f, beta = 0.016f)
    private val mSx = OneEuroFilter1D(minCutoff = 1.10f, beta = 0.012f)
    private val mSy = OneEuroFilter1D(minCutoff = 1.10f, beta = 0.012f)
    private val mRot = OneEuroFilter1D(minCutoff = 1.25f, beta = 0.014f)
    private val mSkew = OneEuroFilter1D(minCutoff = 1.00f, beta = 0.008f)

    fun resetFaceSwapKalman() {
        listOf(swapKfX, swapKfY, swapKfPatchW, swapKfPatchH, swapKfAngle).forEach { it.reset() }
    }

    fun resetFilters() {
        missedFaceFrames = 0
        lastValidFace = null
        listOf(
            kfCx, kfCy, kfBottomY, kfW, kfH, kfEyeX, kfEyeY, kfEyeDist, kfRoll, kfYaw, kfPitch,
            swapKfX, swapKfY, swapKfPatchW, swapKfPatchH, swapKfAngle
        ).forEach { it.reset() }
        listOf(
            fCx, fCy, fChinY, fW, fH, fEyeX, fEyeY, fEyeDist, fRoll, fYaw, fPitch,
            pShLX, pShLY, pShRX, pShRY, pChLX, pChRX, pChY, pWaLX, pWaRX, pWaY,
            pHipLX, pHipRX, pHipY, pPrWrX, pPrWrY, pPrElbX, pPrElbY,
            pElbLX, pElbLY, pElbRX, pElbRY, pWrLX, pWrLY, pWrRX, pWrRY, pConfFilter,
            mShoulderCm, mChestCm, mWaistCm, mTorsoCm,
            mTx, mTy, mSx, mSy, mRot, mSkew
        ).forEach { it.reset() }
    }

    fun reset() {
        lastTimeSec = -1f
        resetFilters()
    }

    fun checkContextAndGetDt(frameW: Int, frameH: Int, useFrontCamera: Boolean, timeSec: Float): Float {
        if (frameW != lastFrameW || frameH != lastFrameH || useFrontCamera != lastFrontCamera ||
            (lastTimeSec >= 0f && timeSec < lastTimeSec - 0.1f)
        ) {
            reset()
        }
        lastFrameW = frameW
        lastFrameH = frameH
        lastFrontCamera = useFrontCamera

        val dt = if (lastTimeSec >= 0f) {
            (timeSec - lastTimeSec).coerceIn(1f / 120f, 0.25f)
        } else {
            1f / 30f
        }
        lastTimeSec = timeSec
        return dt
    }

    fun stabilizeFace(
        rawCenterX: Float?,
        rawCenterY: Float?,
        rawBottomY: Float?,
        rawWidth: Float?,
        rawHeight: Float?,
        rawEyeMidX: Float?,
        rawEyeMidY: Float?,
        rawEyeDist: Float?,
        rawRollDeg: Float?,
        rawYawDeg: Float? = null,
        rawPitchDeg: Float? = null,
        frameW: Int,
        frameH: Int,
        dtSec: Float
    ): StabilizedFacePose {
        val detected = rawCenterX != null && rawCenterY != null && rawWidth != null && rawHeight != null

        val previousValidFace = lastValidFace
        val rawFace: StabilizedFacePose = if (detected) {
            missedFaceFrames = 0
            val fw = rawWidth!!
            val fh = rawHeight!!
            StabilizedFacePose(
                centerX = rawCenterX!!,
                centerY = rawCenterY!!,
                bottomY = rawBottomY ?: (rawCenterY + fh * 0.48f),
                width = fw,
                height = fh,
                eyeMidX = rawEyeMidX ?: rawCenterX,
                eyeMidY = rawEyeMidY ?: (rawCenterY - fh * 0.10f),
                eyeDist = rawEyeDist ?: (fw * 0.44f),
                rollDeg = rawRollDeg ?: 0f,
                yawDeg = (rawYawDeg ?: 0f).coerceIn(-65f, 65f),
                pitchDeg = (rawPitchDeg ?: 0f).coerceIn(-55f, 55f),
                trackingConfidence = 1.0f
            ).also { lastValidFace = it }
        } else {
            missedFaceFrames++
            val held = previousValidFace
            if (held != null && missedFaceFrames <= 10) {
                // Coast gracefully on recent face pose during brief motion blur / 1-frame misses
                held.copy(trackingConfidence = (1f - missedFaceFrames * 0.08f).coerceIn(0.2f, 1f))
            } else {
                val fallbackW = frameW * 0.32f
                val fallbackH = fallbackW * 1.25f
                val fallbackCx = frameW * 0.5f
                val fallbackCy = frameH * 0.36f
                StabilizedFacePose(
                    centerX = fallbackCx,
                    centerY = fallbackCy,
                    bottomY = fallbackCy + fallbackH * 0.48f,
                    width = fallbackW,
                    height = fallbackH,
                    eyeMidX = fallbackCx,
                    eyeMidY = fallbackCy - fallbackH * 0.10f,
                    eyeDist = fallbackW * 0.44f,
                    rollDeg = 0f,
                    yawDeg = 0f,
                    pitchDeg = 0f,
                    trackingConfidence = 0.15f
                )
            }
        }

        // Guard against large multi-person jumps (>42% frame diagonal)
        val diag = hypot(frameW.toDouble(), frameH.toDouble()).toFloat()
        if (detected && previousValidFace != null) {
            val jump = hypot(
                (rawFace.centerX - previousValidFace.centerX).toDouble(),
                (rawFace.centerY - previousValidFace.centerY).toDouble()
            ).toFloat()
            if (jump > diag * 0.42f) {
                resetFilters()
                lastValidFace = rawFace
            }
        }

        // Stage 1: Constant-Velocity Kalman Filtering on raw ML Kit face tracking inputs
        // Speech/jaw bounce inflates measurement noise on bottomY/height without lagging fast translation
        val kCx: Float
        val kCy: Float
        val kBottomY: Float
        val kW: Float
        val kH: Float
        val kEyeX: Float
        val kEyeY: Float
        val kEyeDist: Float
        val kRoll: Float
        val kYaw: Float
        val kPitch: Float

        if (!detected && missedFaceFrames <= 10 && kfCx.isInitialized()) {
            // Velocity-predicted Kalman coasting when fast motion causes a transient detection drop
            kCx = kfCx.predict(dtSec)
            kCy = kfCy.predict(dtSec)
            kBottomY = kfBottomY.predict(dtSec)
            kW = max(24f, kfW.predict(dtSec))
            kH = max(28f, kfH.predict(dtSec))
            kEyeX = kfEyeX.predict(dtSec)
            kEyeY = kfEyeY.predict(dtSec)
            kEyeDist = max(12f, kfEyeDist.predict(dtSec))
            kRoll = kfRoll.predict(dtSec)
            kYaw = kfYaw.predict(dtSec).coerceIn(-65f, 65f)
            kPitch = kfPitch.predict(dtSec).coerceIn(-55f, 55f)
        } else {
            val prevEyeD = if (kfEyeDist.isInitialized()) max(1f, kfEyeDist.currentValue()) else rawFace.eyeDist
            val prevH = if (kfH.isInitialized()) max(1f, kfH.currentValue()) else rawFace.height
            val eyeScaleDelta = abs(rawFace.eyeDist - prevEyeD) / max(1f, prevEyeD)
            val boxHeightDelta = abs(rawFace.height - prevH) / max(1f, prevH)
            // When jaw height jumps sharply while upper-face eye distance stays steady, subject is speaking/blinking
            val speechNoiseScale = if (boxHeightDelta > 0.035f && eyeScaleDelta < 0.025f) 2.8f else 1.0f

            kCx = kfCx.update(rawFace.centerX, dtSec)
            kCy = kfCy.update(rawFace.centerY, dtSec)
            kBottomY = kfBottomY.update(rawFace.bottomY, dtSec, speechNoiseScale)
            kW = max(24f, kfW.update(rawFace.width, dtSec))
            kH = max(28f, kfH.update(rawFace.height, dtSec, speechNoiseScale))
            kEyeX = kfEyeX.update(rawFace.eyeMidX, dtSec)
            kEyeY = kfEyeY.update(rawFace.eyeMidY, dtSec)
            kEyeDist = max(12f, kfEyeDist.update(rawFace.eyeDist, dtSec))
            kRoll = kfRoll.updateAngleDeg(rawFace.rollDeg, dtSec)
            kYaw = kfYaw.updateAngleDeg(rawFace.yawDeg, dtSec).coerceIn(-65f, 65f)
            kPitch = kfPitch.updateAngleDeg(rawFace.pitchDeg, dtSec).coerceIn(-55f, 55f)
        }

        // Stage 2: One-Euro micro-tremor polish on Kalman-stabilized face state
        return StabilizedFacePose(
            centerX = fCx.filter(kCx, dtSec),
            centerY = fCy.filter(kCy, dtSec),
            bottomY = fChinY.filter(kBottomY, dtSec),
            width = fW.filter(kW, dtSec),
            height = fH.filter(kH, dtSec),
            eyeMidX = fEyeX.filter(kEyeX, dtSec),
            eyeMidY = fEyeY.filter(kEyeY, dtSec),
            eyeDist = fEyeDist.filter(kEyeDist, dtSec),
            rollDeg = fRoll.filterAngleDeg(kRoll, dtSec),
            yawDeg = fYaw.filterAngleDeg(kYaw, dtSec).coerceIn(-65f, 65f),
            pitchDeg = fPitch.filterAngleDeg(kPitch, dtSec).coerceIn(-55f, 55f),
            trackingConfidence = rawFace.trackingConfidence
        )
    }

    /**
     * Produces a Kalman-filtered Face-Swap affine transformation Matrix that prevents talking/blinking
     * box-size flicker and micro-roll jitter while tracking rapid camera/head movement cleanly.
     */
    fun buildStabilizedFaceSwapTransform(
        stabilizedFace: StabilizedFacePose,
        eyeDistRatio: Float,
        eyeMidXRatio: Float,
        eyeMidYRatio: Float,
        sourceRollDeg: Float,
        dtSec: Float
    ): StabilizedFaceSwapTransform {
        val rawPatchW = max(20f, stabilizedFace.eyeDist / max(0.25f, eyeDistRatio))
        val rawPatchH = max(24f, stabilizedFace.height * 0.86f)
        val rawAngleDeg = stabilizedFace.rollDeg - sourceRollDeg

        // Guard speech/jaw box-height flicker explicitly at the matrix level
        val prevSwapW = if (swapKfPatchW.isInitialized()) max(1f, swapKfPatchW.currentValue()) else rawPatchW
        val prevSwapH = if (swapKfPatchH.isInitialized()) max(1f, swapKfPatchH.currentValue()) else rawPatchH
        val wRatioDelta = abs(rawPatchW - prevSwapW) / prevSwapW
        val hRatioDelta = abs(rawPatchH - prevSwapH) / prevSwapH
        val jawFlickerNoiseScale = if (hRatioDelta > 0.03f && wRatioDelta < 0.02f) 3.0f else 1.0f

        val stabX = swapKfX.update(stabilizedFace.eyeMidX, dtSec)
        val stabY = swapKfY.update(stabilizedFace.eyeMidY, dtSec)
        val stabW = max(20, swapKfPatchW.update(rawPatchW, dtSec).toInt())
        val stabH = max(24, swapKfPatchH.update(rawPatchH, dtSec, jawFlickerNoiseScale).toInt())
        val stabAngle = swapKfAngle.updateAngleDeg(rawAngleDeg, dtSec)

        val swapMatrix = Matrix().apply {
            setTranslate(-stabW * eyeMidXRatio, -stabH * eyeMidYRatio)
            postRotate(stabAngle)
            postTranslate(stabX, stabY)
        }

        return StabilizedFaceSwapTransform(
            matrix = swapMatrix,
            eyeMidX = stabX,
            eyeMidY = stabY,
            patchWidth = stabW,
            patchHeight = stabH,
            angleDeg = stabAngle
        )
    }

    fun updateAndInterpolateBodyTransform(
        stabilizedFace: StabilizedFacePose,
        rawPose: RawBodyPoseKeypoints,
        garmentAspectRatio: Float,
        garmentShoulderSeamV: Float = 0.14f,
        garmentShoulderWidthRatio: Float = 0.80f,
        isWaistGarment: Boolean,
        dtSec: Float
    ): StabilizedBodyFitState {
        // 1. Filter raw body pose keypoints temporally with One-Euro velocity adaptation
        val smoothPose = RawBodyPoseKeypoints(
            shoulderLeftX = pShLX.filter(rawPose.shoulderLeftX, dtSec),
            shoulderLeftY = pShLY.filter(rawPose.shoulderLeftY, dtSec),
            shoulderRightX = pShRX.filter(rawPose.shoulderRightX, dtSec),
            shoulderRightY = pShRY.filter(rawPose.shoulderRightY, dtSec),
            leftChestX = pChLX.filter(rawPose.leftChestX, dtSec),
            rightChestX = pChRX.filter(rawPose.rightChestX, dtSec),
            chestY = pChY.filter(rawPose.chestY, dtSec),
            leftWaistX = pWaLX.filter(rawPose.leftWaistX, dtSec),
            rightWaistX = pWaRX.filter(rawPose.rightWaistX, dtSec),
            waistY = pWaY.filter(rawPose.waistY, dtSec),
            poseConfidence = pConfFilter.filter(rawPose.poseConfidence, dtSec).coerceIn(0f, 1f),
            isSkeletonDetected = rawPose.isSkeletonDetected,
            hipTracked = rawPose.hipTracked,
            hipLeftX = pHipLX.filter(rawPose.hipLeftX, dtSec),
            hipRightX = pHipRX.filter(rawPose.hipRightX, dtSec),
            hipY = pHipY.filter(rawPose.hipY, dtSec),
            wristTracked = rawPose.wristTracked,
            primaryWristX = pPrWrX.filter(rawPose.primaryWristX, dtSec),
            primaryWristY = pPrWrY.filter(rawPose.primaryWristY, dtSec),
            primaryElbowX = pPrElbX.filter(rawPose.primaryElbowX, dtSec),
            primaryElbowY = pPrElbY.filter(rawPose.primaryElbowY, dtSec),
            wristScore = rawPose.wristScore,
            leftElbowX = pElbLX.filter(rawPose.leftElbowX, dtSec),
            leftElbowY = pElbLY.filter(rawPose.leftElbowY, dtSec),
            rightElbowX = pElbRX.filter(rawPose.rightElbowX, dtSec),
            rightElbowY = pElbRY.filter(rawPose.rightElbowY, dtSec),
            leftWristX = pWrLX.filter(rawPose.leftWristX, dtSec),
            leftWristY = pWrLY.filter(rawPose.leftWristY, dtSec),
            rightWristX = pWrRX.filter(rawPose.rightWristX, dtSec),
            rightWristY = pWrRY.filter(rawPose.rightWristY, dtSec)
        )

        val faceW = max(24f, stabilizedFace.width)
        val faceH = max(28f, stabilizedFace.height)
        val aspect = garmentAspectRatio.coerceIn(0.25f, 3.0f)
        val seamV = if (isWaistGarment) 0.04f else garmentShoulderSeamV.coerceIn(0.03f, 0.28f)
        val sleeveScaleInv = if (isWaistGarment) 1.0f else (1f / garmentShoulderWidthRatio.coerceIn(0.78f, 0.98f))

        // 2. Build Matrix A: Face-Tracking-Driven Garment Transformation Matrix (M_face)
        // Pin garment shoulder seam (seamV) onto anatomical collarbone level (~chinY + 0.16*faceH)
        val faceShoulderSpan = faceW * 2.75f
        val faceSpanW = if (isWaistGarment) {
            faceW * 2.45f
        } else {
            faceShoulderSpan * sleeveScaleInv
        }
        val faceGarmentH = faceSpanW * aspect
        val faceShoulderY = stabilizedFace.bottomY + faceH * 0.16f
        val faceTopY = if (isWaistGarment) {
            stabilizedFace.bottomY + faceH * 1.15f
        } else {
            faceShoulderY - faceGarmentH * seamV
        }
        val faceMatrix = Matrix().apply {
            setScale(faceSpanW, faceGarmentH)
            postRotate(stabilizedFace.rollDeg * 0.42f)
            postTranslate(stabilizedFace.centerX, faceTopY)
        }

        // 3. Build Matrix B: Body-Pose-Keypoint-Driven Garment Transformation Matrix (M_pose)
        val shMidX = (smoothPose.shoulderLeftX + smoothPose.shoulderRightX) * 0.5f
        val shMidY = (smoothPose.shoulderLeftY + smoothPose.shoulderRightY) * 0.5f
        val shDx = smoothPose.shoulderRightX - smoothPose.shoulderLeftX
        val shDy = smoothPose.shoulderRightY - smoothPose.shoulderLeftY
        val rawHypotSpan = hypot(shDx.toDouble(), shDy.toDouble()).toFloat()
        // Allow true skeletal shoulder span down to narrow builds / sideways yaw turns (1.62x faceW) when pose is locked!
        val minShoulderSpan = if (rawPose.isSkeletonDetected) faceW * 1.62f else faceW * 2.35f
        val shoulderSpan = max(minShoulderSpan, rawHypotSpan).coerceAtMost(faceW * 4.5f)
        val rawPoseTiltDeg = Math.toDegrees(atan2(shDy.toDouble(), max(1f, shDx).toDouble())).toFloat().coerceIn(-24f, 24f)

        val chestMidX = (smoothPose.leftChestX + smoothPose.rightChestX) * 0.5f
        val chestSpan = max(shoulderSpan * 0.76f, smoothPose.rightChestX - smoothPose.leftChestX)
        val waistMidX = (smoothPose.leftWaistX + smoothPose.rightWaistX) * 0.5f
        val waistSpan = max(shoulderSpan * 0.66f, smoothPose.rightWaistX - smoothPose.leftWaistX)

        val poseSpanW = if (isWaistGarment) {
            waistSpan * 1.20f
        } else {
            max(shoulderSpan * sleeveScaleInv * 0.96f, chestSpan * 1.02f)
        }
        val basePoseH = poseSpanW * aspect
        val measuredTorsoPx = max(faceH * 1.15f, (if (rawPose.hipTracked) smoothPose.hipY else smoothPose.waistY) - shMidY)
        val expectedTorsoPx = max(24f, basePoseH * (0.76f - seamV))
        val torsoStretchRatio = if (rawPose.hipTracked) {
            (measuredTorsoPx / expectedTorsoPx).coerceIn(0.78f, 1.32f)
        } else {
            1.0f
        }
        val poseHeight = if (isWaistGarment) basePoseH else basePoseH * (0.35f + 0.65f * torsoStretchRatio)

        val poseTopY = if (isWaistGarment) {
            (if (rawPose.hipTracked) smoothPose.hipY else smoothPose.waistY) - poseHeight * 0.10f
        } else {
            // Rest garment shoulder seam directly onto tracked shoulder ridge
            shMidY - poseHeight * seamV - faceH * 0.025f
        }
        val poseAnchorX = if (isWaistGarment) {
            waistMidX
        } else if (rawPose.isSkeletonDetected) {
            shMidX * 0.78f + stabilizedFace.centerX * 0.22f
        } else {
            shMidX * 0.62f + stabilizedFace.centerX * 0.38f
        }
        val torsoSkew = (((chestMidX - shMidX) / max(30f, poseHeight)) * 0.65f).coerceIn(-0.16f, 0.16f)
        val poseRotDeg = if (rawPose.isSkeletonDetected) {
            (rawPoseTiltDeg * 0.78f + stabilizedFace.rollDeg * 0.22f).coerceIn(-24f, 24f)
        } else {
            (rawPoseTiltDeg * 0.65f + stabilizedFace.rollDeg * 0.35f).coerceIn(-24f, 24f)
        }

        val poseMatrix = Matrix().apply {
            setScale(poseSpanW, poseHeight)
            postSkew(torsoSkew, 0f)
            postRotate(poseRotDeg)
            postTranslate(poseAnchorX, poseTopY)
        }

        // 4. Interpolate Transformation Matrices (M_face <-> M_pose) weighted by live pose confidence
        val faceDec = decomposeAffine(faceMatrix)
        val poseDec = decomposeAffine(poseMatrix)
        val blendAlpha = if (rawPose.isSkeletonDetected) {
            (0.35f + 0.65f * smoothPose.poseConfidence).coerceIn(0f, 1f)
        } else {
            (0.18f + 0.82f * smoothPose.poseConfidence).coerceIn(0f, 1f)
        }

        val interpTx = faceDec.tx + (poseDec.tx - faceDec.tx) * blendAlpha
        val interpTy = faceDec.ty + (poseDec.ty - faceDec.ty) * blendAlpha
        val interpSx = faceDec.scaleX + (poseDec.scaleX - faceDec.scaleX) * blendAlpha
        val interpSy = faceDec.scaleY + (poseDec.scaleY - faceDec.scaleY) * blendAlpha
        val interpRot = lerpAngleDeg(faceDec.rotDeg, poseDec.rotDeg, blendAlpha)
        val interpSkew = faceDec.skewX + (poseDec.skewX - faceDec.skewX) * blendAlpha

        // 5. Apply temporal One-Euro smoothing directly on the interpolated transformation matrix
        val finalTx = mTx.filter(interpTx, dtSec)
        val finalTy = mTy.filter(interpTy, dtSec)
        val finalSx = max(24f, mSx.filter(interpSx, dtSec))
        val finalSy = max(24f, mSy.filter(interpSy, dtSec))
        val finalRot = mRot.filterAngleDeg(interpRot, dtSec)
        val finalSkew = mSkew.filter(interpSkew, dtSec)

        val smoothedMatrix = Matrix().apply {
            setScale(finalSx, finalSy)
            postSkew(finalSkew, 0f)
            postRotate(finalRot)
            postTranslate(finalTx, finalTy)
        }

        // Contour chest & waist ratios to real tracked body proportions
        val chestRatio = (chestSpan * 1.04f / max(1f, finalSx)).coerceIn(0.76f, 1.32f)
        val waistRatio = (waistSpan * 1.03f / max(1f, finalSx)).coerceIn(0.70f, 1.28f)
        val chestShiftRatio = ((chestMidX - finalTx) / max(1f, finalSx)).coerceIn(-0.14f, 0.14f)
        val waistShiftRatio = ((waistMidX - finalTx) / max(1f, finalSx)).coerceIn(-0.18f, 0.18f)

        // 6. Compute Real-Time Anatomical Body Measurements (cm + apparel size)
        val pxPerCmFace = faceW / 15.0f
        val pxPerCmEye = max(8f, stabilizedFace.eyeDist) / 6.3f
        val pxPerCm = (pxPerCmFace * 0.55f + pxPerCmEye * 0.45f).coerceAtLeast(1.2f)

        val rawShoulderCm = (shoulderSpan / pxPerCm).coerceIn(32f, 60f)
        val rawChestCm = ((chestSpan / pxPerCm) * 2.26f).coerceIn(72f, 136f)
        val rawWaistCm = ((waistSpan / pxPerCm) * 2.16f).coerceIn(58f, 126f)
        val rawTorsoCm = (measuredTorsoPx / pxPerCm).coerceIn(38f, 70f)

        val smoothShoulderCm = mShoulderCm.filter(rawShoulderCm, dtSec).roundToInt()
        val smoothChestCm = mChestCm.filter(rawChestCm, dtSec).roundToInt()
        val smoothWaistCm = mWaistCm.filter(rawWaistCm, dtSec).roundToInt()
        val smoothTorsoCm = mTorsoCm.filter(rawTorsoCm, dtSec).roundToInt()
        val estSize = when {
            smoothChestCm < 86 -> "XS"
            smoothChestCm < 94 -> "S"
            smoothChestCm < 102 -> "M"
            smoothChestCm < 110 -> "L"
            smoothChestCm < 118 -> "XL"
            else -> "XXL"
        }

        return StabilizedBodyFitState(
            face = stabilizedFace,
            pose = smoothPose,
            bodyFitMatrix = smoothedMatrix,
            collarPivotX = finalTx,
            collarPivotY = finalTy,
            fittedShoulderWidth = finalSx,
            fittedGarmentHeight = finalSy,
            fittedChestRatio = chestRatio,
            fittedWaistRatio = waistRatio,
            chestOffsetRatioX = chestShiftRatio,
            waistOffsetRatioX = waistShiftRatio,
            effectiveTiltDeg = finalRot,
            poseBlendAlpha = blendAlpha,
            shoulderSeamV = seamV,
            shoulderSlopeDiffY = (smoothPose.shoulderRightY - smoothPose.shoulderLeftY).coerceIn(-faceH * 0.25f, faceH * 0.25f),
            shoulderCm = smoothShoulderCm,
            chestCm = smoothChestCm,
            waistCm = smoothWaistCm,
            torsoCm = smoothTorsoCm,
            estimatedSize = estSize,
            skeletonPoseActive = rawPose.isSkeletonDetected,
            hipTracked = rawPose.hipTracked,
            wristTracked = rawPose.wristTracked,
            torsoLengthRatio = torsoStretchRatio
        )
    }

    private fun decomposeAffine(matrix: Matrix): DecomposedAffine {
        val v = FloatArray(9)
        matrix.getValues(v)
        val m00 = v[Matrix.MSCALE_X]
        val m01 = v[Matrix.MSKEW_X]
        val m02 = v[Matrix.MTRANS_X]
        val m10 = v[Matrix.MSKEW_Y]
        val m11 = v[Matrix.MSCALE_Y]
        val m12 = v[Matrix.MTRANS_Y]

        val sx = max(1e-4f, hypot(m00.toDouble(), m10.toDouble()).toFloat())
        val rotRad = atan2(m10.toDouble(), m00.toDouble()).toFloat()
        val rotDeg = Math.toDegrees(rotRad.toDouble()).toFloat()
        val ux = m00 / sx
        val uy = m10 / sx
        val sy = max(1e-4f, -uy * m01 + ux * m11)
        val skewX = (ux * m01 + uy * m11) / sy

        return DecomposedAffine(
            tx = m02,
            ty = m12,
            scaleX = sx,
            scaleY = sy,
            rotDeg = rotDeg,
            skewX = skewX
        )
    }

    private fun lerpAngleDeg(a: Float, b: Float, t: Float): Float {
        var delta = (b - a) % 360f
        if (delta > 180f) delta -= 360f
        if (delta < -180f) delta += 360f
        return a + delta * t
    }
}
