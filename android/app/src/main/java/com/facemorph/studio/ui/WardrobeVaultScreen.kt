package com.facemorph.studio.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Face
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facemorph.studio.model.StudioTab
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.viewmodel.StudioViewModel

@Composable
fun WardrobeVaultScreen(viewModel: StudioViewModel) {
    var filter by remember { mutableStateOf("ALL") }

    val facePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.addCustomFaceFromUri(it, "Vault Face") }
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
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Header Action Cards
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { viewModel.showCustomAssetDialog = true },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.AddAPhoto, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Scan Costume / Jewelry", fontSize = 11.sp)
            }
            Button(
                onClick = { facePicker.launch("image/*") },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.Face, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Import Face", fontSize = 11.sp)
            }
        }

        // Face Profiles Section
        Text("Face Profiles Vault", color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            viewModel.faceProfiles.forEach { p ->
                val bmp = viewModel.profileBitmapCache[p.id]
                val active = viewModel.activeProfileId == p.id
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .border(1.5.dp, if (active) Color(0xFF6366F1) else Color(0xFF334155), RoundedCornerShape(12.dp))
                        .background(if (active) Color(0xFF1E1B4B) else Color(0xFF0F172A))
                        .clickable {
                            viewModel.assignProfileToSelectedOrAll(p.id)
                            viewModel.activeTab = StudioTab.FACE_STUDIO
                        }
                        .padding(8.dp)
                ) {
                    if (bmp != null) {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = p.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(48.dp).clip(CircleShape)
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(p.name, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    Text(p.tag, color = Color(0xFF818CF8), fontSize = 9.sp)
                }
            }
        }

        // Filter Chips
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            listOf("ALL" to "All (${viewModel.wardrobeAssets.size})", "CLOTHING" to "Clothes", "JEWELRY" to "Jewelry", "CUSTOM" to "Custom Scanned").forEach { (key, label) ->
                FilterChip(
                    selected = filter == key,
                    onClick = { filter = key },
                    label = { Text(label, fontSize = 11.sp) }
                )
            }
        }

        // Assets List
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
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFF0F172A))
                        .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(14.dp))
                        .padding(10.dp)
                ) {
                    if (bmp != null) {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = asset.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .size(54.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color.White)
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(asset.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text("${asset.category.label} • ${asset.anchorPoint.label} • ${asset.fabricType.label}", color = Color(0xFF94A3B8), fontSize = 10.sp)
                    }
                    Button(
                        onClick = {
                            viewModel.toggleAttachWardrobeAsset(asset.id)
                            viewModel.activeTab = StudioTab.BODY_PHYSICS
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                        modifier = Modifier.height(34.dp)
                    ) {
                        Text("Wear", fontSize = 11.sp)
                    }
                    if (asset.isCustom) {
                        IconButton(onClick = { viewModel.removeCustomAsset(asset.id) }) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = Color(0xFFF87171))
                        }
                    }
                }
            }
        }
    }
}
