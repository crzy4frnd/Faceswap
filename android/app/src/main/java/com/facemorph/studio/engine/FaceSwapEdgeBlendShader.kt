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
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Texture-Contrast-Aware Feathering & Occlusion-Preserving Edge-Blending Shader Module.
 *
 * Extracts the exact geometrically aligned target skin underlay via inverse swap-matrix projection,
 * maintains a 100%-opaque anatomical inner core (brows, eyes, nose, lips, cheekbones) so the swapped
 * identity never ghosts or double-exposes, recovers foreground jewelry/hairline/veil occlusions over
 * the forehead & temples, and softly feathers perimeter skin into the destination frame.
 */
object FaceSwapEdgeBlendShader {

    fun applyContrastAwareEdgeBlend(
        patch: Bitmap,
        targetSource: Bitmap,
        swapMatrix: Matrix,
        featherRatio: Float,
        smartBlend: Boolean = true,
        blendIntensity: Float = 0.78f,
        preserveHighContrastOcclusions: Boolean = true
    ) {
        val w = patch.width
        val h = patch.height
        if (w < 12 || h < 12) return

        val invMatrix = Matrix()
        if (!swapMatrix.invert(invMatrix)) {
            applyFallbackShaderFeather(patch, featherRatio, smartBlend)
            return
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

        // Estimate destination mid-cheek skin luminance for hairline & jewelry occlusion separation
        var skinLumSum = 0f
        var skinLumCount = 0
        val cy0 = (h * 0.42f).toInt().coerceIn(0, h - 1)
        val cy1 = (h * 0.68f).toInt().coerceIn(cy0, h - 1)
        val cx0 = (w * 0.28f).toInt().coerceIn(0, w - 1)
        val cx1 = (w * 0.72f).toInt().coerceIn(cx0, w - 1)
        for (y in cy0..cy1 step max(1, (cy1 - cy0) / 8)) {
            val row = y * w
            for (x in cx0..cx1 step max(1, (cx1 - cx0) / 8)) {
                val tc = targetPixels[row + x]
                if (Color.alpha(tc) > 200) {
                    val r = Color.red(tc)
                    val g = Color.green(tc)
                    val b = Color.blue(tc)
                    if (r > g && (r - b) > 8 && targetLum[row + x] in 50f..238f) {
                        skinLumSum += targetLum[row + x]
                        skinLumCount++
                    }
                }
            }
        }
        val targetSkinLum = if (skinLumCount >= 6) skinLumSum / skinLumCount else 155f

        // Wide anatomical inner core so brows, eyes, nose, and mouth render at full 100% solid clarity
        val featherNorm = featherRatio.coerceIn(0.12f, 0.88f)
        val innerCore = (0.83f - featherNorm * 0.16f - if (smartBlend) 0.03f else 0f).coerceIn(0.62f, 0.86f)
        val halfW = w * 0.5f
        val halfH = h * 0.5f
        val rxInv = 1f / max(1f, halfW * 0.98f)
        val ryInv = 1f / max(1f, halfH * 0.98f)
        val clampedBlend = blendIntensity.coerceIn(0f, 1f)

        for (y in 0 until h) {
            val ny = (y - halfH) * ryInv
            val nySq = ny * ny
            // Taper lower jaw slightly for natural anatomical chin oval (matches face silhouette cleanly)
            val jawTaper = if (ny > 0.12f) (1f - (ny - 0.12f) * 0.18f).coerceIn(0.80f, 1f) else 1f
            val row = y * w
            val yUp = if (y > 0) (y - 1) * w else row
            val yDown = if (y < h - 1) (y + 1) * w else row
            val vFrac = y.toFloat() / h

            for (x in 0 until w) {
                val nx = ((x - halfW) * rxInv) / jawTaper
                val r = sqrt(nx * nx + nySq)
                val idx = row + x

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

                // Foreground occlusion preservation (forehead jewelry/maang tikka, dark bangs/hairline, veil/glasses)
                var occlusionReveal = 0f
                if (preserveHighContrastOcclusions && tcAlpha > 25) {
                    val tR = Color.red(tc)
                    val tG = Color.green(tc)
                    val tB = Color.blue(tc)
                    val tLum = targetLum[idx]
                    val maxC = max(tR, max(tG, tB))
                    val minC = min(tR, min(tG, tB))
                    val tSat = if (maxC > 0) (maxC - minC).toFloat() / maxC else 0f

                    // Upper forehead jewelry/sparkle (e.g. maang tikka, pearl veil border, diamond stud)
                    val inUpperZone = vFrac < 0.34f && abs(nx) < 0.72f
                    val inMidlineOrnament = vFrac < 0.38f && abs(nx) < 0.22f
                    if ((inUpperZone || inMidlineOrnament || r > innerCore * 0.84f) &&
                        tLum > max(188f, targetSkinLum + 26f) &&
                        (targetGrad > 9f || tSat < 0.20f)
                    ) {
                        val sparkleStrength = ((tLum - max(184f, targetSkinLum + 22f)) / 42f).coerceIn(0f, 1f)
                        occlusionReveal = max(occlusionReveal, sparkleStrength * 0.94f)
                    }

                    // Dense dark hairline / parting / bangs on upper forehead or temple perimeter
                    val inHairZone = vFrac < 0.27f || (vFrac < 0.48f && abs(nx) > 0.62f) || r > innerCore * 0.88f
                    if (inHairZone && tLum < min(74f, targetSkinLum * 0.56f)) {
                        val hairStrength = ((min(74f, targetSkinLum * 0.58f) - tLum) / 36f).coerceIn(0f, 1f)
                        occlusionReveal = max(occlusionReveal, hairStrength * 0.94f)
                    }
                }

                if (r <= innerCore) {
                    if (occlusionReveal > 0.04f) {
                        val outA = (pA * (1f - occlusionReveal)).toInt().coerceIn(0, 255)
                        if (outA < 4) {
                            patchPixels[idx] = Color.TRANSPARENT
                        } else {
                            patchPixels[idx] = Color.argb(outA, Color.red(pc), Color.green(pc), Color.blue(pc))
                        }
                    }
                    continue
                }

                val t = ((r - innerCore) / max(0.01f, 1.0f - innerCore)).coerceIn(0f, 1f)
                val contrastEnergy = max(targetGrad, targetGrad * 0.68f + patchGrad * 0.32f)
                val contrastFactor = (contrastEnergy / 28f).coerceIn(0f, 1f)

                val pR = Color.red(pc)
                val pG = Color.green(pc)
                val pB = Color.blue(pc)
                val tR = Color.red(tc)
                val tG = Color.green(tc)
                val tB = Color.blue(tc)
                val colorDiff = if (tcAlpha > 25) {
                    (abs(pR - tR) + abs(pG - tG) + abs(pB - tB)) / (3f * 52f)
                } else {
                    0f
                }

                val baseHermite = 1f - (t * t * (3f - 2f * t))
                val contrastExponent = 1.10f + (1f - contrastFactor) * 0.42f - contrastFactor * 0.20f
                var borderAlpha = baseHermite.pow(contrastExponent)

                if (preserveHighContrastOcclusions && tcAlpha > 25 && targetGrad > 14f && targetGrad > patchGrad * 1.15f) {
                    val occlusionWeight = ((targetGrad - 14f) / 32f).coerceIn(0f, 0.88f)
                    val edgeProximity = (0.28f + 0.72f * t).coerceIn(0f, 1f)
                    borderAlpha *= (1f - occlusionWeight * edgeProximity * 0.78f)
                }

                borderAlpha *= (1f - occlusionReveal)

                if (smartBlend && colorDiff > 0.28f) {
                    val toneSoften = (1f - min(0.28f, (colorDiff - 0.28f) * 0.20f * t))
                    borderAlpha *= toneSoften
                }

                val outAlpha = (pA * borderAlpha).toInt().coerceIn(0, 255)
                if (outAlpha < 2) {
                    patchPixels[idx] = Color.TRANSPARENT
                    continue
                }

                val rOut: Int
                val gOut: Int
                val bOut: Int
                if (smartBlend && clampedBlend > 0.01f && tcAlpha > 25) {
                    val pullStrength = (t * (1f - contrastFactor * 0.48f) * 0.44f * clampedBlend).coerceIn(0f, 0.48f)
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
