package com.facemorph.studio.ui

import android.graphics.Bitmap
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.facemorph.studio.engine.NativeAssetSegmenter
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.CutoutToolId
import com.facemorph.studio.model.CutoutToolbarPrefs
import com.facemorph.studio.model.FabricType
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.model.WardrobeSubCategory
import com.facemorph.studio.model.defaultSubCategoryFor
import com.facemorph.studio.viewmodel.StudioViewModel
import kotlinx.coroutines.delay
import java.io.File
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private enum class CanvasBackdropMode(val label: String) {
    CHECKER("Checker"),
    DARK("Dark"),
    LIGHT("Light")
}

private fun iconForTool(tool: CutoutToolId): ImageVector = when (tool) {
    CutoutToolId.AUTO -> Icons.Default.AutoAwesome
    CutoutToolId.RESTORE -> Icons.Default.Brush
    CutoutToolId.ERASE -> Icons.Default.ContentCut
    CutoutToolId.MAGIC -> Icons.Default.TouchApp
    CutoutToolId.PAN -> Icons.Default.PanTool
}

@Composable
fun CustomAssetDialog(
    viewModel: StudioViewModel,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val toolbarPrefs = viewModel.cutoutToolbarPrefs

    // Step 1 = Full-Screen Cutout Canvas; Step 2 = Asset Name / Category / Custom Sub-Category / Save
    var studioStep by remember { mutableIntStateOf(1) }

    var alignedRawBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var workingBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var activeDraftBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var undoStack by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var redoStack by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var strokeRevision by remember { mutableIntStateOf(0) }

    // Tool settings initialized from customized defaults
    var tolerance by remember { mutableIntStateOf(toolbarPrefs.defaultTolerance) }
    var removeStrayObjects by remember { mutableStateOf(true) }
    var preserveDetails by remember { mutableStateOf(false) }

    // Manual brush & overlay controls
    val visibleTools = remember(toolbarPrefs) {
        toolbarPrefs.orderedTools.filter { it in toolbarPrefs.enabledTools }
            .ifEmpty { listOf(CutoutToolId.RESTORE, CutoutToolId.ERASE) }
    }
    var activeTool by remember {
        mutableStateOf(
            if (CutoutToolId.ERASE in visibleTools) CutoutToolId.ERASE else visibleTools.first()
        )
    }
    var brushSizePx by remember { mutableFloatStateOf(toolbarPrefs.defaultBrushSizePx) }
    var brushHardnessPct by remember { mutableFloatStateOf(toolbarPrefs.defaultBrushHardnessPct) }
    var overlayOpacityPct by remember { mutableFloatStateOf(toolbarPrefs.defaultOverlayPct) }
    var backdropMode by remember { mutableStateOf(CanvasBackdropMode.CHECKER) }

    // Floating Hold-to-Open Tool Settings Popover + Tool Customization Sheet + Quick-Drag HUD + Gesture HUD
    var settingsOpenForTool by remember { mutableStateOf<CutoutToolId?>(null) }
    var showCustomizeToolsSheet by remember { mutableStateOf(false) }
    var quickAdjustTool by remember { mutableStateOf<CutoutToolId?>(null) }
    var multiTapHudLabel by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(multiTapHudLabel) {
        if (multiTapHudLabel != null) {
            delay(950)
            multiTapHudLabel = null
        }
    }

    // Multi-touch viewport transform & Fingertip Magnifier Loupe coordinates
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var brushCursorImg by remember { mutableStateOf<Offset?>(null) }
    var loupeTouchScreenPos by remember { mutableStateOf<Offset?>(null) }
    var loupeTouchImgPos by remember { mutableStateOf<Offset?>(null) }
    var lastTapTimeMs by remember { mutableLongStateOf(0L) }
    var lastTapPos by remember { mutableStateOf(Offset.Zero) }

    // Hold-to-Compare original image
    val compareInteraction = remember { MutableInteractionSource() }
    val isComparingOriginal by compareInteraction.collectIsPressedAsState()

    // Step 2 Metadata (with Create Custom Sub-Category for Clothing, Jewelry & Other)
    var assetName by remember { mutableStateOf("Custom Item") }
    var hasEditedNameManually by remember { mutableStateOf(false) }
    var category by remember { mutableStateOf(WardrobeCategory.CLOTHING) }
    var subCategory by remember { mutableStateOf(WardrobeSubCategory.ETHNIC) }
    var customSubCategoryName by remember { mutableStateOf<String?>(null) }
    var anchorPoint by remember { mutableStateOf(BodyAnchorPoint.SHOULDERS) }
    var fabricType by remember { mutableStateOf(FabricType.COTTON) }

    // Inline "Create Sub-Category" prompt state
    var showCreateSubCategoryRow by remember { mutableStateOf(false) }
    var newSubCategoryInput by remember { mutableStateOf("") }
    var newSubCategoryTargetCat by remember { mutableStateOf(WardrobeCategory.CLOTHING) }

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
        settingsOpenForTool = null
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

    fun performUndo(): Boolean {
        val prev = undoStack.lastOrNull() ?: return false
        workingBitmap?.let { cur ->
            redoStack = (redoStack + cur).takeLast(15)
        }
        undoStack = undoStack.dropLast(1)
        workingBitmap = prev
        strokeRevision++
        return true
    }

    fun performRedo(): Boolean {
        val next = redoStack.lastOrNull() ?: return false
        workingBitmap?.let { cur ->
            undoStack = (undoStack + cur).takeLast(15)
        }
        redoStack = redoStack.dropLast(1)
        workingBitmap = next
        strokeRevision++
        return true
    }

    fun performEdgePolish() {
        val cur = workingBitmap ?: return
        val polished = NativeAssetSegmenter.smoothAndFeatherEdges(
            source = cur,
            featherRadiusPx = 2,
            dehaloStrength = 0.72f
        )
        pushUndoSnapshot(polished)
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        multiTapHudLabel = "Edges Polished"
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
        when {
            showCustomizeToolsSheet -> showCustomizeToolsSheet = false
            settingsOpenForTool != null -> settingsOpenForTool = null
            studioStep == 2 -> studioStep = 1
            else -> onDismiss()
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
                                .height(185.dp)
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

                        // One-Tap Edge Polish & Halo Cleanup Bar right on Step 2 Preview
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedButton(
                                onClick = { performEdgePolish() },
                                shape = RoundedCornerShape(10.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                modifier = Modifier.weight(1f).height(38.dp)
                            ) {
                                Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Polish & Feather Edges", color = Color(0xFFE0F2FE), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            }
                            if (undoStack.isNotEmpty()) {
                                OutlinedButton(
                                    onClick = { performUndo() },
                                    shape = RoundedCornerShape(10.dp),
                                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                                    modifier = Modifier.height(38.dp)
                                ) {
                                    Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "Undo", tint = Color(0xFFCBD5E1), modifier = Modifier.size(15.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Undo", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                                }
                            }
                        }

                        OutlinedTextField(
                            value = assetName,
                            onValueChange = {
                                assetName = it
                                hasEditedNameManually = true
                            },
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

                        // Step 2A: Category selector (Clothing, Jewelry, Accessory / Other)
                        Text("Category", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState())
                        ) {
                            WardrobeCategory.entries.forEach { cat ->
                                val label = if (cat == WardrobeCategory.ACCESSORY) "Other / Accessory" else cat.label
                                FilterChip(
                                    selected = category == cat,
                                    onClick = {
                                        category = cat
                                        anchorPoint = when (cat) {
                                            WardrobeCategory.CLOTHING -> BodyAnchorPoint.SHOULDERS
                                            WardrobeCategory.JEWELRY -> BodyAnchorPoint.NECK
                                            WardrobeCategory.ACCESSORY -> BodyAnchorPoint.HEAD
                                        }
                                        val firstCustom = viewModel.customSubCategories[cat]?.firstOrNull()
                                        if (customSubCategoryName != null && viewModel.customSubCategories[cat]?.contains(customSubCategoryName) != true) {
                                            customSubCategoryName = firstCustom
                                        }
                                        if (subCategory.parentCategory != cat) {
                                            subCategory = defaultSubCategoryFor(cat, anchorPoint)
                                        }
                                    },
                                    label = { Text(label, fontSize = 11.sp) }
                                )
                            }
                        }

                        // Step 2B: Sub-Category (Built-in + User-Created Custom items + Create New)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "Sub-Category (${if (category == WardrobeCategory.ACCESSORY) "Other" else category.label})",
                                color = Color(0xFF94A3B8),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                if (showCreateSubCategoryRow) "Close" else "+ Create New",
                                color = Color(0xFF34D399),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF064E3B))
                                    .clickable {
                                        newSubCategoryTargetCat = category
                                        showCreateSubCategoryRow = !showCreateSubCategoryRow
                                    }
                                    .padding(horizontal = 9.dp, vertical = 4.dp)
                            )
                        }

                        val customListForCat = viewModel.customSubCategories[category].orEmpty()
                        val builtInForCat = WardrobeSubCategory.entries.filter { it.parentCategory == category }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState())
                        ) {
                            builtInForCat.forEach { sub ->
                                val isSel = customSubCategoryName == null && subCategory == sub
                                FilterChip(
                                    selected = isSel,
                                    onClick = {
                                        customSubCategoryName = null
                                        subCategory = sub
                                        category = sub.parentCategory
                                        anchorPoint = when (sub) {
                                            WardrobeSubCategory.WATCH -> BodyAnchorPoint.WRIST
                                            WardrobeSubCategory.NECKLACE -> BodyAnchorPoint.NECK
                                            WardrobeSubCategory.EARRING -> BodyAnchorPoint.EARRINGS
                                            WardrobeSubCategory.GLASSES, WardrobeSubCategory.HEADWEAR -> BodyAnchorPoint.HEAD
                                            else -> BodyAnchorPoint.SHOULDERS
                                        }
                                        if (!hasEditedNameManually) assetName = "Custom ${sub.label}"
                                    },
                                    label = { Text(sub.label, fontSize = 11.sp) }
                                )
                            }

                            customListForCat.forEach { customLabel ->
                                val isSel = customSubCategoryName.equals(customLabel, ignoreCase = true)
                                FilterChip(
                                    selected = isSel,
                                    onClick = {
                                        customSubCategoryName = customLabel
                                        subCategory = defaultSubCategoryFor(category, anchorPoint)
                                        if (!hasEditedNameManually) assetName = "Custom $customLabel"
                                    },
                                    label = { Text(customLabel, fontSize = 11.sp) }
                                )
                            }

                            // Direct inline create chip inside row
                            FilterChip(
                                selected = showCreateSubCategoryRow,
                                onClick = {
                                    newSubCategoryTargetCat = category
                                    showCreateSubCategoryRow = !showCreateSubCategoryRow
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(14.dp))
                                },
                                label = { Text("Create Item Type", fontSize = 11.sp) }
                            )
                        }

                        // Expandable Inline Custom Sub-Category Creator (e.g. Kurta, Jhumka, Sherwani, Turban)
                        AnimatedVisibility(visible = showCreateSubCategoryRow) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(Color(0xFF0F172A))
                                    .border(1.dp, Color(0xFF059669), RoundedCornerShape(14.dp))
                                    .padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    "Create Custom Sub-Category (Saved for Future Items)",
                                    color = Color(0xFF6EE7B7),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    modifier = Modifier.horizontalScroll(rememberScrollState())
                                ) {
                                    WardrobeCategory.entries.forEach { targetCat ->
                                        val sel = newSubCategoryTargetCat == targetCat
                                        val tLabel = if (targetCat == WardrobeCategory.ACCESSORY) "Other / Accessory" else targetCat.label
                                        Text(
                                            tLabel,
                                            color = if (sel) Color(0xFF020617) else Color(0xFFCBD5E1),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(7.dp))
                                                .background(if (sel) Color(0xFF34D399) else Color(0xFF1E293B))
                                                .clickable { newSubCategoryTargetCat = targetCat }
                                                .padding(horizontal = 9.dp, vertical = 5.dp)
                                        )
                                    }
                                }
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    OutlinedTextField(
                                        value = newSubCategoryInput,
                                        onValueChange = { newSubCategoryInput = it },
                                        placeholder = {
                                            Text(
                                                when (newSubCategoryTargetCat) {
                                                    WardrobeCategory.CLOTHING -> "e.g. Kurta, Saree, Lehenga"
                                                    WardrobeCategory.JEWELRY -> "e.g. Jhumka, Bangle, Tikka"
                                                    WardrobeCategory.ACCESSORY -> "e.g. Turban, Dupatta, Scarf"
                                                },
                                                color = Color(0xFF64748B),
                                                fontSize = 11.sp
                                            )
                                        },
                                        singleLine = true,
                                        colors = OutlinedTextFieldDefaults.colors(
                                            focusedTextColor = Color.White,
                                            unfocusedTextColor = Color.White,
                                            focusedBorderColor = Color(0xFF34D399),
                                            unfocusedBorderColor = Color(0xFF334155)
                                        ),
                                        modifier = Modifier.weight(1f)
                                    )
                                    Button(
                                        onClick = {
                                            val created = viewModel.addCustomSubCategory(
                                                category = newSubCategoryTargetCat,
                                                rawLabel = newSubCategoryInput
                                            )
                                            if (created != null) {
                                                category = newSubCategoryTargetCat
                                                customSubCategoryName = created
                                                anchorPoint = when (newSubCategoryTargetCat) {
                                                    WardrobeCategory.CLOTHING -> BodyAnchorPoint.SHOULDERS
                                                    WardrobeCategory.JEWELRY -> {
                                                        when {
                                                            created.contains("watch", true) || created.contains("bangle", true) || created.contains("bracelet", true) ->
                                                                BodyAnchorPoint.WRIST
                                                            created.contains("earring", true) || created.contains("jhumka", true) || created.contains("stud", true) || created.contains("hoop", true) ->
                                                                BodyAnchorPoint.EARRINGS
                                                            else -> BodyAnchorPoint.NECK
                                                        }
                                                    }
                                                    WardrobeCategory.ACCESSORY -> {
                                                        when {
                                                            created.contains("belt", true) || created.contains("waist", true) ->
                                                                BodyAnchorPoint.WAIST
                                                            created.contains("earring", true) || created.contains("jhumka", true) || created.contains("stud", true) || created.contains("hoop", true) ->
                                                                BodyAnchorPoint.EARRINGS
                                                            else -> BodyAnchorPoint.HEAD
                                                        }
                                                    }
                                                }
                                                subCategory = defaultSubCategoryFor(newSubCategoryTargetCat, anchorPoint)
                                                if (!hasEditedNameManually) assetName = "Custom $created"
                                                newSubCategoryInput = ""
                                                showCreateSubCategoryRow = false
                                            }
                                        },
                                        enabled = newSubCategoryInput.isNotBlank(),
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                                        shape = RoundedCornerShape(10.dp),
                                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                                        modifier = Modifier.height(48.dp)
                                    ) {
                                        Text("Add", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
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
                                    BodyAnchorPoint.EARRINGS -> 0.42f
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
                                    subCategory = subCategory,
                                    customSubCategory = customSubCategoryName
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
                            Text(
                                "Save ${customSubCategoryName ?: subCategory.label} & Try On",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            } else {
                // Step 1: Maximum-Space Cutout Canvas + Touch-and-Hold Tool Settings Popover
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
                    // Clean Slim Single-Row Top Header (50dp)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .background(Color(0xFF0A0F1E))
                            .padding(horizontal = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = onDismiss, modifier = Modifier.size(36.dp)) {
                                Icon(Icons.Default.Close, contentDescription = "Close", tint = Color(0xFFCBD5E1), modifier = Modifier.size(20.dp))
                            }
                            Text("Cutout Studio", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            IconButton(
                                onClick = { galleryLauncher.launch("image/*") },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(Icons.Default.PhotoLibrary, contentDescription = "Pick Photo", tint = Color(0xFFA5B4FC), modifier = Modifier.size(18.dp))
                            }
                            IconButton(
                                onClick = {
                                    val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "asset")
                                    pendingCameraFile = file
                                    cameraLauncher.launch(uri)
                                },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(Icons.Default.CameraAlt, contentDescription = "Camera", tint = Color(0xFF38BDF8), modifier = Modifier.size(18.dp))
                            }
                            IconButton(
                                onClick = { performUndo() },
                                enabled = undoStack.isNotEmpty(),
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Undo,
                                    contentDescription = "Undo",
                                    tint = if (undoStack.isNotEmpty()) Color.White else Color(0xFF475569),
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                            IconButton(
                                onClick = { performRedo() },
                                enabled = redoStack.isNotEmpty(),
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Redo,
                                    contentDescription = "Redo",
                                    tint = if (redoStack.isNotEmpty()) Color.White else Color(0xFF475569),
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                            IconButton(
                                onClick = {
                                    settingsOpenForTool = null
                                    showCustomizeToolsSheet = !showCustomizeToolsSheet
                                },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    Icons.Default.Tune,
                                    contentDescription = "Customize Tool Buttons",
                                    tint = if (showCustomizeToolsSheet) Color(0xFF34D399) else Color(0xFF94A3B8),
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            Button(
                                onClick = {
                                    settingsOpenForTool = null
                                    showCustomizeToolsSheet = false
                                    studioStep = 2
                                },
                                enabled = workingBitmap != null,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF059669),
                                    disabledContainerColor = Color(0xFF1E293B)
                                ),
                                shape = RoundedCornerShape(10.dp),
                                contentPadding = PaddingValues(horizontal = 11.dp, vertical = 0.dp),
                                modifier = Modifier.height(32.dp)
                            ) {
                                Text("Next", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.width(3.dp))
                                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(14.dp))
                            }
                        }
                    }
                    HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                    // Huge Unobstructed Cutout Canvas (~85-88% of Screen!)
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
                                            // Auto-hide any floating settings card as soon as user starts touching the canvas
                                            if (settingsOpenForTool != null) {
                                                settingsOpenForTool = null
                                            }
                                            if (showCustomizeToolsSheet) {
                                                showCustomizeToolsSheet = false
                                            }
                                            val downPos = firstDown.position
                                            val downTime = System.currentTimeMillis()
                                            var isMultiTouch = false
                                            var tapCandidate = true
                                            var strokeActive = false
                                            var hadSingleStroke = false
                                            var maxSingleFingerTravel = 0f
                                            var maxFingerCount = 1
                                            var multiFingerMoved = false
                                            val fingerDownPos = mutableMapOf<PointerId, Offset>(firstDown.id to downPos)
                                            var draftMutable: Bitmap? = null
                                            var lastImgPt: Offset? = null
                                            var prevCentroid: Offset? = null
                                            var prevSpan = 0f
                                            var prevSinglePos = downPos

                                            // Show Fingertip Magnifier Loupe immediately when touching with Brush or Magic Wand
                                            if (latestTool == CutoutToolId.RESTORE || latestTool == CutoutToolId.ERASE || latestTool == CutoutToolId.MAGIC) {
                                                latestWorking?.let { w ->
                                                    val initImg = screenToImg(downPos, size, w)
                                                    loupeTouchScreenPos = downPos
                                                    loupeTouchImgPos = initImg
                                                    if (latestTool != CutoutToolId.MAGIC) {
                                                        brushCursorImg = initImg
                                                    }
                                                }
                                            }

                                            while (true) {
                                                val event = awaitPointerEvent()
                                                val pressed = event.changes.filter { it.pressed }

                                                for (ch in event.changes) {
                                                    if (ch.pressed && ch.id !in fingerDownPos) {
                                                        fingerDownPos[ch.id] = ch.position
                                                    }
                                                    if (ch.pressed) {
                                                        val origin = fingerDownPos[ch.id]
                                                        if (origin != null && hypot(ch.position.x - origin.x, ch.position.y - origin.y) > 22f) {
                                                            if (pressed.size >= 2 || isMultiTouch) {
                                                                multiFingerMoved = true
                                                            }
                                                        }
                                                    }
                                                }
                                                if (pressed.size > maxFingerCount) {
                                                    maxFingerCount = pressed.size
                                                }

                                                if (pressed.isEmpty()) {
                                                    val elapsed = System.currentTimeMillis() - downTime
                                                    if (strokeActive && draftMutable != null) {
                                                        pushUndoSnapshot(draftMutable!!)
                                                        activeDraftBitmap = null
                                                    } else if (!hadSingleStroke && !multiFingerMoved && maxFingerCount in 2..3 && elapsed in 15L..420L) {
                                                        // 2-Finger Tap = Undo · 3-Finger Tap = Redo
                                                        if (maxFingerCount == 2) {
                                                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                            multiTapHudLabel = if (performUndo()) "Undo (2-Finger Tap)" else "Nothing to Undo"
                                                        } else {
                                                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                            multiTapHudLabel = if (performRedo()) "Redo (3-Finger Tap)" else "Nothing to Redo"
                                                        }
                                                    } else if (tapCandidate && !isMultiTouch) {
                                                        val raw = latestAligned
                                                        val work = latestWorking
                                                        if (raw != null && work != null) {
                                                            when (latestTool) {
                                                                CutoutToolId.RESTORE, CutoutToolId.ERASE -> {
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
                                                                        isRestore = latestTool == CutoutToolId.RESTORE
                                                                    )
                                                                    pushUndoSnapshot(copyBmp)
                                                                }

                                                                CutoutToolId.MAGIC -> {
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

                                                                CutoutToolId.PAN, CutoutToolId.AUTO -> {
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
                                                    loupeTouchScreenPos = null
                                                    loupeTouchImgPos = null
                                                    break
                                                }

                                                if (pressed.size >= 2) {
                                                    if (strokeActive && draftMutable != null) {
                                                        val elapsedSinceDown = System.currentTimeMillis() - downTime
                                                        if (elapsedSinceDown < 95L && maxSingleFingerTravel < 14f) {
                                                            // Second finger just landed to pinch/multi-tap; discard tiny landing jitter
                                                            activeDraftBitmap = null
                                                            strokeActive = false
                                                            draftMutable = null
                                                        } else {
                                                            pushUndoSnapshot(draftMutable!!)
                                                            hadSingleStroke = true
                                                            activeDraftBitmap = null
                                                            strokeActive = false
                                                            draftMutable = null
                                                        }
                                                    }
                                                    isMultiTouch = true
                                                    tapCandidate = false
                                                    brushCursorImg = null
                                                    loupeTouchScreenPos = null
                                                    loupeTouchImgPos = null
                                                    val p0 = pressed[0].position
                                                    val p1 = pressed[1].position
                                                    val centroid = Offset((p0.x + p1.x) * 0.5f, (p0.y + p1.y) * 0.5f)
                                                    val span = hypot(p1.x - p0.x, p1.y - p0.y).coerceAtLeast(12f)
                                                    if (prevCentroid != null && prevSpan > 0f) {
                                                        val zoomDelta = (span / prevSpan).coerceIn(0.7f, 1.4f)
                                                        val panDelta = centroid - prevCentroid!!
                                                        if (hypot(panDelta.x, panDelta.y) > 4f || abs(zoomDelta - 1f) > 0.03f) {
                                                            multiFingerMoved = true
                                                        }
                                                        applyViewportTransform(centroid, panDelta, zoomDelta, size)
                                                    }
                                                    prevCentroid = centroid
                                                    prevSpan = span
                                                    pressed.forEach { it.consume() }
                                                } else if (!isMultiTouch && pressed.size == 1) {
                                                    val ch = pressed[0]
                                                    val pos = ch.position
                                                    val distMoved = hypot(pos.x - downPos.x, pos.y - downPos.y)
                                                    if (distMoved > maxSingleFingerTravel) {
                                                        maxSingleFingerTravel = distMoved
                                                    }
                                                    if (distMoved > 8f) tapCandidate = false

                                                    val raw = latestAligned
                                                    val work = latestWorking
                                                    if (raw != null && work != null) {
                                                        when (latestTool) {
                                                            CutoutToolId.PAN -> {
                                                                val delta = pos - prevSinglePos
                                                                applyViewportTransform(pos, delta, 1f, size)
                                                                ch.consume()
                                                            }

                                                            CutoutToolId.RESTORE, CutoutToolId.ERASE -> {
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
                                                                        isRestore = latestTool == CutoutToolId.RESTORE
                                                                    )
                                                                    lastImgPt = imgPt
                                                                    strokeRevision++
                                                                } else if (strokeActive && draftMutable != null) {
                                                                    if (distMoved > 14f) hadSingleStroke = true
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
                                                                        isRestore = latestTool == CutoutToolId.RESTORE
                                                                    )
                                                                    lastImgPt = imgPt
                                                                    strokeRevision++
                                                                }
                                                                brushCursorImg = imgPt
                                                                loupeTouchScreenPos = pos
                                                                loupeTouchImgPos = imgPt
                                                                ch.consume()
                                                            }

                                                            else -> {
                                                                if (zoom > 1.04f && distMoved > 8f) {
                                                                    hadSingleStroke = true
                                                                    loupeTouchScreenPos = null
                                                                    loupeTouchImgPos = null
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

                                val cursor = brushCursorImg
                                if (cursor != null && (activeTool == CutoutToolId.RESTORE || activeTool == CutoutToolId.ERASE)) {
                                    val sx = left + cursor.x * scale
                                    val sy = top + cursor.y * scale
                                    val outerR = (brushSizePx * scale).coerceAtLeast(8f)
                                    val innerR = outerR * (brushHardnessPct / 100f).coerceIn(0.05f, 0.98f)
                                    val ringColor = if (activeTool == CutoutToolId.RESTORE) Color(0xFF34D399) else Color(0xFFF43F5E)
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

                                // Fingertip Magnifier Loupe (zoomed precision lens offset cleanly above fingertip)
                                val lScreen = loupeTouchScreenPos
                                val lImg = loupeTouchImgPos
                                if (toolbarPrefs.showMagnifierLoupe &&
                                    lScreen != null &&
                                    lImg != null &&
                                    (activeTool == CutoutToolId.RESTORE || activeTool == CutoutToolId.ERASE || activeTool == CutoutToolId.MAGIC)
                                ) {
                                    val loupeR = 62.dp.toPx()
                                    val edgePad = 10.dp.toPx()
                                    var lx = lScreen.x.coerceIn(loupeR + edgePad, size.width - loupeR - edgePad)
                                    var ly = lScreen.y - loupeR - 58.dp.toPx()
                                    if (ly - loupeR < edgePad) {
                                        lx = if (lScreen.x > size.width * 0.5f) {
                                            (lScreen.x - loupeR - 52.dp.toPx()).coerceAtLeast(loupeR + edgePad)
                                        } else {
                                            (lScreen.x + loupeR + 52.dp.toPx()).coerceAtMost(size.width - loupeR - edgePad)
                                        }
                                        ly = (lScreen.y + 12.dp.toPx()).coerceIn(loupeR + edgePad, size.height - loupeR - edgePad)
                                    }

                                    val loupeScale = max(scale * 2.35f, 3.2f)
                                    val lLeft = lx - lImg.x * loupeScale
                                    val lTop = ly - lImg.y * loupeScale
                                    val lDst = RectF(lLeft, lTop, lLeft + bw * loupeScale, lTop + bh * loupeScale)
                                    val clipPath = Path().apply { addCircle(lx, ly, loupeR, Path.Direction.CW) }

                                    drawIntoCanvas { canvas ->
                                        val nc = canvas.nativeCanvas
                                        nc.save()
                                        nc.clipPath(clipPath)
                                        val bgClr = when (backdropMode) {
                                            CanvasBackdropMode.CHECKER -> android.graphics.Color.rgb(22, 32, 51)
                                            CanvasBackdropMode.DARK -> android.graphics.Color.rgb(11, 17, 32)
                                            CanvasBackdropMode.LIGHT -> android.graphics.Color.rgb(241, 245, 249)
                                        }
                                        nc.drawColor(bgClr)
                                        if (backdropMode == CanvasBackdropMode.CHECKER) {
                                            val cell = 14.dp.toPx()
                                            val chkPaint = Paint().apply { color = android.graphics.Color.rgb(30, 41, 59) }
                                            val c0 = ((lx - loupeR) / cell).toInt()
                                            val c1 = ((lx + loupeR) / cell).toInt() + 1
                                            val r0 = ((ly - loupeR) / cell).toInt()
                                            val r1 = ((ly + loupeR) / cell).toInt() + 1
                                            for (r in r0..r1) {
                                                for (c in c0..c1) {
                                                    if ((r + c) and 1 == 1) {
                                                        nc.drawRect(c * cell, r * cell, (c + 1) * cell, (r + 1) * cell, chkPaint)
                                                    }
                                                }
                                            }
                                        }
                                        if (isComparingOriginal) {
                                            nc.drawBitmap(raw, null, lDst, null)
                                        } else {
                                            if (overlayOpacityPct > 1f) {
                                                rubyOverlayPaint.alpha = ((overlayOpacityPct / 100f) * 255f).toInt().coerceIn(0, 255)
                                                nc.drawBitmap(raw, null, lDst, rubyOverlayPaint)
                                            }
                                            nc.drawBitmap(activeCut, null, lDst, null)
                                        }
                                        nc.restore()
                                    }

                                    val loupeAccent = when (activeTool) {
                                        CutoutToolId.RESTORE -> Color(0xFF34D399)
                                        CutoutToolId.ERASE -> Color(0xFFF43F5E)
                                        else -> Color(0xFFA78BFA)
                                    }

                                    if (activeTool == CutoutToolId.RESTORE || activeTool == CutoutToolId.ERASE) {
                                        val magR = (brushSizePx * loupeScale).coerceIn(4f, loupeR * 0.92f)
                                        drawCircle(
                                            color = loupeAccent,
                                            radius = magR,
                                            center = Offset(lx, ly),
                                            style = Stroke(width = 2.2f)
                                        )
                                        val magInnerR = (magR * (brushHardnessPct / 100f)).coerceIn(2f, magR)
                                        drawCircle(
                                            color = Color.White.copy(alpha = 0.6f),
                                            radius = magInnerR,
                                            center = Offset(lx, ly),
                                            style = Stroke(width = 1f)
                                        )
                                    }

                                    val cross = 7.dp.toPx()
                                    drawLine(Color.White.copy(alpha = 0.85f), Offset(lx - cross, ly), Offset(lx + cross, ly), strokeWidth = 1.6f)
                                    drawLine(Color.White.copy(alpha = 0.85f), Offset(lx, ly - cross), Offset(lx, ly + cross), strokeWidth = 1.6f)

                                    drawCircle(color = Color(0xCC020617), radius = loupeR + 3f, center = Offset(lx, ly), style = Stroke(width = 5f))
                                    drawCircle(color = loupeAccent, radius = loupeR, center = Offset(lx, ly), style = Stroke(width = 2.6f))
                                }

                                if (_rev < 0) drawCircle(Color.Transparent, 0f)
                            }

                            // Subtle top-left quick status badge (only visible when settings closed; tap to open settings)
                            Row(
                                modifier = Modifier
                                    .align(Alignment.TopStart)
                                    .padding(10.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(Color(0xCC0F172A))
                                    .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                                    .clickable {
                                        settingsOpenForTool = if (settingsOpenForTool == activeTool) null else activeTool
                                    }
                                    .padding(horizontal = 9.dp, vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp)
                            ) {
                                Icon(Icons.Default.Tune, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(13.dp))
                                Text(
                                    text = when (activeTool) {
                                        CutoutToolId.RESTORE, CutoutToolId.ERASE -> "${activeTool.defaultLabel} · ${brushSizePx.toInt()}px"
                                        CutoutToolId.MAGIC -> "Magic · Tol $tolerance"
                                        CutoutToolId.AUTO -> "Auto · Cut $tolerance"
                                        CutoutToolId.PAN -> "Zoom ${(zoom * 100).toInt()}%"
                                    },
                                    color = Color(0xFFE2E8F0),
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }

                            // Minimal Floating Top-Right Canvas Controls (Respects customization!)
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

                                if (toolbarPrefs.showBackdropButton) {
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
                                }

                                if (toolbarPrefs.showCompareButton) {
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
                                    "Pick a photo from Gallery or Camera.\nHold any tool button anytime to open its settings — keeping maximum space for editing.",
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

                        // Multi-Finger Undo/Redo & Edge Polish Feedback HUD Pill
                        val hudMsg = multiTapHudLabel
                        if (hudMsg != null) {
                            Row(
                                modifier = Modifier
                                    .align(Alignment.TopCenter)
                                    .padding(top = 50.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Color(0xEB0B1120))
                                    .border(1.dp, Color(0xFF38BDF8), RoundedCornerShape(12.dp))
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(
                                    imageVector = when {
                                        hudMsg.startsWith("Undo") -> Icons.AutoMirrored.Filled.Undo
                                        hudMsg.startsWith("Redo") -> Icons.AutoMirrored.Filled.Redo
                                        else -> Icons.Default.AutoAwesome
                                    },
                                    contentDescription = null,
                                    tint = Color(0xFF38BDF8),
                                    modifier = Modifier.size(14.dp)
                                )
                                Text(hudMsg, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }

                        // Live Center-Canvas Quick-Adjust HUD (when dragging up/down directly off a tool button)
                        val qTool = quickAdjustTool
                        if (qTool != null) {
                            val accent = when (qTool) {
                                CutoutToolId.RESTORE -> Color(0xFF34D399)
                                CutoutToolId.ERASE -> Color(0xFFF43F5E)
                                CutoutToolId.MAGIC -> Color(0xFFA78BFA)
                                else -> Color(0xFF22D3EE)
                            }
                            Column(
                                modifier = Modifier
                                    .align(Alignment.Center)
                                    .clip(RoundedCornerShape(18.dp))
                                    .background(Color(0xE60B1120))
                                    .border(1.2.dp, accent, RoundedCornerShape(18.dp))
                                    .padding(horizontal = 20.dp, vertical = 14.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                if (qTool == CutoutToolId.RESTORE || qTool == CutoutToolId.ERASE) {
                                    val previewDiaDp = (brushSizePx * 1.15f).coerceIn(14f, 128f).dp
                                    Box(
                                        modifier = Modifier.size(134.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(previewDiaDp)
                                                .clip(CircleShape)
                                                .background(accent.copy(alpha = 0.16f))
                                                .border(2.dp, accent, CircleShape),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            val innerDiaDp = (previewDiaDp.value * (brushHardnessPct / 100f).coerceIn(0.1f, 0.95f)).dp
                                            Box(
                                                modifier = Modifier
                                                    .size(innerDiaDp)
                                                    .clip(CircleShape)
                                                    .border(1.dp, Color.White.copy(alpha = 0.65f), CircleShape)
                                            )
                                        }
                                    }
                                    Text(
                                        "${qTool.defaultLabel} Size · ${brushSizePx.toInt()} px",
                                        color = Color.White,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                } else {
                                    Text(
                                        "${qTool.defaultLabel} Tolerance · $tolerance",
                                        color = Color.White,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                Text(
                                    "Slide Up / Down to adjust",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 10.sp
                                )
                            }
                        }

                        // Floating Tool Settings Popover (Triggered by Touch & Hold on any Tool Button!)
                        androidx.compose.animation.AnimatedVisibility(
                            visible = settingsOpenForTool != null && !showCustomizeToolsSheet,
                            enter = fadeIn() + slideInVertically { it / 2 },
                            exit = fadeOut() + slideOutVertically { it / 2 },
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(horizontal = 10.dp, vertical = 10.dp)
                        ) {
                            val openTool = settingsOpenForTool ?: activeTool
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(Color(0xF50B1120))
                                    .border(1.2.dp, Color(0xFF4F46E5), RoundedCornerShape(16.dp))
                                    .clickable(
                                        interactionSource = remember { MutableInteractionSource() },
                                        indication = null,
                                        onClick = {}
                                    )
                                    .padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Icon(iconForTool(openTool), contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(16.dp))
                                        Text(
                                            "${openTool.defaultLabel} Settings",
                                            color = Color.White,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            "Customize",
                                            color = Color(0xFFA5B4FC),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(7.dp))
                                                .background(Color(0xFF1E1B4B))
                                                .clickable {
                                                    settingsOpenForTool = null
                                                    showCustomizeToolsSheet = true
                                                }
                                                .padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                        Text(
                                            "Done",
                                            color = Color.White,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(7.dp))
                                                .background(Color(0xFF059669))
                                                .clickable { settingsOpenForTool = null }
                                                .padding(horizontal = 9.dp, vertical = 4.dp)
                                        )
                                    }
                                }

                                HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                                when (openTool) {
                                    CutoutToolId.RESTORE, CutoutToolId.ERASE -> {
                                        val isRestore = openTool == CutoutToolId.RESTORE
                                        val accent = if (isRestore) Color(0xFF10B981) else Color(0xFFF43F5E)
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
                                        Row(
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            modifier = Modifier.horizontalScroll(rememberScrollState())
                                        ) {
                                            ActionPill(
                                                if (isRestore) "Switch to Erase" else "Switch to Restore",
                                                Color(0xFF1E293B),
                                                if (isRestore) Icons.Default.ContentCut else Icons.Default.Brush
                                            ) {
                                                val swapped = if (isRestore) CutoutToolId.ERASE else CutoutToolId.RESTORE
                                                activeTool = swapped
                                                settingsOpenForTool = swapped
                                            }
                                            ActionPill("Invert Cutout", Color(0xFF334155), Icons.Default.Flip) {
                                                val raw = alignedRawBitmap
                                                val cur = workingBitmap
                                                if (raw != null && cur != null) {
                                                    pushUndoSnapshot(NativeAssetSegmenter.invertCutoutBitmap(raw, cur))
                                                }
                                            }
                                            ActionPill("Polish Edges", Color(0xFF0E7490), Icons.Default.AutoAwesome) {
                                                performEdgePolish()
                                            }
                                        }
                                        Text(
                                            "Tip: Slide button up/down to resize · 2-finger tap Undo · 3-finger Redo",
                                            color = Color(0xFF64748B),
                                            fontSize = 10.sp
                                        )
                                    }

                                    CutoutToolId.AUTO -> {
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
                                            ActionPill("Polish Edges", Color(0xFF0E7490), Icons.Default.AutoAwesome) {
                                                performEdgePolish()
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

                                    CutoutToolId.MAGIC -> {
                                        CompactToolSlider(
                                            label = "Wand Tol $tolerance",
                                            value = tolerance.toFloat(),
                                            range = 10f..75f,
                                            accent = Color(0xFFA78BFA),
                                            onValueChange = { tolerance = it.toInt() }
                                        )
                                        Text(
                                            "Tap enclosed color regions (collar, chain links, background gaps) to erase.",
                                            color = Color(0xFF94A3B8),
                                            fontSize = 10.sp
                                        )
                                    }

                                    CutoutToolId.PAN -> {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Text("Zoom ${(zoom * 100).toInt()}%", color = Color(0xFF22D3EE), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                            Spacer(Modifier.weight(1f))
                                            ActionPill("Fit", Color(0xFF1E293B), null) { zoom = 1f; pan = Offset.Zero }
                                            ActionPill("2x", Color(0xFF1E293B), null) { zoom = 2f }
                                            ActionPill("4x", Color(0xFF1E293B), null) { zoom = 4f }
                                            ActionPill("6x", Color(0xFF1E293B), null) { zoom = 6f }
                                        }
                                    }
                                }
                            }
                        }

                        // Floating Tool Buttons & Settings Customizer Sheet
                        androidx.compose.animation.AnimatedVisibility(
                            visible = showCustomizeToolsSheet,
                            enter = fadeIn() + slideInVertically { it / 2 },
                            exit = fadeOut() + slideOutVertically { it / 2 },
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(horizontal = 10.dp, vertical = 10.dp)
                        ) {
                            CustomizeCutoutToolsSheet(
                                prefs = toolbarPrefs,
                                currentBrushSize = brushSizePx,
                                currentHardness = brushHardnessPct,
                                currentTolerance = tolerance,
                                currentOverlay = overlayOpacityPct,
                                onUpdatePrefs = { next ->
                                    viewModel.updateCutoutToolbarPrefs(next)
                                    if (activeTool !in next.enabledTools) {
                                        activeTool = next.orderedTools.firstOrNull { it in next.enabledTools }
                                            ?: CutoutToolId.RESTORE
                                    }
                                },
                                onResetDefaults = {
                                    val def = CutoutToolbarPrefs()
                                    viewModel.updateCutoutToolbarPrefs(def)
                                    brushSizePx = def.defaultBrushSizePx
                                    brushHardnessPct = def.defaultBrushHardnessPct
                                    tolerance = def.defaultTolerance
                                    overlayOpacityPct = def.defaultOverlayPct
                                },
                                onClose = { showCustomizeToolsSheet = false }
                            )
                        }
                    }

                    // Slim Bottom Tool Bar (Tap = select, Touch & Hold = Settings, Slide Up/Down = Quick Resize)
                    val latestPrefs by rememberUpdatedState(toolbarPrefs)
                    val latestActiveDockTool by rememberUpdatedState(activeTool)
                    val latestSettingsOpenTool by rememberUpdatedState(settingsOpenForTool)
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF0A0F1E))
                    ) {
                        HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
                        val barHeight = when {
                            toolbarPrefs.largeButtons -> 64.dp
                            toolbarPrefs.compactLabels -> 54.dp
                            else -> 46.dp
                        }
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(barHeight)
                                .padding(horizontal = 6.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            visibleTools.forEach { tool ->
                                val selected = activeTool == tool
                                val settingsOpen = settingsOpenForTool == tool
                                val isQuickDragging = quickAdjustTool == tool
                                val tint = when {
                                    selected && tool == CutoutToolId.RESTORE -> Color(0xFF34D399)
                                    selected && tool == CutoutToolId.ERASE -> Color(0xFFF43F5E)
                                    selected -> Color(0xFF818CF8)
                                    else -> Color(0xFF94A3B8)
                                }
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(barHeight - 8.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(
                                            when {
                                                isQuickDragging -> Color(0xFF0F172A)
                                                settingsOpen -> Color(0xFF312E81)
                                                selected -> Color(0xFF1E293B)
                                                else -> Color.Transparent
                                            }
                                        )
                                        .border(
                                            width = if (settingsOpen || isQuickDragging) 1.dp else 0.dp,
                                            color = when {
                                                isQuickDragging -> tint
                                                settingsOpen -> Color(0xFF818CF8)
                                                else -> Color.Transparent
                                            },
                                            shape = RoundedCornerShape(12.dp)
                                        )
                                        .pointerInput(tool) {
                                            val canQuickDrag = tool == CutoutToolId.RESTORE ||
                                                tool == CutoutToolId.ERASE ||
                                                tool == CutoutToolId.AUTO ||
                                                tool == CutoutToolId.MAGIC
                                            awaitEachGesture {
                                                val firstDown = awaitFirstDown(requireUnconsumed = false)
                                                val startPos = firstDown.position
                                                val downTime = SystemClock.uptimeMillis()
                                                val longPressMs = viewConfiguration.longPressTimeoutMillis
                                                val touchSlop = viewConfiguration.touchSlop
                                                var dragStarted = false
                                                var longPressFired = false
                                                var prevY = startPos.y
                                                var tolAccum = latestTolerance.toFloat()

                                                while (true) {
                                                    if (!dragStarted && !longPressFired) {
                                                        val elapsed = SystemClock.uptimeMillis() - downTime
                                                        val remaining = (longPressMs - elapsed).coerceAtLeast(1L)
                                                        val ev = withTimeoutOrNull(remaining) { awaitPointerEvent() }
                                                        if (ev == null) {
                                                            longPressFired = true
                                                            showCustomizeToolsSheet = false
                                                            if (latestPrefs.longPressOpensSettings && tool.hasSettings) {
                                                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                                activeTool = tool
                                                                settingsOpenForTool = if (latestSettingsOpenTool == tool) null else tool
                                                            }
                                                            continue
                                                        }
                                                        val ch = ev.changes.firstOrNull { it.id == firstDown.id } ?: ev.changes.firstOrNull()
                                                        if (ch == null || !ch.pressed) {
                                                            // Clean Tap
                                                            showCustomizeToolsSheet = false
                                                            if (latestActiveDockTool == tool && latestPrefs.tapActiveOpensSettings && tool.hasSettings) {
                                                                settingsOpenForTool = if (latestSettingsOpenTool == tool) null else tool
                                                            } else {
                                                                activeTool = tool
                                                                if (latestSettingsOpenTool != null) settingsOpenForTool = tool
                                                            }
                                                            break
                                                        }
                                                        val dx = abs(ch.position.x - startPos.x)
                                                        val dy = ch.position.y - startPos.y
                                                        if (canQuickDrag && abs(dy) > touchSlop && abs(dy) > dx * 1.1f) {
                                                            dragStarted = true
                                                            activeTool = tool
                                                            settingsOpenForTool = null
                                                            showCustomizeToolsSheet = false
                                                            quickAdjustTool = tool
                                                            tolAccum = latestTolerance.toFloat()
                                                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                            val upDelta = prevY - ch.position.y
                                                            if (tool == CutoutToolId.RESTORE || tool == CutoutToolId.ERASE) {
                                                                brushSizePx = (brushSizePx + upDelta * 0.45f).coerceIn(6f, 130f)
                                                            } else {
                                                                tolAccum = (tolAccum + upDelta * 0.25f).coerceIn(10f, 75f)
                                                                tolerance = tolAccum.roundToInt()
                                                            }
                                                            prevY = ch.position.y
                                                            ch.consume()
                                                        }
                                                    } else {
                                                        val ev = awaitPointerEvent()
                                                        val ch = ev.changes.firstOrNull { it.id == firstDown.id } ?: ev.changes.firstOrNull()
                                                        if (ch == null || !ch.pressed) {
                                                            if (quickAdjustTool == tool) quickAdjustTool = null
                                                            break
                                                        }
                                                        if (dragStarted) {
                                                            val upDelta = prevY - ch.position.y
                                                            if (tool == CutoutToolId.RESTORE || tool == CutoutToolId.ERASE) {
                                                                brushSizePx = (brushSizePx + upDelta * 0.45f).coerceIn(6f, 130f)
                                                            } else {
                                                                tolAccum = (tolAccum + upDelta * 0.25f).coerceIn(10f, 75f)
                                                                tolerance = tolAccum.roundToInt()
                                                            }
                                                            prevY = ch.position.y
                                                            ch.consume()
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                    contentAlignment = Alignment.Center
                                ) {
                                    // Subtle corner pip indicating Touch-and-Hold Settings available
                                    if (tool.hasSettings) {
                                        Box(
                                            modifier = Modifier
                                                .align(Alignment.TopEnd)
                                                .padding(top = 4.dp, end = 6.dp)
                                                .size(5.dp)
                                                .clip(CircleShape)
                                                .background(if (settingsOpen) Color(0xFF34D399) else Color(0xFF64748B))
                                        )
                                    }

                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.Center
                                    ) {
                                        Icon(
                                            iconForTool(tool),
                                            contentDescription = "${tool.defaultLabel} (Hold for settings, slide to resize)",
                                            tint = tint,
                                            modifier = Modifier.size(if (toolbarPrefs.largeButtons) 22.dp else 19.dp)
                                        )
                                        if (toolbarPrefs.compactLabels) {
                                            Spacer(Modifier.height(2.dp))
                                            Text(
                                                tool.defaultLabel,
                                                color = if (selected) Color.White else Color(0xFF94A3B8),
                                                fontSize = if (toolbarPrefs.largeButtons) 11.sp else 10.sp,
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
    }
}

@Composable
private fun CustomizeCutoutToolsSheet(
    prefs: CutoutToolbarPrefs,
    currentBrushSize: Float,
    currentHardness: Float,
    currentTolerance: Int,
    currentOverlay: Float,
    onUpdatePrefs: (CutoutToolbarPrefs) -> Unit,
    onResetDefaults: () -> Unit,
    onClose: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 420.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xF70B1120))
            .border(1.2.dp, Color(0xFF10B981), RoundedCornerShape(16.dp))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {}
            )
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Default.Tune, contentDescription = null, tint = Color(0xFF34D399), modifier = Modifier.size(16.dp))
                Text("Customize Tools & Settings", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Reset",
                    color = Color(0xFFFBBF24),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .background(Color(0xFF1E293B))
                        .clickable { onResetDefaults() }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                )
                Text(
                    "Done",
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .background(Color(0xFF059669))
                        .clickable { onClose() }
                        .padding(horizontal = 9.dp, vertical = 4.dp)
                )
            }
        }

        Column(
            modifier = Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("Tool Button Order & Visibility", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
            prefs.orderedTools.forEachIndexed { idx, tool ->
                val isVisible = tool in prefs.enabledTools
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFF111827))
                        .border(1.dp, if (isVisible) Color(0xFF334155) else Color(0xFF1E293B), RoundedCornerShape(10.dp))
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(
                            iconForTool(tool),
                            contentDescription = null,
                            tint = if (isVisible) Color(0xFF818CF8) else Color(0xFF475569),
                            modifier = Modifier.size(17.dp)
                        )
                        Text(
                            tool.defaultLabel,
                            color = if (isVisible) Color.White else Color(0xFF64748B),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        IconButton(
                            onClick = {
                                if (idx > 0) {
                                    val mutable = prefs.orderedTools.toMutableList()
                                    val swap = mutable[idx - 1]
                                    mutable[idx - 1] = mutable[idx]
                                    mutable[idx] = swap
                                    onUpdatePrefs(prefs.copy(orderedTools = mutable))
                                }
                            },
                            enabled = idx > 0,
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(Icons.Default.KeyboardArrowUp, contentDescription = "Move Left/Up", tint = if (idx > 0) Color.White else Color(0xFF334155), modifier = Modifier.size(16.dp))
                        }
                        IconButton(
                            onClick = {
                                if (idx < prefs.orderedTools.lastIndex) {
                                    val mutable = prefs.orderedTools.toMutableList()
                                    val swap = mutable[idx + 1]
                                    mutable[idx + 1] = mutable[idx]
                                    mutable[idx] = swap
                                    onUpdatePrefs(prefs.copy(orderedTools = mutable))
                                }
                            },
                            enabled = idx < prefs.orderedTools.lastIndex,
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Move Right/Down", tint = if (idx < prefs.orderedTools.lastIndex) Color.White else Color(0xFF334155), modifier = Modifier.size(16.dp))
                        }
                        IconButton(
                            onClick = {
                                val nextEnabled = if (isVisible) {
                                    if (prefs.enabledTools.size > 1) prefs.enabledTools - tool else prefs.enabledTools
                                } else {
                                    prefs.enabledTools + tool
                                }
                                onUpdatePrefs(prefs.copy(enabledTools = nextEnabled))
                            },
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                if (isVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                contentDescription = "Toggle tool button",
                                tint = if (isVisible) Color(0xFF34D399) else Color(0xFF64748B),
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }
            }

            HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
            Text("Bar Layout & Hold Gestures", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)

            PreferenceToggleRow("Hold Tool Button -> Open Settings", prefs.longPressOpensSettings) {
                onUpdatePrefs(prefs.copy(longPressOpensSettings = it))
            }
            PreferenceToggleRow("Tap Active Tool -> Open Settings", prefs.tapActiveOpensSettings) {
                onUpdatePrefs(prefs.copy(tapActiveOpensSettings = it))
            }
            PreferenceToggleRow("Show Text Labels on Dock", prefs.compactLabels) {
                onUpdatePrefs(prefs.copy(compactLabels = it))
            }
            PreferenceToggleRow("Large Easy-Tap Buttons", prefs.largeButtons) {
                onUpdatePrefs(prefs.copy(largeButtons = it))
            }
            PreferenceToggleRow("Fingertip Magnifier Loupe", prefs.showMagnifierLoupe) {
                onUpdatePrefs(prefs.copy(showMagnifierLoupe = it))
            }
            PreferenceToggleRow("Canvas Backdrop Switcher", prefs.showBackdropButton) {
                onUpdatePrefs(prefs.copy(showBackdropButton = it))
            }
            PreferenceToggleRow("Canvas Hold-to-Compare Button", prefs.showCompareButton) {
                onUpdatePrefs(prefs.copy(showCompareButton = it))
            }

            Button(
                onClick = {
                    onUpdatePrefs(
                        prefs.copy(
                            defaultBrushSizePx = currentBrushSize,
                            defaultBrushHardnessPct = currentHardness,
                            defaultTolerance = currentTolerance,
                            defaultOverlayPct = currentOverlay
                        )
                    )
                },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF312E81)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().height(38.dp)
            ) {
                Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(6.dp))
                Text("Save Current Brush & Cutout as Default", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun PreferenceToggleRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(Color(0xFF111827))
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 10.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            label,
            color = Color(0xFFE2E8F0),
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Switch(checked = checked, onCheckedChange = onCheckedChange)
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
