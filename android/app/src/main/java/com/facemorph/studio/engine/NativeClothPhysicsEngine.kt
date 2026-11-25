package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.BodyScanResult
import com.facemorph.studio.model.ClothPhysicsConfig
import com.facemorph.studio.model.DetectedFaceData
import com.facemorph.studio.model.FittedWardrobeLayer
import com.facemorph.studio.model.MotionPreset
import com.facemorph.studio.model.Point2D
import com.facemorph.studio.model.WardrobeAssetItem
import com.facemorph.studio.model.WardrobeSubCategory
import com.google.mlkit.vision.common.InputImage
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
import kotlin.math.roundToInt
import kotlin.math.sin

class ClothParticle(
    var x: Float,
    var y: Float,
    var oldX: Float,
    var oldY: Float,
    val pinned: Boolean,
    val pinOffsetX: Float,
    val pinOffsetY: Float,
    val u: Float,
    val v: Float,
    val mass: Float
)

class ClothSpring(
    val p1: Int,
    val p2: Int,
    val restLength: Float,
    val stiffness: Float
)

class ClothMeshState(
    val particles: MutableList<ClothParticle>,
    val springs: List<ClothSpring>,
    val cols: Int,
    val rows: Int,
    val width: Float,
    val height: Float,
    val seamV: Float = 0.14f,
    var anchorX: Float = 0f,
    var anchorY: Float = 0f,
    var tiltDeg: Float = 0f
) {
    var grabbedIndex: Int? = null
    var grabbedX: Float = 0f
    var grabbedY: Float = 0f
}

object NativeClothPhysicsEngine {

    private val stillPoseDetector by lazy {
        val opts = PoseDetectorOptions.Builder()
            .setDetectorMode(PoseDetectorOptions.SINGLE_IMAGE_MODE)
            .setPreferredHardwareConfigs(PoseDetectorOptions.CPU_GPU)
            .build()
        PoseDetection.getClient(opts)
    }

    private val stillSegmenter by lazy {
        val opts = SelfieSegmenterOptions.Builder()
            .setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
            .build()
        Segmentation.getClient(opts)
    }

