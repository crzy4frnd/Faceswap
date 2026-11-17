package com.facemorph.studio.ui

import android.graphics.Paint as NativePaint
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facemorph.studio.engine.VirtualLightingStudioShader
import com.facemorph.studio.model.VirtualLightConfig
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Interactive Virtual Lighting Studio UI module with a draggable 3D Light Dome pad
 * (AGSL RuntimeShader rendered on Android 13+ with gradient shader fallback on API 24-32),
 * directional presets, intensity & warmth sliders, and optional target-environment auto-match.
 */
@Composable
fun VirtualLightingStudioPanel(
    light: VirtualLightConfig,
    onLightChange: (VirtualLightConfig) -> Unit,
    onAutoMatchTarget: (() -> Unit)? = null,
    compact: Boolean = false
) {
    val latestLight by rememberUpdatedState(light)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0xFF111827))
            .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        // Header Bar: Icon + Title + Auto-Match + Reset + Enable Toggle
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.WbSunny,
                    contentDescription = null,
                    tint = if (light.enabled) Color(0xFFFBBF24) else Color(0xFF64748B),
                    modifier = Modifier.size(15.dp)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    "Virtual Lighting Studio",
                    color = Color(0xFFE2E8F0),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (onAutoMatchTarget != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(7.dp))
                            .background(Color(0xFF1E1B4B))
                            .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(7.dp))
                            .clickable { onAutoMatchTarget() }
                            .padding(horizontal = 7.dp, vertical = 3.dp)
                    ) {
                        Icon(Icons.Default.AutoFixHigh, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(12.dp))
                        Spacer(Modifier.width(3.dp))
                        Text("Auto", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Medium)
                    }
                }
                Icon(
                    Icons.Default.RestartAlt,
                    contentDescription = "Reset Lighting",
                    tint = Color(0xFF94A3B8),
                    modifier = Modifier
                        .size(18.dp)
                        .clickable { onLightChange(VirtualLightConfig()) }
                )
                Switch(
                    checked = light.enabled,
                    onCheckedChange = { onLightChange(light.copy(enabled = it)) }
                )
            }
        }

        if (light.enabled) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Interactive 360-degree Ambient Light Direction + Elevation Dome Pad
                val padSize = if (compact) 78.dp else 92.dp
                Box(
                    modifier = Modifier.size(padSize),
                    contentAlignment = Alignment.Center
                ) {
                    fun updateLightFromTouch(pos: Offset, canvasSizePx: Float) {
                        val cx = canvasSizePx * 0.5f
                        val cy = canvasSizePx * 0.5f
                        val maxR = maxOf(8f, canvasSizePx * 0.44f)
                        val dx = pos.x - cx
                        val dy = pos.y - cy
                        val dist = hypot(dx.toDouble(), dy.toDouble()).toFloat()
                        val normDist = (dist / maxR).coerceIn(0f, 1f)
                        val rawDeg = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
                        val dirDeg = ((rawDeg % 360f) + 360f) % 360f
                        val elevDeg = (72f - normDist * 82f).coerceIn(-10f, 72f)
                        onLightChange(
                            latestLight.copy(
                                enabled = true,
                                directionDeg = dirDeg,
                                elevationDeg = elevDeg
                            )
                        )
                    }

                    val shaderPaint = remember { NativePaint(NativePaint.ANTI_ALIAS_FLAG) }

                    Canvas(
                        modifier = Modifier
                            .size(padSize)
                            .pointerInput(Unit) {
                                detectTapGestures { offset ->
                                    updateLightFromTouch(offset, min(size.width, size.height).toFloat())
                                }
                            }
                            .pointerInput(Unit) {
                                detectDragGestures { change, _ ->
                                    change.consume()
                                    updateLightFromTouch(change.position, min(size.width, size.height).toFloat())
                                }
                            }
                    ) {
                        val r = min(size.width, size.height) * 0.46f
                        val center = Offset(size.width * 0.5f, size.height * 0.5f)

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            drawIntoCanvas { canvas ->
                                shaderPaint.shader = VirtualLightingStudioShader.createDomePreviewRuntimeShader(
                                    widthPx = size.width,
                                    heightPx = size.height,
                                    light = light
                                )
                                canvas.nativeCanvas.drawCircle(center.x, center.y, r, shaderPaint)
                            }
                        } else {
                            val azRad = light.directionDeg * (PI.toFloat() / 180f)
                            val highlightOffset = Offset(
                                center.x + cos(azRad) * r * 0.42f,
                                center.y + sin(azRad) * r * 0.42f
                            )
                            drawCircle(
                                brush = Brush.radialGradient(
                                    colors = listOf(Color(0xFFFDE68A), Color(0xFF475569), Color(0xFF0F172A)),
                                    center = highlightOffset,
                                    radius = r * 1.35f
                                ),
                                radius = r,
                                center = center
                            )
                        }

                        // Subtle azimuth & elevation reference rings
                        drawCircle(
                            color = Color(0x5594A3B8),
                            radius = r,
                            center = center,
                            style = Stroke(width = 1.4f)
                        )
                        drawCircle(
                            color = Color(0x3394A3B8),
                            radius = r * 0.52f,
                            center = center,
                            style = Stroke(width = 1.0f)
                        )

                        // Light handle orb position from (directionDeg, elevationDeg)
                        val normDist = ((72f - light.elevationDeg) / 82f).coerceIn(0f, 1f)
                        val azRad = light.directionDeg * (PI.toFloat() / 180f)
                        val handlePos = Offset(
                            center.x + cos(azRad) * r * 0.92f * normDist,
                            center.y + sin(azRad) * r * 0.92f * normDist
                        )
                        drawLine(
                            color = Color(0x88FBBF24),
                            start = center,
                            end = handlePos,
                            strokeWidth = 1.5f
                        )
                        drawCircle(color = Color(0xEE020617), radius = 7.5f, center = handlePos)
                        drawCircle(color = Color(0xFFFBBF24), radius = 5.5f, center = handlePos)
                    }
                }

                // Right Column: Intensity, Warmth & Quick Light Direction Presets
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Intensity ${(light.intensity * 100f).roundToInt()}%",
                            color = Color(0xFFCBD5E1),
                            fontSize = 10.sp,
                            modifier = Modifier.width(78.dp)
                        )
                        Slider(
                            value = light.intensity,
                            onValueChange = { onLightChange(light.copy(intensity = it)) },
                            valueRange = 0f..1f,
                            colors = SliderDefaults.colors(
                                thumbColor = Color(0xFFFBBF24),
                                activeTrackColor = Color(0xFFFBBF24)
                            ),
                            modifier = Modifier.weight(1f).height(24.dp)
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Warmth ${(light.warmth * 100f).roundToInt()}",
                            color = Color(0xFFCBD5E1),
                            fontSize = 10.sp,
                            modifier = Modifier.width(78.dp)
                        )
                        Slider(
                            value = light.warmth,
                            onValueChange = { onLightChange(light.copy(warmth = it)) },
                            valueRange = -0.35f..0.55f,
                            colors = SliderDefaults.colors(
                                thumbColor = Color(0xFFFB923C),
                                activeTrackColor = Color(0xFFFB923C)
                            ),
                            modifier = Modifier.weight(1f).height(24.dp)
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        listOf(
                            Triple("Left", 180f, 30f),
                            Triple("Top", 270f, 44f),
                            Triple("Key", 315f, 38f),
                            Triple("Right", 0f, 30f)
                        ).forEach { (label, dir, elev) ->
                            val isNear = kotlin.math.abs(((light.directionDeg - dir + 540f) % 360f) - 180f) < 22f
                            Text(
                                label,
                                color = if (isNear) Color(0xFF0F172A) else Color(0xFF94A3B8),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (isNear) Color(0xFFFBBF24) else Color(0xFF1E293B))
                                    .clickable {
                                        onLightChange(
                                            light.copy(
                                                enabled = true,
                                                directionDeg = dir,
                                                elevationDeg = elev
                                            )
                                        )
                                    }
                                    .padding(vertical = 4.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center
                            )
                        }
                    }
                }
            }
        }
    }
}
