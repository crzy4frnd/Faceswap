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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessibilityNew
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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
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

    var activeDeckTab by remember { mutableIntStateOf(0) } // 0=Wardrobe, 1=Physics
    var simTimeSec by remember { mutableFloatStateOf(0f) }

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
        // Slim Top Body Fit Info + Subject Selector + Save
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF0A0F1E))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (scan != null) {
                    Text(
                        scan.estimatedSize,
                        color = Color(0xFF22D3EE),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF0F172A))
                            .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(6.dp))
                            .padding(horizontal = 7.dp, vertical = 4.dp)
                    )
                    Text("${scan.shoulderWidthCm}cm Shldr", color = Color(0xFF94A3B8), fontSize = 10.sp)
                }
                if (viewModel.detectedFaces.size > 1) {
                    viewModel.detectedFaces.forEachIndexed { idx, f ->
                        val isSubject = viewModel.bodySubjectFaceId == f.id
                        Text(
                            "Person ${idx + 1}",
                            color = if (isSubject) Color.White else Color(0xFF94A3B8),
                            fontSize = 10.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSubject) Color(0xFF4F46E5) else Color(0xFF111827))
                                .clickable {
                                    clothMeshes.clear()
                                    viewModel.selectBodySubjectFace(f.id)
                                }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }
            }
            Spacer(Modifier.width(6.dp))
            Button(
                onClick = { renderedFrame?.let { viewModel.exportBitmapToGallery(it, "BodyFit") } },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.height(30.dp),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp)
            ) {
                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("Save", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        // Unobstructed 60 FPS Cloth Physics Canvas
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color(0xFF060A13)),
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
                                onDragEnd = { clothMeshes[viewModel.selectedWardrobeId]?.grabbedIndex = null },
                                onDragCancel = { clothMeshes[viewModel.selectedWardrobeId]?.grabbedIndex = null },
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

            // Sleek Bottom Corner Controls (Play, Fan, Body HUD, Scale)
            Row(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(9.dp))
                        .background(Color(0xCC0B1120))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(9.dp))
                        .clickable { viewModel.clothConfig = clothConfig.copy(isSimulating = !clothConfig.isSimulating) },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        if (clothConfig.isSimulating) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(9.dp))
                        .background(if (clothConfig.airFanActive) Color(0xDD0891B2) else Color(0xCC0B1120))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(9.dp))
                        .clickable { viewModel.clothConfig = clothConfig.copy(airFanActive = !clothConfig.airFanActive) },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Air, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                }
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(9.dp))
                        .background(if (viewModel.showBodyScanHud) Color(0xDD4F46E5) else Color(0xCC0B1120))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(9.dp))
                        .clickable { viewModel.showBodyScanHud = !viewModel.showBodyScanHud },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.AccessibilityNew, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                }
            }

            val activeLayer = viewModel.fittedLayers.find { it.assetId == viewModel.selectedWardrobeId }
            if (activeLayer != null) {
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(10.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xCC0B1120))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                        .padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { viewModel.updateActiveLayerScale(delta = -0.06f) }, modifier = Modifier.size(30.dp)) {
                        Icon(Icons.Default.ZoomOut, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
                    }
                    Text("${(activeLayer.scale * 100).toInt()}%", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    IconButton(onClick = { viewModel.updateActiveLayerScale(delta = 0.06f) }, modifier = Modifier.size(30.dp)) {
                        Icon(Icons.Default.ZoomIn, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
                    }
                }
            }
        }

        // Clean Segmented Bottom Studio Deck
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(216.dp)
                .background(Color(0xFF0B1120))
                .border(1.dp, Color(0xFF1E293B))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFF111827))
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                listOf("Wardrobe", "Cloth Physics").forEachIndexed { idx, label ->
                    val selected = activeDeckTab == idx
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) Color(0xFF4F46E5) else Color.Transparent)
                            .clickable { activeDeckTab = idx }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(label, color = if (selected) Color.White else Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            if (activeDeckTab == 0) {
                // Wardrobe Strip on Clean Dark Slate Backdrops (No White Squares!)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier
                            .height(92.dp)
                            .width(78.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFFD97706))
                            .clickable { viewModel.showCustomAssetDialog = true }
                            .padding(6.dp)
                    ) {
                        Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.height(4.dp))
                        Text("Scan\nCostume", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold, lineHeight = 12.sp)
                    }

                    wardrobeAssets.forEach { asset ->
                        val bmp = wardrobeBitmaps[asset.id]
                        val isVisible = viewModel.fittedLayers.any { it.assetId == asset.id && it.visible }
                        val isSelected = viewModel.selectedWardrobeId == asset.id
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier
                                .width(84.dp)
                                .height(92.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .border(1.5.dp, if (isSelected) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(12.dp))
                                .background(if (isVisible) Color(0xFF1E1B4B) else Color(0xFF111827))
                                .clickable { viewModel.toggleAttachWardrobeAsset(asset.id) }
                                .padding(6.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF162033)),
                                contentAlignment = Alignment.Center
                            ) {
                                if (bmp != null) {
                                    Image(
                                        bitmap = bmp.asImageBitmap(),
                                        contentDescription = asset.name,
                                        contentScale = ContentScale.Fit,
                                        modifier = Modifier.fillMaxSize().padding(3.dp)
                                    )
                                }
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(asset.name, color = Color.White, fontSize = 10.sp, maxLines = 1, fontWeight = FontWeight.Medium)
                            Text(if (isVisible) "Wearing" else asset.category.label, color = if (isVisible) Color(0xFF34D399) else Color(0xFF64748B), fontSize = 9.sp)
                        }
                    }
                }

                // Quick Material Pills under Wardrobe
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Fabric:", color = Color(0xFF64748B), fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                    FabricType.entries.forEach { fabric ->
                        val sel = clothConfig.fabricType == fabric
                        Text(
                            fabric.label,
                            color = if (sel) Color.White else Color(0xFF94A3B8),
                            fontSize = 10.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (sel) Color(0xFF312E81) else Color(0xFF111827))
                                .border(1.dp, if (sel) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(8.dp))
                                .clickable {
                                    viewModel.clothConfig = clothConfig.copy(
                                        fabricType = fabric,
                                        gravity = fabric.defaultGravity,
                                        damping = fabric.damping
                                    )
                                }
                                .padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                }
            } else {
                // Physics Controls (Clean, Unclipped)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    MotionPreset.entries.forEach { preset ->
                        val sel = clothConfig.preset == preset
                        Text(
                            preset.label,
                            color = if (sel) Color.White else Color(0xFF94A3B8),
                            fontSize = 10.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (sel) Color(0xFF312E81) else Color(0xFF111827))
                                .border(1.dp, if (sel) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(8.dp))
                                .clickable { viewModel.clothConfig = clothConfig.copy(preset = preset, isSimulating = true) }
                                .padding(horizontal = 9.dp, vertical = 5.dp)
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Gravity ${String.format("%.2f", clothConfig.gravity)}G", color = Color(0xFFFBBF24), fontSize = 11.sp, modifier = Modifier.width(96.dp))
                    Slider(
                        value = clothConfig.gravity,
                        onValueChange = { viewModel.clothConfig = clothConfig.copy(gravity = it) },
                        valueRange = 0.1f..2.0f,
                        colors = SliderDefaults.colors(thumbColor = Color(0xFFF59E0B), activeTrackColor = Color(0xFFF59E0B)),
                        modifier = Modifier.weight(1f).height(28.dp)
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Wind ${String.format("%+.1f", clothConfig.windStrength)} m/s", color = Color(0xFF22D3EE), fontSize = 11.sp, modifier = Modifier.width(96.dp))
                    Slider(
                        value = clothConfig.windStrength,
                        onValueChange = { viewModel.clothConfig = clothConfig.copy(windStrength = it) },
                        valueRange = -8f..8f,
                        colors = SliderDefaults.colors(thumbColor = Color(0xFF06B6D4), activeTrackColor = Color(0xFF06B6D4)),
                        modifier = Modifier.weight(1f).height(28.dp)
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Lattice",
                            color = if (clothConfig.showWireframe) Color.White else Color(0xFF94A3B8),
                            fontSize = 10.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (clothConfig.showWireframe) Color(0xFF4F46E5) else Color(0xFF111827))
                                .clickable { viewModel.clothConfig = clothConfig.copy(showWireframe = !clothConfig.showWireframe) }
                                .padding(horizontal = 9.dp, vertical = 5.dp)
                        )
                        Text(
                            "Stress Map",
                            color = if (clothConfig.showStressHeatmap) Color.White else Color(0xFF94A3B8),
                            fontSize = 10.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (clothConfig.showStressHeatmap) Color(0xFFBE123C) else Color(0xFF111827))
                                .clickable { viewModel.clothConfig = clothConfig.copy(showStressHeatmap = !clothConfig.showStressHeatmap) }
                                .padding(horizontal = 9.dp, vertical = 5.dp)
                        )
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF1E293B))
                            .clickable { clothMeshes.clear() }
                            .padding(horizontal = 10.dp, vertical = 5.dp)
                    ) {
                        Icon(Icons.Default.RestartAlt, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Reset", color = Color.White, fontSize = 10.sp)
                    }
                }
            }
        }
    }
}
