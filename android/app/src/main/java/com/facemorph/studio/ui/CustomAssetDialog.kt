package com.facemorph.studio.ui

import android.graphics.Bitmap
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.RectF
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.ZoomOutMap
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.facemorph.studio.engine.NativeAssetSegmenter
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.FabricType
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.model.WardrobeSubCategory
import com.facemorph.studio.viewmodel.StudioViewModel
import java.io.File
import kotlin.math.hypot
import kotlin.math.min

private enum class CutoutStudioTool(val label: String, val icon: ImageVector) {
    AUTO("Auto", Icons.Default.AutoAwesome),
    RESTORE("Restore", Icons.Default.Brush),
    ERASE("Erase", Icons.Default.ContentCut),
    MAGIC("Magic", Icons.Default.TouchApp),
    PAN("Move/Zoom", Icons.Default.PanTool)
}

private enum class CanvasBackdropMode(val label: String) {
    CHECKER("Checker"),
    DARK("Dark"),
    LIGHT("Light")
}

@Composable
fun CustomAssetDialog(
    viewModel: StudioViewModel,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current

    // Step 1 = Full-Screen Cutout Canvas; Step 2 = Asset Name / Category / Save
    var studioStep by remember { mutableIntStateOf(1) }

    var alignedRawBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var workingBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var activeDraftBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var undoStack by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var redoStack by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var strokeRevision by remember { mutableIntStateOf(0) }

    // Auto cutout settings
    var tolerance by remember { mutableIntStateOf(35) }
    var removeStrayObjects by remember { mutableStateOf(true) }
    var preserveDetails by remember { mutableStateOf(false) }

    // Manual brush & overlay controls
    var activeTool by remember { mutableStateOf(CutoutStudioTool.ERASE) }
    var brushSizePx by remember { mutableFloatStateOf(36f) }
    var brushHardnessPct by remember { mutableFloatStateOf(70f) }
    var overlayOpacityPct by remember { mutableFloatStateOf(42f) }
    var backdropMode by remember { mutableStateOf(CanvasBackdropMode.CHECKER) }

    // Multi-touch viewport transform
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var brushCursorImg by remember { mutableStateOf<Offset?>(null) }
    var lastTapTimeMs by remember { mutableLongStateOf(0L) }
    var lastTapPos by remember { mutableStateOf(Offset.Zero) }

    // Hold-to-Compare original image
    val compareInteraction = remember { MutableInteractionSource() }
    val isComparingOriginal by compareInteraction.collectIsPressedAsState()

    // Step 2 Metadata
    var assetName by remember { mutableStateOf("Custom Jacket") }
    var category by remember { mutableStateOf(WardrobeCategory.CLOTHING) }
    var subCategory by remember { mutableStateOf(WardrobeSubCategory.JACKET) }
    var anchorPoint by remember { mutableStateOf(BodyAnchorPoint.SHOULDERS) }
    var fabricType by remember { mutableStateOf(FabricType.SILK) }

    var pendingCameraFile by remember { mutableStateOf<File?>(null) }

    fun loadNewSourceBitmap(loaded: Bitmap) {
        val aligned = NativeAssetSegmenter.prepareAlignedBitmap(loaded, maxSide = 760)
        val initialCut = NativeAssetSegmenter.extractTransparentAssetUncropped(
            alignedSource = aligned,
            tolerance = tolerance,
            removeExtraneousObjects = removeStrayObjects,
            preserveInnerDetails = preserveDetails
        )
        alignedRawBitmap = aligned
        workingBitmap = initialCut
        activeDraftBitmap = null
        undoStack = emptyList()
        redoStack = emptyList()
        zoom = 1f
        pan = Offset.Zero
        strokeRevision++
    }

    fun pushUndoSnapshot(nextBitmap: Bitmap) {
        workingBitmap?.let { prev ->
            undoStack = (undoStack + prev).takeLast(15)
        }
        redoStack = emptyList()
        workingBitmap = nextBitmap
        strokeRevision++
    }

    fun performUndo() {
        val prev = undoStack.lastOrNull() ?: return
        workingBitmap?.let { cur ->
            redoStack = (redoStack + cur).takeLast(15)
        }
        undoStack = undoStack.dropLast(1)
        workingBitmap = prev
        strokeRevision++
    }

    fun performRedo() {
        val next = redoStack.lastOrNull() ?: return
        workingBitmap?.let { cur ->
            undoStack = (undoStack + cur).takeLast(15)
        }
        redoStack = redoStack.dropLast(1)
        workingBitmap = next
        strokeRevision++
    }

    fun rerunAutoCutout() {
        val raw = alignedRawBitmap ?: return
        val next = NativeAssetSegmenter.extractTransparentAssetUncropped(
            alignedSource = raw,
            tolerance = tolerance,
            removeExtraneousObjects = removeStrayObjects,
            preserveInnerDetails = preserveDetails
        )
        pushUndoSnapshot(next)
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingCameraFile
        if (success && file != null && file.exists()) {
            NativeStorageHelper.loadBitmapFromFile(file.absolutePath, 960)?.let { loaded ->
                loadNewSourceBitmap(loaded)
            }
        }
    }

    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let {
            NativeStorageHelper.loadBitmapFromUri(context, it, 960)?.let { loaded ->
                loadNewSourceBitmap(loaded)
            }
        }
    }

    val rubyOverlayPaint = remember {
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            val matrix = ColorMatrix(
                floatArrayOf(
                    0.55f, 0f, 0f, 0f, 95f,
                    0f, 0.18f, 0f, 0f, 0f,
                    0f, 0f, 0.28f, 0f, 20f,
                    0f, 0f, 0f, 1f, 0f
                )
            )
            colorFilter = ColorMatrixColorFilter(matrix)
        }
    }

    BackHandler {
        if (studioStep == 2) {
            studioStep = 1
        } else {
            onDismiss()
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false
        )
    ) {
        Surface(
            color = Color(0xFF020617),
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            if (studioStep == 2 && workingBitmap != null) {
                val trimmedPreview = remember(workingBitmap, strokeRevision) {
                    workingBitmap?.let { NativeAssetSegmenter.trimTransparentBounds(it) }
                }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0xFF020617))
                ) {
                    // Step 2 Top Bar
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                            .background(Color(0xFF0A0F1E))
                            .padding(horizontal = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { studioStep = 1 }
                                .padding(horizontal = 8.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Back to Edit", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Text("Save Cutout Item", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Default.Close, contentDescription = "Close", tint = Color(0xFF94A3B8))
                        }
                    }
                    HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .verticalScroll(rememberScrollState())
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // Crisp Trimmed Preview Card
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(190.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(Color(0xFF0F172A))
                                .border(1.dp, Color(0xFF334155), RoundedCornerShape(16.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            CheckerboardBackdrop(modifier = Modifier.fillMaxSize())
                            if (trimmedPreview != null) {
                                Image(
                                    bitmap = trimmedPreview.asImageBitmap(),
                                    contentDescription = "Final Cutout",
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(14.dp)
                                )
                            }
                        }

                        OutlinedTextField(
                            value = assetName,
                            onValueChange = { assetName = it },
                            label = { Text("Item Name", fontSize = 12.sp) },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                focusedBorderColor = Color(0xFF6366F1),
                                unfocusedBorderColor = Color(0xFF334155)
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Text("Sub-Category", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState())
                        ) {
                            WardrobeSubCategory.entries.forEach { sub ->
                                FilterChip(
                                    selected = subCategory == sub,
                                    onClick = {
                                        subCategory = sub
                                        category = sub.parentCategory
                                        anchorPoint = when (sub) {
                                            WardrobeSubCategory.WATCH -> BodyAnchorPoint.WRIST
                                            WardrobeSubCategory.NECKLACE -> BodyAnchorPoint.NECK
                                            WardrobeSubCategory.GLASSES, WardrobeSubCategory.HEADWEAR -> BodyAnchorPoint.HEAD
                                            else -> BodyAnchorPoint.SHOULDERS
                                        }
                                    },
                                    label = { Text(sub.label, fontSize = 11.sp) }
                                )
                            }
                        }

                        Text("Category", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState())
                        ) {
                            WardrobeCategory.entries.forEach { cat ->
                                FilterChip(
                                    selected = category == cat,
                                    onClick = {
                                        category = cat
                                        anchorPoint = when (cat) {
                                            WardrobeCategory.CLOTHING -> BodyAnchorPoint.SHOULDERS
                                            WardrobeCategory.JEWELRY -> BodyAnchorPoint.NECK
                                            WardrobeCategory.ACCESSORY -> BodyAnchorPoint.HEAD
                                        }
                                        if (subCategory.parentCategory != cat) {
                                            subCategory = WardrobeSubCategory.entries.first { it.parentCategory == cat }
                                        }
                                    },
                                    label = { Text(cat.label, fontSize = 11.sp) }
                                )
                            }
                        }

                        Text("Body Anchor Point", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState())
                        ) {
                            BodyAnchorPoint.entries.forEach { pt ->
                                FilterChip(
                                    selected = anchorPoint == pt,
                                    onClick = { anchorPoint = pt },
                                    label = { Text(pt.label, fontSize = 11.sp) }
                                )
                            }
                        }

                        if (category == WardrobeCategory.CLOTHING) {
                            Text("Cloth Physics Material", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.horizontalScroll(rememberScrollState())
                            ) {
                                FabricType.entries.forEach { f ->
                                    FilterChip(
                                        selected = fabricType == f,
                                        onClick = { fabricType = f },
                                        label = { Text(f.label, fontSize = 11.sp) }
                                    )
                                }
                            }
                        }
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF0A0F1E))
                            .padding(horizontal = 16.dp, vertical = 12.dp)
                    ) {
                        Button(
                            onClick = {
                                val finalBmp = trimmedPreview ?: workingBitmap ?: return@Button
                                val scale = when (anchorPoint) {
                                    BodyAnchorPoint.SHOULDERS -> 1.0f
                                    BodyAnchorPoint.NECK -> 0.62f
                                    BodyAnchorPoint.WRIST -> 0.38f
                                    BodyAnchorPoint.HEAD -> 0.72f
                                    BodyAnchorPoint.WAIST -> 0.85f
                                }
                                viewModel.addCustomWardrobeAsset(
                                    name = assetName,
                                    transparentBitmap = finalBmp,
                                    category = category,
                                    anchorPoint = anchorPoint,
                                    fabricType = fabricType,
                                    defaultScale = scale,
                                    subCategory = subCategory
                                )
                                onDismiss()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Save to Wardrobe & Try On", fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            } else {
                // Step 1: Full-Screen PicsArt-Style Cutout Canvas Editor
                val displayBitmap = activeDraftBitmap ?: workingBitmap
                val latestAligned by rememberUpdatedState(alignedRawBitmap)
                val latestWorking by rememberUpdatedState(workingBitmap)
                val latestTool by rememberUpdatedState(activeTool)
                val latestBrushSize by rememberUpdatedState(brushSizePx)
                val latestHardness by rememberUpdatedState(brushHardnessPct)
                val latestTolerance by rememberUpdatedState(tolerance)
                val latestZoom by rememberUpdatedState(zoom)
                val latestPan by rememberUpdatedState(pan)

                fun screenToImg(screenPos: Offset, size: IntSize, bmp: Bitmap): Offset {
                    val bw = bmp.width.toFloat()
                    val bh = bmp.height.toFloat()
                    val baseScale = min(size.width.toFloat() / bw, size.height.toFloat() / bh)
                    val scale = baseScale * latestZoom
                    val drawW = bw * scale
                    val drawH = bh * scale
                    val left = (size.width - drawW) * 0.5f + latestPan.x
                    val top = (size.height - drawH) * 0.5f + latestPan.y
                    return Offset(
                        ((screenPos.x - left) / scale).coerceIn(0f, bw - 1f),
                        ((screenPos.y - top) / scale).coerceIn(0f, bh - 1f)
                    )
                }

                fun applyViewportTransform(centroid: Offset, panDelta: Offset, zoomDelta: Float, size: IntSize) {
                    val prevZ = zoom
                    val nextZ = (prevZ * zoomDelta).coerceIn(1f, 8f)
                    val ratio = nextZ / prevZ
                    val cx = size.width * 0.5f
                    val cy = size.height * 0.5f
                    val nx = (centroid.x - cx) - ((centroid.x - cx) - pan.x) * ratio + panDelta.x
                    val ny = (centroid.y - cy) - ((centroid.y - cy) - pan.y) * ratio + panDelta.y
                    zoom = nextZ
                    if (nextZ <= 1.02f) {
                        pan = Offset.Zero
                    } else {
                        val maxX = size.width * (nextZ - 1f) * 0.65f
                        val maxY = size.height * (nextZ - 1f) * 0.65f
                        pan = Offset(nx.coerceIn(-maxX, maxX), ny.coerceIn(-maxY, maxY))
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0xFF020617))
                ) {
                    // Clean Single-Row Top Header
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                            .background(Color(0xFF0A0F1E))
                            .padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = onDismiss) {
                                Icon(Icons.Default.Close, contentDescription = "Close", tint = Color(0xFFCBD5E1))
                            }
                            Text("Cutout Studio", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            IconButton(
                                onClick = { galleryLauncher.launch("image/*") },
                                modifier = Modifier.size(38.dp)
                            ) {
                                Icon(Icons.Default.PhotoLibrary, contentDescription = "Pick Photo", tint = Color(0xFFA5B4FC), modifier = Modifier.size(19.dp))
                            }
                            IconButton(
                                onClick = {
                                    val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "asset")
                                    pendingCameraFile = file
                                    cameraLauncher.launch(uri)
                                },
                                modifier = Modifier.size(38.dp)
                            ) {
                                Icon(Icons.Default.CameraAlt, contentDescription = "Camera", tint = Color(0xFF38BDF8), modifier = Modifier.size(19.dp))
                            }
                            IconButton(
                                onClick = { performUndo() },
                                enabled = undoStack.isNotEmpty(),
                                modifier = Modifier.size(38.dp)
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Undo,
                                    contentDescription = "Undo",
                                    tint = if (undoStack.isNotEmpty()) Color.White else Color(0xFF475569),
                                    modifier = Modifier.size(19.dp)
                                )
                            }
                            IconButton(
                                onClick = { performRedo() },
                                enabled = redoStack.isNotEmpty(),
                                modifier = Modifier.size(38.dp)
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Redo,
                                    contentDescription = "Redo",
                                    tint = if (redoStack.isNotEmpty()) Color.White else Color(0xFF475569),
                                    modifier = Modifier.size(19.dp)
                                )
                            }

                            Button(
                                onClick = { studioStep = 2 },
                                enabled = workingBitmap != null,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF059669),
                                    disabledContainerColor = Color(0xFF1E293B)
                                ),
                                shape = RoundedCornerShape(10.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                                modifier = Modifier.height(34.dp)
                            ) {
                                Text("Next", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.width(4.dp))
                                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(15.dp))
                            }
                        }
                    }
                    HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                    // Huge Unobstructed Cutout Canvas (~75-80% of Screen)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .clipToBounds()
                            .background(Color(0xFF060A13)),
                        contentAlignment = Alignment.Center
                    ) {
                        when (backdropMode) {
                            CanvasBackdropMode.CHECKER -> CheckerboardBackdrop(modifier = Modifier.fillMaxSize())
                            CanvasBackdropMode.DARK -> Box(modifier = Modifier.fillMaxSize().background(Color(0xFF0B1120)))
                            CanvasBackdropMode.LIGHT -> Box(modifier = Modifier.fillMaxSize().background(Color(0xFFF1F5F9)))
                        }

                        if (displayBitmap != null && alignedRawBitmap != null) {
                            Canvas(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .pointerInput(alignedRawBitmap) {
                                        awaitEachGesture {
                                            val firstDown = awaitFirstDown(requireUnconsumed = false)
                                            val downPos = firstDown.position
                                            val downTime = System.currentTimeMillis()
                                            var isMultiTouch = false
                                            var tapCandidate = true
                                            var strokeActive = false
                                            var draftMutable: Bitmap? = null
                                            var lastImgPt: Offset? = null
                                            var prevCentroid: Offset? = null
                                            var prevSpan = 0f
                                            var prevSinglePos = downPos

                                            while (true) {
                                                val event = awaitPointerEvent()
                                                val pressed = event.changes.filter { it.pressed }

                                                if (pressed.isEmpty()) {
                                                    if (strokeActive && draftMutable != null) {
                                                        pushUndoSnapshot(draftMutable!!)
                                                        activeDraftBitmap = null
                                                    } else if (tapCandidate && !isMultiTouch) {
                                                        val raw = latestAligned
                                                        val work = latestWorking
                                                        if (raw != null && work != null) {
                                                            when (latestTool) {
                                                                CutoutStudioTool.RESTORE, CutoutStudioTool.ERASE -> {
                                                                    val pt = screenToImg(downPos, size, work)
                                                                    val copyBmp = work.copy(Bitmap.Config.ARGB_8888, true)
                                                                    copyBmp.setHasAlpha(true)
                                                                    NativeAssetSegmenter.paintBrushSegmentInPlace(
                                                                        targetMutable = copyBmp,
                                                                        alignedRaw = raw,
                                                                        startX = pt.x,
                                                                        startY = pt.y,
                                                                        endX = pt.x,
                                                                        endY = pt.y,
                                                                        radiusPx = latestBrushSize,
                                                                        hardnessPct = latestHardness,
                                                                        isRestore = latestTool == CutoutStudioTool.RESTORE
                                                                    )
                                                                    pushUndoSnapshot(copyBmp)
                                                                }

                                                                CutoutStudioTool.MAGIC -> {
                                                                    val pt = screenToImg(downPos, size, work)
                                                                    val nx = (pt.x / work.width.toFloat()).coerceIn(0f, 1f)
                                                                    val ny = (pt.y / work.height.toFloat()).coerceIn(0f, 1f)
                                                                    val updated = NativeAssetSegmenter.removeConnectedRegionAt(
                                                                        bitmap = work,
                                                                        normX = nx,
                                                                        normY = ny,
                                                                        tolerance = latestTolerance
                                                                    )
                                                                    if (updated !== work) {
                                                                        pushUndoSnapshot(updated)
                                                                    }
                                                                }

                                                                CutoutStudioTool.PAN, CutoutStudioTool.AUTO -> {
                                                                    val dt = downTime - lastTapTimeMs
                                                                    val distPrev = hypot(downPos.x - lastTapPos.x, downPos.y - lastTapPos.y)
                                                                    if (dt in 40L..320L && distPrev < 64f) {
                                                                        if (zoom > 1.15f) {
                                                                            zoom = 1f
                                                                            pan = Offset.Zero
                                                                        } else {
                                                                            val targetZ = 2.6f
                                                                            val cx = size.width * 0.5f
                                                                            val cy = size.height * 0.5f
                                                                            zoom = targetZ
                                                                            pan = Offset(
                                                                                (cx - downPos.x) * (targetZ - 1f) * 0.65f,
                                                                                (cy - downPos.y) * (targetZ - 1f) * 0.65f
                                                                            )
                                                                        }
                                                                        lastTapTimeMs = 0L
                                                                    } else {
                                                                        lastTapTimeMs = downTime
                                                                        lastTapPos = downPos
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                    brushCursorImg = null
                                                    break
                                                }

                                                if (pressed.size >= 2) {
                                                    if (strokeActive && draftMutable != null) {
                                                        pushUndoSnapshot(draftMutable!!)
                                                        activeDraftBitmap = null
                                                        strokeActive = false
                                                        draftMutable = null
                                                    }
                                                    isMultiTouch = true
                                                    tapCandidate = false
                                                    brushCursorImg = null
                                                    val p0 = pressed[0].position
                                                    val p1 = pressed[1].position
                                                    val centroid = Offset((p0.x + p1.x) * 0.5f, (p0.y + p1.y) * 0.5f)
                                                    val span = hypot(p1.x - p0.x, p1.y - p0.y).coerceAtLeast(12f)
                                                    if (prevCentroid != null && prevSpan > 0f) {
                                                        val zoomDelta = (span / prevSpan).coerceIn(0.7f, 1.4f)
                                                        val panDelta = centroid - prevCentroid!!
                                                        applyViewportTransform(centroid, panDelta, zoomDelta, size)
                                                    }
                                                    prevCentroid = centroid
                                                    prevSpan = span
                                                    pressed.forEach { it.consume() }
                                                } else if (!isMultiTouch && pressed.size == 1) {
                                                    val ch = pressed[0]
                                                    val pos = ch.position
                                                    val distMoved = hypot(pos.x - downPos.x, pos.y - downPos.y)
                                                    if (distMoved > 8f) tapCandidate = false

                                                    val raw = latestAligned
                                                    val work = latestWorking
                                                    if (raw != null && work != null) {
                                                        when (latestTool) {
                                                            CutoutStudioTool.PAN -> {
                                                                val delta = pos - prevSinglePos
                                                                applyViewportTransform(pos, delta, 1f, size)
                                                                ch.consume()
                                                            }

                                                            CutoutStudioTool.RESTORE, CutoutStudioTool.ERASE -> {
                                                                val imgPt = screenToImg(pos, size, work)
                                                                if (!strokeActive && distMoved > 4f) {
                                                                    val mutableCopy = work.copy(Bitmap.Config.ARGB_8888, true)
                                                                    mutableCopy.setHasAlpha(true)
                                                                    draftMutable = mutableCopy
                                                                    activeDraftBitmap = mutableCopy
                                                                    strokeActive = true
                                                                    val startPt = screenToImg(downPos, size, work)
                                                                    NativeAssetSegmenter.paintBrushSegmentInPlace(
                                                                        targetMutable = mutableCopy,
                                                                        alignedRaw = raw,
                                                                        startX = startPt.x,
                                                                        startY = startPt.y,
                                                                        endX = imgPt.x,
                                                                        endY = imgPt.y,
                                                                        radiusPx = latestBrushSize,
                                                                        hardnessPct = latestHardness,
                                                                        isRestore = latestTool == CutoutStudioTool.RESTORE
                                                                    )
                                                                    lastImgPt = imgPt
                                                                    strokeRevision++
                                                                } else if (strokeActive && draftMutable != null) {
                                                                    val prevPt = lastImgPt ?: imgPt
                                                                    NativeAssetSegmenter.paintBrushSegmentInPlace(
                                                                        targetMutable = draftMutable!!,
                                                                        alignedRaw = raw,
                                                                        startX = prevPt.x,
                                                                        startY = prevPt.y,
                                                                        endX = imgPt.x,
                                                                        endY = imgPt.y,
                                                                        radiusPx = latestBrushSize,
                                                                        hardnessPct = latestHardness,
                                                                        isRestore = latestTool == CutoutStudioTool.RESTORE
                                                                    )
                                                                    lastImgPt = imgPt
                                                                    strokeRevision++
                                                                }
                                                                brushCursorImg = imgPt
                                                                ch.consume()
                                                            }

                                                            else -> {
                                                                if (zoom > 1.04f && distMoved > 8f) {
                                                                    val delta = pos - prevSinglePos
                                                                    applyViewportTransform(pos, delta, 1f, size)
                                                                    ch.consume()
                                                                }
                                                            }
                                                        }
                                                    }
                                                    prevSinglePos = pos
                                                }
                                            }
                                        }
                                    }
                            ) {
                                val _rev = strokeRevision
                                val raw = alignedRawBitmap!!
                                val activeCut = activeDraftBitmap ?: workingBitmap!!
                                val bw = activeCut.width.toFloat()
                                val bh = activeCut.height.toFloat()
                                val baseScale = min(size.width / bw, size.height / bh)
                                val scale = baseScale * zoom
                                val drawW = bw * scale
                                val drawH = bh * scale
                                val left = (size.width - drawW) * 0.5f + pan.x
                                val top = (size.height - drawH) * 0.5f + pan.y
                                val dstRect = RectF(left, top, left + drawW, top + drawH)

                                drawIntoCanvas { canvas ->
                                    val nc = canvas.nativeCanvas
                                    if (isComparingOriginal) {
                                        nc.drawBitmap(raw, null, dstRect, null)
                                    } else {
                                        if (overlayOpacityPct > 1f) {
                                            rubyOverlayPaint.alpha = ((overlayOpacityPct / 100f) * 255f).toInt().coerceIn(0, 255)
                                            nc.drawBitmap(raw, null, dstRect, rubyOverlayPaint)
                                        }
                                        nc.drawBitmap(activeCut, null, dstRect, null)
                                    }
                                }

                                // Live Fingertip Brush Cursor + Inner Hardness Guide Ring
                                val cursor = brushCursorImg
                                if (cursor != null && (activeTool == CutoutStudioTool.RESTORE || activeTool == CutoutStudioTool.ERASE)) {
                                    val sx = left + cursor.x * scale
                                    val sy = top + cursor.y * scale
                                    val outerR = (brushSizePx * scale).coerceAtLeast(8f)
                                    val innerR = outerR * (brushHardnessPct / 100f).coerceIn(0.05f, 0.98f)
                                    val ringColor = if (activeTool == CutoutStudioTool.RESTORE) Color(0xFF34D399) else Color(0xFFF43F5E)
                                    drawCircle(
                                        color = ringColor,
                                        radius = outerR,
                                        center = Offset(sx, sy),
                                        style = Stroke(width = 2.4f)
                                    )
                                    drawCircle(
                                        color = Color.White.copy(alpha = 0.7f),
                                        radius = innerR,
                                        center = Offset(sx, sy),
                                        style = Stroke(width = 1.2f)
                                    )
                                }
                                // Keep _rev consumed so Compose re-draws when in-place stroke increments
                                if (_rev < 0) drawCircle(Color.Transparent, 0f)
                            }

                            // Minimal Floating Top-Right Canvas Controls (Backdrop, Compare, Reset Zoom)
                            Row(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(10.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (zoom > 1.05f || pan != Offset.Zero) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(Color(0xD90F172A))
                                            .border(1.dp, Color(0xFF0891B2), RoundedCornerShape(10.dp))
                                            .clickable {
                                                zoom = 1f
                                                pan = Offset.Zero
                                            }
                                            .padding(horizontal = 9.dp, vertical = 6.dp)
                                    ) {
                                        Icon(Icons.Default.ZoomOutMap, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("${(zoom * 100).toInt()}% Fit", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                    }
                                }

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color(0xD90F172A))
                                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                                        .clickable {
                                            val all = CanvasBackdropMode.entries
                                            backdropMode = all[(backdropMode.ordinal + 1) % all.size]
                                        }
                                        .padding(horizontal = 9.dp, vertical = 6.dp)
                                ) {
                                    Icon(Icons.Default.Layers, contentDescription = null, tint = Color(0xFF94A3B8), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text(backdropMode.label, color = Color.White, fontSize = 11.sp)
                                }

                                Box(
                                    modifier = Modifier
                                        .size(34.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(if (isComparingOriginal) Color(0xFF4F46E5) else Color(0xD90F172A))
                                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                                        .clickable(interactionSource = compareInteraction, indication = null, onClick = {}),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.Visibility, contentDescription = "Hold to Compare Original", tint = Color.White, modifier = Modifier.size(17.dp))
                                }
                            }
                        } else {
                            // Empty State: Spacious Tap-Friendly Camera / Gallery Card
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(14.dp),
                                modifier = Modifier
                                    .padding(24.dp)
                                    .clip(RoundedCornerShape(20.dp))
                                    .background(Color(0xE60B1120))
                                    .border(1.dp, Color(0xFF334155), RoundedCornerShape(20.dp))
                                    .padding(22.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(56.dp)
                                        .clip(CircleShape)
                                        .background(Color(0xFF1E1B4B)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(28.dp))
                                }
                                Text("Cut Out Clothes or Jewelry", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                Text(
                                    "Pick a photo from Gallery or Camera.\nPinch to zoom up to 8x and refine with Brush, Eraser, Hardness & Overlay.",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 12.sp,
                                    textAlign = TextAlign.Center
                                )
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Button(
                                        onClick = { galleryLauncher.launch("image/*") },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.weight(1f).height(46.dp)
                                    ) {
                                        Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text("Gallery", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "asset")
                                            pendingCameraFile = file
                                            cameraLauncher.launch(uri)
                                        },
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.weight(1f).height(46.dp)
                                    ) {
                                        Icon(Icons.Default.CameraAlt, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text("Camera", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }
                    }

                    // Contextual Tool Settings + Clean Bottom Tool Dock
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF0A0F1E))
                    ) {
                        HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                        if (alignedRawBitmap != null) {
                            when (activeTool) {
                                CutoutStudioTool.RESTORE, CutoutStudioTool.ERASE -> {
                                    val isRestore = activeTool == CutoutStudioTool.RESTORE
                                    val accent = if (isRestore) Color(0xFF10B981) else Color(0xFFF43F5E)
                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 14.dp, vertical = 6.dp),
                                        verticalArrangement = Arrangement.spacedBy(2.dp)
                                    ) {
                                        CompactToolSlider(
                                            label = "Size ${brushSizePx.toInt()}",
                                            value = brushSizePx,
                                            range = 6f..130f,
                                            accent = accent,
                                            onValueChange = { brushSizePx = it }
                                        )
                                        CompactToolSlider(
                                            label = "Hardness ${brushHardnessPct.toInt()}%",
                                            value = brushHardnessPct,
                                            range = 0f..100f,
                                            accent = Color(0xFF38BDF8),
                                            onValueChange = { brushHardnessPct = it }
                                        )
                                        CompactToolSlider(
                                            label = "Overlay ${overlayOpacityPct.toInt()}%",
                                            value = overlayOpacityPct,
                                            range = 0f..85f,
                                            accent = Color(0xFFFB7185),
                                            onValueChange = { overlayOpacityPct = it }
                                        )
                                    }
                                }

                                CutoutStudioTool.AUTO -> {
                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 12.dp, vertical = 6.dp),
                                        verticalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        CompactToolSlider(
                                            label = "BG Cutoff $tolerance",
                                            value = tolerance.toFloat(),
                                            range = 10f..75f,
                                            accent = Color(0xFF22D3EE),
                                            onValueChange = { tolerance = it.toInt() }
                                        )
                                        Row(
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            modifier = Modifier.horizontalScroll(rememberScrollState())
                                        ) {
                                            ActionPill("Apply Auto", Color(0xFF4F46E5), Icons.Default.AutoAwesome) {
                                                rerunAutoCutout()
                                            }
                                            ActionPill(
                                                if (removeStrayObjects) "Strip Stray: ON" else "Strip Stray: OFF",
                                                if (removeStrayObjects) Color(0xFF0891B2) else Color(0xFF1E293B),
                                                null
                                            ) {
                                                removeStrayObjects = !removeStrayObjects
                                                rerunAutoCutout()
                                            }
                                            ActionPill(
                                                if (preserveDetails) "Keep White: ON" else "Keep White: OFF",
                                                if (preserveDetails) Color(0xFF0891B2) else Color(0xFF1E293B),
                                                null
                                            ) {
                                                preserveDetails = !preserveDetails
                                                rerunAutoCutout()
                                            }
                                            ActionPill("Keep All", Color(0xFF059669), Icons.Default.RestartAlt) {
                                                alignedRawBitmap?.let { raw ->
                                                    pushUndoSnapshot(raw.copy(Bitmap.Config.ARGB_8888, false))
                                                }
                                            }
                                            ActionPill("Invert", Color(0xFF334155), Icons.Default.Flip) {
                                                val raw = alignedRawBitmap
                                                val cur = workingBitmap
                                                if (raw != null && cur != null) {
                                                    pushUndoSnapshot(NativeAssetSegmenter.invertCutoutBitmap(raw, cur))
                                                }
                                            }
                                            ActionPill("Clear", Color(0xFF7F1D1D), Icons.Default.DeleteSweep) {
                                                alignedRawBitmap?.let { raw ->
                                                    pushUndoSnapshot(NativeAssetSegmenter.createEmptyCutoutBitmap(raw))
                                                }
                                            }
                                        }
                                    }
                                }

                                CutoutStudioTool.MAGIC -> {
                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 14.dp, vertical = 6.dp),
                                        verticalArrangement = Arrangement.spacedBy(2.dp)
                                    ) {
                                        CompactToolSlider(
                                            label = "Wand Tol $tolerance",
                                            value = tolerance.toFloat(),
                                            range = 10f..75f,
                                            accent = Color(0xFFA78BFA),
                                            onValueChange = { tolerance = it.toInt() }
                                        )
                                        Text(
                                            "Tap any enclosed gap (collar, armhole, chain loop) to erase it. Pinch with 2 fingers to zoom.",
                                            color = Color(0xFF94A3B8),
                                            fontSize = 10.sp
                                        )
                                    }
                                }

                                CutoutStudioTool.PAN -> {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 12.dp, vertical = 8.dp),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("Zoom ${(zoom * 100).toInt()}%", color = Color(0xFF22D3EE), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        Spacer(Modifier.weight(1f))
                                        ActionPill("Fit 100%", Color(0xFF1E293B), null) { zoom = 1f; pan = Offset.Zero }
                                        ActionPill("2x", Color(0xFF1E293B), null) { zoom = 2f }
                                        ActionPill("4x", Color(0xFF1E293B), null) { zoom = 4f }
                                    }
                                }
                            }
                            HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
                        }

                        // 5 Ergonomic Bottom Tool Buttons
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(62.dp)
                                .padding(horizontal = 6.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CutoutStudioTool.entries.forEach { tool ->
                                val selected = activeTool == tool
                                val tint = when {
                                    selected && tool == CutoutStudioTool.RESTORE -> Color(0xFF34D399)
                                    selected && tool == CutoutStudioTool.ERASE -> Color(0xFFF43F5E)
                                    selected -> Color(0xFF818CF8)
                                    else -> Color(0xFF94A3B8)
                                }
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(52.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(if (selected) Color(0xFF1E293B) else Color.Transparent)
                                        .clickable { activeTool = tool }
                                ) {
                                    Icon(tool.icon, contentDescription = tool.label, tint = tint, modifier = Modifier.size(20.dp))
                                    Spacer(Modifier.height(2.dp))
                                    Text(
                                        tool.label,
                                        color = if (selected) Color.White else Color(0xFF94A3B8),
                                        fontSize = 10.sp,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                        maxLines = 1
                                    )
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
private fun CheckerboardBackdrop(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val cell = 24f
        val cols = (size.width / cell).toInt() + 1
        val rows = (size.height / cell).toInt() + 1
        val c1 = Color(0xFF162033)
        val c2 = Color(0xFF1E293B)
        for (r in 0 until rows) {
            for (c in 0 until cols) {
                drawRect(
                    color = if ((r + c) % 2 == 0) c1 else c2,
                    topLeft = Offset(c * cell, r * cell),
                    size = Size(cell, cell)
                )
            }
        }
    }
}

@Composable
private fun CompactToolSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    accent: Color,
    onValueChange: (Float) -> Unit
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            color = Color(0xFFE2E8F0),
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.width(96.dp)
        )
        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = range,
            colors = SliderDefaults.colors(
                thumbColor = accent,
                activeTrackColor = accent,
                inactiveTrackColor = Color(0xFF334155)
            ),
            modifier = Modifier
                .weight(1f)
                .height(28.dp)
        )
    }
}

@Composable
private fun ActionPill(
    label: String,
    bg: Color,
    icon: ImageVector?,
    onClick: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 7.dp)
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(label, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}
