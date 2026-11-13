package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.max
import kotlin.math.min

object NativeAssetSegmenter {

    /**
     * Removes uniform or studio backgrounds from captured/gallery clothes & jewelry bitmaps
     * on-device, applies soft edge alpha feathering, and crops tightly to foreground bounds.
     */
    fun extractTransparentAsset(source: Bitmap, tolerance: Int = 35): Bitmap {
        val maxSide = 720
        val scale = if (source.width > maxSide || source.height > maxSide) {
            min(maxSide.toFloat() / source.width, maxSide.toFloat() / source.height)
        } else 1f

        val w = max(20, (source.width * scale).toInt())
        val h = max(20, (source.height * scale).toInt())
        val work = Bitmap.createScaledBitmap(source, w, h, true).copy(Bitmap.Config.ARGB_8888, true)

        val pixels = IntArray(w * h)
        work.getPixels(pixels, 0, w, 0, 0, w, h)

        // Sample corners & edges for dominant background color
        val sampleCoords = listOf(
            3 to 3,
            (w - 4) to 3,
            3 to (h - 4),
            (w - 4) to (h - 4),
            (w / 2) to 3,
            3 to (h / 2),
            (w - 4) to (h / 2)
        )
        var rSum = 0
        var gSum = 0
        var bSum = 0
        var count = 0
        for ((sx, sy) in sampleCoords) {
            if (sx in 0 until w && sy in 0 until h) {
                val c = pixels[sy * w + sx]
                rSum += Color.red(c)
                gSum += Color.green(c)
                bSum += Color.blue(c)
                count++
            }
        }
        val bgR = rSum / max(1, count)
        val bgG = gSum / max(1, count)
        val bgB = bSum / max(1, count)

        val threshold = tolerance * 2.5f
        val thresholdSq = threshold * threshold

        var minX = w
        var minY = h
        var maxX = 0
        var maxY = 0

        for (y in 0 until h) {
            val rowOffset = y * w
            for (x in 0 until w) {
                val idx = rowOffset + x
                val c = pixels[idx]
                val a = Color.alpha(c)
                if (a < 10) continue

                val dr = Color.red(c) - bgR
                val dg = Color.green(c) - bgG
                val db = Color.blue(c) - bgB
                val distSq = (dr * dr + dg * dg + db * db).toFloat()

                if (distSq < thresholdSq) {
                    val ratio = distSq / thresholdSq
                    val newAlpha = if (ratio < 0.65f) {
                        0
                    } else {
                        ((ratio - 0.65f) / 0.35f * 255f).toInt().coerceIn(0, 255)
                    }
                    pixels[idx] = Color.argb(newAlpha, Color.red(c), Color.green(c), Color.blue(c))
                } else {
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                }
            }
        }

        work.setPixels(pixels, 0, w, 0, 0, w, h)

        return if (maxX > minX + 16 && maxY > minY + 16) {
            val pad = 10
            val cropX = max(0, minX - pad)
            val cropY = max(0, minY - pad)
            val cropW = min(w - cropX, (maxX - minX) + pad * 2)
            val cropH = min(h - cropY, (maxY - minY) + pad * 2)
            Bitmap.createBitmap(work, cropX, cropY, cropW, cropH)
        } else {
            work
        }
    }
}
