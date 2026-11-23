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
import com.facemorph.studio.viewmodel.StudioViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

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

    val angleGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val replaceTarget = pendingReplacePair
        val targetId = pendingProfileId
        pendingReplacePair = null
        pendingProfileId = null
        if (uri != null) {
            if (replaceTarget != null) {
                viewModel.replaceFaceAngleFromUri(replaceTarget.first, replaceTarget.second, uri)
                editingFacePair = null
            } else if (!targetId.isNullOrBlank()) {
                selectedTargetProfileId = targetId
                viewModel.addAngleToProfileFromUri(targetId, uri)
            } else {
                val chosenName = newProfileName.trim().takeIf { it.isNotBlank() }
                newProfileName = ""
                viewModel.createFaceProfileFromUri(uri, chosenName)
            }
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
        angleGalleryPicker.launch("image/*")
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
        angleGalleryPicker.launch("image/*")
    }

    fun launchReplaceCamera(profileId: String, angleId: String) {
        pendingProfileId = null
        pendingReplacePair = profileId to angleId
        val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "replace_face")
        pendingCameraFile = file
        angleCameraLauncher.launch(uri)
    }

    val activeEditPair = editingFacePair
    val editSourceBmp = activeEditPair?.let { (_, angleId) -> viewModel.angleBitmapCache[angleId] }

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
                .heightIn(max = 700.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xFF0A1020),
            border = BorderStroke(1.dp, Color(0xFF1E293B))
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
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(30.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF312E81)),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.Edit, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(16.dp))
                            }
                            Spacer(Modifier.width(8.dp))
                            Column {
                                Text(
                                    "Edit Face · ${editProfile?.name ?: "Profile"}",
                                    color = Color.White,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    "Replace photo, flip, rotate, adjust tone, or delete",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 10.sp
                                )
                            }
                        }
                        IconButton(onClick = { editingFacePair = null }, modifier = Modifier.size(30.dp)) {
                            Icon(Icons.Default.Close, contentDescription = "Back", tint = Color(0xFF94A3B8), modifier = Modifier.size(18.dp))
                        }
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFF060A13))
                            .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(12.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        if (previewToShow != null) {
                            Image(
                                bitmap = previewToShow.asImageBitmap(),
                                contentDescription = null,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxSize().padding(8.dp)
                            )
                        }
                    }

                    // Replace photo row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = { launchReplaceGallery(editProfId, editAngleId) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF312E81)),
                            shape = RoundedCornerShape(9.dp),
                            modifier = Modifier.weight(1f).height(36.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Replace Gallery", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Button(
                            onClick = { launchReplaceCamera(editProfId, editAngleId) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0369A1)),
                            shape = RoundedCornerShape(9.dp),
                            modifier = Modifier.weight(1f).height(36.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Retake Camera", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }

                    // Orientation quick controls
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (editFlipH) Color(0xFF4F46E5) else Color(0xFF111827))
                                .border(1.dp, if (editFlipH) Color(0xFF818CF8) else Color(0xFF334155), RoundedCornerShape(8.dp))
                                .clickable { editFlipH = !editFlipH }
                                .padding(vertical = 7.dp)
                        ) {
                            Icon(Icons.Default.Flip, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Flip", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFF111827))
                                .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                                .clickable { editBaseRotateDeg = (editBaseRotateDeg - 90f) % 360f }
                                .padding(vertical = 7.dp)
                        ) {
                            Icon(Icons.Default.RotateLeft, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("-90°", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFF111827))
                                .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                                .clickable { editBaseRotateDeg = (editBaseRotateDeg + 90f) % 360f }
                                .padding(vertical = 7.dp)
                        ) {
                            Icon(Icons.Default.RotateRight, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("+90°", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFF111827))
                                .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                                .clickable {
                                    editFlipH = false
                                    editBaseRotateDeg = 0f
                                    editTiltDeg = 0f
                                    editBrightness = 0f
                                    editContrast = 0f
                                    editWarmth = 0f
                                }
                                .padding(vertical = 7.dp)
                        ) {
                            Icon(Icons.Default.RestartAlt, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Reset", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }

                    // Sliders
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Tilt ${editTiltDeg.toInt()}°", color = Color(0xFFCBD5E1), fontSize = 11.sp, modifier = Modifier.width(84.dp))
                            Slider(
                                value = editTiltDeg,
                                onValueChange = { editTiltDeg = it },
                                valueRange = -20f..20f,
                                colors = SliderDefaults.colors(thumbColor = Color(0xFF38BDF8), activeTrackColor = Color(0xFF38BDF8)),
                                modifier = Modifier.weight(1f).height(28.dp)
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Bright ${editBrightness.toInt()}", color = Color(0xFFCBD5E1), fontSize = 11.sp, modifier = Modifier.width(84.dp))
                            Slider(
                                value = editBrightness,
                                onValueChange = { editBrightness = it },
                                valueRange = -35f..35f,
                                colors = SliderDefaults.colors(thumbColor = Color(0xFF6366F1), activeTrackColor = Color(0xFF6366F1)),
                                modifier = Modifier.weight(1f).height(28.dp)
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Contrast ${editContrast.toInt()}", color = Color(0xFFCBD5E1), fontSize = 11.sp, modifier = Modifier.width(84.dp))
                            Slider(
                                value = editContrast,
                                onValueChange = { editContrast = it },
                                valueRange = -35f..35f,
                                colors = SliderDefaults.colors(thumbColor = Color(0xFF6366F1), activeTrackColor = Color(0xFF6366F1)),
                                modifier = Modifier.weight(1f).height(28.dp)
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Warmth ${editWarmth.toInt()}", color = Color(0xFFCBD5E1), fontSize = 11.sp, modifier = Modifier.width(84.dp))
                            Slider(
                                value = editWarmth,
                                onValueChange = { editWarmth = it },
                                valueRange = -30f..30f,
                                colors = SliderDefaults.colors(thumbColor = Color(0xFFFBBF24), activeTrackColor = Color(0xFFFBBF24)),
                                modifier = Modifier.weight(1f).height(28.dp)
                            )
                        }
                    }

                    HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                viewModel.removeAngleFromProfile(editProfId, editAngleId)
                                editingFacePair = null
                            },
                            shape = RoundedCornerShape(9.dp),
                            border = BorderStroke(1.dp, Color(0xFFEF4444)),
                            modifier = Modifier.height(38.dp),
                            contentPadding = PaddingValues(horizontal = 10.dp)
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete Face", tint = Color(0xFFF87171), modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Delete", color = Color(0xFFF87171), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }

                        OutlinedButton(
                            onClick = { editingFacePair = null },
                            shape = RoundedCornerShape(9.dp),
                            border = BorderStroke(1.dp, Color(0xFF475569)),
                            modifier = Modifier.weight(1f).height(38.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Cancel", tint = Color(0xFFCBD5E1), modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Cancel", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
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
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                            shape = RoundedCornerShape(9.dp),
                            modifier = Modifier.weight(1f).height(38.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Icon(Icons.Default.Check, contentDescription = "Save Face", tint = Color.White, modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Save", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Header
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(30.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF312E81)),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.Face, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(8.dp))
                            Column {
                                Text(
                                    "Face Profiles (${viewModel.faceProfiles.size})",
                                    color = Color.White,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    "Create profiles, add/edit/delete faces, and swap 96%–100% match",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 10.sp
                                )
                            }
                        }

                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            if (viewModel.detectedFaces.isNotEmpty() && viewModel.faceProfiles.isNotEmpty()) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(Color(0xFF0F172A))
                                        .border(1.dp, Color(0xFF0EA5E9), RoundedCornerShape(8.dp))
                                        .clickable { viewModel.autoMatchAllTargetFaces() }
                                        .padding(horizontal = 8.dp, vertical = 5.dp)
                                ) {
                                    Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(13.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Auto-Match", color = Color(0xFF38BDF8), fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                            IconButton(onClick = onDismiss, modifier = Modifier.size(30.dp)) {
                                Icon(Icons.Default.Close, contentDescription = "Close", tint = Color(0xFF94A3B8), modifier = Modifier.size(18.dp))
                            }
                        }
                    }

                    // Create New Profile Section
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFF111827))
                            .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(12.dp))
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            "Create New Profile",
                            color = Color(0xFFE2E8F0),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = newProfileName,
                                onValueChange = { newProfileName = it },
                                placeholder = { Text("Profile name (e.g. Alex)", color = Color(0xFF64748B), fontSize = 12.sp) },
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = Color.White,
                                    unfocusedTextColor = Color.White,
                                    focusedBorderColor = Color(0xFF6366F1),
                                    unfocusedBorderColor = Color(0xFF334155),
                                    focusedContainerColor = Color(0xFF090F1D),
                                    unfocusedContainerColor = Color(0xFF090F1D)
                                ),
                                modifier = Modifier.weight(1f)
                            )
                            Button(
                                onClick = {
                                    val createdId = viewModel.createEmptyProfile(newProfileName)
                                    newProfileName = ""
                                    selectedTargetProfileId = createdId
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                                shape = RoundedCornerShape(9.dp),
                                modifier = Modifier.height(50.dp),
                                contentPadding = PaddingValues(horizontal = 10.dp)
                            ) {
                                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(3.dp))
                                Text("Create", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Button(
                                onClick = { launchGalleryFor(null) },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                                shape = RoundedCornerShape(9.dp),
                                modifier = Modifier.weight(1f).height(36.dp),
                                contentPadding = PaddingValues(horizontal = 8.dp)
                            ) {
                                Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("New + Gallery", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                            }
                            Button(
                                onClick = { launchCameraFor(null) },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                                shape = RoundedCornerShape(9.dp),
                                modifier = Modifier.weight(1f).height(36.dp),
                                contentPadding = PaddingValues(horizontal = 8.dp)
                            ) {
                                Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("New + Camera", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }

                    // Select Specific Profile to Add Faces To
                    if (viewModel.faceProfiles.isNotEmpty()) {
                        val destProfile = viewModel.faceProfiles.find { it.id == selectedTargetProfileId }
                            ?: viewModel.faceProfiles.first()
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF0F172A))
                                .border(1.dp, Color(0xFF312E81), RoundedCornerShape(12.dp))
                                .padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(7.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "Add Face to Selected Profile:",
                                    color = Color(0xFFA5B4FC),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    destProfile.name,
                                    color = Color.White,
                                    fontSize = 11.sp,
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
                                    val isSel = prof.id == destProfile.id
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(if (isSel) Color(0xFF4F46E5) else Color(0xFF1E293B))
                                            .border(
                                                1.dp,
                                                if (isSel) Color(0xFFA5B4FC) else Color(0xFF334155),
                                                RoundedCornerShape(8.dp)
                                            )
                                            .clickable { selectedTargetProfileId = prof.id }
                                            .padding(horizontal = 10.dp, vertical = 5.dp)
                                    ) {
                                        Text(
                                            "${prof.name} (${prof.angles.size})",
                                            color = Color.White,
                                            fontSize = 11.sp,
                                            fontWeight = if (isSel) FontWeight.Bold else FontWeight.Medium,
                                            maxLines = 1
                                        )
                                    }
                                }
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(Color(0xFF1E1B4B))
                                        .border(1.dp, Color(0xFF6366F1), RoundedCornerShape(8.dp))
                                        .clickable { launchGalleryFor(destProfile.id) }
                                        .padding(horizontal = 8.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Add Gallery -> ${destProfile.name}", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(Color(0xFF082F49))
                                        .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(8.dp))
                                        .clickable { launchCameraFor(destProfile.id) }
                                        .padding(horizontal = 8.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Add Camera -> ${destProfile.name}", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }

                    HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                    if (viewModel.faceProfiles.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(130.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF0F172A))
                                .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(12.dp))
                                .padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "No profiles saved yet. Tap Create or pick a Gallery/Camera photo above to build a profile.",
                                color = Color(0xFF94A3B8),
                                fontSize = 12.sp
                            )
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

                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(if (isActive) Color(0xFF141B36) else Color(0xFF111827))
                                        .border(
                                            1.2.dp,
                                            if (isActive) Color(0xFF6366F1) else Color(0xFF1E293B),
                                            RoundedCornerShape(12.dp)
                                        )
                                        .padding(10.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    // Profile Header Row
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(44.dp)
                                                .clip(CircleShape)
                                                .background(Color(0xFF090F1D))
                                                .border(
                                                    1.5.dp,
                                                    if (isActive) Color(0xFF818CF8) else Color(0xFF334155),
                                                    CircleShape
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
                                                    modifier = Modifier.fillMaxSize().padding(2.dp)
                                                )
                                            } else {
                                                Icon(
                                                    Icons.Default.Face,
                                                    contentDescription = null,
                                                    tint = Color(0xFF475569),
                                                    modifier = Modifier.size(22.dp)
                                                )
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
                                                        colors = OutlinedTextFieldDefaults.colors(
                                                            focusedTextColor = Color.White,
                                                            unfocusedTextColor = Color.White,
                                                            focusedBorderColor = Color(0xFF6366F1),
                                                            unfocusedBorderColor = Color(0xFF334155)
                                                        ),
                                                        modifier = Modifier.weight(1f)
                                                    )
                                                    IconButton(
                                                        onClick = {
                                                            viewModel.renameFaceProfile(profile.id, editingNameDraft)
                                                            editingProfileId = null
                                                        },
                                                        modifier = Modifier.size(28.dp)
                                                    ) {
                                                        Icon(Icons.Default.Check, contentDescription = "Save name", tint = Color(0xFF34D399), modifier = Modifier.size(16.dp))
                                                    }
                                                }
                                            } else {
                                                Row(verticalAlignment = Alignment.CenterVertically) {
                                                    Text(
                                                        profile.name,
                                                        color = Color.White,
                                                        fontSize = 13.sp,
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
                                                        modifier = Modifier.size(24.dp)
                                                    ) {
                                                        Icon(Icons.Default.Edit, contentDescription = "Rename", tint = Color(0xFF94A3B8), modifier = Modifier.size(13.dp))
                                                    }
                                                }
                                                Text(
                                                    "${profile.angles.size} ${if (profile.angles.size == 1) "face saved" else "faces saved"}",
                                                    color = Color(0xFF94A3B8),
                                                    fontSize = 10.sp
                                                )
                                            }
                                        }

                                        Text(
                                            if (isActive) "Swap Active" else "Swap This",
                                            color = if (isActive) Color(0xFF0F172A) else Color.White,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(if (isActive) Color(0xFF34D399) else Color(0xFF312E81))
                                                .border(
                                                    1.dp,
                                                    if (isActive) Color(0xFF34D399) else Color(0xFF6366F1),
                                                    RoundedCornerShape(8.dp)
                                                )
                                                .clickable {
                                                    selectedTargetProfileId = profile.id
                                                    viewModel.scanAndSelectProfileForSwap(profile.id)
                                                }
                                                .padding(horizontal = 9.dp, vertical = 5.dp)
                                        )

                                        IconButton(
                                            onClick = { viewModel.removeFaceProfile(profile.id) },
                                            modifier = Modifier.size(28.dp)
                                        ) {
                                            Icon(Icons.Default.Delete, contentDescription = "Delete profile", tint = Color(0xFFF87171), modifier = Modifier.size(16.dp))
                                        }
                                    }

                                    // Saved Cutout Face Thumbnails Strip (pure cutout images, ZERO face labels; edit & delete icons)
                                    if (profile.angles.isEmpty()) {
                                        Text(
                                            "No face added to '${profile.name}' yet. Add a face below.",
                                            color = Color(0xFF94A3B8),
                                            fontSize = 10.sp
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
                                                        .size(58.dp)
                                                        .clip(RoundedCornerShape(10.dp))
                                                        .background(Color(0xFF090F1D))
                                                        .border(
                                                            width = if (isAngleSelected) 2.dp else 1.dp,
                                                            color = if (isAngleSelected) Color(0xFF6366F1) else Color(0xFF334155),
                                                            shape = RoundedCornerShape(10.dp)
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
                                                            .size(17.dp)
                                                            .clip(CircleShape)
                                                            .background(Color(0xDD7F1D1D))
                                                            .clickable { viewModel.removeAngleFromProfile(profile.id, angle.id) },
                                                        contentAlignment = Alignment.Center
                                                    ) {
                                                        Icon(
                                                            Icons.Default.Close,
                                                            contentDescription = "Delete face",
                                                            tint = Color.White,
                                                            modifier = Modifier.size(10.dp)
                                                        )
                                                    }
                                                    Box(
                                                        modifier = Modifier
                                                            .align(Alignment.BottomEnd)
                                                            .padding(2.dp)
                                                            .size(17.dp)
                                                            .clip(CircleShape)
                                                            .background(Color(0xDD312E81))
                                                            .clickable { openFaceEditor(profile.id, angle.id) },
                                                        contentAlignment = Alignment.Center
                                                    ) {
                                                        Icon(
                                                            Icons.Default.Edit,
                                                            contentDescription = "Edit face",
                                                            tint = Color(0xFFA5B4FC),
                                                            modifier = Modifier.size(10.dp)
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    // Add / Edit Face buttons for this Profile
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.Center,
                                            modifier = Modifier
                                                .weight(1f)
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(Color(0xFF1E1B4B))
                                                .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(8.dp))
                                                .clickable { launchGalleryFor(profile.id) }
                                                .padding(horizontal = 6.dp, vertical = 6.dp)
                                        ) {
                                            Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(13.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text("+ Gallery", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                        }
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.Center,
                                            modifier = Modifier
                                                .weight(1f)
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(Color(0xFF082F49))
                                                .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(8.dp))
                                                .clickable { launchCameraFor(profile.id) }
                                                .padding(horizontal = 6.dp, vertical = 6.dp)
                                        ) {
                                            Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(13.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text("+ Camera", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                        }
                                        if (editableAngleId != null) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.Center,
                                                modifier = Modifier
                                                    .weight(1f)
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .background(Color(0xFF1E293B))
                                                    .border(1.dp, Color(0xFF475569), RoundedCornerShape(8.dp))
                                                    .clickable { openFaceEditor(profile.id, editableAngleId) }
                                                    .padding(horizontal = 6.dp, vertical = 6.dp)
                                            ) {
                                                Icon(Icons.Default.Edit, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(13.dp))
                                                Spacer(Modifier.width(4.dp))
                                                Text("Edit Face", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
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
}
