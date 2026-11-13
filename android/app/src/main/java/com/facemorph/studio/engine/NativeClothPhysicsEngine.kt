package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.BodyScanResult
import com.facemorph.studio.model.ClothPhysicsConfig
import com.facemorph.studio.model.FittedWardrobeLayer
import com.facemorph.studio.model.MotionPreset
import com.facemorph.studio.model.Point2D
import com.facemorph.studio.model.WardrobeAssetItem
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

class ClothParticle(
    var x: Float,
    var y: Float,
    var oldX: Float,
    var oldY: Float,
    val pinned: Boolean,
    val pinOffsetX: Float,
    val pinOffsetY: Float,
    val u: Float,
    val v: Float,
    val mass: Float
)

class ClothSpring(
    val p1: Int,
    val p2: Int,
    val restLength: Float,
    val stiffness: Float
)

class ClothMeshState(
    val particles: MutableList<ClothParticle>,
    val springs: List<ClothSpring>,
    val cols: Int,
    val rows: Int,
    val width: Float,
    val height: Float
) {
    var grabbedIndex: Int? = null
    var grabbedX: Float = 0f
    var grabbedY: Float = 0f
}

class PendantState(
    val linksX: FloatArray,
    val linksY: FloatArray,
    val oldX: FloatArray,
    val oldY: FloatArray,
    val linkLen: Float
)

object NativeClothPhysicsEngine {

    fun scanBody(
        bitmapWidth: Float,
        bitmapHeight: Float,
        faceCenterX: Float?,
        faceBottomY: Float?,
        faceWidth: Float? = null,
        faceHeight: Float? = null
    ): BodyScanResult {
        val fw = faceWidth ?: (bitmapWidth * 0.22f)
        val fh = faceHeight ?: (fw * 1.25f)
        val cx = faceCenterX ?: (bitmapWidth * 0.5f)
        val neckY = faceBottomY?.let { it + fh * 0.12f } ?: (bitmapHeight * 0.36f)
        val shoulderHalfW = (fw * 1.22f).coerceIn(bitmapWidth * 0.10f, bitmapWidth * 0.34f)
        val shoulderY = neckY + fh * 0.24f
        val waistHalfW = shoulderHalfW * 0.78f
        val waistY = shoulderY + fh * 1.48f

        return BodyScanResult(
            shoulderWidthCm = 44,
            chestCm = 96,
            waistCm = 79,
            neckCm = 38,
            estimatedSize = "US M · EU 48",
            nose = Point2D(cx, neckY - fh * 0.65f),
            throat = Point2D(cx, neckY),
            leftShoulder = Point2D(cx - shoulderHalfW, shoulderY),
            rightShoulder = Point2D(cx + shoulderHalfW, shoulderY),
            sternum = Point2D(cx, shoulderY + fh * 0.45f),
            leftWaist = Point2D(cx - waistHalfW, waistY),
            rightWaist = Point2D(cx + waistHalfW, waistY),
            leftWrist = Point2D(cx - shoulderHalfW * 1.22f, waistY + fh * 0.25f),
            rightWrist = Point2D(cx + shoulderHalfW * 1.22f, waistY + fh * 0.25f)
        )
    }

    fun createClothGrid(
        startX: Float,
        startY: Float,
        width: Float,
        height: Float,
        cols: Int = 7,
        rows: Int = 8
    ): ClothMeshState {
        val particles = mutableListOf<ClothParticle>()
        val springs = mutableListOf<ClothSpring>()
        val dx = width / (cols - 1)
        val dy = height / (rows - 1)

        for (r in 0 until rows) {
            for (c in 0 until cols) {
                val u = c.toFloat() / (cols - 1)
                val v = r.toFloat() / (rows - 1)
                val px = startX + c * dx
                val py = startY + r * dy
                val isPinned = (r == 0) || (r == 1 && (c == 1 || c == cols - 2))
                particles.add(
                    ClothParticle(
                        x = px,
                        y = py,
                        oldX = px,
                        oldY = py,
                        pinned = isPinned,
                        pinOffsetX = (u - 0.5f) * width,
                        pinOffsetY = v * height,
                        u = u,
                        v = v,
                        mass = 1.0f + v * 0.45f
                    )
                )
            }
        }

        fun addSpring(i1: Int, i2: Int, stiffness: Float) {
            val p1 = particles[i1]
            val p2 = particles[i2]
            val rest = hypot((p2.x - p1.x).toDouble(), (p2.y - p1.y).toDouble()).toFloat()
            springs.add(ClothSpring(i1, i2, rest, stiffness))
        }

        for (r in 0 until rows) {
            for (c in 0 until cols) {
                val idx = r * cols + c
                if (c < cols - 1) addSpring(idx, idx + 1, 0.95f)
                if (r < rows - 1) addSpring(idx, idx + cols, 0.95f)
                if (c < cols - 1 && r < rows - 1) {
                    addSpring(idx, idx + cols + 1, 0.6f)
                    addSpring(idx + 1, idx + cols, 0.6f)
                }
                if (c < cols - 2) addSpring(idx, idx + 2, 0.4f)
                if (r < rows - 2) addSpring(idx, idx + cols * 2, 0.4f)
            }
        }

        return ClothMeshState(particles, springs, cols, rows, width, height)
    }

