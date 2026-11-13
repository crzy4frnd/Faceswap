package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Color
import java.util.ArrayDeque
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

object NativeAssetSegmenter {

    /**
     * Flood-fill background segmentation starting from all 4 borders.
     * Preserves interior bright details (e.g., white pocket squares, diamonds, collars)
     * while cleanly stripping exterior studio backgrounds with soft alpha feathering.
     * Explicitly enforces ARGB_8888 + setHasAlpha(true) so JPEG sources render transparently.
     */
    fun extractTransparentAsset(source: Bitmap, tolerance: Int = 35): Bitmap {
        val maxSide = 720
        val scale = if (source.width > maxSide || source.height > maxSide) {
            min(maxSide.toFloat() / source.width, maxSide.toFloat() / source.height)
        } else 1f

        val w = max(20, (source.width * scale).toInt())
        val h = max(20, (source.height * scale).toInt())
        val scaled = if (w != source.width || h != source.height) {
            Bitmap.createScaledBitmap(source, w, h, true)
        } else {
            source
        }

        val pixels = IntArray(w * h)
        scaled.getPixels(pixels, 0, w, 0, 0, w, h)
        if (scaled !== source) scaled.recycle()

        // Sample exterior border pixels for dominant studio backdrop color
        val borderCoords = mutableListOf<Pair<Int, Int>>()
        for (x in 0 until w step max(1, w / 10)) {
            borderCoords += x to 1
            borderCoords += x to (h - 2)
        }
        for (y in 0 until h step max(1, h / 10)) {
            borderCoords += 1 to y
            borderCoords += (w - 2) to y
        }

        var rSum = 0L
        var gSum = 0L
        var bSum = 0L
        var count = 0
        for ((sx, sy) in borderCoords) {
            val c = pixels[sy.coerceIn(0, h - 1) * w + sx.coerceIn(0, w - 1)]
            if (Color.alpha(c) > 20) {
                rSum += Color.red(c)
                gSum += Color.green(c)
                bSum += Color.blue(c)
                count++
            }
        }
        val bgR = if (count > 0) (rSum / count).toInt() else 255
        val bgG = if (count > 0) (gSum / count).toInt() else 255
        val bgB = if (count > 0) (bSum / count).toInt() else 255

        val maxDist = max(28f, tolerance * 2.25f)
        val maxDistSq = maxDist * maxDist
        val visited = BooleanArray(w * h)
        val isBackground = BooleanArray(w * h)
        val queue = ArrayDeque<Int>(w * 4)

        fun colorDistSq(c: Int): Float {
            val a = Color.alpha(c)
            if (a < 25) return 0f
            val dr = Color.red(c) - bgR
            val dg = Color.green(c) - bgG
            val db = Color.blue(c) - bgB
            return (dr * dr + dg * dg + db * db).toFloat()
        }

        fun tryEnqueue(idx: Int) {
            if (!visited[idx]) {
                visited[idx] = true
                if (colorDistSq(pixels[idx]) <= maxDistSq) {
                    isBackground[idx] = true
                    queue.add(idx)
                }
            }
        }

        // Seed all 4 outer edges
        for (x in 0 until w) {
            tryEnqueue(x)
            tryEnqueue((h - 1) * w + x)
        }
        for (y in 1 until h - 1) {
            tryEnqueue(y * w)
            tryEnqueue(y * w + (w - 1))
        }

        while (queue.isNotEmpty()) {
            val idx = queue.removeFirst()
            val x = idx % w
            val y = idx / w
            if (x > 0) tryEnqueue(idx - 1)
            if (x < w - 1) tryEnqueue(idx + 1)
            if (y > 0) tryEnqueue(idx - w)
            if (y < h - 1) tryEnqueue(idx + w)
        }

        // Feather foreground pixels immediately touching removed background for clean edges
        val outPixels = IntArray(w * h)
        var minX = w
        var minY = h
        var maxX = -1
        var maxY = -1

        for (y in 0 until h) {
            val row = y * w
            for (x in 0 until w) {
                val idx = row + x
                val c = pixels[idx]
                if (isBackground[idx] || Color.alpha(c) < 15) {
                    outPixels[idx] = Color.TRANSPARENT
                    continue
                }

                // Check 4-neighbors to soften fringe pixels slightly
                var bgNeighbors = 0
                if (x > 0 && isBackground[idx - 1]) bgNeighbors++
                if (x < w - 1 && isBackground[idx + 1]) bgNeighbors++
                if (y > 0 && isBackground[idx - w]) bgNeighbors++
                if (y < h - 1 && isBackground[idx + w]) bgNeighbors++

                val origAlpha = Color.alpha(c)
                val finalAlpha = if (bgNeighbors > 0) {
                    val d = sqrt(colorDistSq(c)).coerceIn(0f, maxDist * 1.4f)
                    val factor = (d / (maxDist * 1.4f)).coerceIn(0.35f, 0.92f)
                    (origAlpha * factor).toInt().coerceIn(0, 255)
                } else {
                    origAlpha
                }

                outPixels[idx] = Color.argb(finalAlpha, Color.red(c), Color.green(c), Color.blue(c))
                if (finalAlpha > 35) {
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                }
            }
        }

        val work = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        work.setHasAlpha(true)
        work.setPixels(outPixels, 0, w, 0, 0, w, h)

        return if (maxX > minX + 16 && maxY > minY + 16) {
            val pad = 8
            val cropX = max(0, minX - pad)
            val cropY = max(0, minY - pad)
            val cropW = min(w - cropX, (maxX - minX) + pad * 2)
            val cropH = min(h - cropY, (maxY - minY) + pad * 2)
            val cropped = Bitmap.createBitmap(work, cropX, cropY, cropW, cropH)
            cropped.setHasAlpha(true)
            if (cropped !== work) work.recycle()
            cropped
        } else {
            work
        }
    }
}
