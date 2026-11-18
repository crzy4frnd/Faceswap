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
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.model.StudioTab
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.viewmodel.StudioViewModel
import java.io.File

@Composable
fun WardrobeVaultScreen(viewModel: StudioViewModel) {
    val context = LocalContext.current
    var filter by remember { mutableStateOf("ALL") }
    var pendingFaceCameraFile by remember { mutableStateOf<File?>(null) }

    val faceGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.addCustomFaceFromUri(it, sourceLabel = "Gallery") }
    }

    val faceCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingFaceCameraFile
        if (success && file != null && file.exists()) {
            viewModel.addCustomFaceFromFile(file.absolutePath, sourceLabel = "Camera")
        }
    }

    val filteredAssets = remember(viewModel.wardrobeAssets, filter) {
        when (filter) {
            "CLOTHING" -> viewModel.wardrobeAssets.filter { it.category == WardrobeCategory.CLOTHING }
            "JEWELRY" -> viewModel.wardrobeAssets.filter { it.category == WardrobeCategory.JEWELRY || it.category == WardrobeCategory.ACCESSORY }
            "CUSTOM" -> viewModel.wardrobeAssets.filter { it.isCustom }
            else -> viewModel.wardrobeAssets
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF020617))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Clear Unclipped Actions: Add Face (Gallery & Camera) + Scan Costume
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { faceGalleryPicker.launch("image/*") },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.weight(1f).height(40.dp),
                contentPadding = PaddingValues(horizontal = 8.dp)
            ) {
                Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(5.dp))
                Text("Face Gallery", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
            Button(
                onClick = {
                    val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "vault_face")
                    pendingFaceCameraFile = file
                    faceCameraLauncher.launch(uri)
                },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.weight(1f).height(40.dp),
                contentPadding = PaddingValues(horizontal = 8.dp)
            ) {
                Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(5.dp))
                Text("Face Camera", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
            Button(
                onClick = { viewModel.showCustomAssetDialog = true },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.weight(1f).height(40.dp),
                contentPadding = PaddingValues(horizontal = 8.dp)
            ) {
                Icon(Icons.Default.AddAPhoto, contentDescription = null, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(5.dp))
                Text("Scan Item", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }

        Text("Your Face Profiles (${viewModel.faceProfiles.size})", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
        if (viewModel.faceProfiles.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFF0B1120))
                    .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(10.dp))
                    .padding(12.dp)
            ) {
                Text(
                    "No saved faces yet. Use Face Gallery or Face Camera above to add your own faces.",
                    color = Color(0xFF64748B),
                    fontSize = 11.sp
                )
            }
        } else {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                viewModel.faceProfiles.forEach { p ->
                    val bmp = viewModel.profileBitmapCache[p.id]
                    val active = viewModel.activeProfileId == p.id
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .border(1.dp, if (active) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(12.dp))
                            .background(if (active) Color(0xFF1E1B4B) else Color(0xFF0B1120))
                            .clickable {
                                viewModel.assignProfileToSelectedOrAll(p.id)
                                viewModel.activeTab = StudioTab.FACE_STUDIO
                            }
                            .padding(start = 8.dp, top = 8.dp, bottom = 8.dp, end = 4.dp)
                    ) {
                        if (bmp != null) {
                            Image(bitmap = bmp.asImageBitmap(), contentDescription = p.name, contentScale = ContentScale.Crop, modifier = Modifier.size(38.dp).clip(CircleShape))
                        }
                        Spacer(Modifier.width(8.dp))
                        Column {
                            Text(p.name, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                            Text(p.tag, color = Color(0xFF818CF8), fontSize = 9.sp)
                        }
                        IconButton(
                            onClick = { viewModel.removeFaceProfile(p.id) },
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Delete face", tint = Color(0xFF94A3B8), modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }
        }

        // Clean Filter Segment
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFF0B1120))
                .padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            listOf("ALL" to "All", "CLOTHING" to "Clothes", "JEWELRY" to "Jewelry", "CUSTOM" to "Custom").forEach { (key, label) ->
                val sel = filter == key
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (sel) Color(0xFF4F46E5) else Color.Transparent)
                        .clickable { filter = key }
                        .padding(vertical = 6.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(label, color = if (sel) Color.White else Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(filteredAssets, key = { it.id }) { asset ->
                val bmp = viewModel.wardrobeBitmapCache[asset.id]
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF0B1120))
                        .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(12.dp))
                        .padding(10.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFF162033)),
                        contentAlignment = Alignment.Center
                    ) {
                        if (bmp != null) {
                            Image(bitmap = bmp.asImageBitmap(), contentDescription = asset.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(4.dp))
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(asset.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text("${asset.subCategory.label} · ${asset.anchorPoint.label}", color = Color(0xFF94A3B8), fontSize = 10.sp)
                    }
                    Button(
                        onClick = {
                            viewModel.toggleAttachWardrobeAsset(asset.id)
                            viewModel.activeTab = StudioTab.BODY_PHYSICS
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.height(32.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)
                    ) {
                        Text("Try On", fontSize = 11.sp)
                    }
                    if (asset.isCustom) {
                        IconButton(onClick = { viewModel.removeCustomAsset(asset.id) }) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = Color(0xFFF87171), modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}
