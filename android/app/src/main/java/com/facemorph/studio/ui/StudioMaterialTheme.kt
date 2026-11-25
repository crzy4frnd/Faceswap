package com.facemorph.studio.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Material 3 Dark Surface Hierarchy for FaceMorph Android Studio.
 * Uses tonal Material You surface elevation instead of web-style dark slate 1dp borders.
 */
object StudioColors {
    val Background = Color(0xFF0E1015)
    val SurfaceContainerLowest = Color(0xFF0A0C10)
    val SurfaceContainerLow = Color(0xFF151821)
    val SurfaceContainer = Color(0xFF1C202B)
    val SurfaceContainerHigh = Color(0xFF262B39)
    val SurfaceContainerHighest = Color(0xFF313748)

    val Primary = Color(0xFF93A8FF)
    val OnPrimary = Color(0xFF0E173B)
    val PrimaryContainer = Color(0xFF34417A)
    val OnPrimaryContainer = Color(0xFFE1E6FF)

    val Secondary = Color(0xFF56D6F0)
    val SecondaryContainer = Color(0xFF194250)
    val OnSecondaryContainer = Color(0xFFCFF4FF)

    val Tertiary = Color(0xFF5CE0A8)
    val TertiaryContainer = Color(0xFF144835)
    val OnTertiaryContainer = Color(0xFFD2FBE7)

    val Warning = Color(0xFFF6C453)
    val WarningContainer = Color(0xFF4B3811)

    val Danger = Color(0xFFFF8C8C)
    val DangerContainer = Color(0xFF5C1E26)

    val TextPrimary = Color(0xFFF1F3F9)
    val TextSecondary = Color(0xFFB4BCCF)
    val TextMuted = Color(0xFF7D859B)
    val OutlineVariant = Color(0xFF363D50)

    val FloatingGlass = Color(0xDC161A24)
}

val AndroidMaterialColorScheme = darkColorScheme(
    primary = StudioColors.Primary,
    onPrimary = StudioColors.OnPrimary,
    primaryContainer = StudioColors.PrimaryContainer,
    onPrimaryContainer = StudioColors.OnPrimaryContainer,
    secondary = StudioColors.Secondary,
    secondaryContainer = StudioColors.SecondaryContainer,
    onSecondaryContainer = StudioColors.OnSecondaryContainer,
    tertiary = StudioColors.Tertiary,
    tertiaryContainer = StudioColors.TertiaryContainer,
    onTertiaryContainer = StudioColors.OnTertiaryContainer,
    background = StudioColors.Background,
    onBackground = StudioColors.TextPrimary,
    surface = StudioColors.SurfaceContainerLow,
    onSurface = StudioColors.TextPrimary,
    surfaceVariant = StudioColors.SurfaceContainerHigh,
    onSurfaceVariant = StudioColors.TextSecondary,
    outline = StudioColors.OutlineVariant
)

@Composable
fun StudioSheetDragHandle(
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 8.dp, bottom = 4.dp),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .width(38.dp)
                .height(4.dp)
                .clip(CircleShape)
                .background(StudioColors.OutlineVariant)
        )
    }
}

@Composable
fun StudioSectionCard(
    modifier: Modifier = Modifier,
    containerColor: Color = StudioColors.SurfaceContainer,
    contentPadding: PaddingValues = PaddingValues(12.dp),
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = containerColor,
        tonalElevation = 2.dp
    ) {
        Column(
            modifier = Modifier.padding(contentPadding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content
        )
    }
}

@Composable
fun StudioFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    selectedContainerColor: Color = StudioColors.PrimaryContainer,
    selectedContentColor: Color = StudioColors.OnPrimaryContainer
) {
    val bg by animateColorAsState(
        targetValue = if (selected) selectedContainerColor else StudioColors.SurfaceContainerHigh,
        label = "chipBg"
    )
    val fg by animateColorAsState(
        targetValue = if (selected) selectedContentColor else StudioColors.TextSecondary,
        label = "chipFg"
    )
    Surface(
        modifier = modifier
            .defaultMinSize(minHeight = 38.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable { onClick() },
        shape = RoundedCornerShape(12.dp),
        color = bg
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = fg,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(6.dp))
            }
            Text(
                text = label,
                color = fg,
                fontSize = 12.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun StudioTonalActionButton(
    label: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    containerColor: Color = StudioColors.SurfaceContainerHigh,
    contentColor: Color = StudioColors.TextPrimary,
    iconTint: Color = StudioColors.Primary,
    enabled: Boolean = true
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = containerColor,
            contentColor = contentColor,
            disabledContainerColor = StudioColors.SurfaceContainer,
            disabledContentColor = StudioColors.TextMuted
        ),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
        modifier = modifier.height(44.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (enabled) iconTint else StudioColors.TextMuted,
            modifier = Modifier.size(18.dp)
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = label,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun StudioFloatingIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    activeContainerColor: Color = StudioColors.PrimaryContainer,
    activeContentColor: Color = Color.White,
    containerColor: Color = StudioColors.FloatingGlass,
    iconTint: Color = StudioColors.TextPrimary,
    size: Dp = 42.dp,
    badgeDotColor: Color? = null
) {
    val bg by animateColorAsState(
        targetValue = if (active) activeContainerColor else containerColor,
        label = "floatingBtnBg"
    )
    val fg = if (active) activeContentColor else iconTint
    Surface(
        modifier = modifier.size(size),
        shape = CircleShape,
        color = bg,
        shadowElevation = 6.dp
    ) {
        Box(
            modifier = Modifier
                .clip(CircleShape)
                .clickable { onClick() },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = fg,
                modifier = Modifier.size(20.dp)
            )
            if (badgeDotColor != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(7.dp)
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(badgeDotColor)
                )
            }
        }
    }
}

@Composable
fun StudioSliderRow(
    label: String,
    valueText: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    valueRange: ClosedFloatingPointRange<Float>,
    modifier: Modifier = Modifier,
    onValueChangeFinished: (() -> Unit)? = null,
    accentColor: Color = StudioColors.Primary,
    valueColor: Color = accentColor
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                color = StudioColors.TextPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = valueText,
                color = valueColor,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
        }
        Slider(
            value = value,
            onValueChange = onValueChange,
            onValueChangeFinished = onValueChangeFinished,
            valueRange = valueRange,
            colors = SliderDefaults.colors(
                thumbColor = accentColor,
                activeTrackColor = accentColor,
                inactiveTrackColor = StudioColors.SurfaceContainerHighest
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(30.dp)
        )
    }
}

@Composable
fun StudioBottomToolItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val pillColor by animateColorAsState(
        targetValue = if (selected) StudioColors.PrimaryContainer else Color.Transparent,
        label = "toolPill"
    )
    val fgColor by animateColorAsState(
        targetValue = if (selected) StudioColors.OnPrimaryContainer else StudioColors.TextSecondary,
        label = "toolFg"
    )
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(vertical = 6.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .width(48.dp)
                .height(28.dp)
                .clip(CircleShape)
                .background(pillColor),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = fgColor,
                modifier = Modifier.size(20.dp)
            )
        }
        Spacer(Modifier.height(3.dp))
        Text(
            text = label,
            color = fgColor,
            fontSize = 11.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
