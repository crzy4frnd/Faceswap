package com.facemorph.studio.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Size
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.facemorph.studio.engine.AsyncCameraFrameBridge
import com.facemorph.studio.engine.NativeLiveArEngine
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.engine.ThermalPerformanceMonitor
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.model.WardrobeSubCategory
import com.facemorph.studio.viewmodel.StudioViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.roundToInt

@Composable
fun LiveCameraScreen(viewModel: StudioViewModel) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val config = viewModel.liveConfig
    val latestConfig by rememberUpdatedState(config)
    val latestBgMap by rememberUpdatedState(viewModel.backgroundBitmapCache.toMap())
    val latestProfileMap by rememberUpdatedState(viewModel.profileBitmapCache.toMap())
    val latestMetricsMap by rememberUpdatedState(viewModel.profileMetricsCache.toMap())
    val latestProfiles by rememberUpdatedState(viewModel.faceProfiles)
    val latestAngleBitmaps by rememberUpdatedState(viewModel.angleBitmapCache.toMap())
    val latestAngleMetrics by rememberUpdatedState(viewModel.angleMetricsCache.toMap())
    val latestWardrobeAssets by rememberUpdatedState(viewModel.wardrobeAssets)
    val latestWardrobeBitmaps by rememberUpdatedState(viewModel.wardrobeBitmapCache.toMap())
    val latestActiveProfileId by rememberUpdatedState(viewModel.activeProfileId)

    var activeDeckTab by remember { mutableIntStateOf(0) } // 0=Effects, 1=Background, 2=Wardrobe
    var isDeckExpanded by remember { mutableStateOf(true) }
    var showLiveLightStudio by remember { mutableStateOf(false) }
    var selectedWardrobeSubFilter by remember { mutableStateOf<String?>(null) }
    var pendingFaceCameraFile by remember { mutableStateOf<File?>(null) }

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

    val faceGalleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let {
            viewModel.addCustomFaceFromUri(it, sourceLabel = "Gallery")
            viewModel.liveConfig = viewModel.liveConfig.copy(faceSwapEnabled = true)
        }
    }

    val faceCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingFaceCameraFile
        if (success && file != null && file.exists()) {
            viewModel.addCustomFaceFromFile(file.absolutePath, sourceLabel = "Camera")
            viewModel.liveConfig = viewModel.liveConfig.copy(faceSwapEnabled = true)
        }
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
    val frameBridge = remember { AsyncCameraFrameBridge() }
    val thermalMonitor = remember { ThermalPerformanceMonitor(context.applicationContext) }
    val thermalWarning by thermalMonitor.warningState.collectAsState()
    val startTimeMs = remember { System.currentTimeMillis() }

    LaunchedEffect(config.faceSwapEnabled) {
        thermalMonitor.setFaceSwapActive(config.faceSwapEnabled)
    }

    DisposableEffect(thermalMonitor) {
        thermalMonitor.startMonitoring()
        onDispose {
            thermalMonitor.stopMonitoring()
            activeRecording?.stop()
            frameBridge.release()
            cameraExecutor.shutdown()
        }
    }

    // Dedicated asynchronous ML & rendering consumer loop decoupled from CameraX ImageProxy HAL queue
    LaunchedEffect(frameBridge) {
        withContext(Dispatchers.Default) {
            var lastEmittedBitmap: Bitmap? = null
            for (ignored in frameBridge.frameSignal) {
                val decoded = frameBridge.acquireLatestDecodedFrame() ?: continue
                val curCfg = latestConfig
                val bgBmp = latestBgMap[curCfg.activeBgId]
                val swapBmp = latestProfileMap[latestActiveProfileId]
                val swapMetrics = latestMetricsMap[latestActiveProfileId]
                val activeProfile = latestProfiles.find { it.id == latestActiveProfileId } ?: latestProfiles.firstOrNull()
                val activeAngleTriples = activeProfile?.angles?.mapNotNull { a ->
                    val ab = latestAngleBitmaps[a.id] ?: return@mapNotNull null
                    val am = latestAngleMetrics[a.id] ?: return@mapNotNull null
                    Triple(a, ab, am)
                } ?: emptyList()
                val clothAsset = latestWardrobeAssets.find { it.id == curCfg.selectedClothingId }
                val clothBmp = clothAsset?.let { latestWardrobeBitmaps[it.id] }
                val jewAsset = latestWardrobeAssets.find { it.id == curCfg.selectedJewelryId }
                val jewBmp = jewAsset?.let { latestWardrobeBitmaps[it.id] }
                val elapsedSec = (System.currentTimeMillis() - startTimeMs) / 1000f

                val reusableOut = frameBridge.acquireReusableOutputBitmap(
                    w = decoded.width,
                    h = decoded.height,
                    currentlyDisplayed = lastEmittedBitmap
                )
                val frameStartMs = SystemClock.elapsedRealtime()
                val out = NativeLiveArEngine.processLiveFrame(
                    frame = decoded.bitmap,
                    config = curCfg,
                    bgBitmap = bgBmp,
                    swapProfileBitmap = swapBmp,
                    swapProfileMetrics = swapMetrics,
                    clothingAsset = clothAsset,
                    clothingBitmap = clothBmp,
                    jewelryAsset = jewAsset,
                    jewelryBitmap = jewBmp,
                    timeSec = elapsedSec,
                    reusableOutput = reusableOut,
                    activeProfileAngles = activeAngleTriples
                )
                val frameDurationMs = SystemClock.elapsedRealtime() - frameStartMs
                thermalMonitor.recordFrameMetrics(
                    isFaceSwapActive = curCfg.faceSwapEnabled && swapBmp != null && swapMetrics != null && curCfg.swapStrength > 0,
                    processingDurationMs = frameDurationMs,
                    droppedFromBridge = decoded.droppedSinceLast
                )
                frameBridge.markOutputCommitted(out)
                lastEmittedBitmap = out
                withContext(Dispatchers.Main.immediate) {
                    processedBitmap = out
                    frameBridge.markOutputPresented(out)
                }
            }
        }
    }

    LaunchedEffect(hasCameraPermission, config.useFrontCamera) {
        if (!hasCameraPermission) return@LaunchedEffect
        frameBridge.resetSequenceForCameraSwitch()
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

        val resolutionSelector = ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(
                ResolutionStrategy(
                    Size(720, 960),
                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                )
            )
            .build()

        val imageAnalysis = ImageAnalysis.Builder()
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .setResolutionSelector(resolutionSelector)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
            frameBridge.submitImageProxy(imageProxy, mirrorHorizontal = latestConfig.useFrontCamera)
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
        // Maximized Camera Preview Stage
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

                // Top-Right Flip + Mesh Toggles
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
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
                            .size(36.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(Color(0xCC0B1120))
                            .border(1.dp, Color(0xFF334155), RoundedCornerShape(9.dp))
                            .clickable { viewModel.liveConfig = config.copy(useFrontCamera = !config.useFrontCamera) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.Cameraswitch, contentDescription = "Flip Camera", tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                }

                // Visual 'Performance Warning' overlay shown only when device thermals cause dropped frames during real-time face swap
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                ) {
                    androidx.compose.animation.AnimatedVisibility(
                        visible = thermalWarning.showPerformanceWarning && config.faceSwapEnabled,
                        enter = fadeIn(),
                        exit = fadeOut()
                    ) {
                    val severe = thermalWarning.isSevereThrottling
                    val borderTint = if (severe) Color(0xFFEF4444) else Color(0xFFF59E0B)
                    val accentTint = if (severe) Color(0xFFFCA5A5) else Color(0xFFFDE68A)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(11.dp))
                            .background(Color(0xE6111827))
                            .border(1.2.dp, borderTint, RoundedCornerShape(11.dp))
                            .padding(horizontal = 10.dp, vertical = 8.dp)
                    ) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = "Performance Warning",
                            tint = borderTint,
                            modifier = Modifier.size(18.dp)
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "Performance Warning",
                                color = accentTint,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                thermalWarning.message.ifBlank { "Device thermals are throttling real-time face swap" },
                                color = Color(0xFFE2E8F0),
                                fontSize = 10.sp
                            )
                        }
                        if (config.faceMotionTrail || config.removeHairAndBlemishes || config.removeBackground) {
                            Text(
                                "Optimize",
                                color = Color(0xFF0F172A),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(7.dp))
                                    .background(borderTint)
                                    .clickable {
                                        viewModel.liveConfig = config.copy(
                                            faceMotionTrail = false,
                                            removeHairAndBlemishes = false,
                                            removeBackground = false
                                        )
                                        thermalMonitor.dismissWarningTemporarily()
                                    }
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Dismiss Warning",
                            tint = Color(0xFF94A3B8),
                            modifier = Modifier
                                .size(18.dp)
                                .clickable { thermalMonitor.dismissWarningTemporarily() }
                        )
                    }
                    }
                }
            }
        }

        // Compact Capture Action Bar
        if (hasCameraPermission) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF070B14))
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(9.dp))
                        .background(Color(0xFF1E293B))
                        .clickable { viewModel.showCustomAssetDialog = true }
                        .padding(horizontal = 10.dp, vertical = 7.dp)
                ) {
                    Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Scan Item", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }

                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                        .border(3.dp, Color(0xFF6366F1), CircleShape)
                        .clickable {
                            processedBitmap?.let { bmp ->
                                val snapshot = bmp.copy(Bitmap.Config.ARGB_8888, false)
                                if (snapshot != null) {
                                    viewModel.exportBitmapToGallery(snapshot, "LiveAR")
                                }
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = "Snap Photo", tint = Color(0xFF0F172A), modifier = Modifier.size(20.dp))
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(9.dp))
                        .background(if (isRecording) Color(0xFFDC2626) else Color(0xFF1E293B))
                        .clickable { toggleVideoRecording() }
                        .padding(horizontal = 12.dp, vertical = 7.dp)
                ) {
                    Icon(
                        if (isRecording) Icons.Default.Stop else Icons.Default.Videocam,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(15.dp)
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(if (isRecording) "Stop" else "Record", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // Collapsible Bottom Studio Deck
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .animateContentSize()
                .background(Color(0xFF0B1120))
        ) {
            HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(9.dp))
                        .background(Color(0xFF111827))
                        .padding(3.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf("Effects", "Background", "Wardrobe").forEachIndexed { idx, label ->
                        val selected = isDeckExpanded && activeDeckTab == idx
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(7.dp))
                                .background(if (selected) Color(0xFF4F46E5) else Color.Transparent)
                                .clickable {
                                    if (isDeckExpanded && activeDeckTab == idx) {
                                        isDeckExpanded = false
                                    } else {
                                        activeDeckTab = idx
                                        isDeckExpanded = true
                                    }
                                }
                                .padding(vertical = 6.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(label, color = if (selected) Color.White else Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        }
                    }
                }

                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF111827))
                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp))
                        .clickable { isDeckExpanded = !isDeckExpanded },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        if (isDeckExpanded) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                        contentDescription = if (isDeckExpanded) "Collapse" else "Expand",
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            if (isDeckExpanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 12.dp, end = 12.dp, bottom = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    when (activeDeckTab) {
                        0 -> {
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                val toggles = buildList {
                                    add(Triple("BG Cutout", config.removeBackground) { viewModel.liveConfig = config.copy(removeBackground = !config.removeBackground) })
                                    add(Triple("Skin Smooth", config.removeHairAndBlemishes) { viewModel.liveConfig = config.copy(removeHairAndBlemishes = !config.removeHairAndBlemishes) })
                                    add(Triple("Clothes", config.wearClothes) { viewModel.liveConfig = config.copy(wearClothes = !config.wearClothes) })
                                    add(Triple("Jewelry", config.wearJewelry) { viewModel.liveConfig = config.copy(wearJewelry = !config.wearJewelry) })
                                    add(Triple("Face Swap", config.faceSwapEnabled) { viewModel.liveConfig = config.copy(faceSwapEnabled = !config.faceSwapEnabled) })
                                    if (config.faceSwapEnabled) {
                                        add(Triple("Profiles (${viewModel.faceProfiles.size})", viewModel.showFaceProfileManager) {
                                            viewModel.showFaceProfileManager = true
                                        })
                                        add(Triple("Motion Trail", config.faceMotionTrail) { viewModel.liveConfig = config.copy(faceMotionTrail = !config.faceMotionTrail) })
                                        add(Triple("Relight", showLiveLightStudio) { showLiveLightStudio = !showLiveLightStudio })
                                    }
                                    add(Triple("3D Mesh", config.showLandmarkMesh) { viewModel.liveConfig = config.copy(showLandmarkMesh = !config.showLandmarkMesh) })
                                }
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

                            if (config.faceSwapEnabled && showLiveLightStudio) {
                                VirtualLightingStudioPanel(
                                    light = config.virtualLight,
                                    onLightChange = { viewModel.liveConfig = config.copy(virtualLight = it) },
                                    compact = true
                                )
                            }

                            if (config.faceSwapEnabled && viewModel.faceProfiles.isEmpty()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Add Face:", color = Color(0xFF94A3B8), fontSize = 11.sp)
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(Color(0xFF1E1B4B))
                                            .border(1.dp, Color(0xFF4F46E5), RoundedCornerShape(8.dp))
                                            .clickable {
                                                viewModel.pendingAngleTargetProfileId = null
                                                faceGalleryPicker.launch("image/*")
                                            }
                                            .padding(horizontal = 10.dp, vertical = 6.dp)
                                    ) {
                                        Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("Gallery", color = Color.White, fontSize = 11.sp)
                                    }
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(Color(0xFF082F49))
                                            .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(8.dp))
                                            .clickable {
                                                viewModel.pendingAngleTargetProfileId = null
                                                val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "live_face")
                                                pendingFaceCameraFile = file
                                                faceCameraLauncher.launch(uri)
                                            }
                                            .padding(horizontal = 10.dp, vertical = 6.dp)
                                    ) {
                                        Icon(Icons.Default.CameraAlt, contentDescription = null, tint = Color(0xFF22D3EE), modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("Camera", color = Color.White, fontSize = 11.sp)
                                    }
                                }
                            } else if (config.removeHairAndBlemishes) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Smooth ${config.hairRemovalIntensity}%", color = Color(0xFFF472B6), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                    Slider(
                                        value = config.hairRemovalIntensity.toFloat(),
                                        onValueChange = { viewModel.liveConfig = config.copy(hairRemovalIntensity = it.toInt()) },
                                        valueRange = 0f..100f,
                                        modifier = Modifier.weight(1f).height(26.dp)
                                    )
                                }
                            } else if (config.faceSwapEnabled) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Swap ${config.swapStrength}%", color = Color(0xFF818CF8), fontSize = 11.sp, modifier = Modifier.width(88.dp))
                                    Slider(
                                        value = config.swapStrength.toFloat(),
                                        onValueChange = { viewModel.liveConfig = config.copy(swapStrength = it.toInt()) },
                                        valueRange = 20f..100f,
                                        modifier = Modifier.weight(1f).height(26.dp)
                                    )
                                }
                            } else if (config.wearClothes) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Body-fit mesh tracks shoulders & torso.", color = Color(0xFF94A3B8), fontSize = 11.sp)
                                    Text(
                                        "Tune Fit",
                                        color = Color(0xFF38BDF8),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(7.dp))
                                            .background(Color(0xFF0F172A))
                                            .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(7.dp))
                                            .clickable { activeDeckTab = 2 }
                                            .padding(horizontal = 8.dp, vertical = 4.dp)
                                    )
                                }
                            } else {
                                Text("Tap any effect chip above to toggle live AR layers.", color = Color(0xFF64748B), fontSize = 11.sp)
                            }
                        }

                        1 -> {
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "Original",
                                    color = if (!config.removeBackground) Color.White else Color(0xFF94A3B8),
                                    fontSize = 11.sp,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(if (!config.removeBackground) Color(0xFF312E81) else Color(0xFF111827))
                                        .border(1.dp, if (!config.removeBackground) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(10.dp))
                                        .clickable { viewModel.liveConfig = config.copy(removeBackground = false) }
                                        .padding(horizontal = 12.dp, vertical = 9.dp)
                                )
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
                                            .padding(horizontal = 12.dp, vertical = 9.dp)
                                    )
                                }
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color(0xFF111827))
                                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                                        .clickable { bgPicker.launch("image/*") }
                                        .padding(horizontal = 12.dp, vertical = 9.dp)
                                ) {
                                    Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, tint = Color(0xFF818CF8), modifier = Modifier.size(15.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("Gallery BG", color = Color.White, fontSize = 11.sp)
                                }
                            }
                        }

                        2 -> {
                            val subCategories = remember(viewModel.wardrobeAssets, viewModel.customSubCategories) {
                                val ordered = LinkedHashSet<String>()
                                listOf(
                                    WardrobeSubCategory.SUIT.label,
                                    WardrobeSubCategory.SHIRT.label,
                                    WardrobeSubCategory.JACKET.label,
                                    WardrobeSubCategory.ETHNIC.label,
                                    WardrobeSubCategory.NECKLACE.label,
                                    WardrobeSubCategory.EARRING.label,
                                    WardrobeSubCategory.WATCH.label,
                                    WardrobeSubCategory.GLASSES.label
                                ).forEach { ordered.add(it) }
                                viewModel.wardrobeAssets.forEach { ordered.add(it.displaySubCategory) }
                                viewModel.customSubCategories.values.flatten().forEach { ordered.add(it) }
                                ordered.toList()
                            }
                            val visibleAssets = remember(viewModel.wardrobeAssets, selectedWardrobeSubFilter) {
                                val sub = selectedWardrobeSubFilter
                                if (sub == null) viewModel.wardrobeAssets
                                else viewModel.wardrobeAssets.filter { it.displaySubCategory.equals(sub, ignoreCase = true) }
                            }

                            // Easy Sub-Category Selection Row (Built-in + User-Created items like Kurta, Jhumka, etc.)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                val allSelected = selectedWardrobeSubFilter == null
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(if (allSelected) Color(0xFF4F46E5) else Color(0xFF111827))
                                        .border(
                                            1.dp,
                                            if (allSelected) Color(0xFF818CF8) else Color(0xFF1E293B),
                                            RoundedCornerShape(8.dp)
                                        )
                                        .clickable { selectedWardrobeSubFilter = null }
                                        .padding(horizontal = 10.dp, vertical = 5.dp)
                                ) {
                                    Text(
                                        "All (${viewModel.wardrobeAssets.size})",
                                        color = if (allSelected) Color.White else Color(0xFFCBD5E1),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1
                                    )
                                }

                                subCategories.forEach { subLabel ->
                                    val subAssets = viewModel.wardrobeAssets.filter { it.displaySubCategory.equals(subLabel, ignoreCase = true) }
                                    val isSel = selectedWardrobeSubFilter == subLabel
                                    val isWornInSub = subAssets.any { asset ->
                                        if (asset.category == WardrobeCategory.CLOTHING) {
                                            config.wearClothes && config.selectedClothingId == asset.id
                                        } else {
                                            config.wearJewelry && config.selectedJewelryId == asset.id
                                        }
                                    }
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(
                                                when {
                                                    isSel -> Color(0xFF4F46E5)
                                                    isWornInSub -> Color(0xFF1E1B4B)
                                                    else -> Color(0xFF111827)
                                                }
                                            )
                                            .border(
                                                1.dp,
                                                when {
                                                    isSel -> Color(0xFF818CF8)
                                                    isWornInSub -> Color(0xFF22D3EE)
                                                    else -> Color(0xFF1E293B)
                                                },
                                                RoundedCornerShape(8.dp)
                                            )
                                            .clickable {
                                                selectedWardrobeSubFilter = subLabel
                                                val firstMatch = subAssets.firstOrNull()
                                                if (firstMatch != null && !isWornInSub) {
                                                    viewModel.liveConfig = if (firstMatch.category == WardrobeCategory.CLOTHING) {
                                                        config.copy(selectedClothingId = firstMatch.id, wearClothes = true)
                                                    } else {
                                                        config.copy(selectedJewelryId = firstMatch.id, wearJewelry = true)
                                                    }
                                                }
                                            }
                                            .padding(horizontal = 10.dp, vertical = 5.dp)
                                    ) {
                                        if (isWornInSub) {
                                            Box(
                                                modifier = Modifier
                                                    .size(6.dp)
                                                    .clip(CircleShape)
                                                    .background(Color(0xFF22D3EE))
                                            )
                                        }
                                        Text(
                                            if (subAssets.isNotEmpty()) "$subLabel (${subAssets.size})" else subLabel,
                                            color = if (isSel || isWornInSub) Color.White else Color(0xFFCBD5E1),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1
                                        )
                                    }
                                }
                            }

                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .width(62.dp)
                                        .height(66.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .border(1.dp, Color(0xFF334155), RoundedCornerShape(10.dp))
                                        .background(Color(0xFF111827))
                                        .clickable {
                                            viewModel.liveConfig = config.copy(wearClothes = false, wearJewelry = false)
                                        }
                                        .padding(6.dp)
                                ) {
                                    Icon(Icons.Default.Block, contentDescription = null, tint = Color(0xFF94A3B8), modifier = Modifier.size(19.dp))
                                    Spacer(Modifier.height(4.dp))
                                    Text("Clear", color = Color(0xFF94A3B8), fontSize = 10.sp)
                                }

                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Center,
                                    modifier = Modifier
                                        .width(64.dp)
                                        .height(66.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .border(1.dp, Color(0xFF0284C7), RoundedCornerShape(10.dp))
                                        .background(Color(0xFF082F49))
                                        .clickable { viewModel.showCustomAssetDialog = true }
                                        .padding(6.dp)
                                ) {
                                    Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.height(4.dp))
                                    Text("+ Scan", color = Color(0xFF38BDF8), fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                }

                                visibleAssets.forEach { asset ->
                                    val active = if (asset.category == WardrobeCategory.CLOTHING) {
                                        config.wearClothes && config.selectedClothingId == asset.id
                                    } else {
                                        config.wearJewelry && config.selectedJewelryId == asset.id
                                    }
                                    val bmp = viewModel.wardrobeBitmapCache[asset.id]
                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        modifier = Modifier
                                            .width(80.dp)
                                            .height(66.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                            .border(1.dp, if (active) Color(0xFF6366F1) else Color(0xFF1E293B), RoundedCornerShape(10.dp))
                                            .background(if (active) Color(0xFF1E1B4B) else Color(0xFF111827))
                                            .clickable {
                                                viewModel.liveConfig = if (asset.category == WardrobeCategory.CLOTHING) {
                                                    val toggleOff = config.wearClothes && config.selectedClothingId == asset.id
                                                    config.copy(selectedClothingId = asset.id, wearClothes = !toggleOff)
                                                } else {
                                                    val toggleOff = config.wearJewelry && config.selectedJewelryId == asset.id
                                                    config.copy(selectedJewelryId = asset.id, wearJewelry = !toggleOff)
                                                }
                                            }
                                            .padding(5.dp)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(34.dp)
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

                            if (config.wearClothes) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color(0xFF111827))
                                        .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(10.dp))
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalArrangement = Arrangement.spacedBy(2.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("Body Fit Calibration", color = Color(0xFF38BDF8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(Color(0xFF1E293B))
                                                .clickable {
                                                    viewModel.liveConfig = config.copy(
                                                        clothWidthScale = 1.0f,
                                                        clothCollarOffset = 0f,
                                                        clothFitHug = 0.45f
                                                    )
                                                }
                                                .padding(horizontal = 6.dp, vertical = 2.dp)
                                        ) {
                                            Icon(Icons.Default.RestartAlt, contentDescription = "Reset Fit", tint = Color(0xFF94A3B8), modifier = Modifier.size(12.dp))
                                            Spacer(Modifier.width(3.dp))
                                            Text("Reset", color = Color(0xFFCBD5E1), fontSize = 9.sp)
                                        }
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            "Width ${(config.clothWidthScale * 100f).roundToInt()}%",
                                            color = Color(0xFFCBD5E1),
                                            fontSize = 10.sp,
                                            modifier = Modifier.width(82.dp)
                                        )
                                        Slider(
                                            value = config.clothWidthScale,
                                            onValueChange = { viewModel.liveConfig = config.copy(clothWidthScale = it) },
                                            valueRange = 0.75f..1.55f,
                                            modifier = Modifier.weight(1f).height(24.dp)
                                        )
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            "Collar ${config.clothCollarOffset.roundToInt()}",
                                            color = Color(0xFFCBD5E1),
                                            fontSize = 10.sp,
                                            modifier = Modifier.width(82.dp)
                                        )
                                        Slider(
                                            value = config.clothCollarOffset,
                                            onValueChange = { viewModel.liveConfig = config.copy(clothCollarOffset = it) },
                                            valueRange = -80f..80f,
                                            modifier = Modifier.weight(1f).height(24.dp)
                                        )
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            "Hug ${(config.clothFitHug * 100f).roundToInt()}%",
                                            color = Color(0xFFCBD5E1),
                                            fontSize = 10.sp,
                                            modifier = Modifier.width(82.dp)
                                        )
                                        Slider(
                                            value = config.clothFitHug,
                                            onValueChange = { viewModel.liveConfig = config.copy(clothFitHug = it) },
                                            valueRange = 0f..1f,
                                            modifier = Modifier.weight(1f).height(24.dp)
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
