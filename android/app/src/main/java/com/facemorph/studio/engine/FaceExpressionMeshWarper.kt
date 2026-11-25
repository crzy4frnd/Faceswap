package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import com.facemorph.studio.model.DetectedFaceData
import com.facemorph.studio.model.ExpressionAlignMode
import com.facemorph.studio.model.Point2D
import com.facemorph.studio.model.SourceFaceMetrics
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Anchored 2D Mesh Expression Warper & Inner-Mouth Preserver.
 *
 * - LOCK_EDGE: Pins all outer rim vertices (rNorm >= 0.78f) at zero displacement so jawline,
 *   temples, beard, and cutout boundaries stay 100% locked to the target face edge while
 *   smoothly adapting mouth width, smile curve, mouth openness, and brow arch inside the T-zone.
 * - CONTOUR_CAGE: Smoothly guides outer contour vertices toward the target's detected face oval
 *   (clamped ±18%) in addition to interior expression matching.
 */
object FaceExpressionMeshWarper {

    private const val GRID_X = 12
    private const val GRID_Y = 14
    private const val LUT_BINS = 144

    fun warpPatchForExpression(
        patch: Bitmap,
        donorMetrics: SourceFaceMetrics,
        targetFace: DetectedFaceData,
        targetEyeMidX: Float,
        targetEyeMidY: Float,
        targetEyeDist: Float,
        swapMatrix: Matrix,
        mode: ExpressionAlignMode,
        strength: Float
    ): Bitmap {
        val w = patch.width
        val h = patch.height
        val s = strength.coerceIn(0f, 1f)
        if (w < 20 || h < 24 || s < 0.02f) return patch

        val invMatrix = Matrix()
        val hasInv = swapMatrix.invert(invMatrix)

        // 1) Measure target mouth & brow metrics in patch-normalized space [0..1]
        val lipPts = targetFace.upperLipContour + targetFace.lowerLipContour
        val targetMouthWidthRatio: Float
        val targetMouthOpenRatio: Float
        val targetMouthCenterY: Float

        if (hasInv && lipPts.size >= 6) {
            val mapped = FloatArray(lipPts.size * 2)
            for (i in lipPts.indices) {
                mapped[i * 2] = lipPts[i].x
                mapped[i * 2 + 1] = lipPts[i].y
            }
            invMatrix.mapPoints(mapped)
            var minX = Float.MAX_VALUE
            var maxX = -Float.MAX_VALUE
            var minY = Float.MAX_VALUE
            var maxY = -Float.MAX_VALUE
            for (i in lipPts.indices) {
                val nx = mapped[i * 2] / w
                val ny = mapped[i * 2 + 1] / h
                if (nx < minX) minX = nx
                if (nx > maxX) maxX = nx
                if (ny < minY) minY = ny
                if (ny > maxY) maxY = ny
            }
            targetMouthWidthRatio = (maxX - minX).coerceIn(0.22f, 0.56f)
            targetMouthCenterY = ((minY + maxY) * 0.5f).coerceIn(0.56f, 0.88f)

            val inner = targetFace.innerMouthContour
            targetMouthOpenRatio = if (inner.size >= 4) {
                val innerMapped = FloatArray(inner.size * 2)
                for (i in inner.indices) {
                    innerMapped[i * 2] = inner[i].x
                    innerMapped[i * 2 + 1] = inner[i].y
                }
                invMatrix.mapPoints(innerMapped)
                var iMinY = Float.MAX_VALUE
                var iMaxY = -Float.MAX_VALUE
                for (i in inner.indices) {
                    val iy = innerMapped[i * 2 + 1] / h
                    if (iy < iMinY) iMinY = iy
                    if (iy > iMaxY) iMaxY = iy
                }
                (iMaxY - iMinY).coerceIn(0.01f, 0.20f)
            } else {
                ((maxY - minY) * 0.35f).coerceIn(0.02f, 0.14f)
            }
        } else {
            val lipPt = floatArrayOf(targetFace.landmarks.lips.x, targetFace.landmarks.lips.y)
            if (hasInv) invMatrix.mapPoints(lipPt)
            targetMouthWidthRatio = donorMetrics.mouthWidthRatio
            targetMouthOpenRatio = donorMetrics.mouthOpenRatio
            targetMouthCenterY = (lipPt[1] / h).coerceIn(0.58f, 0.88f)
        }

        val targetBrowPts = targetFace.leftBrowTop + targetFace.rightBrowTop
        val targetBrowYRatio = if (hasInv && targetBrowPts.isNotEmpty()) {
            val bMapped = FloatArray(targetBrowPts.size * 2)
            for (i in targetBrowPts.indices) {
                bMapped[i * 2] = targetBrowPts[i].x
                bMapped[i * 2 + 1] = targetBrowPts[i].y
            }
            invMatrix.mapPoints(bMapped)
            var sumY = 0f
            for (i in targetBrowPts.indices) {
                sumY += bMapped[i * 2 + 1] / h
            }
            (sumY / targetBrowPts.size).coerceIn(0.14f, 0.42f)
        } else {
            donorMetrics.browHeightRatio
        }

        // 2) Compute smooth clamped expression deltas
        val mouthWidthScale = (targetMouthWidthRatio / max(0.20f, donorMetrics.mouthWidthRatio))
            .coerceIn(0.84f, 1.20f)
        val smileDelta = (targetFace.smileScore - donorMetrics.smileScore).coerceIn(-0.9f, 0.9f)
        val mouthOpenDelta = (targetMouthOpenRatio - donorMetrics.mouthOpenRatio).coerceIn(-0.10f, 0.12f)
        val mouthShiftY = (targetMouthCenterY - donorMetrics.mouthYRatio).coerceIn(-0.045f, 0.045f)
        val browShiftY = (targetBrowYRatio - donorMetrics.browHeightRatio).coerceIn(-0.036f, 0.036f)

        // 3) Build normalized radial LUTs for contour locking / cage warping
        val donorRadLut = buildNormContourLut(donorMetrics.contourNorm, 0.50f, 0.52f)
        val targetRadLut = if (mode == ExpressionAlignMode.CONTOUR_CAGE && hasInv && targetFace.faceContour.size >= 12) {
            val tMapped = FloatArray(targetFace.faceContour.size * 2)
            for (i in targetFace.faceContour.indices) {
                tMapped[i * 2] = targetFace.faceContour[i].x
                tMapped[i * 2 + 1] = targetFace.faceContour[i].y
            }
            invMatrix.mapPoints(tMapped)
            val normTargetContour = ArrayList<Point2D>(targetFace.faceContour.size)
            for (i in targetFace.faceContour.indices) {
                normTargetContour.add(
                    Point2D(
                        x = (tMapped[i * 2] / w).coerceIn(-0.15f, 1.15f),
                        y = (tMapped[i * 2 + 1] / h).coerceIn(-0.15f, 1.15f)
                    )
                )
            }
            buildNormContourLut(normTargetContour, 0.50f, 0.52f)
        } else {
            null
        }

        val cx = donorMetrics.eyeMidXRatio.coerceIn(0.36f, 0.64f)
        val cy = 0.52f
        val mouthX = cx
        val mouthY = donorMetrics.mouthYRatio.coerceIn(0.60f, 0.84f)
        val mouthHalfW = max(0.14f, donorMetrics.mouthWidthRatio * 0.56f)
        val browY = donorMetrics.browHeightRatio.coerceIn(0.16f, 0.40f)

        val verts = FloatArray((GRID_X + 1) * (GRID_Y + 1) * 2)
        var vIdx = 0

        for (gy in 0..GRID_Y) {
            val v = gy.toFloat() / GRID_Y
            for (gx in 0..GRID_X) {
                val u = gx.toFloat() / GRID_X

                val relX = u - cx
                val relY = v - cy
                var angDeg = Math.toDegrees(atan2(relY.toDouble(), relX.toDouble())).toFloat()
                if (angDeg < 0f) angDeg += 360f
                val bin = ((angDeg / 360f) * LUT_BINS).toInt().coerceIn(0, LUT_BINS - 1)

                val radialDist = hypot(relX.toDouble(), relY.toDouble()).toFloat()
                val donorMaxR = donorRadLut?.get(bin) ?: ellipseRadius(relX, relY)
                val rNorm = radialDist / max(0.20f, donorMaxR)

                // Zero-boundary edge pin: guarantees rNorm >= 0.78f stays 100% pinned in LOCK_EDGE mode
                val edgePinWeight = 1f - smoothstep(0.50f, 0.78f, rNorm)

                var du = 0f
                var dv = 0f

                // Outer face oval contour adaptation (only active in CONTOUR_CAGE mode)
                if (mode == ExpressionAlignMode.CONTOUR_CAGE && targetRadLut != null && rNorm > 0.32f) {
                    val targetMaxR = targetRadLut[bin]
                    val ratio = (targetMaxR / max(0.20f, donorMaxR)).coerceIn(0.82f, 1.18f)
                    val cageT = smoothstep(0.32f, 0.84f, rNorm) * (1f - smoothstep(0.92f, 1.06f, rNorm)) * s
                    val radialScaleDelta = (ratio - 1f) * cageT
                    du += relX * radialScaleDelta
                    dv += relY * radialScaleDelta
                }

                // Interior Mouth Expression Warp (width, smile corner lift, openness, vertical offset)
                val mdx = u - mouthX
                val mdy = v - mouthY
                val mouthDistSq = (mdx * mdx) / (0.28f * 0.28f) + (mdy * mdy) / (0.14f * 0.14f)
                if (mouthDistSq < 4.5f) {
                    val mouthWeight = exp(-mouthDistSq.toDouble()).toFloat() * s *
                        if (mode == ExpressionAlignMode.LOCK_EDGE) edgePinWeight else 1f

                    // Widen/narrow mouth horizontally
                    du += mdx * (mouthWidthScale - 1f) * mouthWeight

                    // Smile corner curve (strongest near mouth corners |mdx| ~ mouthHalfW)
                    val cornerT = (abs(mdx) / mouthHalfW).coerceIn(0f, 1.35f)
                    val cornerCurve = cornerT * cornerT * exp(-((cornerT - 1f) * (cornerT - 1f)).toDouble()).toFloat()
                    dv += -smileDelta * 0.032f * cornerCurve * mouthWeight

                    // Vertical lip openness around mouth center + slight vertical mouth position shift
                    dv += (mdy * mouthOpenDelta * 4.2f + mouthShiftY) * mouthWeight
                }

                // Interior Eyebrow Arch Alignment (left & right brows, avoiding eye globes directly)
                val bdx = abs(u - cx)
                val bdy = v - browY
                val browDistSq = ((bdx - 0.16f) * (bdx - 0.16f)) / (0.18f * 0.18f) + (bdy * bdy) / (0.08f * 0.08f)
                if (browDistSq < 4.0f) {
                    val browWeight = exp(-browDistSq.toDouble()).toFloat() * s *
                        if (mode == ExpressionAlignMode.LOCK_EDGE) edgePinWeight else 1f
                    dv += browShiftY * browWeight
                }

                val outX = ((u + du).coerceIn(0f, 1f)) * w
                val outY = ((v + dv).coerceIn(0f, 1f)) * h
                verts[vIdx++] = outX
                verts[vIdx++] = outY
            }
        }

        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply {
            setHasAlpha(true)
        }
        val canvas = Canvas(out)
        val meshPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmapMesh(patch, GRID_X, GRID_Y, verts, 0, null, 0, meshPaint)
        return out
    }