    private val matteCacheLock = Any()
    private val cachedPersonMattes = object : LinkedHashMap<Int, Bitmap>(6, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Bitmap>?): Boolean {
            if (size > 4) {
                eldest?.value?.let { if (!it.isRecycled) it.recycle() }
                return true
            }
            return false
        }
    }

    private var bodyOcclFrame: Bitmap? = null
    private var bodyOcclOverlay: Bitmap? = null
    private var bodyOcclMattePixels = IntArray(0)
    private var bodyOcclFramePixels = IntArray(0)
    private var bodyOcclOutPixels = IntArray(0)

    suspend fun scanBodyWithMlKit(
        bitmap: Bitmap,
        face: DetectedFaceData?
    ): BodyScanResult {
        val bw = bitmap.width.toFloat()
        val bh = bitmap.height.toFloat()

        val (pose, matte) = coroutineScope {
            val poseDeferred = async(Dispatchers.Default) { detectPoseOnce(bitmap) }
            val matteDeferred = async(Dispatchers.Default) { segmentPersonOnce(bitmap) }
            poseDeferred.await() to matteDeferred.await()
        }

        val result = buildPoseAndMatteScan(
            bitmap = bitmap,
            bw = bw,
            bh = bh,
            face = face,
            pose = pose,
            matte = matte
        )
        if (matte != null && !matte.isRecycled) {
            val key = System.identityHashCode(bitmap)
            synchronized(matteCacheLock) {
                val prev = cachedPersonMattes.put(key, matte)
                if (prev != null && prev !== matte && !prev.isRecycled) {
                    prev.recycle()
                }
            }
        }
        return result
    }

    private suspend fun detectPoseOnce(bitmap: Bitmap): Pose? {
        return suspendCancellableCoroutine { cont ->
            try {
                val input = InputImage.fromBitmap(bitmap, 0)
                stillPoseDetector.process(input)
                    .addOnSuccessListener { pose -> if (cont.isActive) cont.resume(pose) }
                    .addOnFailureListener { if (cont.isActive) cont.resume(null) }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    private suspend fun segmentPersonOnce(bitmap: Bitmap): Bitmap? {
        return suspendCancellableCoroutine { cont ->
            try {
                val input = InputImage.fromBitmap(bitmap, 0)
                stillSegmenter.process(input)
                    .addOnSuccessListener { mask ->
                        val mw = mask.width
                        val mh = mask.height
                        val total = mw * mh
                        val buf = mask.buffer
                        buf.rewind()
                        val alphaPixels = IntArray(total)
                        for (i in 0 until total) {
                            val conf = buf.float
                            val a = (((conf - 0.35f) / 0.45f).coerceIn(0f, 1f) * 255f).toInt()
                            alphaPixels[i] = Color.argb(a, 255, 255, 255)
                        }
                        val bmp = Bitmap.createBitmap(mw, mh, Bitmap.Config.ARGB_8888)
                        bmp.setHasAlpha(true)
                        bmp.setPixels(alphaPixels, 0, mw, 0, 0, mw, mh)
                        if (cont.isActive) cont.resume(bmp)
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(null)
                    }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    private fun buildPoseAndMatteScan(
        bitmap: Bitmap,
        bw: Float,
        bh: Float,
        face: DetectedFaceData?,
        pose: Pose?,
        matte: Bitmap?
    ): BodyScanResult {
        // Resolve head/face metrics first (prefer DetectedFaceData, else fall back to ML Kit Pose head landmarks)
        val poseNose = pose?.getPoseLandmark(PoseLandmark.NOSE)?.takeIf { it.inFrameLikelihood >= 0.42f }
        val poseLEye = pose?.getPoseLandmark(PoseLandmark.LEFT_EYE)?.takeIf { it.inFrameLikelihood >= 0.38f }
        val poseREye = pose?.getPoseLandmark(PoseLandmark.RIGHT_EYE)?.takeIf { it.inFrameLikelihood >= 0.38f }
        val poseLEar = pose?.getPoseLandmark(PoseLandmark.LEFT_EAR)?.takeIf { it.inFrameLikelihood >= 0.32f }
        val poseREar = pose?.getPoseLandmark(PoseLandmark.RIGHT_EAR)?.takeIf { it.inFrameLikelihood >= 0.32f }
        val poseShL = pose?.getPoseLandmark(PoseLandmark.LEFT_SHOULDER)?.takeIf { it.inFrameLikelihood >= 0.45f }
        val poseShR = pose?.getPoseLandmark(PoseLandmark.RIGHT_SHOULDER)?.takeIf { it.inFrameLikelihood >= 0.45f }

        var fw = face?.let { max(24f, it.boxRight - it.boxLeft) }
            ?: when {
                poseLEar != null && poseREar != null -> max(24f, abs(poseREar.position.x - poseLEar.position.x) * 0.92f)
                poseLEye != null && poseREye != null -> max(24f, abs(poseREye.position.x - poseLEye.position.x) * 2.25f)
                poseShL != null && poseShR != null -> max(24f, abs(poseShR.position.x - poseShL.position.x) * 0.40f)
                else -> bw * 0.22f
            }
        val fh = face?.let { max(28f, it.boxBottom - it.boxTop) } ?: (fw * 1.25f)

        val faceCX = face?.let { (it.boxLeft + it.boxRight) * 0.5f }
            ?: poseNose?.position?.x
            ?: if (poseShL != null && poseShR != null) (poseShL.position.x + poseShR.position.x) * 0.5f else (bw * 0.5f)
        val eyeMid = if (face != null) {
            Point2D(
                (face.landmarks.leftEye.x + face.landmarks.rightEye.x) * 0.5f,
                (face.landmarks.leftEye.y + face.landmarks.rightEye.y) * 0.5f
            )
        } else if (poseLEye != null && poseREye != null) {
            Point2D(
                (poseLEye.position.x + poseREye.position.x) * 0.5f,
                (poseLEye.position.y + poseREye.position.y) * 0.5f
            )
        } else {
            val ey = (poseNose?.position?.y ?: (bh * 0.24f)) - fh * 0.14f
            Point2D(faceCX, ey)
        }
        val headRollDeg = if (face != null) {
            face.rollDeg
        } else if (poseLEye != null && poseREye != null) {
            val (el, er) = if (poseLEye.position.x <= poseREye.position.x) poseLEye.position to poseREye.position else poseREye.position to poseLEye.position
            Math.toDegrees(atan2((er.y - el.y).toDouble(), max(1f, er.x - el.x).toDouble())).toFloat()
        } else 0f

        val nosePt = face?.landmarks?.nose
            ?: poseNose?.let { Point2D(it.position.x, it.position.y) }
            ?: Point2D(eyeMid.x, eyeMid.y + fh * 0.14f)
        val chinY = face?.boxBottom ?: (eyeMid.y + fh * 0.62f)
        val throatY = face?.let { max(it.landmarks.chin.y + fh * 0.08f, chinY + fh * 0.06f) } ?: (chinY + fh * 0.10f)

        // Check if detected pose belongs to the selected subject face (important for multi-person photos)
        val poseCenterX = when {
            poseNose != null -> poseNose.position.x
            poseShL != null && poseShR != null -> (poseShL.position.x + poseShR.position.x) * 0.5f
            else -> null
        }
        val usePoseForSubject = pose != null && poseShL != null && poseShR != null &&
            (face == null || poseCenterX == null || abs(poseCenterX - faceCX) <= max(bw * 0.28f, fw * 2.4f))

        var shLeft: Point2D
        var shRight: Point2D
        var hasSkeletonPose = false
        var hasHips = false
        var hasWrists = false

        if (usePoseForSubject && poseShL != null && poseShR != null) {
            val (sl, sr) = if (poseShL.position.x <= poseShR.position.x) poseShL to poseShR else poseShR to poseShL
            val midX = (sl.position.x + sr.position.x) * 0.5f
            val jointHalf = max(fw * 0.78f, (sr.position.x - sl.position.x) * 0.5f)
            // Expand acromion skeletal joints to outer deltoid shoulder contour (~1.14x)
            val outerHalf = jointHalf * 1.14f
            shLeft = Point2D(midX - outerHalf, sl.position.y)
            shRight = Point2D(midX + outerHalf, sr.position.y)
            hasSkeletonPose = true
            // Refine face width estimate from inter-shoulder scale if no face detector box existed
            if (face == null && poseLEar == null && poseREar == null) {
                fw = max(24f, (outerHalf * 2f) * 0.38f)
            }
        } else {
            val defHalf = (fw * 1.28f).coerceIn(bw * 0.10f, bw * 0.36f)
            val defY = throatY + fh * 0.20f
            shLeft = Point2D(faceCX - defHalf, defY)
            shRight = Point2D(faceCX + defHalf, defY)
        }

        val shMidX = (shLeft.x + shRight.x) * 0.5f
        val shMidY = (shLeft.y + shRight.y) * 0.5f
        val shSpan = max(fw * 1.45f, hypot((shRight.x - shLeft.x).toDouble(), (shRight.y - shLeft.y).toDouble()).toFloat())
        val torsoTiltDeg = Math.toDegrees(
            atan2((shRight.y - shLeft.y).toDouble(), max(1f, shRight.x - shLeft.x).toDouble())
        ).toFloat().coerceIn(-25f, 25f)

        val throatPt = Point2D(
            if (hasSkeletonPose) shMidX * 0.65f + faceCX * 0.35f else faceCX,
            if (hasSkeletonPose) max(chinY + fh * 0.04f, shMidY - fh * 0.06f) else throatY
        )

        // Track hips, elbows, wrists from Pose if attached to selected subject
        val lHipLm = if (usePoseForSubject) pose?.getPoseLandmark(PoseLandmark.LEFT_HIP)?.takeIf { it.inFrameLikelihood >= 0.40f } else null
        val rHipLm = if (usePoseForSubject) pose?.getPoseLandmark(PoseLandmark.RIGHT_HIP)?.takeIf { it.inFrameLikelihood >= 0.40f } else null
        val hipPair = listOfNotNull(lHipLm, rHipLm)
        val leftHipPt: Point2D
        val rightHipPt: Point2D
        if (hipPair.size == 2 && (hipPair[0].position.y + hipPair[1].position.y) * 0.5f > shMidY + fh * 0.55f) {
            val (hl, hr) = if (hipPair[0].position.x <= hipPair[1].position.x) hipPair[0] to hipPair[1] else hipPair[1] to hipPair[0]
            val hMidX = (hl.position.x + hr.position.x) * 0.5f
            val hHalf = max(shSpan * 0.32f, (hr.position.x - hl.position.x) * 0.5f * 1.24f)
            leftHipPt = Point2D(hMidX - hHalf, hl.position.y)
            rightHipPt = Point2D(hMidX + hHalf, hr.position.y)
            hasHips = true
        } else {
            val waistDefaultY = shMidY + fh * 1.55f
            leftHipPt = Point2D(shMidX - shSpan * 0.40f, waistDefaultY)
            rightHipPt = Point2D(shMidX + shSpan * 0.40f, waistDefaultY)
        }
        val hipMidY = (leftHipPt.y + rightHipPt.y) * 0.5f

        val chestY = if (hasHips) shMidY + (hipMidY - shMidY) * 0.36f else shMidY + fh * 0.50f
        val waistY = if (hasHips) shMidY + (hipMidY - shMidY) * 0.74f else shMidY + fh * 1.16f

        // Refine chest & waist contours from segmentation matte around torso centerline
        var chestHalfW = shSpan * 0.45f
        var waistHalfW = shSpan * 0.38f
        var waistMidX = (leftHipPt.x + rightHipPt.x) * 0.5f

        if (matte != null && matte.width > 12 && matte.height > 12) {
            val mw = matte.width
            val mh = matte.height
            val pixels = IntArray(mw * mh)
            matte.getPixels(pixels, 0, mw, 0, 0, mw, mh)
            val sx = mw.toFloat() / bw
            val sy = mh.toFloat() / bh

            fun scanSpan(yImg: Float, cxImg: Float): Pair<Float, Float>? {
                val my = (yImg * sy).toInt().coerceIn(0, mh - 1)
                val row = my * mw
                val ax = (cxImg * sx).toInt().coerceIn(0, mw - 1)
                var seed = -1
                if (Color.alpha(pixels[row + ax]) > 95) {
                    seed = ax
                } else {
                    val searchR = max(4, (fw * sx * 0.45f).toInt())
                    for (off in 1..searchR) {
                        if (ax - off >= 0 && Color.alpha(pixels[row + ax - off]) > 95) {
                            seed = ax - off; break
                        }
                        if (ax + off < mw && Color.alpha(pixels[row + ax + off]) > 95) {
                            seed = ax + off; break
                        }
                    }
                }
                if (seed < 0) return null
                var lx = seed
                var gL = 0
                while (lx > 0) {
                    if (Color.alpha(pixels[row + lx - 1]) > 85) { lx--; gL = 0 } else if (++gL > 2) break else lx--
                }
                var rx = seed
                var gR = 0
                while (rx < mw - 1) {
                    if (Color.alpha(pixels[row + rx + 1]) > 85) { rx++; gR = 0 } else if (++gR > 2) break else rx++
                }
                return (lx / sx) to (rx / sx)
            }

            if (!hasSkeletonPose) {
                scanSpan(shMidY + fh * 0.14f, shMidX)?.let { (lx, rx) ->
                    val w = rx - lx
                    if (w in (fw * 1.45f)..(fw * 4.2f)) {
                        shLeft = Point2D(lx, shLeft.y)
                        shRight = Point2D(rx, shRight.y)
                    }
                }
            }
            val updatedShSpan = max(fw * 1.45f, hypot((shRight.x - shLeft.x).toDouble(), (shRight.y - shLeft.y).toDouble()).toFloat())
            val updatedShMidX = (shLeft.x + shRight.x) * 0.5f

            scanSpan(chestY, updatedShMidX)?.let { (lx, rx) ->
                val rawChestHalf = (rx - lx) * 0.5f
                chestHalfW = rawChestHalf.coerceIn(updatedShSpan * 0.36f, updatedShSpan * 0.56f)
            }
            scanSpan(waistY, waistMidX)?.let { (lx, rx) ->
                val rawWaistHalf = (rx - lx) * 0.5f
                waistHalfW = rawWaistHalf.coerceIn(chestHalfW * 0.72f, chestHalfW * 1.08f)
                waistMidX = (lx + rx) * 0.5f
            }
        }

        // Elbows & wrists
        val elbL = if (usePoseForSubject) pose?.getPoseLandmark(PoseLandmark.LEFT_ELBOW)?.takeIf { it.inFrameLikelihood >= 0.35f } else null
        val elbR = if (usePoseForSubject) pose?.getPoseLandmark(PoseLandmark.RIGHT_ELBOW)?.takeIf { it.inFrameLikelihood >= 0.35f } else null
        val wrL = if (usePoseForSubject) pose?.getPoseLandmark(PoseLandmark.LEFT_WRIST)?.takeIf { it.inFrameLikelihood >= 0.42f } else null
        val wrR = if (usePoseForSubject) pose?.getPoseLandmark(PoseLandmark.RIGHT_WRIST)?.takeIf { it.inFrameLikelihood >= 0.42f } else null

        val elbowPair = listOfNotNull(elbL, elbR)
        val leftElbowPt: Point2D
        val rightElbowPt: Point2D
        if (elbowPair.size == 2) {
            val (el, er) = if (elbowPair[0].position.x <= elbowPair[1].position.x) elbowPair[0] to elbowPair[1] else elbowPair[1] to elbowPair[0]
            leftElbowPt = Point2D(el.position.x, el.position.y)
            rightElbowPt = Point2D(er.position.x, er.position.y)
        } else if (elbowPair.size == 1) {
            val single = elbowPair[0]
            if (single.position.x <= shMidX) {
                leftElbowPt = Point2D(single.position.x, single.position.y)
                rightElbowPt = Point2D(shRight.x + shSpan * 0.05f, chestY + fh * 0.25f)
            } else {
                leftElbowPt = Point2D(shLeft.x - shSpan * 0.05f, chestY + fh * 0.25f)
                rightElbowPt = Point2D(single.position.x, single.position.y)
            }
        } else {
            leftElbowPt = Point2D(shLeft.x - shSpan * 0.05f, chestY + fh * 0.25f)
            rightElbowPt = Point2D(shRight.x + shSpan * 0.05f, chestY + fh * 0.25f)
        }

        val wristPair = listOfNotNull(wrL, wrR)
        val leftWristPt: Point2D
        val rightWristPt: Point2D
        if (wristPair.size == 2) {
            val (wl, wr) = if (wristPair[0].position.x <= wristPair[1].position.x) wristPair[0] to wristPair[1] else wristPair[1] to wristPair[0]
            leftWristPt = Point2D(wl.position.x, wl.position.y)
            rightWristPt = Point2D(wr.position.x, wr.position.y)
            hasWrists = true
        } else if (wristPair.size == 1) {
            val single = wristPair[0]
            hasWrists = true
            if (single.position.x <= shMidX) {
                leftWristPt = Point2D(single.position.x, single.position.y)
                rightWristPt = Point2D(rightElbowPt.x, waistY + fh * 0.22f)
            } else {
                leftWristPt = Point2D(leftElbowPt.x, waistY + fh * 0.22f)
                rightWristPt = Point2D(single.position.x, single.position.y)
            }
        } else {
            leftWristPt = Point2D(shLeft.x - shSpan * 0.06f, waistY + fh * 0.22f)
            rightWristPt = Point2D(shRight.x + shSpan * 0.06f, waistY + fh * 0.22f)
        }

        val finalShSpan = max(fw * 1.45f, hypot((shRight.x - shLeft.x).toDouble(), (shRight.y - shLeft.y).toDouble()).toFloat())
        val finalShMidX = (shLeft.x + shRight.x) * 0.5f

        // Real anatomical cm estimation relative to head/eye geometry
        val pxPerCmFace = fw / 15.0f
        val pxPerCmEye = if (face != null) {
            val eyeDx = hypot(
                (face.landmarks.rightEye.x - face.landmarks.leftEye.x).toDouble(),
                (face.landmarks.rightEye.y - face.landmarks.leftEye.y).toDouble()
            ).toFloat()
            max(8f, eyeDx) / 6.3f
        } else pxPerCmFace
        val pxPerCm = (pxPerCmFace * 0.55f + pxPerCmEye * 0.45f).coerceAtLeast(1.2f)

        val shoulderCm = (finalShSpan / pxPerCm).coerceIn(32f, 60f).roundToInt()
        val chestCm = (((chestHalfW * 2f) / pxPerCm) * 2.26f).coerceIn(72f, 136f).roundToInt()
        val waistCm = (((waistHalfW * 2f) / pxPerCm) * 2.16f).coerceIn(58f, 126f).roundToInt()
        val neckCm = ((fw * 0.72f / pxPerCm) * 3.05f).coerceIn(30f, 48f).roundToInt()
        val sizeTag = when {
            chestCm < 86 -> "XS · EU 44"
            chestCm < 94 -> "S · EU 46"
            chestCm < 102 -> "M · EU 48"
            chestCm < 110 -> "L · EU 50"
            chestCm < 118 -> "XL · EU 52"
            else -> "XXL · EU 54"
        }

        return BodyScanResult(
            shoulderWidthCm = shoulderCm,
            chestCm = chestCm,
            waistCm = waistCm,
            neckCm = neckCm,
            estimatedSize = sizeTag,
            nose = nosePt,
            throat = throatPt,
            leftShoulder = shLeft,
            rightShoulder = shRight,
            sternum = Point2D(finalShMidX, chestY),
            leftWaist = Point2D(waistMidX - waistHalfW, waistY),
            rightWaist = Point2D(waistMidX + waistHalfW, waistY),
            leftWrist = leftWristPt,
            rightWrist = rightWristPt,
            leftHip = leftHipPt,
            rightHip = rightHipPt,
            leftElbow = leftElbowPt,
            rightElbow = rightElbowPt,
            eyeMid = eyeMid,
            faceWidthPx = fw,
            chestHalfWidthPx = chestHalfW,
            headRollDeg = headRollDeg,
            torsoTiltDeg = torsoTiltDeg,
            hasSkeletonPose = hasSkeletonPose,
            hasHips = hasHips,
            hasWrists = hasWrists
        )
    }

    fun scanBody(
        bitmapWidth: Float,
        bitmapHeight: Float,
        faceCenterX: Float?,
        faceBottomY: Float?,
        faceWidth: Float? = null,
        faceHeight: Float? = null
    ): BodyScanResult {
        val fw = faceWidth ?: (bitmapWidth * 0.22f)
        val fh = faceHeight ?: (fw * 1.25f)
        val cx = faceCenterX ?: (bitmapWidth * 0.5f)
        val neckY = faceBottomY?.let { it + fh * 0.12f } ?: (bitmapHeight * 0.36f)
        val shoulderHalfW = (fw * 1.28f).coerceIn(bitmapWidth * 0.10f, bitmapWidth * 0.34f)
        val shoulderY = neckY + fh * 0.22f
        val waistHalfW = shoulderHalfW * 0.78f
        val waistY = shoulderY + fh * 1.48f

        val pxPerCm = (fw / 15.0f).coerceAtLeast(1.2f)
        val shCm = ((shoulderHalfW * 2f) / pxPerCm).coerceIn(34f, 56f).roundToInt()
        val chCm = (((shoulderHalfW * 1.76f) / pxPerCm) * 2.26f).coerceIn(76f, 128f).roundToInt()
        val waCm = (((waistHalfW * 2f) / pxPerCm) * 2.16f).coerceIn(62f, 116f).roundToInt()
        val sizeTag = when {
            chCm < 86 -> "XS · EU 44"
            chCm < 94 -> "S · EU 46"
            chCm < 102 -> "M · EU 48"
            chCm < 110 -> "L · EU 50"
            chCm < 118 -> "XL · EU 52"
            else -> "XXL · EU 54"
        }

        return BodyScanResult(
            shoulderWidthCm = shCm,
            chestCm = chCm,
            waistCm = waCm,
            neckCm = (shCm * 0.86f).roundToInt(),
            estimatedSize = sizeTag,
            nose = Point2D(cx, neckY - fh * 0.65f),
            throat = Point2D(cx, neckY),
            leftShoulder = Point2D(cx - shoulderHalfW, shoulderY),
            rightShoulder = Point2D(cx + shoulderHalfW, shoulderY),
            sternum = Point2D(cx, shoulderY + fh * 0.45f),
            leftWaist = Point2D(cx - waistHalfW, waistY),
            rightWaist = Point2D(cx + waistHalfW, waistY),
            leftWrist = Point2D(cx - shoulderHalfW * 1.18f, waistY + fh * 0.25f),
            rightWrist = Point2D(cx + shoulderHalfW * 1.18f, waistY + fh * 0.25f),
            eyeMid = Point2D(cx, neckY - fh * 0.78f),
            faceWidthPx = fw,
            chestHalfWidthPx = shoulderHalfW * 0.88f
        )
    }

    fun createClothGrid(
        anchorX: Float,
        anchorY: Float,
        width: Float,
        height: Float,
        seamV: Float = 0.14f,
        tiltDeg: Float = 0f,
        chestRatio: Float = 0.94f,
        waistRatio: Float = 0.84f,
        cols: Int = 7,
        rows: Int = 8
    ): ClothMeshState {
        val particles = mutableListOf<ClothParticle>()
        val springs = mutableListOf<ClothSpring>()
        val dy = height / (rows - 1)
        val clampedSeamV = seamV.coerceIn(0.03f, 0.28f)
        val seamOffsetPx = height * clampedSeamV
        val tiltRad = Math.toRadians(tiltDeg.toDouble()).toFloat()
        val cosT = cos(tiltRad)
        val sinT = sin(tiltRad)

        for (r in 0 until rows) {
            val v = r.toFloat() / (rows - 1)
            val envelope = when {
                v < 0.36f -> {
                    val t = v / 0.36f
                    val st = t * t * (3f - 2f * t)
                    1.0f * (1f - st) + chestRatio.coerceIn(0.76f, 1.12f) * st
                }
                v < 0.76f -> {
                    val t = (v - 0.36f) / 0.40f
                    val st = t * t * (3f - 2f * t)
                    chestRatio.coerceIn(0.76f, 1.12f) * (1f - st) + waistRatio.coerceIn(0.68f, 1.08f) * st
                }
                else -> {
                    val t = (v - 0.76f) / 0.24f
                    waistRatio.coerceIn(0.68f, 1.08f) * (1f + t * 0.05f)
                }
            }
            val rowW = width * envelope
            val rowDx = rowW / (cols - 1)

            for (c in 0 until cols) {
                val u = c.toFloat() / (cols - 1)
                val collarArch = if (r == 0) sin(u * PI.toFloat()) * minOf(dy * 0.32f, 8f) else 0f
                val localX = -rowW * 0.5f + c * rowDx
                // Pivot vertically relative to the anatomical shoulder seam so shoulder ridge pins accurately
                val localY = (r * dy + collarArch) - seamOffsetPx
                val px = anchorX + localX * cosT - localY * sinT
                val py = anchorY + localX * sinT + localY * cosT
                val isPinned = (r == 0) || (r == 1 && (c == 1 || c == cols - 2))
                particles.add(
                    ClothParticle(
                        x = px,
                        y = py,
                        oldX = px,
                        oldY = py,
                        pinned = isPinned,
                        pinOffsetX = localX,
                        pinOffsetY = localY,
                        u = u,
                        v = v,
                        mass = 1.0f + v * 0.45f
                    )
                )
            }
        }

        fun addSpring(i1: Int, i2: Int, stiffness: Float) {
            val p1 = particles[i1]
            val p2 = particles[i2]
            val rest = hypot((p2.x - p1.x).toDouble(), (p2.y - p1.y).toDouble()).toFloat()
            springs.add(ClothSpring(i1, i2, rest, stiffness))
        }

        for (r in 0 until rows) {
            for (c in 0 until cols) {
                val idx = r * cols + c
                if (c < cols - 1) addSpring(idx, idx + 1, 0.95f)
                if (r < rows - 1) addSpring(idx, idx + cols, 0.95f)
                if (c < cols - 1 && r < rows - 1) {
                    addSpring(idx, idx + cols + 1, 0.6f)
                    addSpring(idx + 1, idx + cols, 0.6f)
                }
                if (c < cols - 2) addSpring(idx, idx + 2, 0.4f)
                if (r < rows - 2) addSpring(idx, idx + cols * 2, 0.4f)
            }
        }

        return ClothMeshState(
            particles = particles,
            springs = springs,
            cols = cols,
            rows = rows,
            width = width,
            height = height,
            seamV = clampedSeamV,
            anchorX = anchorX,
            anchorY = anchorY,
            tiltDeg = tiltDeg
        )
    }

    fun stepClothPhysics(
        mesh: ClothMeshState,
        config: ClothPhysicsConfig,
        scan: BodyScanResult,
        timeSec: Float
    ) {
        var leanDeg = mesh.tiltDeg + config.postureTilt
        var chestExp = 0f
        var dynamicWindX = config.windStrength
        when (config.preset) {
            MotionPreset.BREATHING -> chestExp = sin(timeSec * 1.9f) * 3.2f
            MotionPreset.WALKING -> {
                leanDeg += sin(timeSec * 2.8f) * 3.0f
                dynamicWindX += sin(timeSec * 2.8f) * 1.4f
            }
            MotionPreset.BREEZE -> {
                dynamicWindX += 3.2f + sin(timeSec * config.gustFrequency * PI.toFloat()) * 2.6f
            }
            MotionPreset.DANCE -> {
                leanDeg += sin(timeSec * 3.6f) * 6.0f
                dynamicWindX += cos(timeSec * 3.6f) * 3.0f
            }
            MotionPreset.STILL -> Unit
        }
        if (config.airFanActive) {
            dynamicWindX += 5.5f + sin(timeSec * 6.5f) * 1.8f
        }

        val tiltRad = Math.toRadians(leanDeg.toDouble()).toFloat()
        val cosT = cos(tiltRad)
        val sinT = sin(tiltRad)
        val airDrag = 1f - (config.airResistance / 100f) * 0.12f
        val damping = (config.fabricType.damping * airDrag).coerceIn(0.75f, 0.985f)
        val grav = config.gravity * 1.45f
        val windSuscept = config.fabricType.windSusceptibility

        // 1. Verlet integration preserving exact shoulder anchorX/anchorY (offsets + seamV + tilt)
        for (i in mesh.particles.indices) {
            val p = mesh.particles[i]
            if (p.pinned) {
                val rx = p.pinOffsetX * cosT - p.pinOffsetY * sinT
                val ry = p.pinOffsetX * sinT + p.pinOffsetY * cosT
                p.x = mesh.anchorX + rx
                p.y = mesh.anchorY + ry
                p.oldX = p.x
                p.oldY = p.y
                continue
            }

            if (mesh.grabbedIndex == i) {
                p.x = mesh.grabbedX
                p.y = mesh.grabbedY
                p.oldX = p.x
                p.oldY = p.y
                continue
            }

            val vx = (p.x - p.oldX) * damping
            val vy = (p.y - p.oldY) * damping
            p.oldX = p.x
            p.oldY = p.y

            val hemRatio = p.v
            val flutter = sin(p.u * 4f * PI.toFloat() + timeSec * 5f + p.x * 0.04f) *
                config.windTurbulence * hemRatio * windSuscept * 1.25f
            val windForce = (dynamicWindX * windSuscept * hemRatio * 0.32f) + flutter

            p.x += vx + windForce
            p.y += vy + grav * p.mass

            // Track arm & sleeve bend toward detected elbows and wrists on outer sleeve columns
            if (scan.hasSkeletonPose && p.v > mesh.seamV + 0.06f && (p.u <= 0.16f || p.u >= 0.84f)) {
                val armT = ((p.v - mesh.seamV) / max(0.18f, 1f - mesh.seamV)).coerceIn(0f, 1f)
                if (p.u <= 0.16f) {
                    val segX = if (armT < 0.55f) {
                        val k = armT / 0.55f
                        scan.leftShoulder.x * (1f - k) + scan.leftElbow.x * k
                    } else {
                        val k = (armT - 0.55f) / 0.45f
                        scan.leftElbow.x * (1f - k) + scan.leftWrist.x * k
                    }
                    val armOffset = (segX - scan.leftShoulder.x).coerceIn(-mesh.width * 0.25f, mesh.width * 0.22f)
                    val targetSleeveX = mesh.anchorX - mesh.width * (0.5f - p.u) + armOffset * 0.65f
                    val strength = if (p.u <= 0.05f) 0.16f else 0.08f
                    p.x += (targetSleeveX - p.x) * strength
                } else {
                    val segX = if (armT < 0.55f) {
                        val k = armT / 0.55f
                        scan.rightShoulder.x * (1f - k) + scan.rightElbow.x * k
                    } else {
                        val k = (armT - 0.55f) / 0.45f
                        scan.rightElbow.x * (1f - k) + scan.rightWrist.x * k
                    }
                    val armOffset = (segX - scan.rightShoulder.x).coerceIn(-mesh.width * 0.22f, mesh.width * 0.25f)
                    val targetSleeveX = mesh.anchorX + mesh.width * (p.u - 0.5f) + armOffset * 0.65f
                    val strength = if (p.u >= 0.95f) 0.16f else 0.08f
                    p.x += (targetSleeveX - p.x) * strength
                }
            }
        }

        // 2. Spring relaxation passes + anatomical torso collision
        val passes = max(2, config.fabricType.stiffness)
        for (pass in 0 until passes) {
            for (s in mesh.springs) {
                val p1 = mesh.particles[s.p1]
                val p2 = mesh.particles[s.p2]
                val dx = p2.x - p1.x
                val dy = p2.y - p1.y
                val dist = hypot(dx.toDouble(), dy.toDouble()).toFloat()
                if (dist < 0.0001f) continue

                val diff = ((dist - s.restLength) / dist) * s.stiffness
                if (!p1.pinned && !p2.pinned) {
                    p1.x += dx * 0.5f * diff
                    p1.y += dy * 0.5f * diff
                    p2.x -= dx * 0.5f * diff
                    p2.y -= dy * 0.5f * diff
                } else if (p1.pinned && !p2.pinned) {
                    p2.x -= dx * diff
                    p2.y -= dy * diff
                } else if (!p1.pinned && p2.pinned) {
                    p1.x += dx * diff
                    p1.y += dy * diff
                }
            }

            val chestHalf = max(20f, scan.chestHalfWidthPx * 0.72f + chestExp)
            for (p in mesh.particles) {
                if (p.pinned) continue
                val dcx = p.x - scan.sternum.x
                val dcy = p.y - scan.sternum.y
                if (abs(dcy) < mesh.height * 0.38f && abs(dcx) < chestHalf * 0.65f) {
                    p.x += (if (dcx >= 0) 1f else -1f) * 0.5f
                }
            }
        }
    }

    fun renderClothWithBitmapMesh(
        canvas: Canvas,
        bitmap: Bitmap,
        mesh: ClothMeshState,
        showWireframe: Boolean,
        showStress: Boolean,
        shadowDepth: Int,
        lightingFilter: ColorMatrixColorFilter? = null
    ) {
        val verts = FloatArray(mesh.cols * mesh.rows * 2)
        for (i in mesh.particles.indices) {
            verts[i * 2] = mesh.particles[i].x
            verts[i * 2 + 1] = mesh.particles[i].y
        }

        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            colorFilter = lightingFilter
            if (shadowDepth > 0) {
                setShadowLayer((shadowDepth / 100f) * 14f, 0f, 6f, Color.argb(95, 0, 0, 0))
            }
        }

        canvas.drawBitmapMesh(
            bitmap,
            mesh.cols - 1,
            mesh.rows - 1,
            verts,
            0,
            null,
            0,
            paint
        )

        if (showWireframe || showStress) {
            val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeWidth = 2f
                style = Paint.Style.STROKE
            }
            for (s in mesh.springs) {
                val p1 = mesh.particles[s.p1]
                val p2 = mesh.particles[s.p2]
                if (showStress) {
                    val dist = hypot((p2.x - p1.x).toDouble(), (p2.y - p1.y).toDouble()).toFloat()
                    val strain = (abs(dist - s.restLength) / max(1f, s.restLength)).coerceIn(0f, 1f)
                    linePaint.color = if (strain > 0.15f) {
                        Color.argb(210, 244, 63, 94)
                    } else {
                        Color.argb(160, 52, 211, 153)
                    }
                } else {
                    linePaint.color = Color.argb(155, 34, 211, 238)
                }
                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, linePaint)
            }
        }
    }

    private fun buildAmbientLightingFilter(
        targetBitmap: Bitmap,
        sampleX: Float,
        sampleY: Float,
        faceW: Float
    ): ColorMatrixColorFilter {
        val sx = sampleX.toInt().coerceIn(4, targetBitmap.width - 5)
        val sy = sampleY.toInt().coerceIn(4, targetBitmap.height - 5)
        val rx = max(5, (faceW * 0.18f).toInt())
        val ry = max(5, (faceW * 0.14f).toInt())
        val (r, g, b) = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(targetBitmap, sx, sy, rx, ry)
        val lum = (0.299f * r + 0.587f * g + 0.114f * b).coerceIn(55f, 225f)
        val exposureScale = (1f + ((lum / 145f) - 1f) * 0.25f).coerceIn(0.84f, 1.16f)
        val meanC = max(1f, (r + g + b) / 3f)
        val rTint = (1f + ((r / meanC) - 1f) * 0.14f).coerceIn(0.93f, 1.07f)
        val gTint = (1f + ((g / meanC) - 1f) * 0.14f).coerceIn(0.93f, 1.07f)
        val bTint = (1f + ((b / meanC) - 1f) * 0.14f).coerceIn(0.93f, 1.07f)
        return ColorMatrixColorFilter(
            ColorMatrix().apply {
                setScale(exposureScale * rTint, exposureScale * gTint, exposureScale * bTint, 1f)
            }
        )
    }

    fun renderBodyAndFittedAssets(
        targetBitmap: Bitmap,
        scan: BodyScanResult,
        layers: List<FittedWardrobeLayer>,
        assetsMap: Map<String, WardrobeAssetItem>,
        assetBitmaps: Map<String, Bitmap>,
        clothMeshes: MutableMap<String, ClothMeshState>,
        clothConfig: ClothPhysicsConfig,
        timeSec: Float,
        showScanHud: Boolean
    ): Bitmap {
        val output = Bitmap.createBitmap(targetBitmap.width, targetBitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        canvas.drawBitmap(targetBitmap, 0f, 0f, null)

        val shoulderSpan = max(
            scan.faceWidthPx * 1.45f,
            hypot(
                (scan.rightShoulder.x - scan.leftShoulder.x).toDouble(),
                (scan.rightShoulder.y - scan.leftShoulder.y).toDouble()
            ).toFloat()
        )
        val shMidX = (scan.leftShoulder.x + scan.rightShoulder.x) * 0.5f
        val shMidY = (scan.leftShoulder.y + scan.rightShoulder.y) * 0.5f
        val ambientFilter = buildAmbientLightingFilter(
            targetBitmap = targetBitmap,
            sampleX = scan.nose.x,
            sampleY = scan.nose.y + scan.faceWidthPx * 0.18f,
            faceW = scan.faceWidthPx
        )

        for (layer in layers) {
            if (!layer.visible) continue
            val asset = assetsMap[layer.assetId] ?: continue
            val bmp = assetBitmaps[layer.assetId] ?: continue

            when (asset.anchorPoint) {
                BodyAnchorPoint.SHOULDERS -> {
                    val garmentMetrics = GarmentStructureAnalyzer.analyze(bmp)
                    val seamV = garmentMetrics.shoulderSeamV.coerceIn(0.04f, 0.26f)
                    val widthRatio = garmentMetrics.shoulderWidthRatio.coerceIn(0.78f, 0.98f)
                    val targetW = (shoulderSpan / widthRatio) * 0.98f * layer.scale
                    val baseH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val hipMidY = (scan.leftHip.y + scan.rightHip.y) * 0.5f
                    val torsoStretch = if (scan.hasHips) {
                        val measuredTorsoPx = max(scan.faceWidthPx * 1.15f, hipMidY - shMidY)
                        val expectedTorsoPx = max(24f, baseH * (0.76f - seamV))
                        (measuredTorsoPx / expectedTorsoPx).coerceIn(0.78f, 1.32f)
                    } else {
                        1.0f
                    }
                    val targetH = baseH * (0.35f + 0.65f * torsoStretch) * layer.lengthScale.coerceIn(0.70f, 1.45f)
                    val cx = shMidX + layer.offsetX
                    val cy = shMidY + layer.offsetY
                    val totalTilt = scan.torsoTiltDeg + layer.rotation

                    canvas.save()
                    val headHalfW = max(16f, scan.faceWidthPx * 0.45f)
                    val faceHApprox = scan.faceWidthPx * 1.25f
                    val headCenterY = scan.eyeMid.y + faceHApprox * 0.10f
                    val chinBottomY = max(scan.throat.y - faceHApprox * 0.04f, headCenterY + faceHApprox * 0.48f)
                    val headOval = Path().apply {
                        addOval(
                            RectF(
                                scan.eyeMid.x - headHalfW,
                                headCenterY - faceHApprox * 0.56f,
                                scan.eyeMid.x + headHalfW,
                                chinBottomY + faceHApprox * 0.02f
                            ),
                            Path.Direction.CW
                        )
                    }
                    val throatV = Path().apply {
                        val nw = scan.faceWidthPx * 0.24f
                        moveTo(scan.throat.x - nw, chinBottomY - faceHApprox * 0.08f)
                        quadTo(scan.throat.x - nw * 0.58f, chinBottomY + faceHApprox * 0.14f, scan.throat.x, chinBottomY + faceHApprox * 0.17f)
                        quadTo(scan.throat.x + nw * 0.58f, chinBottomY + faceHApprox * 0.14f, scan.throat.x + nw, chinBottomY - faceHApprox * 0.08f)
                        close()
                    }
                    headOval.op(throatV, Path.Op.UNION)
                    if (abs(scan.headRollDeg) > 1.5f) {
                        headOval.transform(Matrix().apply { setRotate(scan.headRollDeg, scan.eyeMid.x, headCenterY) })
                    }
                    val jawHole = Path().apply {
                        fillType = Path.FillType.EVEN_ODD
                        addRect(0f, 0f, targetBitmap.width.toFloat(), targetBitmap.height.toFloat(), Path.Direction.CW)
                        addPath(headOval)
                    }
                    canvas.clipPath(jawHole)

                    val waistW = abs(scan.rightWaist.x - scan.leftWaist.x)
                    val chestRatio = ((scan.chestHalfWidthPx * 2.04f) / max(1f, targetW)).coerceIn(0.76f, 1.12f)
                    val waistRatio = ((waistW * 1.03f) / max(1f, targetW)).coerceIn(0.68f, 1.08f)

                    if (clothConfig.enabled && clothConfig.isSimulating) {
                        val existing = clothMeshes[layer.assetId]
                        val mesh = if (existing != null &&
                            abs(existing.width - targetW) < 6f &&
                            abs(existing.height - targetH) < 6f
                        ) {
                            existing.apply {
                                anchorX = cx
                                anchorY = cy
                                tiltDeg = totalTilt
                            }
                        } else {
                            createClothGrid(
                                anchorX = cx,
                                anchorY = cy,
                                width = targetW,
                                height = targetH,
                                seamV = seamV,
                                tiltDeg = totalTilt,
                                chestRatio = chestRatio,
                                waistRatio = waistRatio
                            ).also { clothMeshes[layer.assetId] = it }
                        }

                        stepClothPhysics(mesh, clothConfig, scan, timeSec)
                        renderClothWithBitmapMesh(
                            canvas = canvas,
                            bitmap = bmp,
                            mesh = mesh,
                            showWireframe = clothConfig.showWireframe,
                            showStress = clothConfig.showStressHeatmap,
                            shadowDepth = layer.shadowDepth,
                            lightingFilter = ambientFilter
                        )
                    } else {
                        val anchoredStartY = cy - targetH * seamV
                        drawScaledRotatedBitmap(
                            canvas = canvas,
                            bmp = bmp,
                            x = cx,
                            y = anchoredStartY,
                            targetW = targetW,
                            targetH = targetH,
                            rotationDeg = totalTilt,
                            centeredY = false,
                            pivotOffsetY = targetH * seamV,
                            filter = ambientFilter
                        )
                    }

                    // Soft cast shadow under chin/throat onto lapel seam
                    val shRadius = max(12f, scan.faceWidthPx * 0.46f)
                    val collarShadowY = chinBottomY + faceHApprox * 0.12f
                    val collarGrad = RadialGradient(
                        0f, 0f, 1f,
                        intArrayOf(Color.argb(85, 4, 6, 14), Color.argb(35, 4, 6, 14), Color.TRANSPARENT),
                        floatArrayOf(0f, 0.55f, 1f),
                        Shader.TileMode.CLAMP
                    ).apply {
                        setLocalMatrix(Matrix().apply {
                            setScale(shRadius, shRadius * 0.50f)
                            postTranslate(scan.throat.x, collarShadowY)
                        })
                    }
                    canvas.drawOval(
                        RectF(
                            scan.throat.x - shRadius,
                            collarShadowY - shRadius * 0.50f,
                            scan.throat.x + shRadius,
                            collarShadowY + shRadius * 0.50f
                        ),
                        Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = collarGrad }
                    )

                    canvas.restore()
                }

                BodyAnchorPoint.NECK -> {
                    val targetW = max(scan.faceWidthPx * 0.66f, shoulderSpan * 0.27f) * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val swing = if (clothConfig.enabled) sin(timeSec * 2.8f) * (1.8f + abs(clothConfig.windStrength) * 0.5f) else 0f
                    val px = scan.throat.x + layer.offsetX + swing
                    val py = scan.throat.y + layer.offsetY + 2f
                    drawScaledRotatedBitmap(
                        canvas = canvas,
                        bmp = bmp,
                        x = px,
                        y = py,
                        targetW = targetW,
                        targetH = targetH,
                        rotationDeg = scan.torsoTiltDeg * 0.5f + layer.rotation + swing * 0.5f,
                        centeredY = false
                    )
                }

                BodyAnchorPoint.EARRINGS -> {
                    val earHalfW = scan.faceWidthPx * 0.54f
                    val earW = max(10f, scan.faceWidthPx * 0.24f * layer.scale)
                    val earH = earW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val sway = if (clothConfig.enabled) sin(timeSec * 3.1f) * (1.8f + abs(clothConfig.windStrength) * 0.35f) else 0f
                    val rollRad = Math.toRadians(scan.headRollDeg.toDouble()).toFloat()
                    val earLocalY = scan.faceWidthPx * 0.30f
                    val cosR = cos(rollRad)
                    val sinR = sin(rollRad)
                    val lxOff = (-earHalfW) * cosR - earLocalY * sinR
                    val lyOff = (-earHalfW) * sinR + earLocalY * cosR
                    val rxOff = (earHalfW) * cosR - earLocalY * sinR
                    val ryOff = (earHalfW) * sinR + earLocalY * cosR

                    drawScaledRotatedBitmap(
                        canvas = canvas,
                        bmp = bmp,
                        x = scan.eyeMid.x + lxOff + layer.offsetX,
                        y = scan.eyeMid.y + lyOff + layer.offsetY,
                        targetW = earW,
                        targetH = earH,
                        rotationDeg = scan.headRollDeg + layer.rotation + sway,
                        centeredY = false,
                        mirrorX = false
                    )
                    drawScaledRotatedBitmap(
                        canvas = canvas,
                        bmp = bmp,
                        x = scan.eyeMid.x + rxOff - layer.offsetX,
                        y = scan.eyeMid.y + ryOff + layer.offsetY,
                        targetW = earW,
                        targetH = earH,
                        rotationDeg = scan.headRollDeg - (layer.rotation + sway),
                        centeredY = false,
                        mirrorX = true
                    )
                }

                BodyAnchorPoint.HEAD -> {
                    if (asset.subCategory == WardrobeSubCategory.GLASSES) {
                        val targetW = scan.faceWidthPx * 0.94f * layer.scale
                        val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                        val px = scan.eyeMid.x + layer.offsetX
                        val py = scan.eyeMid.y + layer.offsetY
                        drawScaledRotatedBitmap(
                            canvas = canvas,
                            bmp = bmp,
                            x = px,
                            y = py,
                            targetW = targetW,
                            targetH = targetH,
                            rotationDeg = scan.headRollDeg + layer.rotation,
                            centeredY = true
                        )
                    } else {
                        val targetW = scan.faceWidthPx * 1.26f * layer.scale
                        val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                        val px = scan.eyeMid.x + layer.offsetX
                        val py = scan.eyeMid.y - scan.faceWidthPx * 0.52f + layer.offsetY - targetH * 0.72f
                        drawScaledRotatedBitmap(
                            canvas = canvas,
                            bmp = bmp,
                            x = px,
                            y = py,
                            targetW = targetW,
                            targetH = targetH,
                            rotationDeg = scan.headRollDeg + layer.rotation,
                            centeredY = false
                        )
                    }
                }

                BodyAnchorPoint.WRIST -> {
                    val targetW = max(scan.faceWidthPx * 0.44f, shoulderSpan * 0.18f) * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val leftInside = scan.leftWrist.x in 6f..(targetBitmap.width - 6f) && scan.leftWrist.y in 6f..(targetBitmap.height - 6f)
                    val rightInside = scan.rightWrist.x in 6f..(targetBitmap.width - 6f) && scan.rightWrist.y in 6f..(targetBitmap.height - 6f)
                    val (wristPt, elbowPt) = if (leftInside || !rightInside) {
                        scan.leftWrist to scan.leftElbow
                    } else {
                        scan.rightWrist to scan.rightElbow
                    }
                    val dx = wristPt.x - elbowPt.x
                    val dy = wristPt.y - elbowPt.y
                    val forearmDeg = if (scan.hasWrists && hypot(dx.toDouble(), dy.toDouble()) > 8.0) {
                        Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat() - 90f
                    } else {
                        scan.torsoTiltDeg * 0.5f
                    }
                    val px = wristPt.x + layer.offsetX
                    val py = wristPt.y + layer.offsetY
                    drawScaledRotatedBitmap(
                        canvas = canvas,
                        bmp = bmp,
                        x = px,
                        y = py,
                        targetW = targetW,
                        targetH = targetH,
                        rotationDeg = forearmDeg + layer.rotation,
                        centeredY = true
                    )
                }

                BodyAnchorPoint.WAIST -> {
                    val waistSpan = max(shoulderSpan * 0.68f, abs(scan.rightWaist.x - scan.leftWaist.x)) * 1.18f
                    val targetW = waistSpan * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat()) * layer.lengthScale.coerceIn(0.70f, 1.45f)
                    val px = (scan.leftWaist.x + scan.rightWaist.x) * 0.5f + layer.offsetX
                    val py = (scan.leftWaist.y + scan.rightWaist.y) * 0.5f + layer.offsetY - targetH * 0.12f
                    drawScaledRotatedBitmap(
                        canvas = canvas,
                        bmp = bmp,
                        x = px,
                        y = py,
                        targetW = targetW,
                        targetH = targetH,
                        rotationDeg = scan.torsoTiltDeg + layer.rotation,
                        centeredY = false,
                        filter = ambientFilter
                    )
                }
            }
        }

        val hasGarmentOrNecklace = layers.any { layer ->
            layer.visible && assetsMap[layer.assetId]?.anchorPoint in setOf(
                BodyAnchorPoint.SHOULDERS,
                BodyAnchorPoint.NECK,
                BodyAnchorPoint.WAIST
            )
        }
        if (hasGarmentOrNecklace) {
            val cachedMatte = synchronized(matteCacheLock) {
                cachedPersonMattes[System.identityHashCode(targetBitmap)]?.takeIf { !it.isRecycled }
            }
            if (cachedMatte != null) {
                restoreBodyForegroundOcclusion(
                    canvas = canvas,
                    targetBitmap = targetBitmap,
                    matteBitmap = cachedMatte,
                    scan = scan
                )
            }
        }

        if (showScanHud) {
            drawBodyScanOverlay(canvas, scan)
        }

        return output
    }

    private fun restoreBodyForegroundOcclusion(
        canvas: Canvas,
        targetBitmap: Bitmap,
        matteBitmap: Bitmap,
        scan: BodyScanResult
    ) {
        val bw = targetBitmap.width
        val bh = targetBitmap.height
        val mw = matteBitmap.width
        val mh = matteBitmap.height
        if (bw < 16 || bh < 16 || mw < 16 || mh < 16) return
        val total = mw * mh

        val smallFrame = bodyOcclFrame?.takeIf { !it.isRecycled && it.width == mw && it.height == mh }
            ?: Bitmap.createBitmap(mw, mh, Bitmap.Config.ARGB_8888).also {
                bodyOcclFrame?.recycle()
                bodyOcclFrame = it
            }
        val occlOverlay = bodyOcclOverlay?.takeIf { !it.isRecycled && it.width == mw && it.height == mh }
            ?: Bitmap.createBitmap(mw, mh, Bitmap.Config.ARGB_8888).also {
                it.setHasAlpha(true)
                bodyOcclOverlay?.recycle()
                bodyOcclOverlay = it
            }

        val smallCanvas = Canvas(smallFrame)
        smallCanvas.drawBitmap(targetBitmap, null, RectF(0f, 0f, mw.toFloat(), mh.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG))

        if (bodyOcclMattePixels.size < total) bodyOcclMattePixels = IntArray(total)
        if (bodyOcclFramePixels.size < total) bodyOcclFramePixels = IntArray(total)
        if (bodyOcclOutPixels.size < total) bodyOcclOutPixels = IntArray(total)

        val mattePx = bodyOcclMattePixels
        val framePx = bodyOcclFramePixels
        val outPx = bodyOcclOutPixels

        matteBitmap.getPixels(mattePx, 0, mw, 0, 0, mw, mh)
        smallFrame.getPixels(framePx, 0, mw, 0, 0, mw, mh)

        val sx = mw.toFloat() / bw
        val sy = mh.toFloat() / bh
        val fw = max(24f, scan.faceWidthPx)
        val fh = fw * 1.25f

        val (sr, sg, sb) = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(
            targetBitmap,
            scan.nose.x.toInt().coerceIn(4, bw - 5),
            (scan.eyeMid.y + fh * 0.22f).toInt().coerceIn(4, bh - 5),
            max(5, (fw * 0.16f).toInt()),
            max(5, (fh * 0.12f).toInt())
        )
        val skinLum = 0.299f * sr + 0.587f * sg + 0.114f * sb
        val skinRG = sr - sg
        val skinRB = sr - sb

        val (hr, hg, hb) = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(
            targetBitmap,
            (scan.eyeMid.x - fw * 0.26f).toInt().coerceIn(4, bw - 5),
            (scan.eyeMid.y - fh * 0.42f).toInt().coerceIn(4, bh - 5),
            max(4, (fw * 0.12f).toInt()),
            max(4, (fh * 0.08f).toInt())
        )
        val hairLum = 0.299f * hr + 0.587f * hg + 0.114f * hb
        val hasDistinctHair = abs(hairLum - skinLum) > 22f

        val collarMinX = ((scan.throat.x - fw * 0.72f) * sx).toInt().coerceIn(0, mw - 1)
        val collarMaxX = ((scan.throat.x + fw * 0.72f) * sx).toInt().coerceIn(collarMinX, mw - 1)
        val collarMinY = ((scan.throat.y - fh * 0.14f) * sy).toInt().coerceIn(0, mh - 1)
        val collarMaxY = ((scan.throat.y + fh * 0.56f) * sy).toInt().coerceIn(collarMinY, mh - 1)

        val lwX = scan.leftWrist.x * sx
        val lwY = scan.leftWrist.y * sy
        val leX = scan.leftElbow.x * sx
        val leY = scan.leftElbow.y * sy
        val lTipX = lwX + (lwX - leX) * 0.34f
        val lTipY = lwY + (lwY - leY) * 0.34f

        val rwX = scan.rightWrist.x * sx
        val rwY = scan.rightWrist.y * sy
        val reX = scan.rightElbow.x * sx
        val reY = scan.rightElbow.y * sy
        val rTipX = rwX + (rwX - reX) * 0.34f
        val rTipY = rwY + (rwY - reY) * 0.34f

        val handRadius = max(5f, fw * sx * 0.44f)
        val handRadiusSq = handRadius * handRadius
        val checkHands = scan.hasWrists && scan.hasSkeletonPose

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

        var restored = 0
        for (i in 0 until total) outPx[i] = 0

        for (y in 0 until mh) {
            val rowOff = y * mw
            val inCollarY = y in collarMinY..collarMaxY
            for (x in 0 until mw) {
                val idx = rowOff + x
                val ma = Color.alpha(mattePx[idx])
                if (ma < 120) continue

                val inHandZone = if (checkHands) {
                    val fx = x.toFloat()
                    val fy = y.toFloat()
                    (distSqToSeg(fx, fy, lwX, lwY, lTipX, lTipY) <= handRadiusSq) ||
                        (distSqToSeg(fx, fy, rwX, rwY, rTipX, rTipY) <= handRadiusSq)
                } else false

                val inCollarHairZone = inCollarY && (x in collarMinX..collarMaxX) && hasDistinctHair
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
                    restored++
                }
            }
        }

        if (restored > 6) {
            occlOverlay.setPixels(outPx, 0, mw, 0, 0, mw, mh)
            canvas.drawBitmap(
                occlOverlay,
                null,
                RectF(0f, 0f, bw.toFloat(), bh.toFloat()),
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            )
        }
    }

    private fun drawScaledRotatedBitmap(
        canvas: Canvas,
        bmp: Bitmap,
        x: Float,
        y: Float,
        targetW: Float,
        targetH: Float,
        rotationDeg: Float,
        centeredY: Boolean,
        mirrorX: Boolean = false,
        pivotOffsetY: Float = 0f,
        filter: ColorMatrixColorFilter? = null
    ) {
        val scaled = Bitmap.createScaledBitmap(
            bmp,
            max(8, targetW.toInt()),
            max(8, targetH.toInt()),
            true
        )
        canvas.save()
        if (!centeredY && pivotOffsetY != 0f) {
            canvas.translate(x, y + pivotOffsetY)
            canvas.rotate(rotationDeg)
            if (mirrorX) canvas.scale(-1f, 1f)
            canvas.drawBitmap(
                scaled,
                -targetW * 0.5f,
                -pivotOffsetY,
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { colorFilter = filter }
            )
        } else {
            canvas.translate(x, y)
            canvas.rotate(rotationDeg)
            if (mirrorX) canvas.scale(-1f, 1f)
            val top = if (centeredY) -targetH * 0.5f else 0f
            canvas.drawBitmap(
                scaled,
                -targetW * 0.5f,
                top,
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { colorFilter = filter }
            )
        }
        canvas.restore()
        if (scaled !== bmp) scaled.recycle()
    }

    private fun drawBodyScanOverlay(canvas: Canvas, scan: BodyScanResult) {
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (scan.hasSkeletonPose) Color.argb(215, 34, 211, 238) else Color.argb(190, 56, 189, 248)
            strokeWidth = 3f
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
        }
        val armPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(185, 129, 140, 248)
            strokeWidth = 2.6f
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
        }
        val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(16, 185, 129)
            style = Paint.Style.FILL
        }

        // Shoulder, sternum, waist box
        canvas.drawLine(scan.leftShoulder.x, scan.leftShoulder.y, scan.rightShoulder.x, scan.rightShoulder.y, linePaint)
        canvas.drawLine(scan.throat.x, scan.throat.y, scan.sternum.x, scan.sternum.y, linePaint)
        canvas.drawLine(scan.leftWaist.x, scan.leftWaist.y, scan.rightWaist.x, scan.rightWaist.y, linePaint)
        canvas.drawLine(scan.leftShoulder.x, scan.leftShoulder.y, scan.leftWaist.x, scan.leftWaist.y, linePaint)
        canvas.drawLine(scan.rightShoulder.x, scan.rightShoulder.y, scan.rightWaist.x, scan.rightWaist.y, linePaint)

        // Hip belt when detected
        if (scan.hasHips) {
            val hipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(200, 16, 185, 129)
                strokeWidth = 2.8f
                style = Paint.Style.STROKE
            }
            canvas.drawLine(scan.leftHip.x, scan.leftHip.y, scan.rightHip.x, scan.rightHip.y, hipPaint)
            canvas.drawCircle(scan.leftHip.x, scan.leftHip.y, 7f, dotPaint)
            canvas.drawCircle(scan.rightHip.x, scan.rightHip.y, 7f, dotPaint)
        }

        // Arms & wrists
        if (scan.hasSkeletonPose) {
            canvas.drawLine(scan.leftShoulder.x, scan.leftShoulder.y, scan.leftElbow.x, scan.leftElbow.y, armPaint)
            canvas.drawLine(scan.leftElbow.x, scan.leftElbow.y, scan.leftWrist.x, scan.leftWrist.y, armPaint)
            canvas.drawLine(scan.rightShoulder.x, scan.rightShoulder.y, scan.rightElbow.x, scan.rightElbow.y, armPaint)
            canvas.drawLine(scan.rightElbow.x, scan.rightElbow.y, scan.rightWrist.x, scan.rightWrist.y, armPaint)
        }

        listOf(
            scan.eyeMid, scan.throat, scan.leftShoulder, scan.rightShoulder,
            scan.sternum, scan.leftWaist, scan.rightWaist, scan.leftWrist, scan.rightWrist
        ).forEach { pt ->
            canvas.drawCircle(pt.x, pt.y, 7f, dotPaint)
        }
    }
}
