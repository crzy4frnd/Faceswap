package com.facemorph.studio.ui

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.RotateLeft
import androidx.compose.material.icons.filled.RotateRight
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.facemorph.studio.engine.NativeFaceSwapEngine
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.model.FaceAngleBucket
import com.facemorph.studio.viewmodel.StudioViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs

@Composable
fun FaceProfileManagerDialog(
    viewModel: StudioViewModel,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var newProfileName by remember { mutableStateOf("") }
    var editingProfileId by remember { mutableStateOf<String?>(null) }
    var editingNameDraft by remember { mutableStateOf("") }

    var selectedTargetProfileId by remember {
        mutableStateOf(
            viewModel.activeProfileId.takeIf { id -> viewModel.faceProfiles.any { it.id == id } }
                ?: viewModel.faceProfiles.firstOrNull()?.id
                ?: ""
        )
    }

    LaunchedEffect(viewModel.faceProfiles, viewModel.activeProfileId) {
        if (viewModel.faceProfiles.none { it.id == selectedTargetProfileId }) {
            selectedTargetProfileId = viewModel.activeProfileId.takeIf { id ->
                viewModel.faceProfiles.any { it.id == id }
            } ?: viewModel.faceProfiles.firstOrNull()?.id ?: ""
        }
    }

    // Face Editor State (profileId to angleId)
    var editingFacePair by remember { mutableStateOf<Pair<String, String>?>(null) }
    var editFlipH by remember { mutableStateOf(false) }
    var editBaseRotateDeg by remember { mutableFloatStateOf(0f) }
    var editTiltDeg by remember { mutableFloatStateOf(0f) }
    var editBrightness by remember { mutableFloatStateOf(0f) }
    var editContrast by remember { mutableFloatStateOf(0f) }
    var editWarmth by remember { mutableFloatStateOf(0f) }
    var editPreviewBmp by remember { mutableStateOf<Bitmap?>(null) }

    var pendingProfileId by remember { mutableStateOf<String?>(null) }
    var pendingReplacePair by remember { mutableStateOf<Pair<String, String>?>(null) }
    var pendingCameraFile by remember { mutableStateOf<File?>(null) }

    fun openFaceEditor(profileId: String, angleId: String) {
        editingFacePair = profileId to angleId
        editFlipH = false
        editBaseRotateDeg = 0f
        editTiltDeg = 0f
        editBrightness = 0f
        editContrast = 0f
        editWarmth = 0f
        editPreviewBmp = null
    }

    val multiGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        val targetId = pendingProfileId
        pendingProfileId = null
        if (uris.isNotEmpty()) {
            if (!targetId.isNullOrBlank()) {
                selectedTargetProfileId = targetId
                viewModel.addMultipleAnglesToProfileFromUris(targetId, uris)
            } else {
                val chosenName = newProfileName.trim().takeIf { it.isNotBlank() }
                newProfileName = ""
                viewModel.createFaceProfileFromUris(uris, chosenName)
            }
        }
    }

    val replaceGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val replaceTarget = pendingReplacePair
        pendingReplacePair = null
        if (uri != null && replaceTarget != null) {
            viewModel.replaceFaceAngleFromUri(replaceTarget.first, replaceTarget.second, uri)
            editingFacePair = null
        }
    }

    val angleCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val replaceTarget = pendingReplacePair
        val targetId = pendingProfileId
        val file = pendingCameraFile
        pendingReplacePair = null
        pendingProfileId = null
        if (success && file != null && file.exists()) {
            if (replaceTarget != null) {
                viewModel.replaceFaceAngleFromFile(replaceTarget.first, replaceTarget.second, file.absolutePath)
                editingFacePair = null
            } else if (!targetId.isNullOrBlank()) {
                selectedTargetProfileId = targetId
                viewModel.addAngleToProfileFromFile(targetId, file.absolutePath)
            } else {
                val chosenName = newProfileName.trim().takeIf { it.isNotBlank() }
                newProfileName = ""
                viewModel.createFaceProfileFromFile(file.absolutePath, chosenName)
            }
        }
    }

    fun launchGalleryFor(profileId: String?) {
        pendingReplacePair = null
        pendingProfileId = profileId
        multiGalleryPicker.launch("image/*")
    }

    fun launchCameraFor(profileId: String?) {
        pendingReplacePair = null
        pendingProfileId = profileId
        val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "profile_angle")
        pendingCameraFile = file
        angleCameraLauncher.launch(uri)
    }

    fun launchReplaceGallery(profileId: String, angleId: String) {
        pendingProfileId = null
        pendingReplacePair = profileId to angleId
        replaceGalleryPicker.launch("image/*")
    }

    fun launchReplaceCamera(profileId: String, angleId: String) {
        pendingProfileId = null
        pendingReplacePair = profileId to angleId
        val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "replace_face")
        pendingCameraFile = file
        angleCameraLauncher.launch(uri)
    }

    val activeEditPair = editingFacePair
    val cachedEditBmp = activeEditPair?.let { (_, angleId) -> viewModel.angleBitmapCache[angleId] }
    var lazyEditBmp by remember(activeEditPair) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(activeEditPair, cachedEditBmp) {
        if (activeEditPair == null || cachedEditBmp != null) {
            lazyEditBmp = null
            return@LaunchedEffect
        }
        val (profId, angId) = activeEditPair
        val fPath = viewModel.faceProfiles.find { it.id == profId }?.angles?.find { it.id == angId }?.filePath
        if (!fPath.isNullOrBlank()) {
            val loaded = withContext(Dispatchers.IO) {
                NativeStorageHelper.loadBitmapFromFile(fPath, 900)
            }
            if (loaded != null) {
                viewModel.angleBitmapCache[angId] = loaded
                lazyEditBmp = loaded
            }
        }
    }
    val editSourceBmp = cachedEditBmp ?: lazyEditBmp

    LaunchedEffect(
        activeEditPair,
        editSourceBmp,
        editFlipH,
        editBaseRotateDeg,
        editTiltDeg,
        editBrightness,
        editContrast,
        editWarmth
    ) {
        if (activeEditPair == null || editSourceBmp == null) {
            editPreviewBmp = null
            return@LaunchedEffect
        }
        val totalRot = editBaseRotateDeg + editTiltDeg
        val preview = withContext(Dispatchers.Default) {
            val maxSide = 360f
            val scale = (maxSide / maxOf(editSourceBmp.width, editSourceBmp.height).coerceAtLeast(1)).coerceAtMost(1f)
            val base = if (scale < 0.99f) {
                Bitmap.createScaledBitmap(
                    editSourceBmp,
                    (editSourceBmp.width * scale).toInt().coerceAtLeast(1),
                    (editSourceBmp.height * scale).toInt().coerceAtLeast(1),
                    true
                )
            } else editSourceBmp
            NativeFaceSwapEngine.transformFaceBitmapForEdit(
                src = base,
                flipHorizontal = editFlipH,
                rotateDeg = totalRot,
                brightness = editBrightness,
                contrast = editContrast,
                warmth = editWarmth
            )
        }
        editPreviewBmp = preview
    }

    Dialog(
        onDismissRequest = {
            if (editingFacePair != null) {
                editingFacePair = null
            } else {
                onDismiss()
            }
        },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .heightIn(max = 720.dp),
            shape = RoundedCornerShape(26.dp),
            color = StudioColors.SurfaceContainerLow,
            tonalElevation = 6.dp
        ) {
            if (activeEditPair != null) {
                val (editProfId, editAngleId) = activeEditPair
                val editProfile = viewModel.faceProfiles.find { it.id == editProfId }
                val previewToShow = editPreviewBmp
                    ?: viewModel.angleBitmapCache[editAngleId]
                    ?: viewModel.angleCutoutCache[editAngleId]

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    StudioSheetDragHandle()
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(StudioColors.PrimaryContainer),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.Edit, contentDescription = null, tint = StudioColors.Primary, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text(
                                    "Edit Face · ${editProfile?.name ?: "Profile"}",
                                    color = StudioColors.TextPrimary,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    "Replace photo, flip, rotate, adjust tone, or delete",
                                    color = StudioColors.TextSecondary,
                                    fontSize = 11.sp
                                )
                            }
                        }
                        IconButton(onClick = { editingFacePair = null }, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Default.Close, contentDescription = "Back", tint = StudioColors.TextSecondary, modifier = Modifier.size(20.dp))
                        }
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .background(StudioColors.SurfaceContainerLowest),
                        contentAlignment = Alignment.Center
                    ) {
                        if (previewToShow != null) {
                            Image(
                                bitmap = previewToShow.asImageBitmap(),
                                contentDescription = null,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxSize().padding(10.dp)
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        StudioTonalActionButton(
                            label = "Replace Gallery",
                            icon = Icons.Default.PhotoLibrary,
                            onClick = { launchReplaceGallery(editProfId, editAngleId) },
                            containerColor = StudioColors.PrimaryContainer,
                            contentColor = StudioColors.OnPrimaryContainer,
                            iconTint = StudioColors.Primary,
                            modifier = Modifier.weight(1f)
                        )
                        StudioTonalActionButton(
                            label = "Retake Camera",
                            icon = Icons.Default.CameraAlt,
                            onClick = { launchReplaceCamera(editProfId, editAngleId) },
                            containerColor = StudioColors.SecondaryContainer,
                            contentColor = StudioColors.OnSecondaryContainer,
                            iconTint = StudioColors.Secondary,
                            modifier = Modifier.weight(1f)
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        StudioFilterChip(
                            label = "Flip",
                            selected = editFlipH,
                            icon = Icons.Default.Flip,
                            onClick = { editFlipH = !editFlipH },
                            modifier = Modifier.weight(1f)
                        )
                        StudioFilterChip(
                            label = "-90°",
                            selected = false,
                            icon = Icons.Default.RotateLeft,
                            onClick = { editBaseRotateDeg = (editBaseRotateDeg - 90f) % 360f },
                            modifier = Modifier.weight(1f)
                        )
                        StudioFilterChip(
                            label = "+90°",
                            selected = false,
                            icon = Icons.Default.RotateRight,
                            onClick = { editBaseRotateDeg = (editBaseRotateDeg + 90f) % 360f },
                            modifier = Modifier.weight(1f)
                        )
                        StudioFilterChip(
                            label = "Reset",
                            selected = false,
                            icon = Icons.Default.RestartAlt,
                            onClick = {
                                editFlipH = false
                                editBaseRotateDeg = 0f
                                editTiltDeg = 0f
                                editBrightness = 0f
                                editContrast = 0f
                                editWarmth = 0f
                            },
                            modifier = Modifier.weight(1f)
                        )
                    }

                    StudioSectionCard {
                        StudioSliderRow(
                            label = "Tilt",
                            valueText = "${editTiltDeg.toInt()}°",
                            value = editTiltDeg,
                            onValueChange = { editTiltDeg = it },
                            valueRange = -20f..20f,
                            accentColor = StudioColors.Secondary
                        )
                        StudioSliderRow(
                            label = "Brightness",
                            valueText = "${editBrightness.toInt()}",
                            value = editBrightness,
                            onValueChange = { editBrightness = it },
                            valueRange = -35f..35f
                        )
                        StudioSliderRow(
                            label = "Contrast",
                            valueText = "${editContrast.toInt()}",
                            value = editContrast,
                            onValueChange = { editContrast = it },
                            valueRange = -35f..35f
                        )
                        StudioSliderRow(
                            label = "Warmth",
                            valueText = "${editWarmth.toInt()}",
                            value = editWarmth,
                            onValueChange = { editWarmth = it },
                            valueRange = -30f..30f,
                            accentColor = StudioColors.Warning
                        )
                    }

                    HorizontalDivider(color = StudioColors.SurfaceContainerHighest, thickness = 1.dp)

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                viewModel.removeAngleFromProfile(editProfId, editAngleId)
                                editingFacePair = null
                            },
                            shape = RoundedCornerShape(14.dp),
                            border = BorderStroke(1.dp, StudioColors.Danger),
                            modifier = Modifier.height(44.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp)
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete Face", tint = StudioColors.Danger, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Delete", color = StudioColors.Danger, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }

                        OutlinedButton(
                            onClick = { editingFacePair = null },
                            shape = RoundedCornerShape(14.dp),
                            border = BorderStroke(1.dp, StudioColors.OutlineVariant),
                            modifier = Modifier.weight(1f).height(44.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Text("Cancel", color = StudioColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }

                        Button(
                            onClick = {
                                viewModel.applyFaceEditTransform(
                                    profileId = editProfId,
                                    angleId = editAngleId,
                                    flipHorizontal = editFlipH,
                                    rotateDeg = editBaseRotateDeg + editTiltDeg,
                                    brightness = editBrightness,
                                    contrast = editContrast,
                                    warmth = editWarmth
                                )
                                editingFacePair = null
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = StudioColors.Tertiary,
                                contentColor = StudioColors.OnPrimary
                            ),
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.weight(1f).height(44.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Icon(Icons.Default.Check, contentDescription = "Save Face", modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Save", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    StudioSheetDragHandle()
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(StudioColors.PrimaryContainer),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.Face, contentDescription = null, tint = StudioColors.Primary, modifier = Modifier.size(20.dp))
                            }
                            Spacer(Modifier.width(10.dp))
                            val totalSavedAngles = viewModel.faceProfiles.sumOf { it.angles.size }
                            val storageMb = viewModel.profileStorageStats.second
                            Column {
                                Text(
                                    "Face Vault (${viewModel.faceProfiles.size})",
                                    color = StudioColors.TextPrimary,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    "Local Storage · Unlimited Angles · $totalSavedAngles saved (${String.format("%.1f", storageMb)} MB)",
                                    color = StudioColors.Tertiary,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (viewModel.detectedFaces.isNotEmpty() && viewModel.faceProfiles.isNotEmpty()) {
                                StudioFilterChip(
                                    label = "Auto-Match",
                                    selected = true,
                                    icon = Icons.Default.AutoAwesome,
                                    selectedContainerColor = StudioColors.SecondaryContainer,
                                    selectedContentColor = StudioColors.OnSecondaryContainer,
                                    onClick = { viewModel.autoMatchAllTargetFaces() }
                                )
                            }
                            IconButton(onClick = onDismiss, modifier = Modifier.size(36.dp)) {
                                Icon(Icons.Default.Close, contentDescription = "Close", tint = StudioColors.TextSecondary, modifier = Modifier.size(20.dp))
                            }
                        }
                    }

                    // Create New Profile Card
                    StudioSectionCard {
                        Text(
                            "Create New Profile",
                            color = StudioColors.TextPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = newProfileName,
                                onValueChange = { newProfileName = it },
                                placeholder = { Text("Profile name (e.g. Alex)", color = StudioColors.TextMuted, fontSize = 13.sp) },
                                singleLine = true,
                                shape = RoundedCornerShape(14.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = StudioColors.TextPrimary,
                                    unfocusedTextColor = StudioColors.TextPrimary,
                                    focusedBorderColor = StudioColors.Primary,
                                    unfocusedBorderColor = StudioColors.OutlineVariant,
                                    focusedContainerColor = StudioColors.SurfaceContainerLowest,
                                    unfocusedContainerColor = StudioColors.SurfaceContainerLowest
                                ),
                                modifier = Modifier.weight(1f)
                            )
                            Button(
                                onClick = {
                                    val createdId = viewModel.createEmptyProfile(newProfileName)
                                    newProfileName = ""
                                    selectedTargetProfileId = createdId
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = StudioColors.Tertiary,
                                    contentColor = StudioColors.OnPrimary
                                ),
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.height(52.dp),
                                contentPadding = PaddingValues(horizontal = 14.dp)
                            ) {
                                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Create", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            StudioTonalActionButton(
                                label = "New + Multi-Photos",
                                icon = Icons.Default.PhotoLibrary,
                                onClick = { launchGalleryFor(null) },
                                containerColor = StudioColors.PrimaryContainer,
                                contentColor = StudioColors.OnPrimaryContainer,
                                iconTint = StudioColors.Primary,
                                modifier = Modifier.weight(1f)
                            )
                            StudioTonalActionButton(
                                label = "New + Camera",
                                icon = Icons.Default.CameraAlt,
                                onClick = { launchCameraFor(null) },
                                containerColor = StudioColors.SecondaryContainer,
                                contentColor = StudioColors.OnSecondaryContainer,
                                iconTint = StudioColors.Secondary,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    // Batch Face Angle Scan Progress & Report
                    if (viewModel.isBatchImportingFaces) {
                        StudioSectionCard(containerColor = StudioColors.SecondaryContainer) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                CircularProgressIndicator(
                                    color = StudioColors.Secondary,
                                    strokeWidth = 2.dp,
                                    modifier = Modifier.size(18.dp)
                                )
                                Text(
                                    viewModel.batchImportStatus ?: "Scanning face angles & blocking duplicates...",
                                    color = StudioColors.OnSecondaryContainer,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    }

                    viewModel.lastMultiImportReport?.let { report ->
                        StudioSectionCard(
                            containerColor = if (report.addedCount > 0) StudioColors.TertiaryContainer else StudioColors.WarningContainer
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "Scan Result (${report.profileName}): +${report.addedCount} added",
                                    color = if (report.addedCount > 0) StudioColors.Tertiary else StudioColors.Warning,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                IconButton(
                                    onClick = { viewModel.clearMultiImportReport() },
                                    modifier = Modifier.size(24.dp)
                                ) {
                                    Icon(Icons.Default.Close, contentDescription = "Dismiss report", tint = StudioColors.TextSecondary, modifier = Modifier.size(16.dp))
                                }
                            }
                            if (report.addedLabels.isNotEmpty()) {
                                Text(
                                    "Angles: ${report.addedLabels.joinToString(", ")}",
                                    color = Color.White,
                                    fontSize = 11.sp
                                )
                            }
                            if (report.skippedDuplicateCount > 0 || report.skippedNoFaceCount > 0) {
                                Text(
                                    "Skipped: ${report.skippedDuplicateCount} duplicate(s) · ${report.skippedNoFaceCount} no face",
                                    color = StudioColors.Danger,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }

                    // Select Target Profile to Add Faces
                    if (viewModel.faceProfiles.isNotEmpty()) {
                        val destProfile = viewModel.faceProfiles.find { it.id == selectedTargetProfileId }
                            ?: viewModel.faceProfiles.first()
                        StudioSectionCard {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Add Angles To", color = StudioColors.Primary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    destProfile.name,
                                    color = StudioColors.TextPrimary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                viewModel.faceProfiles.forEach { prof ->
                                    StudioFilterChip(
                                        label = "${prof.name} (${prof.angles.size})",
                                        selected = prof.id == destProfile.id,
                                        onClick = { selectedTargetProfileId = prof.id }
                                    )
                                }
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                StudioTonalActionButton(
                                    label = "Multi -> ${destProfile.name}",
                                    icon = Icons.Default.AddPhotoAlternate,
                                    onClick = { launchGalleryFor(destProfile.id) },
                                    containerColor = StudioColors.PrimaryContainer,
                                    contentColor = StudioColors.OnPrimaryContainer,
                                    iconTint = StudioColors.Primary,
                                    modifier = Modifier.weight(1f)
                                )
                                StudioTonalActionButton(
                                    label = "Camera -> ${destProfile.name}",
                                    icon = Icons.Default.AddAPhoto,
                                    onClick = { launchCameraFor(destProfile.id) },
                                    containerColor = StudioColors.SecondaryContainer,
                                    contentColor = StudioColors.OnSecondaryContainer,
                                    iconTint = StudioColors.Secondary,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }

                    if (viewModel.faceProfiles.isEmpty()) {
                        StudioSectionCard {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(100.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    "No profiles saved yet. Tap Create or pick a Gallery/Camera photo above to build a profile.",
                                    color = StudioColors.TextSecondary,
                                    fontSize = 13.sp
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f, fill = false),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            items(viewModel.faceProfiles, key = { it.id }) { profile ->
                                val isActive = viewModel.activeProfileId == profile.id
                                val primaryCutout = viewModel.getCutoutThumbForProfile(profile.id)
                                val isEditing = editingProfileId == profile.id
                                val editableAngleId = profile.selectedAngleId ?: profile.angles.firstOrNull()?.id

                                StudioSectionCard(
                                    containerColor = if (isActive) Color(0xFF1A2138) else StudioColors.SurfaceContainer
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(48.dp)
                                                .clip(CircleShape)
                                                .background(StudioColors.SurfaceContainerHigh)
                                                .border(
                                                    width = if (isActive) 2.dp else 1.dp,
                                                    color = if (isActive) StudioColors.Primary else StudioColors.OutlineVariant,
                                                    shape = CircleShape
                                                )
                                                .clickable {
                                                    selectedTargetProfileId = profile.id
                                                    viewModel.scanAndSelectProfileForSwap(profile.id)
                                                },
                                            contentAlignment = Alignment.Center
                                        ) {
                                            if (primaryCutout != null) {
                                                Image(
                                                    bitmap = primaryCutout.asImageBitmap(),
                                                    contentDescription = null,
                                                    contentScale = ContentScale.Fit,
                                                    modifier = Modifier.fillMaxSize().padding(3.dp)
                                                )
                                            } else {
                                                Icon(Icons.Default.Face, contentDescription = null, tint = StudioColors.TextMuted, modifier = Modifier.size(24.dp))
                                            }
                                        }

                                        Column(modifier = Modifier.weight(1f)) {
                                            if (isEditing) {
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                                ) {
                                                    OutlinedTextField(
                                                        value = editingNameDraft,
                                                        onValueChange = { editingNameDraft = it },
                                                        singleLine = true,
                                                        shape = RoundedCornerShape(12.dp),
                                                        colors = OutlinedTextFieldDefaults.colors(
                                                            focusedTextColor = StudioColors.TextPrimary,
                                                            unfocusedTextColor = StudioColors.TextPrimary,
                                                            focusedBorderColor = StudioColors.Primary,
                                                            unfocusedBorderColor = StudioColors.OutlineVariant
                                                        ),
                                                        modifier = Modifier.weight(1f)
                                                    )
                                                    IconButton(
                                                        onClick = {
                                                            viewModel.renameFaceProfile(profile.id, editingNameDraft)
                                                            editingProfileId = null
                                                        },
                                                        modifier = Modifier.size(34.dp)
                                                    ) {
                                                        Icon(Icons.Default.Check, contentDescription = "Save name", tint = StudioColors.Tertiary, modifier = Modifier.size(18.dp))
                                                    }
                                                }
                                            } else {
                                                Row(verticalAlignment = Alignment.CenterVertically) {
                                                    Text(
                                                        profile.name,
                                                        color = StudioColors.TextPrimary,
                                                        fontSize = 14.sp,
                                                        fontWeight = FontWeight.Bold,
                                                        maxLines = 1,
                                                        overflow = TextOverflow.Ellipsis,
                                                        modifier = Modifier.weight(1f, fill = false)
                                                    )
                                                    IconButton(
                                                        onClick = {
                                                            editingProfileId = profile.id
                                                            editingNameDraft = profile.name
                                                        },
                                                        modifier = Modifier.size(28.dp)
                                                    ) {
                                                        Icon(Icons.Default.Edit, contentDescription = "Rename", tint = StudioColors.TextSecondary, modifier = Modifier.size(14.dp))
                                                    }
                                                }
                                                Text(
                                                    "${profile.angles.size} ${if (profile.angles.size == 1) "face saved" else "faces saved"}",
                                                    color = StudioColors.TextSecondary,
                                                    fontSize = 11.sp
                                                )
                                            }
                                        }

                                        StudioFilterChip(
                                            label = if (isActive) "Active" else "Use",
                                            selected = true,
                                            selectedContainerColor = if (isActive) StudioColors.TertiaryContainer else StudioColors.PrimaryContainer,
                                            selectedContentColor = if (isActive) StudioColors.Tertiary else StudioColors.OnPrimaryContainer,
                                            onClick = {
                                                selectedTargetProfileId = profile.id
                                                viewModel.scanAndSelectProfileForSwap(profile.id)
                                            }
                                        )

                                        IconButton(
                                            onClick = { viewModel.removeFaceProfile(profile.id) },
                                            modifier = Modifier.size(32.dp)
                                        ) {
                                            Icon(Icons.Default.Delete, contentDescription = "Delete profile", tint = StudioColors.Danger, modifier = Modifier.size(18.dp))
                                        }
                                    }

                                    if (profile.angles.isEmpty()) {
                                        Text(
                                            "No face added to '${profile.name}' yet. Add photos below.",
                                            color = StudioColors.TextSecondary,
                                            fontSize = 11.sp
                                        )
                                    } else {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .horizontalScroll(rememberScrollState()),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            profile.angles.forEach { angle ->
                                                val isAngleSelected = profile.selectedAngleId == angle.id
                                                val angleBmp = viewModel.angleCutoutCache[angle.id] ?: viewModel.angleBitmapCache[angle.id]
                                                Box(
                                                    modifier = Modifier
                                                        .size(62.dp)
                                                        .clip(RoundedCornerShape(12.dp))
                                                        .background(StudioColors.SurfaceContainerLowest)
                                                        .border(
                                                            width = if (isAngleSelected) 2.dp else 1.dp,
                                                            color = if (isAngleSelected) StudioColors.Primary else StudioColors.OutlineVariant,
                                                            shape = RoundedCornerShape(12.dp)
                                                        )
                                                        .clickable {
                                                            selectedTargetProfileId = profile.id
                                                            viewModel.selectProfileAngle(profile.id, angle.id)
                                                        }
                                                ) {
                                                    if (angleBmp != null) {
                                                        Image(
                                                            bitmap = angleBmp.asImageBitmap(),
                                                            contentDescription = null,
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
                                                            .background(StudioColors.DangerContainer)
                                                            .clickable { viewModel.removeAngleFromProfile(profile.id, angle.id) },
                                                        contentAlignment = Alignment.Center
                                                    ) {
                                                        Icon(Icons.Default.Close, contentDescription = "Delete face", tint = Color.White, modifier = Modifier.size(10.dp))
                                                    }
                                                    Box(
                                                        modifier = Modifier
                                                            .align(Alignment.BottomEnd)
                                                            .padding(2.dp)
                                                            .size(18.dp)
                                                            .clip(CircleShape)
                                                            .background(StudioColors.PrimaryContainer)
                                                            .clickable { openFaceEditor(profile.id, angle.id) },
                                                        contentAlignment = Alignment.Center
                                                    ) {
                                                        Icon(Icons.Default.Edit, contentDescription = "Edit face", tint = StudioColors.OnPrimaryContainer, modifier = Modifier.size(10.dp))
                                                    }
                                                    Text(
                                                        "${angle.yawDeg.toInt()}°",
                                                        color = StudioColors.Secondary,
                                                        fontSize = 8.sp,
                                                        fontWeight = FontWeight.Bold,
                                                        modifier = Modifier
                                                            .align(Alignment.BottomStart)
                                                            .padding(2.dp)
                                                            .clip(RoundedCornerShape(4.dp))
                                                            .background(StudioColors.FloatingGlass)
                                                            .padding(horizontal = 3.dp, vertical = 1.dp)
                                                    )
                                                }
                                            }
                                        }
                                    }

                                    // 5-Slot Interactive Angle Coverage Checklist (Unlimited angles per direction)
                                    run {
                                        val frontList = profile.angles.filter {
                                            it.bucket == FaceAngleBucket.FRONT || (abs(it.yawDeg) <= 10f && abs(it.pitchDeg) <= 13f)
                                        }
                                        val leftList = profile.angles.filter {
                                            it.bucket == FaceAngleBucket.LEFT_SLIGHT ||
                                                it.bucket == FaceAngleBucket.LEFT_3QUARTER ||
                                                it.bucket == FaceAngleBucket.LEFT_PROFILE ||
                                                it.yawDeg < -9f
                                        }
                                        val rightList = profile.angles.filter {
                                            it.bucket == FaceAngleBucket.RIGHT_SLIGHT ||
                                                it.bucket == FaceAngleBucket.RIGHT_3QUARTER ||
                                                it.bucket == FaceAngleBucket.RIGHT_PROFILE ||
                                                it.yawDeg > 9f
                                        }
                                        val upList = profile.angles.filter {
                                            it.bucket == FaceAngleBucket.TILT_UP || it.pitchDeg > 12f
                                        }
                                        val downList = profile.angles.filter {
                                            it.bucket == FaceAngleBucket.TILT_DOWN || it.pitchDeg < -12f
                                        }
                                        val coverageSlots = listOf(
                                            "Front" to frontList,
                                            "Left" to leftList,
                                            "Right" to rightList,
                                            "Up" to upList,
                                            "Down" to downList
                                        )
                                        val coveredCount = coverageSlots.count { it.second.isNotEmpty() }

                                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Text(
                                                    "Angle Coverage (Unlimited)",
                                                    color = StudioColors.TextSecondary,
                                                    fontSize = 10.sp,
                                                    fontWeight = FontWeight.SemiBold
                                                )
                                                Text(
                                                    if (coveredCount == 5) "5/5 Zones · ${profile.angles.size} Total" else "$coveredCount/5 Zones · ${profile.angles.size} Saved",
                                                    color = if (coveredCount == 5) StudioColors.Tertiary else StudioColors.Secondary,
                                                    fontSize = 10.sp,
                                                    fontWeight = FontWeight.Bold
                                                )
                                            }
                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.spacedBy(5.dp)
                                            ) {
                                                coverageSlots.forEach { (slotLabel, list) ->
                                                    val filled = list.isNotEmpty()
                                                    val activeVariant = list.find { it.id == profile.selectedAngleId } ?: list.firstOrNull()
                                                    val isSelSlot = activeVariant != null && profile.selectedAngleId == activeVariant.id
                                                    StudioFilterChip(
                                                        label = if (list.size > 1) "$slotLabel(${list.size})" else slotLabel,
                                                        selected = filled,
                                                        icon = if (filled) Icons.Default.Check else null,
                                                        selectedContainerColor = if (isSelSlot) StudioColors.TertiaryContainer else StudioColors.SurfaceContainerHighest,
                                                        selectedContentColor = if (isSelSlot) StudioColors.Tertiary else StudioColors.TextPrimary,
                                                        onClick = {
                                                            selectedTargetProfileId = profile.id
                                                            if (list.isNotEmpty()) {
                                                                val curIdx = list.indexOfFirst { it.id == profile.selectedAngleId }
                                                                val nextVariant = if (curIdx >= 0) list[(curIdx + 1) % list.size] else list.first()
                                                                viewModel.selectProfileAngle(profile.id, nextVariant.id)
                                                            } else {
                                                                launchGalleryFor(profile.id)
                                                            }
                                                        },
                                                        modifier = Modifier.weight(1f)
                                                    )
                                                }
                                            }
                                        }
                                    }

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        StudioTonalActionButton(
                                            label = "+ Multi",
                                            icon = Icons.Default.AddPhotoAlternate,
                                            onClick = { launchGalleryFor(profile.id) },
                                            containerColor = StudioColors.PrimaryContainer,
                                            contentColor = StudioColors.OnPrimaryContainer,
                                            iconTint = StudioColors.Primary,
                                            modifier = Modifier.weight(1f)
                                        )
                                        StudioTonalActionButton(
                                            label = "+ Cam",
                                            icon = Icons.Default.AddAPhoto,
                                            onClick = { launchCameraFor(profile.id) },
                                            containerColor = StudioColors.SecondaryContainer,
                                            contentColor = StudioColors.OnSecondaryContainer,
                                            iconTint = StudioColors.Secondary,
                                            modifier = Modifier.weight(1f)
                                        )
                                        if (editableAngleId != null) {
                                            StudioTonalActionButton(
                                                label = "Edit",
                                                icon = Icons.Default.Edit,
                                                onClick = { openFaceEditor(profile.id, editableAngleId) },
                                                iconTint = StudioColors.Warning,
                                                modifier = Modifier.weight(1f)
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
