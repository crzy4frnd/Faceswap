package com.facemorph.studio.ui

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Compare
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facemorph.studio.engine.NativeFaceSwapEngine
import com.facemorph.studio.viewmodel.StudioViewModel
import kotlin.math.hypot
import kotlin.math.min

@Composable
fun FaceStudioScreen(viewModel: StudioViewModel) {
    val targetBmp = viewModel.targetBitmap
    val faces = viewModel.detectedFaces
    val adj = viewModel.adjustments
    val profileCache = viewModel.profileBitmapCache.toMap()
    val metricsCache = viewModel.profileMetricsCache.toMap()

    var activeDeckTab by remember { mutableIntStateOf(0) } // 0=Faces, 1=Blend, 2=Align
    var activeLandmarkKey by remember { mutableStateOf("nose") }
    var viewportZoom by remember { mutableFloatStateOf(1f) }
    var viewportPan by remember { mutableStateOf(Offset.Zero) }

    LaunchedEffect(viewModel.activeTargetId, targetBmp) {
        viewportZoom = 1f
        viewportPan = Offset.Zero
    }

    val targetPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.loadTargetFromUri(it) }
    }
    val facePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.addCustomFaceFromUri(it, "My Face") }
    }

    val renderedBitmap: Bitmap? = remember(
        targetBmp,
        faces,
        profileCache,
        metricsCache,
        adj,
        viewModel.splitCompareEnabled,
        viewModel.splitComparePercent
    ) {
        targetBmp?.let {
            NativeFaceSwapEngine.renderFaceSwapComposite(
                targetBitmap = it,
                faces = faces,
                profileBitmaps = profileCache,
                profileMetrics = metricsCache,
                adjustments = adj,
                splitPercent = if (viewModel.splitCompareEnabled) viewModel.splitComparePercent else null
            )
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF020617))
    ) {
        // Slim Top Target Ribbon + Save Pill (No Overlap on Canvas)
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
                viewModel.targetSamples.forEach { sample ->
                    val selected = viewModel.activeTargetId == sample.id
                    Text(
                        text = sample.title,
                        color = if (selected) Color.White else Color(0xFF94A3B8),
                        fontSize = 11.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) Color(0xFF312E81) else Color(0xFF111827))
                            .border(1.dp, if (selected) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(8.dp))
                            .clickable { viewModel.loadTargetSample(sample) }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF111827))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                        .clickable { targetPicker.launch("image/*") }
                        .padding(horizontal = 9.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Photo", color = Color(0xFFE2E8F0), fontSize = 11.sp)
                }
            }
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = { renderedBitmap?.let { viewModel.exportBitmapToGallery(it, "FaceSwap") } },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.height(30.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 0.dp)
            ) {
                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("Save", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        // Clean Interactive Canvas Viewport
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clipToBounds()
                .background(Color(0xFF060A13)),
            contentAlignment = Alignment.Center
        ) {
            if (renderedBitmap != null) {
                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectTapGestures(
                                onDoubleTap = { tapOffset ->
                                    if (viewportZoom > 1.1f) {
                                        viewportZoom = 1f
                                        viewportPan = Offset.Zero
                                    } else {
                                        val cx = size.width / 2f
                                        val cy = size.height / 2f
                                        val newZoom = 2.25f
                                        viewportPan = Offset(
                                            (cx - tapOffset.x) * (newZoom - 1f) * 0.6f,
                                            (cy - tapOffset.y) * (newZoom - 1f) * 0.6f
                                        )
                                        viewportZoom = newZoom
                                    }
                                }
                            )
                        }
                        .pointerInput(adj.showGeometricMesh) {
                            detectTransformGestures { centroid, panDelta, zoomDelta, _ ->
                                val prevZoom = viewportZoom
                                val nextZoom = (prevZoom * zoomDelta).coerceIn(1f, 4f)
                                val allowSinglePan = !adj.showGeometricMesh && nextZoom > 1.02f
                                val effectivePan = if (zoomDelta != 1f || allowSinglePan) panDelta else Offset.Zero
                                val cx = size.width / 2f
                                val cy = size.height / 2f
                                val scaleRatio = nextZoom / prevZoom
                                val newPanX = (centroid.x - cx) - ((centroid.x - cx) - viewportPan.x) * scaleRatio + effectivePan.x
                                val newPanY = (centroid.y - cy) - ((centroid.y - cy) - viewportPan.y) * scaleRatio + effectivePan.y

                                viewportZoom = nextZoom
                                if (nextZoom <= 1.02f) {
                                    viewportPan = Offset.Zero
                                } else {
                                    val maxX = size.width * (nextZoom - 1f) * 0.55f
                                    val maxY = size.height * (nextZoom - 1f) * 0.55f
                                    viewportPan = Offset(
                                        newPanX.coerceIn(-maxX, maxX),
                                        newPanY.coerceIn(-maxY, maxY)
                                    )
                                }
                            }
                        }
                        .pointerInput(adj.showGeometricMesh, faces, viewModel.selectedFaceId) {
                            detectDragGestures { change, dragAmount ->
                                if (!adj.showGeometricMesh) return@detectDragGestures
                                change.consume()
                                val selId = viewModel.selectedFaceId ?: faces.firstOrNull()?.id ?: return@detectDragGestures
                                val bw = renderedBitmap.width.toFloat()
                                val bh = renderedBitmap.height.toFloat()
                                val baseScale = min(size.width / bw, size.height / bh)
                                val scale = baseScale * viewportZoom
                                val drawW = bw * scale
                                val drawH = bh * scale
                                val left = (size.width - drawW) / 2f + viewportPan.x
                                val top = (size.height - drawH) / 2f + viewportPan.y
                                val dxImg = dragAmount.x / scale
                                val dyImg = dragAmount.y / scale
                                val tapX = (change.position.x - left) / scale
                                val tapY = (change.position.y - top) / scale

                                val f = faces.find { it.id == selId }
                                if (f != null) {
                                    val lm = f.landmarks
                                    val pts = listOf(
                                        "forehead" to lm.forehead,
                                        "leftEye" to lm.leftEye,
                                        "rightEye" to lm.rightEye,
                                        "nose" to lm.nose,
                                        "lips" to lm.lips,
                                        "chin" to lm.chin
                                    )
                                    val nearest = pts.minByOrNull { (_, p) ->
                                        hypot((p.x - tapX).toDouble(), (p.y - tapY).toDouble())
                                    }
                                    if (nearest != null) activeLandmarkKey = nearest.first
                                    viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, dxImg, dyImg)
                                }
                            }
                        }
                ) {
                    val bw = renderedBitmap.width.toFloat()
                    val bh = renderedBitmap.height.toFloat()
                    val baseScale = min(size.width / bw, size.height / bh)
                    val scale = baseScale * viewportZoom
                    val drawW = bw * scale
                    val drawH = bh * scale
                    val left = (size.width - drawW) / 2f + viewportPan.x
                    val top = (size.height - drawH) / 2f + viewportPan.y

                    drawImage(
                        image = renderedBitmap.asImageBitmap(),
                        dstOffset = IntOffset(left.toInt(), top.toInt()),
                        dstSize = IntSize(drawW.toInt(), drawH.toInt())
                    )

                    if (adj.showGeometricMesh) {
                        drawIntoCanvas { canvas ->
                            val nc = canvas.nativeCanvas
                            nc.save()
                            nc.translate(left, top)
                            nc.scale(scale, scale)
                            NativeFaceSwapEngine.drawGeometricMesh(nc, faces)
                            nc.restore()
                        }
                    }

                    if (viewModel.splitCompareEnabled) {
                        val splitX = left + drawW * (viewModel.splitComparePercent / 100f)
                        drawLine(
                            color = Color.White,
                            start = Offset(splitX, top),
                            end = Offset(splitX, top + drawH),
                            strokeWidth = 2.5f
                        )
                    }
                }
            }

            if (viewportZoom > 1.05f) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(10.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xCC0B1120))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                        .clickable {
                            viewportZoom = 1f
                            viewportPan = Offset.Zero
                        }
                        .padding(horizontal = 9.dp, vertical = 5.dp)
                ) {
                    Text("${(viewportZoom * 100).toInt()}% · Reset", color = Color(0xFF22D3EE), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            // Minimal Bottom-Right Corner Tools (Never Obscuring Faces)
            Row(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (adj.showGeometricMesh) Color(0xDD0891B2) else Color(0xCC0B1120))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                        .clickable { viewModel.adjustments = adj.copy(showGeometricMesh = !adj.showGeometricMesh) }
                        .padding(horizontal = 9.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.GridOn, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Mesh", color = Color.White, fontSize = 11.sp)
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (viewModel.splitCompareEnabled) Color(0xDD4F46E5) else Color(0xCC0B1120))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                        .clickable { viewModel.splitCompareEnabled = !viewModel.splitCompareEnabled }
                        .padding(horizontal = 9.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.Compare, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Before/After", color = Color.White, fontSize = 11.sp)
                }
            }

            // Landmark Nudge Bar (only visible when Mesh is active)
            if (adj.showGeometricMesh && faces.isNotEmpty()) {
                val selId = viewModel.selectedFaceId ?: faces.first().id
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(10.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xDD0B1120))
                        .border(1.dp, Color(0xFF0891B2), RoundedCornerShape(12.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(activeLandmarkKey.uppercase(), color = Color(0xFF22D3EE), fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 4.dp))
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, -3f, 0f) }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.KeyboardArrowLeft, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 0f, -3f) }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.KeyboardArrowUp, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 0f, 3f) }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.KeyboardArrowDown, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 3f, 0f) }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.KeyboardArrowRight, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                    IconButton(onClick = { viewModel.resetFaceLandmarks(selId) }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.RestartAlt, contentDescription = "Reset", tint = Color(0xFFFBBF24), modifier = Modifier.size(16.dp))
                    }
                }
            }
        }

        // Clean Segmented Bottom Studio Deck (Zero Clipped Sliders!)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(212.dp)
                .background(Color(0xFF0B1120))
                .border(1.dp, Color(0xFF1E293B))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Segmented Tabs
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFF111827))
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                listOf("Faces", "Blend", "Align").forEachIndexed { idx, label ->
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
                        Text(
                            label,
                            color = if (selected) Color.White else Color(0xFF94A3B8),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }

            when (activeDeckTab) {
                0 -> {
                    // Faces Selection + Multi-Face Manager
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        viewModel.faceProfiles.forEach { profile ->
                            val isSelected = viewModel.activeProfileId == profile.id
                            val pBmp = profileCache[profile.id]
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(12.dp))
                                    .border(1.5.dp, if (isSelected) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(12.dp))
                                    .background(if (isSelected) Color(0xFF1E1B4B) else Color(0xFF111827))
                                    .clickable { viewModel.assignProfileToSelectedOrAll(profile.id) }
                                    .padding(8.dp)
                            ) {
                                if (pBmp != null) {
                                    Image(
                                        bitmap = pBmp.asImageBitmap(),
                                        contentDescription = profile.name,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.size(44.dp).clip(CircleShape)
                                    )
                                }
                                Spacer(Modifier.width(8.dp))
                                Column {
                                    Text(profile.name, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                    Text(profile.tag, color = Color(0xFF818CF8), fontSize = 10.sp)
                                }
                            }
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(12.dp))
                                .background(Color(0xFF111827))
                                .clickable { facePicker.launch("image/*") }
                                .padding(horizontal = 12.dp, vertical = 14.dp)
                        ) {
                            Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Import Face", color = Color(0xFFE2E8F0), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }

                    if (faces.size > 1) {
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            faces.forEachIndexed { idx, f ->
                                val isSel = viewModel.selectedFaceId == f.id
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(if (isSel) Color(0xFF312E81) else Color(0xFF111827))
                                        .border(1.dp, if (isSel) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(8.dp))
                                        .clickable {
                                            if (viewModel.selectedFaceId == f.id) {
                                                viewModel.toggleFaceEnabled(f.id)
                                            } else {
                                                viewModel.selectedFaceId = f.id
                                            }
                                        }
                                        .padding(horizontal = 10.dp, vertical = 6.dp)
                                ) {
                                    Text(
                                        "Face ${idx + 1} · ${if (f.enabled) "ON" else "OFF"}",
                                        color = if (f.enabled) Color.White else Color(0xFF64748B),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                }
                            }
                        }
                    } else if (viewModel.splitCompareEnabled) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Split ${viewModel.splitComparePercent.toInt()}%", color = Color(0xFF94A3B8), fontSize = 11.sp, modifier = Modifier.width(84.dp))
                            Slider(
                                value = viewModel.splitComparePercent,
                                onValueChange = { viewModel.splitComparePercent = it },
                                valueRange = 5f..95f,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    } else {
                        Text(
                            "Tip: Tap a face profile to swap. Enable Before/After to compare.",
                            color = Color(0xFF64748B),
                            fontSize = 11.sp
                        )
                    }
                }

                1 -> {
                    // Blend Tab
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Opacity ${adj.swapStrength}%", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                        Slider(
                            value = adj.swapStrength.toFloat(),
                            onValueChange = { viewModel.adjustments = adj.copy(swapStrength = it.toInt()) },
                            valueRange = 0f..100f,
                            colors = SliderDefaults.colors(thumbColor = Color(0xFF6366F1), activeTrackColor = Color(0xFF6366F1)),
                            modifier = Modifier.weight(1f).height(32.dp)
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Feather ${adj.featherRadius}px", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                        Slider(
                            value = adj.featherRadius.toFloat(),
                            onValueChange = { viewModel.adjustments = adj.copy(featherRadius = it.toInt()) },
                            valueRange = 8f..45f,
                            modifier = Modifier.weight(1f).height(32.dp)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Skin Match", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                            Spacer(Modifier.width(6.dp))
                            Switch(checked = adj.skinToneMatch, onCheckedChange = { viewModel.adjustments = adj.copy(skinToneMatch = it) })
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Smart Edge", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                            Spacer(Modifier.width(6.dp))
                            Switch(checked = adj.smartBlend, onCheckedChange = { viewModel.adjustments = adj.copy(smartBlend = it) })
                        }
                    }
                }

                2 -> {
                    // Align Tab
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Size ${(adj.scale * 100).toInt()}%", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                        Slider(
                            value = adj.scale,
                            onValueChange = { viewModel.adjustments = adj.copy(scale = it) },
                            valueRange = 0.75f..1.35f,
                            modifier = Modifier.weight(1f).height(32.dp)
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Tilt ${adj.rotation.toInt()}°", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                        Slider(
                            value = adj.rotation,
                            onValueChange = { viewModel.adjustments = adj.copy(rotation = it) },
                            valueRange = -25f..25f,
                            modifier = Modifier.weight(1f).height(32.dp)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Landmark Mesh", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                            Spacer(Modifier.width(6.dp))
                            Switch(
                                checked = adj.showGeometricMesh,
                                onCheckedChange = { viewModel.adjustments = adj.copy(showGeometricMesh = it) }
                            )
                        }
                        Button(
                            onClick = { viewModel.adjustments = adj.copy(scale = 1.0f, rotation = 0f, offsetX = 0f, offsetY = 0f) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                            modifier = Modifier.height(32.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 0.dp)
                        ) {
                            Text("Reset", fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}
