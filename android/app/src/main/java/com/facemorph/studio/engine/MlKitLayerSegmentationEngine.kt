package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Color
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
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Adaptive ML Kit Segmentation + Facial Contour Object-Scanning Pipeline.
 * Automatically scans target faces for overlapping occluders (forehead/crown, hair strands,
 * jewelry/veil/glasses/maang tikka/bindi, hands/fingers, and external foreground props),
 * runs connected-component clustering, and dynamically creates 2 base layers + K object cutout layers ordered by z-depth.
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
        sensitivity: Int = 72,
        foreheadCutShift: Float = 0f,
        foreheadSoftness: Float = 0.50f
    ): SegmentedTargetLayers {
        val w = targetBitmap.width
        val h = targetBitmap.height

        val backgroundLayer = targetBitmap.copy(Bitmap.Config.ARGB_8888, false)
        backgroundLayer.setHasAlpha(true)

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
        val objectLayers = ArrayList<CutoutObjectLayer>(10)

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
            val eyeDist = max(
                18f,
                hypot(
                    (viewerRight.x - viewerLeft.x).toDouble(),
                    (viewerRight.y - viewerLeft.y).toDouble()
                ).toFloat()
            )

            val bw = max(36f, face.boxRight - face.boxLeft)
            val bh = max(44f, face.boxBottom - face.boxTop)
            // Expand ROI generously above forehead & temples to capture crown hair, bangs & forehead jewelry
            val rx0 = (face.boxLeft - bw * 0.28f).toInt().coerceIn(0, w - 1)
            val ry0 = (face.boxTop - bh * 0.36f).toInt().coerceIn(0, h - 1)
            val rx1 = (face.boxRight + bw * 0.28f).toInt().coerceIn(rx0 + 1, w)
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

            // Head-roll rotation so forehead & brow cuts tilt accurately with tilted faces
            val rollRad = Math.toRadians((-face.rollDeg).toDouble()).toFloat()
            val cosR = cos(rollRad)
            val sinR = sin(rollRad)

            fun toHeadRot(imgX: Float, imgY: Float): Pair<Float, Float> {
                val dx = imgX - eyeMidX
                val dy = imgY - eyeMidY
                return (dx * cosR - dy * sinR) to (dx * sinR + dy * cosR)
            }

            val clampedCutShift = foreheadCutShift.coerceIn(-0.14f, 0.14f)
            val browPts = face.leftBrowTop + face.rightBrowTop
            val browRotY = if (browPts.isNotEmpty()) {
                browPts.map { toHeadRot(it.x, it.y).second }.average().toFloat()
            } else {
                -eyeDist * 0.28f
            }
            val foreCutRotY = (browRotY - eyeDist * (0.10f - clampedCutShift * 1.15f))
                .coerceIn(-bh * 0.48f, -eyeDist * 0.02f)

            val roiTotal = rw * rh
            val roiLum = FloatArray(roiTotal)
            val roiPersonConf = FloatArray(roiTotal)
            val roiRNorm = FloatArray(roiTotal)
            val roiRotX = FloatArray(roiTotal)
            val roiRotY = FloatArray(roiTotal)
            val roiAlpha = FloatArray(roiTotal)
            val roiCat = IntArray(roiTotal)

            val faceCenterX = (face.boxLeft + face.boxRight) * 0.5f
            val faceCenterY = (face.boxTop + face.boxBottom) * 0.5f
            val (centerRotX, centerRotY) = toHeadRot(faceCenterX, faceCenterY)
            val invRx = 1f / max(18f, bw * 0.54f)
            val invRy = 1f / max(22f, bh * 0.56f)

            var hairSumR = 0L
            var hairSumG = 0L
            var hairSumB = 0L
            var hairSampleCount = 0

            for (ly in 0 until rh) {
                val imgY = ry0 + ly
                val rowOff = ly * rw
                val imgRow = imgY * w
                for (lx in 0 until rw) {
                    val imgX = rx0 + lx
                    val c = srcPixels[imgRow + imgX]
                    val idx = rowOff + lx
                    val r = Color.red(c)
                    val g = Color.green(c)
                    val b = Color.blue(c)
                    val lum = 0.299f * r + 0.587f * g + 0.114f * b
                    val conf = sampleBilinearConfidence(rawMask, imgX, imgY, w, h)
                    roiLum[idx] = lum
                    roiPersonConf[idx] = conf

                    val (rxHead, ryHead) = toHeadRot(imgX.toFloat(), imgY.toFloat())
                    roiRotX[idx] = rxHead
                    roiRotY[idx] = ryHead

                    val relX = rxHead - centerRotX
                    val relY = ryHead - centerRotY
                    val ny = relY * invRy
                    val jawTaper = if (ny > 0.12f) (1f - (ny - 0.12f) * 0.16f).coerceIn(0.82f, 1f) else 1f
                    val nx = (relX * invRx) / jawTaper
                    roiRNorm[idx] = hypot(nx.toDouble(), ny.toDouble()).toFloat()

                    // Sample target hair color in crown above forehead OR side temple hair rim (when top of head is cropped)
                    val isCrownBand = ryHead < foreCutRotY - eyeDist * 0.14f
                    val isTempleHairBand = abs(rxHead) > bw * 0.44f && ryHead < eyeDist * 0.45f
                    if (conf > 0.25f && Color.alpha(c) > 40 && (isCrownBand || isTempleHairBand)) {
                        val skinDist = abs(r - skinR) + abs(g - skinG) + abs(b - skinB)
                        if (skinDist > 34f || lum < skinLum * 0.74f) {
                            hairSumR += r
                            hairSumG += g
                            hairSumB += b
                            hairSampleCount++
                        }
                    }
                }
            }

            val hasHairSample = hairSampleCount >= 14
            val hairRefR = if (hasHairSample) hairSumR.toFloat() / hairSampleCount else 32f
            val hairRefG = if (hasHairSample) hairSumG.toFloat() / hairSampleCount else 28f
            val hairRefB = if (hasHairSample) hairSumB.toFloat() / hairSampleCount else 26f
            val hairRefLum = 0.299f * hairRefR + 0.587f * hairRefG + 0.114f * hairRefB

            val darkHairCutoff = min(94f, skinLum * 0.65f + thresholdBias * 0.35f)
            val brightJewelCutoff = max(182f, skinLum + 20f - thresholdBias * 0.3f)

            val visited = BooleanArray(roiTotal)
            val queue = IntArray(roiTotal)
            var qHead = 0
            var qTail = 0
            var faceAreaPixels = 0

            val faceHalfWRot = max(18f, bw * 0.52f)
            val clampedSoftness = foreheadSoftness.coerceIn(0.15f, 1.0f)
            val fadeBandY = max(4f, eyeDist * (0.05f + clampedSoftness * 0.26f))

            for (ly in 0 until rh) {
                val rowOff = ly * rw
                val yUp = if (ly > 0) (ly - 1) * rw else rowOff
                val yDn = if (ly < rh - 1) (ly + 1) * rw else rowOff
                val imgRow = (ry0 + ly) * w

                for (lx in 0 until rw) {
                    val idx = rowOff + lx
                    val rVal = roiRNorm[idx]
                    if (rVal > 1.18f) continue

                    val c = srcPixels[imgRow + rx0 + lx]
                    if (Color.alpha(c) < 25) continue

                    val rotX = roiRotX[idx]
                    val rotY = roiRotY[idx]
                    val uAbs = abs(rotX / faceHalfWRot)
                    val isUpperHairOrCrown = rotY < foreCutRotY - eyeDist * 0.05f
                    if (rVal <= 1.04f) {
                        faceAreaPixels++
                        totalFacePixels++
                    } else if (!isUpperHairOrCrown && uAbs < 0.85f) {
                        continue
                    }

                    val r = Color.red(c)
                    val g = Color.green(c)
                    val b = Color.blue(c)
                    val tLum = roiLum[idx]
                    val pConf = roiPersonConf[idx]

                    val xL = if (lx > 0) lx - 1 else lx
                    val xR = if (lx < rw - 1) lx + 1 else lx
                    val tGrad = (abs(roiLum[rowOff + xR] - roiLum[rowOff + xL]) +
                        abs(roiLum[yDn + lx] - roiLum[yUp + lx])) * 0.5f

                    val archedCutRotY = foreCutRotY - uAbs * (eyeDist * 0.055f)
                    // Protect the left & right orbital eye sockets/lashes while leaving center glabella open for bindis/tikka drops
                    val inEyeSocket = (rotY in (archedCutRotY + eyeDist * 0.03f)..(eyeDist * 0.30f)) &&
                        (uAbs in 0.17f..0.78f)
                    val inNoseMouthCore = (rotY in (eyeDist * 0.08f)..(eyeDist * 1.10f)) && uAbs < 0.45f

                    val maxC = max(r, max(g, b))
                    val minC = min(r, min(g, b))
                    val sat = if (maxC > 0) (maxC - minC).toFloat() / maxC else 0f
                    val colorDist = abs(r - skinR) + abs(g - skinG) + abs(b - skinB)

                    var reveal = 0f
                    var cat = CAT_NONE

                    // PRIORITY 1: Forehead jewelry (maang tikka, bindi, matha patti, pearls, gold chains, crown/veil, glasses bridge)
                    if (autoMaskAccessories && !inEyeSocket && rVal <= 1.16f) {
                        val inUpperForeZone = rotY < (archedCutRotY + eyeDist * 0.26f) && uAbs < 0.94f
                        val inGlabellaOrnament = rotY < (eyeDist * 0.12f) && uAbs < 0.23f
                        val inTempleOrRim = rVal > 0.76f && rotY < eyeDist * 0.36f
                        if (inUpperForeZone || inGlabellaOrnament || inTempleOrRim) {
                            val isBrightJewel = tLum > brightJewelCutoff && (tGrad > 6f || sat < 0.26f || colorDist > 32f)
                            val isGoldMetal = r > skinR * 0.78f && (r - b) > 22f && colorDist > 26f &&
                                ((sat > 0.30f && (r - b) > 32f) || tGrad > 8.5f)
                            val isColoredGemOrBindi = sat > 0.34f && colorDist > 38f && (inGlabellaOrnament || rotY < archedCutRotY + eyeDist * 0.18f)
                            val isDarkBindi = inGlabellaOrnament && uAbs < 0.16f &&
                                rotY > (archedCutRotY - eyeDist * 0.16f) &&
                                tLum < skinLum * 0.64f && colorDist > 36f
                            val isFiligreeChain = (inGlabellaOrnament || (rotY < archedCutRotY + eyeDist * 0.08f && uAbs < 0.84f)) &&
                                colorDist > 38f && tGrad > 9.5f && tLum > 38f &&
                                !(hasHairSample && abs(r - hairRefR) + abs(g - hairRefG) + abs(b - hairRefB) < 38f)

                            if (isBrightJewel || isGoldMetal || isColoredGemOrBindi || isDarkBindi || isFiligreeChain) {
                                val jewelStrength = when {
                                    isBrightJewel -> ((tLum - (brightJewelCutoff - 10f)) / 30f).coerceIn(0.72f, 1f)
                                    isColoredGemOrBindi -> (colorDist / 66f).coerceIn(0.78f, 1f)
                                    isDarkBindi -> ((skinLum * 0.72f - tLum) / 34f).coerceIn(0.82f, 1f)
                                    isGoldMetal -> (colorDist / 58f).coerceIn(0.75f, 1f)
                                    else -> (tGrad / 20f).coerceIn(0.72f, 0.98f)
                                }
                                reveal = if (jewelStrength > 0.82f) 1f else jewelStrength
                                cat = CAT_ACCESSORY
                            }
                        }
                    }

                    // PRIORITY 2: Hair (dark, brown, auburn, blonde, silver, bangs, crown & side locks)
                    if (cat == CAT_NONE && autoMaskHair && !inEyeSocket && !inNoseMouthCore) {
                        val inHairZone = rotY < (archedCutRotY + eyeDist * 0.14f) || uAbs > 0.70f || rVal > 0.78f
                        val passHairPerson = pConf > 0.06f || rVal <= 1.00f
                        if (inHairZone && passHairPerson) {
                            val hairDist = if (hasHairSample) {
                                abs(r - hairRefR) + abs(g - hairRefG) + abs(b - hairRefB)
                            } else 999f
                            val isDarkHair = tLum < darkHairCutoff
                            val matchesTargetHair = hasHairSample &&
                                hairDist < 84f &&
                                hairDist < colorDist * 0.92f &&
                                colorDist > 22f
                            val isColoredOrLitHair = colorDist > 36f &&
                                (tLum < skinLum - 12f || tLum > skinLum + 22f) &&
                                (rotY < archedCutRotY + eyeDist * 0.06f || rVal > 0.80f) &&
                                sat < 0.62f &&
                                (tLum < skinLum - 14f || tGrad > 7f || rVal > 0.86f)

                            if (isDarkHair || matchesTargetHair || isColoredOrLitHair) {
                                val ha = when {
                                    isDarkHair -> ((darkHairCutoff + 8f - tLum) / 32f).coerceIn(0.70f, 1f)
                                    matchesTargetHair -> ((86f - hairDist) / 44f).coerceIn(0.68f, 1f)
                                    else -> (colorDist / 72f).coerceIn(0.62f, 0.98f)
                                }
                                reveal = if (ha > 0.84f) 1f else ha
                                cat = CAT_HAIR
                            }
                        }
                    }

                    // PRIORITY 3: Perimeter-seeded hands, fingers & foreground props crossing cheeks/chin
                    if (cat == CAT_NONE && autoMaskObjects && !inEyeSocket && rVal in 0.70f..1.02f) {
                        val isForeignTint = colorDist > (58f - thresholdBias * 0.5f) ||
                            tLum < darkHairCutoff ||
                            (tLum > brightJewelCutoff && sat < 0.26f)
                        val isSkinLike = r >= g && (r - b) > 4 && tLum in 42f..242f
                        val isHandRidge = isSkinLike &&
                            ((tGrad > 10.5f && colorDist > 16f) || (tGrad > 14f && abs(tLum - skinLum) > 14f))

                        if (isForeignTint || isHandRidge) {
                            visited[idx] = true
                            queue[qTail++] = idx
                            reveal = if (isForeignTint) 0.94f else 0.88f
                            cat = when {
                                isHandRidge && !isForeignTint -> CAT_HAND_FINGER
                                tLum < darkHairCutoff -> CAT_HAIR
                                else -> CAT_OBJECT
                            }
                        }
                    }

                    // PRIORITY 4: Clean Forehead skin above tilted brow line (solid core opacity so donor forehead never ghosts through)
                    val inForeheadSpan = rVal <= 1.08f || (uAbs < 0.92f && rotY > foreCutRotY - bh * 0.42f)
                    val passForePerson = pConf > 0.08f || rVal <= 0.98f
                    if (cat == CAT_NONE && inForeheadSpan && rotY < archedCutRotY && passForePerson) {
                        val ft = ((archedCutRotY - rotY) / fadeBandY).coerceIn(0f, 1f)
                        val smoothFt = ft * ft * (3f - 2f * ft)
                        val fa = if (ft >= 0.62f) 1f else smoothFt
                        if (fa > 0.04f) {
                            reveal = fa
                            cat = CAT_FOREHEAD
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
                        if (nr < 0.36f || nr > 1.02f) continue

                        val nRotX = roiRotX[nIdx]
                        val nRotY = roiRotY[nIdx]
                        val nuAbs = abs(nRotX / faceHalfWRot)
                        val nArch = foreCutRotY - nuAbs * (eyeDist * 0.055f)
                        if ((nRotY in (nArch + eyeDist * 0.03f)..(eyeDist * 0.30f)) && (nuAbs in 0.17f..0.78f)) continue

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
            // Use category-sensitive minimum cluster sizes so delicate forehead jewelry (bindis/maang tikka)
            // and thin bangs/hair strands are never dropped!
            val minObjPixels = max(32, (faceAreaPixels * 0.005f).toInt())
            val minHairPixels = max(16, (faceAreaPixels * 0.0014f).toInt())
            val minAccessoryPixels = max(6, (faceAreaPixels * 0.00025f).toInt())
            val minForeheadPixels = max(16, minObjPixels / 2)
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

                val requiredMin = when (cat) {
                    CAT_ACCESSORY -> minAccessoryPixels
                    CAT_HAIR -> minHairPixels
                    else -> minObjPixels
                }
                if (comp.size >= requiredMin) {
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

            if (foreheadPixels.size >= minForeheadPixels) {
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

            // Consolidate accessory pearls/chain beads into clean anatomical zones (Tikka/Crown, Crown/Veil, Jewelry)
            // so intricate maang tikka or matha-patti beads never drop past the 4-layer cap.
            val nonAccClusters = ArrayList<RawCluster>(rawClusters.size)
            val tikkaPixels = ArrayList<Int>(256)
            var tikkaSumX = 0L
            var tikkaSumY = 0L
            val crownVeilPixels = ArrayList<Int>(256)
            var crownSumX = 0L
            var crownSumY = 0L
            val lowerJewelryPixels = ArrayList<Int>(256)
            var lowerJSumX = 0L
            var lowerJSumY = 0L

            for (cl in rawClusters) {
                if (cl.cat == CAT_ACCESSORY) {
                    val cxNorm = cl.sumX.toFloat() / max(1, cl.pixels.size * rw)
                    val cyNorm = cl.sumY.toFloat() / max(1, cl.pixels.size * rh)
                    when {
                        cyNorm < 0.48f && cxNorm in 0.30f..0.70f -> {
                            cl.pixels.forEach { tikkaPixels.add(it) }
                            tikkaSumX += cl.sumX
                            tikkaSumY += cl.sumY
                        }
                        cyNorm < 0.48f -> {
                            cl.pixels.forEach { crownVeilPixels.add(it) }
                            crownSumX += cl.sumX
                            crownSumY += cl.sumY
                        }
                        else -> {
                            cl.pixels.forEach { lowerJewelryPixels.add(it) }
                            lowerJSumX += cl.sumX
                            lowerJSumY += cl.sumY
                        }
                    }
                } else {
                    nonAccClusters.add(cl)
                }
            }
            if (tikkaPixels.isNotEmpty()) {
                nonAccClusters.add(RawCluster(CAT_ACCESSORY, tikkaPixels.toIntArray(), tikkaSumX, tikkaSumY))
            }
            if (crownVeilPixels.isNotEmpty()) {
                nonAccClusters.add(RawCluster(CAT_ACCESSORY, crownVeilPixels.toIntArray(), crownSumX, crownSumY))
            }
            if (lowerJewelryPixels.isNotEmpty()) {
                nonAccClusters.add(RawCluster(CAT_ACCESSORY, lowerJewelryPixels.toIntArray(), lowerJSumX, lowerJSumY))
            }

            nonAccClusters.sortByDescending { it.pixels.size }
            val catCounts = IntArray(6)
            for (cl in nonAccClusters) {
                val limit = when (cl.cat) {
                    CAT_HAIR -> 4
                    CAT_ACCESSORY -> 3
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
                        when {
                            cyNorm < 0.48f && cxNorm in 0.30f..0.70f -> "${prefix}Tikka/Crown"
                            cyNorm < 0.48f -> "${prefix}Crown/Veil"
                            else -> "${prefix}Jewelry${if (count > 1) " #$count" else ""}"
                        }
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

