package com.facemorph.studio.viewmodel

import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Shader
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.facemorph.studio.R
import com.facemorph.studio.engine.BuiltInWardrobeFactory
import com.facemorph.studio.engine.MlKitLayerSegmentationEngine
import com.facemorph.studio.engine.NativeAssetSegmenter
import com.facemorph.studio.engine.NativeClothPhysicsEngine
import com.facemorph.studio.engine.NativeFaceSwapEngine
import com.facemorph.studio.engine.NativeStorageHelper
import com.facemorph.studio.model.BodyAnchorPoint
import com.facemorph.studio.model.BodyScanResult
import com.facemorph.studio.model.ClothPhysicsConfig
import com.facemorph.studio.model.DetectedFaceData
import com.facemorph.studio.model.FabricType
import com.facemorph.studio.model.FaceAdjustments
import com.facemorph.studio.model.FaceAngleBucket
import com.facemorph.studio.model.FaceAngleVariant
import com.facemorph.studio.model.FaceProfileItem
import com.facemorph.studio.model.FittedWardrobeLayer
import com.facemorph.studio.model.LiveCameraConfig
import com.facemorph.studio.model.Point2D
import com.facemorph.studio.model.SegmentedTargetLayers
import com.facemorph.studio.model.SkinSamplePatch
import com.facemorph.studio.model.SourceFaceMetrics
import com.facemorph.studio.model.StudioTab
import com.facemorph.studio.model.TargetSampleItem
import com.facemorph.studio.model.WardrobeAssetItem
import com.facemorph.studio.model.WardrobeCategory
import com.facemorph.studio.model.WardrobeSubCategory
import com.facemorph.studio.model.classifyFaceAngleBucket
import com.facemorph.studio.model.defaultSubCategoryFor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max

class StudioViewModel(application: Application) : AndroidViewModel(application) {

    private val ctx: Context get() = getApplication<Application>().applicationContext
    private val prefs = ctx.getSharedPreferences("facemorph_native_prefs", Context.MODE_PRIVATE)

    var activeTab by mutableStateOf(StudioTab.FACE_STUDIO)
    var toastMessage by mutableStateOf<String?>(null)

    // User-added Face Profiles only (no dummy faces preloaded)
    var faceProfiles by mutableStateOf<List<FaceProfileItem>>(emptyList())
    var activeProfileId by mutableStateOf("")
    var isScanningProfileMatch by mutableStateOf(false)
    var lastScanMatchScore by mutableIntStateOf(0)

    // Optional sample scenes accessible from the More menu if desired
    val targetSamples = listOf(
        TargetSampleItem("sample-single", "Studio Portrait", R.drawable.portrait_single),
        TargetSampleItem("sample-duo", "Café Duo", R.drawable.portrait_duo),
        TargetSampleItem("sample-group", "Group Scene", R.drawable.portrait_group)
    )
    var activeTargetId by mutableStateOf("")
    var targetBitmap by mutableStateOf<Bitmap?>(null)
    var detectedFaces by mutableStateOf<List<DetectedFaceData>>(emptyList())
    var selectedFaceId by mutableStateOf<String?>(null)
    var adjustments by mutableStateOf(FaceAdjustments())
    var segmentedTargetLayers by mutableStateOf<SegmentedTargetLayers?>(null)
    var isSegmentingLayers by mutableStateOf(false)
    var isSkinSamplingMode by mutableStateOf(false)
    var splitCompareEnabled by mutableStateOf(false)
    var splitComparePercent by mutableFloatStateOf(50f)

    // Cutout / Protect Foreground Mask Brush (preserves original hair, maang tikka, veil, jewelry)
    var cutoutProtectionMask by mutableStateOf<Bitmap?>(null)
    var cutoutMaskVersion by mutableIntStateOf(0)
    var isCutoutBrushMode by mutableStateOf(false)
    var cutoutBrushProtect by mutableStateOf(true)
    var cutoutBrushSizePx by mutableFloatStateOf(34f)
    var cutoutBrushHardness by mutableFloatStateOf(65f)
    var cutoutShowOverlay by mutableStateOf(true)
    var canUndoCutoutMask by mutableStateOf(false)
    private val cutoutUndoStack = ArrayDeque<Bitmap>(8)

    // Bitmap & Metrics Caches
    val profileBitmapCache = mutableStateMapOf<String, Bitmap>()
    val profileMetricsCache = mutableStateMapOf<String, SourceFaceMetrics>()
    val angleBitmapCache = mutableStateMapOf<String, Bitmap>()
    val angleCutoutCache = mutableStateMapOf<String, Bitmap>()
    val angleMetricsCache = mutableStateMapOf<String, SourceFaceMetrics>()
    val wardrobeBitmapCache = mutableStateMapOf<String, Bitmap>()
    val backgroundBitmapCache = mutableStateMapOf<String, Bitmap>()

    // Body Fit & Physics
    var bodyScan by mutableStateOf<BodyScanResult?>(null)
    var bodySubjectFaceId by mutableStateOf<String?>(null)
    var clothConfig by mutableStateOf(ClothPhysicsConfig())
    var showBodyScanHud by mutableStateOf(false)
    var wardrobeAssets by mutableStateOf<List<WardrobeAssetItem>>(emptyList())
    var fittedLayers by mutableStateOf(
        listOf(
            FittedWardrobeLayer("asset-blazer", visible = true, scale = 1.0f),
            FittedWardrobeLayer("asset-emerald", visible = true, scale = 0.56f)
        )
    )
    var selectedWardrobeId by mutableStateOf("asset-blazer")

    // Live Camera AR Config & Dialogs
    var liveConfig by mutableStateOf(LiveCameraConfig())
    var showCustomAssetDialog by mutableStateOf(false)
    var customAssetNonce by mutableIntStateOf(0)
    var showFaceProfileManager by mutableStateOf(false)
    var pendingAngleTargetProfileId by mutableStateOf<String?>(null)

    init {
        loadBuiltInCaches()
    }

    private fun loadBuiltInCaches() {
        viewModelScope.launch(Dispatchers.IO) {
            val savedFaces = loadSavedFaceProfiles()
            val loadedFaceMaps = mutableMapOf<String, Bitmap>()
            val loadedMetricsMaps = mutableMapOf<String, SourceFaceMetrics>()
            val loadedAngleBitmaps = mutableMapOf<String, Bitmap>()
            val loadedAngleCutouts = mutableMapOf<String, Bitmap>()
            val loadedAngleMetrics = mutableMapOf<String, SourceFaceMetrics>()
            var needsRePersist = false

            val hydratedFaces = savedFaces.mapNotNull { profile ->
                val rawAngles = if (profile.angles.isNotEmpty()) {
                    profile.angles
                } else if (!profile.customFilePath.isNullOrBlank()) {
                    listOf(
                        FaceAngleVariant(
                            id = "${profile.id}-angle-0",
                            filePath = profile.customFilePath,
                            bucket = FaceAngleBucket.FRONT
                        )
                    )
                } else emptyList()

                val validAngles = mutableListOf<FaceAngleVariant>()
                for (angle in rawAngles) {
                    val bmp = NativeStorageHelper.loadBitmapFromFile(angle.filePath, 900) ?: continue
                    val metrics = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
                    val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)
                    val existingCutout = angle.cutoutFilePath?.let { NativeStorageHelper.loadBitmapFromFile(it, 280) }
                    val cutoutBmp = existingCutout ?: NativeFaceSwapEngine.createCutoutFaceAvatar(bmp, metrics, 240)
                    val cutoutPath = if (existingCutout != null && !angle.cutoutFilePath.isNullOrBlank()) {
                        angle.cutoutFilePath
                    } else {
                        needsRePersist = true
                        NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angle.id}_cutout.png")
                    }
                    val updatedAngle = angle.copy(
                        cutoutFilePath = cutoutPath,
                        bucket = bucket,
                        yawDeg = metrics.yawDeg,
                        pitchDeg = metrics.pitchDeg,
                        rollDeg = metrics.rollDeg
                    )
                    validAngles.add(updatedAngle)
                    loadedAngleBitmaps[updatedAngle.id] = bmp
                    loadedAngleCutouts[updatedAngle.id] = cutoutBmp
                    loadedAngleMetrics[updatedAngle.id] = metrics
                }

                if (validAngles.isEmpty()) {
                    profile.copy(
                        customFilePath = null,
                        angles = emptyList(),
                        selectedAngleId = null
                    )
                } else {
                    val selId = validAngles.find { it.id == profile.selectedAngleId }?.id ?: validAngles.first().id
                    val primaryBmp = loadedAngleBitmaps[selId]
                    val primaryMetrics = loadedAngleMetrics[selId]
                    if (primaryBmp != null) loadedFaceMaps[profile.id] = primaryBmp
                    if (primaryMetrics != null) loadedMetricsMaps[profile.id] = primaryMetrics
                    profile.copy(
                        customFilePath = validAngles.find { it.id == selId }?.filePath ?: validAngles.first().filePath,
                        angles = validAngles,
                        selectedAngleId = selId
                    )
                }
            }

