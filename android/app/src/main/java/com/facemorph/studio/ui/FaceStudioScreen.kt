package com.facemorph.studio.ui

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Colorize
import androidx.compose.material.icons.filled.Compare
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facemorph.studio.engine.NativeFaceSwapEngine
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.engine.VirtualLightingStudioShader
import com.facemorph.studio.model.CutoutLayerKind
import com.facemorph.studio.model.FaceAdjustments
import com.facemorph.studio.viewmodel.StudioViewModel
import java.io.File
import kotlin.math.hypot
import kotlin.math.min

@Composable
fun FaceStudioScreen(viewModel: StudioViewModel) {
    val context = LocalContext.current
    val targetBmp = viewModel.targetBitmap
    val faces = viewModel.detectedFaces
    val adj = viewModel.adjustments
    val segmentedLayers = viewModel.segmentedTargetLayers
    val profileCache = viewModel.profileBitmapCache.toMap()
    val metricsCache = viewModel.profileMetricsCache.toMap()
    val angleBitmapCache = viewModel.angleBitmapCache.toMap()
    val angleCutoutCache = viewModel.angleCutoutCache.toMap()
    val angleMetricsCache = viewModel.angleMetricsCache.toMap()

    var activeDeckTab by remember { mutableIntStateOf(0) } // 0=Faces, 1=Blend, 2=Cutout, 3=Light, 4=Align
    var isDeckExpanded by remember { mutableStateOf(true) }
    var showToolsMenu by remember { mutableStateOf(false) }
    var showSwapProfileMenu by remember { mutableStateOf(false) }
    var activeLandmarkKey by remember { mutableStateOf("nose") }
    var viewportZoom by remember { mutableFloatStateOf(1f) }
    var viewportPan by remember { mutableStateOf(Offset.Zero) }
    var lastBrushImgPos by remember { mutableStateOf<Offset?>(null) }
    var brushCursorImgPos by remember { mutableStateOf<Offset?>(null) }
    val activeSwapProfile = viewModel.faceProfiles.find { it.id == viewModel.activeProfileId }
        ?: viewModel.faceProfiles.firstOrNull()
    val activeTargetMatchPct = faces
        .firstOrNull { it.id == viewModel.selectedFaceId && it.angleMatchScore != null }?.angleMatchScore
        ?: faces.firstOrNull { it.angleMatchScore != null }?.angleMatchScore
        ?: viewModel.lastScanMatchScore
    val isSamplingSkin = viewModel.isSkinSamplingMode
    val isCutoutBrush = viewModel.isCutoutBrushMode
    val latestTargetBmp by rememberUpdatedState(targetBmp)
    val latestZoom by rememberUpdatedState(viewportZoom)
    val latestPan by rememberUpdatedState(viewportPan)
    val latestSamplingMode by rememberUpdatedState(isSamplingSkin)
    val latestCutoutMode by rememberUpdatedState(isCutoutBrush)
    val latestShowMesh by rememberUpdatedState(adj.showGeometricMesh)
    val latestFaces by rememberUpdatedState(faces)
    val latestSelectedFaceId by rememberUpdatedState(viewModel.selectedFaceId)

    var pendingTargetCameraFile by remember { mutableStateOf<File?>(null) }
    var pendingFaceCameraFile by remember { mutableStateOf<File?>(null) }

    LaunchedEffect(viewModel.activeTargetId, targetBmp) {
        viewportZoom = 1f
        viewportPan = Offset.Zero
    }

    fun sampleSkinAtPointer(pos: Offset, canvasW: Float, canvasH: Float, requireInsideBounds: Boolean) {
        val bmp = latestTargetBmp ?: return
        val bw = bmp.width.toFloat()
        val bh = bmp.height.toFloat()
        val baseScale = min(canvasW / bw, canvasH / bh)
        val scale = baseScale * latestZoom
        val drawW = bw * scale
        val drawH = bh * scale
        val left = (canvasW - drawW) / 2f + latestPan.x
        val top = (canvasH - drawH) / 2f + latestPan.y
        if (requireInsideBounds && (pos.x !in left..(left + drawW) || pos.y !in top..(top + drawH))) {
            return
        }
        val normX = ((pos.x - left) / drawW).coerceIn(0f, 1f)
        val normY = ((pos.y - top) / drawH).coerceIn(0f, 1f)
        viewModel.sampleSkinPatchAt(normX, normY)
    }

    fun screenToImagePos(pos: Offset, canvasW: Float, canvasH: Float): Offset? {
        val bmp = latestTargetBmp ?: return null
        val bw = bmp.width.toFloat()
        val bh = bmp.height.toFloat()
        val baseScale = min(canvasW / bw, canvasH / bh)
        val scale = baseScale * latestZoom
        val drawW = bw * scale
        val drawH = bh * scale
        val left = (canvasW - drawW) / 2f + latestPan.x
        val top = (canvasH - drawH) / 2f + latestPan.y
        return Offset(
            ((pos.x - left) / scale).coerceIn(0f, bw),
            ((pos.y - top) / scale).coerceIn(0f, bh)
        )
    }

    val targetGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.loadTargetFromUri(it) }
    }
    val targetCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingTargetCameraFile
        if (success && file != null && file.exists()) {
            viewModel.loadTargetFromFile(file.absolutePath)
        }
    }

    val faceGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.addCustomFaceFromUri(it, sourceLabel = "Gallery") }
    }
    val faceCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingFaceCameraFile
        if (success && file != null && file.exists()) {
            viewModel.addCustomFaceFromFile(file.absolutePath, sourceLabel = "Camera")
        }
    }

    fun launchTargetCamera() {
        val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "target")
        pendingTargetCameraFile = file
        targetCameraLauncher.launch(uri)
    }

    fun launchFaceCamera() {
        val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "face")
        pendingFaceCameraFile = file
        faceCameraLauncher.launch(uri)
    }

    val renderedBitmap: Bitmap? = remember(
        targetBmp,
        faces,
        profileCache,
        metricsCache,
        angleBitmapCache,
        angleMetricsCache,
        adj,
        viewModel.splitCompareEnabled,
        viewModel.splitComparePercent,
        viewModel.cutoutMaskVersion,
        viewModel.cutoutProtectionMask,
        viewModel.segmentedTargetLayers
    ) {
        targetBmp?.let {
            NativeFaceSwapEngine.renderFaceSwapComposite(
                targetBitmap = it,
                faces = faces,
                profileBitmaps = profileCache,
                profileMetrics = metricsCache,
                adjustments = adj,
                splitPercent = if (viewModel.splitCompareEnabled) viewModel.splitComparePercent else null,
                protectionMask = viewModel.cutoutProtectionMask,
                segmentedLayers = viewModel.segmentedTargetLayers,
                angleBitmaps = angleBitmapCache,
                angleMetrics = angleMetricsCache
            )
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF020617))
    ) {
        // Clean Unclipped Top Action Bar (Photo Gallery, Camera, Tools Menu, Save)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF0A0F1E))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF111827))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                        .clickable { targetGalleryPicker.launch("image/*") }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Gallery", color = Color(0xFFE2E8F0), fontSize = 11.sp, fontWeight = FontWeight.Medium)
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF111827))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                        .clickable { launchTargetCamera() }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Camera", color = Color(0xFFE2E8F0), fontSize = 11.sp, fontWeight = FontWeight.Medium)
                }

                Box {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF111827))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                            .clickable { showToolsMenu = true }
                            .padding(horizontal = 8.dp, vertical = 6.dp)
                    ) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More Tools", tint = Color(0xFFCBD5E1), modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(3.dp))
                        Text("Menu", color = Color(0xFFE2E8F0), fontSize = 11.sp, fontWeight = FontWeight.Medium)
                    }

                    DropdownMenu(
                        expanded = showToolsMenu,
                        onDismissRequest = { showToolsMenu = false },
                        containerColor = Color(0xFF0F172A)
                    ) {
                        DropdownMenuItem(
                            text = { Text("Rescan Faces", color = Color.White, fontSize = 12.sp) },
                            leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(16.dp)) },
                            enabled = renderedBitmap != null,
                            onClick = {
                                showToolsMenu = false
                                viewModel.rescanTargetFaces()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(if (adj.showGeometricMesh) "Hide Mesh" else "Landmark Mesh", color = Color.White, fontSize = 12.sp) },
                            leadingIcon = { Icon(Icons.Default.GridOn, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(16.dp)) },
                            enabled = renderedBitmap != null,
                            onClick = {
                                showToolsMenu = false
                                val nextMesh = !adj.showGeometricMesh
                                if (nextMesh) {
                                    viewModel.isSkinSamplingMode = false
                                    viewModel.isCutoutBrushMode = false
                                }
                                viewModel.adjustments = adj.copy(showGeometricMesh = nextMesh)
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(if (isCutoutBrush) "Done Cutout Brush" else "Cutout / Hair Brush", color = Color.White, fontSize = 12.sp) },
                            leadingIcon = { Icon(Icons.Default.ContentCut, contentDescription = null, tint = Color(0xFFF43F5E), modifier = Modifier.size(16.dp)) },
                            enabled = renderedBitmap != null,
                            onClick = {
                                showToolsMenu = false
                                val nextBrush = !isCutoutBrush
                                if (nextBrush) {
                                    viewModel.isSkinSamplingMode = false
                                    viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                    activeDeckTab = 2
                                    isDeckExpanded = true
                                }
                                viewModel.isCutoutBrushMode = nextBrush
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(if (isSamplingSkin) "Done Skin Sample" else "Sample Skin Patch", color = Color.White, fontSize = 12.sp) },
                            leadingIcon = { Icon(Icons.Default.Colorize, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(16.dp)) },
                            enabled = renderedBitmap != null,
                            onClick = {
                                showToolsMenu = false
                                val nextSample = !isSamplingSkin
                                if (nextSample) {
                                    viewModel.isCutoutBrushMode = false
                                    viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                }
                                viewModel.isSkinSamplingMode = nextSample
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(if (viewModel.splitCompareEnabled) "Hide Before/After" else "Before/After Split", color = Color.White, fontSize = 12.sp) },
                            leadingIcon = { Icon(Icons.Default.Compare, contentDescription = null, tint = Color(0xFFA78BFA), modifier = Modifier.size(16.dp)) },
                            enabled = renderedBitmap != null,
                            onClick = {
                                showToolsMenu = false
                                viewModel.splitCompareEnabled = !viewModel.splitCompareEnabled
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Reset Adjustments", color = Color.White, fontSize = 12.sp) },
                            leadingIcon = { Icon(Icons.Default.RestartAlt, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(16.dp)) },
                            onClick = {
                                showToolsMenu = false
                                viewModel.isSkinSamplingMode = false
                                viewModel.isCutoutBrushMode = false
                                viewModel.clearCutoutMask()
                                viewModel.adjustments = FaceAdjustments()
                                viewModel.splitCompareEnabled = false
                            }
                        )
                        if (renderedBitmap != null) {
                            DropdownMenuItem(
                                text = { Text("Clear Photo", color = Color(0xFFF87171), fontSize = 12.sp) },
                                leadingIcon = { Icon(Icons.Default.Close, contentDescription = null, tint = Color(0xFFF87171), modifier = Modifier.size(16.dp)) },
                                onClick = {
                                    showToolsMenu = false
                                    viewModel.clearTargetPhoto()
                                }
                            )
                        }
                    }
                }
            }

            Button(
                onClick = { renderedBitmap?.let { viewModel.exportBitmapToGallery(it, "FaceSwap") } },
                enabled = renderedBitmap != null,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF059669),
                    disabledContainerColor = Color(0xFF1E293B),
                    disabledContentColor = Color(0xFF64748B)
                ),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.height(32.dp),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)
            ) {
                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("Save", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        // Slim Non-Floating Tool Strip Docked Above Canvas (zero overlap on photo)
        if (renderedBitmap != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF070C18))
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Swapping Screen Face Profile Chooser + 96-100% Scan Match Badge
                Box {
                    val activeCutout = activeSwapProfile?.let { viewModel.getCutoutThumbForProfile(it.id) }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(7.dp))
                            .background(if (activeSwapProfile != null) Color(0xFF1E1B4B) else Color(0xFF111827))
                            .border(
                                1.dp,
                                if (activeSwapProfile != null) Color(0xFF6366F1) else Color(0xFF334155),
                                RoundedCornerShape(7.dp)
                            )
                            .clickable { showSwapProfileMenu = true }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        if (activeCutout != null) {
                            Image(
                                bitmap = activeCutout.asImageBitmap(),
                                contentDescription = null,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .size(16.dp)
                                    .clip(CircleShape)
                            )
                        } else {
                            Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(13.dp))
                        }
                        Spacer(Modifier.width(5.dp))
                        Text(
                            text = activeSwapProfile?.name ?: "Choose Profile",
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (viewModel.isScanningProfileMatch) {
                            Spacer(Modifier.width(4.dp))
                            Text(
                                "Scanning...",
                                color = Color(0xFF38BDF8),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold
                            )
                        } else if (activeSwapProfile != null && activeSwapProfile.angles.isNotEmpty() && activeTargetMatchPct in 96..100) {
                            Spacer(Modifier.width(4.dp))
                            Text(
                                "${activeTargetMatchPct}%",
                                color = Color(0xFF34D399),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFF064E3B))
                                    .padding(horizontal = 4.dp, vertical = 1.dp)
                            )
                        }
                        Spacer(Modifier.width(2.dp))
                        Icon(Icons.Default.ExpandMore, contentDescription = "Pick Face Profile", tint = Color(0xFFCBD5E1), modifier = Modifier.size(13.dp))
                    }

                    DropdownMenu(
                        expanded = showSwapProfileMenu,
                        onDismissRequest = { showSwapProfileMenu = false },
                        containerColor = Color(0xFF0F172A)
                    ) {
                        if (viewModel.faceProfiles.isEmpty()) {
                            DropdownMenuItem(
                                text = { Text("No profiles yet · Create Profile", color = Color(0xFFA5B4FC), fontSize = 12.sp, fontWeight = FontWeight.SemiBold) },
                                leadingIcon = { Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(16.dp)) },
                                onClick = {
                                    showSwapProfileMenu = false
                                    viewModel.showFaceProfileManager = true
                                }
                            )
                        } else {
                            viewModel.faceProfiles.forEach { profile ->
                                val isChosen = viewModel.activeProfileId == profile.id
                                val thumb = viewModel.getCutoutThumbForProfile(profile.id)
                                DropdownMenuItem(
                                    text = {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            Text(
                                                profile.name,
                                                color = if (isChosen) Color(0xFF34D399) else Color.White,
                                                fontSize = 12.sp,
                                                fontWeight = if (isChosen) FontWeight.Bold else FontWeight.Medium
                                            )
                                            Text(
                                                "${profile.angles.size} face${if (profile.angles.size == 1) "" else "s"}",
                                                color = Color(0xFF94A3B8),
                                                fontSize = 10.sp
                                            )
                                        }
                                    },
                                    leadingIcon = {
                                        if (thumb != null) {
                                            Image(
                                                bitmap = thumb.asImageBitmap(),
                                                contentDescription = null,
                                                contentScale = ContentScale.Fit,
                                                modifier = Modifier
                                                    .size(22.dp)
                                                    .clip(CircleShape)
                                                    .border(
                                                        1.dp,
                                                        if (isChosen) Color(0xFF34D399) else Color(0xFF334155),
                                                        CircleShape
                                                    )
                                            )
                                        } else {
                                            Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(18.dp))
                                        }
                                    },
                                    trailingIcon = {
                                        if (isChosen && activeTargetMatchPct in 96..100) {
                                            Text("${activeTargetMatchPct}%", color = Color(0xFF34D399), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                        }
                                    },
                                    onClick = {
                                        showSwapProfileMenu = false
                                        viewModel.scanAndSelectProfileForSwap(profile.id)
                                    }
                                )
                            }
                            HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
                            DropdownMenuItem(
                                text = { Text("Manage / Edit Profiles", color = Color(0xFFA5B4FC), fontSize = 12.sp, fontWeight = FontWeight.SemiBold) },
                                leadingIcon = { Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(16.dp)) },
                                onClick = {
                                    showSwapProfileMenu = false
                                    viewModel.showFaceProfileManager = true
                                }
                            )
                        }
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .background(
                            when {
                                isCutoutBrush -> Color(0xFF9F1239)
                                viewModel.cutoutProtectionMask != null -> Color(0xFF4C0519)
                                else -> Color(0xFF111827)
                            }
                        )
                        .border(
                            1.dp,
                            if (isCutoutBrush || viewModel.cutoutProtectionMask != null) Color(0xFFF43F5E) else Color(0xFF334155),
                            RoundedCornerShape(7.dp)
                        )
                        .clickable {
                            val nextCutout = !isCutoutBrush
                            if (nextCutout) {
                                viewModel.isSkinSamplingMode = false
                                viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                activeDeckTab = 2
                                isDeckExpanded = true
                            }
                            viewModel.isCutoutBrushMode = nextCutout
                        }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Icon(Icons.Default.ContentCut, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Cutout", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Medium)
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .background(
                            when {
                                isSamplingSkin -> Color(0xFFD97706)
                                adj.manualSkinPatch != null -> Color(0xFF312E81)
                                else -> Color(0xFF111827)
                            }
                        )
                        .border(
                            1.dp,
                            if (isSamplingSkin || adj.manualSkinPatch != null) Color(0xFFFBBF24) else Color(0xFF334155),
                            RoundedCornerShape(7.dp)
                        )
                        .clickable {
                            val nextSample = !isSamplingSkin
                            if (nextSample) {
                                viewModel.isCutoutBrushMode = false
                                viewModel.adjustments = adj.copy(showGeometricMesh = false)
                            }
                            viewModel.isSkinSamplingMode = nextSample
                        }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Icon(Icons.Default.Colorize, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Skin", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Medium)
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .background(if (adj.showGeometricMesh) Color(0xFF0891B2) else Color(0xFF111827))
                        .border(
                            1.dp,
                            if (adj.showGeometricMesh) Color(0xFF22D3EE) else Color(0xFF334155),
                            RoundedCornerShape(7.dp)
                        )
                        .clickable {
                            val nextMesh = !adj.showGeometricMesh
                            if (nextMesh) {
                                viewModel.isSkinSamplingMode = false
                                viewModel.isCutoutBrushMode = false
                            }
                            viewModel.adjustments = adj.copy(showGeometricMesh = nextMesh)
                        }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Icon(Icons.Default.GridOn, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Mesh", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Medium)
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .background(if (viewModel.splitCompareEnabled) Color(0xFF4F46E5) else Color(0xFF111827))
                        .border(
                            1.dp,
                            if (viewModel.splitCompareEnabled) Color(0xFF818CF8) else Color(0xFF334155),
                            RoundedCornerShape(7.dp)
                        )
                        .clickable { viewModel.splitCompareEnabled = !viewModel.splitCompareEnabled }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Icon(Icons.Default.Compare, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Compare", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Medium)
                }

                CompactToggleChip(
                    label = "${segmentedLayers?.summary?.totalLayerCount ?: 2}-Layer",
                    checked = adj.preserveTargetLayers,
                    activeColor = Color(0xFF10B981),
                    onToggle = {
                        viewModel.adjustments = adj.copy(preserveTargetLayers = !adj.preserveTargetLayers)
                    }
                )

                if (isCutoutBrush) {
                    if (viewModel.canUndoCutoutMask) {
                        Text(
                            "Undo",
                            color = Color(0xFF38BDF8),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(7.dp))
                                .background(Color(0xFF1E293B))
                                .clickable { viewModel.undoCutoutStroke() }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                    Text(
                        "Done",
                        color = Color(0xFFFDA4AF),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(7.dp))
                            .background(Color(0xFF4C0519))
                            .clickable { viewModel.isCutoutBrushMode = false }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }

                if (isSamplingSkin) {
                    if (adj.manualSkinPatch != null) {
                        Text(
                            "Clear Skin",
                            color = Color(0xFFF87171),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(7.dp))
                                .background(Color(0xFF1E293B))
                                .clickable { viewModel.clearManualSkinPatch() }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                    Text(
                        "Done",
                        color = Color(0xFFFBBF24),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(7.dp))
                            .background(Color(0xFF451A03))
                            .clickable { viewModel.isSkinSamplingMode = false }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }

                if (viewportZoom > 1.04f) {
                    Text(
                        "${(viewportZoom * 100).toInt()}% · Reset",
                        color = Color(0xFF22D3EE),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(7.dp))
                            .background(Color(0xFF0F172A))
                            .border(1.dp, Color(0xFF155E75), RoundedCornerShape(7.dp))
                            .clickable {
                                viewportZoom = 1f
                                viewportPan = Offset.Zero
                            }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }

        // Spacious Main Canvas Viewport (Unobstructed — zero floating tool pills over photo)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clipToBounds()
                .background(Color(0xFF060A13)),
            contentAlignment = Alignment.Center
        ) {
            if (renderedBitmap != null) {
                var lastCanvasTapTimeMs by remember { mutableStateOf(0L) }
                var lastCanvasTapPos by remember { mutableStateOf(Offset.Zero) }

                fun applyCanvasViewportTransform(
                    centroid: Offset,
                    panDelta: Offset,
                    zoomDelta: Float,
                    canvasSize: IntSize
                ) {
                    val prevZoom = latestZoom
                    val nextZoom = (prevZoom * zoomDelta).coerceIn(1f, 5f)
                    val cx = canvasSize.width / 2f
                    val cy = canvasSize.height / 2f
                    val scaleRatio = nextZoom / prevZoom
                    val newPanX = (centroid.x - cx) - ((centroid.x - cx) - latestPan.x) * scaleRatio + panDelta.x
                    val newPanY = (centroid.y - cy) - ((centroid.y - cy) - latestPan.y) * scaleRatio + panDelta.y
                    viewportZoom = nextZoom
                    if (nextZoom <= 1.02f) {
                        viewportPan = Offset.Zero
                    } else {
                        val maxX = canvasSize.width * (nextZoom - 1f) * 0.6f
                        val maxY = canvasSize.height * (nextZoom - 1f) * 0.6f
                        viewportPan = Offset(
                            newPanX.coerceIn(-maxX, maxX),
                            newPanY.coerceIn(-maxY, maxY)
                        )
                    }
                }

                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                val firstDown = awaitFirstDown(requireUnconsumed = false)
                                val downPos = firstDown.position
                                val downTime = System.currentTimeMillis()
                                var isMultiTouch = false
                                var tapCandidate = true
                                var strokeBegun = false
                                var prevCentroid: Offset? = null
                                var prevSpan = 0f
                                var prevSinglePos = downPos

                                while (true) {
                                    val event = awaitPointerEvent()
                                    val pressed = event.changes.filter { it.pressed }

                                    if (pressed.isEmpty()) {
                                        lastBrushImgPos = null
                                        brushCursorImgPos = null
                                        if (tapCandidate && !isMultiTouch) {
                                            if (latestSamplingMode) {
                                                sampleSkinAtPointer(
                                                    pos = downPos,
                                                    canvasW = size.width.toFloat(),
                                                    canvasH = size.height.toFloat(),
                                                    requireInsideBounds = true
                                                )
                                            } else if (latestCutoutMode) {
                                                val imgPt = screenToImagePos(downPos, size.width.toFloat(), size.height.toFloat())
                                                if (imgPt != null) {
                                                    viewModel.beginCutoutStroke()
                                                    viewModel.paintCutoutStrokeSegment(imgPt.x, imgPt.y, imgPt.x, imgPt.y)
                                                }
                                            } else {
                                                val dt = downTime - lastCanvasTapTimeMs
                                                val distPrev = hypot(downPos.x - lastCanvasTapPos.x, downPos.y - lastCanvasTapPos.y)
                                                if (dt in 40L..320L && distPrev < 64f) {
                                                    if (latestZoom > 1.1f) {
                                                        viewportZoom = 1f
                                                        viewportPan = Offset.Zero
                                                    } else {
                                                        val cx = size.width / 2f
                                                        val cy = size.height / 2f
                                                        val newZoom = 2.4f
                                                        viewportPan = Offset(
                                                            (cx - downPos.x) * (newZoom - 1f) * 0.6f,
                                                            (cy - downPos.y) * (newZoom - 1f) * 0.6f
                                                        )
                                                        viewportZoom = newZoom
                                                    }
                                                    lastCanvasTapTimeMs = 0L
                                                } else {
                                                    lastCanvasTapTimeMs = downTime
                                                    lastCanvasTapPos = downPos
                                                }
                                            }
                                        }
                                        break
                                    }

                                    if (pressed.size >= 2) {
                                        // 2-finger pinch-to-zoom & pan ALWAYS active across every tool!
                                        isMultiTouch = true
                                        tapCandidate = false
                                        lastBrushImgPos = null
                                        brushCursorImgPos = null
                                        val p0 = pressed[0].position
                                        val p1 = pressed[1].position
                                        val centroid = Offset((p0.x + p1.x) * 0.5f, (p0.y + p1.y) * 0.5f)
                                        val span = hypot(p1.x - p0.x, p1.y - p0.y).coerceAtLeast(12f)
                                        if (prevCentroid != null && prevSpan > 0f) {
                                            val zoomDelta = (span / prevSpan).coerceIn(0.7f, 1.4f)
                                            val panDelta = centroid - prevCentroid!!
                                            applyCanvasViewportTransform(centroid, panDelta, zoomDelta, size)
                                        }
                                        prevCentroid = centroid
                                        prevSpan = span
                                        pressed.forEach { it.consume() }
                                    } else if (!isMultiTouch && pressed.size == 1) {
                                        val ch = pressed[0]
                                        val pos = ch.position
                                        val distMoved = hypot(pos.x - downPos.x, pos.y - downPos.y)
                                        if (distMoved > 7f) tapCandidate = false
                                        val dragAmount = pos - prevSinglePos

                                        if (latestCutoutMode) {
                                            val imgPt = screenToImagePos(pos, size.width.toFloat(), size.height.toFloat())
                                            if (imgPt != null) {
                                                if (!strokeBegun && distMoved > 3f) {
                                                    val startImg = screenToImagePos(downPos, size.width.toFloat(), size.height.toFloat()) ?: imgPt
                                                    viewModel.beginCutoutStroke()
                                                    viewModel.paintCutoutStrokeSegment(startImg.x, startImg.y, imgPt.x, imgPt.y)
                                                    strokeBegun = true
                                                } else if (strokeBegun) {
                                                    val prev = lastBrushImgPos ?: imgPt
                                                    viewModel.paintCutoutStrokeSegment(prev.x, prev.y, imgPt.x, imgPt.y)
                                                }
                                                lastBrushImgPos = imgPt
                                                brushCursorImgPos = imgPt
                                            }
                                            ch.consume()
                                        } else if (latestSamplingMode) {
                                            if (distMoved > 3f) {
                                                sampleSkinAtPointer(
                                                    pos = pos,
                                                    canvasW = size.width.toFloat(),
                                                    canvasH = size.height.toFloat(),
                                                    requireInsideBounds = false
                                                )
                                            }
                                            ch.consume()
                                        } else if (latestShowMesh) {
                                            val bmp = latestTargetBmp
                                            val selId = latestSelectedFaceId ?: latestFaces.firstOrNull()?.id
                                            if (bmp != null && selId != null && (dragAmount.x != 0f || dragAmount.y != 0f)) {
                                                val bw = bmp.width.toFloat()
                                                val bh = bmp.height.toFloat()
                                                val baseScale = min(size.width / bw, size.height / bh)
                                                val scale = baseScale * latestZoom
                                                val drawW = bw * scale
                                                val drawH = bh * scale
                                                val left = (size.width - drawW) / 2f + latestPan.x
                                                val top = (size.height - drawH) / 2f + latestPan.y
                                                val dxImg = dragAmount.x / scale
                                                val dyImg = dragAmount.y / scale
                                                val tapX = (pos.x - left) / scale
                                                val tapY = (pos.y - top) / scale
                                                val f = latestFaces.find { it.id == selId }
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
                                            ch.consume()
                                        } else if (latestZoom > 1.02f && distMoved > 6f) {
                                            applyCanvasViewportTransform(pos, dragAmount, 1f, size)
                                            ch.consume()
                                        }
                                        prevSinglePos = pos
                                    }
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

                    val cutMask = viewModel.cutoutProtectionMask
                    if (isCutoutBrush && viewModel.cutoutShowOverlay && cutMask != null && !cutMask.isRecycled) {
                        drawImage(
                            image = cutMask.asImageBitmap(),
                            dstOffset = IntOffset(left.toInt(), top.toInt()),
                            dstSize = IntSize(drawW.toInt(), drawH.toInt()),
                            alpha = 0.42f
                        )
                    }

                    if (isCutoutBrush && brushCursorImgPos != null) {
                        val cxScreen = left + brushCursorImgPos!!.x * scale
                        val cyScreen = top + brushCursorImgPos!!.y * scale
                        val radiusScreen = (viewModel.cutoutBrushSizePx * scale).coerceAtLeast(8f)
                        drawCircle(
                            color = if (viewModel.cutoutBrushProtect) Color(0xFFF43F5E) else Color(0xFF22D3EE),
                            radius = radiusScreen,
                            center = Offset(cxScreen, cyScreen),
                            style = Stroke(width = 2.5f)
                        )
                    }

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

                    adj.manualSkinPatch?.let { patch ->
                        if (isSamplingSkin || activeDeckTab == 1) {
                            val px = left + patch.normX * drawW
                            val py = top + patch.normY * drawH
                            val patchRadiusPx = (patch.radiusRatio * min(drawW, drawH)).coerceAtLeast(14f)
                            val sampledColor = Color(
                                red = (patch.sampledRed / 255f).coerceIn(0f, 1f),
                                green = (patch.sampledGreen / 255f).coerceIn(0f, 1f),
                                blue = (patch.sampledBlue / 255f).coerceIn(0f, 1f)
                            )
                            drawCircle(
                                color = sampledColor.copy(alpha = 0.28f),
                                radius = patchRadiusPx,
                                center = Offset(px, py)
                            )
                            drawCircle(
                                color = Color(0xCC020617),
                                radius = patchRadiusPx,
                                center = Offset(px, py),
                                style = Stroke(width = 4.5f)
                            )
                            drawCircle(
                                color = if (isSamplingSkin) Color(0xFFFBBF24) else Color.White,
                                radius = patchRadiusPx,
                                center = Offset(px, py),
                                style = Stroke(width = 2.2f)
                            )
                            drawLine(
                                color = Color.White,
                                start = Offset(px - 6f, py),
                                end = Offset(px + 6f, py),
                                strokeWidth = 1.8f
                            )
                            drawLine(
                                color = Color.White,
                                start = Offset(px, py - 6f),
                                end = Offset(px, py + 6f),
                                strokeWidth = 1.8f
                            )
                            if (isSamplingSkin) {
                                val loupeY = (py - patchRadiusPx - 26f).coerceAtLeast(top + 20f)
                                drawCircle(color = Color(0xEE020617), radius = 15f, center = Offset(px, loupeY))
                                drawCircle(color = sampledColor, radius = 12f, center = Offset(px, loupeY))
                                drawCircle(
                                    color = Color(0xFFFBBF24),
                                    radius = 12f,
                                    center = Offset(px, loupeY),
                                    style = Stroke(width = 2f)
                                )
                            }
                        }
                    }
                }
            } else {
                // Clean Empty Canvas Prompt (Gallery & Camera)
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .padding(24.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color(0xFF0B1120))
                        .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(18.dp))
                        .padding(22.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF1E1B4B)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(26.dp))
                    }
                    Text(
                        "Load a Photo to Edit",
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "Pick a photo from Gallery or take one with Camera, then add a face below to swap.",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Button(
                            onClick = { targetGalleryPicker.launch("image/*") },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.weight(1f).height(42.dp)
                        ) {
                            Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Gallery", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        OutlinedButton(
                            onClick = { launchTargetCamera() },
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.weight(1f).height(42.dp)
                        ) {
                            Icon(Icons.Default.CameraAlt, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Camera", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFF111827))
                            .border(1.dp, Color(0xFF312E81), RoundedCornerShape(10.dp))
                            .clickable { viewModel.showFaceProfileManager = true }
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                    ) {
                        Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (activeSwapProfile != null) "Swap Profile: ${activeSwapProfile.name} (${viewModel.faceProfiles.size})"
                            else "Manage Face Profiles (${viewModel.faceProfiles.size})",
                            color = Color.White,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
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

        // Collapsible Bottom Studio Deck (Tap collapse chevron for >85% editing canvas)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .animateContentSize()
                .background(Color(0xFF0B1120))
        ) {
            HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(9.dp))
                        .background(Color(0xFF111827))
                        .padding(3.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf("Faces", "Blend", "Cutout", "Light", "Align").forEachIndexed { idx, label ->
                        val selected = isDeckExpanded && activeDeckTab == idx
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(7.dp))
                                .background(if (selected) Color(0xFF4F46E5) else Color.Transparent)
                                .clickable {
                                    if (isDeckExpanded && activeDeckTab == idx) {
                                        isDeckExpanded = false
                                    } else {
                                        activeDeckTab = idx
                                        isDeckExpanded = true
                                    }
                                }
                                .padding(vertical = 6.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                label,
                                color = if (selected) Color.White else Color(0xFF94A3B8),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1
                            )
                        }
                    }
                }

                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF111827))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                        .clickable { isDeckExpanded = !isDeckExpanded },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        if (isDeckExpanded) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                        contentDescription = if (isDeckExpanded) "Collapse Controls" else "Expand Controls",
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            if (isDeckExpanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 186.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    when (activeDeckTab) {
                        0 -> {
                            // Unclipped Profile Actions: New Profile (Gallery / Camera) + Manage Profiles
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(Color(0xFF1E1B4B))
                                        .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(9.dp))
                                        .clickable {
                                            viewModel.pendingAngleTargetProfileId = null
                                            faceGalleryPicker.launch("image/*")
                                        }
                                        .padding(horizontal = 8.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Gallery", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                }

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(Color(0xFF082F49))
                                        .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(9.dp))
                                        .clickable {
                                            viewModel.pendingAngleTargetProfileId = null
                                            launchFaceCamera()
                                        }
                                        .padding(horizontal = 8.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.CameraAlt, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Camera", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                }

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(Color(0xFF111827))
                                        .border(1.dp, Color(0xFF475569), RoundedCornerShape(9.dp))
                                        .clickable { viewModel.showFaceProfileManager = true }
                                        .padding(horizontal = 10.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Profiles (${viewModel.faceProfiles.size})", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                }
                            }

                            if (viewModel.faceProfiles.isEmpty()) {
                                Text(
                                    "No profiles yet. Tap Gallery, Camera, or Profiles to create a profile and save multiple face angles.",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 11.sp
                                )
                            } else {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "Swap Profile: ${activeSwapProfile?.name ?: "Select"}",
                                        color = Color(0xFFE2E8F0),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    if (viewModel.isScanningProfileMatch) {
                                        Text(
                                            "Scanning profile...",
                                            color = Color(0xFF38BDF8),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    } else if (activeSwapProfile != null && activeSwapProfile.angles.isNotEmpty() && activeTargetMatchPct in 96..100) {
                                        Text(
                                            "${activeTargetMatchPct}% Match",
                                            color = Color(0xFF34D399),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(Color(0xFF064E3B))
                                                .padding(horizontal = 6.dp, vertical = 2.dp)
                                        )
                                    }
                                }
                                // Clean label-free cutout face profile avatars (tap to scan & swap 96-100%)
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    viewModel.faceProfiles.forEach { profile ->
                                        val isSelected = viewModel.activeProfileId == profile.id
                                        val primaryAngleId = profile.selectedAngleId ?: profile.angles.firstOrNull()?.id
                                        val cutoutBmp = primaryAngleId?.let { angleCutoutCache[it] ?: angleBitmapCache[it] }
                                            ?: profileCache[profile.id]
                                        Box(
                                            modifier = Modifier
                                                .size(54.dp)
                                                .clip(RoundedCornerShape(12.dp))
                                                .border(
                                                    width = if (isSelected) 2.dp else 1.dp,
                                                    color = if (isSelected) Color(0xFF6366F1) else Color(0xFF1E293B),
                                                    shape = RoundedCornerShape(12.dp)
                                                )
                                                .background(if (isSelected) Color(0xFF1E1B4B) else Color(0xFF090F1D))
                                                .clickable { viewModel.scanAndSelectProfileForSwap(profile.id) }
                                        ) {
                                            if (cutoutBmp != null) {
                                                Image(
                                                    bitmap = cutoutBmp.asImageBitmap(),
                                                    contentDescription = null,
                                                    contentScale = ContentScale.Fit,
                                                    modifier = Modifier.fillMaxSize().padding(3.dp)
                                                )
                                            }
                                            Box(
                                                modifier = Modifier
                                                    .align(Alignment.TopEnd)
                                                    .padding(2.dp)
                                                    .size(16.dp)
                                                    .clip(CircleShape)
                                                    .background(Color(0xCC020617))
                                                    .clickable { viewModel.removeFaceProfile(profile.id) },
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Icon(
                                                    Icons.Default.Close,
                                                    contentDescription = "Remove profile",
                                                    tint = Color(0xFFCBD5E1),
                                                    modifier = Modifier.size(10.dp)
                                                )
                                            }
                                            if (profile.angles.size > 1) {
                                                Box(
                                                    modifier = Modifier
                                                        .align(Alignment.BottomEnd)
                                                        .padding(2.dp)
                                                        .clip(RoundedCornerShape(5.dp))
                                                        .background(Color(0xD9312E81))
                                                        .padding(horizontal = 4.dp, vertical = 1.dp)
                                                ) {
                                                    Text(
                                                        "${profile.angles.size}",
                                                        color = Color.White,
                                                        fontSize = 8.sp,
                                                        fontWeight = FontWeight.Bold
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }

                                // Multi-Angle Cutout Strip & +Angle controls for active profile (zero labels on cutouts)
                                val activeProf = viewModel.faceProfiles.find { it.id == viewModel.activeProfileId }
                                    ?: viewModel.faceProfiles.firstOrNull()
                                if (activeProf != null) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        activeProf.angles.forEach { angle ->
                                            val isAngleSel = activeProf.selectedAngleId == angle.id
                                            val aBmp = angleCutoutCache[angle.id] ?: angleBitmapCache[angle.id]
                                            Box(
                                                modifier = Modifier
                                                    .size(40.dp)
                                                    .clip(CircleShape)
                                                    .background(Color(0xFF090F1D))
                                                    .border(
                                                        width = if (isAngleSel) 1.8.dp else 1.dp,
                                                        color = if (isAngleSel) Color(0xFF22D3EE) else Color(0xFF334155),
                                                        shape = CircleShape
                                                    )
                                                    .clickable { viewModel.selectProfileAngle(activeProf.id, angle.id) }
                                            ) {
                                                if (aBmp != null) {
                                                    Image(
                                                        bitmap = aBmp.asImageBitmap(),
                                                        contentDescription = null,
                                                        contentScale = ContentScale.Fit,
                                                        modifier = Modifier.fillMaxSize().padding(2.dp)
                                                    )
                                                }
                                            }
                                        }

                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(Color(0xFF111827))
                                                .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(8.dp))
                                                .clickable {
                                                    viewModel.pendingAngleTargetProfileId = activeProf.id
                                                    faceGalleryPicker.launch("image/*")
                                                }
                                                .padding(horizontal = 8.dp, vertical = 6.dp)
                                        ) {
                                            Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(13.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text("+ Angle", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                        }

                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(Color(0xFF082F49))
                                                .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(8.dp))
                                                .clickable {
                                                    viewModel.pendingAngleTargetProfileId = activeProf.id
                                                    launchFaceCamera()
                                                }
                                                .padding(horizontal = 8.dp, vertical = 6.dp)
                                        ) {
                                            Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(13.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text("+ Cam", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                        }

                                        if (faces.isNotEmpty() && activeProf.angles.size > 1) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                modifier = Modifier
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .background(Color(0xFF0F172A))
                                                    .border(1.dp, Color(0xFF10B981), RoundedCornerShape(8.dp))
                                                    .clickable { viewModel.autoMatchAllTargetFaces() }
                                                    .padding(horizontal = 8.dp, vertical = 6.dp)
                                            ) {
                                                Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color(0xFF34D399), modifier = Modifier.size(13.dp))
                                                Spacer(Modifier.width(4.dp))
                                                Text("Match", color = Color(0xFF34D399), fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                            }
                                        }
                                    }
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
                                                .padding(horizontal = 10.dp, vertical = 5.dp)
                                        ) {
                                            Text(
                                                "Person ${idx + 1} · ${if (f.enabled) "ON" else "OFF"}",
                                                color = if (f.enabled) Color.White else Color(0xFF64748B),
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Medium
                                            )
                                        }
                                    }
                                }
                            } else if (viewModel.splitCompareEnabled) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Split ${viewModel.splitComparePercent.toInt()}%", color = Color(0xFF94A3B8), fontSize = 11.sp, modifier = Modifier.width(78.dp))
                                    Slider(
                                        value = viewModel.splitComparePercent,
                                        onValueChange = { viewModel.splitComparePercent = it },
                                        valueRange = 5f..95f,
                                        modifier = Modifier.weight(1f).height(26.dp)
                                    )
                                }
                            }
                        }

                        1 -> {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Opacity ${adj.swapStrength}%", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                Slider(
                                    value = adj.swapStrength.toFloat(),
                                    onValueChange = { viewModel.adjustments = adj.copy(swapStrength = it.toInt()) },
                                    valueRange = 0f..100f,
                                    colors = SliderDefaults.colors(thumbColor = Color(0xFF6366F1), activeTrackColor = Color(0xFF6366F1)),
                                    modifier = Modifier.weight(1f).height(26.dp)
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Feather ${adj.featherRadius}px", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                Slider(
                                    value = adj.featherRadius.toFloat(),
                                    onValueChange = { viewModel.adjustments = adj.copy(featherRadius = it.toInt()) },
                                    valueRange = 8f..45f,
                                    modifier = Modifier.weight(1f).height(26.dp)
                                )
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Bright ${adj.brightness.toInt()}", color = Color(0xFFCBD5E1), fontSize = 10.sp, modifier = Modifier.width(56.dp))
                                        Slider(
                                            value = adj.brightness,
                                            onValueChange = { viewModel.adjustments = adj.copy(brightness = it) },
                                            valueRange = -40f..40f,
                                            modifier = Modifier.weight(1f).height(24.dp)
                                        )
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Sat ${adj.saturation.toInt()}", color = Color(0xFFCBD5E1), fontSize = 10.sp, modifier = Modifier.width(56.dp))
                                        Slider(
                                            value = adj.saturation,
                                            onValueChange = { viewModel.adjustments = adj.copy(saturation = it) },
                                            valueRange = -40f..40f,
                                            modifier = Modifier.weight(1f).height(24.dp)
                                        )
                                    }
                                }
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Contrast ${adj.contrast.toInt()}", color = Color(0xFFCBD5E1), fontSize = 10.sp, modifier = Modifier.width(62.dp))
                                        Slider(
                                            value = adj.contrast,
                                            onValueChange = { viewModel.adjustments = adj.copy(contrast = it) },
                                            valueRange = -35f..60f,
                                            modifier = Modifier.weight(1f).height(24.dp)
                                        )
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Warm ${adj.warmth.toInt()}", color = Color(0xFFCBD5E1), fontSize = 10.sp, modifier = Modifier.width(62.dp))
                                        Slider(
                                            value = adj.warmth,
                                            onValueChange = { viewModel.adjustments = adj.copy(warmth = it) },
                                            valueRange = -30f..30f,
                                            modifier = Modifier.weight(1f).height(24.dp)
                                        )
                                    }
                                }
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CompactToggleChip(
                                    label = "Skin Match",
                                    checked = adj.skinToneMatch,
                                    activeColor = Color(0xFF6366F1),
                                    onToggle = { viewModel.adjustments = adj.copy(skinToneMatch = !adj.skinToneMatch) }
                                )
                                CompactToggleChip(
                                    label = "Smart Edge",
                                    checked = adj.smartBlend,
                                    activeColor = Color(0xFF0EA5E9),
                                    onToggle = { viewModel.adjustments = adj.copy(smartBlend = !adj.smartBlend) }
                                )
                                CompactToggleChip(
                                    label = "${segmentedLayers?.summary?.totalLayerCount ?: 2}-Layer Cut",
                                    checked = adj.preserveTargetLayers,
                                    activeColor = Color(0xFF10B981),
                                    onToggle = { viewModel.adjustments = adj.copy(preserveTargetLayers = !adj.preserveTargetLayers) }
                                )
                            }
                            if (renderedBitmap != null) {
                                val manualPatch = adj.manualSkinPatch
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(Color(0xFF111827))
                                        .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(9.dp))
                                        .padding(horizontal = 10.dp, vertical = 7.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        if (manualPatch != null) {
                                            Box(
                                                modifier = Modifier
                                                    .size(16.dp)
                                                    .clip(CircleShape)
                                                    .background(
                                                        Color(
                                                            (manualPatch.sampledRed / 255f).coerceIn(0f, 1f),
                                                            (manualPatch.sampledGreen / 255f).coerceIn(0f, 1f),
                                                            (manualPatch.sampledBlue / 255f).coerceIn(0f, 1f)
                                                        )
                                                    )
                                                    .border(1.dp, Color.White, CircleShape)
                                            )
                                        } else {
                                            Icon(Icons.Default.Colorize, contentDescription = null, tint = Color(0xFF94A3B8), modifier = Modifier.size(15.dp))
                                        }
                                        Spacer(Modifier.width(8.dp))
                                        Text(
                                            if (manualPatch != null) "Skin Ref: Target Patch" else "Skin Ref: Auto Face",
                                            color = Color(0xFFE2E8F0),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                        if (manualPatch != null) {
                                            Text(
                                                "Auto",
                                                color = Color(0xFF94A3B8),
                                                fontSize = 11.sp,
                                                modifier = Modifier
                                                    .clip(RoundedCornerShape(7.dp))
                                                    .background(Color(0xFF1E293B))
                                                    .clickable { viewModel.clearManualSkinPatch() }
                                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                                            )
                                        }
                                        Text(
                                            if (isSamplingSkin) "Done" else "Sample Skin",
                                            color = if (isSamplingSkin) Color(0xFF0F172A) else Color.White,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(7.dp))
                                                .background(if (isSamplingSkin) Color(0xFFFBBF24) else Color(0xFF312E81))
                                                .border(
                                                    1.dp,
                                                    if (isSamplingSkin) Color(0xFFFBBF24) else Color(0xFF6366F1),
                                                    RoundedCornerShape(7.dp)
                                                )
                                                .clickable {
                                                    val nextSample = !isSamplingSkin
                                                    if (nextSample) {
                                                        viewModel.isCutoutBrushMode = false
                                                        viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                                    }
                                                    viewModel.isSkinSamplingMode = nextSample
                                                }
                                                .padding(horizontal = 9.dp, vertical = 4.dp)
                                        )
                                    }
                                }
                                if (manualPatch != null) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Patch Size", color = Color(0xFFCBD5E1), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                        Slider(
                                            value = manualPatch.radiusRatio,
                                            onValueChange = { viewModel.updateSkinSampleRadius(it) },
                                            valueRange = 0.014f..0.075f,
                                            colors = SliderDefaults.colors(thumbColor = Color(0xFFFBBF24), activeTrackColor = Color(0xFFFBBF24)),
                                            modifier = Modifier.weight(1f).height(28.dp)
                                        )
                                    }
                                }
                            }
                        }

                        2 -> {
                            // PicsArt-Style Precision Cutout & Foreground Hair/Jewelry Protect Brush
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(if (isCutoutBrush && viewModel.cutoutBrushProtect) Color(0xFF9F1239) else Color(0xFF111827))
                                        .border(
                                            1.dp,
                                            if (isCutoutBrush && viewModel.cutoutBrushProtect) Color(0xFFF43F5E) else Color(0xFF334155),
                                            RoundedCornerShape(9.dp)
                                        )
                                        .clickable {
                                            viewModel.isSkinSamplingMode = false
                                            viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                            viewModel.cutoutBrushProtect = true
                                            viewModel.isCutoutBrushMode = true
                                        }
                                        .padding(horizontal = 8.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.Brush, contentDescription = null, tint = Color(0xFFFDA4AF), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Protect Hair/Jewel", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                }

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(if (isCutoutBrush && !viewModel.cutoutBrushProtect) Color(0xFF155E75) else Color(0xFF111827))
                                        .border(
                                            1.dp,
                                            if (isCutoutBrush && !viewModel.cutoutBrushProtect) Color(0xFF22D3EE) else Color(0xFF334155),
                                            RoundedCornerShape(9.dp)
                                        )
                                        .clickable {
                                            viewModel.isSkinSamplingMode = false
                                            viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                            viewModel.cutoutBrushProtect = false
                                            viewModel.isCutoutBrushMode = true
                                        }
                                        .padding(horizontal = 8.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.ContentCut, contentDescription = null, tint = Color(0xFF67E8F9), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Restore Face", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                }

                                if (isCutoutBrush) {
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(9.dp))
                                            .background(Color(0xFF1E293B))
                                            .clickable { viewModel.isCutoutBrushMode = false }
                                            .padding(horizontal = 10.dp, vertical = 7.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text("Done", color = Color(0xFFFBBF24), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }

                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Size ${viewModel.cutoutBrushSizePx.toInt()}px", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                Slider(
                                    value = viewModel.cutoutBrushSizePx,
                                    onValueChange = { viewModel.cutoutBrushSizePx = it },
                                    valueRange = 10f..90f,
                                    colors = SliderDefaults.colors(thumbColor = Color(0xFFF43F5E), activeTrackColor = Color(0xFFF43F5E)),
                                    modifier = Modifier.weight(1f).height(26.dp)
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Hardness ${viewModel.cutoutBrushHardness.toInt()}%", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                Slider(
                                    value = viewModel.cutoutBrushHardness,
                                    onValueChange = { viewModel.cutoutBrushHardness = it },
                                    valueRange = 10f..100f,
                                    colors = SliderDefaults.colors(thumbColor = Color(0xFFF43F5E), activeTrackColor = Color(0xFFF43F5E)),
                                    modifier = Modifier.weight(1f).height(26.dp)
                                )
                            }

                            // Adaptive N-Layer Object-Scanning Cutout Stack (Bg + Face + K Dynamic Object Layers)
                            Text(
                                text = segmentedLayers?.summary?.decisionNote ?: "2 Base Layers · Tap Auto-Scan to detect objects",
                                color = Color(0xFF94A3B8),
                                fontSize = 10.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CompactToggleChip(
                                    label = "Bg",
                                    checked = adj.showBackgroundLayer,
                                    activeColor = Color(0xFF64748B),
                                    onToggle = {
                                        viewModel.adjustments = adj.copy(showBackgroundLayer = !adj.showBackgroundLayer)
                                    }
                                )
                                CompactToggleChip(
                                    label = "Face",
                                    checked = adj.showFaceLayer,
                                    activeColor = Color(0xFF6366F1),
                                    onToggle = {
                                        viewModel.adjustments = adj.copy(showFaceLayer = !adj.showFaceLayer)
                                    }
                                )
                                CompactToggleChip(
                                    label = "All Cutouts (${segmentedLayers?.objectLayers?.size ?: 0})",
                                    checked = adj.showForeLayers && adj.preserveTargetLayers,
                                    activeColor = Color(0xFF10B981),
                                    onToggle = {
                                        viewModel.adjustments = adj.copy(showForeLayers = !adj.showForeLayers)
                                    }
                                )
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(7.dp))
                                        .background(if (viewModel.isSegmentingLayers) Color(0xFF312E81) else Color(0xFF1E293B))
                                        .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(7.dp))
                                        .clickable(enabled = renderedBitmap != null && !viewModel.isSegmentingLayers) {
                                            viewModel.resegmentTargetLayers()
                                        }
                                        .padding(horizontal = 8.dp, vertical = 5.dp)
                                ) {
                                    Icon(Icons.Default.Refresh, contentDescription = "Scan Object Layers", tint = Color(0xFF818CF8), modifier = Modifier.size(13.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text(
                                        if (viewModel.isSegmentingLayers) "Scanning..." else "Auto-Scan",
                                        color = Color.White,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1
                                    )
                                }
                            }

                            val detectedObjects = segmentedLayers?.objectLayers ?: emptyList()
                            if (detectedObjects.isNotEmpty()) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    detectedObjects.forEach { objLayer ->
                                        val layerColor = when (objLayer.kind) {
                                            CutoutLayerKind.FOREHEAD -> Color(0xFF10B981)
                                            CutoutLayerKind.HAIR -> Color(0xFFF43F5E)
                                            CutoutLayerKind.HAND_FINGER -> Color(0xFFF59E0B)
                                            CutoutLayerKind.ACCESSORY -> Color(0xFF0EA5E9)
                                            CutoutLayerKind.OBJECT -> Color(0xFF8B5CF6)
                                        }
                                        val isVisible = adj.preserveTargetLayers && adj.showForeLayers && (objLayer.id !in adj.hiddenLayerIds)
                                        CompactToggleChip(
                                            label = "${objLayer.name} ${objLayer.coveragePct}%",
                                            checked = isVisible,
                                            activeColor = layerColor,
                                            onToggle = {
                                                viewModel.toggleCutoutObjectLayer(objLayer.id)
                                            }
                                        )
                                    }
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    CompactToggleChip(
                                        label = "${segmentedLayers?.summary?.totalLayerCount ?: 2}-Layer",
                                        checked = adj.preserveTargetLayers,
                                        activeColor = Color(0xFF10B981),
                                        onToggle = {
                                            viewModel.adjustments = adj.copy(preserveTargetLayers = !adj.preserveTargetLayers)
                                            viewModel.resegmentTargetLayers()
                                        }
                                    )
                                    CompactToggleChip(
                                        label = "Hair/Jewel",
                                        checked = adj.autoMaskHair || adj.autoMaskAccessories,
                                        activeColor = Color(0xFFF43F5E),
                                        onToggle = {
                                            val enabled = !(adj.autoMaskHair || adj.autoMaskAccessories)
                                            viewModel.adjustments = adj.copy(
                                                autoMaskHair = enabled,
                                                autoMaskAccessories = enabled
                                            )
                                            viewModel.resegmentTargetLayers()
                                        }
                                    )
                                    CompactToggleChip(
                                        label = "Hands/Obj",
                                        checked = adj.autoMaskObjects,
                                        activeColor = Color(0xFFF59E0B),
                                        onToggle = {
                                            viewModel.adjustments = adj.copy(autoMaskObjects = !adj.autoMaskObjects)
                                            viewModel.resegmentTargetLayers()
                                        }
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(7.dp))
                                            .background(if (viewModel.cutoutShowOverlay) Color(0xFF312E81) else Color(0xFF1E293B))
                                            .clickable { viewModel.cutoutShowOverlay = !viewModel.cutoutShowOverlay }
                                            .padding(horizontal = 8.dp, vertical = 5.dp)
                                    ) {
                                        Icon(
                                            if (viewModel.cutoutShowOverlay) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                            contentDescription = "Toggle Mask Overlay",
                                            tint = Color.White,
                                            modifier = Modifier.size(13.dp)
                                        )
                                        Spacer(Modifier.width(4.dp))
                                        Text("Overlay", color = Color.White, fontSize = 10.sp)
                                    }
                                    if (viewModel.canUndoCutoutMask) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(7.dp))
                                                .background(Color(0xFF1E293B))
                                                .clickable { viewModel.undoCutoutStroke() }
                                                .padding(horizontal = 8.dp, vertical = 5.dp)
                                        ) {
                                            Icon(Icons.Default.Undo, contentDescription = "Undo Brush", tint = Color(0xFF38BDF8), modifier = Modifier.size(13.dp))
                                            Spacer(Modifier.width(3.dp))
                                            Text("Undo", color = Color(0xFF38BDF8), fontSize = 10.sp)
                                        }
                                    }
                                    if (viewModel.cutoutProtectionMask != null) {
                                        Text(
                                            "Clear",
                                            color = Color(0xFFF87171),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(7.dp))
                                                .background(Color(0xFF1E293B))
                                                .clickable { viewModel.clearCutoutMask() }
                                                .padding(horizontal = 8.dp, vertical = 5.dp)
                                        )
                                    }
                                }
                            }
                        }

                        3 -> {
                            VirtualLightingStudioPanel(
                                light = adj.virtualLight,
                                onLightChange = { viewModel.adjustments = adj.copy(virtualLight = it) },
                                onAutoMatchTarget = targetBmp?.let { bmp ->
                                    {
                                        val refFace = faces.firstOrNull { it.id == viewModel.selectedFaceId }
                                            ?: faces.firstOrNull { it.enabled }
                                            ?: faces.firstOrNull()
                                        val estimated = VirtualLightingStudioShader.estimateTargetLightEnvironment(
                                            targetBitmap = bmp,
                                            faceCenterX = refFace?.let { (it.boxLeft + it.boxRight) * 0.5f },
                                            faceCenterY = refFace?.let { (it.boxTop + it.boxBottom) * 0.5f },
                                            faceWidth = refFace?.let { it.boxRight - it.boxLeft },
                                            faceHeight = refFace?.let { it.boxBottom - it.boxTop }
                                        )
                                        viewModel.adjustments = adj.copy(virtualLight = estimated)
                                    }
                                }
                            )
                        }

                        4 -> {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Size ${(adj.scale * 100).toInt()}%", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                Slider(
                                    value = adj.scale,
                                    onValueChange = { viewModel.adjustments = adj.copy(scale = it) },
                                    valueRange = 0.75f..1.35f,
                                    modifier = Modifier.weight(1f).height(28.dp)
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Tilt ${adj.rotation.toInt()}°", color = Color(0xFFE2E8F0), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                Slider(
                                    value = adj.rotation,
                                    onValueChange = { viewModel.adjustments = adj.copy(rotation = it) },
                                    valueRange = -25f..25f,
                                    modifier = Modifier.weight(1f).height(28.dp)
                                )
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CompactToggleChip(
                                    label = "Landmark Mesh",
                                    checked = adj.showGeometricMesh,
                                    activeColor = Color(0xFF0891B2),
                                    onToggle = {
                                        val checked = !adj.showGeometricMesh
                                        if (checked) {
                                            viewModel.isSkinSamplingMode = false
                                            viewModel.isCutoutBrushMode = false
                                        }
                                        viewModel.adjustments = adj.copy(showGeometricMesh = checked)
                                    }
                                )
                                Button(
                                    onClick = { viewModel.adjustments = adj.copy(scale = 1.0f, rotation = 0f, offsetX = 0f, offsetY = 0f) },
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                                    modifier = Modifier.height(28.dp),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)
                                ) {
                                    Text("Reset", fontSize = 11.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CompactToggleChip(
    label: String,
    checked: Boolean,
    activeColor: Color,
    onToggle: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(7.dp))
            .background(if (checked) activeColor.copy(alpha = 0.22f) else Color(0xFF111827))
            .border(1.dp, if (checked) activeColor else Color(0xFF334155), RoundedCornerShape(7.dp))
            .clickable { onToggle() }
            .padding(horizontal = 9.dp, vertical = 5.dp)
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(if (checked) activeColor else Color(0xFF475569))
        )
        Spacer(Modifier.width(5.dp))
        Text(
            text = label,
            color = if (checked) Color.White else Color(0xFF94A3B8),
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1
        )
    }
}
