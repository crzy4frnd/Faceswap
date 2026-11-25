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
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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

    val faceGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isNotEmpty()) {
            viewModel.createFaceProfileFromUris(uris)
        }
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
            "JEWELRY" -> viewModel.wardrobeAssets.filter { it.category == WardrobeCategory.JEWELRY }
            "OTHER" -> viewModel.wardrobeAssets.filter { it.category == WardrobeCategory.ACCESSORY }
            "CUSTOM" -> viewModel.wardrobeAssets.filter { it.isCustom }
            else -> viewModel.wardrobeAssets
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(StudioColors.Background)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Big thumb-friendly Material 3 Quick Actions
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StudioTonalActionButton(
                label = "Add Faces",
                icon = Icons.Default.PhotoLibrary,
                containerColor = StudioColors.PrimaryContainer,
                contentColor = StudioColors.OnPrimaryContainer,
                iconTint = StudioColors.OnPrimaryContainer,
                onClick = {
                    viewModel.pendingAngleTargetProfileId = null
                    faceGalleryPicker.launch("image/*")
                },
                modifier = Modifier.weight(1f)
            )
            StudioTonalActionButton(
                label = "Camera",
                icon = Icons.Default.CameraAlt,
                containerColor = StudioColors.SecondaryContainer,
                contentColor = StudioColors.OnSecondaryContainer,
                iconTint = StudioColors.Secondary,
                onClick = {
                    viewModel.pendingAngleTargetProfileId = null
                    val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "vault_face")
                    pendingFaceCameraFile = file
                    faceCameraLauncher.launch(uri)
                },
                modifier = Modifier.weight(1f)
            )
            StudioTonalActionButton(
                label = "Cutout",
                icon = Icons.Default.ContentCut,
                containerColor = StudioColors.WarningContainer,
                contentColor = Color.White,
                iconTint = StudioColors.Warning,
                onClick = { viewModel.showCustomAssetDialog = true },
                modifier = Modifier.weight(1f)
            )
        }

        // Saved Face Profiles Card
        StudioSectionCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        "Saved Face Profiles (${viewModel.faceProfiles.size})",
                        color = StudioColors.TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "Tap a profile to swap directly onto your photo",
                        color = StudioColors.TextMuted,
                        fontSize = 11.sp
                    )
                }
                FilledTonalButton(
                    onClick = { viewModel.showFaceProfileManager = true },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = StudioColors.PrimaryContainer,
                        contentColor = StudioColors.OnPrimaryContainer
                    ),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                    modifier = Modifier.height(36.dp)
                ) {
                    Icon(Icons.Default.Face, contentDescription = null, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Manage", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            if (viewModel.faceProfiles.isEmpty()) {
                Text(
                    "No profiles stored yet. Tap Add Faces or Camera above to save unlimited angles offline.",
                    color = StudioColors.TextSecondary,
                    fontSize = 12.sp
                )
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    viewModel.faceProfiles.forEach { p ->
                        val bmp = viewModel.getCutoutThumbForProfile(p.id)
                        val active = viewModel.activeProfileId == p.id
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                            modifier = Modifier.width(68.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(64.dp)
                                    .clip(RoundedCornerShape(16.dp))
                                    .border(
                                        width = if (active) 2.2.dp else 0.dp,
                                        color = if (active) StudioColors.Primary else Color.Transparent,
                                        shape = RoundedCornerShape(16.dp)
                                    )
                                    .background(if (active) StudioColors.PrimaryContainer else StudioColors.SurfaceContainerHigh)
                                    .clickable {
                                        viewModel.assignProfileToSelectedOrAll(p.id)
                                        viewModel.activeTab = StudioTab.FACE_STUDIO
                                    }
                            ) {
                                if (bmp != null) {
                                    Image(
                                        bitmap = bmp.asImageBitmap(),
                                        contentDescription = null,
                                        contentScale = ContentScale.Fit,
                                        modifier = Modifier.fillMaxSize().padding(4.dp)
                                    )
                                } else {
                                    Icon(
                                        Icons.Default.Face,
                                        contentDescription = null,
                                        tint = StudioColors.TextMuted,
                                        modifier = Modifier.size(28.dp).align(Alignment.Center)
                                    )
                                }
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(3.dp)
                                        .size(20.dp)
                                        .clip(CircleShape)
                                        .background(StudioColors.ScrimOverlay)
                                        .clickable { viewModel.removeFaceProfile(p.id) },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        Icons.Default.Close,
                                        contentDescription = "Delete profile",
                                        tint = StudioColors.TextPrimary,
                                        modifier = Modifier.size(12.dp)
                                    )
                                }
                                if (p.angles.size > 1) {
                                    Box(
                                        modifier = Modifier
                                            .align(Alignment.BottomEnd)
                                            .padding(3.dp)
                                            .clip(RoundedCornerShape(6.dp))
                                            .background(StudioColors.PrimaryContainer)
                                            .padding(horizontal = 5.dp, vertical = 1.dp)
                                    ) {
                                        Text(
                                            "${p.angles.size}",
                                            color = StudioColors.OnPrimaryContainer,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }
                            }
                            Text(
                                text = p.name,
                                color = if (active) StudioColors.Primary else StudioColors.TextSecondary,
                                fontSize = 11.sp,
                                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
            }
        }

        // Material 3 Filter Chips Row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf(
                "ALL" to "All Items",
                "CLOTHING" to "Clothes",
                "JEWELRY" to "Jewelry",
                "OTHER" to "Accessories",
                "CUSTOM" to "Custom"
            ).forEach { (key, label) ->
                StudioFilterChip(
                    label = label,
                    selected = filter == key,
                    onClick = { filter = key }
                )
            }
        }

        // Wardrobe Asset List (Clean Material 3 Elevated Rows)
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(filteredAssets, key = { it.id }) { asset ->
                val bmp = viewModel.wardrobeBitmapCache[asset.id]
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = StudioColors.SurfaceContainer,
                    tonalElevation = 2.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(12.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(58.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(StudioColors.SurfaceContainerHigh),
                            contentAlignment = Alignment.Center
                        ) {
                            if (bmp != null) {
                                Image(
                                    bitmap = bmp.asImageBitmap(),
                                    contentDescription = asset.name,
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier.fillMaxSize().padding(6.dp)
                                )
                            }
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                asset.name,
                                color = StudioColors.TextPrimary,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                "${asset.displaySubCategory} · ${asset.anchorPoint.label}",
                                color = StudioColors.TextSecondary,
                                fontSize = 12.sp
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = {
                                viewModel.toggleAttachWardrobeAsset(asset.id)
                                viewModel.activeTab = StudioTab.BODY_PHYSICS
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = StudioColors.PrimaryContainer,
                                contentColor = StudioColors.OnPrimaryContainer
                            ),
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.height(42.dp),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 0.dp)
                        ) {
                            Text("Try On", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                        if (asset.isCustom) {
                            IconButton(
                                onClick = { viewModel.removeCustomAsset(asset.id) },
                                modifier = Modifier.size(42.dp)
                            ) {
                                Icon(Icons.Default.Delete, contentDescription = "Delete", tint = StudioColors.Danger, modifier = Modifier.size(20.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}
