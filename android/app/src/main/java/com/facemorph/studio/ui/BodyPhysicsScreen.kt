package com.facemorph.studio.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.Air
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facemorph.studio.engine.ClothMeshState
import com.facemorph.studio.engine.NativeClothPhysicsEngine
import com.facemorph.studio.model.FabricType
import com.facemorph.studio.model.MotionPreset
import com.facemorph.studio.viewmodel.StudioViewModel
import kotlin.math.hypot
import kotlin.math.min

@Composable
fun BodyPhysicsScreen(viewModel: StudioViewModel) {
    val targetBmp = viewModel.targetBitmap
    val scan = viewModel.bodyScan
    val clothConfig = viewModel.clothConfig
    val wardrobeAssets = viewModel.wardrobeAssets
    val wardrobeBitmaps = viewModel.wardrobeBitmapCache.toMap()
    val clothMeshes = remember { mutableStateMapOf<String, ClothMeshState>() }

    var simTimeSec by remember { mutableFloatStateOf(0f) }

    // 60 FPS Native Kotlin Verlet Cloth & Air Physics Loop
    LaunchedEffect(clothConfig.isSimulating, targetBmp) {
        var lastNanos = 0L
        while (clothConfig.isSimulating) {
            withFrameNanos { nanos ->
                if (lastNanos != 0L) {
                    val dt = ((nanos - lastNanos) / 1_000_000_000f).coerceIn(0f, 0.05f)
                    simTimeSec += dt
                }
                lastNanos = nanos
            }
        }
    }

    val renderedFrame: Bitmap? = if (targetBmp != null && scan != null) {
        NativeClothPhysicsEngine.renderBodyAndFittedAssets(
            targetBitmap = targetBmp,
            scan = scan,
            layers = viewModel.fittedLayers,
            assetsMap = wardrobeAssets.associateBy { it.id },
            assetBitmaps = wardrobeBitmaps,
            clothMeshes = clothMeshes,
            clothConfig = clothConfig,
            timeSec = simTimeSec,
            showScanHud = viewModel.showBodyScanHud
        )
    } else null

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF020617))
    ) {
        // Top Body Measurements Ribbon
        if (scan != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0F172A))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("BODY SCAN", color = Color(0xFF22D3EE), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text(scan.estimatedSize, color = Color.White, fontSize = 11.sp, modifier = Modifier.background(Color(0xFF1E293B), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                Text("Shoulders ${scan.shoulderWidthCm}cm", color = Color(0xFFCBD5E1), fontSize = 10.sp)
                Text("Chest ${scan.chestCm}cm", color = Color(0xFFCBD5E1), fontSize = 10.sp)
                Text("Waist ${scan.waistCm}cm", color = Color(0xFFCBD5E1), fontSize = 10.sp)
            }
        }

        // Interactive 60 FPS Cloth Physics Canvas
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color(0xFF090D16)),
            contentAlignment = Alignment.Center
        ) {
            if (renderedFrame != null) {
                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(viewModel.selectedWardrobeId) {
                            detectTransformGestures { _, _, zoom, _ ->
                                if (zoom != 1f) {
                                    val activeLayer = viewModel.fittedLayers.find { it.assetId == viewModel.selectedWardrobeId }
                                    if (activeLayer != null) {
                                        viewModel.updateActiveLayerScale(exactScale = activeLayer.scale * zoom)
                                    }
                                }
                            }
                        }
                        .pointerInput(viewModel.selectedWardrobeId, renderedFrame.width, renderedFrame.height) {
                            detectDragGestures(
                                onDragStart = { startOffset ->
                                    val mesh = clothMeshes[viewModel.selectedWardrobeId] ?: return@detectDragGestures
                                    val bw = renderedFrame.width.toFloat()
                                    val bh = renderedFrame.height.toFloat()
                                    val scale = min(size.width / bw, size.height / bh)
                                    val imgX = (startOffset.x - (size.width - bw * scale) / 2f) / scale
                                    val imgY = (startOffset.y - (size.height - bh * scale) / 2f) / scale
                                    var bestIdx: Int? = null
                                    var bestDist = 140f
                                    mesh.particles.forEachIndexed { idx, p ->
                                        if (!p.pinned) {
                                            val d = hypot((p.x - imgX).toDouble(), (p.y - imgY).toDouble()).toFloat()
                                            if (d < bestDist) {
                                                bestDist = d
                                                bestIdx = idx
                                            }
                                        }
                                    }
                                    mesh.grabbedIndex = bestIdx
                                    mesh.grabbedX = imgX
                                    mesh.grabbedY = imgY
                                },
                                onDragEnd = {
                                    clothMeshes[viewModel.selectedWardrobeId]?.grabbedIndex = null
                                },
                                onDragCancel = {
                                    clothMeshes[viewModel.selectedWardrobeId]?.grabbedIndex = null
                                },
                                onDrag = { change, dragAmount ->
                                    change.consume()
                                    val mesh = clothMeshes[viewModel.selectedWardrobeId] ?: return@detectDragGestures
                                    val bw = renderedFrame.width.toFloat()
                                    val bh = renderedFrame.height.toFloat()
                                    val scale = min(size.width / bw, size.height / bh)
                                    if (mesh.grabbedIndex != null) {
                                        mesh.grabbedX += dragAmount.x / scale
                                        mesh.grabbedY += dragAmount.y / scale
                                    }
                                }
                            )
                        }
                ) {
                    val bw = renderedFrame.width.toFloat()
                    val bh = renderedFrame.height.toFloat()
                    val scale = min(size.width / bw, size.height / bh)
                    val drawW = bw * scale
                    val drawH = bh * scale
                    val left = (size.width - drawW) / 2f
                    val top = (size.height - drawH) / 2f

                    drawImage(
                        image = renderedFrame.asImageBitmap(),
                        dstOffset = IntOffset(left.toInt(), top.toInt()),
                        dstSize = IntSize(drawW.toInt(), drawH.toInt())
                    )
                }
            }

            // Floating HUD Action Buttons
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                IconButton(
                    onClick = { viewModel.clothConfig = clothConfig.copy(isSimulating = !clothConfig.isSimulating) },
                    modifier = Modifier.size(38.dp).clip(CircleShape).background(Color(0xBB0F172A))
                ) {
                    Icon(
                        if (clothConfig.isSimulating) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = "Play/Pause Physics",
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                }

                IconButton(
                    onClick = { viewModel.clothConfig = clothConfig.copy(airFanActive = !clothConfig.airFanActive) },
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(if (clothConfig.airFanActive) Color(0xFF0891B2) else Color(0xBB0F172A))
                ) {
                    Icon(Icons.Default.Air, contentDescription = "Air Fan", tint = Color.White, modifier = Modifier.size(18.dp))
                }

                IconButton(
                    onClick = { viewModel.clothConfig = clothConfig.copy(showWireframe = !clothConfig.showWireframe) },
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(if (clothConfig.showWireframe) Color(0xFF4F46E5) else Color(0xBB0F172A))
                ) {
                    Icon(Icons.Default.GridOn, contentDescription = "Spring Lattice", tint = Color.White, modifier = Modifier.size(18.dp))
                }

                IconButton(
                    onClick = { renderedFrame?.let { viewModel.exportBitmapToGallery(it, "BodyFit") } },
                    modifier = Modifier.size(38.dp).clip(CircleShape).background(Color(0xFF059669))
                ) {
                    Icon(Icons.Default.Download, contentDescription = "Export", tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }

            // Scale Quick Buttons on Bottom Right
            val activeLayer = viewModel.fittedLayers.find { it.assetId == viewModel.selectedWardrobeId }
            if (activeLayer != null) {
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(10.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xCC0F172A))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { viewModel.updateActiveLayerScale(delta = -0.06f) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.ZoomOut, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                    Text("${(activeLayer.scale * 100).toInt()}%", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    IconButton(onClick = { viewModel.updateActiveLayerScale(delta = 0.06f) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.ZoomIn, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }

        // Bottom Wardrobe + Gravity & Air Physics Controls
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(270.dp)
                .background(Color(0xFF0F172A))
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Wardrobe Strip + Custom Scan Button
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Button(
                    onClick = { viewModel.showCustomAssetDialog = true },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                    modifier = Modifier.height(54.dp)
                ) {
                    Icon(Icons.Default.AddAPhoto, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Scan\nCostume", fontSize = 10.sp, lineHeight = 12.sp)
                }

                wardrobeAssets.forEach { asset ->
                    val bmp = wardrobeBitmaps[asset.id]
                    val isVisible = viewModel.fittedLayers.any { it.assetId == asset.id && it.visible }
                    val isSelected = viewModel.selectedWardrobeId == asset.id
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .border(
                                width = if (isSelected) 2.dp else 1.dp,
                                color = if (isSelected) Color(0xFF6366F1) else Color(0xFF334155),
                                shape = RoundedCornerShape(12.dp)
                            )
                            .background(if (isVisible) Color(0xFF1E1B4B) else Color(0xFF020617))
                            .clickable { viewModel.toggleAttachWardrobeAsset(asset.id) }
                            .padding(6.dp)
                    ) {
                        if (bmp != null) {
                            Image(
                                bitmap = bmp.asImageBitmap(),
                                contentDescription = asset.name,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color.White)
                            )
                        }
                        Spacer(Modifier.width(6.dp))
                        Column {
                            Text(asset.name, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                            Text(if (isVisible) "Stitched" else "Tap to Wear", color = if (isVisible) Color(0xFF34D399) else Color(0xFF94A3B8), fontSize = 9.sp)
                        }
                    }
                }
            }

            // Motion Presets & Fabric Selector
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                MotionPreset.entries.forEach { preset ->
                    FilterChip(
                        selected = clothConfig.preset == preset,
                        onClick = { viewModel.clothConfig = clothConfig.copy(preset = preset, isSimulating = true) },
                        label = { Text(preset.label, fontSize = 10.sp) }
                    )
                }
            }

            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                FabricType.entries.forEach { fabric ->
                    FilterChip(
                        selected = clothConfig.fabricType == fabric,
                        onClick = {
                            viewModel.clothConfig = clothConfig.copy(
                                fabricType = fabric,
                                gravity = fabric.defaultGravity,
                                damping = fabric.damping
                            )
                        },
                        label = { Text(fabric.label, fontSize = 10.sp) }
                    )
                }
            }

            // Gravity & Air Drag Sliders
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Gravity ${String.format("%.2f", clothConfig.gravity)}G", color = Color(0xFFFBBF24), fontSize = 11.sp, modifier = Modifier.width(102.dp))
                Slider(
                    value = clothConfig.gravity,
                    onValueChange = { viewModel.clothConfig = clothConfig.copy(gravity = it) },
                    valueRange = 0.1f..2.0f,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFFF59E0B), activeTrackColor = Color(0xFFF59E0B)),
                    modifier = Modifier.weight(1f)
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Air Drag ${clothConfig.airResistance}%", color = Color(0xFF818CF8), fontSize = 11.sp, modifier = Modifier.width(102.dp))
                Slider(
                    value = clothConfig.airResistance.toFloat(),
                    onValueChange = { viewModel.clothConfig = clothConfig.copy(airResistance = it.toInt()) },
                    valueRange = 0f..100f,
                    modifier = Modifier.weight(1f)
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Wind ${String.format("%+.1f", clothConfig.windStrength)} m/s", color = Color(0xFF22D3EE), fontSize = 11.sp, modifier = Modifier.width(102.dp))
                Slider(
                    value = clothConfig.windStrength,
                    onValueChange = { viewModel.clothConfig = clothConfig.copy(windStrength = it) },
                    valueRange = -8f..8f,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFF06B6D4), activeTrackColor = Color(0xFF06B6D4)),
                    modifier = Modifier.weight(1f)
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Stress Heatmap", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                    Spacer(Modifier.width(6.dp))
                    Switch(
                        checked = clothConfig.showStressHeatmap,
                        onCheckedChange = { viewModel.clothConfig = clothConfig.copy(showStressHeatmap = it) }
                    )
                }
                Button(
                    onClick = { clothMeshes.clear() },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B))
                ) {
                    Icon(Icons.Default.RestartAlt, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Reset Cloth", fontSize = 11.sp)
                }
            }
        }
    }
}
