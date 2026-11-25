package com.facemorph.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader

/**
 * Synthesizes crisp, shaded transparent garment & accessory bitmaps for built-in Live AR
 * wardrobe sub-categories (Shirts, Formal Suits, Jackets, Aviator Glasses) with anatomical
 * shoulder seams and open V-neck collars tailored for GarmentStructureAnalyzer.
 */
object BuiltInWardrobeFactory {

    fun createBuiltInBitmap(presetId: String): Bitmap? {
        return when (presetId) {
            "asset-suit-navy" -> renderSuit(
                mainDark = Color.rgb(18, 30, 56),
                mainLight = Color.rgb(34, 54, 96),
                lapelColor = Color.rgb(22, 36, 68),
                shirtColor = Color.rgb(236, 240, 248),
                tieColor = Color.rgb(148, 28, 42)
            )
            "asset-shirt-white" -> renderDressShirt(
                fabricLight = Color.rgb(245, 247, 252),
                fabricMid = Color.rgb(218, 224, 236),
                fabricShadow = Color.rgb(184, 194, 210),
                buttonColor = Color.rgb(148, 163, 184)
            )
            "asset-shirt-navy" -> renderDressShirt(
                fabricLight = Color.rgb(42, 66, 108),
                fabricMid = Color.rgb(28, 46, 80),
                fabricShadow = Color.rgb(18, 30, 54),
                buttonColor = Color.rgb(203, 213, 225)
            )
            "asset-jacket-moto" -> renderJacket(
                outerLight = Color.rgb(54, 62, 74),
                outerDark = Color.rgb(24, 28, 36),
                zipColor = Color.rgb(212, 218, 228)
            )
            "asset-kurta-emerald" -> renderKurta(
                fabricLight = Color.rgb(20, 96, 84),
                fabricMid = Color.rgb(13, 72, 62),
                fabricDark = Color.rgb(8, 48, 42),
                embroideryGold = Color.rgb(232, 192, 92)
            )
            "asset-watch-gold" -> renderGoldWatch()
            "asset-glasses-aviator" -> renderAviatorGlasses()
            else -> null
        }
    }

    private fun renderSuit(
        mainDark: Int,
        mainLight: Int,
        lapelColor: Int,
        shirtColor: Int,
        tieColor: Int
    ): Bitmap {
        val w = 480
        val h = 560
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setHasAlpha(true)
        val canvas = Canvas(bmp)
        val cx = w * 0.5f

        val coatPath = Path().apply {
            moveTo(cx - 56f, 26f)
            lineTo(cx - 196f, 76f)
            quadTo(cx - 224f, 92f, cx - 230f, 152f)
            lineTo(cx - 224f, 470f)
            lineTo(cx - 166f, 470f)
            lineTo(cx - 154f, 225f)
            lineTo(cx - 148f, 540f)
            lineTo(cx + 148f, 540f)
            lineTo(cx + 154f, 225f)
            lineTo(cx + 166f, 470f)
            lineTo(cx + 224f, 470f)
            lineTo(cx + 230f, 152f)
            quadTo(cx + 224f, 92f, cx + 196f, 76f)
            lineTo(cx + 56f, 26f)
            lineTo(cx + 42f, 64f)
            lineTo(cx, 198f)
            lineTo(cx - 42f, 64f)
            close()
        }

        val coatPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 30f, w.toFloat(), h.toFloat(),
                intArrayOf(mainLight, mainDark, mainDark),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawPath(coatPath, coatPaint)

        // Inner crisp V-shirt & tie insert
        val shirtPath = Path().apply {
            moveTo(cx - 42f, 48f)
            lineTo(cx + 42f, 48f)
            lineTo(cx, 206f)
            close()
        }
        canvas.drawPath(shirtPath, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = shirtColor })

