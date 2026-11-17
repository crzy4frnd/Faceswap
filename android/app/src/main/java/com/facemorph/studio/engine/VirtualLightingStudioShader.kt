package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import com.facemorph.studio.model.SourceFaceMetrics
import com.facemorph.studio.model.VirtualLightConfig
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Real-Time Virtual Lighting Studio Shader Module for Face-Swap Relighting.
 *
 * Synthesizes a cached 3D anatomical facial mesh normal field (cranial dome, orbital eye sockets,
 * protruding 3D nasal ridge/tip, zygomatic cheekbones, and jawline taper) perturbed by local skin
 * micro-relief gradients, then evaluates a Half-Lambert + Blinn-Phong + Hemisphere Bounce relighting
 * shader driven by user-adjustable ambient light direction, elevation, intensity, and warmth.
 *
 * Also exposes an AGSL GPU RuntimeShader (Android 13 / API 33+) for hardware-accelerated preview
 * rendering and an automatic target-environment lighting estimator.
 */
object VirtualLightingStudioShader {

    private data class NormalFieldCacheKey(
        val w: Int,
        val h: Int,
        val eyeMidXBucket: Int,
        val eyeMidYBucket: Int,
        val eyeDistBucket: Int
    )

    private class CachedNormalField(
        val key: NormalFieldCacheKey,
        val nx: FloatArray,
        val ny: FloatArray,
        val nz: FloatArray
    )

    private val normalFieldCacheLock = Any()
    private val normalFieldCache = ArrayDeque<CachedNormalField>(4)

    private const val AGSL_LIGHT_DOME_SHADER = """
        uniform float2 uResolution;
        uniform float3 uLightDir;
        uniform float uIntensity;
        uniform float uWarmth;

        half4 main(float2 fragCoord) {
            float2 uv = (fragCoord / max(uResolution, float2(1.0))) * 2.0 - 1.0;
            float r2 = dot(uv, uv);
            if (r2 > 1.0) {
                return half4(0.0);
            }
            float z = sqrt(max(0.0, 1.0 - r2));
            float3 n = normalize(float3(uv.x, uv.y, z));
            float3 l = normalize(uLightDir);
            float ndl = clamp(dot(n, l), -1.0, 1.0);
            float halfLambert = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
            float3 hVec = normalize(l + float3(0.0, 0.0, 1.0));
            float spec = pow(max(0.0, dot(n, hVec)), 22.0) * (0.28 + 0.55 * uIntensity);

            float3 warmTint = float3(1.0 + uWarmth * 0.25, 1.0 + uWarmth * 0.06, 1.0 - uWarmth * 0.22);
            float3 coolBounce = float3(0.16, 0.21, 0.34);
            float3 baseSkin = float3(0.36, 0.38, 0.48);

            float shade = mix(1.0, 0.32 + 1.15 * halfLambert, 0.35 + 0.65 * uIntensity);
            float3 col = baseSkin * shade * warmTint + coolBounce * (1.0 - halfLambert) * (0.25 + 0.4 * uIntensity) + float3(1.0, 0.96, 0.90) * spec;
            float rim = pow(1.0 - z, 3.0) * 0.35;
            col += float3(0.22, 0.52, 0.78) * rim;
            return half4(clamp(col, 0.0, 1.0), 1.0);
        }
    """

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    fun createDomePreviewRuntimeShader(
        widthPx: Float,
        heightPx: Float,
        light: VirtualLightConfig
    ): RuntimeShader {
        val (lx, ly, lz) = computeLightVector(light.directionDeg, light.elevationDeg)
        return RuntimeShader(AGSL_LIGHT_DOME_SHADER).apply {
            setFloatUniform("uResolution", max(1f, widthPx), max(1f, heightPx))
            setFloatUniform("uLightDir", lx, ly, lz)
            setFloatUniform("uIntensity", light.intensity.coerceIn(0f, 1f))
            setFloatUniform("uWarmth", light.warmth.coerceIn(-0.5f, 0.7f))
        }
    }