            val builtInWardrobe = listOf(
                WardrobeAssetItem(
                    id = "asset-blazer",
                    name = "Midnight Blazer",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    subCategory = WardrobeSubCategory.SUIT,
                    fabricType = FabricType.WOOL,
                    drawableResId = R.drawable.wardrobe_blazer,
                    defaultScale = 1.0f
                ),
                WardrobeAssetItem(
                    id = "asset-suit-navy",
                    name = "Navy 2-Piece Suit",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    subCategory = WardrobeSubCategory.SUIT,
                    fabricType = FabricType.WOOL,
                    defaultScale = 1.0f
                ),
                WardrobeAssetItem(
                    id = "asset-shirt-white",
                    name = "Crisp Dress Shirt",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    subCategory = WardrobeSubCategory.SHIRT,
                    fabricType = FabricType.COTTON,
                    defaultScale = 0.98f
                ),
                WardrobeAssetItem(
                    id = "asset-shirt-navy",
                    name = "Navy Formal Shirt",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    subCategory = WardrobeSubCategory.SHIRT,
                    fabricType = FabricType.COTTON,
                    defaultScale = 0.98f
                ),
                WardrobeAssetItem(
                    id = "asset-jacket-moto",
                    name = "Slate Moto Jacket",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    subCategory = WardrobeSubCategory.JACKET,
                    fabricType = FabricType.LEATHER,
                    defaultScale = 1.02f
                ),
                WardrobeAssetItem(
                    id = "asset-kimono",
                    name = "Silk Kimono",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    subCategory = WardrobeSubCategory.ETHNIC,
                    fabricType = FabricType.SILK,
                    drawableResId = R.drawable.wardrobe_kimono,
                    defaultScale = 1.12f
                ),
                WardrobeAssetItem(
                    id = "asset-emerald",
                    name = "Emerald Pendant",
                    category = WardrobeCategory.JEWELRY,
                    anchorPoint = BodyAnchorPoint.NECK,
                    subCategory = WardrobeSubCategory.NECKLACE,
                    drawableResId = R.drawable.wardrobe_emerald_pendant,
                    defaultScale = 0.56f
                ),
                WardrobeAssetItem(
                    id = "asset-diamond",
                    name = "Gold Necklace",
                    category = WardrobeCategory.JEWELRY,
                    anchorPoint = BodyAnchorPoint.NECK,
                    subCategory = WardrobeSubCategory.NECKLACE,
                    drawableResId = R.drawable.wardrobe_gold_necklace,
                    defaultScale = 0.62f
                ),
                WardrobeAssetItem(
                    id = "asset-watch",
                    name = "Chronograph",
                    category = WardrobeCategory.JEWELRY,
                    anchorPoint = BodyAnchorPoint.WRIST,
                    subCategory = WardrobeSubCategory.WATCH,
                    drawableResId = R.drawable.wardrobe_watch,
                    defaultScale = 0.36f
                ),
                WardrobeAssetItem(
                    id = "asset-glasses-aviator",
                    name = "Studio Aviators",
                    category = WardrobeCategory.ACCESSORY,
                    anchorPoint = BodyAnchorPoint.HEAD,
                    subCategory = WardrobeSubCategory.GLASSES,
                    defaultScale = 1.0f
                )
            )
            val savedCustom = loadSavedCustomWardrobe()
            val allWardrobe = savedCustom + builtInWardrobe

            val loadedWardrobeMaps = mutableMapOf<String, Bitmap>()
            allWardrobe.forEach { item ->
                val bmp = when {
                    item.customFilePath != null -> NativeStorageHelper.loadBitmapFromFile(item.customFilePath, 900)
                    item.drawableResId != null -> NativeStorageHelper.loadBitmapFromResource(ctx, item.drawableResId, 900)
                        ?.let { NativeAssetSegmenter.extractTransparentAsset(it, tolerance = 36) }
                    else -> BuiltInWardrobeFactory.createBuiltInBitmap(item.id)
                }
                if (bmp != null) loadedWardrobeMaps[item.id] = bmp
            }

            val bgMap = mutableMapOf<String, Bitmap>()
            NativeStorageHelper.loadBitmapFromResource(ctx, R.drawable.bg_studio_loft, 960)?.let { bgMap["studio"] = it }
            NativeStorageHelper.loadBitmapFromResource(ctx, R.drawable.bg_cyberpunk_neon, 960)?.let { bgMap["neon"] = it }
            NativeStorageHelper.loadBitmapFromResource(ctx, R.drawable.bg_sunset_terrace, 960)?.let { bgMap["sunset"] = it }

