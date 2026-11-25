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
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Wallpaper
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.facemorph.studio.engine.AsyncCameraFrameBridge
import com.facemorph.studio.engine.NativeLiveArEngine
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.engine.ThermalPerformanceMonitor
import com.facemorph.studio.model.LiveBodyMeasurementSummary
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
    var isDeckExpanded by remember { mutableStateOf(false) }
    var showLiveLightStudio by remember { mutableStateOf(false) }
    var selectedWardrobeSubFilter by remember { mutableStateOf<String?>(null) }
    var pendingFaceCameraFile by remember { mutableStateOf<File?>(null) }
    val isFullScreen = viewModel.isFullScreenEditor

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
    var liveBodyMeasurement by remember { mutableStateOf<LiveBodyMeasurementSummary?>(null) }
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

    // Asynchronous ML & rendering consumer decoupled from CameraX ImageProxy HAL queue
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
                var latestMeasure: LiveBodyMeasurementSummary? = null
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
                    activeProfileAngles = activeAngleTriples,
                    onBodyMeasurements = { latestMeasure = it }
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
                    if (latestMeasure != null) {
                        liveBodyMeasurement = latestMeasure
                    }
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
            .background(StudioColors.Background)
    ) {
        // Edge-to-Edge Camera Preview Stage
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(StudioColors.SurfaceContainerLowest),
            contentAlignment = Alignment.Center
        ) {
            if (!hasCameraPermission) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = StudioColors.SurfaceContainer,
                    tonalElevation = 3.dp,
                    modifier = Modifier.padding(24.dp)
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(24.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(60.dp)
                                .clip(CircleShape)
                                .background(StudioColors.PrimaryContainer),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Videocam, contentDescription = null, tint = StudioColors.Primary, modifier = Modifier.size(30.dp))
                        }
                        Text("Live Camera AR", color = StudioColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(
                            "Allow camera & microphone access for real-time background removal, smoothing, and AR outfits.",
                            color = StudioColors.TextSecondary,
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center
                        )
                        StudioTonalActionButton(
                            label = "Allow Camera",
                            icon = Icons.Default.CameraAlt,
                            onClick = { permLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)) },
                            containerColor = StudioColors.PrimaryContainer,
                            contentColor = StudioColors.OnPrimaryContainer,
                            iconTint = StudioColors.Primary,
                            modifier = Modifier.fillMaxWidth()
                        )
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
                } ?: Text("Starting Camera...", color = StudioColors.TextSecondary, fontSize = 13.sp)

                // Top-Start REC & Live Fit HUD
                Column(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .statusBarsPadding()
                        .padding(start = 12.dp, top = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (isRecording) {
                        Surface(
                            shape = CircleShape,
                            color = Color(0xDDDC2626),
                            shadowElevation = 4.dp
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.FiberManualRecord, contentDescription = null, tint = Color.White, modifier = Modifier.size(11.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("REC %02d:%02d".format(recordSeconds / 60, recordSeconds % 60), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    val showHudBody = !isFullScreen && config.showBodyMeasurements &&
                        (config.wearClothes || config.wearJewelry || config.showLandmarkMesh)
                    val m = liveBodyMeasurement
                    if (showHudBody && m != null) {
                        val dotColor = if (m.hasSkeletonPose) StudioColors.Tertiary else StudioColors.Warning
                        val modeTag = when {
                            m.hasSkeletonPose && m.hasHips -> "Full Pose"
                            m.hasSkeletonPose -> "Pose Lock"
                            else -> "Step back"
                        }
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = StudioColors.FloatingGlass,
                            shadowElevation = 6.dp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(14.dp))
                                .clickable {
                                    activeDeckTab = 2
                                    isDeckExpanded = true
                                }
                        ) {
                            Column(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(dotColor))
                                    Text("Fit ${m.estimatedSize}", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    Text(modeTag, color = dotColor, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                }
                                Text(
                                    "S ${m.shoulderCm} · C ${m.chestCm} · W ${m.waistCm}cm",
                                    color = StudioColors.TextSecondary,
                                    fontSize = 10.sp
                                )
                            }
                        }
                    }
                }

                // Top-End Mesh, Flip Camera, & Fullscreen Toggle
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .statusBarsPadding()
                        .padding(end = 12.dp, top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (!isFullScreen) {
                        StudioFloatingIconButton(
                            icon = Icons.Default.GridOn,
                            contentDescription = "Mesh",
                            onClick = { viewModel.liveConfig = config.copy(showLandmarkMesh = !config.showLandmarkMesh) },
                            active = config.showLandmarkMesh,
                            activeContainerColor = StudioColors.SecondaryContainer,
                            activeContentColor = StudioColors.OnSecondaryContainer,
                            size = 42.dp
                        )
                    }
                    StudioFloatingIconButton(
                        icon = Icons.Default.Cameraswitch,
                        contentDescription = "Flip Camera",
                        onClick = { viewModel.liveConfig = config.copy(useFrontCamera = !config.useFrontCamera) },
                        size = 42.dp
                    )
                    StudioFloatingIconButton(
                        icon = if (isFullScreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                        contentDescription = if (isFullScreen) "Exit Fullscreen" else "Full Screen Viewfinder",
                        onClick = { viewModel.isFullScreenEditor = !isFullScreen },
                        active = isFullScreen,
                        activeContainerColor = StudioColors.PrimaryContainer,
                        size = 42.dp
                    )
                }

                // Fullscreen Floating Shutter Pill (when docked controls are hidden)
                if (isFullScreen) {
                    Row(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .navigationBarsPadding()
                            .padding(bottom = 18.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(58.dp)
                                .clip(CircleShape)
                                .background(Color.White)
                                .border(3.5.dp, StudioColors.Primary, CircleShape)
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
                            Icon(Icons.Default.CameraAlt, contentDescription = "Snap Photo", tint = StudioColors.Background, modifier = Modifier.size(24.dp))
                        }
                        Surface(
                            shape = CircleShape,
                            color = if (isRecording) StudioColors.DangerContainer else StudioColors.FloatingGlass,
                            shadowElevation = 6.dp,
                            modifier = Modifier
                                .height(44.dp)
                                .clip(CircleShape)
                                .clickable { toggleVideoRecording() }
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 16.dp)
                            ) {
                                Icon(
                                    if (isRecording) Icons.Default.Stop else Icons.Default.Videocam,
                                    contentDescription = null,
                                    tint = if (isRecording) StudioColors.Danger else Color.White,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(if (isRecording) "Stop" else "Record", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                // Thermal Performance Warning Banner
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                ) {
                    AnimatedVisibility(
                        visible = thermalWarning.showPerformanceWarning && config.faceSwapEnabled,
                        enter = fadeIn(),
                        exit = fadeOut()
                    ) {
                        val severe = thermalWarning.isSevereThrottling
                        val bgTint = if (severe) StudioColors.DangerContainer else StudioColors.WarningContainer
                        val accentTint = if (severe) StudioColors.Danger else StudioColors.Warning
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = bgTint,
                            shadowElevation = 6.dp,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                Icon(Icons.Default.Warning, contentDescription = "Performance Warning", tint = accentTint, modifier = Modifier.size(20.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Performance Warning", color = accentTint, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    Text(
                                        thermalWarning.message.ifBlank { "Device thermals are throttling real-time face swap" },
                                        color = Color.White,
                                        fontSize = 11.sp
                                    )
                                }
                                if (config.faceMotionTrail || config.removeHairAndBlemishes || config.removeBackground) {
                                    Text(
                                        "Optimize",
                                        color = StudioColors.OnPrimary,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(accentTint)
                                            .clickable {
                                                viewModel.liveConfig = config.copy(
                                                    faceMotionTrail = false,
                                                    removeHairAndBlemishes = false,
                                                    removeBackground = false
                                                )
                                                thermalMonitor.dismissWarningTemporarily()
                                            }
                                            .padding(horizontal = 10.dp, vertical = 5.dp)
                                    )
                                }
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription = "Dismiss Warning",
                                    tint = StudioColors.TextSecondary,
                                    modifier = Modifier
                                        .size(20.dp)
                                        .clickable { thermalMonitor.dismissWarningTemporarily() }
                                )
                            }
                        }
                    }
                }
            }
        }

        // Docked Camera Capture Bar + Collapsible Material 3 Bottom Sheet
        AnimatedVisibility(
            visible = !isFullScreen,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically()
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (hasCameraPermission) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(StudioColors.Background)
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StudioTonalActionButton(
                            label = "Scan Item",
                            icon = Icons.Default.AddAPhoto,
                            onClick = { viewModel.showCustomAssetDialog = true },
                            iconTint = StudioColors.Warning
                        )

                        Box(
                            modifier = Modifier
                                .size(54.dp)
                                .clip(CircleShape)
                                .background(Color.White)
                                .border(3.5.dp, StudioColors.Primary, CircleShape)
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
                            Icon(Icons.Default.CameraAlt, contentDescription = "Snap Photo", tint = StudioColors.Background, modifier = Modifier.size(22.dp))
                        }

                        StudioTonalActionButton(
                            label = if (isRecording) "Stop" else "Record",
                            icon = if (isRecording) Icons.Default.Stop else Icons.Default.Videocam,
                            onClick = { toggleVideoRecording() },
                            containerColor = if (isRecording) StudioColors.DangerContainer else StudioColors.SurfaceContainerHigh,
                            contentColor = if (isRecording) StudioColors.Danger else StudioColors.TextPrimary,
                            iconTint = if (isRecording) StudioColors.Danger else StudioColors.Secondary
                        )
                    }
                }

                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .animateContentSize(),
                    color = StudioColors.SurfaceContainerLow,
                    shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                    tonalElevation = 4.dp
                ) {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        if (isDeckExpanded) {
                            StudioSheetDragHandle(modifier = Modifier.clickable { isDeckExpanded = false })
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 2.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = when (activeDeckTab) {
                                        0 -> "Live AR Effects"
                                        1 -> "Background Replacement"
                                        else -> "Live Outfit & Jewelry"
                                    },
                                    color = StudioColors.TextPrimary,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                IconButton(onClick = { isDeckExpanded = false }, modifier = Modifier.size(32.dp)) {
                                    Icon(Icons.Default.ExpandMore, contentDescription = "Collapse", tint = StudioColors.TextSecondary, modifier = Modifier.size(20.dp))
                                }
                            }

                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 240.dp)
                                    .verticalScroll(rememberScrollState())
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                when (activeDeckTab) {
                                    0 -> {
                                        StudioSectionCard {
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
                                                    add(Triple("Body Fit", config.showBodyMeasurements) { viewModel.updateLiveFitConfig { c -> c.copy(showBodyMeasurements = !c.showBodyMeasurements) } })
                                                    add(Triple("3D Mesh", config.showLandmarkMesh) { viewModel.liveConfig = config.copy(showLandmarkMesh = !config.showLandmarkMesh) })
                                                }
                                                toggles.forEach { (label, active, onClick) ->
                                                    StudioFilterChip(
                                                        label = label,
                                                        selected = active,
                                                        onClick = onClick
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
                                                    StudioTonalActionButton(
                                                        label = "Gallery Face",
                                                        icon = Icons.Default.PhotoLibrary,
                                                        onClick = {
                                                            viewModel.pendingAngleTargetProfileId = null
                                                            faceGalleryPicker.launch("image/*")
                                                        },
                                                        containerColor = StudioColors.PrimaryContainer,
                                                        contentColor = StudioColors.OnPrimaryContainer,
                                                        iconTint = StudioColors.Primary,
                                                        modifier = Modifier.weight(1f)
                                                    )
                                                    StudioTonalActionButton(
                                                        label = "Camera Face",
                                                        icon = Icons.Default.CameraAlt,
                                                        onClick = {
                                                            viewModel.pendingAngleTargetProfileId = null
                                                            val (uri, file) = NativeStorageHelper.createTempCameraUri(context, "live_face")
                                                            pendingFaceCameraFile = file
                                                            faceCameraLauncher.launch(uri)
                                                        },
                                                        containerColor = StudioColors.SecondaryContainer,
                                                        contentColor = StudioColors.OnSecondaryContainer,
                                                        iconTint = StudioColors.Secondary,
                                                        modifier = Modifier.weight(1f)
                                                    )
                                                }
                                            } else if (config.removeHairAndBlemishes) {
                                                StudioSliderRow(
                                                    label = "Skin Smooth",
                                                    valueText = "${config.hairRemovalIntensity}%",
                                                    value = config.hairRemovalIntensity.toFloat(),
                                                    onValueChange = { viewModel.liveConfig = config.copy(hairRemovalIntensity = it.toInt()) },
                                                    valueRange = 0f..100f
                                                )
                                            } else if (config.faceSwapEnabled) {
                                                StudioSliderRow(
                                                    label = "Live Swap Blend",
                                                    valueText = "${config.swapStrength}%",
                                                    value = config.swapStrength.toFloat(),
                                                    onValueChange = { viewModel.liveConfig = config.copy(swapStrength = it.toInt()) },
                                                    valueRange = 20f..100f
                                                )
                                            } else if (config.wearClothes) {
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    horizontalArrangement = Arrangement.SpaceBetween,
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    Text("Body-fit mesh tracks shoulders & torso.", color = StudioColors.TextSecondary, fontSize = 12.sp)
                                                    StudioFilterChip(
                                                        label = "Tune Fit",
                                                        selected = true,
                                                        selectedContainerColor = StudioColors.SecondaryContainer,
                                                        selectedContentColor = StudioColors.OnSecondaryContainer,
                                                        onClick = { activeDeckTab = 2 }
                                                    )
                                                }
                                            } else {
                                                Text("Tap any effect chip above to toggle live AR layers.", color = StudioColors.TextMuted, fontSize = 12.sp)
                                            }
                                        }
                                    }

                                    1 -> {
                                        StudioSectionCard {
                                            Row(
                                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                StudioFilterChip(
                                                    label = "Original",
                                                    selected = !config.removeBackground,
                                                    onClick = { viewModel.liveConfig = config.copy(removeBackground = false) }
                                                )
                                                listOf(
                                                    "studio" to "Studio Loft",
                                                    "neon" to "Cyberpunk",
                                                    "sunset" to "Sunset",
                                                    "green" to "Chroma Green"
                                                ).forEach { (id, title) ->
                                                    val sel = config.removeBackground && config.activeBgId == id
                                                    StudioFilterChip(
                                                        label = title,
                                                        selected = sel,
                                                        onClick = { viewModel.liveConfig = config.copy(activeBgId = id, removeBackground = true) }
                                                    )
                                                }
                                                StudioFilterChip(
                                                    label = "Gallery BG",
                                                    selected = false,
                                                    icon = Icons.Default.AddPhotoAlternate,
                                                    onClick = { bgPicker.launch("image/*") }
                                                )
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

                                        StudioSectionCard {
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .horizontalScroll(rememberScrollState()),
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                StudioFilterChip(
                                                    label = "All (${viewModel.wardrobeAssets.size})",
                                                    selected = selectedWardrobeSubFilter == null,
                                                    onClick = { selectedWardrobeSubFilter = null }
                                                )
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
                                                    StudioFilterChip(
                                                        label = if (subAssets.isNotEmpty()) "$subLabel (${subAssets.size})" else subLabel,
                                                        selected = isSel || isWornInSub,
                                                        selectedContainerColor = if (isSel) StudioColors.PrimaryContainer else StudioColors.SecondaryContainer,
                                                        selectedContentColor = if (isSel) StudioColors.OnPrimaryContainer else StudioColors.OnSecondaryContainer,
                                                        onClick = {
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
                                                    )
                                                }
                                            }

                                            Row(
                                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                                            ) {
                                                Surface(
                                                    shape = RoundedCornerShape(14.dp),
                                                    color = StudioColors.SurfaceContainerHigh,
                                                    modifier = Modifier
                                                        .width(66.dp)
                                                        .height(74.dp)
                                                        .clip(RoundedCornerShape(14.dp))
                                                        .clickable {
                                                            viewModel.liveConfig = config.copy(wearClothes = false, wearJewelry = false)
                                                        }
                                                ) {
                                                    Column(
                                                        horizontalAlignment = Alignment.CenterHorizontally,
                                                        verticalArrangement = Arrangement.Center,
                                                        modifier = Modifier.padding(6.dp)
                                                    ) {
                                                        Icon(Icons.Default.Block, contentDescription = null, tint = StudioColors.TextSecondary, modifier = Modifier.size(20.dp))
                                                        Spacer(Modifier.height(4.dp))
                                                        Text("Clear", color = StudioColors.TextSecondary, fontSize = 11.sp)
                                                    }
                                                }

                                                Surface(
                                                    shape = RoundedCornerShape(14.dp),
                                                    color = StudioColors.SecondaryContainer,
                                                    modifier = Modifier
                                                        .width(68.dp)
                                                        .height(74.dp)
                                                        .clip(RoundedCornerShape(14.dp))
                                                        .clickable { viewModel.showCustomAssetDialog = true }
                                                ) {
                                                    Column(
                                                        horizontalAlignment = Alignment.CenterHorizontally,
                                                        verticalArrangement = Arrangement.Center,
                                                        modifier = Modifier.padding(6.dp)
                                                    ) {
                                                        Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = StudioColors.Secondary, modifier = Modifier.size(20.dp))
                                                        Spacer(Modifier.height(4.dp))
                                                        Text("Scan", color = StudioColors.Secondary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                                    }
                                                }

                                                visibleAssets.forEach { asset ->
                                                    val active = if (asset.category == WardrobeCategory.CLOTHING) {
                                                        config.wearClothes && config.selectedClothingId == asset.id
                                                    } else {
                                                        config.wearJewelry && config.selectedJewelryId == asset.id
                                                    }
                                                    val bmp = viewModel.wardrobeBitmapCache[asset.id]
                                                    Surface(
                                                        shape = RoundedCornerShape(14.dp),
                                                        color = if (active) StudioColors.PrimaryContainer else StudioColors.SurfaceContainerHigh,
                                                        modifier = Modifier
                                                            .width(84.dp)
                                                            .height(74.dp)
                                                            .clip(RoundedCornerShape(14.dp))
                                                            .clickable {
                                                                viewModel.liveConfig = if (asset.category == WardrobeCategory.CLOTHING) {
                                                                    val toggleOff = config.wearClothes && config.selectedClothingId == asset.id
                                                                    config.copy(selectedClothingId = asset.id, wearClothes = !toggleOff)
                                                                } else {
                                                                    val toggleOff = config.wearJewelry && config.selectedJewelryId == asset.id
                                                                    config.copy(selectedJewelryId = asset.id, wearJewelry = !toggleOff)
                                                                }
                                                            }
                                                    ) {
                                                        Column(
                                                            horizontalAlignment = Alignment.CenterHorizontally,
                                                            modifier = Modifier.padding(6.dp)
                                                        ) {
                                                            Box(
                                                                modifier = Modifier
                                                                    .size(38.dp)
                                                                    .clip(RoundedCornerShape(8.dp))
                                                                    .background(StudioColors.SurfaceContainerLowest),
                                                                contentAlignment = Alignment.Center
                                                            ) {
                                                                if (bmp != null) {
                                                                    Image(bitmap = bmp.asImageBitmap(), contentDescription = asset.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(3.dp))
                                                                }
                                                            }
                                                            Spacer(Modifier.height(4.dp))
                                                            Text(asset.name, color = Color.White, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        if (config.wearClothes) {
                                            StudioSectionCard {
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    horizontalArrangement = Arrangement.SpaceBetween,
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    val m = liveBodyMeasurement
                                                    val fitLabel = if (m != null) {
                                                        "Body Fit · ${m.estimatedSize} (${m.shoulderCm}/${m.chestCm}/${m.waistCm}cm)"
                                                    } else {
                                                        "Body Fit Calibration"
                                                    }
                                                    Text(fitLabel, color = StudioColors.Secondary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                                    StudioFilterChip(
                                                        label = "Reset",
                                                        selected = false,
                                                        icon = Icons.Default.RestartAlt,
                                                        onClick = {
                                                            viewModel.updateLiveFitConfig { c ->
                                                                c.copy(
                                                                    clothWidthScale = 1.0f,
                                                                    clothLengthScale = 1.0f,
                                                                    clothCollarOffset = 0f,
                                                                    clothFitHug = 0.45f
                                                                )
                                                            }
                                                        }
                                                    )
                                                }
                                                StudioSliderRow(
                                                    label = "Width",
                                                    valueText = "${(config.clothWidthScale * 100f).roundToInt()}%",
                                                    value = config.clothWidthScale,
                                                    onValueChange = { v -> viewModel.updateLiveFitConfig { c -> c.copy(clothWidthScale = v) } },
                                                    valueRange = 0.75f..1.55f
                                                )
                                                StudioSliderRow(
                                                    label = "Length",
                                                    valueText = "${(config.clothLengthScale * 100f).roundToInt()}%",
                                                    value = config.clothLengthScale,
                                                    onValueChange = { v -> viewModel.updateLiveFitConfig { c -> c.copy(clothLengthScale = v) } },
                                                    valueRange = 0.75f..1.40f
                                                )
                                                StudioSliderRow(
                                                    label = "Collar Offset",
                                                    valueText = "${config.clothCollarOffset.roundToInt()}",
                                                    value = config.clothCollarOffset,
                                                    onValueChange = { v -> viewModel.updateLiveFitConfig { c -> c.copy(clothCollarOffset = v) } },
                                                    valueRange = -80f..80f
                                                )
                                                StudioSliderRow(
                                                    label = "Body Hug",
                                                    valueText = "${(config.clothFitHug * 100f).roundToInt()}%",
                                                    value = config.clothFitHug,
                                                    onValueChange = { v -> viewModel.updateLiveFitConfig { c -> c.copy(clothFitHug = v) } },
                                                    valueRange = 0f..1f
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                            HorizontalDivider(color = StudioColors.SurfaceContainerHighest, thickness = 1.dp)
                        }

                        // Bottom Tool Rail
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            StudioBottomToolItem(
                                label = "Effects",
                                icon = Icons.Default.AutoAwesome,
                                selected = isDeckExpanded && activeDeckTab == 0,
                                onClick = {
                                    if (isDeckExpanded && activeDeckTab == 0) isDeckExpanded = false
                                    else {
                                        activeDeckTab = 0
                                        isDeckExpanded = true
                                    }
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StudioBottomToolItem(
                                label = "Background",
                                icon = Icons.Default.Wallpaper,
                                selected = isDeckExpanded && activeDeckTab == 1,
                                onClick = {
                                    if (isDeckExpanded && activeDeckTab == 1) isDeckExpanded = false
                                    else {
                                        activeDeckTab = 1
                                        isDeckExpanded = true
                                    }
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StudioBottomToolItem(
                                label = "Wardrobe",
                                icon = Icons.Default.Checkroom,
                                selected = isDeckExpanded && activeDeckTab == 2,
                                onClick = {
                                    if (isDeckExpanded && activeDeckTab == 2) isDeckExpanded = false
                                    else {
                                        activeDeckTab = 2
                                        isDeckExpanded = true
                                    }
                                },
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }
            }
        }
    }
}
