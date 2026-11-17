package com.facemorph.studio.engine

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.RectF
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

data class RawDetectedFaceGeometry(
    val boundingBox: RectF?,
    val leftEye: PointF?,
    val rightEye: PointF?,
    val noseBase: PointF?,
    val leftCheek: PointF?,
    val rightCheek: PointF?,
    val mouthLeft: PointF?,
    val mouthRight: PointF?,
    val mouthBottom: PointF?,
    val yawDeg: Float,
    val pitchDeg: Float,
    val rollDeg: Float
)

/**
 * Renders a real-time parametric 3D face wireframe mesh projected via stabilized Euler orientation
 * (Yaw * Pitch * Roll + perspective division) directly over raw ML Kit facial geometry landmarks
 * and optional face-swap/torso alignment cues. Purely visual geometry with zero HUD text clutter.
 */
object FaceMeshWireframeRenderer {

    private data class MeshVertex3D(val x: Float, val y: Float, val z: Float)

    // Canonical 28-vertex anatomical 3D facial topology normalized around inter-eye midpoint (0, 0, 0),
    // where inter-eye span = 1.0 (+X right, +Y down, +Z forward toward camera).
    private val MESH_VERTICES = arrayOf(
        // 0..9 Outer cranial-to-chin contour ring
        MeshVertex3D(0.00f, -0.82f, 0.02f),   // 0: Forehead top
        MeshVertex3D(0.68f, -0.62f, -0.06f),  // 1: Right temple
        MeshVertex3D(0.86f, -0.08f, -0.14f),  // 2: Right outer cheekbone
        MeshVertex3D(0.72f, 0.46f, -0.12f),   // 3: Right jaw angle
        MeshVertex3D(0.36f, 0.86f, 0.05f),    // 4: Right chin wing
        MeshVertex3D(0.00f, 1.00f, 0.14f),    // 5: Chin tip
        MeshVertex3D(-0.36f, 0.86f, 0.05f),   // 6: Left chin wing
        MeshVertex3D(-0.72f, 0.46f, -0.12f),  // 7: Left jaw angle
        MeshVertex3D(-0.86f, -0.08f, -0.14f), // 8: Left outer cheekbone
        MeshVertex3D(-0.68f, -0.62f, -0.06f), // 9: Left temple

        // 10..18 Brow arch, eye centers, and zygomatic cheeks
        MeshVertex3D(0.00f, -0.22f, 0.22f),   // 10: Glabella (brow bridge)
        MeshVertex3D(-0.66f, -0.24f, 0.06f),  // 11: Left outer brow
        MeshVertex3D(-0.36f, -0.28f, 0.16f),  // 12: Left brow arch
        MeshVertex3D(0.36f, -0.28f, 0.16f),   // 13: Right brow arch
        MeshVertex3D(0.66f, -0.24f, 0.06f),   // 14: Right outer brow
        MeshVertex3D(-0.50f, 0.00f, 0.06f),   // 15: Left eye center
        MeshVertex3D(0.50f, 0.00f, 0.06f),    // 16: Right eye center
        MeshVertex3D(-0.54f, 0.28f, 0.14f),   // 17: Left zygomatic cheek
        MeshVertex3D(0.54f, 0.28f, 0.14f),    // 18: Right zygomatic cheek

        // 19..23 3D Nasal pyramid
        MeshVertex3D(0.00f, -0.02f, 0.24f),   // 19: Nasal bridge
        MeshVertex3D(0.00f, 0.26f, 0.48f),    // 20: Nose tip (peak +Z protrusion)
        MeshVertex3D(-0.19f, 0.34f, 0.24f),   // 21: Left alar wing
        MeshVertex3D(0.19f, 0.34f, 0.24f),    // 22: Right alar wing
        MeshVertex3D(0.00f, 0.38f, 0.27f),    // 23: Subnasale (ML Kit NOSE_BASE target)

        // 24..27 Mouth / lip loop
        MeshVertex3D(0.00f, 0.56f, 0.28f),    // 24: Upper lip bow
        MeshVertex3D(-0.34f, 0.62f, 0.14f),   // 25: Left mouth corner
        MeshVertex3D(0.34f, 0.62f, 0.14f),    // 26: Right mouth corner
        MeshVertex3D(0.00f, 0.74f, 0.25f)     // 27: Lower lip center
    )

