package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import com.facemorph.studio.model.CutoutLayerKind
import com.facemorph.studio.model.CutoutObjectLayer
import com.facemorph.studio.model.DetectedFaceData
import com.facemorph.studio.model.LayerSegmentationSummary
import com.facemorph.studio.model.SegmentedTargetLayers
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Adaptive ML Kit Segmentation + Facial Contour Object-Scanning Pipeline.
 * Automatically scans target faces for overlapping occluders (forehead/crown, hair strands,
 * jewelry/veil/glasses, hands/fingers, and external foreground props), runs connected-component
 * clustering, and dynamically creates 2 base layers + K object cutout layers ordered by z-depth.
 */
object MlKitLayerSegmentationEngine {

    private const val CAT_NONE = 0
    private const val CAT_FOREHEAD = 1
    private const val CAT_HAIR = 2
    private const val CAT_HAND_FINGER = 3
    private const val CAT_ACCESSORY = 4
    private const val CAT_OBJECT = 5

    private val singleImageSegmenter by lazy {
        val opts = SelfieSegmenterOptions.Builder()
            .setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
            .build()
        Segmentation.getClient(opts)
    }

    private data class RawPersonMask(
        val width: Int,
        val height: Int,
        val confidence: FloatArray
    )

    private data class RawCluster(
        val cat: Int,
        val pixels: IntArray,
        val sumX: Long,
        val sumY: Long
    )

