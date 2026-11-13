package com.facemorph.studio.ui

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.window.Dialog
import com.facemorph.studio.engine.NativeAssetSegmenter
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.FabricType
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.viewmodel.StudioViewModel

@Composable
fun CustomAssetDialog(
    viewModel: StudioViewModel,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var rawBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var tolerance by remember { mutableIntStateOf(35) }
    var assetName by remember { mutableStateOf("Custom Jacket") }
    var category by remember { mutableStateOf(WardrobeCategory.CLOTHING) }
    var anchorPoint by remember { mutableStateOf(BodyAnchorPoint.SHOULDERS) }
    var fabricType by remember { mutableStateOf(FabricType.SILK) }

    val segmentedBitmap = remember(rawBitmap, tolerance) {
        rawBitmap?.let { NativeAssetSegmenter.extractTransparentAsset(it, tolerance) }
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
        if (bmp != null) rawBitmap = bmp
    }

    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let {
            NativeStorageHelper.loadBitmapFromUri(context, it, 900)?.let { loaded ->
                rawBitmap = loaded
            }
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = Color(0xFF0F172A),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, Color(0xFF334155), RoundedCornerShape(20.dp))
        ) {
            Column(
                modifier = Modifier
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Custom Costume & Jewelry Scanner", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.Close, contentDescription = "Close", tint = Color(0xFF94A3B8))
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Button(
                        onClick = { cameraLauncher.launch(null) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Camera", fontSize = 11.sp)
                    }
                    Button(
                        onClick = { galleryLauncher.launch("image/*") },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Gallery", fontSize = 11.sp)
                    }
                }

                // Segmented Preview Box
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(170.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFF1E293B))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(14.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    if (segmentedBitmap != null) {
                        Image(
                            bitmap = segmentedBitmap.asImageBitmap(),
                            contentDescription = "Segmented Asset",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxWidth().padding(8.dp)
                        )
                    } else {
                        Text(
                            "Snap a photo or pick a shirt, dress, necklace, crown, or watch from Gallery.\nBackground is automatically removed.",
                            color = Color(0xFF94A3B8),
                            fontSize = 11.sp,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }

                if (rawBitmap != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("BG Cutout $tolerance", color = Color(0xFF22D3EE), fontSize = 11.sp, modifier = Modifier.width(86.dp))
                        Slider(
                            value = tolerance.toFloat(),
                            onValueChange = { tolerance = it.toInt() },
                            valueRange = 10f..75f,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                OutlinedTextField(
                    value = assetName,
                    onValueChange = { assetName = it },
                    label = { Text("Asset Name", fontSize = 11.sp) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = Color(0xFF6366F1),
                        unfocusedBorderColor = Color(0xFF334155)
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                Text("Category", color = Color(0xFF94A3B8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
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
                            },
                            label = { Text(cat.label, fontSize = 10.sp) }
                        )
                    }
                }

                Text("Body Anchor Point", color = Color(0xFF94A3B8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    BodyAnchorPoint.entries.forEach { pt ->
                        FilterChip(
                            selected = anchorPoint == pt,
                            onClick = { anchorPoint = pt },
                            label = { Text(pt.label, fontSize = 10.sp) }
                        )
                    }
                }

                if (category == WardrobeCategory.CLOTHING) {
                    Text("Cloth Physics Material", color = Color(0xFF94A3B8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                        FabricType.entries.forEach { f ->
                            FilterChip(
                                selected = fabricType == f,
                                onClick = { fabricType = f },
                                label = { Text(f.label, fontSize = 10.sp) }
                            )
                        }
                    }
                }

                Button(
                    onClick = {
                        val finalBmp = segmentedBitmap ?: return@Button
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
                            defaultScale = scale
                        )
                        onDismiss()
                    },
                    enabled = segmentedBitmap != null,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Save, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Save & Wear in Studio + Live AR", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
