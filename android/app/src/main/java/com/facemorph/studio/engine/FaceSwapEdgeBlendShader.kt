package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import com.facemorph.studio.model.Point2D
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * 3-Layer PicsArt-Grade Contour Cutout, Occlusion Extraction & Edge-Blending Shader.
 *
 * Implements the manual multi-layer workflow automatically:
 * - Preserves the donor face's exact natural contour and aspect silhouette (zero edge-stretch distortion).
 * - Keeps the core facial features (brows, eyes, nose, lips) 100% crisp without smearing target lashes into skin.
 * - Automatically extracts target foreground layers (forehead/hairline/maang tikka above brows,
 *   dark hair strands, jewelry/veil, glasses, and perimeter-invading hands/objects) to render ON TOP.
 */
object FaceSwapEdgeBlendShader {

    fun applyContrastAwareEdgeBlend(
        patch: Bitmap,
        targetSource: Bitmap,
        swapMatrix: Matrix,
        featherRatio: Float,
        smartBlend: Boolean = true,
        blendIntensity: Float = 0.78f,
        preserveHighContrastOcclusions: Boolean = true,
        donorContourNorm: List<Point2D> = emptyList(),
        foreheadCutYRatio: Float = 0.23f,
        preserveTargetLayers: Boolean = true,
        returnForegroundPunch: Boolean = false,
        foreheadCutShift: Float = 0f,
        foreheadSoftness: Float = 0.50f,
        foreheadToneHarmonize: Float = 0.65f,
        targetForeheadSkinRgb: Triple<Float, Float, Float>? = null,
        skinTextureMatch: Float = 0.45f
    ): Bitmap? {
        val w = patch.width
        val h = patch.height
        if (w < 12 || h < 12) return null

        val invMatrix = Matrix()
        if (!swapMatrix.invert(invMatrix)) {
            applyFallbackShaderFeather(patch, featherRatio, smartBlend)
            return null
        }

        val underlay = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val uCanvas = Canvas(underlay)
        uCanvas.drawBitmap(targetSource, invMatrix, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))

        val total = w * h
        val patchPixels = IntArray(total)
        val targetPixels = IntArray(total)
        patch.getPixels(patchPixels, 0, w, 0, 0, w, h)
        underlay.getPixels(targetPixels, 0, w, 0, 0, w, h)
        underlay.recycle()

        val targetLum = FloatArray(total)
        val patchLum = FloatArray(total)
        for (i in 0 until total) {
            val tc = targetPixels[i]
            targetLum[i] = 0.299f * Color.red(tc) + 0.587f * Color.green(tc) + 0.114f * Color.blue(tc)
            val pc = patchPixels[i]
            patchLum[i] = 0.299f * Color.red(pc) + 0.587f * Color.green(pc) + 0.114f * Color.blue(pc)
        }

        // Estimate clean mid-cheek skin reference (R, G, B, Lum) from destination underlay
        var skinRSum = 0f
        var skinGSum = 0f
        var skinBSum = 0f
        var skinLumSum = 0f
        var skinCount = 0
        val cy0 = (h * 0.44f).toInt().coerceIn(0, h - 1)
        val cy1 = (h * 0.72f).toInt().coerceIn(cy0, h - 1)
        val cx0 = (w * 0.26f).toInt().coerceIn(0, w - 1)
        val cx1 = (w * 0.74f).toInt().coerceIn(cx0, w - 1)
        for (y in cy0..cy1 step max(1, (cy1 - cy0) / 8)) {
            val row = y * w
            for (x in cx0..cx1 step max(1, (cx1 - cx0) / 8)) {
                val tc = targetPixels[row + x]
                if (Color.alpha(tc) > 200) {
                    val r = Color.red(tc)
                    val g = Color.green(tc)
                    val b = Color.blue(tc)
                    val l = targetLum[row + x]
                    if (r >= g && (r - b) > 6 && l in 52f..238f) {
                        skinRSum += r
                        skinGSum += g
                        skinBSum += b
                        skinLumSum += l
                        skinCount++
                    }
                }
            }
        }
        val targetSkinR = if (skinCount >= 6) skinRSum / skinCount else 188f
        val targetSkinG = if (skinCount >= 6) skinGSum / skinCount else 146f
        val targetSkinB = if (skinCount >= 6) skinBSum / skinCount else 124f
        val targetSkinLum = if (skinCount >= 6) skinLumSum / skinCount else 155f

        val contourLut = buildContourRadiusLut(donorContourNorm)