    // Triangulated geodesic wireframe edges connecting anatomical landmarks
    private val MESH_EDGES = arrayOf(
        // Outer contour loop
        0 to 1, 1 to 2, 2 to 3, 3 to 4, 4 to 5,
        5 to 6, 6 to 7, 7 to 8, 8 to 9, 9 to 0,

        // Forehead & brow fans
        0 to 10, 0 to 12, 0 to 13, 9 to 12, 1 to 13,
        9 to 11, 1 to 14, 11 to 12, 12 to 10, 10 to 13, 13 to 14,

        // Eye sockets & orbital triangulation
        11 to 15, 12 to 15, 10 to 15, 8 to 15, 17 to 15,
        14 to 16, 13 to 16, 10 to 16, 2 to 16, 18 to 16,
        15 to 19, 16 to 19,

        // 3D Nasal bridge & alar pyramid
        10 to 19, 19 to 20, 20 to 23,
        19 to 21, 19 to 22,
        20 to 21, 20 to 22,
        21 to 23, 22 to 23,
        15 to 21, 16 to 22,
        17 to 21, 18 to 22,

        // Cheek & midface triangulation
        8 to 17, 7 to 17, 17 to 25,
        2 to 18, 3 to 18, 18 to 26,

        // Mouth & jaw convergence
        23 to 24, 21 to 25, 22 to 26,
        24 to 25, 24 to 26, 25 to 27, 26 to 27, 24 to 27,
        25 to 7, 25 to 6, 26 to 3, 26 to 4, 27 to 6, 27 to 4, 27 to 5
    )

    private const val IDX_LEFT_EYE = 15
    private const val IDX_RIGHT_EYE = 16
    private const val IDX_LEFT_CHEEK = 17
    private const val IDX_RIGHT_CHEEK = 18
    private const val IDX_NOSE_BRIDGE = 19
    private const val IDX_NOSE_BASE = 23
    private const val IDX_MOUTH_LEFT = 25
    private const val IDX_MOUTH_RIGHT = 26
    private const val IDX_MOUTH_BOTTOM = 27

    private class MeshScratch(vertexCount: Int) {
        val px = FloatArray(vertexCount)
        val py = FloatArray(vertexCount)
        val pz = FloatArray(vertexCount)
        val swapSrc = FloatArray(8)
        val swapDst = FloatArray(8)
    }

    private val scratchLocal = object : ThreadLocal<MeshScratch>() {
        override fun initialValue(): MeshScratch = MeshScratch(MESH_VERTICES.size)
    }

    fun render(
        canvas: Canvas,
        smoothFace: StabilizedFacePose,
        rawFace: RawDetectedFaceGeometry?,
        swapTransform: StabilizedFaceSwapTransform?,
        bodyFitState: StabilizedBodyFitState,
        showBodyFitMesh: Boolean
    ) {
        if (smoothFace.trackingConfidence > 0.2f) {
            renderFaceMeshAndAlignment(canvas, smoothFace, rawFace, swapTransform)
        }
        if (showBodyFitMesh || smoothFace.trackingConfidence <= 0.2f) {
            renderBodyTorsoWireframe(canvas, bodyFitState)
        }
    }