    private suspend fun runSelfieSegmentation(bitmap: Bitmap): RawPersonMask? {
        return suspendCancellableCoroutine { cont ->
            try {
                val input = InputImage.fromBitmap(bitmap, 0)
                singleImageSegmenter.process(input)
                    .addOnSuccessListener { mask ->
                        val mw = mask.width
                        val mh = mask.height
                        val total = mw * mh
                        if (total <= 0) {
                            if (cont.isActive) cont.resume(null)
                            return@addOnSuccessListener
                        }
                        val buf = mask.buffer
                        buf.rewind()
                        val data = FloatArray(total)
                        for (i in 0 until total) {
                            data[i] = if (buf.hasRemaining()) buf.float.coerceIn(0f, 1f) else 0f
                        }
                        if (cont.isActive) cont.resume(RawPersonMask(mw, mh, data))
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(null)
                    }
            } catch (_: Exception) {
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    private fun sampleBilinearConfidence(
        mask: RawPersonMask?,
        imgX: Int,
        imgY: Int,
        imgW: Int,
        imgH: Int
    ): Float {
        if (mask == null || mask.width <= 1 || mask.height <= 1) return 1f
        val mx = (imgX.toFloat() / max(1, imgW - 1)) * (mask.width - 1)
        val my = (imgY.toFloat() / max(1, imgH - 1)) * (mask.height - 1)
        val x0 = mx.toInt().coerceIn(0, mask.width - 1)
        val y0 = my.toInt().coerceIn(0, mask.height - 1)
        val x1 = (x0 + 1).coerceAtMost(mask.width - 1)
        val y1 = (y0 + 1).coerceAtMost(mask.height - 1)
        val fx = mx - x0
        val fy = my - y0
        val mw = mask.width
        val c00 = mask.confidence[y0 * mw + x0]
        val c10 = mask.confidence[y0 * mw + x1]
        val c01 = mask.confidence[y1 * mw + x0]
        val c11 = mask.confidence[y1 * mw + x1]
        val top = c00 + (c10 - c00) * fx
        val bot = c01 + (c11 - c01) * fx
        return top + (bot - top) * fy
    }

    private fun categoryKind(cat: Int): Pair<CutoutLayerKind, Int> = when (cat) {
        CAT_FOREHEAD -> CutoutLayerKind.FOREHEAD to 10
        CAT_HAIR -> CutoutLayerKind.HAIR to 20
        CAT_ACCESSORY -> CutoutLayerKind.ACCESSORY to 30
        CAT_HAND_FINGER -> CutoutLayerKind.HAND_FINGER to 40
        else -> CutoutLayerKind.OBJECT to 50
    }

    suspend fun extractTargetSceneLayers(
        targetBitmap: Bitmap,
        faces: List<DetectedFaceData>,
        autoMaskHair: Boolean,
        autoMaskAccessories: Boolean,
        autoMaskObjects: Boolean,
        preserveTargetLayers: Boolean = true,
        sensitivity: Int = 72
    ): SegmentedTargetLayers {
        val w = targetBitmap.width
        val h = targetBitmap.height

        val backgroundLayer = targetBitmap.copy(Bitmap.Config.ARGB_8888, true)
        backgroundLayer.setHasAlpha(true)
        val bgCanvas = Canvas(backgroundLayer)

        val foreLayer = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply {
            setHasAlpha(true)
        }

        val rawMask = if (preserveTargetLayers && faces.isNotEmpty()) {
            runSelfieSegmentation(targetBitmap)
        } else {
            null
        }

        var hasHairLayer = false
        var hasForeheadLayer = false
        var hasForegroundObjects = false
        var totalForePixels = 0
        var totalFacePixels = 0
        var handObjectCount = 0
        var hairLayerCount = 0
        val objectLayers = ArrayList<CutoutObjectLayer>(8)

        if (faces.isEmpty() || !preserveTargetLayers) {
            return SegmentedTargetLayers(
                backgroundLayer = backgroundLayer,
                foreLayer = foreLayer,
                summary = LayerSegmentationSummary(
                    hasHairLayer = false,
                    hasForeheadLayer = false,
                    hasForegroundObjects = false,
                    foregroundCoveragePct = 0,
                    segmentWidth = rawMask?.width ?: 0,
                    segmentHeight = rawMask?.height ?: 0,
                    totalLayerCount = 2,
                    objectLayerCount = 0,
                    decisionNote = if (preserveTargetLayers) "2 Base Layers" else "2 Base Layers (Stack Off)"
                ),
                objectLayers = emptyList()
            )
        }

        val forePixels = IntArray(w * h)
        val srcPixels = IntArray(w * h)
        val scratchLayerPixels = IntArray(w * h)
        targetBitmap.getPixels(srcPixels, 0, w, 0, 0, w, h)

        val thresholdBias = (sensitivity - 70) * 0.35f
        val dx4 = intArrayOf(-1, 1, 0, 0)
        val dy4 = intArrayOf(0, 0, -1, 1)
        val dx8 = intArrayOf(-1, 1, 0, 0, -1, 1, -1, 1)
        val dy8 = intArrayOf(0, 0, -1, 1, -1, -1, 1, 1)

        faces.forEachIndexed { faceIndex, face ->
            if (!face.enabled) return@forEachIndexed

            val lm = face.landmarks
            val (viewerLeft, viewerRight) = if (lm.leftEye.x <= lm.rightEye.x) {
                lm.leftEye to lm.rightEye
            } else {
                lm.rightEye to lm.leftEye
            }
            val eyeMidX = (viewerLeft.x + viewerRight.x) * 0.5f
            val eyeMidY = (viewerLeft.y + viewerRight.y) * 0.5f
            val eyeDist = hypot(
                (viewerRight.x - viewerLeft.x).toDouble(),
                (viewerRight.y - viewerLeft.y).toDouble()
            ).toFloat()
            val eyeAngleDeg = Math.toDegrees(
                atan2((viewerRight.y - viewerLeft.y).toDouble(), (viewerRight.x - viewerLeft.x).toDouble())
            ).toFloat()

            val bw = max(36f, face.boxRight - face.boxLeft)
            val bh = max(44f, face.boxBottom - face.boxTop)
            val rx0 = (face.boxLeft - bw * 0.22f).toInt().coerceIn(0, w - 1)
            val ry0 = (face.boxTop - bh * 0.26f).toInt().coerceIn(0, h - 1)
            val rx1 = (face.boxRight + bw * 0.22f).toInt().coerceIn(rx0 + 1, w)
            val ry1 = (face.boxBottom + bh * 0.20f).toInt().coerceIn(ry0 + 1, h)
            val rw = rx1 - rx0
            val rh = ry1 - ry0
            if (rw < 16 || rh < 16) return@forEachIndexed

            val cheekRgb = NativeFaceSwapEngine.sampleFacialSkinOnlyRgb(
                bmp = targetBitmap,
                cx = lm.nose.x.toInt(),
                cy = (eyeMidY + (lm.nose.y - eyeMidY) * 0.55f).toInt(),
                radiusX = max(6, (bw * 0.24f).toInt()),
                radiusY = max(6, (bh * 0.16f).toInt())
            )
            val skinR = cheekRgb.first
            val skinG = cheekRgb.second
            val skinB = cheekRgb.third
            val skinLum = 0.299f * skinR + 0.587f * skinG + 0.114f * skinB

            // 1) Paint smooth cheek-toned cavity bed onto Background Layer
            val cavColor = Color.argb(
                235,
                skinR.toInt().coerceIn(0, 255),
                skinG.toInt().coerceIn(0, 255),
                skinB.toInt().coerceIn(0, 255)
            )
            val cavTrans = Color.argb(
                0,
                skinR.toInt().coerceIn(0, 255),
                skinG.toInt().coerceIn(0, 255),
                skinB.toInt().coerceIn(0, 255)
            )
            val cavX = eyeMidX * 0.56f + lm.lips.x * 0.44f
            val cavY = eyeMidY * 0.58f + lm.lips.y * 0.42f
            val cavRx = max(10f, eyeDist * 0.78f)
            val cavRy = max(12f, abs(lm.lips.y - eyeMidY) * 0.86f)
            val cavShader = RadialGradient(
                0f,
                0f,
                1f,
                intArrayOf(cavColor, cavColor, cavTrans),
                floatArrayOf(0f, 0.56f, 1f),
                Shader.TileMode.CLAMP
            )
            val cavPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = cavShader }
            val saveCount = bgCanvas.save()
            bgCanvas.translate(cavX, cavY)
            bgCanvas.rotate(eyeAngleDeg)
            bgCanvas.scale(cavRx, cavRy)
            bgCanvas.drawCircle(0f, 0f, 1f, cavPaint)
            bgCanvas.restoreToCount(saveCount)

            // 2) Compute ROI signals & per-pixel semantic classification
            val roiTotal = rw * rh
            val roiLum = FloatArray(roiTotal)
            val roiPersonConf = FloatArray(roiTotal)
            val roiRNorm = FloatArray(roiTotal)
            val roiAlpha = FloatArray(roiTotal)
            val roiCat = IntArray(roiTotal)

            val browAvgY = (face.leftBrowTop + face.rightBrowTop)
                .takeIf { it.isNotEmpty() }
                ?.let { pts -> pts.map { it.y }.average().toFloat() }
            val foreCutY = browAvgY?.let { it - eyeDist * 0.08f } ?: (eyeMidY - eyeDist * 0.34f)
            val foreCutRatio = ((foreCutY - ry0) / max(1f, rh.toFloat())).coerceIn(0.10f, 0.38f)

            val darkHairCutoff = min(82f, skinLum * 0.54f + thresholdBias * 0.3f)
            val brightJewelCutoff = max(186f, skinLum + 24f - thresholdBias * 0.3f)

            val halfW = rw * 0.5f
            val halfH = rh * 0.5f
            val invRx = 1f / max(1f, halfW * 0.94f)
            val invRy = 1f / max(1f, halfH * 0.94f)

            for (ly in 0 until rh) {
                val imgY = ry0 + ly
                val ny = (ly - halfH) * invRy
                val jawTaper = if (ny > 0.14f) (1f - (ny - 0.14f) * 0.16f).coerceIn(0.82f, 1f) else 1f
                val rowOff = ly * rw
                val imgRow = imgY * w
                for (lx in 0 until rw) {
                    val imgX = rx0 + lx
                    val c = srcPixels[imgRow + imgX]
                    val idx = rowOff + lx
                    roiLum[idx] = 0.299f * Color.red(c) + 0.587f * Color.green(c) + 0.114f * Color.blue(c)
                    roiPersonConf[idx] = sampleBilinearConfidence(rawMask, imgX, imgY, w, h)
                    val nx = ((lx - halfW) * invRx) / jawTaper
                    roiRNorm[idx] = hypot(nx.toDouble(), ny.toDouble()).toFloat()
                }
            }

            val visited = BooleanArray(roiTotal)
            val queue = IntArray(roiTotal)
            var qHead = 0
            var qTail = 0
            val rhInv = 1f / max(1, rh - 1)
            val rwInv = 1f / max(1, rw - 1)
            var faceAreaPixels = 0

            for (ly in 0 until rh) {
                val v = ly * rhInv
                val rowOff = ly * rw
                val yUp = if (ly > 0) (ly - 1) * rw else rowOff
                val yDn = if (ly < rh - 1) (ly + 1) * rw else rowOff
                val imgRow = (ry0 + ly) * w

                for (lx in 0 until rw) {
                    val idx = rowOff + lx
                    val rVal = roiRNorm[idx]
                    if (rVal > 1.04f) continue
                    faceAreaPixels++
                    totalFacePixels++

                    val c = srcPixels[imgRow + rx0 + lx]
                    if (Color.alpha(c) < 25) continue

                    val r = Color.red(c)
                    val g = Color.green(c)
                    val b = Color.blue(c)
                    val tLum = roiLum[idx]
                    val pConf = roiPersonConf[idx]
                    val uAbs = abs(lx * rwInv - 0.5f) * 2f

                    val xL = if (lx > 0) lx - 1 else lx
                    val xR = if (lx < rw - 1) lx + 1 else lx
                    val tGrad = (abs(roiLum[rowOff + xR] - roiLum[rowOff + xL]) +
                        abs(roiLum[yDn + lx] - roiLum[yUp + lx])) * 0.5f

                    val inOcularCore = v in (foreCutRatio + 0.02f)..(foreCutRatio + 0.27f) && uAbs < 0.72f

                    var reveal = 0f
                    var cat = CAT_NONE

                    // A) Forehead / Crown above eyebrows
                    val archedCut = foreCutRatio - uAbs * 0.035f
                    if (v < archedCut && pConf > 0.18f) {
                        val ft = ((archedCut - v) / 0.095f).coerceIn(0f, 1f)
                        val fa = ft * ft * (3f - 2f * ft) * 0.96f
                        if (fa > reveal) {
                            reveal = fa
                            cat = CAT_FOREHEAD
                        }
                    }

                    val maxC = max(r, max(g, b))
                    val minC = min(r, min(g, b))
                    val sat = if (maxC > 0) (maxC - minC).toFloat() / maxC else 0f

                    // B) Bright jewelry / veil / glasses / maang tikka
                    if (autoMaskAccessories) {
                        val inUpperZone = v < (foreCutRatio + 0.14f) && uAbs < 0.80f
                        val inMidOrnament = v < (foreCutRatio + 0.18f) && uAbs < 0.24f
                        if ((inUpperZone || inMidOrnament || rVal > 0.78f) &&
                            tLum > brightJewelCutoff &&
                            (tGrad > 8f || sat < 0.22f)
                        ) {
                            val aa = ((tLum - (brightJewelCutoff - 6f)) / 40f).coerceIn(0f, 1f) * 0.95f
                            if (aa > reveal || (inMidOrnament && aa > 0.35f)) {
                                reveal = max(reveal, aa)
                                cat = CAT_ACCESSORY
                            }
                        }
                    }

                    // C) Hair strands / bangs on forehead, temples, outer jaw rim
                    if (autoMaskHair) {
                        val inHairZone = v < (foreCutRatio + 0.09f) || uAbs > 0.72f || rVal > 0.84f
                        if (!inOcularCore && inHairZone && tLum < darkHairCutoff && pConf > 0.25f) {
                            val ha = ((darkHairCutoff + 4f - tLum) / 34f).coerceIn(0f, 1f) * 0.95f
                            if (ha >= reveal) {
                                reveal = ha
                                cat = CAT_HAIR
                            }
                        }
                    }

                    // D) Perimeter-seeded hands, fingers & foreground objects
                    if (autoMaskObjects && !inOcularCore && rVal in 0.72f..1.00f) {
                        val colorDist = abs(r - skinR) + abs(g - skinG) + abs(b - skinB)
                        val isForeignTint = colorDist > (60f - thresholdBias * 0.5f) ||
                            tLum < darkHairCutoff ||
                            (tLum > brightJewelCutoff && sat < 0.26f)
                        val isSkinLike = r >= g && (r - b) > 4 && tLum in 42f..242f
                        val isHandRidge = isSkinLike &&
                            ((tGrad > 10.5f && colorDist > 16f) || (tGrad > 14f && abs(tLum - skinLum) > 14f))

                        if (isForeignTint || isHandRidge) {
                            visited[idx] = true
                            queue[qTail++] = idx
                            val objAlpha = if (isForeignTint) 0.92f else 0.85f
                            if (objAlpha >= reveal) {
                                reveal = objAlpha
                                cat = when {
                                    isHandRidge && !isForeignTint -> CAT_HAND_FINGER
                                    tLum < darkHairCutoff -> CAT_HAIR
                                    else -> CAT_OBJECT
                                }
                            }
                        }
                    }

                    roiAlpha[idx] = reveal
                    roiCat[idx] = cat
                }
            }

            // Edge-barrier-bounded BFS propagation for contiguous hands, fingers, hair locks, flowers
            if (autoMaskObjects) {
                while (qHead < qTail) {
                    val cur = queue[qHead++]
                    val cx = cur % rw
                    val cy = cur / rw
                    val cPix = srcPixels[(ry0 + cy) * w + rx0 + cx]
                    val cR = Color.red(cPix)
                    val cG = Color.green(cPix)
                    val cB = Color.blue(cPix)
                    val cVal = roiAlpha[cur]
                    val cCat = roiCat[cur].let { if (it == CAT_NONE) CAT_OBJECT else it }

                    for (d in 0..3) {
                        val nx = cx + dx4[d]
                        val ny = cy + dy4[d]
                        if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue
                        val nIdx = ny * rw + nx
                        if (visited[nIdx]) continue

                        val nr = roiRNorm[nIdx]
                        if (nr < 0.36f || nr > 1.00f) continue

                        val nv = ny * rhInv
                        val nuAbs = abs(nx * rwInv - 0.5f) * 2f
                        if (nv in (foreCutRatio + 0.02f)..(foreCutRatio + 0.26f) && nuAbs < 0.68f) continue

                        val nPix = srcPixels[(ry0 + ny) * w + rx0 + nx]
                        if (Color.alpha(nPix) < 25) continue
                        val nR = Color.red(nPix)
                        val nG = Color.green(nPix)
                        val nB = Color.blue(nPix)
                        val stepDiff = abs(nR - cR) + abs(nG - cG) + abs(nB - cB)
                        val skinDist = abs(nR - skinR) + abs(nG - skinG) + abs(nB - skinB)
                        val nLum = roiLum[nIdx]

                        val xL = if (nx > 0) nx - 1 else nx
                        val xR = if (nx < rw - 1) nx + 1 else nx
                        val yU = if (ny > 0) ny - 1 else ny
                        val yD = if (ny < rh - 1) ny + 1 else ny
                        val nGrad = (abs(roiLum[ny * rw + xR] - roiLum[ny * rw + xL]) +
                            abs(roiLum[yD * rw + nx] - roiLum[yU * rw + nx])) * 0.5f

                        val handCont = cCat == CAT_HAND_FINGER && stepDiff < 26f && nGrad < 22f && nr > 0.38f
                        val propCont = stepDiff < 38f &&
                            (skinDist > 46f || nLum < darkHairCutoff || nLum > brightJewelCutoff || nr > 0.72f)

                        if (handCont || propCont) {
                            visited[nIdx] = true
                            queue[qTail++] = nIdx
                            val decayed = (cVal * 0.985f).coerceIn(0f, 0.95f)
                            if (decayed > roiAlpha[nIdx]) {
                                roiAlpha[nIdx] = decayed
                                roiCat[nIdx] = cCat
                            }
                        }
                    }
                }
            }

            // Stamp merged foreLayer pixels
            for (ly in 0 until rh) {
                val rowOff = ly * rw
                val imgRow = (ry0 + ly) * w
                for (lx in 0 until rw) {
                    val idx = rowOff + lx
                    val a = (roiAlpha[idx] * 255f).toInt().coerceIn(0, 255)
                    if (a > 6 && roiCat[idx] != CAT_NONE) {
                        val imgIdx = imgRow + rx0 + lx
                        val sc = srcPixels[imgIdx]
                        val existingA = Color.alpha(forePixels[imgIdx])
                        if (a >= existingA) {
                            forePixels[imgIdx] = Color.argb(a, Color.red(sc), Color.green(sc), Color.blue(sc))
                            totalForePixels++
                        }
                    }
                }
            }

            // 3) Connected-Component Object Clustering -> Dynamic N-Layer Materialization
            val minObjPixels = max(36, (faceAreaPixels * 0.008f).toInt())
            val cclVisited = BooleanArray(roiTotal)
            val cclQueue = IntArray(roiTotal)
            val foreheadPixels = ArrayList<Int>(roiTotal / 4)
            val rawClusters = ArrayList<RawCluster>(16)

            for (i in 0 until roiTotal) {
                val cat = roiCat[i]
                if (cat == CAT_NONE || roiAlpha[i] <= 0.05f) continue
                if (cat == CAT_FOREHEAD) {
                    foreheadPixels.add(i)
                    continue
                }
                if (cclVisited[i]) continue

                var cHead = 0
                var cTail = 0
                cclQueue[cTail++] = i
                cclVisited[i] = true
                val comp = ArrayList<Int>(256)
                var sumX = 0L
                var sumY = 0L

                while (cHead < cTail) {
                    val cur = cclQueue[cHead++]
                    comp.add(cur)
                    val cx = cur % rw
                    val cy = cur / rw
                    sumX += cx
                    sumY += cy

                    for (d in 0..7) {
                        val nx = cx + dx8[d]
                        val ny = cy + dy8[d]
                        if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue
                        val nIdx = ny * rw + nx
                        if (!cclVisited[nIdx] && roiCat[nIdx] == cat && roiAlpha[nIdx] > 0.05f) {
                            cclVisited[nIdx] = true
                            cclQueue[cTail++] = nIdx
                        }
                    }
                }

                if (comp.size >= minObjPixels) {
                    rawClusters.add(RawCluster(cat, comp.toIntArray(), sumX, sumY))
                }
            }

            fun buildCutoutBitmap(pixelIndices: IntArray): Bitmap {
                val bmpOut = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply {
                    setHasAlpha(true)
                }
                for (roiIdx in pixelIndices) {
                    val a = (roiAlpha[roiIdx] * 255f).toInt().coerceIn(0, 255)
                    if (a > 6) {
                        val lx = roiIdx % rw
                        val ly = roiIdx / rw
                        val imgIdx = (ry0 + ly) * w + rx0 + lx
                        val sc = srcPixels[imgIdx]
                        scratchLayerPixels[imgIdx] = Color.argb(a, Color.red(sc), Color.green(sc), Color.blue(sc))
                    }
                }
                bmpOut.setPixels(scratchLayerPixels, 0, w, 0, 0, w, h)
                for (roiIdx in pixelIndices) {
                    val lx = roiIdx % rw
                    val ly = roiIdx / rw
                    scratchLayerPixels[(ry0 + ly) * w + rx0 + lx] = 0
                }
                return bmpOut
            }

            val safeDenom = max(1, faceAreaPixels)
            val prefix = if (faces.size > 1) "P${faceIndex + 1} · " else ""

            if (foreheadPixels.size >= minObjPixels) {
                hasForeheadLayer = true
                val fhArr = foreheadPixels.toIntArray()
                val covPct = ((fhArr.size * 100f) / safeDenom).toInt().coerceIn(1, 100)
                objectLayers.add(
                    CutoutObjectLayer(
                        id = "layer-f$faceIndex-forehead",
                        name = "${prefix}Forehead",
                        kind = CutoutLayerKind.FOREHEAD,
                        zOrder = 10,
                        coveragePct = covPct,
                        pixelCount = fhArr.size,
                        bitmap = buildCutoutBitmap(fhArr)
                    )
                )
            }

            rawClusters.sortByDescending { it.pixels.size }
            val catCounts = IntArray(6)
            for (cl in rawClusters) {
                val limit = when (cl.cat) {
                    CAT_HAIR -> 3
                    CAT_ACCESSORY -> 2
                    CAT_HAND_FINGER -> 2
                    else -> 3
                }
                val count = catCounts[cl.cat] + 1
                if (count > limit) continue
                catCounts[cl.cat] = count

                val (kind, zBase) = categoryKind(cl.cat)
                val cxNorm = cl.sumX.toFloat() / max(1, cl.pixels.size * rw)
                val cyNorm = cl.sumY.toFloat() / max(1, cl.pixels.size * rh)
                val sideTag = when {
                    cxNorm < 0.42f -> "Left"
                    cxNorm > 0.58f -> "Right"
                    else -> "Center"
                }

                val name = when (cl.cat) {
                    CAT_HAIR -> {
                        hasHairLayer = true
                        hairLayerCount++
                        if (count == 1) "${prefix}Hair ($sideTag)" else "${prefix}Hair #$count"
                    }
                    CAT_HAND_FINGER -> {
                        hasForegroundObjects = true
                        handObjectCount++
                        if (count == 1) "${prefix}Hand/Finger" else "${prefix}Hand/Finger #$count"
                    }
                    CAT_ACCESSORY -> {
                        hasForegroundObjects = true
                        if (cyNorm < 0.36f) "${prefix}Crown/Veil"
                        else "${prefix}Jewelry${if (count > 1) " #$count" else ""}"
                    }
                    else -> {
                        hasForegroundObjects = true
                        if (count == 1) "${prefix}Object" else "${prefix}Object #$count"
                    }
                }

                val covPct = ((cl.pixels.size * 100f) / safeDenom).toInt().coerceIn(1, 100)
                objectLayers.add(
                    CutoutObjectLayer(
                        id = "layer-f$faceIndex-${kind.name.lowercase()}-$count",
                        name = name,
                        kind = kind,
                        zOrder = zBase + count,
                        coveragePct = covPct,
                        pixelCount = cl.pixels.size,
                        bitmap = buildCutoutBitmap(cl.pixels)
                    )
                )
            }
        }

        objectLayers.sortBy { it.zOrder }
        foreLayer.setPixels(forePixels, 0, w, 0, 0, w, h)
        val pct = if (totalFacePixels > 0) ((totalForePixels * 100f) / totalFacePixels).toInt().coerceIn(0, 100) else 0
        val totalLayerCount = 2 + objectLayers.size
        val summaryParts = ArrayList<String>(4).apply {
            if (hasForeheadLayer) add("Forehead")
            if (hairLayerCount > 0) add("$hairLayerCount Hair")
            if (handObjectCount > 0) add("$handObjectCount Hand/Finger")
            val otherObj = objectLayers.count { it.kind == CutoutLayerKind.ACCESSORY || it.kind == CutoutLayerKind.OBJECT }
            if (otherObj > 0) add("$otherObj Obj/Jewel")
        }
        val decisionNote = if (objectLayers.isNotEmpty()) {
            "$totalLayerCount Layers · ${summaryParts.joinToString(" + ")}"
        } else {
            "2 Base Layers · Clean Face"
        }

        return SegmentedTargetLayers(
            backgroundLayer = backgroundLayer,
            foreLayer = foreLayer,
            summary = LayerSegmentationSummary(
                hasHairLayer = hasHairLayer,
                hasForeheadLayer = hasForeheadLayer,
                hasForegroundObjects = hasForegroundObjects,
                foregroundCoveragePct = pct,
                segmentWidth = rawMask?.width ?: w,
                segmentHeight = rawMask?.height ?: h,
                totalLayerCount = totalLayerCount,
                objectLayerCount = objectLayers.size,
                handObjectCount = handObjectCount,
                hairLayerCount = hairLayerCount,
                decisionNote = decisionNote
            ),
            objectLayers = objectLayers
        )
    }
}