    /**
     * Converts (directionDeg, elevationDeg) into a unit 3D vector pointing FROM the face center
     * TOWARD the light source in Canvas space (+X right, +Y down, +Z toward viewer).
     */
    fun computeLightVector(directionDeg: Float, elevationDeg: Float): Triple<Float, Float, Float> {
        val azRad = directionDeg * (PI.toFloat() / 180f)
        val elRad = elevationDeg.coerceIn(-25f, 80f) * (PI.toFloat() / 180f)
        val cosEl = cos(elRad)
        val lx = cos(azRad) * cosEl
        val ly = sin(azRad) * cosEl
        val lz = sin(elRad)
        val len = max(1e-4f, sqrt(lx * lx + ly * ly + lz * lz))
        return Triple(lx / len, ly / len, lz / len)
    }

    /**
     * Applies real-time 3D normal-based directional relighting to the swapped inner-face patch
     * so nose bridge, cheekbones, brow, and jaw shading match the target body's ambient lighting.
     */
    fun applyFaceMeshRelighting(
        patch: Bitmap,
        metrics: SourceFaceMetrics,
        light: VirtualLightConfig,
        targetAmbientRgb: Triple<Float, Float, Float>? = null
    ) {
        if (!light.enabled || light.intensity <= 0.015f) return

        val w = patch.width
        val h = patch.height
        if (w < 12 || h < 12) return

        val intensity = light.intensity.coerceIn(0f, 1f)
        val (lx, ly, lz) = computeLightVector(light.directionDeg, light.elevationDeg)
        val normals = getOrBuildFaceMeshNormalField(w, h, metrics)

        val total = w * h
        val pixels = IntArray(total)
        patch.getPixels(pixels, 0, w, 0, 0, w, h)

        val lum = FloatArray(total)
        for (i in 0 until total) {
            val c = pixels[i]
            lum[i] = (0.299f * Color.red(c) + 0.587f * Color.green(c) + 0.114f * Color.blue(c)) / 255f
        }

        // Half-vector H = normalize(L + V) with camera view vector V = (0, 0, 1)
        val hxRaw = lx
        val hyRaw = ly
        val hzRaw = lz + 1f
        val hLen = max(1e-4f, sqrt(hxRaw * hxRaw + hyRaw * hyRaw + hzRaw * hzRaw))
        val hx = hxRaw / hLen
        val hy = hyRaw / hLen
        val hz = hzRaw / hLen

        // Key warmth & target ambient color balance
        val warmth = light.warmth.coerceIn(-0.45f, 0.65f)
        val keyWarmR = 1f + warmth * 0.22f
        val keyWarmG = 1f + warmth * 0.04f
        val keyWarmB = 1f - warmth * 0.20f

        val shadowTintR: Float
        val shadowTintG: Float
        val shadowTintB: Float
        if (targetAmbientRgb != null) {
            val (tr, tg, tb) = targetAmbientRgb
            val tMean = max(1f, (tr + tg + tb) / 3f)
            shadowTintR = (0.94f + (tr / tMean - 1f) * 0.18f).coerceIn(0.84f, 1.12f)
            shadowTintG = (0.96f + (tg / tMean - 1f) * 0.18f).coerceIn(0.84f, 1.12f)
            shadowTintB = (1.03f + (tb / tMean - 1f) * 0.18f).coerceIn(0.86f, 1.16f)
        } else {
            shadowTintR = 1f - warmth * 0.08f
            shadowTintG = 1f
            shadowTintB = 1f + warmth * 0.10f
        }

        val nxArr = normals.nx
        val nyArr = normals.ny
        val nzArr = normals.nz

        // Balance brightness around frontal neutral light so intensity dial shapes shadows/highlights cleanly
        val frontalBaseline = 0.5f + 0.5f * lz
        val neutralShift = (frontalBaseline - 0.5f) * 0.12f

        for (y in 0 until h) {
            val row = y * w
            val yUp = if (y > 0) (y - 1) * w else row
            val yDown = if (y < h - 1) (y + 1) * w else row
            for (x in 0 until w) {
                val idx = row + x
                val c = pixels[idx]
                val a = Color.alpha(c)
                if (a < 8) continue

                val xL = if (x > 0) x - 1 else x
                val xR = if (x < w - 1) x + 1 else x

                // Perturb parametric 3D face normal with subtle surface micro-relief gradient
                val gradX = (lum[row + xL] - lum[row + xR]) * 0.22f
                val gradY = (lum[yUp + x] - lum[yDown + x]) * 0.22f
                var nx = nxArr[idx] + gradX
                var ny = nyArr[idx] + gradY
                val nz = nzArr[idx]
                val nLen = max(1e-4f, sqrt(nx * nx + ny * ny + nz * nz))
                nx /= nLen
                ny /= nLen
                val nzn = nz / nLen

                val nDotL = (nx * lx + ny * ly + nzn * lz).coerceIn(-1f, 1f)
                // Wrap Half-Lambert soft skin falloff
                val halfLambert = ((nDotL + 0.50f) / 1.50f).coerceIn(0f, 1f)
                val diffResponse = (halfLambert - 0.54f - neutralShift)

                // Asymmetric directional shading: gentle highlight boost on lit side, soft ambient shadow on shaded side
                val shadeGain = if (diffResponse >= 0f) {
                    1f + diffResponse * 0.78f * intensity
                } else {
                    1f + diffResponse * 0.92f * intensity
                }.coerceIn(0.48f, 1.46f)

                // Blinn-Phong skin specular highlight weighted toward central nose/cheek ridge
                val nDotH = max(0f, nx * hx + ny * hy + nzn * hz)
                val specHighlight = nDotH.pow(20f) * 16f * intensity * max(0f, nDotL + 0.2f)

                // Blend key light warmth on illuminated side & ambient bounce tint on shadow side
                val keyWeight = halfLambert * intensity
                val ambWeight = (1f - halfLambert) * intensity * 0.65f
                val rMul = shadeGain * (1f + (keyWarmR - 1f) * keyWeight + (shadowTintR - 1f) * ambWeight)
                val gMul = shadeGain * (1f + (keyWarmG - 1f) * keyWeight + (shadowTintG - 1f) * ambWeight)
                val bMul = shadeGain * (1f + (keyWarmB - 1f) * keyWeight + (shadowTintB - 1f) * ambWeight)

                val nr = (Color.red(c) * rMul + specHighlight * keyWarmR).toInt().coerceIn(0, 255)
                val ng = (Color.green(c) * gMul + specHighlight * keyWarmG).toInt().coerceIn(0, 255)
                val nb = (Color.blue(c) * bMul + specHighlight * keyWarmB).toInt().coerceIn(0, 255)
                pixels[idx] = Color.argb(a, nr, ng, nb)
            }
        }

        patch.setPixels(pixels, 0, w, 0, 0, w, h)
    }

