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
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
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
    val latestWardrobeAssets by rememberUpdatedState(viewModel.wardrobeAssets)
    val latestWardrobeBitmaps by rememberUpdatedState(viewModel.wardrobeBitmapCache.toMap())
    val latestActiveProfileId by rememberUpdatedState(viewModel.activeProfileId)

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
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            scaleType = PreviewView.ScaleType.FIT_CENTER
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
            // Fallback for Android 7.0 devices that support only 2 concurrent streams
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
                viewModel.showToast("Camera initialization error: ${e.message}")
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
            viewModel.showToast("Video recording unavailable on this camera stream.")
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
                        viewModel.showToast("Video stop error: ${event.error}")
                    } else {
                        viewModel.showToast("Saved video to Movies/FaceMorphStudio!")
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
        // Viewport
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color.Black),
            contentAlignment = Alignment.Center
        ) {
            if (!hasCameraPermission) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    Icon(Icons.Default.Videocam, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(10.dp))
                    Text("Native CameraX AR Studio", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Spacer(Modifier.height(6.dp))
                    Text("Grant Camera & Audio permission for live background removal, hair smoothing, face swap, and AR clothes.", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    Spacer(Modifier.height(14.dp))
                    Button(onClick = {
                        permLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
                    }) {
                        Text("Enable Live Camera")
                    }
                }
            } else {
                AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())

                processedBitmap?.let { bmp ->
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "Live AR Output",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                // Recording Timer Badge
                if (isRecording) {
                    Row(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(12.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(Color(0xCCDC2626))
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.FiberManualRecord, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                        Spacer(Modifier.width(4.dp))
                        val mins = recordSeconds / 60
                        val secs = recordSeconds % 60
                        Text("REC %02d:%02d".format(mins, secs), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }

                // Top-Right Camera Switch & Mesh Toggle
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    IconButton(
                        onClick = { viewModel.liveConfig = config.copy(showLandmarkMesh = !config.showLandmarkMesh) },
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(if (config.showLandmarkMesh) Color(0xFF0891B2) else Color(0xAA0F172A))
                    ) {
                        Icon(Icons.Default.GridOn, contentDescription = "Landmark Mesh", tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                    IconButton(
                        onClick = { viewModel.liveConfig = config.copy(useFrontCamera = !config.useFrontCamera) },
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Color(0xAA0F172A))
                    ) {
                        Icon(Icons.Default.Cameraswitch, contentDescription = "Flip Camera", tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                }

                // Bottom Camera Capture & Record Controls
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = { viewModel.showCustomAssetDialog = true },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                        modifier = Modifier.height(40.dp)
                    ) {
                        Icon(Icons.Default.AddAPhoto, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Scan Costume", fontSize = 11.sp)
                    }

                    IconButton(
                        onClick = {
                            processedBitmap?.let {
                                viewModel.exportBitmapToGallery(it, "LiveAR")
                            }
                        },
                        modifier = Modifier
                            .size(54.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .border(3.dp, Color(0xFF6366F1), CircleShape)
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = "Snap Photo", tint = Color(0xFF0F172A), modifier = Modifier.size(26.dp))
                    }

                    IconButton(
                        onClick = { toggleVideoRecording() },
                        modifier = Modifier
                            .size(46.dp)
                            .clip(CircleShape)
                            .background(if (isRecording) Color(0xFFDC2626) else Color(0xCC1E293B))
                    ) {
                        Icon(
                            if (isRecording) Icons.Default.Stop else Icons.Default.Videocam,
                            contentDescription = "Record Video",
                            tint = Color.White,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }
            }
        }

        // Bottom Interactive AR Effects Panel
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(255.dp)
                .background(Color(0xFF0F172A))
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 4 Quick Feature Toggle Pills
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                FilterChip(
                    selected = config.removeBackground,
                    onClick = { viewModel.liveConfig = config.copy(removeBackground = !config.removeBackground) },
                    leadingIcon = { Icon(Icons.Default.Layers, contentDescription = null, modifier = Modifier.size(14.dp)) },
                    label = { Text("BG Removal", fontSize = 11.sp) }
                )
                FilterChip(
                    selected = config.removeHairAndBlemishes,
                    onClick = { viewModel.liveConfig = config.copy(removeHairAndBlemishes = !config.removeHairAndBlemishes) },
                    leadingIcon = { Icon(Icons.Default.AutoFixHigh, contentDescription = null, modifier = Modifier.size(14.dp)) },
                    label = { Text("Hair & Skin", fontSize = 11.sp) }
                )
                FilterChip(
                    selected = config.wearClothes,
                    onClick = { viewModel.liveConfig = config.copy(wearClothes = !config.wearClothes) },
                    leadingIcon = { Icon(Icons.Default.Checkroom, contentDescription = null, modifier = Modifier.size(14.dp)) },
                    label = { Text("Clothes", fontSize = 11.sp) }
                )
                FilterChip(
                    selected = config.wearJewelry,
                    onClick = { viewModel.liveConfig = config.copy(wearJewelry = !config.wearJewelry) },
                    leadingIcon = { Icon(Icons.Default.Diamond, contentDescription = null, modifier = Modifier.size(14.dp)) },
                    label = { Text("Jewelry", fontSize = 11.sp) }
                )
                FilterChip(
                    selected = config.faceSwapEnabled,
                    onClick = { viewModel.liveConfig = config.copy(faceSwapEnabled = !config.faceSwapEnabled) },
                    leadingIcon = { Icon(Icons.Default.Face, contentDescription = null, modifier = Modifier.size(14.dp)) },
                    label = { Text("Face Swap", fontSize = 11.sp) }
                )
            }

            // Virtual Backgrounds Strip
            if (config.removeBackground) {
                Text("Virtual Backgrounds", color = Color(0xFF94A3B8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val bgs = listOf(
                        "studio" to "Studio Loft",
                        "neon" to "Cyberpunk",
                        "sunset" to "Sunset",
                        "green" to "Chroma Green"
                    )
                    bgs.forEach { (id, title) ->
                        FilterChip(
                            selected = config.activeBgId == id,
                            onClick = { viewModel.liveConfig = config.copy(activeBgId = id) },
                            label = { Text(title, fontSize = 10.sp) }
                        )
                    }
                    Button(
                        onClick = { bgPicker.launch("image/*") },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Custom BG", fontSize = 10.sp)
                    }
                }
            }

            // Hair / Skin Smoothing Slider
            if (config.removeHairAndBlemishes) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Airbrush ${config.hairRemovalIntensity}%", color = Color(0xFFF472B6), fontSize = 11.sp, modifier = Modifier.width(96.dp))
                    Slider(
                        value = config.hairRemovalIntensity.toFloat(),
                        onValueChange = { viewModel.liveConfig = config.copy(hairRemovalIntensity = it.toInt()) },
                        valueRange = 0f..100f,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // AR Wardrobe Quick Switcher
            Text("AR Clothes & Jewelry", color = Color(0xFF94A3B8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                viewModel.wardrobeAssets.forEach { asset ->
                    val active = if (asset.category == WardrobeCategory.CLOTHING) {
                        config.wearClothes && config.selectedClothingId == asset.id
                    } else {
                        config.wearJewelry && config.selectedJewelryId == asset.id
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .border(1.dp, if (active) Color(0xFF6366F1) else Color(0xFF334155), RoundedCornerShape(10.dp))
                            .background(if (active) Color(0xFF1E1B4B) else Color(0xFF020617))
                            .clickable {
                                viewModel.liveConfig = if (asset.category == WardrobeCategory.CLOTHING) {
                                    config.copy(selectedClothingId = asset.id, wearClothes = true)
                                } else {
                                    config.copy(selectedJewelryId = asset.id, wearJewelry = true)
                                }
                            }
                            .padding(horizontal = 8.dp, vertical = 5.dp)
                    ) {
                        Text(asset.name, color = Color.White, fontSize = 10.sp)
                    }
                }
            }
        }
    }
}