    fun stepClothPhysics(
        mesh: ClothMeshState,
        config: ClothPhysicsConfig,
        scan: BodyScanResult,
        timeSec: Float
    ) {
        val shoulderCenter = Point2D(
            (scan.leftShoulder.x + scan.rightShoulder.x) * 0.5f,
            (scan.leftShoulder.y + scan.rightShoulder.y) * 0.5f
        )

        // Posture dynamics & wind gusts
        var leanDeg = config.postureTilt
        var chestExp = 0f
        var dynamicWindX = config.windStrength
        when (config.preset) {
            MotionPreset.BREATHING -> chestExp = sin(timeSec * 1.9f) * 4f
            MotionPreset.WALKING -> {
                leanDeg += sin(timeSec * 2.8f) * 3.5f
                dynamicWindX += sin(timeSec * 2.8f) * 1.5f
            }
            MotionPreset.BREEZE -> {
                dynamicWindX += 3.2f + sin(timeSec * config.gustFrequency * PI.toFloat()) * 2.8f
            }
            MotionPreset.DANCE -> {
                leanDeg += sin(timeSec * 3.6f) * 7f
                dynamicWindX += cos(timeSec * 3.6f) * 3.2f
            }
            MotionPreset.STILL -> Unit
        }
        if (config.airFanActive) {
            dynamicWindX += 5.5f + sin(timeSec * 6.5f) * 1.8f
        }

        val tiltRad = Math.toRadians(leanDeg.toDouble()).toFloat()
        val airDrag = 1f - (config.airResistance / 100f) * 0.12f
        val damping = (config.fabricType.damping * airDrag).coerceIn(0.75f, 0.985f)
        val grav = config.gravity * 1.55f
        val windSuscept = config.fabricType.windSusceptibility

        // 1. Verlet integration
        for (i in mesh.particles.indices) {
            val p = mesh.particles[i]
            if (p.pinned) {
                val rx = p.pinOffsetX * cos(tiltRad) - p.pinOffsetY * sin(tiltRad)
                val ry = p.pinOffsetX * sin(tiltRad) + p.pinOffsetY * cos(tiltRad)
                p.x = shoulderCenter.x + rx
                p.y = shoulderCenter.y - mesh.height * 0.14f + ry
                p.oldX = p.x
                p.oldY = p.y
                continue
            }

            if (mesh.grabbedIndex == i) {
                p.x = mesh.grabbedX
                p.y = mesh.grabbedY
                p.oldX = p.x
                p.oldY = p.y
                continue
            }

            val vx = (p.x - p.oldX) * damping
            val vy = (p.y - p.oldY) * damping
            p.oldX = p.x
            p.oldY = p.y

            val hemRatio = p.v
            val flutter = sin(p.u * 4f * PI.toFloat() + timeSec * 5f + p.x * 0.04f) *
                config.windTurbulence * hemRatio * windSuscept * 1.4f
            val windForce = (dynamicWindX * windSuscept * hemRatio * 0.35f) + flutter

            p.x += vx + windForce
            p.y += vy + grav * p.mass
        }

        // 2. Spring relaxation passes + torso collision
        val passes = max(2, config.fabricType.stiffness)
        for (pass in 0 until passes) {
            for (s in mesh.springs) {
                val p1 = mesh.particles[s.p1]
                val p2 = mesh.particles[s.p2]
                val dx = p2.x - p1.x
                val dy = p2.y - p1.y
                val dist = hypot(dx.toDouble(), dy.toDouble()).toFloat()
                if (dist < 0.0001f) continue

                val diff = ((dist - s.restLength) / dist) * s.stiffness
                if (!p1.pinned && !p2.pinned) {
                    p1.x += dx * 0.5f * diff
                    p1.y += dy * 0.5f * diff
                    p2.x -= dx * 0.5f * diff
                    p2.y -= dy * 0.5f * diff
                } else if (p1.pinned && !p2.pinned) {
                    p2.x -= dx * diff
                    p2.y -= dy * diff
                } else if (!p1.pinned && p2.pinned) {
                    p1.x += dx * diff
                    p1.y += dy * diff
                }
            }

            // Chest / Torso push out
            val chestHalf = hypot(
                (scan.rightShoulder.x - scan.leftShoulder.x).toDouble(),
                (scan.rightShoulder.y - scan.leftShoulder.y).toDouble()
            ).toFloat() * 0.38f + chestExp

            for (p in mesh.particles) {
                if (p.pinned) continue
                val dcx = p.x - scan.sternum.x
                val dcy = p.y - scan.sternum.y
                if (abs(dcy) < mesh.height * 0.4f && abs(dcx) < chestHalf * 0.65f) {
                    p.x += (if (dcx >= 0) 1 else -1) * 0.6f
                }
            }
        }
    }