    /**
     * Estimates target ambient light direction, elevation, and intensity directly from the target
     * body image by measuring directional illumination asymmetry across torso & facial skin regions.
     */
    fun estimateTargetLightEnvironment(
        targetBitmap: Bitmap,
        faceCenterX: Float? = null,
        faceCenterY: Float? = null,
        faceWidth: Float? = null,
        faceHeight: Float? = null
    ): VirtualLightConfig {
        val w = targetBitmap.width
        val h = targetBitmap.height
        if (w < 16 || h < 16) return VirtualLightConfig()

        val cx = (faceCenterX ?: (w * 0.5f)).coerceIn(w * 0.1f, w * 0.9f)
        val cy = (faceCenterY ?: (h * 0.38f)).coerceIn(h * 0.1f, h * 0.85f)
        val rx = max(12f, (faceWidth ?: (w * 0.35f)) * 0.72f)
        val ry = max(12f, (faceHeight ?: (h * 0.32f)) * 0.85f)

        var leftLum = 0f
        var leftCount = 0
        var rightLum = 0f
        var rightCount = 0
        var topLum = 0f
        var topCount = 0
        var botLum = 0f
        var botCount = 0
        var rSum = 0f
        var bSum = 0f
        var colorCount = 0

        val x0 = (cx - rx).toInt().coerceIn(0, w - 1)
        val x1 = (cx + rx).toInt().coerceIn(0, w - 1)
        val y0 = (cy - ry).toInt().coerceIn(0, h - 1)
        val y1 = (cy + ry).toInt().coerceIn(0, h - 1)
        val step = max(2, min(x1 - x0, y1 - y0) / 14)

        var py = y0
        while (py <= y1) {
            var px = x0
            while (px <= x1) {
                val c = targetBitmap.getPixel(px, py)
                val r = Color.red(c)
                val g = Color.green(c)
                val b = Color.blue(c)
                val lum = 0.299f * r + 0.587f * g + 0.114f * b
                if (lum in 22f..248f) {
                    if (px < cx) {
                        leftLum += lum; leftCount++
                    } else {
                        rightLum += lum; rightCount++
                    }
                    if (py < cy) {
                        topLum += lum; topCount++
                    } else {
                        botLum += lum; botCount++
                    }
                    if (lum > 90f) {
                        rSum += r
                        bSum += b
                        colorCount++
                    }
                }
                px += step
            }
            py += step
        }

        val avgL = if (leftCount > 0) leftLum / leftCount else 128f
        val avgR = if (rightCount > 0) rightLum / rightCount else 128f
        val avgT = if (topCount > 0) topLum / topCount else 128f
        val avgB = if (botCount > 0) botLum / botCount else 128f

        val dx = (avgR - avgL) / 55f
        val dy = (avgB - avgT) / 55f
        val asymMag = hypot(dx.toDouble(), dy.toDouble()).toFloat()

        val rawDir = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
        val normDir = ((rawDir % 360f) + 360f) % 360f
        val elevation = (52f - asymMag * 28f).coerceIn(16f, 65f)
        val intensity = (0.28f + asymMag * 0.55f).coerceIn(0.25f, 0.88f)

        val warmth = if (colorCount > 0) {
            val rAvg = rSum / colorCount
            val bAvg = bSum / colorCount
            (((rAvg - bAvg) / 90f) - 0.16f).coerceIn(-0.30f, 0.50f)
        } else {
            0.08f
        }

        return VirtualLightConfig(
            enabled = true,
            directionDeg = if (asymMag < 0.05f) 285f else normDir,
            elevationDeg = elevation,
            intensity = intensity,
            warmth = warmth
        )
    }

