package com.facemorph.studio.ui

import android.graphics.Paint as NativePaint
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.text.style.TextAlign
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

    StudioSectionCard(
        containerColor = StudioColors.SurfaceContainer,
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp)
    ) {
        // Header Bar: Icon + Title + Auto-Match + Reset + Enable Switch
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = if (light.enabled) StudioColors.WarningContainer else StudioColors.SurfaceContainerHigh,
                    modifier = Modifier.size(32.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.WbSunny,
                            contentDescription = null,
                            tint = if (light.enabled) StudioColors.Warning else StudioColors.TextMuted,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        "Lighting Studio",
                        color = StudioColors.TextPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        if (light.enabled) "Drag 3D dome to move key light" else "Relighting paused",
                        color = StudioColors.TextMuted,
                        fontSize = 11.sp
                    )
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (onAutoMatchTarget != null) {
                    FilledTonalButton(
                        onClick = onAutoMatchTarget,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = StudioColors.PrimaryContainer,
                            contentColor = StudioColors.OnPrimaryContainer
                        ),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                        modifier = Modifier.height(36.dp)
                    ) {
                        Icon(Icons.Default.AutoFixHigh, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Auto", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                FilledTonalIconButton(
                    onClick = { onLightChange(VirtualLightConfig()) },
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = StudioColors.SurfaceContainerHigh,
                        contentColor = StudioColors.TextSecondary
                    ),
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(Icons.Default.RestartAlt, contentDescription = "Reset Lighting", modifier = Modifier.size(18.dp))
                }
                Switch(
                    checked = light.enabled,
                    onCheckedChange = { onLightChange(light.copy(enabled = it)) },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = StudioColors.OnPrimary,
                        checkedTrackColor = StudioColors.Warning,
                        uncheckedTrackColor = StudioColors.SurfaceContainerHighest
                    )
                )
            }
        }

        if (light.enabled) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Interactive 360-degree Ambient Light Direction + Elevation Dome Pad
                val padSize = if (compact) 86.dp else 104.dp
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
                        drawCircle(color = Color(0xEE0E1015), radius = 8.5f, center = handlePos)
                        drawCircle(color = StudioColors.Warning, radius = 6.2f, center = handlePos)
                    }
                }

                // Right Column: Readable Sliders + Thumb Presets
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    StudioSliderRow(
                        label = "Intensity",
                        valueText = "${(light.intensity * 100f).roundToInt()}%",
                        value = light.intensity,
                        onValueChange = { onLightChange(light.copy(intensity = it)) },
                        valueRange = 0f..1f,
                        accentColor = StudioColors.Warning
                    )

                    StudioSliderRow(
                        label = "Warmth",
                        valueText = "${(light.warmth * 100f).roundToInt()}",
                        value = light.warmth,
                        onValueChange = { onLightChange(light.copy(warmth = it)) },
                        valueRange = -0.35f..0.55f,
                        accentColor = Color(0xFFFB923C)
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(
                    Triple("Left", 180f, 30f),
                    Triple("Top", 270f, 44f),
                    Triple("Key", 315f, 38f),
                    Triple("Right", 0f, 30f)
                ).forEach { (label, dir, elev) ->
                    val isNear = kotlin.math.abs(((light.directionDeg - dir + 540f) % 360f) - 180f) < 22f
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .height(36.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .clickable {
                                onLightChange(
                                    light.copy(
                                        enabled = true,
                                        directionDeg = dir,
                                        elevationDeg = elev
                                    )
                                )
                            },
                        shape = RoundedCornerShape(10.dp),
                        color = if (isNear) StudioColors.Warning else StudioColors.SurfaceContainerHigh
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                text = label,
                                color = if (isNear) StudioColors.OnPrimary else StudioColors.TextSecondary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }
            }
        }
    }
}