            withContext(Dispatchers.Main) {
                faceProfiles = hydratedFaces
                profileBitmapCache.putAll(loadedFaceMaps)
                profileMetricsCache.putAll(loadedMetricsMaps)
                angleBitmapCache.putAll(loadedAngleBitmaps)
                angleCutoutCache.putAll(loadedAngleCutouts)
                angleMetricsCache.putAll(loadedAngleMetrics)
                if (needsRePersist && hydratedFaces.isNotEmpty()) {
                    persistFaceProfiles(hydratedFaces)
                }
                if (activeProfileId.isBlank() && hydratedFaces.isNotEmpty()) {
                    activeProfileId = hydratedFaces.first().id
                }
                wardrobeAssets = allWardrobe
                wardrobeBitmapCache.putAll(loadedWardrobeMaps)
                backgroundBitmapCache.putAll(bgMap)
            }
        }
    }

    fun loadTargetSample(sample: TargetSampleItem) {
        activeTargetId = sample.id
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = sample.drawableResId?.let { NativeStorageHelper.loadBitmapFromResource(ctx, it, 1280) }
                ?: sample.customFilePath?.let { NativeStorageHelper.loadBitmapFromFile(it, 1280) }
                ?: return@launch
            applyTargetBitmap(bmp)
        }
    }

    fun loadTargetFromUri(uri: Uri) {
        activeTargetId = "gallery-${System.currentTimeMillis()}"
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromUri(ctx, uri, 1280)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not open selected photo") }
                return@launch
            }
            applyTargetBitmap(bmp)
        }
    }

    fun loadTargetFromFile(filePath: String) {
        activeTargetId = "camera-${System.currentTimeMillis()}"
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromFile(filePath, 1280)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not read captured photo") }
                return@launch
            }
            applyTargetBitmap(bmp)
        }
    }

    fun loadTargetFromBitmap(bmp: Bitmap) {
        activeTargetId = "bitmap-${System.currentTimeMillis()}"
        viewModelScope.launch(Dispatchers.IO) {
            applyTargetBitmap(bmp)
        }
    }

    fun clearTargetPhoto() {
        activeTargetId = ""
        targetBitmap = null
        segmentedTargetLayers = null
        isSegmentingLayers = false
        detectedFaces = emptyList()
        selectedFaceId = null
        bodySubjectFaceId = null
        bodyScan = null
        isSkinSamplingMode = false
        isCutoutBrushMode = false
        clearCutoutMask()
        adjustments = adjustments.copy(manualSkinPatch = null, hiddenLayerIds = emptySet())
    }

    fun rescanTargetFaces() {
        val bmp = targetBitmap ?: return
        viewModelScope.launch(Dispatchers.IO) {
            applyTargetBitmap(bmp)
            withContext(Dispatchers.Main) {
                val count = segmentedTargetLayers?.summary?.totalLayerCount ?: 2
                showToast("Scanned faces & $count non-destructive layers")
            }
        }
    }

    fun resegmentTargetLayers() {
        val bmp = targetBitmap ?: return
        val facesSnapshot = detectedFaces
        val adjSnapshot = adjustments
        isSegmentingLayers = true
        viewModelScope.launch(Dispatchers.IO) {
            val layers = MlKitLayerSegmentationEngine.extractTargetSceneLayers(
                targetBitmap = bmp,
                faces = facesSnapshot,
                autoMaskHair = adjSnapshot.autoMaskHair,
                autoMaskAccessories = adjSnapshot.autoMaskAccessories,
                autoMaskObjects = adjSnapshot.autoMaskObjects,
                preserveTargetLayers = adjSnapshot.preserveTargetLayers
            )
            withContext(Dispatchers.Main) {
                if (targetBitmap === bmp) {
                    segmentedTargetLayers = layers
                    val validIds = layers.objectLayers.map { it.id }.toSet()
                    adjustments = adjustments.copy(
                        hiddenLayerIds = adjustments.hiddenLayerIds.intersect(validIds)
                    )
                    showToast(layers.summary.decisionNote)
                }
                isSegmentingLayers = false
            }
        }
    }

    fun toggleCutoutObjectLayer(layerId: String) {
        val cur = adjustments.hiddenLayerIds
        val next = if (layerId in cur) cur - layerId else cur + layerId
        adjustments = adjustments.copy(hiddenLayerIds = next)
    }

    private suspend fun applyTargetBitmap(bmp: Bitmap) {
        val defaultProfId = activeProfileId.takeIf { it.isNotBlank() }
        val defaultProf = defaultProfId?.let { id -> faceProfiles.find { it.id == id } }
        val angleMetricsSnapshot = angleMetricsCache.toMap()
        val rawFaces = NativeFaceSwapEngine.detectFaces(bmp, defaultProfId)
        val faces = if (defaultProf != null) {
            rawFaces.map { f ->
                val match = NativeFaceSwapEngine.findBestAngleForPose(
                    profile = defaultProf,
                    angleMetrics = angleMetricsSnapshot,
                    targetYawDeg = f.yawDeg,
                    targetPitchDeg = f.pitchDeg,
                    targetRollDeg = f.rollDeg
                )
                f.copy(
                    assignedAngleId = match.angleId ?: defaultProf.selectedAngleId,
                    angleMatchScore = match.matchScore,
                    angleMatchFlipped = match.shouldFlip
                )
            }
        } else rawFaces
        val firstFace = faces.firstOrNull()
        val scan = NativeClothPhysicsEngine.scanBody(
            bmp.width.toFloat(),
            bmp.height.toFloat(),
            firstFace?.let { (it.boxLeft + it.boxRight) * 0.5f },
            firstFace?.boxBottom,
            firstFace?.let { it.boxRight - it.boxLeft },
            firstFace?.let { it.boxBottom - it.boxTop }
        )
        val adjSnapshot = adjustments
        val layers = MlKitLayerSegmentationEngine.extractTargetSceneLayers(
            targetBitmap = bmp,
            faces = faces,
            autoMaskHair = adjSnapshot.autoMaskHair,
            autoMaskAccessories = adjSnapshot.autoMaskAccessories,
            autoMaskObjects = adjSnapshot.autoMaskObjects,
            preserveTargetLayers = adjSnapshot.preserveTargetLayers
        )
        withContext(Dispatchers.Main) {
            targetBitmap = bmp
            detectedFaces = faces
            segmentedTargetLayers = layers
            isSegmentingLayers = false
            selectedFaceId = firstFace?.id
            bodySubjectFaceId = firstFace?.id
            bodyScan = scan
            lastScanMatchScore = faces.mapNotNull { it.angleMatchScore }.maxOrNull() ?: 0
            isSkinSamplingMode = false
            isCutoutBrushMode = false
            clearCutoutMask()
            adjustments = adjustments.copy(manualSkinPatch = null, hiddenLayerIds = emptySet())
        }
    }

    fun sampleSkinPatchAt(
        normX: Float,
        normY: Float,
        radiusRatio: Float = adjustments.manualSkinPatch?.radiusRatio ?: 0.032f
    ) {
        val bmp = targetBitmap ?: return
        val nx = normX.coerceIn(0f, 1f)
        val ny = normY.coerceIn(0f, 1f)
        val rRatio = radiusRatio.coerceIn(0.014f, 0.075f)
        val (r, g, b) = NativeFaceSwapEngine.sampleSkinPatchReferenceRgb(bmp, nx, ny, rRatio)
        adjustments = adjustments.copy(
            skinToneMatch = true,
            manualSkinPatch = SkinSamplePatch(
                normX = nx,
                normY = ny,
                radiusRatio = rRatio,
                sampledRed = r,
                sampledGreen = g,
                sampledBlue = b
            )
        )
    }

    fun updateSkinSampleRadius(radiusRatio: Float) {
        val patch = adjustments.manualSkinPatch ?: return
        sampleSkinPatchAt(patch.normX, patch.normY, radiusRatio)
    }

    fun clearManualSkinPatch() {
        isSkinSamplingMode = false
        adjustments = adjustments.copy(manualSkinPatch = null)
    }

    private fun ensureCutoutMaskForTarget(): Bitmap? {
        val target = targetBitmap ?: return null
        val cur = cutoutProtectionMask
        if (cur != null && !cur.isRecycled && cur.width == target.width && cur.height == target.height) {
            return cur
        }
        val created = Bitmap.createBitmap(target.width, target.height, Bitmap.Config.ARGB_8888).apply {
            setHasAlpha(true)
        }
        cutoutProtectionMask = created
        return created
    }

    fun beginCutoutStroke() {
        val mask = ensureCutoutMaskForTarget() ?: return
        val snapshot = mask.copy(Bitmap.Config.ARGB_8888, false)
        while (cutoutUndoStack.size >= 8) {
            cutoutUndoStack.removeFirst().recycle()
        }
        cutoutUndoStack.addLast(snapshot)
        canUndoCutoutMask = cutoutUndoStack.isNotEmpty()
    }

    fun paintCutoutStrokeSegment(x0Img: Float, y0Img: Float, x1Img: Float, y1Img: Float) {
        val mask = ensureCutoutMaskForTarget() ?: return
        val canvas = Canvas(mask)
        val radius = max(4f, cutoutBrushSizePx)
        val hardnessNorm = (cutoutBrushHardness / 100f).coerceIn(0.10f, 1.0f)
        val softStart = (hardnessNorm * 0.88f).coerceIn(0.05f, 0.92f)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        if (!cutoutBrushProtect) {
            paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        }

        val dist = hypot((x1Img - x0Img).toDouble(), (y1Img - y0Img).toDouble()).toFloat()
        val step = max(2f, radius * 0.28f)
        val count = max(1, ceil(dist / step).toInt())

        for (i in 0..count) {
            val t = if (count == 0) 0f else i.toFloat() / count
            val cx = x0Img + (x1Img - x0Img) * t
            val cy = y0Img + (y1Img - y0Img) * t
            val brushColor = if (cutoutBrushProtect) Color.argb(235, 244, 63, 94) else Color.WHITE
            val grad = RadialGradient(
                cx,
                cy,
                radius,
                intArrayOf(brushColor, brushColor, Color.TRANSPARENT),
                floatArrayOf(0f, softStart, 1f),
                Shader.TileMode.CLAMP
            )
            paint.shader = grad
            canvas.drawCircle(cx, cy, radius, paint)
        }
        cutoutMaskVersion++
    }

    fun undoCutoutStroke() {
        val prev = if (cutoutUndoStack.isNotEmpty()) cutoutUndoStack.removeLast() else null
        canUndoCutoutMask = cutoutUndoStack.isNotEmpty()
        if (prev != null) {
            cutoutProtectionMask = prev.copy(Bitmap.Config.ARGB_8888, true)
            prev.recycle()
            cutoutMaskVersion++
        }
    }

    fun clearCutoutMask() {
        while (cutoutUndoStack.isNotEmpty()) {
            cutoutUndoStack.removeFirst().recycle()
        }
        canUndoCutoutMask = false
        cutoutProtectionMask = null
        cutoutMaskVersion++
    }

    fun selectBodySubjectFace(faceId: String) {
        val bmp = targetBitmap ?: return
        val face = detectedFaces.find { it.id == faceId } ?: return
        bodySubjectFaceId = faceId
        bodyScan = NativeClothPhysicsEngine.scanBody(
            bmp.width.toFloat(),
            bmp.height.toFloat(),
            (face.boxLeft + face.boxRight) * 0.5f,
            face.boxBottom,
            face.boxRight - face.boxLeft,
            face.boxBottom - face.boxTop
        )
    }

    fun getCutoutThumbForProfile(profileId: String): Bitmap? {
        val profile = faceProfiles.find { it.id == profileId }
        val angleId = profile?.selectedAngleId ?: profile?.angles?.firstOrNull()?.id
        return angleId?.let { angleCutoutCache[it] ?: angleBitmapCache[it] } ?: profileBitmapCache[profileId]
    }

    fun getActiveProfileAnglesForLive(): List<Triple<FaceAngleVariant, Bitmap, SourceFaceMetrics>> {
        val profile = faceProfiles.find { it.id == activeProfileId } ?: faceProfiles.firstOrNull() ?: return emptyList()
        return profile.angles.mapNotNull { angle ->
            val bmp = angleBitmapCache[angle.id] ?: return@mapNotNull null
            val metrics = angleMetricsCache[angle.id] ?: return@mapNotNull null
            Triple(angle, bmp, metrics)
        }
    }

    fun addCustomFaceFromUri(uri: Uri, name: String? = null, sourceLabel: String = "Gallery") {
        val targetId = pendingAngleTargetProfileId
        pendingAngleTargetProfileId = null
        if (!targetId.isNullOrBlank() && faceProfiles.any { it.id == targetId }) {
            addAngleToProfileFromUri(targetId, uri)
        } else {
            createFaceProfileFromUri(uri, name)
        }
    }

    fun addCustomFaceFromFile(filePath: String, name: String? = null, sourceLabel: String = "Camera") {
        val targetId = pendingAngleTargetProfileId
        pendingAngleTargetProfileId = null
        if (!targetId.isNullOrBlank() && faceProfiles.any { it.id == targetId }) {
            addAngleToProfileFromFile(targetId, filePath)
        } else {
            createFaceProfileFromFile(filePath, name)
        }
    }

    fun addCustomFaceFromBitmap(bmp: Bitmap, name: String? = null, sourceLabel: String = "Camera") {
        val targetId = pendingAngleTargetProfileId
        pendingAngleTargetProfileId = null
        if (!targetId.isNullOrBlank() && faceProfiles.any { it.id == targetId }) {
            addAngleToProfileFromBitmap(targetId, bmp)
        } else {
            createFaceProfileFromBitmap(bmp, name)
        }
    }

    fun createFaceProfileFromUri(uri: Uri, name: String? = null) {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromUri(ctx, uri, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not open face photo") }
                return@launch
            }
            saveNewFaceProfileBitmap(bmp, name)
        }
    }

    fun createFaceProfileFromFile(filePath: String, name: String? = null) {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromFile(filePath, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not read captured face") }
                return@launch
            }
            saveNewFaceProfileBitmap(bmp, name)
        }
    }

    fun createFaceProfileFromBitmap(bmp: Bitmap, name: String? = null) {
        viewModelScope.launch(Dispatchers.IO) {
            saveNewFaceProfileBitmap(bmp, name)
        }
    }

    fun addAngleToProfileFromUri(profileId: String, uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromUri(ctx, uri, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not open face angle photo") }
                return@launch
            }
            saveAngleIntoProfileBitmap(profileId, bmp)
        }
    }

    fun addAngleToProfileFromFile(profileId: String, filePath: String) {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromFile(filePath, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not read captured face angle") }
                return@launch
            }
            saveAngleIntoProfileBitmap(profileId, bmp)
        }
    }

    fun addAngleToProfileFromBitmap(profileId: String, bmp: Bitmap) {
        viewModelScope.launch(Dispatchers.IO) {
            saveAngleIntoProfileBitmap(profileId, bmp)
        }
    }

    private suspend fun saveNewFaceProfileBitmap(bmp: Bitmap, name: String?) {
        val metrics = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
        val cutoutBmp = NativeFaceSwapEngine.createCutoutFaceAvatar(bmp, metrics, 240)
        val ts = System.currentTimeMillis()
        val profileId = "profile-$ts"
        val angleId = "angle-$ts"
        val fullPath = NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$angleId.png")
            ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$profileId.png")
            ?: ""
        val cutoutPath = NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angleId}_cutout.png")
        val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)
        val angleVariant = FaceAngleVariant(
            id = angleId,
            filePath = fullPath,
            cutoutFilePath = cutoutPath,
            bucket = bucket,
            yawDeg = metrics.yawDeg,
            pitchDeg = metrics.pitchDeg,
            rollDeg = metrics.rollDeg,
            createdAt = ts
        )
        withContext(Dispatchers.Main) {
            val finalName = name?.trim()?.takeIf { it.isNotBlank() } ?: "Profile ${faceProfiles.size + 1}"
            val item = FaceProfileItem(
                id = profileId,
                name = finalName,
                customFilePath = fullPath,
                angles = listOf(angleVariant),
                selectedAngleId = angleId
            )
            val updatedList = listOf(item) + faceProfiles
            faceProfiles = updatedList
            angleBitmapCache[angleId] = bmp
            angleCutoutCache[angleId] = cutoutBmp
            angleMetricsCache[angleId] = metrics
            profileBitmapCache[profileId] = bmp
            profileMetricsCache[profileId] = metrics
            persistFaceProfiles(updatedList)
            activeProfileId = profileId
            assignProfileToSelectedOrAll(profileId)
            showToast("Saved '$finalName' (${bucket.shortTag})")
        }
    }

    private suspend fun saveAngleIntoProfileBitmap(profileId: String, bmp: Bitmap) {
        val targetProfile = faceProfiles.find { it.id == profileId } ?: run {
            saveNewFaceProfileBitmap(bmp, null)
            return
        }
        val metrics = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
        val existingPairs = targetProfile.angles.map { it to angleMetricsCache[it.id] }
        if (NativeFaceSwapEngine.checkDuplicateAngle(existingPairs, metrics)) {
            withContext(Dispatchers.Main) {
                showToast("Same face angle already saved in '${targetProfile.name}'")
            }
            return
        }

        val cutoutBmp = NativeFaceSwapEngine.createCutoutFaceAvatar(bmp, metrics, 240)
        val ts = System.currentTimeMillis()
        val angleId = "angle-$ts"
        val fullPath = NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$angleId.png") ?: return
        val cutoutPath = NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angleId}_cutout.png")
        val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)
        val newAngle = FaceAngleVariant(
            id = angleId,
            filePath = fullPath,
            cutoutFilePath = cutoutPath,
            bucket = bucket,
            yawDeg = metrics.yawDeg,
            pitchDeg = metrics.pitchDeg,
            rollDeg = metrics.rollDeg,
            createdAt = ts
        )

        withContext(Dispatchers.Main) {
            angleBitmapCache[angleId] = bmp
            angleCutoutCache[angleId] = cutoutBmp
            angleMetricsCache[angleId] = metrics
            val updatedList = faceProfiles.map { p ->
                if (p.id == profileId) {
                    p.copy(
                        customFilePath = fullPath,
                        angles = p.angles + newAngle,
                        selectedAngleId = angleId
                    )
                } else p
            }
            faceProfiles = updatedList
            profileBitmapCache[profileId] = bmp
            profileMetricsCache[profileId] = metrics
            persistFaceProfiles(updatedList)
            activeProfileId = profileId
            assignProfileToSelectedOrAll(profileId)
            val totalCount = updatedList.find { it.id == profileId }?.angles?.size ?: 1
            showToast("Added ${bucket.shortTag} angle to '${targetProfile.name}' ($totalCount angles)")
        }
    }

    fun selectProfileAngle(profileId: String, angleId: String) {
        val profile = faceProfiles.find { it.id == profileId } ?: return
        val angle = profile.angles.find { it.id == angleId } ?: return
        val updatedList = faceProfiles.map { p ->
            if (p.id == profileId) p.copy(selectedAngleId = angleId, customFilePath = angle.filePath) else p
        }
        faceProfiles = updatedList
        angleBitmapCache[angleId]?.let { profileBitmapCache[profileId] = it }
        angleMetricsCache[angleId]?.let { profileMetricsCache[profileId] = it }
        persistFaceProfiles(updatedList)
        activeProfileId = profileId

        detectedFaces = detectedFaces.map { face ->
            val matchesTarget = (selectedFaceId == null || face.id == selectedFaceId) || face.assignedProfileId == profileId
            if (matchesTarget && (face.assignedProfileId == profileId || selectedFaceId == face.id || selectedFaceId == null)) {
                face.copy(
                    assignedProfileId = profileId,
                    assignedAngleId = angleId,
                    angleMatchScore = 100,
                    angleMatchFlipped = false,
                    enabled = true
                )
            } else face
        }
    }

    fun createEmptyProfile(name: String): String {
        val clean = name.trim().takeIf { it.isNotBlank() } ?: "Profile ${faceProfiles.size + 1}"
        val ts = System.currentTimeMillis()
        val profileId = "profile-$ts"
        val item = FaceProfileItem(
            id = profileId,
            name = clean,
            customFilePath = null,
            angles = emptyList(),
            selectedAngleId = null
        )
        val updated = listOf(item) + faceProfiles
        faceProfiles = updated
        activeProfileId = profileId
        persistFaceProfiles(updated)
        showToast("Created profile '$clean' — now add face photos")
        return profileId
    }

    fun replaceFaceAngleFromUri(profileId: String, angleId: String, uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromUri(ctx, uri, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not open replacement face") }
                return@launch
            }
            applyFaceEditTransformInternal(
                profileId = profileId,
                angleId = angleId,
                flipHorizontal = false,
                rotateDeg = 0f,
                brightness = 0f,
                contrast = 0f,
                warmth = 0f,
                sourceOverride = bmp
            )
        }
    }

    fun replaceFaceAngleFromFile(profileId: String, angleId: String, filePath: String) {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromFile(filePath, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not read captured replacement face") }
                return@launch
            }
            applyFaceEditTransformInternal(
                profileId = profileId,
                angleId = angleId,
                flipHorizontal = false,
                rotateDeg = 0f,
                brightness = 0f,
                contrast = 0f,
                warmth = 0f,
                sourceOverride = bmp
            )
        }
    }

    fun applyFaceEditTransform(
        profileId: String,
        angleId: String,
        flipHorizontal: Boolean,
        rotateDeg: Float,
        brightness: Float,
        contrast: Float,
        warmth: Float,
        sourceOverride: Bitmap? = null
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            applyFaceEditTransformInternal(
                profileId = profileId,
                angleId = angleId,
                flipHorizontal = flipHorizontal,
                rotateDeg = rotateDeg,
                brightness = brightness,
                contrast = contrast,
                warmth = warmth,
                sourceOverride = sourceOverride
            )
        }
    }

    private suspend fun applyFaceEditTransformInternal(
        profileId: String,
        angleId: String,
        flipHorizontal: Boolean,
        rotateDeg: Float,
        brightness: Float,
        contrast: Float,
        warmth: Float,
        sourceOverride: Bitmap? = null
    ) {
        val profile = faceProfiles.find { it.id == profileId } ?: return
        val oldAngle = profile.angles.find { it.id == angleId } ?: return
        val baseBmp = sourceOverride
            ?: angleBitmapCache[angleId]
            ?: NativeStorageHelper.loadBitmapFromFile(oldAngle.filePath, 900)
            ?: return

        val editedBmp = NativeFaceSwapEngine.transformFaceBitmapForEdit(
            src = baseBmp,
            flipHorizontal = flipHorizontal,
            rotateDeg = rotateDeg,
            brightness = brightness,
            contrast = contrast,
            warmth = warmth
        )
        val metrics = NativeFaceSwapEngine.detectSourceFaceMetrics(editedBmp)
        val cutoutBmp = NativeFaceSwapEngine.createCutoutFaceAvatar(editedBmp, metrics, 240)
        val ts = System.currentTimeMillis()
        val fullPath = NativeStorageHelper.saveBitmapToInternalFile(ctx, editedBmp, "${angleId}_v${ts}.png") ?: return
        val cutoutPath = NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angleId}_v${ts}_cutout.png")
        val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)

        val updatedAngle = oldAngle.copy(
            filePath = fullPath,
            cutoutFilePath = cutoutPath,
            bucket = bucket,
            yawDeg = metrics.yawDeg,
            pitchDeg = metrics.pitchDeg,
            rollDeg = metrics.rollDeg
        )

        NativeStorageHelper.deleteInternalFile(oldAngle.filePath)
        NativeStorageHelper.deleteInternalFile(oldAngle.cutoutFilePath)

        withContext(Dispatchers.Main) {
            angleBitmapCache[angleId] = editedBmp
            angleCutoutCache[angleId] = cutoutBmp
            angleMetricsCache[angleId] = metrics

            val updatedList = faceProfiles.map { p ->
                if (p.id == profileId) {
                    val nextAngles = p.angles.map { a -> if (a.id == angleId) updatedAngle else a }
                    val nextSelId = p.selectedAngleId ?: angleId
                    p.copy(
                        customFilePath = if (nextSelId == angleId) fullPath else p.customFilePath,
                        angles = nextAngles,
                        selectedAngleId = nextSelId
                    )
                } else p
            }
            faceProfiles = updatedList
            val activeAngleId = updatedList.find { it.id == profileId }?.selectedAngleId ?: angleId
            if (activeAngleId == angleId) {
                profileBitmapCache[profileId] = editedBmp
                profileMetricsCache[profileId] = metrics
            }
            persistFaceProfiles(updatedList)
            showToast("Updated face in '${profile.name}' (${bucket.shortTag})")
            scanAndSelectProfileForSwap(profileId, silentToast = true)
        }
    }

    fun renameFaceProfile(profileId: String, newName: String) {
        val clean = newName.trim()
        if (clean.isBlank()) return
        val updated = faceProfiles.map { p ->
            if (p.id == profileId) p.copy(name = clean) else p
        }
        faceProfiles = updated
        persistFaceProfiles(updated)
        showToast("Renamed profile to '$clean'")
    }

    fun removeAngleFromProfile(profileId: String, angleId: String) {
        val profile = faceProfiles.find { it.id == profileId } ?: return
        val removedAngle = profile.angles.find { it.id == angleId }
        val remainingAngles = profile.angles.filterNot { it.id == angleId }

        angleBitmapCache.remove(angleId)
        angleCutoutCache.remove(angleId)
        angleMetricsCache.remove(angleId)
        NativeStorageHelper.deleteInternalFile(removedAngle?.filePath)
        NativeStorageHelper.deleteInternalFile(removedAngle?.cutoutFilePath)

        if (remainingAngles.isEmpty()) {
            profileBitmapCache.remove(profileId)
            profileMetricsCache.remove(profileId)
            val updated = faceProfiles.map { p ->
                if (p.id == profileId) {
                    p.copy(
                        customFilePath = null,
                        angles = emptyList(),
                        selectedAngleId = null
                    )
                } else p
            }
            faceProfiles = updated
            persistFaceProfiles(updated)
            detectedFaces = detectedFaces.map { face ->
                if (face.assignedProfileId == profileId && face.assignedAngleId == angleId) {
                    face.copy(
                        assignedAngleId = null,
                        angleMatchScore = null,
                        angleMatchFlipped = false
                    )
                } else face
            }
            lastScanMatchScore = detectedFaces.mapNotNull { it.angleMatchScore }.maxOrNull() ?: 0
            showToast("Removed face from '${profile.name}'")
            return
        }

        val nextSelected = if (profile.selectedAngleId == angleId) remainingAngles.first().id else profile.selectedAngleId
        val nextPrimary = remainingAngles.find { it.id == nextSelected } ?: remainingAngles.first()

        angleBitmapCache[nextPrimary.id]?.let { profileBitmapCache[profileId] = it }
        angleMetricsCache[nextPrimary.id]?.let { profileMetricsCache[profileId] = it }

        val updated = faceProfiles.map { p ->
            if (p.id == profileId) {
                p.copy(
                    customFilePath = nextPrimary.filePath,
                    angles = remainingAngles,
                    selectedAngleId = nextPrimary.id
                )
            } else p
        }
        faceProfiles = updated
        persistFaceProfiles(updated)

        val updatedProf = updated.find { it.id == profileId }
        if (updatedProf != null) {
            detectedFaces = detectedFaces.map { face ->
                if (face.assignedProfileId == profileId && face.assignedAngleId == angleId) {
                    val match = NativeFaceSwapEngine.findBestAngleForPose(
                        profile = updatedProf,
                        angleMetrics = angleMetricsCache,
                        targetYawDeg = face.yawDeg,
                        targetPitchDeg = face.pitchDeg,
                        targetRollDeg = face.rollDeg
                    )
                    face.copy(
                        assignedAngleId = match.angleId ?: nextPrimary.id,
                        angleMatchScore = match.matchScore,
                        angleMatchFlipped = match.shouldFlip
                    )
                } else face
            }
            lastScanMatchScore = detectedFaces.mapNotNull { it.angleMatchScore }.maxOrNull() ?: 0
        }
        showToast("Deleted face from '${profile.name}'")
    }

    fun removeFaceProfile(profileId: String) {
        val removed = faceProfiles.find { it.id == profileId }
        val updated = faceProfiles.filterNot { it.id == profileId }
        faceProfiles = updated
        persistFaceProfiles(updated)
        profileBitmapCache.remove(profileId)
        profileMetricsCache.remove(profileId)
        NativeStorageHelper.deleteInternalFile(removed?.customFilePath)
        removed?.angles?.forEach { angle ->
            angleBitmapCache.remove(angle.id)
            angleCutoutCache.remove(angle.id)
            angleMetricsCache.remove(angle.id)
            NativeStorageHelper.deleteInternalFile(angle.filePath)
            NativeStorageHelper.deleteInternalFile(angle.cutoutFilePath)
        }

        val fallback = updated.firstOrNull()
        val fallbackId = fallback?.id ?: ""
        if (activeProfileId == profileId) {
            activeProfileId = fallbackId
        }
        detectedFaces = detectedFaces.map { face ->
            if (face.assignedProfileId == profileId) {
                if (fallback != null && fallback.angles.isNotEmpty()) {
                    val match = NativeFaceSwapEngine.findBestAngleForPose(
                        profile = fallback,
                        angleMetrics = angleMetricsCache,
                        targetYawDeg = face.yawDeg,
                        targetPitchDeg = face.pitchDeg,
                        targetRollDeg = face.rollDeg
                    )
                    face.copy(
                        assignedProfileId = fallback.id,
                        assignedAngleId = match.angleId ?: fallback.selectedAngleId,
                        angleMatchScore = match.matchScore,
                        angleMatchFlipped = match.shouldFlip
                    )
                } else {
                    face.copy(
                        assignedProfileId = fallback?.id,
                        assignedAngleId = null,
                        angleMatchScore = null,
                        angleMatchFlipped = false
                    )
                }
            } else face
        }
        lastScanMatchScore = detectedFaces.mapNotNull { it.angleMatchScore }.maxOrNull() ?: 0
    }

    fun scanAndSelectProfileForSwap(profileId: String, silentToast: Boolean = false) {
        activeProfileId = profileId
        val profile = faceProfiles.find { it.id == profileId }
        if (profile == null) {
            detectedFaces = detectedFaces.map { face ->
                if (selectedFaceId == null || face.id == selectedFaceId) {
                    face.copy(
                        assignedProfileId = null,
                        assignedAngleId = null,
                        angleMatchScore = null,
                        angleMatchFlipped = false
                    )
                } else face
            }
            lastScanMatchScore = 0
            return
        }

        if (profile.angles.isEmpty()) {
            detectedFaces = detectedFaces.map { face ->
                if (selectedFaceId == null || face.id == selectedFaceId) {
                    face.copy(
                        assignedProfileId = profile.id,
                        assignedAngleId = null,
                        angleMatchScore = null,
                        angleMatchFlipped = false
                    )
                } else face
            }
            lastScanMatchScore = 0
            if (!silentToast) {
                showToast("Profile '${profile.name}' has no face yet — add one in Profiles")
            }
            return
        }

        viewModelScope.launch(Dispatchers.IO) {
            withContext(Dispatchers.Main) { isScanningProfileMatch = true }

            val hydratedMetrics = mutableMapOf<String, SourceFaceMetrics>()
            val hydratedBitmaps = mutableMapOf<String, Bitmap>()
            for (angle in profile.angles) {
                val bmp = angleBitmapCache[angle.id] ?: NativeStorageHelper.loadBitmapFromFile(angle.filePath, 900)
                if (bmp != null) {
                    hydratedBitmaps[angle.id] = bmp
                    val metrics = angleMetricsCache[angle.id] ?: NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
                    hydratedMetrics[angle.id] = metrics
                }
            }

            val mergedMetrics = angleMetricsCache.toMap() + hydratedMetrics
            val currentTarget = targetBitmap
            val currentFaces = if (currentTarget != null && detectedFaces.isEmpty()) {
                NativeFaceSwapEngine.detectFaces(currentTarget, profile.id)
            } else {
                detectedFaces
            }

            var bestMatchScore = 0
            val matchedFaces = currentFaces.map { face ->
                if (selectedFaceId == null || face.id == selectedFaceId) {
                    val match = NativeFaceSwapEngine.findBestAngleForPose(
                        profile = profile,
                        angleMetrics = mergedMetrics,
                        targetYawDeg = face.yawDeg,
                        targetPitchDeg = face.pitchDeg,
                        targetRollDeg = face.rollDeg
                    )
                    if (match.matchScore > bestMatchScore) bestMatchScore = match.matchScore
                    face.copy(
                        assignedProfileId = profile.id,
                        assignedAngleId = match.angleId ?: profile.selectedAngleId,
                        angleMatchScore = match.matchScore,
                        angleMatchFlipped = match.shouldFlip,
                        enabled = true
                    )
                } else {
                    face
                }
            }

            withContext(Dispatchers.Main) {
                hydratedBitmaps.forEach { (k, v) -> angleBitmapCache[k] = v }
                hydratedMetrics.forEach { (k, v) -> angleMetricsCache[k] = v }
                val primaryId = matchedFaces.firstOrNull { it.assignedProfileId == profile.id }?.assignedAngleId
                    ?: profile.selectedAngleId
                    ?: profile.angles.first().id
                angleBitmapCache[primaryId]?.let { profileBitmapCache[profile.id] = it }
                angleMetricsCache[primaryId]?.let { profileMetricsCache[profile.id] = it }

                detectedFaces = matchedFaces
                if (selectedFaceId == null && matchedFaces.isNotEmpty()) {
                    selectedFaceId = matchedFaces.first().id
                }
                lastScanMatchScore = if (bestMatchScore > 0) bestMatchScore else 98
                isScanningProfileMatch = false

                if (!silentToast) {
                    if (currentTarget == null) {
                        showToast("Profile '${profile.name}' ready · Load photo to swap")
                    } else {
                        showToast("Scanned '${profile.name}' · Matched ${lastScanMatchScore}% face")
                    }
                }
            }
        }
    }

    fun assignProfileToSelectedOrAll(profileId: String) {
        scanAndSelectProfileForSwap(profileId, silentToast = false)
    }

    fun autoMatchAllTargetFaces() {
        val fallbackProf = faceProfiles.find { it.id == activeProfileId } ?: faceProfiles.firstOrNull()
        if (fallbackProf == null) return
        detectedFaces = detectedFaces.map { face ->
            val prof = faceProfiles.find { it.id == face.assignedProfileId } ?: fallbackProf
            val match = NativeFaceSwapEngine.findBestAngleForPose(
                profile = prof,
                angleMetrics = angleMetricsCache,
                targetYawDeg = face.yawDeg,
                targetPitchDeg = face.pitchDeg,
                targetRollDeg = face.rollDeg
            )
            face.copy(
                assignedProfileId = prof.id,
                assignedAngleId = match.angleId ?: prof.selectedAngleId,
                angleMatchScore = match.matchScore,
                angleMatchFlipped = match.shouldFlip
            )
        }
        lastScanMatchScore = detectedFaces.mapNotNull { it.angleMatchScore }.maxOrNull() ?: 98
        showToast("Matched best face angles (${lastScanMatchScore}%) to target poses")
    }

    fun toggleFaceEnabled(faceId: String) {
        detectedFaces = detectedFaces.map { f ->
            if (f.id == faceId) f.copy(enabled = !f.enabled) else f
        }
    }

    fun nudgeFaceLandmark(faceId: String, key: String, dx: Float, dy: Float) {
        detectedFaces = detectedFaces.map { f ->
            if (f.id != faceId) return@map f
            val lm = f.landmarks
            val updated = when (key) {
                "forehead" -> lm.copy(forehead = Point2D(lm.forehead.x + dx, lm.forehead.y + dy))
                "leftEye" -> lm.copy(leftEye = Point2D(lm.leftEye.x + dx, lm.leftEye.y + dy))
                "rightEye" -> lm.copy(rightEye = Point2D(lm.rightEye.x + dx, lm.rightEye.y + dy))
                "nose" -> lm.copy(nose = Point2D(lm.nose.x + dx, lm.nose.y + dy))
                "lips" -> lm.copy(lips = Point2D(lm.lips.x + dx, lm.lips.y + dy))
                "chin" -> lm.copy(chin = Point2D(lm.chin.x + dx, lm.chin.y + dy))
                else -> lm
            }
            f.copy(landmarks = updated, isLandmarksEdited = true)
        }
    }

    fun resetFaceLandmarks(faceId: String) {
        detectedFaces = detectedFaces.map { f ->
            if (f.id == faceId) f.copy(landmarks = f.originalLandmarks, isLandmarksEdited = false) else f
        }
    }

    fun toggleAttachWardrobeAsset(assetId: String) {
        val asset = wardrobeAssets.find { it.id == assetId } ?: return
        val existing = fittedLayers.find { it.assetId == assetId }
        fittedLayers = if (existing != null) {
            fittedLayers.map { if (it.assetId == assetId) it.copy(visible = !it.visible) else it }
        } else {
            fittedLayers + FittedWardrobeLayer(assetId = assetId, visible = true, scale = asset.defaultScale)
        }
        selectedWardrobeId = assetId
    }

    fun updateActiveLayerScale(delta: Float? = null, exactScale: Float? = null) {
        fittedLayers = fittedLayers.map { l ->
            if (l.assetId == selectedWardrobeId) {
                val next = exactScale ?: (l.scale + (delta ?: 0f))
                l.copy(scale = next.coerceIn(0.25f, 2.2f))
            } else l
        }
    }

    fun addCustomWardrobeAsset(
        name: String,
        transparentBitmap: Bitmap,
        category: WardrobeCategory,
        anchorPoint: BodyAnchorPoint,
        fabricType: FabricType,
        defaultScale: Float,
        subCategory: WardrobeSubCategory = defaultSubCategoryFor(category, anchorPoint)
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            val id = "custom-${System.currentTimeMillis()}"
            val path = NativeStorageHelper.saveBitmapToInternalFile(ctx, transparentBitmap, "$id.png")
            val item = WardrobeAssetItem(
                id = id,
                name = name.ifBlank { "Custom Costume" },
                category = category,
                anchorPoint = anchorPoint,
                subCategory = subCategory,
                fabricType = fabricType,
                customFilePath = path,
                defaultScale = defaultScale,
                isCustom = true
            )
            withContext(Dispatchers.Main) {
                wardrobeBitmapCache[id] = transparentBitmap
                wardrobeAssets = listOf(item) + wardrobeAssets
                persistCustomWardrobe(wardrobeAssets)
                selectedWardrobeId = id
                fittedLayers = fittedLayers + FittedWardrobeLayer(assetId = id, visible = true, scale = defaultScale)

                liveConfig = if (category == WardrobeCategory.CLOTHING) {
                    liveConfig.copy(selectedClothingId = id, wearClothes = true)
                } else {
                    liveConfig.copy(selectedJewelryId = id, wearJewelry = true)
                }
                customAssetNonce++
                showToast("Saved '${item.name}' to Wardrobe & Live AR")
            }
        }
    }

    fun removeCustomAsset(assetId: String) {
        wardrobeAssets = wardrobeAssets.filterNot { it.id == assetId }
        fittedLayers = fittedLayers.filterNot { it.assetId == assetId }
        persistCustomWardrobe(wardrobeAssets)
    }

    fun loadCustomBackgroundFromUri(uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromUri(ctx, uri, 960) ?: return@launch
            withContext(Dispatchers.Main) {
                backgroundBitmapCache["custom"] = bmp
                liveConfig = liveConfig.copy(activeBgId = "custom", removeBackground = true)
                showToast("Custom background active")
            }
        }
    }

    fun exportBitmapToGallery(bitmap: Bitmap, label: String = "Image") {
        viewModelScope.launch(Dispatchers.IO) {
            val ok = NativeStorageHelper.saveBitmapToGallery(ctx, bitmap)
            withContext(Dispatchers.Main) {
                showToast(if (ok) "Saved $label to Gallery" else "Could not save image")
            }
        }
    }

    fun showToast(msg: String) {
        toastMessage = msg
    }

    private fun persistFaceProfiles(list: List<FaceProfileItem>) {
        val arr = JSONArray()
        list.forEach { item ->
            val anglesArr = JSONArray()
            item.angles.forEach { angle ->
                anglesArr.put(
                    JSONObject().apply {
                        put("id", angle.id)
                        put("filePath", angle.filePath)
                        put("cutoutFilePath", angle.cutoutFilePath ?: "")
                        put("bucket", angle.bucket.name)
                        put("yawDeg", angle.yawDeg.toDouble())
                        put("pitchDeg", angle.pitchDeg.toDouble())
                        put("rollDeg", angle.rollDeg.toDouble())
                        put("createdAt", angle.createdAt)
                    }
                )
            }
            val obj = JSONObject().apply {
                put("id", item.id)
                put("name", item.name)
                put("customFilePath", item.customFilePath ?: "")
                put("selectedAngleId", item.selectedAngleId ?: "")
                put("angles", anglesArr)
            }
            arr.put(obj)
        }
        prefs.edit().putString("custom_face_profiles_v2", arr.toString()).apply()
    }

    private fun loadSavedFaceProfiles(): List<FaceProfileItem> {
        val rawV2 = prefs.getString("custom_face_profiles_v2", null)
        if (!rawV2.isNullOrBlank()) {
            return try {
                val arr = JSONArray(rawV2)
                (0 until arr.length()).mapNotNull { idx ->
                    val o = arr.getJSONObject(idx)
                    val id = o.getString("id")
                    val name = o.optString("name", "Profile ${idx + 1}")
                    val fallbackPath = o.optString("customFilePath", "")
                    val selectedAngleId = o.optString("selectedAngleId", "").takeIf { it.isNotBlank() }
                    val anglesJson = o.optJSONArray("angles")
                    val parsedAngles = if (anglesJson != null) {
                        (0 until anglesJson.length()).mapNotNull { aIdx ->
                            val ao = anglesJson.optJSONObject(aIdx) ?: return@mapNotNull null
                            val fPath = ao.optString("filePath", "")
                            if (fPath.isBlank()) null
                            else {
                                val bucketName = ao.optString("bucket", FaceAngleBucket.FRONT.name)
                                val bucket = runCatching { FaceAngleBucket.valueOf(bucketName) }
                                    .getOrDefault(FaceAngleBucket.FRONT)
                                FaceAngleVariant(
                                    id = ao.getString("id"),
                                    filePath = fPath,
                                    cutoutFilePath = ao.optString("cutoutFilePath", "").takeIf { it.isNotBlank() },
                                    bucket = bucket,
                                    yawDeg = ao.optDouble("yawDeg", 0.0).toFloat(),
                                    pitchDeg = ao.optDouble("pitchDeg", 0.0).toFloat(),
                                    rollDeg = ao.optDouble("rollDeg", 0.0).toFloat(),
                                    createdAt = ao.optLong("createdAt", System.currentTimeMillis())
                                )
                            }
                        }
                    } else emptyList()

                    val finalAngles = if (parsedAngles.isNotEmpty()) parsedAngles
                    else if (fallbackPath.isNotBlank()) listOf(
                        FaceAngleVariant(
                            id = "$id-angle-0",
                            filePath = fallbackPath,
                            bucket = FaceAngleBucket.FRONT
                        )
                    ) else emptyList()

                    FaceProfileItem(
                        id = id,
                        name = name,
                        customFilePath = fallbackPath.takeIf { it.isNotBlank() } ?: finalAngles.firstOrNull()?.filePath,
                        angles = finalAngles,
                        selectedAngleId = selectedAngleId ?: finalAngles.firstOrNull()?.id
                    )
                }
            } catch (_: Exception) {
                emptyList()
            }
        }

        // Migrate v1 profiles if present
        val rawV1 = prefs.getString("custom_face_profiles_v1", null) ?: return emptyList()
        return try {
            val arr = JSONArray(rawV1)
            (0 until arr.length()).mapNotNull { idx ->
                val o = arr.getJSONObject(idx)
                val path = o.optString("customFilePath", "")
                if (path.isBlank()) null
                else {
                    val id = o.getString("id")
                    val rawName = o.optString("name", "Profile ${idx + 1}")
                    val migratedName = if (rawName.startsWith("Face ")) rawName.replaceFirst("Face ", "Profile ") else rawName
                    val angleId = "$id-angle-0"
                    FaceProfileItem(
                        id = id,
                        name = migratedName,
                        customFilePath = path,
                        angles = listOf(
                            FaceAngleVariant(
                                id = angleId,
                                filePath = path,
                                bucket = FaceAngleBucket.FRONT
                            )
                        ),
                        selectedAngleId = angleId
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun persistCustomWardrobe(list: List<WardrobeAssetItem>) {
        val arr = JSONArray()
        list.filter { it.isCustom }.forEach { item ->
            val obj = JSONObject().apply {
                put("id", item.id)
                put("name", item.name)
                put("category", item.category.name)
                put("anchorPoint", item.anchorPoint.name)
                put("subCategory", item.subCategory.name)
                put("fabricType", item.fabricType.name)
                put("customFilePath", item.customFilePath ?: "")
                put("defaultScale", item.defaultScale.toDouble())
            }
            arr.put(obj)
        }
        prefs.edit().putString("custom_wardrobe_v1", arr.toString()).apply()
    }

    private fun loadSavedCustomWardrobe(): List<WardrobeAssetItem> {
        val raw = prefs.getString("custom_wardrobe_v1", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { idx ->
                val o = arr.getJSONObject(idx)
                val path = o.optString("customFilePath", "")
                if (path.isBlank()) null
                else {
                    val cat = WardrobeCategory.valueOf(o.getString("category"))
                    val anchor = BodyAnchorPoint.valueOf(o.getString("anchorPoint"))
                    val sub = o.optString("subCategory", "").takeIf { it.isNotBlank() }?.let {
                        runCatching { WardrobeSubCategory.valueOf(it) }.getOrNull()
                    } ?: defaultSubCategoryFor(cat, anchor)
                    WardrobeAssetItem(
                        id = o.getString("id"),
                        name = o.getString("name"),
                        category = cat,
                        anchorPoint = anchor,
                        subCategory = sub,
                        fabricType = FabricType.valueOf(o.getString("fabricType")),
                        customFilePath = path,
                        defaultScale = o.optDouble("defaultScale", 1.0).toFloat(),
                        isCustom = true
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
