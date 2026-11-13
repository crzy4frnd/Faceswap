package com.facemorph.studio.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.facemorph.studio.engine.NativeLiveArEngine
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.viewmodel.StudioViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
fun LiveCameraScreen(viewModel: StudioViewModel) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    val config = viewModel.liveConfig
    val latestConfig by rememberUpdatedState(config)
    val latestBgMap by rememberUpdatedState(viewModel.backgroundBitmapCache.toMap())
    val latestProfileMap by rememberUpdatedState(viewModel.profileBitmapCache.toMap())
    val latestMetricsMap by rememberUpdatedState(viewModel.profileMetricsCache.toMap())
    val latestWardrobeAssets by rememberUpdatedState(viewModel.wardrobeAssets)
    val latestWardrobeBitmaps by rememberUpdatedState(viewModel.wardrobeBitmapCache.toMap())
    val latestActiveProfileId by rememberUpdatedState(viewModel.activeProfileId)

    var activeDeckTab by remember { mutableIntStateOf(0) } // 0=Effects, 1=Background, 2=Wardrobe

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        hasCameraPermission = grants[Manifest.permission.CAMERA] == true
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
        }
    }

    val bgPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.loadCustomBackgroundFromUri(it) }
    }

    var processedBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var activeRecording by remember { mutableStateOf<Recording?>(null) }
    var videoCaptureUseCase by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    var recordSeconds by remember { mutableLongStateOf(0L) }

    LaunchedEffect(isRecording) {
        recordSeconds = 0L
        while (isRecording) {
            delay(1000L)
            recordSeconds++
        }
    }

    val previewView = remember {
        PreviewView(context).apply {
            layoutParams = ViewGroup.LayoutParams(1, 1)
        }
    }

    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val isProcessingFrame = remember { AtomicBoolean(false) }
    val startTimeMs = remember { System.currentTimeMillis() }

    DisposableEffect(Unit) {
        onDispose {
            activeRecording?.stop()
            cameraExecutor.shutdown()
        }
    }

    LaunchedEffect(hasCameraPermission, config.useFrontCamera) {
        if (!hasCameraPermission) return@LaunchedEffect
        val cameraProvider = withContext(Dispatchers.IO) {
            ProcessCameraProvider.getInstance(context).get()
        }
        cameraProvider.unbindAll()

        val cameraSelector = if (config.useFrontCamera) {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }

        val preview = Preview.Builder().build().apply {
            setSurfaceProvider(previewView.surfaceProvider)
        }

        val imageAnalysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
            if (!isProcessingFrame.compareAndSet(false, true)) {
                imageProxy.close()
                return@setAnalyzer
            }
            try {
                val rawBmp = imageProxy.toBitmap()
                val rotated = NativeLiveArEngine.rotateAndMirrorBitmap(
                    rawBmp,
                    imageProxy.imageInfo.rotationDegrees,
                    mirrorHorizontal = latestConfig.useFrontCamera
                )
                if (rotated !== rawBmp) rawBmp.recycle()

                val curCfg = latestConfig
                val bgBmp = latestBgMap[curCfg.activeBgId]
                val swapBmp = latestProfileMap[latestActiveProfileId]
                val swapMetrics = latestMetricsMap[latestActiveProfileId]
                val clothAsset = latestWardrobeAssets.find { it.id == curCfg.selectedClothingId }
                val clothBmp = clothAsset?.let { latestWardrobeBitmaps[it.id] }
                val jewAsset = latestWardrobeAssets.find { it.id == curCfg.selectedJewelryId }
                val jewBmp = jewAsset?.let { latestWardrobeBitmaps[it.id] }
                val elapsedSec = (System.currentTimeMillis() - startTimeMs) / 1000f

                scope.launch(Dispatchers.Default) {
                    try {
                        val out = NativeLiveArEngine.processLiveFrame(
                            frame = rotated,
                            config = curCfg,
                            bgBitmap = bgBmp,
                            swapProfileBitmap = swapBmp,
                            swapProfileMetrics = swapMetrics,
                            clothingAsset = clothAsset,
                            clothingBitmap = clothBmp,
                            jewelryAsset = jewAsset,
                            jewelryBitmap = jewBmp,
                            timeSec = elapsedSec
                        )
                        rotated.recycle()
                        withContext(Dispatchers.Main) {
                            processedBitmap = out
                        }
                    } finally {
                        isProcessingFrame.set(false)
                    }
                }
            } catch (_: Exception) {
                isProcessingFrame.set(false)
            } finally {
                imageProxy.close()
            }
        }

        val recorder = Recorder.Builder()
            .setQualitySelector(QualitySelector.from(Quality.SD))
            .build()
        val vidCapture = VideoCapture.withOutput(recorder)
        videoCaptureUseCase = vidCapture

        try {
            cameraProvider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageAnalysis,
                vidCapture
            )
        } catch (_: Exception) {
            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    imageAnalysis
                )
                videoCaptureUseCase = null
            } catch (e: Exception) {
                viewModel.showToast("Camera error: ${e.message}")
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun toggleVideoRecording() {
        val existing = activeRecording
        if (existing != null) {
            existing.stop()
            activeRecording = null
            isRecording = false
            return
        }
        val vc = videoCaptureUseCase
        if (vc == null) {
            viewModel.showToast("Video recording unavailable on this camera.")
            return
        }

        val displayName = "FaceMorph_Live_${System.currentTimeMillis()}.mp4"
        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/FaceMorphStudio")
            }
        }
        val outputOptions = MediaStoreOutputOptions.Builder(
            context.contentResolver,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        ).setContentValues(contentValues).build()

        var pending = vc.output.prepareRecording(context, outputOptions)
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            pending = pending.withAudioEnabled()
        }
        activeRecording = pending.start(ContextCompat.getMainExecutor(context)) { event ->
            when (event) {
                is VideoRecordEvent.Start -> isRecording = true
                is VideoRecordEvent.Finalize -> {
                    isRecording = false
                    activeRecording = null
                    if (event.hasError()) {
                        viewModel.showToast("Video failed: ${event.error}")
                    } else {
                        viewModel.showToast("Video saved to Movies/FaceMorphStudio")
                    }
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF020617))
    ) {
        // Clean Camera Viewport (No Buttons Covering Chest or Face!)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color(0xFF060A13)),
            contentAlignment = Alignment.Center
        ) {
            if (!hasCameraPermission) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    Icon(Icons.Default.Videocam, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(44.dp))
                    Spacer(Modifier.height(10.dp))
                    Text("Live Camera AR", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Spacer(Modifier.height(6.dp))
                    Text("Allow camera & microphone access for real-time background removal, smoothing, and AR outfits.", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    Spacer(Modifier.height(14.dp))
                    Button(onClick = {
                        permLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
                    }) {
                        Text("Allow Camera")
                    }
                }
            } else {
                // Keep hidden 1x1dp surface for CameraX lifecycle without ghosting behind AR bitmap
                AndroidView(factory = { previewView }, modifier = Modifier.size(1.dp).alpha(0f))

                processedBitmap?.let { bmp ->
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "Live AR Output",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                    )
                } ?: Text("Starting Camera...", color = Color(0xFF94A3B8), fontSize = 12.sp)

                if (isRecording) {
                    Row(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(10.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xCCDC2626))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.FiberManualRecord, contentDescription = null, tint = Color.White, modifier = Modifier.size(10.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("REC %02d:%02d".format(recordSeconds / 60, recordSeconds % 60), color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }

                // Minimal Top-Right Flip + Mesh Pills
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(if (config.showLandmarkMesh) Color(0xDD0891B2) else Color(0xCC0B1120))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(9.dp))
                            .clickable { viewModel.liveConfig = config.copy(showLandmarkMesh = !config.showLandmarkMesh) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.GridOn, contentDescription = "Mesh", tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(Color(0xCC0B1120))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(9.dp))
                            .clickable { viewModel.liveConfig = config.copy(useFrontCamera = !config.useFrontCamera) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.Cameraswitch, contentDescription = "Flip Camera", tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }

        // Dedicated Capture Bar (Separated from Camera Preview!)
        if (hasCameraPermission) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF070B14))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFF1E293B))
                        .clickable { viewModel.showCustomAssetDialog = true }
                        .padding(horizontal = 10.dp, vertical = 7.dp)
                ) {
                    Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Scan Item", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }

                // Clean Shutter Button
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                        .border(3.dp, Color(0xFF6366F1), CircleShape)
                        .clickable {
                            processedBitmap?.let { viewModel.exportBitmapToGallery(it, "LiveAR") }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = "Snap Photo", tint = Color(0xFF0F172A), modifier = Modifier.size(22.dp))
                }

                // Record Video Button
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isRecording) Color(0xFFDC2626) else Color(0xFF1E293B))
                        .clickable { toggleVideoRecording() }
                        .padding(horizontal = 12.dp, vertical = 7.dp)
                ) {
                    Icon(
                        if (isRecording) Icons.Default.Stop else Icons.Default.Videocam,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(if (isRecording) "Stop" else "Record", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // Clean Segmented Bottom Studio Deck
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(175.dp)
                .background(Color(0xFF0B1120))
                .border(1.dp, Color(0xFF1E293B))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFF111827))
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                listOf("Effects", "Background", "Wardrobe").forEachIndexed { idx, label ->
                    val selected = activeDeckTab == idx
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) Color(0xFF4F46E5) else Color.Transparent)
                            .clickable { activeDeckTab = idx }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(label, color = if (selected) Color.White else Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            when (activeDeckTab) {
                0 -> {
                    // Clean Feature Toggles
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        val toggles = listOf(
                            Triple("BG Cutout", config.removeBackground) { viewModel.liveConfig = config.copy(removeBackground = !config.removeBackground) },
                            Triple("Skin Smooth", config.removeHairAndBlemishes) { viewModel.liveConfig = config.copy(removeHairAndBlemishes = !config.removeHairAndBlemishes) },
                            Triple("Clothes", config.wearClothes) { viewModel.liveConfig = config.copy(wearClothes = !config.wearClothes) },
                            Triple("Jewelry", config.wearJewelry) { viewModel.liveConfig = config.copy(wearJewelry = !config.wearJewelry) },
                            Triple("Face Swap", config.faceSwapEnabled) { viewModel.liveConfig = config.copy(faceSwapEnabled = !config.faceSwapEnabled) }
                        )
                        toggles.forEach { (label, active, onClick) ->
                            Text(
                                label,
                                color = if (active) Color.White else Color(0xFF94A3B8),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (active) Color(0xFF312E81) else Color(0xFF111827))
                                    .border(1.dp, if (active) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(8.dp))
                                    .clickable { onClick() }
                                    .padding(horizontal = 10.dp, vertical = 6.dp)
                            )
                        }
                    }

                    if (config.removeHairAndBlemishes) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Smooth ${config.hairRemovalIntensity}%", color = Color(0xFFF472B6), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                            Slider(
                                value = config.hairRemovalIntensity.toFloat(),
                                onValueChange = { viewModel.liveConfig = config.copy(hairRemovalIntensity = it.toInt()) },
                                valueRange = 0f..100f,
                                modifier = Modifier.weight(1f).height(28.dp)
                            )
                        }
                    } else if (config.faceSwapEnabled) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Swap ${config.swapStrength}%", color = Color(0xFF818CF8), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                            Slider(
                                value = config.swapStrength.toFloat(),
                                onValueChange = { viewModel.liveConfig = config.copy(swapStrength = it.toInt()) },
                                valueRange = 20f..100f,
                                modifier = Modifier.weight(1f).height(28.dp)
                            )
                        }
                    } else {
                        Text("Tap any studio effect above to toggle live AR layers.", color = Color(0xFF64748B), fontSize = 11.sp)
                    }
                }

                1 -> {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        listOf(
                            "studio" to "Studio Loft",
                            "neon" to "Cyberpunk",
                            "sunset" to "Sunset",
                            "green" to "Chroma Green"
                        ).forEach { (id, title) ->
                            val sel = config.removeBackground && config.activeBgId == id
                            Text(
                                title,
                                color = if (sel) Color.White else Color(0xFF94A3B8),
                                fontSize = 11.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (sel) Color(0xFF312E81) else Color(0xFF111827))
                                    .border(1.dp, if (sel) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(10.dp))
                                    .clickable { viewModel.liveConfig = config.copy(activeBgId = id, removeBackground = true) }
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            )
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF111827))
                                .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                                .clickable { bgPicker.launch("image/*") }
                                .padding(horizontal = 12.dp, vertical = 10.dp)
                        ) {
                            Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Gallery BG", color = Color.White, fontSize = 11.sp)
                        }
                    }
                }

                2 -> {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        viewModel.wardrobeAssets.forEach { asset ->
                            val active = if (asset.category == WardrobeCategory.CLOTHING) {
                                config.wearClothes && config.selectedClothingId == asset.id
                            } else {
                                config.wearJewelry && config.selectedJewelryId == asset.id
                            }
                            val bmp = viewModel.wardrobeBitmapCache[asset.id]
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier
                                    .width(74.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .border(1.dp, if (active) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(10.dp))
                                    .background(if (active) Color(0xFF1E1B4B) else Color(0xFF111827))
                                    .clickable {
                                        viewModel.liveConfig = if (asset.category == WardrobeCategory.CLOTHING) {
                                            config.copy(selectedClothingId = asset.id, wearClothes = true)
                                        } else {
                                            config.copy(selectedJewelryId = asset.id, wearJewelry = true)
                                        }
                                    }
                                    .padding(6.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(36.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Color(0xFF162033)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (bmp != null) {
                                        Image(bitmap = bmp.asImageBitmap(), contentDescription = asset.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(2.dp))
                                    }
                                }
                                Spacer(Modifier.height(3.dp))
                                Text(asset.name, color = Color.White, fontSize = 9.sp, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}