        // Wide solid facial core keeps original donor identity 100% sharp; outer band feathers cleanly
        val featherNorm = featherRatio.coerceIn(0.10f, 0.85f)
        val innerCore = (0.81f - featherNorm * 0.14f - if (smartBlend) 0.02f else 0f).coerceIn(0.62f, 0.86f)
        val halfW = w * 0.5f
        val halfH = h * 0.5f
        val rxInv = 1f / max(1f, halfW * 0.98f)
        val ryInv = 1f / max(1f, halfH * 0.98f)
        val wInv = 1f / max(1, w - 1)
        val hInv = 1f / max(1, h - 1)
        val clampedBlend = blendIntensity.coerceIn(0f, 1f)

        // Normalized radius grid [0..1+], precomputed for perimeter-connected occlusion BFS
        val rNormGrid = FloatArray(total)
        for (y in 0 until h) {
            val ny = (y - halfH) * ryInv
            val jawTaper = if (ny > 0.14f) (1f - (ny - 0.14f) * 0.16f).coerceIn(0.82f, 1f) else 1f
            val uY = y * hInv - 0.50f
            val row = y * w
            for (x in 0 until w) {
                val r = if (contourLut != null) {
                    val uX = x * wInv - 0.50f
                    val dist = hypot(uX.toDouble(), uY.toDouble()).toFloat()
                    var angDeg = Math.toDegrees(atan2(uY.toDouble(), uX.toDouble())).toFloat()
                    if (angDeg < 0f) angDeg += 360f
                    val bin = ((angDeg / 360f) * LUT_BINS).toInt().coerceIn(0, LUT_BINS - 1)
                    val maxRad = contourLut[bin]
                    dist / max(0.22f, maxRad)
                } else {
                    val nx = ((x - halfW) * rxInv) / jawTaper
                    sqrt(nx * nx + ny * ny)
                }
                rNormGrid[row + x] = r
            }
        }

        // Forehead-to-Brow Seamless Tone Harmonizer:
        // Match donor upper brow-ridge & temple skin tone/luminance into target forehead lighting
        // while keeping dark eyebrows, irises, and mid-face contrast untouched.
        val harmStrength = foreheadToneHarmonize.coerceIn(0f, 1f)
        val effectiveForeCut = (foreheadCutYRatio - foreheadCutShift.coerceIn(-0.14f, 0.14f) * 0.45f).coerceIn(0.06f, 0.36f)
        if (harmStrength > 0.02f) {
            var browRSum = 0f
            var browGSum = 0f
            var browBSum = 0f
            var browCnt = 0
            val by0 = (effectiveForeCut * h).toInt().coerceIn(0, h - 1)
            val by1 = ((effectiveForeCut + 0.14f) * h).toInt().coerceIn(by0, h - 1)
            val bx0 = (w * 0.26f).toInt().coerceIn(0, w - 1)
            val bx1 = (w * 0.74f).toInt().coerceIn(bx0, w - 1)
            for (y in by0..by1 step max(1, (by1 - by0) / 6)) {
                val row = y * w
                for (x in bx0..bx1 step max(1, (bx1 - bx0) / 8)) {
                    val pc = patchPixels[row + x]
                    if (Color.alpha(pc) > 180) {
                        val pr = Color.red(pc)
                        val pg = Color.green(pc)
                        val pb = Color.blue(pc)
                        val pl = patchLum[row + x]
                        if (pr >= pg && (pr - pb) >= 2 && pl > 58f) {
                            browRSum += pr
                            browGSum += pg
                            browBSum += pb
                            browCnt++
                        }
                    }
                }
            }
            val refForeR = targetForeheadSkinRgb?.first ?: targetSkinR
            val refForeG = targetForeheadSkinRgb?.second ?: targetSkinG
            val refForeB = targetForeheadSkinRgb?.third ?: targetSkinB
            if (browCnt >= 4) {
                val dBrowR = browRSum / browCnt
                val dBrowG = browGSum / browCnt
                val dBrowB = browBSum / browCnt
                val deltaR = (refForeR - dBrowR).coerceIn(-48f, 48f)
                val deltaG = (refForeG - dBrowG).coerceIn(-48f, 48f)
                val deltaB = (refForeB - dBrowB).coerceIn(-48f, 48f)
                val endY = ((effectiveForeCut + 0.16f + foreheadSoftness.coerceIn(0.15f, 1f) * 0.08f) * h)
                    .toInt().coerceIn(2, h)
                val bandSpan = max(8f, endY - effectiveForeCut * h * 0.4f)
                for (y in 0 until endY) {
                    val row = y * w
                    val yt = ((endY - y) / bandSpan).coerceIn(0f, 1f)
                    val wVert = (yt * yt * (3f - 2f * yt)) * harmStrength * 0.85f
                    if (wVert <= 0.01f) continue
                    for (x in 0 until w) {
                        val idx = row + x
                        val pc = patchPixels[idx]
                        val pA = Color.alpha(pc)
                        if (pA < 10) continue
                        val pr = Color.red(pc)
                        val pg = Color.green(pc)
                        val pb = Color.blue(pc)
                        val pl = patchLum[idx]
                        // Protect dark eyebrow hairs & lashes from washing out
                        val skinWeight = ((pl - 44f) / 48f).coerceIn(0f, 1f)
                        if (skinWeight <= 0.02f) continue
                        val k = wVert * skinWeight
                        val nr = (pr + deltaR * k).toInt().coerceIn(0, 255)
                        val ng = (pg + deltaG * k).toInt().coerceIn(0, 255)
                        val nb = (pb + deltaB * k).toInt().coerceIn(0, 255)
                        patchPixels[idx] = Color.argb(pA, nr, ng, nb)
                        patchLum[idx] = 0.299f * nr + 0.587f * ng + 0.114f * nb
                    }
                }
            }
        }

