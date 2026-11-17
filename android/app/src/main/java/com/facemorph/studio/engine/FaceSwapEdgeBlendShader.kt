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
 * Texture-Contrast-Aware Feathering & Edge-Blending Shader Module for Face-Swap Output.
 *
 * Extracts the exact geometrically aligned target skin underlay via inverse swap-matrix projection,
 * computes local luminance texture gradients and RGB discrepancy around the perimeter ring, and:
 *  1) Applies wide, silky cubic falloff across smooth skin regions to dissolve seams invisibly.
 *  2) Tightens border roll-off cleanly over high-contrast occlusions (hair, glasses, stubble, jaw shadows)
 *     so original sharp features stay crisp without muddy double-exposure ghosting.
 *  3) Performs a harmonic boundary luminance/chroma pull so lighting transitions seamlessly into
 *     the destination cheek/forehead skin tone while preserving full central eye/nose/lip sharpness.
 */
object FaceSwapEdgeBlendShader {

    fun applyContrastAwareEdgeBlend(
        patch: Bitmap,
        targetSource: Bitmap,
        swapMatrix: Matrix,
        featherRatio: Float,
        smartBlend: Boolean = true,
        blendIntensity: Float = 0.82f,
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

        // Sample exact geometrically aligned target underlay pixels underneath the swapped patch
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

        // Solid opaque interior core (preserves razor-sharp eyes, nose, and lips); outer ring softens via contrast shader
        val featherNorm = featherRatio.coerceIn(0.15f, 0.88f)
        val innerCore = (0.74f - featherNorm * 0.24f - if (smartBlend) 0.05f else 0f).coerceIn(0.46f, 0.78f)
        val halfW = w * 0.5f
        val halfH = h * 0.5f
        val rxInv = 1f / max(1f, halfW * 0.98f)
        val ryInv = 1f / max(1f, halfH * 0.98f)
        val clampedBlend = blendIntensity.coerceIn(0f, 1f)

        for (y in 0 until h) {
            val ny = (y - halfH) * ryInv
            val nySq = ny * ny
            val row = y * w
            val yUp = if (y > 0) (y - 1) * w else row
            val yDown = if (y < h - 1) (y + 1) * w else row

            for (x in 0 until w) {
                val nx = (x - halfW) * rxInv
                val r = sqrt(nx * nx + nySq)
                val idx = row + x

                if (r >= 1.0f) {
                    patchPixels[idx] = Color.TRANSPARENT
                    continue
                }
                if (r <= innerCore) {
                    continue
                }

                val t = ((r - innerCore) / max(0.01f, 1.0f - innerCore)).coerceIn(0f, 1f)
                val pc = patchPixels[idx]
                val pA = Color.alpha(pc)
                if (pA == 0) continue

                val tc = targetPixels[idx]
                val tcAlpha = Color.alpha(tc)
                val xL = if (x > 0) x - 1 else x
                val xR = if (x < w - 1) x + 1 else x

                // 1. Local Texture Contrast (isotropic luminance gradient on both destination & source skin)
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

                // Smoothness vs texture energy at this seam pixel (0 = smooth cheek/forehead, 1 = crisp feature edge)
                val contrastEnergy = max(targetGrad, targetGrad * 0.68f + patchGrad * 0.32f)
                val contrastFactor = (contrastEnergy / 28f).coerceIn(0f, 1f)

                // Chromatic/brightness discrepancy between patch and real skin/hair/glasses
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

                // 2. Contrast-Adaptive Feathering Curve
                // Smooth low-contrast areas melt broadly; sharp high-contrast borders tighten roll-off to avoid blur halos
                val baseHermite = 1f - (t * t * (3f - 2f * t))
                val contrastExponent = 1.18f + (1f - contrastFactor) * 0.48f - contrastFactor * 0.22f
                var borderAlpha = baseHermite.pow(contrastExponent)

                // Preserve sharp high-contrast occlusions in original frame (eyeglass frames, stray hair, jaw stubble)
                if (preserveHighContrastOcclusions && tcAlpha > 25 && targetGrad > 14f && targetGrad > patchGrad * 1.15f) {
                    val occlusionWeight = ((targetGrad - 14f) / 34f).coerceIn(0f, 0.85f)
                    val edgeProximity = (0.28f + 0.72f * t).coerceIn(0f, 1f)
                    borderAlpha *= (1f - occlusionWeight * edgeProximity * 0.75f)
                }

                // Soften steep tone jumps slightly around mid-border when Smart Blend is enabled
                if (smartBlend && colorDiff > 0.25f) {
                    val toneSoften = (1f - min(0.32f, (colorDiff - 0.25f) * 0.22f * t))
                    borderAlpha *= toneSoften
                }

                val outAlpha = (pA * borderAlpha).toInt().coerceIn(0, 255)
                if (outAlpha < 2) {
                    patchPixels[idx] = Color.TRANSPARENT
                    continue
                }

                // 3. Harmonic Boundary Luminance & Tint Pull (approximates Poisson edge continuity across lighting seams)
                val rOut: Int
                val gOut: Int
                val bOut: Int
                if (smartBlend && clampedBlend > 0.01f && Color.alpha(tc) > 25) {
                    // Gently pull swapped border pixel's tone toward target illumination proportional to distance into seam
                    val pullStrength = (t * (1f - contrastFactor * 0.45f) * 0.58f * clampedBlend).coerceIn(0f, 0.62f)
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
        val innerStop = (0.76f - featherRatio * 0.24f - if (smartBlend) 0.06f else 0f).coerceIn(0.48f, 0.80f)
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
