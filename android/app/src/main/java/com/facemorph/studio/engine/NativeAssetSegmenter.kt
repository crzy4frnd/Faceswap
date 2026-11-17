package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

object NativeAssetSegmenter {

    private data class RgbCluster(val r: Float, val g: Float, val b: Float, var count: Int)

    /**
     * Multi-cluster edge-aware foreground segmentation starting from all 4 borders.
     * - Handles uneven, shaded, wood, or textured tabletop/wall backgrounds using up to 10 border clusters.
     * - Guards crisp garment edges with a Sobel luminance + chroma barrier map.
     * - Removes interior enclosed loops (armholes, collar openings, jewelry loops) while protecting white prints.
     * - Strips disconnected stray peripheral objects when removeExtraneousObjects is true.
     * - Decontaminates border fringe pixels against nearest background cluster to eliminate white dotted halos.
     */
    fun extractTransparentAsset(
        source: Bitmap,
        tolerance: Int = 35,
        removeExtraneousObjects: Boolean = true,
        preserveInnerDetails: Boolean = false
    ): Bitmap {
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

        val total = w * h
        val pixels = IntArray(total)
        scaled.getPixels(pixels, 0, w, 0, 0, w, h)
        if (scaled !== source) scaled.recycle()

        // 1. Multi-cluster perimeter background extraction (3px border strip, up to 10 clusters)
        val clusters = mutableListOf<RgbCluster>()
        fun addBorderSample(x: Int, y: Int) {
            val c = pixels[y.coerceIn(0, h - 1) * w + x.coerceIn(0, w - 1)]
            if (Color.alpha(c) < 25) return
            val r = Color.red(c).toFloat()
            val g = Color.green(c).toFloat()
            val b = Color.blue(c).toFloat()
            for (i in clusters.indices) {
                val cl = clusters[i]
                val dSq = (r - cl.r) * (r - cl.r) + (g - cl.g) * (g - cl.g) + (b - cl.b) * (b - cl.b)
                if (dSq < 1100f) {
                    val n = cl.count + 1
                    clusters[i] = RgbCluster(
                        r = (cl.r * cl.count + r) / n,
                        g = (cl.g * cl.count + g) / n,
                        b = (cl.b * cl.count + b) / n,
                        count = n
                    )
                    return
                }
            }
            if (clusters.size < 10) {
                clusters.add(RgbCluster(r, g, b, 1))
            }
        }

        val stepX = max(1, w / 28)
        val stepY = max(1, h / 28)
        for (band in 0..2) {
            for (x in 0 until w step stepX) {
                addBorderSample(x, band)
                addBorderSample(x, h - 1 - band)
            }
            for (y in 0 until h step stepY) {
                addBorderSample(band, y)
                addBorderSample(w - 1 - band, y)
            }
        }
        if (clusters.isEmpty()) {
            clusters.add(RgbCluster(255f, 255f, 255f, 1))
        }

        fun nearestBgDistSq(c: Int): Pair<Float, RgbCluster> {
            val r = Color.red(c).toFloat()
            val g = Color.green(c).toFloat()
            val b = Color.blue(c).toFloat()
            var bestSq = Float.MAX_VALUE
            var bestCl = clusters[0]
            for (cl in clusters) {
                val dr = r - cl.r
                val dg = g - cl.g
                val db = b - cl.b
                val dSq = dr * dr + dg * dg + db * db
                if (dSq < bestSq) {
                    bestSq = dSq
                    bestCl = cl
                }
            }
            return bestSq to bestCl
        }

        // 2. Sobel edge magnitude barrier map (luma + color difference)
        val luma = FloatArray(total)
        for (i in 0 until total) {
            val c = pixels[i]
            luma[i] = 0.299f * Color.red(c) + 0.587f * Color.green(c) + 0.114f * Color.blue(c)
        }
        val edgeBarrier = FloatArray(total)
        for (y in 1 until h - 1) {
            val rPrev = (y - 1) * w
            val rCur = y * w
            val rNext = (y + 1) * w
            for (x in 1 until w - 1) {
                val gx = -luma[rPrev + x - 1] + luma[rPrev + x + 1] -
                    2f * luma[rCur + x - 1] + 2f * luma[rCur + x + 1] -
                    luma[rNext + x - 1] + luma[rNext + x + 1]
                val gy = -luma[rPrev + x - 1] - 2f * luma[rPrev + x] - luma[rPrev + x + 1] +
                    luma[rNext + x - 1] + 2f * luma[rNext + x] + luma[rNext + x + 1]
                edgeBarrier[rCur + x] = abs(gx) + abs(gy)
            }
        }

        val maxDist = max(28f, tolerance * 2.15f)
        val maxDistSq = maxDist * maxDist
        val strictDistSq = (maxDist * 0.72f) * (maxDist * 0.72f)
        val visited = BooleanArray(total)
        val isBackground = BooleanArray(total)
        val stack = IntArray(total)
        var top = 0

        fun canFloodPixel(idx: Int): Boolean {
            val c = pixels[idx]
            if (Color.alpha(c) < 25) return true
            val (dSq, _) = nearestBgDistSq(c)
            if (dSq <= strictDistSq) return true
            return dSq <= maxDistSq && edgeBarrier[idx] < 135f
        }

        fun tryPushSeed(idx: Int) {
            if (!visited[idx] && canFloodPixel(idx)) {
                visited[idx] = true
                isBackground[idx] = true
                stack[top++] = idx
            }
        }

        for (x in 0 until w) {
            tryPushSeed(x)
            tryPushSeed((h - 1) * w + x)
        }
        for (y in 1 until h - 1) {
            tryPushSeed(y * w)
            tryPushSeed(y * w + (w - 1))
        }

        while (top > 0) {
            val idx = stack[--top]
            val x = idx % w
            val y = idx / w
            if (x > 0) {
                val ni = idx - 1
                if (!visited[ni] && canFloodPixel(ni)) {
                    visited[ni] = true; isBackground[ni] = true; stack[top++] = ni
                }
            }
            if (x < w - 1) {
                val ni = idx + 1
                if (!visited[ni] && canFloodPixel(ni)) {
                    visited[ni] = true; isBackground[ni] = true; stack[top++] = ni
                }
            }
            if (y > 0) {
                val ni = idx - w
                if (!visited[ni] && canFloodPixel(ni)) {
                    visited[ni] = true; isBackground[ni] = true; stack[top++] = ni
                }
            }
            if (y < h - 1) {
                val ni = idx + w
                if (!visited[ni] && canFloodPixel(ni)) {
                    visited[ni] = true; isBackground[ni] = true; stack[top++] = ni
                }
            }
        }

        // 3. Remove enclosed interior background pockets (armholes, collar loops, necklace handles)
        if (!preserveInnerDetails) {
            // Compute average central subject color to avoid punching through white garments on white BG
            var fgR = 0L; var fgG = 0L; var fgB = 0L; var fgCnt = 0
            val cy0 = (h * 0.28f).toInt(); val cy1 = (h * 0.72f).toInt()
            val cx0 = (w * 0.28f).toInt(); val cx1 = (w * 0.72f).toInt()
            for (y in cy0 until cy1 step 2) {
                val row = y * w
                for (x in cx0 until cx1 step 2) {
                    val idx = row + x
                    if (!isBackground[idx] && Color.alpha(pixels[idx]) > 40) {
                        val c = pixels[idx]
                        fgR += Color.red(c); fgG += Color.green(c); fgB += Color.blue(c); fgCnt++
                    }
                }
            }
            val avgFgR = if (fgCnt > 0) fgR.toFloat() / fgCnt else 120f
            val avgFgG = if (fgCnt > 0) fgG.toFloat() / fgCnt else 120f
            val avgFgB = if (fgCnt > 0) fgB.toFloat() / fgCnt else 120f

            val holeChecked = BooleanArray(total)
            val holeStrictSq = (maxDist * 0.68f) * (maxDist * 0.68f)
            val compIndices = IntArray(total)

            for (i in 0 until total) {
                if (isBackground[i] || holeChecked[i] || Color.alpha(pixels[i]) < 25) continue
                val (bgSq, _) = nearestBgDistSq(pixels[i])
                if (bgSq > holeStrictSq) continue

                var compSize = 0
                var stackTop = 0
                stack[stackTop++] = i
                holeChecked[i] = true
                var sumDrBg = 0.0
                var sumDrFg = 0.0

                while (stackTop > 0) {
                    val cur = stack[--stackTop]
                    compIndices[compSize++] = cur
                    val cc = pixels[cur]
                    val (curBgSq, _) = nearestBgDistSq(cc)
                    sumDrBg += curBgSq
                    val drf = Color.red(cc) - avgFgR
                    val dgf = Color.green(cc) - avgFgG
                    val dbf = Color.blue(cc) - avgFgB
                    sumDrFg += (drf * drf + dgf * dgf + dbf * dbf)

                    val cx = cur % w
                    val cy = cur / w
                    val nbs = intArrayOf(
                        if (cx > 0) cur - 1 else -1,
                        if (cx < w - 1) cur + 1 else -1,
                        if (cy > 0) cur - w else -1,
                        if (cy < h - 1) cur + w else -1
                    )
                    for (ni in nbs) {
                        if (ni >= 0 && !isBackground[ni] && !holeChecked[ni] && Color.alpha(pixels[ni]) >= 25) {
                            val (nBgSq, _) = nearestBgDistSq(pixels[ni])
                            if (nBgSq <= holeStrictSq) {
                                holeChecked[ni] = true
                                stack[stackTop++] = ni
                            }
                        }
                    }
                }

                // Only remove enclosed pocket if it is large enough (>=16 px) AND noticeably closer to BG than center garment
                if (compSize >= 16) {
                    val meanBgSq = sumDrBg / compSize
                    val meanFgSq = sumDrFg / compSize
                    if (meanBgSq < meanFgSq * 0.52 || meanBgSq < 260.0) {
                        for (k in 0 until compSize) {
                            isBackground[compIndices[k]] = true
                        }
                    }
                }
            }
        }

        // 4. Connected-component dominant object isolation (removes detached stray peripheral objects)
        if (removeExtraneousObjects) {
            val compLabel = IntArray(total) { -1 }
            val compSizes = mutableListOf<Int>()
            val compScores = mutableListOf<Float>()
            val midX = w * 0.5f
            val midY = h * 0.5f
            val maxDiag = hypotApprox(midX, midY)

            for (i in 0 until total) {
                if (isBackground[i] || compLabel[i] != -1 || Color.alpha(pixels[i]) < 25) continue
                val id = compSizes.size
                var stackTop = 0
                stack[stackTop++] = i
                compLabel[i] = id
                var count = 0
                var sumCx = 0L
                var sumCy = 0L

                while (stackTop > 0) {
                    val cur = stack[--stackTop]
                    count++
                    val cx = cur % w
                    val cy = cur / w
                    sumCx += cx
                    sumCy += cy

                    if (cx > 0) {
                        val ni = cur - 1
                        if (!isBackground[ni] && compLabel[ni] == -1 && Color.alpha(pixels[ni]) >= 25) {
                            compLabel[ni] = id; stack[stackTop++] = ni
                        }
                    }
                    if (cx < w - 1) {
                        val ni = cur + 1
                        if (!isBackground[ni] && compLabel[ni] == -1 && Color.alpha(pixels[ni]) >= 25) {
                            compLabel[ni] = id; stack[stackTop++] = ni
                        }
                    }
                    if (cy > 0) {
                        val ni = cur - w
                        if (!isBackground[ni] && compLabel[ni] == -1 && Color.alpha(pixels[ni]) >= 25) {
                            compLabel[ni] = id; stack[stackTop++] = ni
                        }
                    }
                    if (cy < h - 1) {
                        val ni = cur + w
                        if (!isBackground[ni] && compLabel[ni] == -1 && Color.alpha(pixels[ni]) >= 25) {
                            compLabel[ni] = id; stack[stackTop++] = ni
                        }
                    }
                }

                val centX = sumCx.toFloat() / count
                val centY = sumCy.toFloat() / count
                val distNorm = (hypotApprox(centX - midX, centY - midY) / maxDiag).coerceIn(0f, 1f)
                val score = count * (0.45f + 0.55f * (1f - distNorm))
                compSizes.add(count)
                compScores.add(score)
            }

            if (compSizes.size > 1) {
                var bestId = 0
                for (id in 1 until compScores.size) {
                    if (compScores[id] > compScores[bestId]) bestId = id
                }
                val bestArea = compSizes[bestId]
                val bestScore = compScores[bestId]
                val keep = BooleanArray(compSizes.size)
                for (id in compSizes.indices) {
                    // Keep primary subject plus large symmetric pairs (e.g. two earrings)
                    if (id == bestId || (compSizes[id] >= bestArea * 0.22f && compScores[id] >= bestScore * 0.18f)) {
                        keep[id] = true
                    }
                }
                for (i in 0 until total) {
                    val id = compLabel[i]
                    if (id >= 0 && !keep[id]) {
                        isBackground[i] = true
                    }
                }
            }
        }

        // 5. Soft edge anti-aliasing & true color decontamination (eliminates white/gray dotted halos!)
        val outPixels = IntArray(total)
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

                var bgNeighbors = 0
                if (x > 0 && isBackground[idx - 1]) bgNeighbors++
                if (x < w - 1 && isBackground[idx + 1]) bgNeighbors++
                if (y > 0 && isBackground[idx - w]) bgNeighbors++
                if (y < h - 1 && isBackground[idx + w]) bgNeighbors++

                val origAlpha = Color.alpha(c)
                var r = Color.red(c)
                var g = Color.green(c)
                var b = Color.blue(c)
                var finalAlpha = origAlpha

                if (bgNeighbors > 0) {
                    val (dSq, nearestBg) = nearestBgDistSq(c)
                    val d = sqrt(dSq)
                    // If outer pixel is very close to backdrop cluster color, treat it cleanly as fringe
                    val blendFactor = (d / (maxDist * 1.15f)).coerceIn(0f, 1f)
                    val edgeWeight = when (bgNeighbors) {
                        1 -> 0.76f
                        2 -> 0.56f
                        else -> 0.34f
                    }
                    val alphaScale = (blendFactor * 0.72f + edgeWeight * 0.28f).coerceIn(0.08f, 0.92f)
                    finalAlpha = (origAlpha * alphaScale).toInt().coerceIn(0, 255)

                    // Subtract residual background halo tint from semi-transparent border pixels
                    val aNorm = (finalAlpha / 255f).coerceIn(0.25f, 0.99f)
                    val bgLeak = ((1f - aNorm) * 0.65f).coerceIn(0f, 0.55f)
                    r = (((r - nearestBg.r * bgLeak) / (1f - bgLeak))).toInt().coerceIn(0, 255)
                    g = (((g - nearestBg.g * bgLeak) / (1f - bgLeak))).toInt().coerceIn(0, 255)
                    b = (((b - nearestBg.b * bgLeak) / (1f - bgLeak))).toInt().coerceIn(0, 255)
                }

                outPixels[idx] = Color.argb(finalAlpha, r, g, b)
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
            val pad = 6
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

    /**
     * Interactive 1-tap Magic Wand removal on an already-segmented bitmap.
     * Strips any connected region (stray object, inner gap, or leftover shadow) matching the tapped pixel.
     */
    fun removeConnectedRegionAt(
        bitmap: Bitmap,
        normX: Float,
        normY: Float,
        tolerance: Int = 36
    ): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        if (w < 4 || h < 4) return bitmap

        val sx = (normX * w).toInt().coerceIn(0, w - 1)
        val sy = (normY * h).toInt().coerceIn(0, h - 1)
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        val seedColor = pixels[sy * w + sx]
        if (Color.alpha(seedColor) < 15) return bitmap

        val sr = Color.red(seedColor)
        val sg = Color.green(seedColor)
        val sb = Color.blue(seedColor)
        val maxDistSq = max(30f, tolerance * 2.1f).let { it * it }

        val total = w * h
        val visited = BooleanArray(total)
        val stack = IntArray(total)
        var top = 0
        val startIdx = sy * w + sx
        visited[startIdx] = true
        stack[top++] = startIdx

        while (top > 0) {
            val cur = stack[--top]
            pixels[cur] = Color.TRANSPARENT

            val cx = cur % w
            val cy = cur / w
            val nbs = intArrayOf(
                if (cx > 0) cur - 1 else -1,
                if (cx < w - 1) cur + 1 else -1,
                if (cy > 0) cur - w else -1,
                if (cy < h - 1) cur + w else -1
            )
            for (ni in nbs) {
                if (ni >= 0 && !visited[ni]) {
                    visited[ni] = true
                    val nc = pixels[ni]
                    if (Color.alpha(nc) >= 15) {
                        val dr = Color.red(nc) - sr
                        val dg = Color.green(nc) - sg
                        val db = Color.blue(nc) - sb
                        if ((dr * dr + dg * dg + db * db).toFloat() <= maxDistSq) {
                            stack[top++] = ni
                        }
                    }
                }
            }
        }

        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        out.setHasAlpha(true)
        out.setPixels(pixels, 0, w, 0, 0, w, h)
        return out
    }

    private fun hypotApprox(dx: Float, dy: Float): Float = sqrt(dx * dx + dy * dy)
}