    /**
     * Softly punches out the target's inner mouth cavity (teeth & shadow) on open smiles
     * so target's real teeth remain sharp while outer lips & cheeks come from the donor.
     */
    fun applyKeepMouthInteriorMask(
        swapCanvas: Canvas,
        face: DetectedFaceData,
        targetEyeDist: Float,
        alpha: Int
    ) {
        if (alpha <= 10) return
        val inner = face.innerMouthContour
        val blurRadius = max(2.2f, targetEyeDist * 0.042f)
        val punchPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT)
            this.alpha = alpha
            maskFilter = BlurMaskFilter(blurRadius, BlurMaskFilter.Blur.NORMAL)
        }

        if (inner.size >= 6) {
            var cx = 0f
            var cy = 0f
            for (pt in inner) {
                cx += pt.x
                cy += pt.y
            }
            cx /= inner.size
            cy /= inner.size

            // Verify the mouth is genuinely parted vertically (>= 2.5px) before punching
            val minY = inner.minOf { it.y }
            val maxY = inner.maxOf { it.y }
            if (maxY - minY < max(2.5f, targetEyeDist * 0.035f)) return

            val path = Path()
            for (i in inner.indices) {
                // Shrink slightly inward (92%) so donor lip outline stays clean
                val px = cx + (inner[i].x - cx) * 0.92f
                val py = cy + (inner[i].y - cy) * 0.90f
                if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
            }
            path.close()
            swapCanvas.drawPath(path, punchPaint)
        } else {
            // Fallback inner-mouth oval if contour was unavailable
            val lm = face.landmarks
            val mx = lm.lips.x
            val my = lm.lips.y
            val rx = max(5f, targetEyeDist * 0.18f)
            val ry = max(2.5f, targetEyeDist * 0.065f)
            val dx = lm.rightEye.x - lm.leftEye.x
            val dy = lm.rightEye.y - lm.leftEye.y
            val deg = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
            val sc = swapCanvas.save()
            swapCanvas.translate(mx, my)
            swapCanvas.rotate(deg)
            swapCanvas.drawOval(-rx, -ry, rx, ry, punchPaint)
            swapCanvas.restoreToCount(sc)
        }
    }

    private fun smoothstep(edge0: Float, edge1: Float, x: Float): Float {
        val t = ((x - edge0) / max(1e-4f, edge1 - edge0)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    private fun ellipseRadius(relX: Float, relY: Float): Float {
        val ang = atan2(relY.toDouble(), relX.toDouble())
        val cx = 0.46f * cos(ang).toFloat()
        val cy = 0.47f * sin(ang).toFloat()
        return hypot(cx.toDouble(), cy.toDouble()).toFloat().coerceAtLeast(0.24f)
    }

    private fun buildNormContourLut(
        contourNorm: List<Point2D>,
        centerX: Float,
        centerY: Float
    ): FloatArray? {
        if (contourNorm.size < 12) return null
        val angles = FloatArray(contourNorm.size)
        val radii = FloatArray(contourNorm.size)
        for (i in contourNorm.indices) {
            val dx = contourNorm[i].x - centerX
            val dy = contourNorm[i].y - centerY
            var ang = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
            if (ang < 0f) ang += 360f
            angles[i] = ang
            radii[i] = hypot(dx.toDouble(), dy.toDouble()).toFloat().coerceIn(0.18f, 0.72f)
        }

        val lut = FloatArray(LUT_BINS)
        for (b in 0 until LUT_BINS) {
            val binAng = (b.toFloat() / LUT_BINS) * 360f
            var best1D = 999f
            var best1R = 0.44f
            var best2D = 999f
            var best2R = 0.44f
            for (i in angles.indices) {
                var diff = abs(angles[i] - binAng)
                if (diff > 180f) diff = 360f - diff
                if (diff < best1D) {
                    best2D = best1D
                    best2R = best1R
                    best1D = diff
                    best1R = radii[i]
                } else if (diff < best2D) {
                    best2D = diff
                    best2R = radii[i]
                }
            }
            val w1 = 1f / max(0.5f, best1D)
            val w2 = 1f / max(0.5f, best2D)
            lut[b] = (best1R * w1 + best2R * w2) / (w1 + w2)
        }
        return lut
    }
}
