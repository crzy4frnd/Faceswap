package com.facemorph.studio.ui

import android.graphics.Bitmap
import android.os.SystemClock
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
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
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
import com.facemorph.studio.model.ExpressionAlignMode
import com.facemorph.studio.model.FaceAdjustments
import com.facemorph.studio.viewmodel.StudioViewModel
import java.io.File
import kotlinx.coroutines.delay
import kotlin.math.hypot
import kotlin.math.min

@Composable
fun FaceStudioScreen(viewModel: StudioViewModel) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val targetBmp = viewModel.targetBitmap
    val faces = viewModel.detectedFaces
    val adj = viewModel.adjustments
    val segmentedLayers = viewModel.segmentedTargetLayers
    val profileCache = viewModel.profileBitmapCache.toMap()
    val metricsCache = viewModel.profileMetricsCache.toMap()
    val angleBitmapCache = viewModel.angleBitmapCache.toMap()
    val angleCutoutCache = viewModel.angleCutoutCache.toMap()
    val angleMetricsCache = viewModel.angleMetricsCache.toMap()
    val targetThumbCache = viewModel.targetFaceThumbCache.toMap()

    var activeDeckTab by remember { mutableIntStateOf(0) } // 0=Faces, 1=Blend, 2=Cutout, 3=Light, 4=Align
    var isDeckExpanded by remember { mutableStateOf(false) }
    var showToolsMenu by remember { mutableStateOf(false) }
    var showSwapProfileMenu by remember { mutableStateOf(false) }
    var dismissedFlipHintKey by remember { mutableStateOf<String?>(null) }
    var isPeekingOriginal by remember { mutableStateOf(false) }
    var isPeekingExpression by remember { mutableStateOf(false) }
    var highlightFaceId by remember { mutableStateOf<String?>(null) }
    var highlightFaceNonce by remember { mutableIntStateOf(0) }
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
    val isMagicTap = viewModel.cutoutMagicTapMode
    val isFullScreen = viewModel.isFullScreenEditor

    val latestTargetBmp by rememberUpdatedState(targetBmp)
    val latestZoom by rememberUpdatedState(viewportZoom)
    val latestPan by rememberUpdatedState(viewportPan)
    val latestSamplingMode by rememberUpdatedState(isSamplingSkin)
    val latestCutoutMode by rememberUpdatedState(isCutoutBrush)
    val latestMagicTapMode by rememberUpdatedState(isMagicTap)
    val latestShowMesh by rememberUpdatedState(adj.showGeometricMesh)
    val latestFaces by rememberUpdatedState(faces)
    val latestSelectedFaceId by rememberUpdatedState(viewModel.selectedFaceId)

    var pendingTargetCameraFile by remember { mutableStateOf<File?>(null) }
    var pendingFaceCameraFile by remember { mutableStateOf<File?>(null) }

    LaunchedEffect(viewModel.activeTargetId, targetBmp) {
        viewportZoom = 1f
        viewportPan = Offset.Zero
        if (targetBmp != null && viewModel.faceProfiles.isEmpty()) {
            activeDeckTab = 0
            isDeckExpanded = true
        }
    }
    LaunchedEffect(highlightFaceNonce) {
        if (highlightFaceNonce > 0) {
            delay(1350L)
            highlightFaceId = null
        }
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

    val faceGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isNotEmpty()) {
            val targetId = viewModel.pendingAngleTargetProfileId
            viewModel.pendingAngleTargetProfileId = null
            if (!targetId.isNullOrBlank() && viewModel.faceProfiles.any { it.id == targetId }) {
                viewModel.addMultipleAnglesToProfileFromUris(targetId, uris)
            } else {
                viewModel.createFaceProfileFromUris(uris)
            }
        }
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

    val effectiveAdj = if (isPeekingExpression) {
        if (adj.expressionAlignEnabled) {
            adj.copy(expressionAlignEnabled = false, keepTargetMouthInterior = false)
        } else {
            adj.copy(expressionAlignEnabled = true)
        }
    } else {
        adj
    }
    val selFaceKey = viewModel.selectedFaceId ?: faces.firstOrNull()?.id
    val effectivePerFaceAdjustments = if (selFaceKey != null) {
        viewModel.perFaceAdjustments + (selFaceKey to effectiveAdj)
    } else {
        viewModel.perFaceAdjustments
    }

    val renderedBitmap: Bitmap? = remember(
        targetBmp,
        faces,
        profileCache,
        metricsCache,
        angleBitmapCache,
        angleMetricsCache,
        effectiveAdj,
        effectivePerFaceAdjustments,
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
                adjustments = effectiveAdj,
                splitPercent = if (viewModel.splitCompareEnabled) viewModel.splitComparePercent else null,
                protectionMask = viewModel.cutoutProtectionMask,
                segmentedLayers = viewModel.segmentedTargetLayers,
                angleBitmaps = angleBitmapCache,
                angleMetrics = angleMetricsCache,
                perFaceAdjustments = effectivePerFaceAdjustments
            )
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(StudioColors.Background)
    ) {
        // Edge-to-Edge Full-Screen Photo Viewport
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clipToBounds()
                .background(StudioColors.SurfaceContainerLowest),
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
                                val downUptime = SystemClock.uptimeMillis()
                                val canHoldPeek = !latestCutoutMode && !latestSamplingMode && !latestShowMesh
                                val peekHoldMs = 310L
                                var isMultiTouch = false
                                var tapCandidate = true
                                var strokeBegun = false
                                var peekActivated = false
                                var prevCentroid: Offset? = null
                                var prevSpan = 0f
                                var prevSinglePos = downPos

                                while (true) {
                                    val event = if (canHoldPeek && tapCandidate && !isMultiTouch && !peekActivated) {
                                        val elapsed = SystemClock.uptimeMillis() - downUptime
                                        val remaining = (peekHoldMs - elapsed).coerceAtLeast(1L)
                                        val ev = withTimeoutOrNull(remaining) { awaitPointerEvent() }
                                        if (ev == null) {
                                            peekActivated = true
                                            tapCandidate = false
                                            isPeekingOriginal = true
                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                            continue
                                        }
                                        ev
                                    } else {
                                        awaitPointerEvent()
                                    }
                                    val pressed = event.changes.filter { it.pressed }

                                    if (pressed.isEmpty()) {
                                        lastBrushImgPos = null
                                        brushCursorImgPos = null
                                        isPeekingOriginal = false
                                        if (tapCandidate && !isMultiTouch && !peekActivated) {
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
                                                    if (latestMagicTapMode) {
                                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                        viewModel.magicSelectCutoutAt(imgPt.x, imgPt.y)
                                                    } else {
                                                        viewModel.beginCutoutStroke()
                                                        viewModel.paintCutoutStrokeSegment(imgPt.x, imgPt.y, imgPt.x, imgPt.y)
                                                    }
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
                                                    if (latestFaces.size > 1) {
                                                        val imgPt = screenToImagePos(downPos, size.width.toFloat(), size.height.toFloat())
                                                        if (imgPt != null) {
                                                            val hit = latestFaces
                                                                .filter { f ->
                                                                    val padX = (f.boxRight - f.boxLeft) * 0.14f
                                                                    val padY = (f.boxBottom - f.boxTop) * 0.14f
                                                                    imgPt.x in (f.boxLeft - padX)..(f.boxRight + padX) &&
                                                                        imgPt.y in (f.boxTop - padY)..(f.boxBottom + padY)
                                                                }
                                                                .minByOrNull { f ->
                                                                    val fcx = (f.boxLeft + f.boxRight) * 0.5f
                                                                    val fcy = (f.boxTop + f.boxBottom) * 0.5f
                                                                    hypot((imgPt.x - fcx).toDouble(), (imgPt.y - fcy).toDouble())
                                                                }
                                                            if (hit != null) {
                                                                viewModel.selectTargetFace(hit.id)
                                                                highlightFaceId = hit.id
                                                                highlightFaceNonce++
                                                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        break
                                    }

                                    if (pressed.size >= 2) {
                                        isMultiTouch = true
                                        tapCandidate = false
                                        isPeekingOriginal = false
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

                                        if (peekActivated) {
                                            ch.consume()
                                        } else if (latestCutoutMode) {
                                            val imgPt = screenToImagePos(pos, size.width.toFloat(), size.height.toFloat())
                                            if (imgPt != null) {
                                                if (!latestMagicTapMode) {
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
                                                }
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
                    val displayFrame = if (isPeekingOriginal && targetBmp != null) targetBmp else renderedBitmap
                    val bw = displayFrame.width.toFloat()
                    val bh = displayFrame.height.toFloat()
                    val baseScale = min(size.width / bw, size.height / bh)
                    val scale = baseScale * viewportZoom
                    val drawW = bw * scale
                    val drawH = bh * scale
                    val left = (size.width - drawW) / 2f + viewportPan.x
                    val top = (size.height - drawH) / 2f + viewportPan.y

                    drawImage(
                        image = displayFrame.asImageBitmap(),
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
                        if (isMagicTap) {
                            drawCircle(
                                color = Color(0xFFA78BFA),
                                radius = 16f,
                                center = Offset(cxScreen, cyScreen),
                                style = Stroke(width = 2.5f)
                            )
                        } else {
                            val radiusScreen = (viewModel.cutoutBrushSizePx * scale).coerceAtLeast(8f)
                            drawCircle(
                                color = if (viewModel.cutoutBrushProtect) Color(0xFFF43F5E) else Color(0xFF22D3EE),
                                radius = radiusScreen,
                                center = Offset(cxScreen, cyScreen),
                                style = Stroke(width = 2.5f)
                            )
                        }
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

                    val activeHighlight = highlightFaceId?.let { id -> faces.find { it.id == id } }
                    if (activeHighlight != null && faces.size > 1) {
                        val fl = left + activeHighlight.boxLeft * scale
                        val ft = top + activeHighlight.boxTop * scale
                        val fr = left + activeHighlight.boxRight * scale
                        val fb = top + activeHighlight.boxBottom * scale
                        val corner = ((fr - fl).coerceAtLeast(24f) * 0.22f).coerceIn(10f, 26f)
                        val bracketColor = StudioColors.Secondary
                        val strokeW = 3.2f
                        drawLine(bracketColor, Offset(fl, ft), Offset(fl + corner, ft), strokeWidth = strokeW)
                        drawLine(bracketColor, Offset(fl, ft), Offset(fl, ft + corner), strokeWidth = strokeW)
                        drawLine(bracketColor, Offset(fr, ft), Offset(fr - corner, ft), strokeWidth = strokeW)
                        drawLine(bracketColor, Offset(fr, ft), Offset(fr, ft + corner), strokeWidth = strokeW)
                        drawLine(bracketColor, Offset(fl, fb), Offset(fl + corner, fb), strokeWidth = strokeW)
                        drawLine(bracketColor, Offset(fl, fb), Offset(fl, fb - corner), strokeWidth = strokeW)
                        drawLine(bracketColor, Offset(fr, fb), Offset(fr - corner, fb), strokeWidth = strokeW)
                        drawLine(bracketColor, Offset(fr, fb), Offset(fr, fb - corner), strokeWidth = strokeW)
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
                                color = StudioColors.SurfaceContainerLowest,
                                radius = patchRadiusPx,
                                center = Offset(px, py),
                                style = Stroke(width = 4.5f)
                            )
                            drawCircle(
                                color = if (isSamplingSkin) StudioColors.Warning else Color.White,
                                radius = patchRadiusPx,
                                center = Offset(px, py),
                                style = Stroke(width = 2.2f)
                            )
                            drawLine(Color.White, Offset(px - 6f, py), Offset(px + 6f, py), strokeWidth = 1.8f)
                            drawLine(Color.White, Offset(px, py - 6f), Offset(px, py + 6f), strokeWidth = 1.8f)
                            if (isSamplingSkin) {
                                val loupeY = (py - patchRadiusPx - 26f).coerceAtLeast(top + 20f)
                                drawCircle(color = StudioColors.SurfaceContainerLowest, radius = 15f, center = Offset(px, loupeY))
                                drawCircle(color = sampledColor, radius = 12f, center = Offset(px, loupeY))
                                drawCircle(
                                    color = StudioColors.Warning,
                                    radius = 12f,
                                    center = Offset(px, loupeY),
                                    style = Stroke(width = 2f)
                                )
                            }
                        }
                    }
                }
            } else {
                // Clean Material 3 Empty State Card
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
                            Icon(
                                Icons.Default.AddPhotoAlternate,
                                contentDescription = null,
                                tint = StudioColors.Primary,
                                modifier = Modifier.size(30.dp)
                            )
                        }
                        Text(
                            "Load a Photo to Edit",
                            color = StudioColors.TextPrimary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "Pick a photo from Gallery or capture one with Camera, then tap any saved profile to swap.",
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
                                onClick = { targetGalleryPicker.launch("image/*") },
                                containerColor = StudioColors.PrimaryContainer,
                                contentColor = StudioColors.OnPrimaryContainer,
                                iconTint = StudioColors.Primary,
                                modifier = Modifier.weight(1f)
                            )
                            StudioTonalActionButton(
                                label = "Camera",
                                icon = Icons.Default.CameraAlt,
                                onClick = { launchTargetCamera() },
                                containerColor = StudioColors.SecondaryContainer,
                                contentColor = StudioColors.OnSecondaryContainer,
                                iconTint = StudioColors.Secondary,
                                modifier = Modifier.weight(1f)
                            )
                        }
                        StudioTonalActionButton(
                            label = if (activeSwapProfile != null) {
                                "Swap Profile: ${activeSwapProfile.name} (${viewModel.faceProfiles.size})"
                            } else {
                                "Manage Face Profiles (${viewModel.faceProfiles.size})"
                            },
                            icon = Icons.Default.Face,
                            onClick = { viewModel.showFaceProfileManager = true },
                            containerColor = StudioColors.SurfaceContainerHigh,
                            contentColor = StudioColors.TextPrimary,
                            iconTint = StudioColors.Primary,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            // Floating Material 3 Top Action Bar (Hidden in Fullscreen Mode)
            androidx.compose.animation.AnimatedVisibility(
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
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Active Swap Profile Selector Pill
                    Box(modifier = Modifier.weight(1f, fill = false)) {
                        val activeCutout = activeSwapProfile?.let { viewModel.getCutoutThumbForProfile(it.id) }
                        Surface(
                            shape = CircleShape,
                            color = StudioColors.FloatingGlass,
                            shadowElevation = 6.dp,
                            modifier = Modifier
                                .height(40.dp)
                                .clickable { showSwapProfileMenu = true }
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(start = 6.dp, end = 10.dp)
                            ) {
                                if (activeCutout != null) {
                                    Image(
                                        bitmap = activeCutout.asImageBitmap(),
                                        contentDescription = null,
                                        contentScale = ContentScale.Fit,
                                        modifier = Modifier
                                            .size(28.dp)
                                            .clip(CircleShape)
                                            .background(StudioColors.SurfaceContainerHigh)
                                    )
                                } else {
                                    Box(
                                        modifier = Modifier
                                            .size(28.dp)
                                            .clip(CircleShape)
                                            .background(StudioColors.PrimaryContainer),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(
                                            Icons.Default.Face,
                                            contentDescription = null,
                                            tint = StudioColors.OnPrimaryContainer,
                                            modifier = Modifier.size(16.dp)
                                        )
                                    }
                                }
                                Spacer(Modifier.width(7.dp))
                                Text(
                                    text = activeSwapProfile?.name ?: "Faces (${viewModel.faceProfiles.size})",
                                    color = StudioColors.TextPrimary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                if (viewModel.isScanningProfileMatch) {
                                    Spacer(Modifier.width(5.dp))
                                    Text(
                                        "...",
                                        color = StudioColors.Secondary,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                } else if (activeSwapProfile != null && activeSwapProfile.angles.isNotEmpty() && activeTargetMatchPct in 96..100) {
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        "${activeTargetMatchPct}%",
                                        color = StudioColors.Tertiary,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                Spacer(Modifier.width(2.dp))
                                Icon(
                                    Icons.Default.ExpandMore,
                                    contentDescription = "Choose Profile",
                                    tint = StudioColors.TextSecondary,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }

                        DropdownMenu(
                            expanded = showSwapProfileMenu,
                            onDismissRequest = { showSwapProfileMenu = false },
                            containerColor = StudioColors.SurfaceContainer
                        ) {
                            if (viewModel.faceProfiles.isEmpty()) {
                                DropdownMenuItem(
                                    text = { Text("Create Face Profile", color = StudioColors.Primary, fontWeight = FontWeight.SemiBold) },
                                    leadingIcon = { Icon(Icons.Default.Face, contentDescription = null, tint = StudioColors.Primary) },
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
                                            Column {
                                                Text(
                                                    profile.name,
                                                    color = if (isChosen) StudioColors.Tertiary else StudioColors.TextPrimary,
                                                    fontSize = 13.sp,
                                                    fontWeight = if (isChosen) FontWeight.Bold else FontWeight.Medium
                                                )
                                                Text(
                                                    "${profile.angles.size} angle${if (profile.angles.size == 1) "" else "s"} saved",
                                                    color = StudioColors.TextMuted,
                                                    fontSize = 11.sp
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
                                                        .size(28.dp)
                                                        .clip(CircleShape)
                                                        .background(StudioColors.SurfaceContainerHigh)
                                                )
                                            } else {
                                                Icon(Icons.Default.Face, contentDescription = null, tint = StudioColors.Primary)
                                            }
                                        },
                                        trailingIcon = {
                                            if (isChosen && activeTargetMatchPct in 96..100) {
                                                Text("${activeTargetMatchPct}%", color = StudioColors.Tertiary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                            }
                                        },
                                        onClick = {
                                            showSwapProfileMenu = false
                                            viewModel.scanAndSelectProfileForSwap(profile.id)
                                        }
                                    )
                                }
                                HorizontalDivider(color = StudioColors.OutlineVariant)
                                DropdownMenuItem(
                                    text = { Text("Manage All Profiles", color = StudioColors.Primary, fontWeight = FontWeight.SemiBold) },
                                    leadingIcon = { Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = StudioColors.Secondary) },
                                    onClick = {
                                        showSwapProfileMenu = false
                                        viewModel.showFaceProfileManager = true
                                    }
                                )
                            }
                        }
                    }

                    Spacer(Modifier.width(8.dp))

                    // Right Action Cluster: Gallery, Camera, Fullscreen, Menu, Save
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StudioFloatingIconButton(
                            icon = Icons.Default.PhotoLibrary,
                            contentDescription = "Open Gallery",
                            onClick = { targetGalleryPicker.launch("image/*") },
                            iconTint = StudioColors.Primary,
                            size = 40.dp
                        )
                        StudioFloatingIconButton(
                            icon = Icons.Default.CameraAlt,
                            contentDescription = "Take Photo",
                            onClick = { launchTargetCamera() },
                            iconTint = StudioColors.Secondary,
                            size = 40.dp
                        )
                        if (renderedBitmap != null) {
                            StudioFloatingIconButton(
                                icon = Icons.Default.Fullscreen,
                                contentDescription = "Full Screen Editor",
                                onClick = { viewModel.isFullScreenEditor = true },
                                iconTint = StudioColors.TextPrimary,
                                size = 40.dp
                            )
                        }

                        Box {
                            StudioFloatingIconButton(
                                icon = Icons.Default.MoreVert,
                                contentDescription = "More Tools",
                                onClick = { showToolsMenu = true },
                                iconTint = StudioColors.TextPrimary,
                                size = 40.dp
                            )
                            DropdownMenu(
                                expanded = showToolsMenu,
                                onDismissRequest = { showToolsMenu = false },
                                containerColor = StudioColors.SurfaceContainer
                            ) {
                                DropdownMenuItem(
                                    text = { Text("Rescan Faces", color = StudioColors.TextPrimary) },
                                    leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null, tint = StudioColors.Primary) },
                                    enabled = renderedBitmap != null,
                                    onClick = {
                                        showToolsMenu = false
                                        viewModel.rescanTargetFaces()
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text(if (adj.showGeometricMesh) "Hide Landmark Mesh" else "Landmark Mesh", color = StudioColors.TextPrimary) },
                                    leadingIcon = { Icon(Icons.Default.GridOn, contentDescription = null, tint = StudioColors.Secondary) },
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
                                    text = { Text(if (isCutoutBrush) "Done Cutout Brush" else "Cutout / Hair Brush", color = StudioColors.TextPrimary) },
                                    leadingIcon = { Icon(Icons.Default.ContentCut, contentDescription = null, tint = StudioColors.Danger) },
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
                                    text = { Text(if (isSamplingSkin) "Done Skin Sample" else "Sample Skin Patch", color = StudioColors.TextPrimary) },
                                    leadingIcon = { Icon(Icons.Default.Colorize, contentDescription = null, tint = StudioColors.Warning) },
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
                                    text = {
                                        Text(
                                            if (adj.preserveTargetLayers) "Layer Cutouts: ON (${segmentedLayers?.summary?.totalLayerCount ?: 2})"
                                            else "Layer Cutouts: OFF",
                                            color = StudioColors.TextPrimary
                                        )
                                    },
                                    leadingIcon = { Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = StudioColors.Tertiary) },
                                    enabled = renderedBitmap != null,
                                    onClick = {
                                        showToolsMenu = false
                                        viewModel.adjustments = adj.copy(preserveTargetLayers = !adj.preserveTargetLayers)
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("Reset Adjustments", color = StudioColors.TextPrimary) },
                                    leadingIcon = { Icon(Icons.Default.RestartAlt, contentDescription = null, tint = StudioColors.Warning) },
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
                                        text = { Text("Clear Photo", color = StudioColors.Danger) },
                                        leadingIcon = { Icon(Icons.Default.Close, contentDescription = null, tint = StudioColors.Danger) },
                                        onClick = {
                                            showToolsMenu = false
                                            viewModel.clearTargetPhoto()
                                        }
                                    )
                                }
                            }
                        }

                        if (renderedBitmap != null) {
                            Button(
                                onClick = { viewModel.exportBitmapToGallery(renderedBitmap, "FaceSwap") },
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

            // Minimal Full-Screen Floating Bar (visible ONLY in Fullscreen mode)
            androidx.compose.animation.AnimatedVisibility(
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
                    if (renderedBitmap != null) {
                        // Hold-to-Compare Eye
                        Surface(
                            shape = CircleShape,
                            color = if (isPeekingOriginal) StudioColors.PrimaryContainer else StudioColors.FloatingGlass,
                            shadowElevation = 6.dp,
                            modifier = Modifier
                                .size(42.dp)
                                .pointerInput(Unit) {
                                    awaitEachGesture {
                                        awaitFirstDown(requireUnconsumed = false)
                                        isPeekingOriginal = true
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        try {
                                            while (true) {
                                                val ev = awaitPointerEvent()
                                                if (ev.changes.none { it.pressed }) break
                                            }
                                        } finally {
                                            isPeekingOriginal = false
                                        }
                                    }
                                }
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Default.Visibility,
                                    contentDescription = "Hold to Compare Original",
                                    tint = if (isPeekingOriginal) Color.White else StudioColors.TextPrimary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }

                        Button(
                            onClick = { viewModel.exportBitmapToGallery(renderedBitmap, "FaceSwap") },
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

            // Floating ORIGINAL / Before-After Peek Badge
            androidx.compose.animation.AnimatedVisibility(
                visible = isPeekingOriginal,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = 60.dp)
            ) {
                Surface(
                    shape = CircleShape,
                    color = StudioColors.FloatingGlass,
                    shadowElevation = 6.dp
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp)
                    ) {
                        Icon(Icons.Default.Visibility, contentDescription = null, tint = StudioColors.Secondary, modifier = Modifier.size(15.dp))
                        Text("ORIGINAL PHOTO", color = StudioColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            // Zoom Reset Pill (Top-Start under floating bar when zoomed)
            if (renderedBitmap != null && viewportZoom > 1.04f) {
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

            // Right-Edge Quick-Action Rail (Only visible when photo loaded & not fullscreen)
            val canvasFace = viewModel.getSelectedOrPrimaryFace()
            if (renderedBitmap != null && !isFullScreen) {
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(end = 12.dp, bottom = 12.dp),
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Auto-Flip Suggestion Prompt
                    if (canvasFace != null && canvasFace.assignedProfileId != null) {
                        val flipped = canvasFace.angleMatchFlipped
                        val flipSuggestDir = viewModel.getFlipSuggestionDirection(canvasFace)
                        val flipHintKey = "${canvasFace.id}:${canvasFace.assignedAngleId}:$flipped"
                        AnimatedVisibility(
                            visible = flipSuggestDir != null && dismissedFlipHintKey != flipHintKey,
                            enter = fadeIn(),
                            exit = fadeOut()
                        ) {
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = StudioColors.WarningContainer,
                                shadowElevation = 6.dp,
                                modifier = Modifier.clickable { viewModel.toggleSelectedFaceFlip() }
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.Flip, contentDescription = null, tint = StudioColors.Warning, modifier = Modifier.size(15.dp))
                                    Text(
                                        "Mirror for ${flipSuggestDir ?: ""}",
                                        color = Color(0xFFFEF3C7),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Icon(
                                        Icons.Default.Close,
                                        contentDescription = "Dismiss hint",
                                        tint = StudioColors.TextSecondary,
                                        modifier = Modifier
                                            .size(15.dp)
                                            .clickable { dismissedFlipHintKey = flipHintKey }
                                    )
                                }
                            }
                        }

                        StudioFloatingIconButton(
                            icon = Icons.Default.Flip,
                            contentDescription = "Flip Face Left or Right",
                            onClick = { viewModel.toggleSelectedFaceFlip() },
                            active = flipped || flipSuggestDir != null,
                            activeContainerColor = if (flipSuggestDir != null) StudioColors.WarningContainer else StudioColors.PrimaryContainer,
                            activeContentColor = if (flipSuggestDir != null) StudioColors.Warning else Color.White,
                            badgeDotColor = if (flipSuggestDir != null) StudioColors.Warning else null,
                            size = 42.dp
                        )
                    }

                    // Hold-to-Compare Eye
                    Surface(
                        shape = CircleShape,
                        color = if (isPeekingOriginal) StudioColors.PrimaryContainer else StudioColors.FloatingGlass,
                        shadowElevation = 6.dp,
                        modifier = Modifier
                            .size(42.dp)
                            .pointerInput(Unit) {
                                awaitEachGesture {
                                    awaitFirstDown(requireUnconsumed = false)
                                    isPeekingOriginal = true
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    try {
                                        while (true) {
                                            val ev = awaitPointerEvent()
                                            if (ev.changes.none { it.pressed }) break
                                        }
                                    } finally {
                                        isPeekingOriginal = false
                                    }
                                }
                            }
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Default.Visibility,
                                contentDescription = "Hold to Peek Original",
                                tint = if (isPeekingOriginal) Color.White else StudioColors.TextPrimary,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }

                    StudioFloatingIconButton(
                        icon = Icons.Default.Compare,
                        contentDescription = "Split Compare",
                        onClick = { viewModel.splitCompareEnabled = !viewModel.splitCompareEnabled },
                        active = viewModel.splitCompareEnabled,
                        activeContainerColor = StudioColors.PrimaryContainer,
                        size = 42.dp
                    )
                }
            }

            // Floating Brush / Skin Sample Status Bar (Bottom-Start when active)
            if ((isCutoutBrush || isSamplingSkin) && renderedBitmap != null) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = StudioColors.FloatingGlass,
                    shadowElevation = 6.dp,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 12.dp, bottom = 12.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (isCutoutBrush) {
                            Icon(
                                if (isMagicTap) Icons.Default.AutoAwesome else Icons.Default.Brush,
                                contentDescription = null,
                                tint = if (isMagicTap) StudioColors.Primary else StudioColors.Danger,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                when {
                                    isMagicTap -> "Magic Tap"
                                    viewModel.cutoutBrushProtect -> "Protect Brush"
                                    else -> "Restore Brush"
                                },
                                color = StudioColors.TextPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            if (viewModel.canUndoCutoutMask) {
                                Text(
                                    "Undo",
                                    color = StudioColors.Secondary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(StudioColors.SurfaceContainerHigh)
                                        .clickable { viewModel.undoCutoutStroke() }
                                        .padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                            Text(
                                "Done",
                                color = StudioColors.OnPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(StudioColors.Tertiary)
                                    .clickable {
                                        viewModel.isCutoutBrushMode = false
                                        viewModel.cutoutMagicTapMode = false
                                    }
                                    .padding(horizontal = 10.dp, vertical = 4.dp)
                            )
                        } else if (isSamplingSkin) {
                            Icon(Icons.Default.Colorize, contentDescription = null, tint = StudioColors.Warning, modifier = Modifier.size(16.dp))
                            Text("Tap Skin Tone", color = StudioColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            if (adj.manualSkinPatch != null) {
                                Text(
                                    "Clear",
                                    color = StudioColors.Danger,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(StudioColors.SurfaceContainerHigh)
                                        .clickable { viewModel.clearManualSkinPatch() }
                                        .padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                            Text(
                                "Done",
                                color = StudioColors.OnPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(StudioColors.Warning)
                                    .clickable { viewModel.isSkinSamplingMode = false }
                                    .padding(horizontal = 10.dp, vertical = 4.dp)
                            )
                        }
                    }
                }
            }

            // Floating Landmark Nudge Pad (only when Geometric Mesh is active)
            if (adj.showGeometricMesh && faces.isNotEmpty() && !isFullScreen) {
                val selId = viewModel.selectedFaceId ?: faces.first().id
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = StudioColors.FloatingGlass,
                    shadowElevation = 6.dp,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 12.dp, bottom = 12.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            activeLandmarkKey.uppercase(),
                            color = StudioColors.Secondary,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 6.dp)
                        )
                        IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, -3f, 0f) }, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Default.KeyboardArrowLeft, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 0f, -3f) }, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Default.KeyboardArrowUp, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 0f, 3f) }, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Default.KeyboardArrowDown, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        IconButton(onClick = { viewModel.nudgeFaceLandmark(selId, activeLandmarkKey, 3f, 0f) }, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Default.KeyboardArrowRight, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        IconButton(onClick = { viewModel.resetFaceLandmarks(selId) }, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Default.RestartAlt, contentDescription = "Reset Landmarks", tint = StudioColors.Warning, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }

        // Native Android Material 3 Expandable Bottom Sheet + 5-Tool Rail
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
                        StudioSheetDragHandle(
                            modifier = Modifier.clickable { isDeckExpanded = false }
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 2.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            val title = when (activeDeckTab) {
                                0 -> "Faces & Profiles"
                                1 -> "Skin & Color Blend"
                                2 -> "Precision Cutout & Layers"
                                3 -> "3D Studio Lighting"
                                else -> "Align & Expression"
                            }
                            Text(
                                text = title,
                                color = StudioColors.TextPrimary,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                            IconButton(
                                onClick = { isDeckExpanded = false },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    Icons.Default.ExpandMore,
                                    contentDescription = "Collapse Panel",
                                    tint = StudioColors.TextSecondary,
                                    modifier = Modifier.size(20.dp)
                                )
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
                            when (activeDeckTab) {
                                0 -> {
                                    // Top Quick Add Buttons
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        StudioTonalActionButton(
                                            label = "Gallery",
                                            icon = Icons.Default.PhotoLibrary,
                                            onClick = {
                                                viewModel.pendingAngleTargetProfileId = null
                                                faceGalleryPicker.launch("image/*")
                                            },
                                            containerColor = StudioColors.PrimaryContainer,
                                            contentColor = StudioColors.OnPrimaryContainer,
                                            iconTint = StudioColors.Primary,
                                            modifier = Modifier.weight(1f)
                                        )
                                        StudioTonalActionButton(
                                            label = "Camera",
                                            icon = Icons.Default.CameraAlt,
                                            onClick = {
                                                viewModel.pendingAngleTargetProfileId = null
                                                launchFaceCamera()
                                            },
                                            containerColor = StudioColors.SecondaryContainer,
                                            contentColor = StudioColors.OnSecondaryContainer,
                                            iconTint = StudioColors.Secondary,
                                            modifier = Modifier.weight(1f)
                                        )
                                        StudioTonalActionButton(
                                            label = "Vault (${viewModel.faceProfiles.size})",
                                            icon = Icons.Default.Face,
                                            onClick = { viewModel.showFaceProfileManager = true },
                                            containerColor = StudioColors.SurfaceContainerHigh,
                                            contentColor = StudioColors.TextPrimary,
                                            iconTint = StudioColors.Primary,
                                            modifier = Modifier.weight(1f)
                                        )
                                    }

                                    if (viewModel.faceProfiles.isEmpty()) {
                                        StudioSectionCard {
                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                                            ) {
                                                Text(
                                                    "No saved face profiles yet. Pick a face from Gallery/Camera or save a face from this photo.",
                                                    color = StudioColors.TextSecondary,
                                                    fontSize = 12.sp,
                                                    modifier = Modifier.weight(1f)
                                                )
                                                if (targetBmp != null && faces.isNotEmpty()) {
                                                    StudioTonalActionButton(
                                                        label = "Save Face",
                                                        icon = Icons.Default.Face,
                                                        onClick = {
                                                            val selId = viewModel.selectedFaceId ?: faces.first().id
                                                            viewModel.saveTargetFaceToProfile(selId, null)
                                                        },
                                                        containerColor = StudioColors.TertiaryContainer,
                                                        contentColor = StudioColors.OnTertiaryContainer,
                                                        iconTint = StudioColors.Tertiary
                                                    )
                                                }
                                            }
                                        }
                                    } else {
                                        StudioSectionCard {
                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Text(
                                                    text = "Swap Profile · ${activeSwapProfile?.name ?: "Select"}",
                                                    color = StudioColors.TextPrimary,
                                                    fontSize = 13.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                    modifier = Modifier.weight(1f)
                                                )
                                                if (viewModel.isScanningProfileMatch) {
                                                    Text("Scanning...", color = StudioColors.Secondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                                } else if (activeSwapProfile != null && activeSwapProfile.angles.isNotEmpty() && activeTargetMatchPct in 96..100) {
                                                    Text(
                                                        "${activeTargetMatchPct}% Match",
                                                        color = StudioColors.Tertiary,
                                                        fontSize = 11.sp,
                                                        fontWeight = FontWeight.Bold,
                                                        modifier = Modifier
                                                            .clip(RoundedCornerShape(8.dp))
                                                            .background(StudioColors.TertiaryContainer)
                                                            .padding(horizontal = 8.dp, vertical = 3.dp)
                                                    )
                                                }
                                            }

                                            // Cutout Face Profile Avatars
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .horizontalScroll(rememberScrollState()),
                                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                viewModel.faceProfiles.forEach { profile ->
                                                    val isSelected = viewModel.activeProfileId == profile.id
                                                    val primaryAngleId = profile.selectedAngleId ?: profile.angles.firstOrNull()?.id
                                                    val cutoutBmp = primaryAngleId?.let { angleCutoutCache[it] ?: angleBitmapCache[it] }
                                                        ?: profileCache[profile.id]
                                                    Column(
                                                        horizontalAlignment = Alignment.CenterHorizontally,
                                                        modifier = Modifier
                                                            .width(64.dp)
                                                            .clip(RoundedCornerShape(14.dp))
                                                            .clickable { viewModel.scanAndSelectProfileForSwap(profile.id) }
                                                    ) {
                                                        Box(
                                                            modifier = Modifier
                                                                .size(58.dp)
                                                                .clip(RoundedCornerShape(14.dp))
                                                                .border(
                                                                    width = if (isSelected) 2.2.dp else 1.dp,
                                                                    color = if (isSelected) StudioColors.Primary else StudioColors.OutlineVariant,
                                                                    shape = RoundedCornerShape(14.dp)
                                                                )
                                                                .background(if (isSelected) StudioColors.PrimaryContainer else StudioColors.SurfaceContainerHigh)
                                                        ) {
                                                            if (cutoutBmp != null) {
                                                                Image(
                                                                    bitmap = cutoutBmp.asImageBitmap(),
                                                                    contentDescription = profile.name,
                                                                    contentScale = ContentScale.Fit,
                                                                    modifier = Modifier.fillMaxSize().padding(3.dp)
                                                                )
                                                            }
                                                            Box(
                                                                modifier = Modifier
                                                                    .align(Alignment.TopEnd)
                                                                    .padding(2.dp)
                                                                    .size(18.dp)
                                                                    .clip(CircleShape)
                                                                    .background(StudioColors.FloatingGlass)
                                                                    .clickable { viewModel.removeFaceProfile(profile.id) },
                                                                contentAlignment = Alignment.Center
                                                            ) {
                                                                Icon(Icons.Default.Close, contentDescription = "Remove profile", tint = Color.White, modifier = Modifier.size(11.dp))
                                                            }
                                                            if (profile.angles.size > 1) {
                                                                Text(
                                                                    "${profile.angles.size}",
                                                                    color = Color.White,
                                                                    fontSize = 9.sp,
                                                                    fontWeight = FontWeight.Bold,
                                                                    modifier = Modifier
                                                                        .align(Alignment.BottomEnd)
                                                                        .padding(3.dp)
                                                                        .clip(RoundedCornerShape(5.dp))
                                                                        .background(StudioColors.FloatingGlass)
                                                                        .padding(horizontal = 4.dp, vertical = 1.dp)
                                                                )
                                                            }
                                                        }
                                                        Spacer(Modifier.height(3.dp))
                                                        Text(
                                                            profile.name,
                                                            color = if (isSelected) StudioColors.Primary else StudioColors.TextSecondary,
                                                            fontSize = 10.sp,
                                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                                            maxLines = 1,
                                                            overflow = TextOverflow.Ellipsis
                                                        )
                                                    }
                                                }
                                            }

                                            // Multi-Angle Strip & +Angle / Save Face Actions
                                            val activeProf = viewModel.faceProfiles.find { it.id == viewModel.activeProfileId }
                                                ?: viewModel.faceProfiles.firstOrNull()
                                            if (activeProf != null) {
                                                Row(
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .horizontalScroll(rememberScrollState()),
                                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    activeProf.angles.forEach { angle ->
                                                        val isAngleSel = activeProf.selectedAngleId == angle.id
                                                        val aBmp = angleCutoutCache[angle.id] ?: angleBitmapCache[angle.id]
                                                        Box(
                                                            modifier = Modifier
                                                                .size(44.dp)
                                                                .clip(CircleShape)
                                                                .background(StudioColors.SurfaceContainerHigh)
                                                                .border(
                                                                    width = if (isAngleSel) 2.2.dp else 1.dp,
                                                                    color = if (isAngleSel) StudioColors.Secondary else StudioColors.OutlineVariant,
                                                                    shape = CircleShape
                                                                )
                                                                .clickable { viewModel.selectProfileAngle(activeProf.id, angle.id) }
                                                        ) {
                                                            if (aBmp != null) {
                                                                Image(
                                                                    bitmap = aBmp.asImageBitmap(),
                                                                    contentDescription = null,
                                                                    contentScale = ContentScale.Fit,
                                                                    modifier = Modifier.fillMaxSize().padding(3.dp)
                                                                )
                                                            }
                                                        }
                                                    }

                                                    StudioFilterChip(
                                                        label = "+ Angle",
                                                        selected = false,
                                                        icon = Icons.Default.AddPhotoAlternate,
                                                        onClick = {
                                                            viewModel.pendingAngleTargetProfileId = activeProf.id
                                                            faceGalleryPicker.launch("image/*")
                                                        }
                                                    )
                                                    StudioFilterChip(
                                                        label = "+ Cam",
                                                        selected = false,
                                                        icon = Icons.Default.AddAPhoto,
                                                        onClick = {
                                                            viewModel.pendingAngleTargetProfileId = activeProf.id
                                                            launchFaceCamera()
                                                        }
                                                    )
                                                    if (targetBmp != null && faces.isNotEmpty()) {
                                                        var showSaveFaceMenu by remember { mutableStateOf(false) }
                                                        val selFaceId = viewModel.selectedFaceId ?: faces.first().id
                                                        Box {
                                                            StudioFilterChip(
                                                                label = "Save Face",
                                                                selected = true,
                                                                icon = Icons.Default.Face,
                                                                selectedContainerColor = StudioColors.SecondaryContainer,
                                                                selectedContentColor = StudioColors.OnSecondaryContainer,
                                                                onClick = { showSaveFaceMenu = true }
                                                            )
                                                            DropdownMenu(
                                                                expanded = showSaveFaceMenu,
                                                                onDismissRequest = { showSaveFaceMenu = false },
                                                                containerColor = StudioColors.SurfaceContainer
                                                            ) {
                                                                DropdownMenuItem(
                                                                    text = { Text("Add Angle -> ${activeProf.name}", color = StudioColors.TextPrimary) },
                                                                    onClick = {
                                                                        showSaveFaceMenu = false
                                                                        viewModel.saveTargetFaceToProfile(selFaceId, activeProf.id)
                                                                    }
                                                                )
                                                                DropdownMenuItem(
                                                                    text = { Text("Save as New Profile", color = StudioColors.TextPrimary) },
                                                                    onClick = {
                                                                        showSaveFaceMenu = false
                                                                        viewModel.saveTargetFaceToProfile(selFaceId, null)
                                                                    }
                                                                )
                                                            }
                                                        }
                                                    }
                                                    if (faces.isNotEmpty() && activeProf.angles.size > 1) {
                                                        StudioFilterChip(
                                                            label = "Match",
                                                            selected = true,
                                                            icon = Icons.Default.AutoAwesome,
                                                            selectedContainerColor = StudioColors.TertiaryContainer,
                                                            selectedContentColor = StudioColors.OnTertiaryContainer,
                                                            onClick = { viewModel.autoMatchAllTargetFaces() }
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    if (faces.size > 1) {
                                        val selFace = faces.find { it.id == viewModel.selectedFaceId } ?: faces.first()
                                        val swappedCount = faces.count { it.enabled && it.assignedProfileId != null }
                                        StudioSectionCard {
                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Text(
                                                    "Group People ($swappedCount/${faces.size})",
                                                    color = StudioColors.TextPrimary,
                                                    fontSize = 13.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    modifier = Modifier.weight(1f)
                                                )
                                                Row(
                                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    StudioFilterChip(
                                                        label = if (viewModel.groupSwapApplyAll) "Mode: All" else "Mode: Sel",
                                                        selected = true,
                                                        selectedContainerColor = if (viewModel.groupSwapApplyAll) StudioColors.TertiaryContainer else StudioColors.PrimaryContainer,
                                                        selectedContentColor = if (viewModel.groupSwapApplyAll) StudioColors.OnTertiaryContainer else StudioColors.OnPrimaryContainer,
                                                        onClick = { viewModel.setGroupSwapApplyAll(!viewModel.groupSwapApplyAll) }
                                                    )
                                                    if (selFace.assignedProfileId != null) {
                                                        StudioFilterChip(
                                                            label = "Keep Orig",
                                                            selected = true,
                                                            selectedContainerColor = StudioColors.DangerContainer,
                                                            selectedContentColor = StudioColors.Danger,
                                                            onClick = { viewModel.clearSelectedFaceSwap() }
                                                        )
                                                    }
                                                    if (swappedCount > 1) {
                                                        StudioFilterChip(
                                                            label = "Sync",
                                                            selected = true,
                                                            selectedContainerColor = StudioColors.SecondaryContainer,
                                                            selectedContentColor = StudioColors.OnSecondaryContainer,
                                                            onClick = { viewModel.syncAdjustmentsToAllFaces() }
                                                        )
                                                    }
                                                }
                                            }

                                            Row(
                                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                faces.forEachIndexed { idx, f ->
                                                    val isSel = viewModel.selectedFaceId == f.id
                                                    val isSwapped = f.enabled && f.assignedProfileId != null
                                                    val targetThumb = targetThumbCache[f.id]
                                                    val donorCutout = if (isSwapped) {
                                                        (f.assignedAngleId?.let { angleCutoutCache[it] ?: angleBitmapCache[it] })
                                                            ?: f.assignedProfileId?.let { profileCache[it] }
                                                    } else null
                                                    Box(
                                                        modifier = Modifier
                                                            .size(54.dp)
                                                            .clip(RoundedCornerShape(12.dp))
                                                            .background(StudioColors.SurfaceContainerHigh)
                                                            .border(
                                                                width = if (isSel) 2.2.dp else 1.dp,
                                                                color = when {
                                                                    isSel -> StudioColors.Secondary
                                                                    isSwapped -> StudioColors.Tertiary
                                                                    else -> StudioColors.OutlineVariant
                                                                },
                                                                shape = RoundedCornerShape(12.dp)
                                                            )
                                                            .clickable {
                                                                if (isSel) {
                                                                    viewModel.toggleFaceEnabled(f.id)
                                                                } else {
                                                                    viewModel.selectTargetFace(f.id)
                                                                    highlightFaceId = f.id
                                                                    highlightFaceNonce++
                                                                }
                                                            }
                                                    ) {
                                                        if (targetThumb != null) {
                                                            Image(
                                                                bitmap = targetThumb.asImageBitmap(),
                                                                contentDescription = "Person ${idx + 1}",
                                                                contentScale = ContentScale.Crop,
                                                                modifier = Modifier.fillMaxSize()
                                                            )
                                                        }
                                                        Text(
                                                            "#${idx + 1}",
                                                            color = Color.White,
                                                            fontSize = 9.sp,
                                                            fontWeight = FontWeight.Bold,
                                                            modifier = Modifier
                                                                .align(Alignment.TopStart)
                                                                .padding(3.dp)
                                                                .clip(RoundedCornerShape(5.dp))
                                                                .background(StudioColors.FloatingGlass)
                                                                .padding(horizontal = 4.dp, vertical = 1.dp)
                                                        )
                                                        if (donorCutout != null) {
                                                            Image(
                                                                bitmap = donorCutout.asImageBitmap(),
                                                                contentDescription = "Paired face",
                                                                contentScale = ContentScale.Fit,
                                                                modifier = Modifier
                                                                    .align(Alignment.BottomEnd)
                                                                    .padding(3.dp)
                                                                    .size(22.dp)
                                                                    .clip(CircleShape)
                                                                    .background(StudioColors.TertiaryContainer)
                                                                    .border(1.dp, StudioColors.Tertiary, CircleShape)
                                                            )
                                                        } else {
                                                            Text(
                                                                "Orig",
                                                                color = StudioColors.TextPrimary,
                                                                fontSize = 8.sp,
                                                                fontWeight = FontWeight.Bold,
                                                                modifier = Modifier
                                                                    .align(Alignment.BottomEnd)
                                                                    .padding(3.dp)
                                                                    .clip(RoundedCornerShape(5.dp))
                                                                    .background(StudioColors.FloatingGlass)
                                                                    .padding(horizontal = 4.dp, vertical = 1.dp)
                                                            )
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    if (viewModel.splitCompareEnabled) {
                                        StudioSectionCard {
                                            StudioSliderRow(
                                                label = "Before / After Split",
                                                valueText = "${viewModel.splitComparePercent.toInt()}%",
                                                value = viewModel.splitComparePercent,
                                                onValueChange = { viewModel.splitComparePercent = it },
                                                valueRange = 5f..95f,
                                                accentColor = StudioColors.Secondary
                                            )
                                        }
                                    }
                                }

                                1 -> {
                                    StudioSectionCard {
                                        StudioSliderRow(
                                            label = "Swap Opacity",
                                            valueText = "${adj.swapStrength}%",
                                            value = adj.swapStrength.toFloat(),
                                            onValueChange = { viewModel.adjustments = adj.copy(swapStrength = it.toInt()) },
                                            valueRange = 0f..100f
                                        )
                                        StudioSliderRow(
                                            label = "Edge Feather",
                                            valueText = "${adj.featherRadius}px",
                                            value = adj.featherRadius.toFloat(),
                                            onValueChange = { viewModel.adjustments = adj.copy(featherRadius = it.toInt()) },
                                            valueRange = 8f..45f,
                                            accentColor = StudioColors.Secondary
                                        )
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .horizontalScroll(rememberScrollState()),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            StudioFilterChip(
                                                label = "Skin Match",
                                                selected = adj.skinToneMatch,
                                                onClick = { viewModel.adjustments = adj.copy(skinToneMatch = !adj.skinToneMatch) }
                                            )
                                            StudioFilterChip(
                                                label = "Smart Edge",
                                                selected = adj.smartBlend,
                                                selectedContainerColor = StudioColors.SecondaryContainer,
                                                selectedContentColor = StudioColors.OnSecondaryContainer,
                                                onClick = { viewModel.adjustments = adj.copy(smartBlend = !adj.smartBlend) }
                                            )
                                            StudioFilterChip(
                                                label = "${segmentedLayers?.summary?.totalLayerCount ?: 2}-Layer Cut",
                                                selected = adj.preserveTargetLayers,
                                                selectedContainerColor = StudioColors.TertiaryContainer,
                                                selectedContentColor = StudioColors.OnTertiaryContainer,
                                                onClick = { viewModel.adjustments = adj.copy(preserveTargetLayers = !adj.preserveTargetLayers) }
                                            )
                                        }
                                    }

                                    StudioSectionCard {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                                        ) {
                                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                                StudioSliderRow(
                                                    label = "Brightness",
                                                    valueText = "${adj.brightness.toInt()}",
                                                    value = adj.brightness,
                                                    onValueChange = { viewModel.adjustments = adj.copy(brightness = it) },
                                                    valueRange = -40f..40f
                                                )
                                                StudioSliderRow(
                                                    label = "Saturation",
                                                    valueText = "${adj.saturation.toInt()}",
                                                    value = adj.saturation,
                                                    onValueChange = { viewModel.adjustments = adj.copy(saturation = it) },
                                                    valueRange = -40f..40f
                                                )
                                            }
                                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                                StudioSliderRow(
                                                    label = "Contrast",
                                                    valueText = "${adj.contrast.toInt()}",
                                                    value = adj.contrast,
                                                    onValueChange = { viewModel.adjustments = adj.copy(contrast = it) },
                                                    valueRange = -35f..60f
                                                )
                                                StudioSliderRow(
                                                    label = "Warmth",
                                                    valueText = "${adj.warmth.toInt()}",
                                                    value = adj.warmth,
                                                    onValueChange = { viewModel.adjustments = adj.copy(warmth = it) },
                                                    valueRange = -30f..30f,
                                                    accentColor = StudioColors.Warning
                                                )
                                            }
                                        }
                                        StudioSliderRow(
                                            label = "Forehead Tone Blend",
                                            valueText = "${adj.foreheadToneHarmonize}%",
                                            value = adj.foreheadToneHarmonize.toFloat(),
                                            onValueChange = { viewModel.adjustments = adj.copy(foreheadToneHarmonize = it.toInt()) },
                                            valueRange = 0f..100f,
                                            accentColor = StudioColors.Tertiary
                                        )
                                        StudioSliderRow(
                                            label = "Skin Grain Match",
                                            valueText = "${adj.skinTextureMatch}%",
                                            value = adj.skinTextureMatch.toFloat(),
                                            onValueChange = { viewModel.adjustments = adj.copy(skinTextureMatch = it.toInt()) },
                                            valueRange = 0f..100f,
                                            accentColor = StudioColors.Secondary
                                        )
                                    }

                                    if (renderedBitmap != null) {
                                        val manualPatch = adj.manualSkinPatch
                                        StudioSectionCard {
                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Row(verticalAlignment = Alignment.CenterVertically) {
                                                    if (manualPatch != null) {
                                                        Box(
                                                            modifier = Modifier
                                                                .size(20.dp)
                                                                .clip(CircleShape)
                                                                .background(
                                                                    Color(
                                                                        (manualPatch.sampledRed / 255f).coerceIn(0f, 1f),
                                                                        (manualPatch.sampledGreen / 255f).coerceIn(0f, 1f),
                                                                        (manualPatch.sampledBlue / 255f).coerceIn(0f, 1f)
                                                                    )
                                                                )
                                                                .border(1.5.dp, Color.White, CircleShape)
                                                        )
                                                    } else {
                                                        Icon(Icons.Default.Colorize, contentDescription = null, tint = StudioColors.TextSecondary, modifier = Modifier.size(18.dp))
                                                    }
                                                    Spacer(Modifier.width(8.dp))
                                                    Text(
                                                        if (manualPatch != null) "Skin Ref: Target Patch" else "Skin Ref: Auto Face",
                                                        color = StudioColors.TextPrimary,
                                                        fontSize = 13.sp,
                                                        fontWeight = FontWeight.SemiBold
                                                    )
                                                }
                                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                    if (manualPatch != null) {
                                                        StudioFilterChip(
                                                            label = "Auto",
                                                            selected = false,
                                                            onClick = { viewModel.clearManualSkinPatch() }
                                                        )
                                                    }
                                                    StudioFilterChip(
                                                        label = if (isSamplingSkin) "Done" else "Sample Skin",
                                                        selected = isSamplingSkin,
                                                        selectedContainerColor = StudioColors.WarningContainer,
                                                        selectedContentColor = StudioColors.Warning,
                                                        onClick = {
                                                            val nextSample = !isSamplingSkin
                                                            if (nextSample) {
                                                                viewModel.isCutoutBrushMode = false
                                                                viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                                            }
                                                            viewModel.isSkinSamplingMode = nextSample
                                                        }
                                                    )
                                                }
                                            }
                                            if (manualPatch != null) {
                                                StudioSliderRow(
                                                    label = "Sample Patch Size",
                                                    valueText = "${(manualPatch.radiusRatio * 1000).toInt()}",
                                                    value = manualPatch.radiusRatio,
                                                    onValueChange = { viewModel.updateSkinSampleRadius(it) },
                                                    valueRange = 0.014f..0.075f,
                                                    accentColor = StudioColors.Warning
                                                )
                                            }
                                        }
                                    }
                                }

                                2 -> {
                                    StudioSectionCard {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            StudioFilterChip(
                                                label = "Protect",
                                                selected = isCutoutBrush && !isMagicTap && viewModel.cutoutBrushProtect,
                                                icon = Icons.Default.Brush,
                                                selectedContainerColor = StudioColors.DangerContainer,
                                                selectedContentColor = StudioColors.Danger,
                                                modifier = Modifier.weight(1f),
                                                onClick = {
                                                    viewModel.isSkinSamplingMode = false
                                                    viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                                    viewModel.cutoutMagicTapMode = false
                                                    viewModel.cutoutBrushProtect = true
                                                    viewModel.isCutoutBrushMode = true
                                                }
                                            )
                                            StudioFilterChip(
                                                label = "Restore",
                                                selected = isCutoutBrush && !isMagicTap && !viewModel.cutoutBrushProtect,
                                                icon = Icons.Default.ContentCut,
                                                selectedContainerColor = StudioColors.SecondaryContainer,
                                                selectedContentColor = StudioColors.OnSecondaryContainer,
                                                modifier = Modifier.weight(1f),
                                                onClick = {
                                                    viewModel.isSkinSamplingMode = false
                                                    viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                                    viewModel.cutoutMagicTapMode = false
                                                    viewModel.cutoutBrushProtect = false
                                                    viewModel.isCutoutBrushMode = true
                                                }
                                            )
                                            StudioFilterChip(
                                                label = "Magic Tap",
                                                selected = isCutoutBrush && isMagicTap,
                                                icon = Icons.Default.AutoAwesome,
                                                selectedContainerColor = StudioColors.PrimaryContainer,
                                                selectedContentColor = StudioColors.OnPrimaryContainer,
                                                modifier = Modifier.weight(1f),
                                                onClick = {
                                                    viewModel.isSkinSamplingMode = false
                                                    viewModel.adjustments = adj.copy(showGeometricMesh = false)
                                                    viewModel.cutoutMagicTapMode = true
                                                    viewModel.isCutoutBrushMode = true
                                                }
                                            )
                                        }

                                        if (isCutoutBrush && isMagicTap) {
                                            StudioSliderRow(
                                                label = "Magic Tap Tolerance",
                                                valueText = "${viewModel.cutoutMagicTolerance.toInt()}",
                                                value = viewModel.cutoutMagicTolerance,
                                                onValueChange = { viewModel.cutoutMagicTolerance = it },
                                                valueRange = 10f..90f
                                            )
                                            Text(
                                                "Tap any hair strand, earring, tikka, or hand on the photo to extract a layer.",
                                                color = StudioColors.Primary,
                                                fontSize = 11.sp
                                            )
                                        } else {
                                            StudioSliderRow(
                                                label = "Brush Size",
                                                valueText = "${viewModel.cutoutBrushSizePx.toInt()}px",
                                                value = viewModel.cutoutBrushSizePx,
                                                onValueChange = { viewModel.cutoutBrushSizePx = it },
                                                valueRange = 10f..90f,
                                                accentColor = StudioColors.Danger
                                            )
                                            StudioSliderRow(
                                                label = "Brush Hardness",
                                                valueText = "${viewModel.cutoutBrushHardness.toInt()}%",
                                                value = viewModel.cutoutBrushHardness,
                                                onValueChange = { viewModel.cutoutBrushHardness = it },
                                                valueRange = 10f..100f,
                                                accentColor = StudioColors.Danger
                                            )
                                        }

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                                        ) {
                                            val shiftPct = (adj.foreheadCutShift * 100).toInt()
                                            Box(modifier = Modifier.weight(1f)) {
                                                StudioSliderRow(
                                                    label = "Forehead Cut",
                                                    valueText = "${if (shiftPct > 0) "+" else ""}$shiftPct%",
                                                    value = adj.foreheadCutShift,
                                                    onValueChange = { viewModel.adjustments = adj.copy(foreheadCutShift = it) },
                                                    onValueChangeFinished = { viewModel.resegmentTargetLayers(silent = true) },
                                                    valueRange = -0.14f..0.14f,
                                                    accentColor = StudioColors.Tertiary
                                                )
                                            }
                                            Box(modifier = Modifier.weight(1f)) {
                                                StudioSliderRow(
                                                    label = "Edge Softness",
                                                    valueText = "${(adj.foreheadSoftness * 100).toInt()}%",
                                                    value = adj.foreheadSoftness,
                                                    onValueChange = { viewModel.adjustments = adj.copy(foreheadSoftness = it) },
                                                    onValueChangeFinished = { viewModel.resegmentTargetLayers(silent = true) },
                                                    valueRange = 0.15f..1.0f,
                                                    accentColor = StudioColors.Tertiary
                                                )
                                            }
                                        }
                                    }

                                    StudioSectionCard {
                                        Text(
                                            text = segmentedLayers?.summary?.decisionNote ?: "Adaptive Object Cutout Layers",
                                            color = StudioColors.TextSecondary,
                                            fontSize = 11.sp,
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
                                            StudioFilterChip(
                                                label = "Bg",
                                                selected = adj.showBackgroundLayer,
                                                onClick = { viewModel.adjustments = adj.copy(showBackgroundLayer = !adj.showBackgroundLayer) }
                                            )
                                            StudioFilterChip(
                                                label = "Face",
                                                selected = adj.showFaceLayer,
                                                onClick = { viewModel.adjustments = adj.copy(showFaceLayer = !adj.showFaceLayer) }
                                            )
                                            StudioFilterChip(
                                                label = "Cutouts (${segmentedLayers?.objectLayers?.size ?: 0})",
                                                selected = adj.showForeLayers && adj.preserveTargetLayers,
                                                selectedContainerColor = StudioColors.TertiaryContainer,
                                                selectedContentColor = StudioColors.OnTertiaryContainer,
                                                onClick = { viewModel.adjustments = adj.copy(showForeLayers = !adj.showForeLayers) }
                                            )
                                            StudioFilterChip(
                                                label = if (viewModel.isSegmentingLayers) "Scanning..." else "Auto-Scan",
                                                selected = viewModel.isSegmentingLayers,
                                                icon = Icons.Default.Refresh,
                                                selectedContainerColor = StudioColors.SecondaryContainer,
                                                selectedContentColor = StudioColors.OnSecondaryContainer,
                                                onClick = {
                                                    if (renderedBitmap != null && !viewModel.isSegmentingLayers) {
                                                        viewModel.resegmentTargetLayers()
                                                    }
                                                }
                                            )
                                        }

                                        val detectedObjects = segmentedLayers?.objectLayers ?: emptyList()
                                        if (detectedObjects.isNotEmpty()) {
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .horizontalScroll(rememberScrollState()),
                                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                                            ) {
                                                detectedObjects.forEach { objLayer ->
                                                    val chipColor = when (objLayer.kind) {
                                                        CutoutLayerKind.FOREHEAD -> StudioColors.TertiaryContainer
                                                        CutoutLayerKind.HAIR -> StudioColors.DangerContainer
                                                        CutoutLayerKind.HAND_FINGER -> StudioColors.WarningContainer
                                                        CutoutLayerKind.ACCESSORY -> StudioColors.SecondaryContainer
                                                        CutoutLayerKind.OBJECT -> StudioColors.PrimaryContainer
                                                    }
                                                    val isVisible = adj.preserveTargetLayers && adj.showForeLayers && (objLayer.id !in adj.hiddenLayerIds)
                                                    StudioFilterChip(
                                                        label = "${objLayer.name} ${objLayer.coveragePct}%",
                                                        selected = isVisible,
                                                        selectedContainerColor = chipColor,
                                                        selectedContentColor = Color.White,
                                                        onClick = { viewModel.toggleCutoutObjectLayer(objLayer.id) }
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
                                            StudioFilterChip(
                                                label = "Hair/Jewel",
                                                selected = adj.autoMaskHair || adj.autoMaskAccessories,
                                                selectedContainerColor = StudioColors.DangerContainer,
                                                selectedContentColor = StudioColors.Danger,
                                                onClick = {
                                                    val enabled = !(adj.autoMaskHair || adj.autoMaskAccessories)
                                                    viewModel.adjustments = adj.copy(autoMaskHair = enabled, autoMaskAccessories = enabled)
                                                    viewModel.resegmentTargetLayers()
                                                }
                                            )
                                            StudioFilterChip(
                                                label = "Hands/Obj",
                                                selected = adj.autoMaskObjects,
                                                selectedContainerColor = StudioColors.WarningContainer,
                                                selectedContentColor = StudioColors.Warning,
                                                onClick = {
                                                    viewModel.adjustments = adj.copy(autoMaskObjects = !adj.autoMaskObjects)
                                                    viewModel.resegmentTargetLayers()
                                                }
                                            )
                                            StudioFilterChip(
                                                label = "Overlay",
                                                selected = viewModel.cutoutShowOverlay,
                                                icon = if (viewModel.cutoutShowOverlay) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                                onClick = { viewModel.cutoutShowOverlay = !viewModel.cutoutShowOverlay }
                                            )
                                            if (viewModel.canUndoCutoutMask) {
                                                StudioFilterChip(
                                                    label = "Undo",
                                                    selected = true,
                                                    icon = Icons.Default.Undo,
                                                    selectedContainerColor = StudioColors.SecondaryContainer,
                                                    selectedContentColor = StudioColors.OnSecondaryContainer,
                                                    onClick = { viewModel.undoCutoutStroke() }
                                                )
                                            }
                                            if (viewModel.cutoutProtectionMask != null) {
                                                StudioFilterChip(
                                                    label = "Clear Mask",
                                                    selected = true,
                                                    selectedContainerColor = StudioColors.DangerContainer,
                                                    selectedContentColor = StudioColors.Danger,
                                                    onClick = { viewModel.clearCutoutMask() }
                                                )
                                            }
                                            if (detectedObjects.any { it.id.startsWith("layer-magic-") }) {
                                                StudioFilterChip(
                                                    label = "Clear Magic",
                                                    selected = false,
                                                    onClick = { viewModel.clearMagicCutouts() }
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
                                    StudioSectionCard {
                                        StudioSliderRow(
                                            label = "Face Scale",
                                            valueText = "${(adj.scale * 100).toInt()}%",
                                            value = adj.scale,
                                            onValueChange = { viewModel.adjustments = adj.copy(scale = it) },
                                            valueRange = 0.75f..1.35f
                                        )
                                        StudioSliderRow(
                                            label = "Head Tilt",
                                            valueText = "${adj.rotation.toInt()}°",
                                            value = adj.rotation,
                                            onValueChange = { viewModel.adjustments = adj.copy(rotation = it) },
                                            valueRange = -25f..25f,
                                            accentColor = StudioColors.Secondary
                                        )
                                    }

                                    StudioSectionCard {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Row(
                                                modifier = Modifier
                                                    .weight(1f)
                                                    .horizontalScroll(rememberScrollState()),
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                StudioFilterChip(
                                                    label = if (adj.expressionAlignEnabled) "Expr: ON" else "Expr: OFF",
                                                    selected = adj.expressionAlignEnabled,
                                                    selectedContainerColor = StudioColors.TertiaryContainer,
                                                    selectedContentColor = StudioColors.OnTertiaryContainer,
                                                    onClick = { viewModel.adjustments = adj.copy(expressionAlignEnabled = !adj.expressionAlignEnabled) }
                                                )
                                                StudioFilterChip(
                                                    label = "Lock Edge",
                                                    selected = adj.expressionMode == ExpressionAlignMode.LOCK_EDGE,
                                                    onClick = { viewModel.adjustments = adj.copy(expressionMode = ExpressionAlignMode.LOCK_EDGE) }
                                                )
                                                StudioFilterChip(
                                                    label = "Contour",
                                                    selected = adj.expressionMode == ExpressionAlignMode.CONTOUR_CAGE,
                                                    selectedContainerColor = StudioColors.SecondaryContainer,
                                                    selectedContentColor = StudioColors.OnSecondaryContainer,
                                                    onClick = { viewModel.adjustments = adj.copy(expressionMode = ExpressionAlignMode.CONTOUR_CAGE) }
                                                )
                                                StudioFilterChip(
                                                    label = "Teeth",
                                                    selected = adj.keepTargetMouthInterior,
                                                    selectedContainerColor = StudioColors.WarningContainer,
                                                    selectedContentColor = StudioColors.Warning,
                                                    onClick = { viewModel.adjustments = adj.copy(keepTargetMouthInterior = !adj.keepTargetMouthInterior) }
                                                )
                                            }

                                            // Hold-to-Peek Expression Preview Eye
                                            Surface(
                                                shape = RoundedCornerShape(12.dp),
                                                color = if (isPeekingExpression) StudioColors.PrimaryContainer else StudioColors.SurfaceContainerHigh,
                                                modifier = Modifier
                                                    .height(38.dp)
                                                    .pointerInput(Unit) {
                                                        awaitEachGesture {
                                                            awaitFirstDown(requireUnconsumed = false)
                                                            isPeekingExpression = true
                                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                            try {
                                                                while (true) {
                                                                    val ev = awaitPointerEvent()
                                                                    if (ev.changes.none { it.pressed }) break
                                                                }
                                                            } finally {
                                                                isPeekingExpression = false
                                                            }
                                                        }
                                                    }
                                            ) {
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    modifier = Modifier.padding(horizontal = 12.dp)
                                                ) {
                                                    Icon(
                                                        Icons.Default.Visibility,
                                                        contentDescription = "Hold to Preview Expression",
                                                        tint = if (isPeekingExpression) Color.White else StudioColors.TextSecondary,
                                                        modifier = Modifier.size(16.dp)
                                                    )
                                                    Spacer(Modifier.width(5.dp))
                                                    Text(
                                                        if (isPeekingExpression) {
                                                            if (adj.expressionAlignEnabled) "Rigid" else adj.expressionMode.label
                                                        } else "Peek",
                                                        color = Color.White,
                                                        fontSize = 12.sp,
                                                        fontWeight = FontWeight.SemiBold
                                                    )
                                                }
                                            }
                                        }

                                        val exprLabel = if (isPeekingExpression) {
                                            if (adj.expressionAlignEnabled) "Peeking Rigid" else "Peeking ${adj.expressionMode.label}"
                                        } else {
                                            "Expression Strength"
                                        }
                                        StudioSliderRow(
                                            label = exprLabel,
                                            valueText = "${adj.expressionAlignStrength}%",
                                            value = adj.expressionAlignStrength.toFloat(),
                                            onValueChange = { viewModel.adjustments = adj.copy(expressionAlignStrength = it.toInt()) },
                                            valueRange = 0f..100f,
                                            accentColor = if (adj.expressionAlignEnabled || isPeekingExpression) StudioColors.Tertiary else StudioColors.TextMuted
                                        )

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            StudioFilterChip(
                                                label = "Landmark Mesh",
                                                selected = adj.showGeometricMesh,
                                                icon = Icons.Default.GridOn,
                                                selectedContainerColor = StudioColors.SecondaryContainer,
                                                selectedContentColor = StudioColors.OnSecondaryContainer,
                                                onClick = {
                                                    val checked = !adj.showGeometricMesh
                                                    if (checked) {
                                                        viewModel.isSkinSamplingMode = false
                                                        viewModel.isCutoutBrushMode = false
                                                    }
                                                    viewModel.adjustments = adj.copy(showGeometricMesh = checked)
                                                }
                                            )
                                            StudioTonalActionButton(
                                                label = "Reset Align",
                                                icon = Icons.Default.RestartAlt,
                                                onClick = {
                                                    viewModel.adjustments = adj.copy(
                                                        scale = 1.0f,
                                                        rotation = 0f,
                                                        offsetX = 0f,
                                                        offsetY = 0f,
                                                        expressionAlignEnabled = false,
                                                        keepTargetMouthInterior = false
                                                    )
                                                },
                                                iconTint = StudioColors.Warning
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        HorizontalDivider(color = StudioColors.SurfaceContainerHighest, thickness = 1.dp)
                    }

                    // Always-Visible Android Google-Photos Style Bottom Tool Rail
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 6.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val toolTabs = listOf(
                            Triple("Faces", Icons.Default.Face, 0),
                            Triple("Blend", Icons.Default.Tune, 1),
                            Triple("Cutout", Icons.Default.ContentCut, 2),
                            Triple("Light", Icons.Default.WbSunny, 3),
                            Triple("Align", Icons.Default.GridOn, 4)
                        )
                        toolTabs.forEach { (label, icon, idx) ->
                            StudioBottomToolItem(
                                label = label,
                                icon = icon,
                                selected = isDeckExpanded && activeDeckTab == idx,
                                onClick = {
                                    if (isDeckExpanded && activeDeckTab == idx) {
                                        isDeckExpanded = false
                                    } else {
                                        activeDeckTab = idx
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
}
