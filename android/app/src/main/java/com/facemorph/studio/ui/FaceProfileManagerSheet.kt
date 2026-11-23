package com.facemorph.studio.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.viewmodel.StudioViewModel
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

    var pendingProfileId by remember { mutableStateOf<String?>(null) }
    var pendingCameraFile by remember { mutableStateOf<File?>(null) }

    val angleGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val targetId = pendingProfileId
        pendingProfileId = null
        if (uri != null) {
            if (!targetId.isNullOrBlank()) {
                viewModel.addAngleToProfileFromUri(targetId, uri)
            } else {
                val chosenName = newProfileName.trim().takeIf { it.isNotBlank() }
                newProfileName = ""
                viewModel.createFaceProfileFromUri(uri, chosenName)
            }
        }
    }

    val angleCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val targetId = pendingProfileId
        val file = pendingCameraFile
        pendingProfileId = null
        if (success && file != null && file.exists()) {
            if (!targetId.isNullOrBlank()) {
                viewModel.addAngleToProfileFromFile(targetId, file.absolutePath)
            } else {
                val chosenName = newProfileName.trim().takeIf { it.isNotBlank() }
                newProfileName = ""
                viewModel.createFaceProfileFromFile(file.absolutePath, chosenName)
            }
        }
    }

    fun launchGalleryFor(profileId: String?) {
        pendingProfileId = profileId
        angleGalleryPicker.launch("image/*")
    }

    fun launchCameraFor(profileId: String?) {
        pendingProfileId = profileId
        val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "profile_angle")
        pendingCameraFile = file
        angleCameraLauncher.launch(uri)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .heightIn(max = 680.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xFF0A1020),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF1E293B))
        ) {
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
                                "Save multiple head angles per person for auto-pose swap",
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
                    OutlinedTextField(
                        value = newProfileName,
                        onValueChange = { newProfileName = it },
                        placeholder = { Text("Optional profile name (e.g. Alex)", color = Color(0xFF64748B), fontSize = 12.sp) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedBorderColor = Color(0xFF6366F1),
                            unfocusedBorderColor = Color(0xFF334155),
                            focusedContainerColor = Color(0xFF090F1D),
                            unfocusedContainerColor = Color(0xFF090F1D)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = { launchGalleryFor(null) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                            shape = RoundedCornerShape(9.dp),
                            modifier = Modifier.weight(1f).height(38.dp),
                            contentPadding = PaddingValues(horizontal = 10.dp)
                        ) {
                            Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Gallery Photo", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Button(
                            onClick = { launchCameraFor(null) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                            shape = RoundedCornerShape(9.dp),
                            modifier = Modifier.weight(1f).height(38.dp),
                            contentPadding = PaddingValues(horizontal = 10.dp)
                        ) {
                            Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Camera Shot", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }

                HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

                if (viewModel.faceProfiles.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFF0F172A))
                            .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(12.dp))
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "No profiles saved yet. Add a photo above to create a profile and collect multiple face angles.",
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
                                // Profile Header Row (cutout avatar has zero face label text)
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
                                            .clickable { viewModel.assignProfileToSelectedOrAll(profile.id) },
                                        contentAlignment = Alignment.Center
                                    ) {
                                        if (primaryCutout != null) {
                                            Image(
                                                bitmap = primaryCutout.asImageBitmap(),
                                                contentDescription = null,
                                                contentScale = ContentScale.Fit,
                                                modifier = Modifier.fillMaxSize().padding(2.dp)
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
                                                "${profile.angles.size} ${if (profile.angles.size == 1) "angle saved" else "angles saved"}",
                                                color = Color(0xFF94A3B8),
                                                fontSize = 10.sp
                                            )
                                        }
                                    }

                                    Text(
                                        if (isActive) "Active" else "Use",
                                        color = if (isActive) Color(0xFF0F172A) else Color.White,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(if (isActive) Color(0xFF818CF8) else Color(0xFF1E293B))
                                            .border(
                                                1.dp,
                                                if (isActive) Color(0xFF818CF8) else Color(0xFF334155),
                                                RoundedCornerShape(8.dp)
                                            )
                                            .clickable { viewModel.assignProfileToSelectedOrAll(profile.id) }
                                            .padding(horizontal = 10.dp, vertical = 5.dp)
                                    )

                                    IconButton(
                                        onClick = { viewModel.removeFaceProfile(profile.id) },
                                        modifier = Modifier.size(28.dp)
                                    ) {
                                        Icon(Icons.Default.Delete, contentDescription = "Delete profile", tint = Color(0xFFF87171), modifier = Modifier.size(16.dp))
                                    }
                                }

                                // Saved Cutout Angle Thumbnails Strip (pure cutout images, ZERO face labels)
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
                                                .size(54.dp)
                                                .clip(RoundedCornerShape(10.dp))
                                                .background(Color(0xFF090F1D))
                                                .border(
                                                    width = if (isAngleSelected) 2.dp else 1.dp,
                                                    color = if (isAngleSelected) Color(0xFF6366F1) else Color(0xFF334155),
                                                    shape = RoundedCornerShape(10.dp)
                                                )
                                                .clickable { viewModel.selectProfileAngle(profile.id, angle.id) }
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
                                                    .size(16.dp)
                                                    .clip(CircleShape)
                                                    .background(Color(0xCC020617))
                                                    .clickable { viewModel.removeAngleFromProfile(profile.id, angle.id) },
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Icon(
                                                    Icons.Default.Close,
                                                    contentDescription = "Remove angle",
                                                    tint = Color(0xFFCBD5E1),
                                                    modifier = Modifier.size(10.dp)
                                                )
                                            }
                                        }
                                    }
                                }

                                // Add More Angles to this Profile
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
                                            .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(8.dp))
                                            .clickable { launchGalleryFor(profile.id) }
                                            .padding(horizontal = 8.dp, vertical = 6.dp)
                                    ) {
                                        Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFFA5B4FC), modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(5.dp))
                                        Text("+ Gallery Angle", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
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
                                            .padding(horizontal = 8.dp, vertical = 6.dp)
                                    ) {
                                        Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(5.dp))
                                        Text("+ Camera Angle", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
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