    private fun renderFaceMeshAndAlignment(
        canvas: Canvas,
        smoothFace: StabilizedFacePose,
        rawFace: RawDetectedFaceGeometry?,
        swapTransform: StabilizedFaceSwapTransform?
    ) {
        val scratch = scratchLocal.get() ?: MeshScratch(MESH_VERTICES.size)
        val px = scratch.px
        val py = scratch.py
        val pz = scratch.pz

        // 1. Resolve upright screen-consistent roll, yaw sign, and vertical anatomical ratio
        val eyeVecRollDeg = resolveScreenRollDeg(smoothFace.rollDeg, rawFace)
        val rollRad = eyeVecRollDeg * (PI.toFloat() / 180f)

        var yawDeg = smoothFace.yawDeg
        if (rawFace?.noseBase != null && abs(yawDeg) > 4f) {
            val rawEyeMidX = if (rawFace.leftEye != null && rawFace.rightEye != null) {
                (rawFace.leftEye.x + rawFace.rightEye.x) * 0.5f
            } else {
                smoothFace.eyeMidX
            }
            val noseShiftX = rawFace.noseBase.x - rawEyeMidX
            val yawRadCandidate = yawDeg * (PI.toFloat() / 180f)
            // Ensure +Z nasal projection shifts horizontally toward the detected NOSE_BASE landmark
            if (abs(noseShiftX) > 2f && noseShiftX * sin(yawRadCandidate) < 0f) {
                yawDeg = -yawDeg
            }
        }
        val yawRad = yawDeg * (PI.toFloat() / 180f)
        val pitchRad = smoothFace.pitchDeg * (PI.toFloat() / 180f)

        val cosY = cos(yawRad)
        val sinY = sin(yawRad)
        val cosP = cos(pitchRad)
        val sinP = sin(pitchRad)
        val cosR = cos(rollRad)
        val sinR = sin(rollRad)

        // Un-foreshorten 2D eye distance by cos(yaw) because 3D rotation applies yaw foreshortening once
        val baseScalePx = max(18f, smoothFace.eyeDist / max(0.58f, abs(cosY)))
        val aspectHeightScale = ((smoothFace.height / max(18f, baseScalePx)) / 2.08f).coerceIn(0.84f, 1.24f)
        val focalNorm = 3.85f

        for (i in MESH_VERTICES.indices) {
            val v = MESH_VERTICES[i]
            val vx = v.x
            val vy = if (v.y > 0f) v.y * aspectHeightScale else v.y * (0.94f + aspectHeightScale * 0.06f)
            val vz = v.z

            // Yaw around vertical axis (+z nose shifts toward +x on positive yaw)
            val x1 = vx * cosY + vz * sinY
            val y1 = vy
            val z1 = -vx * sinY + vz * cosY

            // Pitch around horizontal axis (looking up raises nose & recesses forehead)
            val x2 = x1
            val y2 = y1 * cosP - z1 * sinP
            val z2 = y1 * sinP + z1 * cosP

            // In-plane roll around camera view axis
            val x3 = x2 * cosR - y2 * sinR
            val y3 = x2 * sinR + y2 * cosR
            val z3 = z2

            val persp = focalNorm / max(1.35f, focalNorm - z3 * 0.85f)
            px[i] = smoothFace.eyeMidX + x3 * baseScalePx * persp
            py[i] = smoothFace.eyeMidY + y3 * baseScalePx * persp
            pz[i] = z3
        }

        // 2. Draw raw ML Kit bounding box reference corners (detected geometry envelope)
        rawFace?.boundingBox?.let { bbox ->
            val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(145, 251, 191, 36)
                style = Paint.Style.STROKE
                strokeWidth = 2.0f
            }
            val bracket = max(10f, minOf(bbox.width(), bbox.height()) * 0.14f)
            // Top-left corner
            canvas.drawLine(bbox.left, bbox.top + bracket, bbox.left, bbox.top, boxPaint)
            canvas.drawLine(bbox.left, bbox.top, bbox.left + bracket, bbox.top, boxPaint)
            // Top-right corner
            canvas.drawLine(bbox.right - bracket, bbox.top, bbox.right, bbox.top, boxPaint)
            canvas.drawLine(bbox.right, bbox.top, bbox.right, bbox.top + bracket, boxPaint)
            // Bottom-left corner
            canvas.drawLine(bbox.left, bbox.bottom - bracket, bbox.left, bbox.bottom, boxPaint)
            canvas.drawLine(bbox.left, bbox.bottom, bbox.left + bracket, bbox.bottom, boxPaint)
            // Bottom-right corner
            canvas.drawLine(bbox.right - bracket, bbox.bottom, bbox.right, bbox.bottom, boxPaint)
            canvas.drawLine(bbox.right, bbox.bottom - bracket, bbox.right, bbox.bottom, boxPaint)
        }