        val tiePath = Path().apply {
            moveTo(cx - 11f, 58f)
            lineTo(cx + 11f, 58f)
            lineTo(cx + 15f, 178f)
            lineTo(cx, 204f)
            lineTo(cx - 15f, 178f)
            close()
        }
        canvas.drawPath(tiePath, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = tieColor })

        // Left & right peaked lapels
        val lapelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = lapelColor }
        val leftLapel = Path().apply {
            moveTo(cx - 54f, 26f)
            lineTo(cx - 92f, 96f)
            lineTo(cx - 64f, 118f)
            lineTo(cx - 82f, 146f)
            lineTo(cx - 4f, 224f)
            lineTo(cx - 40f, 62f)
            close()
        }
        val rightLapel = Path().apply {
            moveTo(cx + 54f, 26f)
            lineTo(cx + 92f, 96f)
            lineTo(cx + 64f, 118f)
            lineTo(cx + 82f, 146f)
            lineTo(cx + 4f, 224f)
            lineTo(cx + 40f, 62f)
            close()
        }
        canvas.drawPath(leftLapel, lapelPaint)
        canvas.drawPath(rightLapel, lapelPaint)

        val seamPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(65, 255, 255, 255)
            strokeWidth = 2.4f
            style = Paint.Style.STROKE
        }
        canvas.drawPath(leftLapel, seamPaint)
        canvas.drawPath(rightLapel, seamPaint)

        // Suit buttons & pocket square accent
        val btnPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(15, 23, 42) }
        canvas.drawCircle(cx - 4f, 290f, 8f, btnPaint)
        canvas.drawCircle(cx - 4f, 360f, 8f, btnPaint)
        val pocketSquare = Path().apply {
            moveTo(cx + 58f, 198f)
            lineTo(cx + 104f, 190f)
            lineTo(cx + 102f, 206f)
            lineTo(cx + 56f, 208f)
            close()
        }
        canvas.drawPath(pocketSquare, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = shirtColor })

        return bmp
    }

    private fun renderDressShirt(
        fabricLight: Int,
        fabricMid: Int,
        fabricShadow: Int,
        buttonColor: Int
    ): Bitmap {
        val w = 480
        val h = 540
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setHasAlpha(true)
        val canvas = Canvas(bmp)
        val cx = w * 0.5f

        val shirtBody = Path().apply {
            moveTo(cx - 54f, 28f)
            lineTo(cx - 190f, 78f)
            quadTo(cx - 216f, 96f, cx - 222f, 152f)
            lineTo(cx - 214f, 360f)
            lineTo(cx - 160f, 362f)
            lineTo(cx - 148f, 220f)
            lineTo(cx - 138f, 520f)
            quadTo(cx, 534f, cx + 138f, 520f)
            lineTo(cx + 148f, 220f)
            lineTo(cx + 160f, 362f)
            lineTo(cx + 214f, 360f)
            lineTo(cx + 222f, 152f)
            quadTo(cx + 216f, 96f, cx + 190f, 78f)
            lineTo(cx + 54f, 28f)
            lineTo(cx + 40f, 54f)
            lineTo(cx, 128f)
            lineTo(cx - 40f, 54f)
            close()
        }

        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 28f, w.toFloat(), h.toFloat(),
                intArrayOf(fabricLight, fabricMid, fabricShadow),
                floatArrayOf(0f, 0.6f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawPath(shirtBody, bodyPaint)

        // Tailored collar points
        val collarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fabricLight }
        val collarOutline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = fabricShadow
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        val leftCollar = Path().apply {
            moveTo(cx - 52f, 28f)
            lineTo(cx - 64f, 82f)
            lineTo(cx - 10f, 108f)
            lineTo(cx - 38f, 54f)
            close()
        }
        val rightCollar = Path().apply {
            moveTo(cx + 52f, 28f)
            lineTo(cx + 64f, 82f)
            lineTo(cx + 10f, 108f)
            lineTo(cx + 38f, 54f)
            close()
        }
        canvas.drawPath(leftCollar, collarPaint)
        canvas.drawPath(rightCollar, collarPaint)
        canvas.drawPath(leftCollar, collarOutline)
        canvas.drawPath(rightCollar, collarOutline)

        // Center placket & buttons
        canvas.drawRect(
            cx - 10f, 128f, cx + 10f, 518f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fabricMid }
        )
        canvas.drawLine(cx - 10f, 128f, cx - 10f, 518f, collarOutline)
        canvas.drawLine(cx + 10f, 128f, cx + 10f, 518f, collarOutline)

        val btnPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = buttonColor }
        for (by in listOf(166f, 232f, 298f, 364f, 430f)) {
            canvas.drawCircle(cx, by, 5.5f, btnPaint)
        }
        return bmp
    }

    private fun renderJacket(
        outerLight: Int,
        outerDark: Int,
        zipColor: Int
    ): Bitmap {
        val w = 480
        val h = 540
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setHasAlpha(true)
        val canvas = Canvas(bmp)
        val cx = w * 0.5f

        val jacketPath = Path().apply {
            moveTo(cx - 58f, 30f)
            lineTo(cx - 198f, 76f)
            quadTo(cx - 228f, 94f, cx - 232f, 152f)
            lineTo(cx - 224f, 464f)
            lineTo(cx - 166f, 464f)
            lineTo(cx - 154f, 224f)
            lineTo(cx - 146f, 516f)
            lineTo(cx + 146f, 516f)
            lineTo(cx + 154f, 224f)
            lineTo(cx + 166f, 464f)
            lineTo(cx + 224f, 464f)
            lineTo(cx + 232f, 152f)
            quadTo(cx + 228f, 94f, cx + 198f, 76f)
            lineTo(cx + 58f, 30f)
            lineTo(cx + 42f, 68f)
            lineTo(cx, 138f)
            lineTo(cx - 42f, 68f)
            close()
        }

        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 30f, w.toFloat(), h.toFloat(),
                intArrayOf(outerLight, outerDark),
                floatArrayOf(0f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawPath(jacketPath, bodyPaint)

        // Metallic front zipper & side zip pockets
        val zipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = zipColor
            strokeWidth = 5f
            style = Paint.Style.STROKE
        }
        canvas.drawLine(cx, 138f, cx, 514f, zipPaint)
        canvas.drawLine(cx - 110f, 320f, cx - 72f, 396f, zipPaint)
        canvas.drawLine(cx + 110f, 320f, cx + 72f, 396f, zipPaint)

        // Ribbed hem & cuffs
        val ribPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(16, 20, 28) }
        canvas.drawRect(cx - 146f, 488f, cx + 146f, 516f, ribPaint)
        canvas.drawRect(cx - 224f, 440f, cx - 166f, 464f, ribPaint)
        canvas.drawRect(cx + 166f, 440f, cx + 224f, 464f, ribPaint)

        return bmp
    }

    private fun renderAviatorGlasses(): Bitmap {
        val w = 400
        val h = 160
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setHasAlpha(true)
        val canvas = Canvas(bmp)
        val cx = w * 0.5f

        val framePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(212, 175, 55)
            style = Paint.Style.STROKE
            strokeWidth = 7f
        }
        val lensPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 24f, 0f, 140f,
                intArrayOf(Color.argb(215, 18, 28, 48), Color.argb(135, 56, 78, 112)),
                floatArrayOf(0f, 1f),
                Shader.TileMode.CLAMP
            )
        }

        val leftLens = RectF(cx - 166f, 34f, cx - 22f, 134f)
        val rightLens = RectF(cx + 22f, 34f, cx + 166f, 134f)

        canvas.drawRoundRect(leftLens, 44f, 52f, lensPaint)
        canvas.drawRoundRect(rightLens, 44f, 52f, lensPaint)
        canvas.drawRoundRect(leftLens, 44f, 52f, framePaint)
        canvas.drawRoundRect(rightLens, 44f, 52f, framePaint)

        // Double bridge
        canvas.drawLine(cx - 32f, 36f, cx + 32f, 36f, framePaint)
        canvas.drawLine(cx - 24f, 56f, cx + 24f, 56f, framePaint)
        // Temple tips
        canvas.drawLine(cx - 166f, 50f, cx - 192f, 54f, framePaint)
        canvas.drawLine(cx + 166f, 50f, cx + 192f, 54f, framePaint)
        return bmp
    }

    private fun renderKurta(
        fabricLight: Int,
        fabricMid: Int,
        fabricDark: Int,
        embroideryGold: Int
    ): Bitmap {
        val w = 480
        val h = 620
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setHasAlpha(true)
        val canvas = Canvas(bmp)
        val cx = w * 0.5f

        val kurtaPath = Path().apply {
            moveTo(cx - 52f, 32f)
            lineTo(cx - 188f, 78f)
            quadTo(cx - 216f, 94f, cx - 222f, 152f)
            lineTo(cx - 212f, 372f)
            lineTo(cx - 158f, 374f)
            lineTo(cx - 146f, 224f)
            lineTo(cx - 154f, 594f)
            lineTo(cx + 154f, 594f)
            lineTo(cx + 146f, 224f)
            lineTo(cx + 158f, 374f)
            lineTo(cx + 212f, 372f)
            lineTo(cx + 222f, 152f)
            quadTo(cx + 216f, 94f, cx + 188f, 78f)
            lineTo(cx + 52f, 32f)
            quadTo(cx, 66f, cx - 52f, 32f)
            close()
        }

        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 32f, w.toFloat(), h.toFloat(),
                intArrayOf(fabricLight, fabricMid, fabricDark),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawPath(kurtaPath, bodyPaint)

        // Mandarin band collar + embroidered placket
        val goldPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = embroideryGold
            style = Paint.Style.STROKE
            strokeWidth = 3.2f
        }
        val mandarinBand = Path().apply {
            moveTo(cx - 52f, 30f)
            quadTo(cx, 58f, cx + 52f, 30f)
            lineTo(cx + 46f, 64f)
            quadTo(cx, 92f, cx - 46f, 64f)
            close()
        }
        canvas.drawPath(mandarinBand, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fabricDark })
        canvas.drawPath(mandarinBand, goldPaint)

        // Embroidered center placket & buttons
        canvas.drawRect(
            cx - 15f, 78f, cx + 15f, 286f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fabricDark }
        )
        canvas.drawRect(cx - 15f, 78f, cx + 15f, 286f, goldPaint)

        val goldBtnPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = embroideryGold }
        for (by in listOf(108f, 148f, 188f, 228f, 268f)) {
            canvas.drawCircle(cx, by, 5.2f, goldBtnPaint)
        }

        // Subtle gold cuff & hem border trims
        canvas.drawLine(cx - 154f, 580f, cx + 154f, 580f, goldPaint)
        canvas.drawLine(cx - 210f, 360f, cx - 158f, 362f, goldPaint)
        canvas.drawLine(cx + 158f, 362f, cx + 210f, 360f, goldPaint)
        return bmp
    }

    private fun renderGoldWatch(): Bitmap {
        val w = 240
        val h = 240
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setHasAlpha(true)
        val canvas = Canvas(bmp)
        val cx = w * 0.5f
        val cy = h * 0.5f

        val strapPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                cx - 60f, 0f, cx + 60f, 0f,
                intArrayOf(Color.rgb(92, 68, 34), Color.rgb(198, 158, 72), Color.rgb(92, 68, 34)),
                floatArrayOf(0f, 0.5f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        // Horizontal band + vertical lugs silhouette so wrist angle wraps naturally around wrist
        canvas.drawRoundRect(RectF(cx - 104f, cy - 30f, cx + 104f, cy + 30f), 14f, 14f, strapPaint)

        val bezelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                cx - 48f, cy - 48f, cx + 48f, cy + 48f,
                intArrayOf(Color.rgb(246, 214, 126), Color.rgb(184, 134, 48), Color.rgb(235, 198, 102)),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawCircle(cx, cy, 48f, bezelPaint)
        canvas.drawCircle(cx, cy, 38f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(14, 22, 38) })

        val handPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(246, 214, 126)
            strokeWidth = 3.5f
            strokeCap = Paint.Cap.ROUND
        }
        canvas.drawLine(cx, cy, cx + 18f, cy - 16f, handPaint)
        canvas.drawLine(cx, cy, cx - 12f, cy - 22f, handPaint)
        canvas.drawCircle(cx, cy, 4f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(246, 214, 126) })
        return bmp
    }
}