        // Real Skin Pore & Grain Matching (anti-plastic realism):
        // Measure target camera skin micro-grain on clean skin pixels and match it across donor skin midtones
        // while keeping eyes, brows, lashes, and lip contours crisp.
        val texStrength = skinTextureMatch.coerceIn(0f, 1f)
        if (texStrength > 0.02f) {
            var grainSum = 0f
            var grainCount = 0
            for (y in cy0..cy1 step max(1, (cy1 - cy0) / 10)) {
                val row = y * w
                val yUp = if (y > 0) (y - 1) * w else row
                val yDn = if (y < h - 1) (y + 1) * w else row
                for (x in cx0..cx1 step max(1, (cx1 - cx0) / 10)) {
                    val idx = row + x
                    val tc = targetPixels[idx]
                    if (Color.alpha(tc) > 200) {
                        val tr = Color.red(tc)
                        val tg = Color.green(tc)
                        val tb = Color.blue(tc)
                        if (tr >= tg && (tr - tb) > 4 && targetLum[idx] in 50f..238f) {
                            val xL = if (x > 0) x - 1 else x
                            val xR = if (x < w - 1) x + 1 else x
                            val localBlur = (targetLum[row + xL] + targetLum[row + xR] + targetLum[yUp + x] + targetLum[yDn + x]) * 0.25f
                            val hf = abs(targetLum[idx] - localBlur)
                            if (hf < 9.5f) {
                                grainSum += hf
                                grainCount++
                            }
                        }
                    }
                }
            }
            val targetGrainAmp = if (grainCount >= 6) (grainSum / grainCount).coerceIn(0.6f, 6.5f) else 2.2f
            for (y in 1 until h - 1) {
                val row = y * w
                val yUp = (y - 1) * w
                val yDn = (y + 1) * w
                for (x in 1 until w - 1) {
                    val idx = row + x
                    if (rNormGrid[idx] > 0.94f) continue
                    val pc = patchPixels[idx]
                    val pA = Color.alpha(pc)
                    if (pA < 120) continue
                    val pl = patchLum[idx]
                    if (pl !in 52f..236f) continue
                    val pr = Color.red(pc)
                    val pg = Color.green(pc)
                    val pb = Color.blue(pc)
                    if (pr < pg) continue

                    val pGrad = (abs(patchLum[row + x + 1] - patchLum[row + x - 1]) +
                        abs(patchLum[yDn + x] - patchLum[yUp + x])) * 0.5f
                    // Protect sharp eye/brow/lip edges
                    if (pGrad > 13.5f) continue

                    val smoothMask = ((13.5f - pGrad) / 9f).coerceIn(0f, 1f)
                    val tc = targetPixels[idx]
                    val tDetail = if (Color.alpha(tc) > 180 &&
                        Color.red(tc) >= Color.green(tc) &&
                        (abs(Color.red(tc) - targetSkinR) + abs(Color.green(tc) - targetSkinG) + abs(Color.blue(tc) - targetSkinB)) < 75f
                    ) {
                        val tBlur = (targetLum[row + x - 1] + targetLum[row + x + 1] + targetLum[yUp + x] + targetLum[yDn + x]) * 0.25f
                        (targetLum[idx] - tBlur).coerceIn(-6.5f, 6.5f)
                    } else 0f

                    val hash = (((x * 73856093) xor (y * 19349663)) and 0xFF) / 127.5f - 1.0f
                    val grainDelta = ((hash * targetGrainAmp * 1.15f + tDetail * 0.45f) * texStrength * smoothMask)
                        .coerceIn(-11f, 11f)
                    if (abs(grainDelta) > 0.35f) {
                        val nr = (pr + grainDelta).toInt().coerceIn(0, 255)
                        val ng = (pg + grainDelta).toInt().coerceIn(0, 255)
                        val nb = (pb + grainDelta).toInt().coerceIn(0, 255)
                        patchPixels[idx] = Color.argb(pA, nr, ng, nb)
                        patchLum[idx] = 0.299f * nr + 0.587f * ng + 0.114f * nb
                    }
                }
            }
        }