        // 3. Draw optional Face-Swap alignment patch quad when Face Swap is active
        if (swapTransform != null) {
            val pw = swapTransform.patchWidth.toFloat()
            val ph = swapTransform.patchHeight.toFloat()
            val swapSrc = scratch.swapSrc
            val swapDst = scratch.swapDst
            swapSrc[0] = 0f; swapSrc[1] = 0f
            swapSrc[2] = pw; swapSrc[3] = 0f
            swapSrc[4] = pw; swapSrc[5] = ph
            swapSrc[6] = 0f; swapSrc[7] = ph
            swapTransform.matrix.mapPoints(swapDst, swapSrc)

            val swapBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(175, 167, 139, 250)
                style = Paint.Style.STROKE
                strokeWidth = 2.0f
                pathEffect = DashPathEffect(floatArrayOf(10f, 6f), 0f)
            }
            canvas.drawLine(swapDst[0], swapDst[1], swapDst[2], swapDst[3], swapBoxPaint)
            canvas.drawLine(swapDst[2], swapDst[3], swapDst[4], swapDst[5], swapBoxPaint)
            canvas.drawLine(swapDst[4], swapDst[5], swapDst[6], swapDst[7], swapBoxPaint)
            canvas.drawLine(swapDst[6], swapDst[7], swapDst[0], swapDst[1], swapBoxPaint)
        }

        // 4. Draw depth-cued 3D wireframe mesh edges (back-to-front intensity modulation)
        val edgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
        }
        for ((a, b) in MESH_EDGES) {
            val avgZ = (pz[a] + pz[b]) * 0.5f
            val depthNorm = ((avgZ + 0.25f) / 0.70f).coerceIn(0f, 1f)
            val alpha = (92f + depthNorm * 135f).toInt().coerceIn(80, 235)
            val red = (28f + depthNorm * 28f).toInt()
            val green = (170f + depthNorm * 65f).toInt()
            val blue = (215f + depthNorm * 40f).toInt()
            edgePaint.color = Color.argb(alpha, red, green, blue)
            edgePaint.strokeWidth = 1.4f + depthNorm * 1.4f
            canvas.drawLine(px[a], py[a], px[b], py[b], edgePaint)
        }

        // 5. Draw 3D mesh vertices
        val vertexPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
        }
        for (i in MESH_VERTICES.indices) {
            val depthNorm = ((pz[i] + 0.25f) / 0.70f).coerceIn(0f, 1f)
            vertexPaint.color = Color.argb((130f + depthNorm * 120f).toInt(), 56, 230, 248)
            canvas.drawCircle(px[i], py[i], 2.2f + depthNorm * 1.6f, vertexPaint)
        }

        // 6. Draw 3D XYZ local orientation axis triad anchored at the nasal bridge
        drawPoseOrientationTriad(
            canvas = canvas,
            originX = px[IDX_NOSE_BRIDGE],
            originY = py[IDX_NOSE_BRIDGE],
            axisLen = baseScalePx * 0.34f,
            cosY = cosY, sinY = sinY,
            cosP = cosP, sinP = sinP,
            cosR = cosR, sinR = sinR
        )

        // 7. Draw raw ML Kit detected landmark reticles + residual alignment error vectors
        if (rawFace != null) {
            drawAlignmentVerificationVectors(
                canvas = canvas,
                rawFace = rawFace,
                projectedX = px,
                projectedY = py,
                eyeDistPx = max(16f, smoothFace.eyeDist)
            )
        }
    }

    private fun resolveScreenRollDeg(stabilizedRollDeg: Float, rawFace: RawDetectedFaceGeometry?): Float {
        val le = rawFace?.leftEye
        val re = rawFace?.rightEye
        if (le != null && re != null && abs(stabilizedRollDeg) > 90f) {
            // Un-mirror 180 deg flip when back camera swaps subject's left/right eye x ordering
            val leftScreen = if (le.x <= re.x) le else re
            val rightScreen = if (le.x <= re.x) re else le
            return Math.toDegrees(
                atan2((rightScreen.y - leftScreen.y).toDouble(), max(1f, rightScreen.x - leftScreen.x).toDouble())
            ).toFloat()
        }
        return stabilizedRollDeg
    }

    private fun drawPoseOrientationTriad(
        canvas: Canvas,
        originX: Float,
        originY: Float,
        axisLen: Float,
        cosY: Float,
        sinY: Float,
        cosP: Float,
        sinP: Float,
        cosR: Float,
        sinR: Float
    ) {
        fun projectAxisEnd(ax: Float, ay: Float, az: Float): Pair<Float, Float> {
            val x1 = ax * cosY + az * sinY
            val z1 = -ax * sinY + az * cosY
            val y2 = ay * cosP - z1 * sinP
            val x3 = x1 * cosR - y2 * sinR
            val y3 = x1 * sinR + y2 * cosR
            return (originX + x3 * axisLen) to (originY + y3 * axisLen)
        }

        val axisPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3.0f
            strokeCap = Paint.Cap.ROUND
        }
        val (xx, xy) = projectAxisEnd(1f, 0f, 0f)
        axisPaint.color = Color.argb(230, 244, 63, 94) // X axis (coral-red)
        canvas.drawLine(originX, originY, xx, xy, axisPaint)

        val (yx, yy) = projectAxisEnd(0f, -1f, 0f)
        axisPaint.color = Color.argb(230, 16, 185, 129) // Y up axis (emerald)
        canvas.drawLine(originX, originY, yx, yy, axisPaint)

        val (zx, zy) = projectAxisEnd(0f, 0f, 1f)
        axisPaint.color = Color.argb(240, 34, 211, 238) // Z forward axis (cyan)
        canvas.drawLine(originX, originY, zx, zy, axisPaint)
    }

    private fun drawAlignmentVerificationVectors(
        canvas: Canvas,
        rawFace: RawDetectedFaceGeometry,
        projectedX: FloatArray,
        projectedY: FloatArray,
        eyeDistPx: Float
    ) {
        val rawMarkerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(230, 251, 191, 36)
            style = Paint.Style.STROKE
            strokeWidth = 2.0f
        }
        val errorLinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2.2f
            strokeCap = Paint.Cap.ROUND
        }

        fun drawCrosshair(pt: PointF) {
            val r = 5.5f
            canvas.drawCircle(pt.x, pt.y, r, rawMarkerPaint)
            canvas.drawLine(pt.x - r * 1.4f, pt.y, pt.x + r * 1.4f, pt.y, rawMarkerPaint)
            canvas.drawLine(pt.x, pt.y - r * 1.4f, pt.x, pt.y + r * 1.4f, rawMarkerPaint)
        }

        fun verifyPair(meshIdx: Int, detectedPt: PointF?) {
            if (detectedPt == null) return
            drawCrosshair(detectedPt)

            val mx = projectedX[meshIdx]
            val my = projectedY[meshIdx]
            val errRatio = hypot((detectedPt.x - mx).toDouble(), (detectedPt.y - my).toDouble()).toFloat() / eyeDistPx
            errorLinePaint.color = when {
                errRatio < 0.08f -> Color.argb(220, 16, 185, 129)  // Locked emerald
                errRatio < 0.18f -> Color.argb(225, 245, 158, 11)  // Slight drift amber
                else -> Color.argb(235, 244, 63, 94)               // Lag/divergence coral
            }
            canvas.drawLine(mx, my, detectedPt.x, detectedPt.y, errorLinePaint)
        }

        // Order eyes left/right on screen so error vectors never cross under horizontal mirroring
        val rawLe = rawFace.leftEye
        val rawRe = rawFace.rightEye
        val screenRawLeftEye = if (rawLe != null && rawRe != null) (if (rawLe.x <= rawRe.x) rawLe else rawRe) else rawLe
        val screenRawRightEye = if (rawLe != null && rawRe != null) (if (rawLe.x <= rawRe.x) rawRe else rawLe) else rawRe

        val rawLc = rawFace.leftCheek
        val rawRc = rawFace.rightCheek
        val screenRawLeftCheek = if (rawLc != null && rawRc != null) (if (rawLc.x <= rawRc.x) rawLc else rawRc) else rawLc
        val screenRawRightCheek = if (rawLc != null && rawRc != null) (if (rawLc.x <= rawRc.x) rawRc else rawLc) else rawRc

        val rawLm = rawFace.mouthLeft
        val rawRm = rawFace.mouthRight
        val screenRawLeftMouth = if (rawLm != null && rawRm != null) (if (rawLm.x <= rawRm.x) rawLm else rawRm) else rawLm
        val screenRawRightMouth = if (rawLm != null && rawRm != null) (if (rawLm.x <= rawRm.x) rawRm else rawLm) else rawRm

        verifyPair(IDX_LEFT_EYE, screenRawLeftEye)
        verifyPair(IDX_RIGHT_EYE, screenRawRightEye)
        verifyPair(IDX_NOSE_BASE, rawFace.noseBase)
        verifyPair(IDX_LEFT_CHEEK, screenRawLeftCheek)
        verifyPair(IDX_RIGHT_CHEEK, screenRawRightCheek)
        verifyPair(IDX_MOUTH_LEFT, screenRawLeftMouth)
        verifyPair(IDX_MOUTH_RIGHT, screenRawRightMouth)
        verifyPair(IDX_MOUTH_BOTTOM, rawFace.mouthBottom)
    }

    private fun renderBodyTorsoWireframe(
        canvas: Canvas,
        bodyFitState: StabilizedBodyFitState
    ) {
        val torso = bodyFitState.pose
        val torsoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(175, 56, 189, 248)
            style = Paint.Style.STROKE
            strokeWidth = 2.2f
        }
        canvas.drawLine(torso.shoulderLeftX, torso.shoulderLeftY, torso.shoulderRightX, torso.shoulderRightY, torsoPaint)
        canvas.drawLine(torso.leftChestX, torso.chestY, torso.rightChestX, torso.chestY, torsoPaint)
        canvas.drawLine(torso.leftWaistX, torso.waistY, torso.rightWaistX, torso.waistY, torsoPaint)
        canvas.drawLine(torso.shoulderLeftX, torso.shoulderLeftY, torso.leftChestX, torso.chestY, torsoPaint)
        canvas.drawLine(torso.shoulderRightX, torso.shoulderRightY, torso.rightChestX, torso.chestY, torsoPaint)
        canvas.drawLine(torso.leftChestX, torso.chestY, torso.leftWaistX, torso.waistY, torsoPaint)
        canvas.drawLine(torso.rightChestX, torso.chestY, torso.rightWaistX, torso.waistY, torsoPaint)
        canvas.drawCircle(bodyFitState.collarPivotX, bodyFitState.collarPivotY, 5.5f, torsoPaint)
    }
}
