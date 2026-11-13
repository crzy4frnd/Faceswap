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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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

    var activeLandmarkKey by remember { mutableStateOf("nose") }

    val targetPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.loadTargetFromUri(it) }
    }
    val facePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.addCustomFaceFromUri(it, "Custom Face") }
    }

    val renderedBitmap: Bitmap? = remember(
        targetBmp,
        faces,
        profileCache,
        adj,
        viewModel.splitCompareEnabled,
        viewModel.splitComparePercent
    ) {
        targetBmp?.let {
            NativeFaceSwapEngine.renderFaceSwapComposite(
                targetBitmap = it,
                faces = faces,
                profileBitmaps = profileCache,
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
        // Top Target Picker & Quick Actions Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF0F172A))
                .padding(horizontal = 10.dp, vertical = 6.dp)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            viewModel.targetSamples.forEach { sample ->
                FilterChip(
                    selected = viewModel.activeTargetId == sample.id,
                    onClick = { viewModel.loadTargetSample(sample) },
                    label = { Text(sample.title, fontSize = 11.sp) }
                )
            }
            Button(
                onClick = { targetPicker.launch("image/*") },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                modifier = Modifier.height(34.dp)
            ) {
                Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("Gallery", fontSize = 11.sp)
            }
        }

        // Main Interactive Viewport
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color(0xFF090D16)),
            contentAlignment = Alignment.Center
        ) {
            if (renderedBitmap != null) {
                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(adj.showGeometricMesh, faces, viewModel.selectedFaceId) {
                            detectDragGestures { change, dragAmount ->
                                change.consume()
                                if (!adj.showGeometricMesh) return@detectDragGestures
                                val selId = viewModel.selectedFaceId ?: faces.firstOrNull()?.id ?: return@detectDragGestures
                                val bw = renderedBitmap.width.toFloat()
                                val bh = renderedBitmap.height.toFloat()
                                val scale = min(size.width / bw, size.height / bh)
                                val dxImg = dragAmount.x / scale
                                val dyImg = dragAmount.y / scale
                                val tapX = (change.position.x - (size.width - bw * scale) / 2f) / scale
                                val tapY = (change.position.y - (size.height - bh * scale) / 2f) / scale

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
                                    if (nearest != null) {
                                        activeLandmarkKey = nearest.first
                                    }
                                    viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, dxImg, dyImg)
                                }
                            }
                        }
                ) {
                    val bw = renderedBitmap.width.toFloat()
                    val bh = renderedBitmap.height.toFloat()
                    val scale = min(size.width / bw, size.height / bh)
                    val drawW = bw * scale
                    val drawH = bh * scale
                    val left = (size.width - drawW) / 2f
                    val top = (size.height - drawH) / 2f

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
                            strokeWidth = 3f
                        )
                    }
                }
            }

            // Top Right Canvas Tool Buttons
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                IconButton(
                    onClick = {
                        viewModel.adjustments = adj.copy(showGeometricMesh = !adj.showGeometricMesh)
                    },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(if (adj.showGeometricMesh) Color(0xFF0891B2) else Color(0xAA0F172A))
                ) {
                    Icon(Icons.Default.GridOn, contentDescription = "Landmark Mesh", tint = Color.White, modifier = Modifier.size(18.dp))
                }

                IconButton(
                    onClick = { viewModel.splitCompareEnabled = !viewModel.splitCompareEnabled },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(if (viewModel.splitCompareEnabled) Color(0xFF4F46E5) else Color(0xAA0F172A))
                ) {
                    Icon(Icons.Default.Compare, contentDescription = "Compare", tint = Color.White, modifier = Modifier.size(18.dp))
                }

                IconButton(
                    onClick = { renderedBitmap?.let { viewModel.exportBitmapToGallery(it, "FaceSwap") } },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF059669))
                ) {
                    Icon(Icons.Default.Download, contentDescription = "Save to Gallery", tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }

            // Floating Nudge HUD when Geometric Mesh is active
            if (adj.showGeometricMesh && faces.isNotEmpty()) {
                val selId = viewModel.selectedFaceId ?: faces.first().id
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xCC0F172A))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(activeLandmarkKey.uppercase(), color = Color(0xFF22D3EE), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, -4f, 0f) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.KeyboardArrowLeft, contentDescription = null, tint = Color.White)
                    }
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 0f, -4f) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.KeyboardArrowUp, contentDescription = null, tint = Color.White)
                    }
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 0f, 4f) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.KeyboardArrowDown, contentDescription = null, tint = Color.White)
                    }
                    IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 4f, 0f) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.KeyboardArrowRight, contentDescription = null, tint = Color.White)
                    }
                    IconButton(onClick = { viewModel.resetFaceLandmarks(selId) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.RestartAlt, contentDescription = "Reset", tint = Color(0xFFFBBF24))
                    }
                }
            }
        }

        // Bottom Controls Sheet
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(250.dp)
                .background(Color(0xFF0F172A))
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Face Profiles Strip
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
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .border(
                                width = if (isSelected) 2.dp else 1.dp,
                                color = if (isSelected) Color(0xFF6366F1) else Color(0xFF334155),
                                shape = RoundedCornerShape(12.dp)
                            )
                            .background(if (isSelected) Color(0xFF1E1B4B) else Color(0xFF020617))
                            .clickable { viewModel.assignProfileToSelectedOrAll(profile.id) }
                            .padding(6.dp)
                    ) {
                        if (pBmp != null) {
                            Image(
                                bitmap = pBmp.asImageBitmap(),
                                contentDescription = profile.name,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .size(44.dp)
                                    .clip(CircleShape)
                            )
                        }
                        Spacer(Modifier.height(3.dp))
                        Text(profile.name, color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                    }
                }

                // Add Custom Face from Gallery
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(12.dp))
                        .background(Color(0xFF1E293B))
                        .clickable { facePicker.launch("image/*") }
                        .padding(8.dp)
                ) {
                    Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(36.dp))
                    Text("+ Face", color = Color(0xFF818CF8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }

            // Multi-Face Toggle Chips
            if (faces.size > 1) {
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    faces.forEachIndexed { idx, f ->
                        FilterChip(
                            selected = viewModel.selectedFaceId == f.id,
                            onClick = {
                                viewModel.selectedFaceId = f.id
                            },
                            label = { Text("Face #${idx + 1} (${if (f.enabled) "ON" else "OFF"})", fontSize = 10.sp) }
                        )
                    }
                }
            }

            if (viewModel.splitCompareEnabled) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Split Compare", color = Color(0xFF94A3B8), fontSize = 11.sp, modifier = Modifier.width(96.dp))
                    Slider(
                        value = viewModel.splitComparePercent,
                        onValueChange = { viewModel.splitComparePercent = it },
                        valueRange = 5f..95f,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Swap Strength & Smart Blend
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Swap ${adj.swapStrength}%", color = Color.White, fontSize = 11.sp, modifier = Modifier.width(90.dp))
                Slider(
                    value = adj.swapStrength.toFloat(),
                    onValueChange = { viewModel.adjustments = adj.copy(swapStrength = it.toInt()) },
                    valueRange = 0f..100f,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFF6366F1), activeTrackColor = Color(0xFF6366F1)),
                    modifier = Modifier.weight(1f)
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Feather ${adj.featherRadius}px", color = Color.White, fontSize = 11.sp, modifier = Modifier.width(90.dp))
                Slider(
                    value = adj.featherRadius.toFloat(),
                    onValueChange = { viewModel.adjustments = adj.copy(featherRadius = it.toInt()) },
                    valueRange = 6f..45f,
                    modifier = Modifier.weight(1f)
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Smart Blend", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                    Spacer(Modifier.width(6.dp))
                    Switch(
                        checked = adj.smartBlend,
                        onCheckedChange = { viewModel.adjustments = adj.copy(smartBlend = it) }
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Auto-Mask", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                    Spacer(Modifier.width(6.dp))
                    Switch(
                        checked = adj.autoMaskHair,
                        onCheckedChange = { viewModel.adjustments = adj.copy(autoMaskHair = it) }
                    )
                }
            }
        }
    }
}