    private fun getOrBuildFaceMeshNormalField(
        w: Int,
        h: Int,
        metrics: SourceFaceMetrics
    ): CachedNormalField {
        val key = NormalFieldCacheKey(
            w = w,
            h = h,
            eyeMidXBucket = (metrics.eyeMidXRatio * 40f).toInt(),
            eyeMidYBucket = (metrics.eyeMidYRatio * 40f).toInt(),
            eyeDistBucket = (metrics.eyeDistRatio * 40f).toInt()
        )
        synchronized(normalFieldCacheLock) {
            normalFieldCache.find { it.key == key }?.let { return it }
        }

        val total = w * h
        val nxArr = FloatArray(total)
        val nyArr = FloatArray(total)
        val nzArr = FloatArray(total)

        val ex = metrics.eyeMidXRatio.coerceIn(0.35f, 0.65f)
        val ey = metrics.eyeMidYRatio.coerceIn(0.24f, 0.50f)
        val ed = metrics.eyeDistRatio.coerceIn(0.30f, 0.72f)
        val leftEyeX = ex - ed * 0.5f
        val rightEyeX = ex + ed * 0.5f
        val noseTipY = (ey + 0.25f).coerceIn(0.38f, 0.76f)
        val chinY = 0.88f

        val wInv = 1f / max(1, w - 1)
        val hInv = 1f / max(1, h - 1)

        for (y in 0 until h) {
            val v = y * hInv
            val row = y * w
            // Cranial-to-chin vertical dome normal component
            val domeY = ((v - 0.48f) / 0.52f).coerceIn(-1f, 1f)
            // Jaw narrows smoothly below cheekbones
            val jawTaper = if (v > 0.56f) (1f - ((v - 0.56f) / 0.44f) * 0.26f) else 1f

            for (x in 0 until w) {
                val u = x * wInv
                val domeX = ((u - 0.5f) / (0.48f * jawTaper)).coerceIn(-1f, 1f)

                var nx = domeX * 0.72f
                var ny = domeY * 0.64f
                var nz = sqrt(max(0.08f, 1f - min(0.92f, domeX * domeX * 0.55f + domeY * domeY * 0.45f)))

                // 3D Nasal bridge & protruding nasal tip ridge (creates authentic directional nose shading)
                val dxNose = u - ex
                if (abs(dxNose) < 0.20f && v in (ey - 0.06f)..(noseTipY + 0.10f)) {
                    val bridgeProfile = if (v <= noseTipY) {
                        ((v - (ey - 0.06f)) / max(0.05f, noseTipY - (ey - 0.06f))).coerceIn(0f, 1f)
                    } else {
                        (1f - (v - noseTipY) / 0.10f).coerceIn(0f, 1f)
                    }
                    val noseGauss = exp(-((dxNose * dxNose) / (0.075f * 0.075f)))
                    val noseSlopeX = (dxNose / 0.075f) * noseGauss * (0.45f + 0.65f * bridgeProfile)
                    val noseSlopeY = if (v > noseTipY - 0.04f) {
                        ((v - (noseTipY - 0.04f)) / 0.12f).coerceIn(0f, 1f) * noseGauss * 0.55f
                    } else {
                        -0.12f * noseGauss * bridgeProfile
                    }
                    nx += noseSlopeX
                    ny += noseSlopeY
                    nz += 0.35f * noseGauss * bridgeProfile
                }

                // Subtle orbital eye socket concavity under brow
                val dLeftEye2 = (u - leftEyeX) * (u - leftEyeX) + (v - ey) * (v - ey)
                val dRightEye2 = (u - rightEyeX) * (u - rightEyeX) + (v - ey) * (v - ey)
                if (dLeftEye2 < 0.015f) {
                    val wSocket = exp(-dLeftEye2 / 0.005f)
                    ny += 0.18f * wSocket
                }
                if (dRightEye2 < 0.015f) {
                    val wSocket = exp(-dRightEye2 / 0.005f)
                    ny += 0.18f * wSocket
                }

                // Prominent chin rounding
                val dxChin = u - ex
                val dyChin = v - chinY
                val dChin2 = dxChin * dxChin + dyChin * dyChin
                if (dChin2 < 0.03f) {
                    val wChin = exp(-dChin2 / 0.012f)
                    nx += (dxChin / 0.15f) * 0.18f * wChin
                    ny += (dyChin / 0.15f) * 0.22f * wChin
                }

                val len = max(1e-4f, sqrt(nx * nx + ny * ny + nz * nz))
                val idx = row + x
                nxArr[idx] = nx / len
                nyArr[idx] = ny / len
                nzArr[idx] = nz / len
            }
        }

        val built = CachedNormalField(key, nxArr, nyArr, nzArr)
        synchronized(normalFieldCacheLock) {
            if (normalFieldCache.size >= 4) normalFieldCache.removeFirst()
            normalFieldCache.addLast(built)
        }
        return built
    }
}