        // Layer 3 foreground occlusion mask (0..1 -> higher means reveal original target foreground ON TOP)
        val occlusionMask = if (preserveTargetLayers || preserveHighContrastOcclusions) {
            detectForegroundOcclusionMask(
                w = w,
                h = h,
                targetPixels = targetPixels,
                targetLum = targetLum,
                rNormGrid = rNormGrid,
                targetSkinR = targetSkinR,
                targetSkinG = targetSkinG,
                targetSkinB = targetSkinB,
                targetSkinLum = targetSkinLum,
                foreheadCutYRatio = effectiveForeCut,
                foreheadSoftness = foreheadSoftness,
                preserveTargetLayers = preserveTargetLayers,
                preserveHighContrastOcclusions = preserveHighContrastOcclusions
            )
        } else {
            null
        }

        for (y in 0 until h) {
            val row = y * w
            val yUp = if (y > 0) (y - 1) * w else row
            val yDown = if (y < h - 1) (y + 1) * w else row
            for (x in 0 until w) {
                val idx = row + x
                val r = rNormGrid[idx]

                if (r >= 1.0f) {
                    patchPixels[idx] = Color.TRANSPARENT
                    continue
                }

                val pc = patchPixels[idx]
                val pA = Color.alpha(pc)
                if (pA == 0) continue

                val tc = targetPixels[idx]
                val tcAlpha = Color.alpha(tc)
                val xL = if (x > 0) x - 1 else x
                val xR = if (x < w - 1) x + 1 else x

                val pGx = patchLum[row + xR] - patchLum[row + xL]
                val pGy = patchLum[yDown + x] - patchLum[yUp + x]
                val patchGrad = (abs(pGx) + abs(pGy)) * 0.5f

                val targetGrad = if (tcAlpha > 25 &&
                    Color.alpha(targetPixels[row + xL]) > 25 &&
                    Color.alpha(targetPixels[row + xR]) > 25 &&
                    Color.alpha(targetPixels[yUp + x]) > 25 &&
                    Color.alpha(targetPixels[yDown + x]) > 25
                ) {
                    val tGx = targetLum[row + xR] - targetLum[row + xL]
                    val tGy = targetLum[yDown + x] - targetLum[yUp + x]
                    (abs(tGx) + abs(tGy)) * 0.5f
                } else {
                    patchGrad
                }

                val occReveal = occlusionMask?.get(idx) ?: 0f

                if (r <= innerCore) {
                    if (occReveal > 0.03f) {
                        val outA = (pA * (1f - occReveal)).toInt().coerceIn(0, 255)
                        if (outA < 3) {
                            patchPixels[idx] = Color.TRANSPARENT
                        } else {
                            patchPixels[idx] = Color.argb(outA, Color.red(pc), Color.green(pc), Color.blue(pc))
                        }
                    }
                    continue
                }

                val t = ((r - innerCore) / max(0.01f, 1.0f - innerCore)).coerceIn(0f, 1f)
                val contrastEnergy = max(targetGrad, targetGrad * 0.62f + patchGrad * 0.38f)
                val contrastFactor = (contrastEnergy / 30f).coerceIn(0f, 1f)

                val pR = Color.red(pc)
                val pG = Color.green(pc)
                val pB = Color.blue(pc)
                val tR = Color.red(tc)
                val tG = Color.green(tc)
                val tB = Color.blue(tc)

                val baseHermite = 1f - (t * t * (3f - 2f * t))
                val contrastExponent = 1.08f + (1f - contrastFactor) * 0.36f - contrastFactor * 0.16f
                var borderAlpha = baseHermite.pow(contrastExponent) * (1f - occReveal)

                // On the outer cheek/jaw rim, avoid harsh cutout lines against strong target edges
                if (preserveHighContrastOcclusions && tcAlpha > 25 && r > 0.84f && targetGrad > 16f && targetGrad > patchGrad * 1.2f) {
                    val occlusionWeight = ((targetGrad - 16f) / 34f).coerceIn(0f, 0.85f)
                    val rimFactor = ((r - 0.84f) / 0.16f).coerceIn(0f, 1f)
                    borderAlpha *= (1f - occlusionWeight * rimFactor * 0.72f)
                }

                val outAlpha = (pA * borderAlpha).toInt().coerceIn(0, 255)
                if (outAlpha < 2) {
                    patchPixels[idx] = Color.TRANSPARENT
                    continue
                }

                // Gentle skin-only rim color integration ONLY near outer feather border (never smears lashes/brows)
                val rOut: Int
                val gOut: Int
                val bOut: Int
                val isTargetSkinLike = tcAlpha > 180 &&
                    targetLum[idx] > 48f &&
                    tR >= tG &&
                    (abs(tR - targetSkinR) + abs(tG - targetSkinG) + abs(tB - targetSkinB)) < 110f

                if (smartBlend && clampedBlend > 0.01f && isTargetSkinLike && t > 0.25f) {
                    val rimT = ((t - 0.25f) / 0.75f).coerceIn(0f, 1f)
                    val pullStrength = (rimT * rimT * (1f - contrastFactor * 0.55f) * 0.26f * clampedBlend).coerceIn(0f, 0.26f)
                    rOut = (pR + (tR - pR) * pullStrength).toInt().coerceIn(0, 255)
                    gOut = (pG + (tG - pG) * pullStrength).toInt().coerceIn(0, 255)
                    bOut = (pB + (tB - pB) * pullStrength).toInt().coerceIn(0, 255)
                } else {
                    rOut = pR
                    gOut = pG
                    bOut = pB
                }

                patchPixels[idx] = Color.argb(outAlpha, rOut, gOut, bOut)
            }
        }