    fun renderClothWithBitmapMesh(
        canvas: Canvas,
        bitmap: Bitmap,
        mesh: ClothMeshState,
        showWireframe: Boolean,
        showStress: Boolean,
        shadowDepth: Int
    ) {
        val verts = FloatArray(mesh.cols * mesh.rows * 2)
        for (i in mesh.particles.indices) {
            verts[i * 2] = mesh.particles[i].x
            verts[i * 2 + 1] = mesh.particles[i].y
        }

        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        if (shadowDepth > 0) {
            paint.setShadowLayer((shadowDepth / 100f) * 16f, 0f, 8f, Color.argb(110, 0, 0, 0))
        }

        canvas.drawBitmapMesh(
            bitmap,
            mesh.cols - 1,
            mesh.rows - 1,
            verts,
            0,
            null,
            0,
            paint
        )

        if (showWireframe || showStress) {
            val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeWidth = 2f
                style = Paint.Style.STROKE
            }
            for (s in mesh.springs) {
                val p1 = mesh.particles[s.p1]
                val p2 = mesh.particles[s.p2]
                if (showStress) {
                    val dist = hypot((p2.x - p1.x).toDouble(), (p2.y - p1.y).toDouble()).toFloat()
                    val strain = (abs(dist - s.restLength) / max(1f, s.restLength)).coerceIn(0f, 1f)
                    linePaint.color = if (strain > 0.15f) {
                        Color.argb(210, 244, 63, 94)
                    } else {
                        Color.argb(160, 52, 211, 153)
                    }
                } else {
                    linePaint.color = Color.argb(155, 34, 211, 238)
                }
                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, linePaint)
            }
        }
    }

    fun renderBodyAndFittedAssets(
        targetBitmap: Bitmap,
        scan: BodyScanResult,
        layers: List<FittedWardrobeLayer>,
        assetsMap: Map<String, WardrobeAssetItem>,
        assetBitmaps: Map<String, Bitmap>,
        clothMeshes: MutableMap<String, ClothMeshState>,
        clothConfig: ClothPhysicsConfig,
        timeSec: Float,
        showScanHud: Boolean
    ): Bitmap {
        val output = Bitmap.createBitmap(targetBitmap.width, targetBitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        canvas.drawBitmap(targetBitmap, 0f, 0f, null)

        val shoulderSpan = hypot(
            (scan.rightShoulder.x - scan.leftShoulder.x).toDouble(),
            (scan.rightShoulder.y - scan.leftShoulder.y).toDouble()
        ).toFloat()

        for (layer in layers) {
            if (!layer.visible) continue
            val asset = assetsMap[layer.assetId] ?: continue
            val bmp = assetBitmaps[layer.assetId] ?: continue

            when (asset.anchorPoint) {
                BodyAnchorPoint.SHOULDERS -> {
                    val targetW = shoulderSpan * 1.48f * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val cx = (scan.leftShoulder.x + scan.rightShoulder.x) * 0.5f + layer.offsetX
                    val cy = (scan.leftShoulder.y + scan.rightShoulder.y) * 0.5f + layer.offsetY

                    if (clothConfig.enabled && clothConfig.isSimulating) {
                        val mesh = clothMeshes[layer.assetId]?.takeIf {
                            abs(it.width - targetW) < 40f
                        } ?: createClothGrid(
                            startX = cx - targetW * 0.5f,
                            startY = cy - targetH * 0.14f,
                            width = targetW,
                            height = targetH
                        ).also { clothMeshes[layer.assetId] = it }

                        stepClothPhysics(mesh, clothConfig, scan, timeSec)
                        renderClothWithBitmapMesh(
                            canvas,
                            bmp,
                            mesh,
                            clothConfig.showWireframe,
                            clothConfig.showStressHeatmap,
                            layer.shadowDepth
                        )
                    } else {
                        drawScaledRotatedBitmap(canvas, bmp, cx, cy - targetH * 0.14f, targetW, targetH, layer.rotation, centeredY = false)
                    }
                }

                BodyAnchorPoint.NECK -> {
                    val targetW = shoulderSpan * 0.38f * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val swing = if (clothConfig.enabled) sin(timeSec * 2.8f) * (2.5f + abs(clothConfig.windStrength)) else 0f
                    val px = scan.throat.x + layer.offsetX + swing
                    val py = scan.throat.y + layer.offsetY + 6f
                    drawScaledRotatedBitmap(canvas, bmp, px, py, targetW, targetH, layer.rotation + swing * 0.6f, centeredY = false)
                }

                BodyAnchorPoint.HEAD -> {
                    val targetW = shoulderSpan * 0.72f * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val px = scan.nose.x + layer.offsetX
                    val py = scan.nose.y + layer.offsetY - targetH * 0.85f
                    drawScaledRotatedBitmap(canvas, bmp, px, py, targetW, targetH, layer.rotation, centeredY = false)
                }

                BodyAnchorPoint.WRIST -> {
                    val targetW = shoulderSpan * 0.28f * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val px = scan.leftWrist.x + layer.offsetX
                    val py = scan.leftWrist.y + layer.offsetY
                    drawScaledRotatedBitmap(canvas, bmp, px, py, targetW, targetH, layer.rotation, centeredY = true)
                }

                BodyAnchorPoint.WAIST -> {
                    val waistSpan = abs(scan.rightWaist.x - scan.leftWaist.x) * 1.35f
                    val targetW = waistSpan * layer.scale
                    val targetH = targetW * (bmp.height.toFloat() / bmp.width.toFloat())
                    val px = (scan.leftWaist.x + scan.rightWaist.x) * 0.5f + layer.offsetX
                    val py = (scan.leftWaist.y + scan.rightWaist.y) * 0.5f + layer.offsetY - targetH * 0.15f
                    drawScaledRotatedBitmap(canvas, bmp, px, py, targetW, targetH, layer.rotation, centeredY = false)
                }
            }
        }

        if (showScanHud) {
            drawBodyScanOverlay(canvas, scan)
        }

        return output
    }

    private fun drawScaledRotatedBitmap(
        canvas: Canvas,
        bmp: Bitmap,
        x: Float,
        y: Float,
        targetW: Float,
        targetH: Float,
        rotationDeg: Float,
        centeredY: Boolean
    ) {
        val scaled = Bitmap.createScaledBitmap(
            bmp,
            max(8, targetW.toInt()),
            max(8, targetH.toInt()),
            true
        )
        canvas.save()
        canvas.translate(x, y)
        canvas.rotate(rotationDeg)
        val top = if (centeredY) -targetH * 0.5f else 0f
        canvas.drawBitmap(scaled, -targetW * 0.5f, top, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        canvas.restore()
        if (scaled !== bmp) scaled.recycle()
    }

    private fun drawBodyScanOverlay(canvas: Canvas, scan: BodyScanResult) {
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(200, 34, 211, 238)
            strokeWidth = 3f
            style = Paint.Style.STROKE
        }
        val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(16, 185, 129)
            style = Paint.Style.FILL
        }

        canvas.drawLine(scan.leftShoulder.x, scan.leftShoulder.y, scan.rightShoulder.x, scan.rightShoulder.y, linePaint)
        canvas.drawLine(scan.throat.x, scan.throat.y, scan.sternum.x, scan.sternum.y, linePaint)
        canvas.drawLine(scan.leftWaist.x, scan.leftWaist.y, scan.rightWaist.x, scan.rightWaist.y, linePaint)

        listOf(
            scan.throat, scan.leftShoulder, scan.rightShoulder,
            scan.sternum, scan.leftWaist, scan.rightWaist, scan.leftWrist
        ).forEach { pt ->
            canvas.drawCircle(pt.x, pt.y, 8f, dotPaint)
        }
    }
}
