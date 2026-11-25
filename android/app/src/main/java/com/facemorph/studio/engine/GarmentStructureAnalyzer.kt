package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Color
import java.util.Collections
import kotlin.math.max
import kotlin.math.min

data class GarmentStructureMetrics(
    val shoulderSeamV: Float,
    val shoulderWidthRatio: Float,
    val collarDipV: Float
)

/**
 * Automatically inspects a transparent garment bitmap (blazer, kimono, shirt, jacket, or custom scan)
 * to locate its anatomical shoulder seams (rather than the top edge of its back collar) and sleeve overhang.
 * Results are cached per bitmap instance for zero-cost per-frame Live AR fitting.
 */
object GarmentStructureAnalyzer {

    private val cache = Collections.synchronizedMap(
        object : LinkedHashMap<Long, GarmentStructureMetrics>(32, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, GarmentStructureMetrics>?): Boolean {
                return size > 48
            }
        }
    )

    fun analyze(bitmap: Bitmap): GarmentStructureMetrics {
        val w = bitmap.width
        val h = bitmap.height
        if (w < 16 || h < 16) {
            return GarmentStructureMetrics(shoulderSeamV = 0.14f, shoulderWidthRatio = 0.80f, collarDipV = 0.08f)
        }

        val key = (System.identityHashCode(bitmap).toLong() shl 32) xor ((w.toLong() shl 16) or h.toLong())
        cache[key]?.let { return it }

        val sampleStepY = max(1, h / 64)
        val sampleStepX = max(1, w / 64)
        val rowWidths = ArrayList<Pair<Float, Float>>(64)
        var maxUpperWidth = 0f

        val upperLimitY = (h * 0.56f).toInt().coerceIn(8, h)
        for (y in 0 until upperLimitY step sampleStepY) {
            var leftX = -1
            var rightX = -1
            for (x in 0 until w step sampleStepX) {
                if (Color.alpha(bitmap.getPixel(x, y)) > 65) {
                    if (leftX < 0) leftX = x
                    rightX = x
                }
            }
            val spanNorm = if (leftX >= 0 && rightX > leftX) (rightX - leftX).toFloat() / w else 0f
            val v = y.toFloat() / h
            rowWidths.add(v to spanNorm)
            if (spanNorm > maxUpperWidth) maxUpperWidth = spanNorm
        }

        if (maxUpperWidth < 0.15f || rowWidths.isEmpty()) {
            val fallback = GarmentStructureMetrics(0.14f, 0.80f, 0.08f)
            cache[key] = fallback
            return fallback
        }

        // Shoulder corner inflection sits where silhouette widens from collar (~30%) out to ~80% of full upper sleeve span
        val shoulderThresh = maxUpperWidth * 0.80f
        var detectedSeamV = 0.14f
        var widthAtSeam = 0.88f
        for ((v, spanNorm) in rowWidths) {
            if (v >= 0.03f && spanNorm >= shoulderThresh) {
                detectedSeamV = v.coerceIn(0.05f, 0.25f)
                widthAtSeam = (spanNorm / maxUpperWidth).coerceIn(0.78f, 0.98f)
                break
            }
        }

        // Check center neckline opening depth in [0.44..0.56] u
        val cx0 = (w * 0.45f).toInt().coerceIn(0, w - 1)
        val cx1 = (w * 0.55f).toInt().coerceIn(cx0, w - 1)
        var collarTopV = 0.02f
        for (y in 0 until upperLimitY step sampleStepY) {
            var hits = 0
            for (x in cx0..cx1 step max(1, (cx1 - cx0) / 4)) {
                if (Color.alpha(bitmap.getPixel(x, y)) > 65) hits++
            }
            if (hits >= 2) {
                collarTopV = (y.toFloat() / h).coerceIn(0f, 0.20f)
                break
            }
        }

        val metrics = GarmentStructureMetrics(
            shoulderSeamV = detectedSeamV,
            shoulderWidthRatio = min(0.98f, max(0.78f, widthAtSeam)),
            collarDipV = collarTopV
        )
        cache[key] = metrics
        return metrics
    }
}
