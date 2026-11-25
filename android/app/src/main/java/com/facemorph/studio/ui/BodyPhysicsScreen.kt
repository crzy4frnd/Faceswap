package com.facemorph.studio.ui

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.Air
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Compare
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.OpenWith
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Waves
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
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
import com.facemorph.studio.engine.ClothMeshState
import com.facemorph.studio.engine.NativeClothPhysicsEngine
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.model.FabricType
import com.facemorph.studio.model.MotionPreset
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.viewmodel.StudioViewModel
import java.io.File
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
fun BodyPhysicsScreen(viewModel: StudioViewModel) {
    val context = LocalContext.current
    val targetBmp = viewModel.targetBitmap
    val scan = viewModel.bodyScan
    val clothConfig = viewModel.clothConfig
    val wardrobeAssets = viewModel.wardrobeAssets
    val wardrobeBitmaps = viewModel.wardrobeBitmapCache.toMap()
    val clothMeshes = remember { mutableStateMapOf<String, ClothMeshState>() }

    var activeDeckTab by remember { mutableIntStateOf(0) } // 0=Wardrobe, 1=Cloth Physics
    var isDeckExpanded by remember { mutableStateOf(true) }
    var moveItemMode by remember { mutableStateOf(false) }
    var simTimeSec by remember { mutableFloatStateOf(0f) }
    var pendingCameraFile by remember { mutableStateOf<File?>(null) }
    var viewportZoom by remember { mutableFloatStateOf(1f) }
    var viewportPan by remember { mutableStateOf(Offset.Zero) }
    var lastTapTimeMs by remember { mutableStateOf(0L) }
    var lastTapPos by remember { mutableStateOf(Offset.Zero) }
    val isFullScreen = viewModel.isFullScreenEditor

    val galleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.loadTargetFromUri(it) }
    }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = pendingCameraFile
        if (ok && file != null && file.exists()) {
            viewModel.loadTargetFromFile(file.absolutePath)
        }
    }

    LaunchedEffect(targetBmp) {
        clothMeshes.clear()
    }

    LaunchedEffect(clothConfig.isSimulating, targetBmp) {
        var lastNanos = 0L
        while (clothConfig.isSimulating && targetBmp != null) {
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
            .background(StudioColors.Background)
    ) {
        // Edge-to-Edge Body Try-On & Cloth Physics Canvas
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clipToBounds()
                .background(StudioColors.SurfaceContainerLowest),
            contentAlignment = Alignment.Center
        ) {
            if (renderedFrame != null) {
                fun applyBodyViewportTransform(
                    centroid: Offset,
                    panDelta: Offset,
                    zoomDelta: Float,
                    canvasSize: IntSize
                ) {
                    val prevZ = viewportZoom
                    val nextZ = (prevZ * zoomDelta).coerceIn(1f, 4f)
                    val cx = canvasSize.width * 0.5f
                    val cy = canvasSize.height * 0.5f
                    val ratio = nextZ / prevZ
                    val nx = (centroid.x - cx) - ((centroid.x - cx) - viewportPan.x) * ratio + panDelta.x
                    val ny = (centroid.y - cy) - ((centroid.y - cy) - viewportPan.y) * ratio + panDelta.y
                    viewportZoom = nextZ
                    if (nextZ <= 1.02f) {
                        viewportPan = Offset.Zero
                    } else {
                        val maxX = canvasSize.width * (nextZ - 1f) * 0.6f
                        val maxY = canvasSize.height * (nextZ - 1f) * 0.6f
                        viewportPan = Offset(nx.coerceIn(-maxX, maxX), ny.coerceIn(-maxY, maxY))
                    }
                }

                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(
                            viewModel.selectedWardrobeId,
                            renderedFrame.width,
                            renderedFrame.height,
                            moveItemMode,
                            viewModel.bodySplitCompareEnabled
                        ) {
                            awaitEachGesture {
                                val firstDown = awaitFirstDown(requireUnconsumed = false)
                                val downPos = firstDown.position
                                val downTime = System.currentTimeMillis()
                                var isMultiTouch = false
                                var tapCandidate = true
                                var prevCentroid: Offset? = null
                                var prevSpan = 0f
                                var prevSinglePos = downPos

                                val bw = renderedFrame.width.toFloat()
                                val bh = renderedFrame.height.toFloat()
                                val baseScale = min(size.width / bw, size.height / bh)
                                val curScale = baseScale * viewportZoom
                                val left = (size.width - bw * curScale) * 0.5f + viewportPan.x
                                val top = (size.height - bh * curScale) * 0.5f + viewportPan.y
                                val splitXDown = left + (bw * curScale) * (viewModel.bodySplitComparePercent / 100f)
                                val draggingDivider = viewModel.bodySplitCompareEnabled && abs(downPos.x - splitXDown) < 56f
                                val mesh = if (moveItemMode || draggingDivider) null else clothMeshes[viewModel.selectedWardrobeId]
                                if (mesh != null) {
                                    val imgX = (downPos.x - left) / curScale
                                    val imgY = (downPos.y - top) / curScale
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
                                }

                                while (true) {
                                    val event = awaitPointerEvent()
                                    val pressed = event.changes.filter { it.pressed }
                                    if (pressed.isEmpty()) {
                                        clothMeshes[viewModel.selectedWardrobeId]?.grabbedIndex = null
                                        if (tapCandidate && !isMultiTouch && !draggingDivider) {
                                            val dt = downTime - lastTapTimeMs
                                            val distPrev = hypot(downPos.x - lastTapPos.x, downPos.y - lastTapPos.y)
                                            if (dt in 40L..320L && distPrev < 64f) {
                                                if (viewportZoom > 1.1f) {
                                                    viewportZoom = 1f
                                                    viewportPan = Offset.Zero
                                                } else {
                                                    val targetZ = 2.2f
                                                    val cx = size.width * 0.5f
                                                    val cy = size.height * 0.5f
                                                    viewportZoom = targetZ
                                                    viewportPan = Offset(
                                                        (cx - downPos.x) * (targetZ - 1f) * 0.6f,
                                                        (cy - downPos.y) * (targetZ - 1f) * 0.6f
                                                    )
                                                }
                                                lastTapTimeMs = 0L
                                            } else {
                                                lastTapTimeMs = downTime
                                                lastTapPos = downPos
                                            }
                                        }
                                        break
                                    }

                                    if (pressed.size >= 2) {
                                        clothMeshes[viewModel.selectedWardrobeId]?.grabbedIndex = null
                                        isMultiTouch = true
                                        tapCandidate = false
                                        val p0 = pressed[0].position
                                        val p1 = pressed[1].position
                                        val centroid = Offset((p0.x + p1.x) * 0.5f, (p0.y + p1.y) * 0.5f)
                                        val span = hypot(p1.x - p0.x, p1.y - p0.y).coerceAtLeast(12f)
                                        if (prevCentroid != null && prevSpan > 0f) {
                                            val zoomDelta = (span / prevSpan).coerceIn(0.75f, 1.35f)
                                            val panDelta = centroid - prevCentroid!!
                                            applyBodyViewportTransform(centroid, panDelta, zoomDelta, size)
                                        }
                                        prevCentroid = centroid
                                        prevSpan = span
                                        pressed.forEach { it.consume() }
                                    } else if (!isMultiTouch && pressed.size == 1) {
                                        val ch = pressed[0]
                                        val pos = ch.position
                                        val distMoved = hypot(pos.x - downPos.x, pos.y - downPos.y)
                                        if (distMoved > 7f) tapCandidate = false
                                        val dragDelta = pos - prevSinglePos
                                        val activeMesh = if (moveItemMode || draggingDivider) null else clothMeshes[viewModel.selectedWardrobeId]
                                        if (draggingDivider) {
                                            val drawWCur = bw * (baseScale * viewportZoom)
                                            val leftCur = (size.width - drawWCur) * 0.5f + viewportPan.x
                                            val pct = (((pos.x - leftCur) / max(1f, drawWCur)) * 100f).coerceIn(4f, 96f)
                                            viewModel.bodySplitComparePercent = pct
                                        } else if (moveItemMode && distMoved > 3f) {
                                            val scale = baseScale * viewportZoom
                                            viewModel.nudgeActiveLayerOffset(dragDelta.x / scale, dragDelta.y / scale)
                                        } else if (activeMesh?.grabbedIndex != null) {
                                            val scale = baseScale * viewportZoom
                                            activeMesh.grabbedX += dragDelta.x / scale
                                            activeMesh.grabbedY += dragDelta.y / scale
                                        } else if (viewportZoom > 1.03f && distMoved > 6f) {
                                            applyBodyViewportTransform(pos, dragDelta, 1f, size)
                                        }
                                        prevSinglePos = pos
                                        ch.consume()
                                    }
                                }
                            }
                        }
                ) {
                    val bw = renderedFrame.width.toFloat()
                    val bh = renderedFrame.height.toFloat()
                    val baseScale = min(size.width / bw, size.height / bh)
                    val scale = baseScale * viewportZoom
                    val drawW = bw * scale
                    val drawH = bh * scale
                    val left = (size.width - drawW) / 2f + viewportPan.x
                    val top = (size.height - drawH) / 2f + viewportPan.y

                    if (viewModel.bodySplitCompareEnabled && targetBmp != null) {
                        val splitX = (left + drawW * (viewModel.bodySplitComparePercent / 100f))
                            .coerceIn(max(0f, left), min(size.width, left + drawW))
                        clipRect(left = 0f, top = 0f, right = splitX, bottom = size.height) {
                            drawImage(
                                image = targetBmp.asImageBitmap(),
                                dstOffset = IntOffset(left.toInt(), top.toInt()),
                                dstSize = IntSize(drawW.toInt(), drawH.toInt())
                            )
                        }
                        clipRect(left = splitX, top = 0f, right = size.width, bottom = size.height) {
                            drawImage(
                                image = renderedFrame.asImageBitmap(),
                                dstOffset = IntOffset(left.toInt(), top.toInt()),
                                dstSize = IntSize(drawW.toInt(), drawH.toInt())
                            )
                        }
                        val lineTop = max(0f, top)
                        val lineBot = min(size.height, top + drawH)
                        drawLine(
                            color = StudioColors.Secondary,
                            start = Offset(splitX, lineTop),
                            end = Offset(splitX, lineBot),
                            strokeWidth = 3f
                        )
                        val handleY = (top + drawH * 0.5f).coerceIn(48f, max(48f, size.height - 48f))
                        drawCircle(color = StudioColors.SurfaceContainerLowest, radius = 15f, center = Offset(splitX, handleY))
                        drawCircle(
                            color = StudioColors.Secondary,
                            radius = 13f,
                            center = Offset(splitX, handleY),
                            style = Stroke(width = 3f)
                        )
                    } else {
                        drawImage(
                            image = renderedFrame.asImageBitmap(),
                            dstOffset = IntOffset(left.toInt(), top.toInt()),
                            dstSize = IntSize(drawW.toInt(), drawH.toInt())
                        )
                    }
                }

                // Zoom Reset Pill
                if (viewportZoom > 1.05f) {
                    Surface(
                        shape = CircleShape,
                        color = StudioColors.FloatingGlass,
                        shadowElevation = 4.dp,
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .statusBarsPadding()
                            .padding(start = 12.dp, top = if (isFullScreen) 14.dp else 58.dp)
                            .clip(CircleShape)
                            .clickable {
                                viewportZoom = 1f
                                viewportPan = Offset.Zero
                            }
                    ) {
                        Text(
                            "${(viewportZoom * 100).toInt()}% · Reset",
                            color = StudioColors.Secondary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                        )
                    }
                }

                // Canvas Bottom Controls (Hidden in Fullscreen Mode)
                if (!isFullScreen) {
                    Row(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(start = 12.dp, bottom = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        StudioFloatingIconButton(
                            icon = if (clothConfig.isSimulating) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = "Play or Pause Cloth Simulation",
                            onClick = { viewModel.clothConfig = clothConfig.copy(isSimulating = !clothConfig.isSimulating) },
                            active = clothConfig.isSimulating,
                            activeContainerColor = StudioColors.PrimaryContainer,
                            size = 42.dp
                        )
                        StudioFloatingIconButton(
                            icon = Icons.Default.Air,
                            contentDescription = "Toggle Wind Fan",
                            onClick = { viewModel.clothConfig = clothConfig.copy(airFanActive = !clothConfig.airFanActive) },
                            active = clothConfig.airFanActive,
                            activeContainerColor = StudioColors.SecondaryContainer,
                            activeContentColor = StudioColors.OnSecondaryContainer,
                            size = 42.dp
                        )
                        StudioFloatingIconButton(
                            icon = Icons.Default.AccessibilityNew,
                            contentDescription = "Body Fit HUD",
                            onClick = { viewModel.showBodyScanHud = !viewModel.showBodyScanHud },
                            active = viewModel.showBodyScanHud,
                            activeContainerColor = StudioColors.PrimaryContainer,
                            size = 42.dp
                        )
                        StudioFloatingIconButton(
                            icon = Icons.Default.Compare,
                            contentDescription = "Split Compare",
                            onClick = { viewModel.bodySplitCompareEnabled = !viewModel.bodySplitCompareEnabled },
                            active = viewModel.bodySplitCompareEnabled,
                            activeContainerColor = StudioColors.SecondaryContainer,
                            activeContentColor = StudioColors.OnSecondaryContainer,
                            size = 42.dp
                        )
                    }

                    val activeLayer = viewModel.fittedLayers.find { it.assetId == viewModel.selectedWardrobeId && it.visible }
                    if (activeLayer != null) {
                        Row(
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(end = 12.dp, bottom = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = if (moveItemMode) StudioColors.PrimaryContainer else StudioColors.FloatingGlass,
                                shadowElevation = 6.dp,
                                modifier = Modifier
                                    .height(42.dp)
                                    .clip(CircleShape)
                                    .clickable { moveItemMode = !moveItemMode }
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 12.dp)
                                ) {
                                    Icon(Icons.Default.OpenWith, contentDescription = "Move Item", tint = Color.White, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text(if (moveItemMode) "Moving" else "Move", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }

                            Surface(
                                shape = CircleShape,
                                color = StudioColors.FloatingGlass,
                                shadowElevation = 6.dp,
                                modifier = Modifier.height(42.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 6.dp)
                                ) {
                                    IconButton(onClick = { viewModel.updateActiveLayerScale(delta = -0.06f) }, modifier = Modifier.size(34.dp)) {
                                        Icon(Icons.Default.ZoomOut, contentDescription = "Shrink Item", tint = Color.White, modifier = Modifier.size(18.dp))
                                    }
                                    Text("${(activeLayer.scale * 100).toInt()}%", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    IconButton(onClick = { viewModel.updateActiveLayerScale(delta = 0.06f) }, modifier = Modifier.size(34.dp)) {
                                        Icon(Icons.Default.ZoomIn, contentDescription = "Enlarge Item", tint = Color.White, modifier = Modifier.size(18.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                // Clean Material 3 Empty Prompt
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = StudioColors.SurfaceContainer,
                    tonalElevation = 3.dp,
                    modifier = Modifier.padding(24.dp)
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                        modifier = Modifier.padding(24.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(60.dp)
                                .clip(CircleShape)
                                .background(StudioColors.PrimaryContainer),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.AccessibilityNew, contentDescription = null, tint = StudioColors.Primary, modifier = Modifier.size(30.dp))
                        }
                        Text("Load a Photo for Body Fit", color = StudioColors.TextPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text(
                            "Pick a full or upper-body photo from Gallery or Camera to fit outfits & jewelry with physics.",
                            color = StudioColors.TextSecondary,
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            StudioTonalActionButton(
                                label = "Gallery",
                                icon = Icons.Default.PhotoLibrary,
                                onClick = { galleryPicker.launch("image/*") },
                                containerColor = StudioColors.PrimaryContainer,
                                contentColor = StudioColors.OnPrimaryContainer,
                                iconTint = StudioColors.Primary,
                                modifier = Modifier.weight(1f)
                            )
                            StudioTonalActionButton(
                                label = "Camera",
                                icon = Icons.Default.CameraAlt,
                                onClick = {
                                    val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "body")
                                    pendingCameraFile = file
                                    cameraLauncher.launch(uri)
                                },
                                containerColor = StudioColors.SecondaryContainer,
                                contentColor = StudioColors.OnSecondaryContainer,
                                iconTint = StudioColors.Secondary,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }
            }

            // Floating Material 3 Top Action Bar (Hidden in Fullscreen)
            AnimatedVisibility(
                visible = !isFullScreen,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StudioFloatingIconButton(
                            icon = Icons.Default.PhotoLibrary,
                            contentDescription = "Gallery",
                            onClick = { galleryPicker.launch("image/*") },
                            iconTint = StudioColors.Primary,
                            size = 40.dp
                        )
                        StudioFloatingIconButton(
                            icon = Icons.Default.CameraAlt,
                            contentDescription = "Camera",
                            onClick = {
                                val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "body")
                                pendingCameraFile = file
                                cameraLauncher.launch(uri)
                            },
                            iconTint = StudioColors.Secondary,
                            size = 40.dp
                        )

                        if (scan != null) {
                            Surface(
                                shape = CircleShape,
                                color = StudioColors.FloatingGlass,
                                shadowElevation = 4.dp,
                                modifier = Modifier.height(40.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    modifier = Modifier.padding(horizontal = 12.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(7.dp)
                                            .clip(CircleShape)
                                            .background(if (scan.hasSkeletonPose) StudioColors.Tertiary else StudioColors.Warning)
                                    )
                                    Text(
                                        "${scan.estimatedSize} · S${scan.shoulderWidthCm} C${scan.chestCm} W${scan.waistCm}",
                                        color = StudioColors.Secondary,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }

                        if (viewModel.detectedFaces.size > 1) {
                            viewModel.detectedFaces.forEachIndexed { idx, f ->
                                val isSubject = viewModel.bodySubjectFaceId == f.id
                                Surface(
                                    shape = CircleShape,
                                    color = if (isSubject) StudioColors.PrimaryContainer else StudioColors.FloatingGlass,
                                    shadowElevation = 4.dp,
                                    modifier = Modifier
                                        .height(40.dp)
                                        .clip(CircleShape)
                                        .clickable {
                                            clothMeshes.clear()
                                            viewModel.selectBodySubjectFace(f.id)
                                        }
                                ) {
                                    Box(
                                        modifier = Modifier.padding(horizontal = 12.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(
                                            "Person ${idx + 1}",
                                            color = if (isSubject) Color.White else StudioColors.TextSecondary,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.width(8.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (renderedFrame != null) {
                            StudioFloatingIconButton(
                                icon = Icons.Default.Fullscreen,
                                contentDescription = "Full Screen Editor",
                                onClick = { viewModel.isFullScreenEditor = true },
                                iconTint = StudioColors.TextPrimary,
                                size = 40.dp
                            )
                            Button(
                                onClick = { viewModel.exportBitmapToGallery(renderedFrame, "BodyFit") },
                                shape = CircleShape,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = StudioColors.Tertiary,
                                    contentColor = StudioColors.OnPrimary
                                ),
                                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 0.dp),
                                modifier = Modifier.height(40.dp)
                            ) {
                                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Save", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            // Minimal Fullscreen Bar
            AnimatedVisibility(
                visible = isFullScreen,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .statusBarsPadding()
                    .padding(12.dp)
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (renderedFrame != null) {
                        Button(
                            onClick = { viewModel.exportBitmapToGallery(renderedFrame, "BodyFit") },
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = StudioColors.Tertiary,
                                contentColor = StudioColors.OnPrimary
                            ),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 0.dp),
                            modifier = Modifier.height(42.dp)
                        ) {
                            Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Save", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    StudioFloatingIconButton(
                        icon = Icons.Default.FullscreenExit,
                        contentDescription = "Exit Fullscreen",
                        onClick = { viewModel.isFullScreenEditor = false },
                        active = true,
                        activeContainerColor = StudioColors.FloatingGlass,
                        activeContentColor = Color.White,
                        size = 42.dp
                    )
                }
            }
        }

        // Material 3 Bottom Tool Sheet + 2-Tab Tool Rail
        AnimatedVisibility(
            visible = !isFullScreen,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically()
        ) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .animateContentSize(),
                color = StudioColors.SurfaceContainerLow,
                shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                tonalElevation = 4.dp
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    if (isDeckExpanded) {
                        StudioSheetDragHandle(modifier = Modifier.clickable { isDeckExpanded = false })
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 2.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = if (activeDeckTab == 0) "Outfit & Jewelry Try-On" else "Cloth Physics Simulation",
                                color = StudioColors.TextPrimary,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                            IconButton(onClick = { isDeckExpanded = false }, modifier = Modifier.size(32.dp)) {
                                Icon(Icons.Default.ExpandMore, contentDescription = "Collapse Panel", tint = StudioColors.TextSecondary, modifier = Modifier.size(20.dp))
                            }
                        }

                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 250.dp)
                                .verticalScroll(rememberScrollState())
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            if (activeDeckTab == 0) {
                                StudioSectionCard {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Surface(
                                            shape = RoundedCornerShape(16.dp),
                                            color = StudioColors.WarningContainer,
                                            modifier = Modifier
                                                .width(78.dp)
                                                .height(92.dp)
                                                .clip(RoundedCornerShape(16.dp))
                                                .clickable { viewModel.showCustomAssetDialog = true }
                                        ) {
                                            Column(
                                                horizontalAlignment = Alignment.CenterHorizontally,
                                                verticalArrangement = Arrangement.Center,
                                                modifier = Modifier.padding(8.dp)
                                            ) {
                                                Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = StudioColors.Warning, modifier = Modifier.size(24.dp))
                                                Spacer(Modifier.height(6.dp))
                                                Text("Scan\nItem", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, lineHeight = 13.sp, textAlign = TextAlign.Center)
                                            }
                                        }

                                        wardrobeAssets.forEach { asset ->
                                            val bmp = wardrobeBitmaps[asset.id]
                                            val isVisible = viewModel.fittedLayers.any { it.assetId == asset.id && it.visible }
                                            val isSelected = viewModel.selectedWardrobeId == asset.id
                                            Surface(
                                                shape = RoundedCornerShape(16.dp),
                                                color = if (isVisible) StudioColors.PrimaryContainer else StudioColors.SurfaceContainerHigh,
                                                modifier = Modifier
                                                    .width(88.dp)
                                                    .height(92.dp)
                                                    .clip(RoundedCornerShape(16.dp))
                                                    .border(
                                                        width = if (isSelected) 2.dp else 0.dp,
                                                        color = if (isSelected) StudioColors.Primary else Color.Transparent,
                                                        shape = RoundedCornerShape(16.dp)
                                                    )
                                                    .clickable { viewModel.toggleAttachWardrobeAsset(asset.id) }
                                            ) {
                                                Column(
                                                    horizontalAlignment = Alignment.CenterHorizontally,
                                                    modifier = Modifier.padding(6.dp)
                                                ) {
                                                    Box(
                                                        modifier = Modifier
                                                            .size(46.dp)
                                                            .clip(RoundedCornerShape(10.dp))
                                                            .background(StudioColors.SurfaceContainerLowest),
                                                        contentAlignment = Alignment.Center
                                                    ) {
                                                        if (bmp != null) {
                                                            Image(
                                                                bitmap = bmp.asImageBitmap(),
                                                                contentDescription = asset.name,
                                                                contentScale = ContentScale.Fit,
                                                                modifier = Modifier.fillMaxSize().padding(4.dp)
                                                            )
                                                        }
                                                    }
                                                    Spacer(Modifier.height(4.dp))
                                                    Text(asset.name, color = Color.White, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                                                    Text(
                                                        if (isVisible) "Wearing" else asset.category.label,
                                                        color = if (isVisible) StudioColors.Tertiary else StudioColors.TextMuted,
                                                        fontSize = 10.sp
                                                    )
                                                }
                                            }
                                        }
                                    }

                                    Row(
                                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("Fabric", color = StudioColors.TextMuted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                        FabricType.entries.forEach { fabric ->
                                            val sel = clothConfig.fabricType == fabric
                                            StudioFilterChip(
                                                label = fabric.label,
                                                selected = sel,
                                                onClick = {
                                                    viewModel.clothConfig = clothConfig.copy(
                                                        fabricType = fabric,
                                                        gravity = fabric.defaultGravity,
                                                        damping = fabric.damping
                                                    )
                                                }
                                            )
                                        }
                                    }
                                }

                                val selectedLayer = viewModel.fittedLayers.find { it.assetId == viewModel.selectedWardrobeId && it.visible }
                                val selectedAsset = selectedLayer?.let { l -> wardrobeAssets.find { it.id == l.assetId } }
                                if (selectedLayer != null && selectedAsset != null) {
                                    StudioSectionCard {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Text("Fit · ${selectedAsset.name}", color = StudioColors.Secondary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                            StudioFilterChip(
                                                label = "Reset",
                                                selected = false,
                                                icon = Icons.Default.RestartAlt,
                                                onClick = {
                                                    viewModel.resetActiveLayerTransform()
                                                    clothMeshes.remove(selectedAsset.id)
                                                }
                                            )
                                        }
                                        StudioSliderRow(
                                            label = "Size",
                                            valueText = "${(selectedLayer.scale * 100f).roundToInt()}%",
                                            value = selectedLayer.scale,
                                            onValueChange = { viewModel.updateActiveLayerScale(exactScale = it) },
                                            valueRange = 0.40f..1.80f
                                        )
                                        if (selectedAsset.category == WardrobeCategory.CLOTHING) {
                                            StudioSliderRow(
                                                label = "Length",
                                                valueText = "${(selectedLayer.lengthScale * 100f).roundToInt()}%",
                                                value = selectedLayer.lengthScale,
                                                onValueChange = { viewModel.updateActiveLayerLength(it) },
                                                valueRange = 0.70f..1.45f,
                                                accentColor = StudioColors.Secondary
                                            )
                                        }
                                        StudioSliderRow(
                                            label = "Tilt",
                                            valueText = "${selectedLayer.rotation.roundToInt()}°",
                                            value = selectedLayer.rotation,
                                            onValueChange = { viewModel.updateActiveLayerRotation(it) },
                                            valueRange = -35f..35f
                                        )
                                    }
                                }
                            } else {
                                StudioSectionCard {
                                    Row(
                                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        MotionPreset.entries.forEach { preset ->
                                            StudioFilterChip(
                                                label = preset.label,
                                                selected = clothConfig.preset == preset,
                                                onClick = { viewModel.clothConfig = clothConfig.copy(preset = preset, isSimulating = true) }
                                            )
                                        }
                                    }

                                    StudioSliderRow(
                                        label = "Gravity",
                                        valueText = "${String.format("%.2f", clothConfig.gravity)}G",
                                        value = clothConfig.gravity,
                                        onValueChange = { viewModel.clothConfig = clothConfig.copy(gravity = it) },
                                        valueRange = 0.1f..2.0f,
                                        accentColor = StudioColors.Warning
                                    )
                                    StudioSliderRow(
                                        label = "Wind Force",
                                        valueText = "${String.format("%+.1f", clothConfig.windStrength)} m/s",
                                        value = clothConfig.windStrength,
                                        onValueChange = { viewModel.clothConfig = clothConfig.copy(windStrength = it) },
                                        valueRange = -8f..8f,
                                        accentColor = StudioColors.Secondary
                                    )

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            StudioFilterChip(
                                                label = "Lattice",
                                                selected = clothConfig.showWireframe,
                                                onClick = { viewModel.clothConfig = clothConfig.copy(showWireframe = !clothConfig.showWireframe) }
                                            )
                                            StudioFilterChip(
                                                label = "Stress Map",
                                                selected = clothConfig.showStressHeatmap,
                                                selectedContainerColor = StudioColors.DangerContainer,
                                                selectedContentColor = StudioColors.Danger,
                                                onClick = { viewModel.clothConfig = clothConfig.copy(showStressHeatmap = !clothConfig.showStressHeatmap) }
                                            )
                                        }
                                        StudioTonalActionButton(
                                            label = "Reset",
                                            icon = Icons.Default.RestartAlt,
                                            onClick = { clothMeshes.clear() },
                                            iconTint = StudioColors.Warning
                                        )
                                    }
                                }
                            }
                        }
                        HorizontalDivider(color = StudioColors.SurfaceContainerHighest, thickness = 1.dp)
                    }

                    // Bottom Tool Rail
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StudioBottomToolItem(
                            label = "Wardrobe",
                            icon = Icons.Default.Checkroom,
                            selected = isDeckExpanded && activeDeckTab == 0,
                            onClick = {
                                if (isDeckExpanded && activeDeckTab == 0) isDeckExpanded = false
                                else {
                                    activeDeckTab = 0
                                    isDeckExpanded = true
                                }
                            },
                            modifier = Modifier.weight(1f)
                        )
                        StudioBottomToolItem(
                            label = "Cloth Physics",
                            icon = Icons.Default.Waves,
                            selected = isDeckExpanded && activeDeckTab == 1,
                            onClick = {
                                if (isDeckExpanded && activeDeckTab == 1) isDeckExpanded = false
                                else {
                                    activeDeckTab = 1
                                    isDeckExpanded = true
                                }
                            },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }
        }
    }
}