        patch.setPixels(patchPixels, 0, w, 0, 0, w, h)

        if (!returnForegroundPunch || occlusionMask == null) {
            return null
        }

        val punchPixels = IntArray(total)
        for (i in 0 until total) {
            val a = (occlusionMask[i] * 255f).toInt().coerceIn(0, 255)
            punchPixels[i] = if (a > 6) Color.argb(a, 255, 255, 255) else Color.TRANSPARENT
        }
        return Bitmap.createBitmap(punchPixels, w, h, Bitmap.Config.ARGB_8888).apply {
            setHasAlpha(true)
        }
    }

    /**
     * Automatically builds Layer 3 (Foreground Target Reveal Matte) combining:
     * 1) Forehead / Hairline / Maang Tikka layer cleanly starting just above the eyebrows,
     * 2) Dark hair strands & bangs, bright veil / jewelry / glasses,
     * 3) Perimeter-seeded foreign foreground objects (hands, fingers, flowers, props) crossing cheeks/chin.
     */
    private fun detectForegroundOcclusionMask(
        w: Int,
        h: Int,
        targetPixels: IntArray,
        targetLum: FloatArray,
        rNormGrid: FloatArray,
        targetSkinR: Float,
        targetSkinG: Float,
        targetSkinB: Float,
        targetSkinLum: Float,
        foreheadCutYRatio: Float,
        foreheadSoftness: Float,
        preserveTargetLayers: Boolean,
        preserveHighContrastOcclusions: Boolean
    ): FloatArray {
        val total = w * h
        val mask = FloatArray(total)
        val visited = BooleanArray(total)
        val queue = IntArray(total)
        var qHead = 0
        var qTail = 0

        val foreCut = foreheadCutYRatio.coerceIn(0.06f, 0.36f)
        val foreFadeBand = (0.03f + foreheadSoftness.coerceIn(0.15f, 1.0f) * 0.13f)
        val darkHairCutoff = min(92f, targetSkinLum * 0.64f)
        val brightJewelCutoff = max(182f, targetSkinLum + 20f)
        val hInv = 1f / max(1, h - 1)
        val wInv = 1f / max(1, w - 1)

        // Sample dominant hair tone from crown above forehead
        var hSumR = 0L
        var hSumG = 0L
        var hSumB = 0L
        var hCnt = 0
        val crownMaxY = ((foreCut - 0.03f).coerceAtLeast(0.05f) * h).toInt().coerceIn(2, h - 1)
        for (y in 0 until crownMaxY) {
            val row = y * w
            for (x in 0 until w) {
                val idx = row + x
                if (rNormGrid[idx] > 1.03f) continue
                val tc = targetPixels[idx]
                if (Color.alpha(tc) < 40) continue
                val tr = Color.red(tc)
                val tg = Color.green(tc)
                val tb = Color.blue(tc)
                val sDist = abs(tr - targetSkinR) + abs(tg - targetSkinG) + abs(tb - targetSkinB)
                if (sDist > 38f || targetLum[idx] < targetSkinLum * 0.72f) {
                    hSumR += tr; hSumG += tg; hSumB += tb; hCnt++
                }
            }
        }
        val hasCrownHairRef = hCnt >= 10
        val hairRefR = if (hasCrownHairRef) hSumR.toFloat() / hCnt else 32f
        val hairRefG = if (hasCrownHairRef) hSumG.toFloat() / hCnt else 28f
        val hairRefB = if (hasCrownHairRef) hSumB.toFloat() / hCnt else 26f

        for (y in 0 until h) {
            val v = y * hInv
            val row = y * w
            val yUp = if (y > 0) (y - 1) * w else row
            val yDown = if (y < h - 1) (y + 1) * w else row

            for (x in 0 until w) {
                val idx = row + x
                val r = rNormGrid[idx]
                if (r > 1.03f) continue

                val tc = targetPixels[idx]
                if (Color.alpha(tc) < 30) continue

                val uAbs = abs(x * wInv - 0.50f) * 2f // 0 at center, ~1 at edge
                var reveal = 0f

                // 1) Automatic Forehead / Hairline / Maang Tikka top layer above donor eyebrows
                if (preserveTargetLayers) {
                    val archedCut = foreCut - uAbs * 0.035f
                    if (v < archedCut) {
                        val ft = ((archedCut - v) / foreFadeBand).coerceIn(0f, 1f)
                        val smoothFt = ft * ft * (3f - 2f * ft)
                        reveal = max(reveal, if (ft >= 0.62f) 1f else smoothFt)
                    }
                }

                if (preserveHighContrastOcclusions) {
                    val tR = Color.red(tc)
                    val tG = Color.green(tc)
                    val tB = Color.blue(tc)
                    val tLum = targetLum[idx]
                    val maxC = max(tR, max(tG, tB))
                    val minC = min(tR, min(tG, tB))
                    val tSat = if (maxC > 0) (maxC - minC).toFloat() / maxC else 0f
                    val colorDist = abs(tR - targetSkinR) + abs(tG - targetSkinG) + abs(tB - targetSkinB)

                    val xL = if (x > 0) x - 1 else x
                    val xR = if (x < w - 1) x + 1 else x
                    val tGrad = (abs(targetLum[row + xR] - targetLum[row + xL]) +
                        abs(targetLum[yDown + x] - targetLum[yUp + x])) * 0.5f

                    // Guard left & right orbital eye sockets/lashes while leaving center glabella open for bindis/tikka!
                    val inEyeSockets = v in (foreCut + 0.02f)..(foreCut + 0.27f) && (uAbs in 0.17f..0.76f)
                    val inNoseMouthCore = v in (foreCut + 0.16f)..0.82f && uAbs < 0.44f

                    // 2a) Forehead jewelry (maang tikka, bindi, matha patti, gold chains, pearls, veil, glasses)
                    val inUpperZone = v < (foreCut + 0.16f) && uAbs < 0.88f
                    val inGlabellaOrnament = v < (foreCut + 0.22f) && uAbs < 0.22f
                    if (!inEyeSockets && (inUpperZone || inGlabellaOrnament || r > 0.76f)) {
                        val isBrightJewel = tLum > brightJewelCutoff && (tGrad > 6f || tSat < 0.26f || colorDist > 32f)
                        val isGoldMetal = tR > targetSkinR * 0.78f && (tR - tB) > 22f && colorDist > 26f &&
                            ((tSat > 0.30f && (tR - tB) > 32f) || tGrad > 8.5f)
                        val isColoredGemOrBindi = tSat > 0.34f && colorDist > 38f && (inGlabellaOrnament || v < foreCut + 0.14f)
                        val isDarkBindi = inGlabellaOrnament && uAbs < 0.16f && v > (foreCut - 0.10f) &&
                            tLum < targetSkinLum * 0.64f && colorDist > 36f
                        val isFiligree = (inGlabellaOrnament || v < foreCut + 0.06f) && colorDist > 38f && tGrad > 9.5f && tLum > 38f &&
                            !(hasCrownHairRef && abs(tR - hairRefR) + abs(tG - hairRefG) + abs(tB - hairRefB) < 38f)
                        if (isBrightJewel || isGoldMetal || isColoredGemOrBindi || isDarkBindi || isFiligree) {
                            val sStr = when {
                                isBrightJewel -> ((tLum - (brightJewelCutoff - 8f)) / 32f).coerceIn(0.72f, 1f)
                                isColoredGemOrBindi -> (colorDist / 66f).coerceIn(0.78f, 1f)
                                isDarkBindi -> ((targetSkinLum * 0.72f - tLum) / 34f).coerceIn(0.82f, 1f)
                                isGoldMetal -> (colorDist / 58f).coerceIn(0.75f, 1f)
                                else -> (tGrad / 20f).coerceIn(0.72f, 0.98f)
                            }
                            reveal = max(reveal, if (sStr > 0.82f) 1f else sStr)
                        }
                    }

                    // 2b) Dark + colored/brown/lit hair strands / parting / bangs on forehead, temples, or jaw rim
                    val inHairPerimeter = v < (foreCut + 0.10f) || uAbs > 0.70f || r > 0.80f
                    if (!inEyeSockets && !inNoseMouthCore && inHairPerimeter) {
                        val hairDist = if (hasCrownHairRef) {
                            abs(tR - hairRefR) + abs(tG - hairRefG) + abs(tB - hairRefB)
                        } else 999f
                        val isDarkHair = tLum < darkHairCutoff
                        val matchesHair = hasCrownHairRef && hairDist < 84f && hairDist < colorDist * 0.92f && colorDist > 22f
                        val isLitHair = colorDist > 36f && (tLum < targetSkinLum - 12f || tLum > targetSkinLum + 22f) &&
                            (v < foreCut + 0.05f || r > 0.80f) && tSat < 0.62f &&
                            (tLum < targetSkinLum - 14f || tGrad > 7f || r > 0.86f)
                        if (isDarkHair || matchesHair || isLitHair) {
                            val hStr = when {
                                isDarkHair -> ((darkHairCutoff + 8f - tLum) / 32f).coerceIn(0.70f, 1f)
                                matchesHair -> ((86f - hairDist) / 44f).coerceIn(0.68f, 1f)
                                else -> (colorDist / 72f).coerceIn(0.62f, 0.98f)
                            }
                            reveal = max(reveal, if (hStr > 0.84f) 1f else hStr)
                        }
                    }

                    // 3) Seed perimeter BFS for continuous foreground objects (hands, fingers, flowers, veil, sleeves)
                    if (preserveTargetLayers && !inEyeSockets && r in 0.82f..0.99f) {
                        val isForeignTint = colorDist > 64f ||
                            tLum < darkHairCutoff ||
                            (tLum > brightJewelCutoff && tSat < 0.26f)
                        val isSharpHandEdge = tGrad > 13f && colorDist > 24f
                        if (isForeignTint || isSharpHandEdge) {
                            visited[idx] = true
                            queue[qTail++] = idx
                            reveal = max(reveal, if (isForeignTint) 0.92f else 0.78f)
                        }
                    }
                }

                if (reveal > 0f) {
                    mask[idx] = reveal
                }
            }
        }

        // Propagate perimeter-seeded foreground occluders (hair locks, flowers, fingers, sleeves) inward
        // only across pixels matching seed color stability, stopping cleanly outside central eyes/nose/mouth
        val dx4 = intArrayOf(-1, 1, 0, 0)
        val dy4 = intArrayOf(0, 0, -1, 1)
        while (qHead < qTail) {
            val cur = queue[qHead++]
            val cx = cur % w
            val cy = cur / w
            val cPix = targetPixels[cur]
            val cR = Color.red(cPix)
            val cG = Color.green(cPix)
            val cB = Color.blue(cPix)
            val cVal = mask[cur]

            for (dir in 0..3) {
                val nx = cx + dx4[dir]
                val ny = cy + dy4[dir]
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
                val nIdx = ny * w + nx
                if (visited[nIdx]) continue

                val nr = rNormGrid[nIdx]
                // Never propagate past outer cheek/chin perimeter into central eye/nose T-zone
                if (nr < 0.42f || nr > 0.99f) continue

                val nv = ny * hInv
                val nuAbs = abs(nx * wInv - 0.50f) * 2f
                // Keep left/right orbital eye core protected while allowing BFS along center glabella jewelry
                if (nv in (foreCut + 0.02f)..(foreCut + 0.27f) && (nuAbs in 0.17f..0.76f)) continue

                val nPix = targetPixels[nIdx]
                if (Color.alpha(nPix) < 30) continue
                val nR = Color.red(nPix)
                val nG = Color.green(nPix)
                val nB = Color.blue(nPix)
                val nMaxC = max(nR, max(nG, nB))
                val nMinC = min(nR, min(nG, nB))
                val nSat = if (nMaxC > 0) (nMaxC - nMinC).toFloat() / nMaxC else 0f

                val stepDiff = abs(nR - cR) + abs(nG - cG) + abs(nB - cB)
                val skinDist = abs(nR - targetSkinR) + abs(nG - targetSkinG) + abs(nB - targetSkinB)
                val nLum = targetLum[nIdx]

                // Continue along coherent object surfaces (hair, cloth, jewelry/gems, petal, dark rim)
                val stillForegroundObj = stepDiff < 42f &&
                    (skinDist > 48f || nLum < darkHairCutoff || nLum > brightJewelCutoff || nSat > 0.34f)
                if (stillForegroundObj) {
                    visited[nIdx] = true
                    queue[qTail++] = nIdx
                    val decayed = (cVal * 0.985f).coerceIn(0f, 0.95f)
                    if (decayed > mask[nIdx]) {
                        mask[nIdx] = decayed
                    }
                }
            }
        }

        return mask
    }

    private const val LUT_BINS = 144

    private fun buildContourRadiusLut(contourNorm: List<Point2D>): FloatArray? {
        if (contourNorm.size < 12) return null
        val angles = FloatArray(contourNorm.size)
        val radii = FloatArray(contourNorm.size)
        for (i in contourNorm.indices) {
            val dx = contourNorm[i].x - 0.50f
            val dy = contourNorm[i].y - 0.50f
            var ang = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
            if (ang < 0f) ang += 360f
            angles[i] = ang
            radii[i] = hypot(dx.toDouble(), dy.toDouble()).toFloat().coerceIn(0.24f, 0.56f)
        }

        // Sort points by angle around (0.5, 0.5) so linear angular interpolation works on any vertex order
        val order = contourNorm.indices.sortedBy { angles[it] }
        val sortedA = FloatArray(order.size)
        val sortedR = FloatArray(order.size)
        for (i in order.indices) {
            sortedA[i] = angles[order[i]]
            sortedR[i] = radii[order[i]]
        }

        val lut = FloatArray(LUT_BINS)
        val n = sortedA.size
        for (b in 0 until LUT_BINS) {
            val deg = (b + 0.5f) * (360f / LUT_BINS)
            var idx = 0
            while (idx < n && sortedA[idx] < deg) idx++
            val p0 = (idx - 1 + n) % n
            val p1 = idx % n
            var a0 = sortedA[p0]
            var a1 = sortedA[p1]
            if (p1 == 0 && p0 == n - 1) {
                a1 += 360f
            } else if (a1 < a0) {
                a1 += 360f
            }
            var q = deg
            if (q < a0) q += 360f
            val span = max(1e-3f, a1 - a0)
            val t = ((q - a0) / span).coerceIn(0f, 1f)
            lut[b] = (sortedR[p0] + (sortedR[p1] - sortedR[p0]) * t) * 0.99f
        }
        return lut
    }

    /**
     * Radial feather fallback when swap matrix inversion is degenerate.
     */
    fun applyFallbackShaderFeather(
        patch: Bitmap,
        featherRatio: Float,
        smartBlend: Boolean
    ) {
        val w = patch.width
        val h = patch.height
        val canvas = Canvas(patch)
        val innerStop = (0.82f - featherRatio * 0.16f - if (smartBlend) 0.03f else 0f).coerceIn(0.62f, 0.85f)
        val gradient = RadialGradient(
            0f,
            0f,
            1f,
            intArrayOf(Color.WHITE, Color.WHITE, Color.argb(180, 255, 255, 255), Color.TRANSPARENT),
            floatArrayOf(0f, innerStop, (innerStop + 1f) * 0.52f, 1f),
            Shader.TileMode.CLAMP
        )
        gradient.setLocalMatrix(
            Matrix().apply {
                setScale(w * 0.49f, h * 0.49f)
                postTranslate(w * 0.5f, h * 0.5f)
            }
        )
        val shaderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = gradient
            xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
        }
        canvas.drawRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), shaderPaint)
    }
}
