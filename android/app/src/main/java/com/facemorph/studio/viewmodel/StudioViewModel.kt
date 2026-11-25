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
import com.facemorph.studio.model.CutoutLayerKind
import com.facemorph.studio.model.CutoutObjectLayer
import com.facemorph.studio.model.CutoutToolId
import com.facemorph.studio.model.CutoutToolbarPrefs
import com.facemorph.studio.model.DetectedFaceData
import com.facemorph.studio.model.FabricType
import com.facemorph.studio.model.FaceAdjustments
import com.facemorph.studio.model.FaceAngleBucket
import com.facemorph.studio.model.FaceAngleVariant
import com.facemorph.studio.model.FaceProfileItem
import com.facemorph.studio.model.FittedWardrobeLayer
import com.facemorph.studio.model.LayerSegmentationSummary
import com.facemorph.studio.model.LiveCameraConfig
import com.facemorph.studio.model.MultiAngleImportReport
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
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

class StudioViewModel(application: Application) : AndroidViewModel(application) {

    private val ctx: Context get() = getApplication<Application>().applicationContext
    private val prefs = ctx.getSharedPreferences("facemorph_native_prefs", Context.MODE_PRIVATE)

    var activeTab by mutableStateOf(StudioTab.FACE_STUDIO)
    var isFullScreenEditor by mutableStateOf(false)
    var toastMessage by mutableStateOf<String?>(null)

    // User-added Face Profiles only (persisted locally inside app vault)
    var faceProfiles by mutableStateOf<List<FaceProfileItem>>(emptyList())
    var activeProfileId by mutableStateOf("")
    var profileStorageStats by mutableStateOf(0 to 0f)
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
    var groupSwapApplyAll by mutableStateOf(false)
    var perFaceAdjustments by mutableStateOf<Map<String, FaceAdjustments>>(emptyMap())
    private var _adjustments by mutableStateOf(FaceAdjustments())
    var adjustments: FaceAdjustments
        get() = _adjustments
        set(value) {
            _adjustments = value
            val targetId = selectedFaceId ?: detectedFaces.firstOrNull()?.id
            if (targetId != null) {
                perFaceAdjustments = perFaceAdjustments.toMutableMap().apply { put(targetId, value) }
            }
        }
    var segmentedTargetLayers by mutableStateOf<SegmentedTargetLayers?>(null)
    var isSegmentingLayers by mutableStateOf(false)
    var isSkinSamplingMode by mutableStateOf(false)
    var splitCompareEnabled by mutableStateOf(false)
    var splitComparePercent by mutableFloatStateOf(50f)

    // Cutout / Protect Foreground Mask Brush & Magic Tap (preserves original hair, maang tikka, veil, jewelry)
    var cutoutProtectionMask by mutableStateOf<Bitmap?>(null)
    var cutoutMaskVersion by mutableIntStateOf(0)
    var isCutoutBrushMode by mutableStateOf(false)
    var cutoutBrushProtect by mutableStateOf(true)
    var cutoutMagicTapMode by mutableStateOf(false)
    var cutoutMagicTolerance by mutableFloatStateOf(36f)
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
    val targetFaceThumbCache = mutableStateMapOf<String, Bitmap>()
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
    var bodySplitCompareEnabled by mutableStateOf(false)
    var bodySplitComparePercent by mutableFloatStateOf(50f)

    // Live Camera AR Config & Dialogs
    var liveConfig by mutableStateOf(LiveCameraConfig())
    var showCustomAssetDialog by mutableStateOf(false)
    var customAssetNonce by mutableIntStateOf(0)
    var showFaceProfileManager by mutableStateOf(false)
    var pendingAngleTargetProfileId by mutableStateOf<String?>(null)

    // Cutout Studio Toolbar Customization, Custom Sub-Categories, & Multi-Photo Angle Scan
    var cutoutToolbarPrefs by mutableStateOf(CutoutToolbarPrefs())
    var customSubCategories by mutableStateOf<Map<WardrobeCategory, List<String>>>(emptyMap())
    var isBatchImportingFaces by mutableStateOf(false)
    var batchImportStatus by mutableStateOf<String?>(null)
    var lastMultiImportReport by mutableStateOf<MultiAngleImportReport?>(null)

    init {
        cutoutToolbarPrefs = loadCutoutToolbarPrefs()
        customSubCategories = loadSavedCustomSubCategories()
        liveConfig = loadSavedLiveFitCalibration(liveConfig)
        groupSwapApplyAll = prefs.getBoolean("group_swap_apply_all_v1", false)
        activeProfileId = prefs.getString("active_face_profile_id_v1", "") ?: ""
        loadBuiltInCaches()
    }

    fun setGroupSwapApplyAll(applyAll: Boolean) {
        groupSwapApplyAll = applyAll
        prefs.edit().putBoolean("group_swap_apply_all_v1", applyAll).apply()
    }

    private fun setActiveProfileIdPersisted(profileId: String) {
        activeProfileId = profileId
        prefs.edit().putString("active_face_profile_id_v1", profileId).commit()
    }

    fun updateLiveFitConfig(updater: (LiveCameraConfig) -> LiveCameraConfig) {
        val next = updater(liveConfig)
        liveConfig = next
        persistLiveFitCalibration(next)
    }

    private fun loadBuiltInCaches() {
        viewModelScope.launch(Dispatchers.IO) {
            val savedFaces = loadSavedFaceProfiles()
            val savedActiveId = prefs.getString("active_face_profile_id_v1", "") ?: ""
            val loadedFaceMaps = mutableMapOf<String, Bitmap>()
            val loadedMetricsMaps = mutableMapOf<String, SourceFaceMetrics>()
            val loadedAngleBitmaps = mutableMapOf<String, Bitmap>()
            val loadedAngleCutouts = mutableMapOf<String, Bitmap>()
            val loadedAngleMetrics = mutableMapOf<String, SourceFaceMetrics>()
            var needsRePersist = false
            var preloadedFullCount = 0

            val hydratedFaces = savedFaces.map { profile ->
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
                val targetSelId = profile.selectedAngleId ?: rawAngles.firstOrNull()?.id
                val isActiveProf = profile.id == savedActiveId || (savedActiveId.isBlank() && savedFaces.firstOrNull()?.id == profile.id)

                for (angle in rawAngles) {
                    val fileObj = java.io.File(angle.filePath)
                    if (!fileObj.exists() || fileObj.length() <= 0L) {
                        needsRePersist = true
                        continue
                    }

                    var decodedFullBmp: Bitmap? = null
                    val cachedMetrics = angle.savedMetrics
                    val metrics = if (cachedMetrics != null) {
                        cachedMetrics
                    } else {
                        decodedFullBmp = NativeStorageHelper.loadBitmapFromFile(angle.filePath, 900) ?: continue
                        needsRePersist = true
                        NativeFaceSwapEngine.detectSourceFaceMetrics(decodedFullBmp)
                    }

                    val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)
                    val existingCutout = angle.cutoutFilePath?.let { NativeStorageHelper.loadBitmapFromFile(it, 240) }
                    val cutoutBmp = if (existingCutout != null) {
                        existingCutout
                    } else {
                        val base = decodedFullBmp ?: NativeStorageHelper.loadBitmapFromFile(angle.filePath, 900) ?: continue
                        decodedFullBmp = base
                        NativeFaceSwapEngine.createCutoutFaceAvatar(base, metrics, 240)
                    }
                    val cutoutPath = if (existingCutout != null && !angle.cutoutFilePath.isNullOrBlank()) {
                        angle.cutoutFilePath
                    } else {
                        needsRePersist = true
                        NativeStorageHelper.saveProfileAngleBitmap(
                            ctx,
                            profile.id,
                            cutoutBmp,
                            "${angle.id}_cutout.png",
                            preferJpegWhenOpaque = false
                        ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angle.id}_cutout.png")
                    }

                    // Preload primary/active bitmaps up to 24 full frames; hydrate additional unlimited angles lazily on demand
                    val shouldPreloadFull = (angle.id == targetSelId) || (isActiveProf && preloadedFullCount < 20)
                    val fullBmp = if (shouldPreloadFull) {
                        decodedFullBmp ?: NativeStorageHelper.loadBitmapFromFile(angle.filePath, 900)
                    } else null
                    if (fullBmp != null) {
                        loadedAngleBitmaps[angle.id] = fullBmp
                        preloadedFullCount++
                    }

                    val updatedAngle = angle.copy(
                        cutoutFilePath = cutoutPath,
                        bucket = bucket,
                        yawDeg = metrics.yawDeg,
                        pitchDeg = metrics.pitchDeg,
                        rollDeg = metrics.rollDeg,
                        smileScore = metrics.smileScore,
                        savedMetrics = metrics
                    )
                    validAngles.add(updatedAngle)
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
                        ?: validAngles.find { it.id == selId }?.let { NativeStorageHelper.loadBitmapFromFile(it.filePath, 900) }
                    val primaryMetrics = loadedAngleMetrics[selId]
                    if (primaryBmp != null) {
                        loadedFaceMaps[profile.id] = primaryBmp
                        loadedAngleBitmaps[selId] = primaryBmp
                    }
                    if (primaryMetrics != null) loadedMetricsMaps[profile.id] = primaryMetrics
                    profile.copy(
                        customFilePath = validAngles.find { it.id == selId }?.filePath ?: validAngles.first().filePath,
                        angles = validAngles,
                        selectedAngleId = selId
                    )
                }
            }
            val vaultStats = NativeStorageHelper.getProfileStorageStats(ctx)

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
                    id = "asset-kurta-emerald",
                    name = "Emerald Kurta",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    subCategory = WardrobeSubCategory.ETHNIC,
                    fabricType = FabricType.SILK,
                    defaultScale = 1.0f
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
                    id = "asset-watch-gold",
                    name = "Royal Gold Watch",
                    category = WardrobeCategory.JEWELRY,
                    anchorPoint = BodyAnchorPoint.WRIST,
                    subCategory = WardrobeSubCategory.WATCH,
                    defaultScale = 0.38f
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
                profileStorageStats = vaultStats
                if (needsRePersist && hydratedFaces.isNotEmpty()) {
                    persistFaceProfiles(hydratedFaces)
                }
                val resolvedActive = when {
                    savedActiveId.isNotBlank() && hydratedFaces.any { it.id == savedActiveId } -> savedActiveId
                    hydratedFaces.isNotEmpty() -> hydratedFaces.first().id
                    else -> ""
                }
                if (resolvedActive != activeProfileId) {
                    setActiveProfileIdPersisted(resolvedActive)
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
        targetFaceThumbCache.clear()
        perFaceAdjustments = emptyMap()
        bodySubjectFaceId = null
        bodyScan = null
        isSkinSamplingMode = false
        isCutoutBrushMode = false
        clearCutoutMask()
        _adjustments = _adjustments.copy(manualSkinPatch = null, hiddenLayerIds = emptySet())
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

    fun resegmentTargetLayers(silent: Boolean = false) {
        val bmp = targetBitmap ?: return
        val facesSnapshot = detectedFaces
        val adjSnapshot = adjustments
        val existingMagic = segmentedTargetLayers?.objectLayers
            ?.filter { it.id.startsWith("layer-magic-") && !it.bitmap.isRecycled }
            ?: emptyList()
        isSegmentingLayers = true
        viewModelScope.launch(Dispatchers.IO) {
            val rawLayers = MlKitLayerSegmentationEngine.extractTargetSceneLayers(
                targetBitmap = bmp,
                faces = facesSnapshot,
                autoMaskHair = adjSnapshot.autoMaskHair,
                autoMaskAccessories = adjSnapshot.autoMaskAccessories,
                autoMaskObjects = adjSnapshot.autoMaskObjects,
                preserveTargetLayers = adjSnapshot.preserveTargetLayers,
                foreheadCutShift = adjSnapshot.foreheadCutShift,
                foreheadSoftness = adjSnapshot.foreheadSoftness
            )
            val mergedLayers = if (existingMagic.isNotEmpty()) {
                val combined = (rawLayers.objectLayers + existingMagic).sortedBy { it.zOrder }
                val totalLayers = 2 + combined.size
                rawLayers.copy(
                    objectLayers = combined,
                    summary = rawLayers.summary.copy(
                        hasForegroundObjects = true,
                        totalLayerCount = totalLayers,
                        objectLayerCount = combined.size,
                        decisionNote = "$totalLayers Layers · ${existingMagic.size} Magic + Auto"
                    )
                )
            } else {
                rawLayers
            }
            withContext(Dispatchers.Main) {
                if (targetBitmap === bmp) {
                    segmentedTargetLayers = mergedLayers
                    val validIds = mergedLayers.objectLayers.map { it.id }.toSet()
                    adjustments = adjustments.copy(
                        hiddenLayerIds = adjustments.hiddenLayerIds.intersect(validIds)
                    )
                    if (!silent) {
                        showToast(mergedLayers.summary.decisionNote)
                    }
                }
                isSegmentingLayers = false
            }
        }
    }

    fun magicSelectCutoutAt(imgX: Float, imgY: Float) {
        val bmp = targetBitmap ?: return
        val tol = cutoutMagicTolerance.coerceIn(10f, 92f)
        val sx = imgX.toInt().coerceIn(0, bmp.width - 1)
        val sy = imgY.toInt().coerceIn(0, bmp.height - 1)
        val curLayers = segmentedTargetLayers
        viewModelScope.launch(Dispatchers.Default) {
            val w = bmp.width
            val h = bmp.height
            val total = w * h
            val pixels = IntArray(total)
            bmp.getPixels(pixels, 0, w, 0, 0, w, h)

            val seedIdx = sy * w + sx
            val seedC = pixels[seedIdx]
            val seedR = Color.red(seedC)
            val seedG = Color.green(seedC)
            val seedB = Color.blue(seedC)
            val seedLum = 0.299f * seedR + 0.587f * seedG + 0.114f * seedB

            val maxColorDist = 22f + tol * 2.15f
            val strictColorDist = maxColorDist * 0.55f
            val maxRadius = max(48f, max(w, h) * 0.38f)
            val maxRadiusSq = maxRadius * maxRadius

            val visited = BooleanArray(total)
            val selected = ArrayList<Int>(1024)
            val queue = IntArray(total)
            var qHead = 0
            var qTail = 0
            visited[seedIdx] = true
            queue[qTail++] = seedIdx

            val dx4 = intArrayOf(-1, 1, 0, 0)
            val dy4 = intArrayOf(0, 0, -1, 1)

            while (qHead < qTail) {
                val cur = queue[qHead++]
                selected.add(cur)
                if (selected.size > total / 3) break

                val cx = cur % w
                val cy = cur / w
                val cc = pixels[cur]
                val cR = Color.red(cc)
                val cG = Color.green(cc)
                val cB = Color.blue(cc)
                val cLum = 0.299f * cR + 0.587f * cG + 0.114f * cB

                for (d in 0..3) {
                    val nx = cx + dx4[d]
                    val ny = cy + dy4[d]
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
                    val nIdx = ny * w + nx
                    if (visited[nIdx]) continue

                    val rdx = (nx - sx).toFloat()
                    val rdy = (ny - sy).toFloat()
                    if (rdx * rdx + rdy * rdy > maxRadiusSq) continue

                    val nc = pixels[nIdx]
                    if (Color.alpha(nc) < 25) continue
                    val nR = Color.red(nc)
                    val nG = Color.green(nc)
                    val nB = Color.blue(nc)
                    val nLum = 0.299f * nR + 0.587f * nG + 0.114f * nB

                    val seedDist = abs(nR - seedR) + abs(nG - seedG) + abs(nB - seedB)
                    val stepDist = abs(nR - cR) + abs(nG - cG) + abs(nB - cB)
                    val lumStep = abs(nLum - cLum)
                    val lumSeed = abs(nLum - seedLum)

                    val pass = seedDist <= strictColorDist ||
                        (seedDist <= maxColorDist && stepDist < 42f && lumStep < 28f && lumSeed < maxColorDist * 0.6f)
                    if (pass) {
                        visited[nIdx] = true
                        queue[qTail++] = nIdx
                    }
                }
            }

            if (selected.size < 16) {
                withContext(Dispatchers.Main) {
                    showToast("Tap closer to the object or raise Magic Tol")
                }
                return@launch
            }

            val outPixels = IntArray(total)
            for (idx in selected) {
                val sc = pixels[idx]
                val cx = idx % w
                val cy = idx / w
                var edgeNeighbors = 0
                for (d in 0..3) {
                    val nx = cx + dx4[d]
                    val ny = cy + dy4[d]
                    if (nx in 0 until w && ny in 0 until h && !visited[ny * w + nx]) {
                        edgeNeighbors++
                    }
                }
                val alpha = when (edgeNeighbors) {
                    0 -> 255
                    1 -> 215
                    else -> 165
                }
                outPixels[idx] = Color.argb(alpha, Color.red(sc), Color.green(sc), Color.blue(sc))
            }
            val objBmp = Bitmap.createBitmap(outPixels, w, h, Bitmap.Config.ARGB_8888).apply {
                setHasAlpha(true)
            }

            withContext(Dispatchers.Main) {
                if (targetBitmap !== bmp) {
                    objBmp.recycle()
                    return@withContext
                }
                val baseLayers = curLayers ?: SegmentedTargetLayers(
                    backgroundLayer = bmp.copy(Bitmap.Config.ARGB_8888, false).apply { setHasAlpha(true) },
                    foreLayer = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { setHasAlpha(true) },
                    summary = LayerSegmentationSummary(),
                    objectLayers = emptyList()
                )
                val existingMagicCount = baseLayers.objectLayers.count { it.id.startsWith("layer-magic-") }
                val magicNum = existingMagicCount + 1
                val firstFaceArea = detectedFaces.firstOrNull()?.let {
                    max(400f, (it.boxRight - it.boxLeft) * (it.boxBottom - it.boxTop))
                } ?: (total * 0.18f)
                val covPct = ((selected.size * 100f) / firstFaceArea).toInt().coerceIn(1, 100)
                val newLayer = CutoutObjectLayer(
                    id = "layer-magic-${System.currentTimeMillis()}",
                    name = "Magic #$magicNum",
                    kind = CutoutLayerKind.OBJECT,
                    zOrder = 55 + magicNum,
                    coveragePct = covPct,
                    pixelCount = selected.size,
                    bitmap = objBmp
                )
                val nextObjects = (baseLayers.objectLayers + newLayer).sortedBy { it.zOrder }
                val nextTotal = 2 + nextObjects.size
                segmentedTargetLayers = baseLayers.copy(
                    objectLayers = nextObjects,
                    summary = baseLayers.summary.copy(
                        hasForegroundObjects = true,
                        totalLayerCount = nextTotal,
                        objectLayerCount = nextObjects.size,
                        decisionNote = "$nextTotal Layers · Added Magic #$magicNum"
                    )
                )
                adjustments = adjustments.copy(preserveTargetLayers = true, showForeLayers = true)
                showToast("Magic #$magicNum cutout added (${selected.size}px)")
            }
        }
    }

    fun clearMagicCutouts() {
        val cur = segmentedTargetLayers ?: return
        val remaining = cur.objectLayers.filterNot { it.id.startsWith("layer-magic-") }
        val removedIds = cur.objectLayers.filter { it.id.startsWith("layer-magic-") }.map { it.id }.toSet()
        if (removedIds.isEmpty()) return
        val nextTotal = 2 + remaining.size
        segmentedTargetLayers = cur.copy(
            objectLayers = remaining,
            summary = cur.summary.copy(
                totalLayerCount = nextTotal,
                objectLayerCount = remaining.size,
                decisionNote = "$nextTotal Layers"
            )
        )
        adjustments = adjustments.copy(hiddenLayerIds = adjustments.hiddenLayerIds - removedIds)
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
        val thumbsMap = rawFaces.associate { f ->
            f.id to NativeFaceSwapEngine.createTargetFaceThumbnail(bmp, f, 96)
        }
        val applyAllOnLoad = groupSwapApplyAll || rawFaces.size <= 1
        val hydratedExtraBitmaps = mutableMapOf<String, Bitmap>()
        val faces = rawFaces.mapIndexed { idx, f ->
            if (!applyAllOnLoad && idx > 0) {
                f.copy(
                    assignedProfileId = null,
                    assignedAngleId = null,
                    angleMatchScore = null,
                    angleMatchFlipped = false,
                    enabled = false
                )
            } else if (defaultProf != null) {
                val match = NativeFaceSwapEngine.findBestAngleForPose(
                    profile = defaultProf,
                    angleMetrics = angleMetricsSnapshot,
                    targetYawDeg = f.yawDeg,
                    targetPitchDeg = f.pitchDeg,
                    targetRollDeg = f.rollDeg,
                    targetSmileScore = f.smileScore
                )
                val chosenAngleId = match.angleId ?: defaultProf.selectedAngleId
                if (chosenAngleId != null && angleBitmapCache[chosenAngleId] == null) {
                    defaultProf.angles.find { it.id == chosenAngleId }?.let { variant ->
                        NativeStorageHelper.loadBitmapFromFile(variant.filePath, 900)?.let { loaded ->
                            hydratedExtraBitmaps[chosenAngleId] = loaded
                        }
                    }
                }
                f.copy(
                    assignedAngleId = chosenAngleId,
                    angleMatchScore = match.matchScore,
                    angleMatchFlipped = match.shouldFlip,
                    enabled = true
                )
            } else f
        }
        if (hydratedExtraBitmaps.isNotEmpty()) {
            withContext(Dispatchers.Main) {
                angleBitmapCache.putAll(hydratedExtraBitmaps)
            }
        }
        val firstFace = faces.firstOrNull()
        val scan = NativeClothPhysicsEngine.scanBodyWithMlKit(bmp, firstFace)
        val adjSnapshot = adjustments
        val layers = MlKitLayerSegmentationEngine.extractTargetSceneLayers(
            targetBitmap = bmp,
            faces = faces,
            autoMaskHair = adjSnapshot.autoMaskHair,
            autoMaskAccessories = adjSnapshot.autoMaskAccessories,
            autoMaskObjects = adjSnapshot.autoMaskObjects,
            preserveTargetLayers = adjSnapshot.preserveTargetLayers,
            foreheadCutShift = adjSnapshot.foreheadCutShift,
            foreheadSoftness = adjSnapshot.foreheadSoftness
        )
        withContext(Dispatchers.Main) {
            targetBitmap = bmp
            detectedFaces = faces
            targetFaceThumbCache.clear()
            targetFaceThumbCache.putAll(thumbsMap)
            segmentedTargetLayers = layers
            isSegmentingLayers = false
            selectedFaceId = firstFace?.id
            bodySubjectFaceId = firstFace?.id
            bodyScan = scan
            lastScanMatchScore = faces.mapNotNull { it.angleMatchScore }.maxOrNull() ?: 0
            isSkinSamplingMode = false
            isCutoutBrushMode = false
            clearCutoutMask()
            val resetBase = _adjustments.copy(manualSkinPatch = null, hiddenLayerIds = emptySet())
            _adjustments = resetBase
            perFaceAdjustments = if (firstFace != null) mapOf(firstFace.id to resetBase) else emptyMap()
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
        viewModelScope.launch(Dispatchers.Default) {
            val scan = NativeClothPhysicsEngine.scanBodyWithMlKit(bmp, face)
            withContext(Dispatchers.Main) {
                if (bodySubjectFaceId == faceId && targetBitmap === bmp) {
                    bodyScan = scan
                }
            }
        }
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
            val metrics = angleMetricsCache[angle.id] ?: angle.savedMetrics ?: return@mapNotNull null
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

    fun clearMultiImportReport() {
        lastMultiImportReport = null
    }

    fun createFaceProfileFromUris(uris: List<Uri>, name: String? = null) {
        if (uris.isEmpty()) return
        if (uris.size == 1) {
            createFaceProfileFromUri(uris.first(), name)
            return
        }
        val cleanName = name?.trim()?.takeIf { it.isNotBlank() } ?: "Profile ${faceProfiles.size + 1}"
        val profileId = createEmptyProfile(cleanName)
        addMultipleAnglesToProfileFromUris(profileId, uris)
    }

    fun addMultipleAnglesToProfileFromUris(profileId: String, uris: List<Uri>) {
        if (uris.isEmpty()) return
        if (uris.size == 1) {
            addAngleToProfileFromUri(profileId, uris.first())
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val targetProfile = faceProfiles.find { it.id == profileId } ?: return@launch
            withContext(Dispatchers.Main) {
                isBatchImportingFaces = true
                lastMultiImportReport = null
                batchImportStatus = "Scanning 1 / ${uris.size}..."
            }

            val accumulatedExisting = targetProfile.angles
                .map { it to (angleMetricsCache[it.id] ?: it.savedMetrics) }
                .toMutableList()

            val newlyAdded = mutableListOf<FaceAngleVariant>()
            val newBitmaps = mutableMapOf<String, Bitmap>()
            val newCutouts = mutableMapOf<String, Bitmap>()
            val newMetrics = mutableMapOf<String, SourceFaceMetrics>()
            val addedLabels = mutableListOf<String>()
            val skippedReasons = mutableListOf<String>()
            var skippedDup = 0
            var skippedNoFace = 0

            uris.forEachIndexed { idx, uri ->
                withContext(Dispatchers.Main) {
                    batchImportStatus = "Scanning ${idx + 1} / ${uris.size} face angles..."
                }
                val bmp = NativeStorageHelper.loadBitmapFromUri(ctx, uri, 900)
                if (bmp == null) {
                    skippedNoFace++
                    skippedReasons.add("#${idx + 1}: Could not read photo")
                    return@forEachIndexed
                }

                val scan = NativeFaceSwapEngine.detectSourceFaceMetricsStrict(bmp)
                if (!scan.faceDetected) {
                    skippedNoFace++
                    skippedReasons.add("#${idx + 1}: No clear face found")
                    return@forEachIndexed
                }

                val metrics = scan.metrics
                val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)
                if (NativeFaceSwapEngine.checkDuplicateAngle(accumulatedExisting, metrics, strictAngleDedup = false)) {
                    skippedDup++
                    skippedReasons.add("#${idx + 1}: Identical duplicate ${bucket.shortTag} (${metrics.yawDeg.toInt()}°)")
                    return@forEachIndexed
                }

                val ts = System.currentTimeMillis()
                val angleId = "angle-${ts}-$idx"
                val cutoutBmp = NativeFaceSwapEngine.createCutoutFaceAvatar(bmp, metrics, 240)
                val fullPath = NativeStorageHelper.saveProfileAngleBitmap(
                    ctx,
                    profileId,
                    bmp,
                    "$angleId.jpg",
                    preferJpegWhenOpaque = true
                ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$angleId.png")
                if (fullPath == null) {
                    skippedNoFace++
                    skippedReasons.add("#${idx + 1}: Storage write failed")
                    return@forEachIndexed
                }
                val cutoutPath = NativeStorageHelper.saveProfileAngleBitmap(
                    ctx,
                    profileId,
                    cutoutBmp,
                    "${angleId}_cutout.png",
                    preferJpegWhenOpaque = false
                ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angleId}_cutout.png")

                val variant = FaceAngleVariant(
                    id = angleId,
                    filePath = fullPath,
                    cutoutFilePath = cutoutPath,
                    bucket = bucket,
                    yawDeg = metrics.yawDeg,
                    pitchDeg = metrics.pitchDeg,
                    rollDeg = metrics.rollDeg,
                    smileScore = metrics.smileScore,
                    createdAt = ts + idx,
                    savedMetrics = metrics
                )
                newlyAdded.add(variant)
                accumulatedExisting.add(variant to metrics)
                newBitmaps[angleId] = bmp
                newCutouts[angleId] = cutoutBmp
                newMetrics[angleId] = metrics
                addedLabels.add("${bucket.shortTag} (${metrics.yawDeg.toInt()}°)")
            }

            withContext(Dispatchers.Main) {
                isBatchImportingFaces = false
                batchImportStatus = null
                if (newlyAdded.isNotEmpty()) {
                    angleBitmapCache.putAll(newBitmaps)
                    angleCutoutCache.putAll(newCutouts)
                    angleMetricsCache.putAll(newMetrics)
                    val updatedList = faceProfiles.map { p ->
                        if (p.id == profileId) {
                            val combined = p.angles + newlyAdded
                            val selId = p.selectedAngleId ?: newlyAdded.first().id
                            val selPath = combined.find { it.id == selId }?.filePath ?: newlyAdded.first().filePath
                            p.copy(
                                customFilePath = selPath,
                                angles = combined,
                                selectedAngleId = selId
                            )
                        } else p
                    }
                    faceProfiles = updatedList
                    val primary = newlyAdded.first()
                    if (profileBitmapCache[profileId] == null) {
                        newBitmaps[primary.id]?.let { profileBitmapCache[profileId] = it }
                        newMetrics[primary.id]?.let { profileMetricsCache[profileId] = it }
                    }
                    persistFaceProfiles(updatedList)
                    setActiveProfileIdPersisted(profileId)
                    assignProfileToSelectedOrAll(profileId)
                }

                lastMultiImportReport = MultiAngleImportReport(
                    profileName = targetProfile.name,
                    totalSelected = uris.size,
                    addedCount = newlyAdded.size,
                    skippedDuplicateCount = skippedDup,
                    skippedNoFaceCount = skippedNoFace,
                    addedLabels = addedLabels,
                    skippedReasons = skippedReasons
                )
                val summaryMsg = buildString {
                    append("Saved ${newlyAdded.size}/${uris.size} faces locally")
                    if (skippedDup > 0) append(" · $skippedDup exact duplicate skipped")
                    if (skippedNoFace > 0) append(" · $skippedNoFace no-face")
                }
                showToast(summaryMsg)
            }
        }
    }

    fun saveTargetFaceToProfile(faceId: String? = null, targetProfileId: String? = null) {
        val bmp = targetBitmap ?: return
        val face = (faceId?.let { id -> detectedFaces.find { it.id == id } } ?: getSelectedOrPrimaryFace()) ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val cropBmp = NativeFaceSwapEngine.extractFaceCropForProfile(bmp, face, 640)
            if (!targetProfileId.isNullOrBlank() && faceProfiles.any { it.id == targetProfileId }) {
                saveAngleIntoProfileBitmap(targetProfileId, cropBmp)
            } else {
                saveNewFaceProfileBitmap(cropBmp, null)
            }
        }
    }

    private suspend fun saveNewFaceProfileBitmap(bmp: Bitmap, name: String?) {
        val metrics = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
        val cutoutBmp = NativeFaceSwapEngine.createCutoutFaceAvatar(bmp, metrics, 240)
        val ts = System.currentTimeMillis()
        val profileId = "profile-$ts"
        val angleId = "angle-$ts"
        val fullPath = NativeStorageHelper.saveProfileAngleBitmap(
            ctx,
            profileId,
            bmp,
            "$angleId.jpg",
            preferJpegWhenOpaque = true
        ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$angleId.png")
            ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$profileId.png")
            ?: ""
        val cutoutPath = NativeStorageHelper.saveProfileAngleBitmap(
            ctx,
            profileId,
            cutoutBmp,
            "${angleId}_cutout.png",
            preferJpegWhenOpaque = false
        ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angleId}_cutout.png")
        val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)
        val angleVariant = FaceAngleVariant(
            id = angleId,
            filePath = fullPath,
            cutoutFilePath = cutoutPath,
            bucket = bucket,
            yawDeg = metrics.yawDeg,
            pitchDeg = metrics.pitchDeg,
            rollDeg = metrics.rollDeg,
            smileScore = metrics.smileScore,
            createdAt = ts,
            savedMetrics = metrics
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
            setActiveProfileIdPersisted(profileId)
            assignProfileToSelectedOrAll(profileId)
            showToast("Saved '$finalName' locally (${bucket.shortTag})")
        }
    }

    private suspend fun saveAngleIntoProfileBitmap(profileId: String, bmp: Bitmap) {
        val targetProfile = faceProfiles.find { it.id == profileId } ?: run {
            saveNewFaceProfileBitmap(bmp, null)
            return
        }
        val metrics = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
        val existingPairs = targetProfile.angles.map { it to (angleMetricsCache[it.id] ?: it.savedMetrics) }
        if (NativeFaceSwapEngine.checkDuplicateAngle(existingPairs, metrics, strictAngleDedup = false)) {
            withContext(Dispatchers.Main) {
                showToast("Identical face photo already saved in '${targetProfile.name}'")
            }
            return
        }

        val cutoutBmp = NativeFaceSwapEngine.createCutoutFaceAvatar(bmp, metrics, 240)
        val ts = System.currentTimeMillis()
        val angleId = "angle-$ts"
        val fullPath = NativeStorageHelper.saveProfileAngleBitmap(
            ctx,
            profileId,
            bmp,
            "$angleId.jpg",
            preferJpegWhenOpaque = true
        ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$angleId.png") ?: return
        val cutoutPath = NativeStorageHelper.saveProfileAngleBitmap(
            ctx,
            profileId,
            cutoutBmp,
            "${angleId}_cutout.png",
            preferJpegWhenOpaque = false
        ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angleId}_cutout.png")
        val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)
        val newAngle = FaceAngleVariant(
            id = angleId,
            filePath = fullPath,
            cutoutFilePath = cutoutPath,
            bucket = bucket,
            yawDeg = metrics.yawDeg,
            pitchDeg = metrics.pitchDeg,
            rollDeg = metrics.rollDeg,
            smileScore = metrics.smileScore,
            createdAt = ts,
            savedMetrics = metrics
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
            setActiveProfileIdPersisted(profileId)
            assignProfileToSelectedOrAll(profileId)
            val totalCount = updatedList.find { it.id == profileId }?.angles?.size ?: 1
            showToast("Saved ${bucket.shortTag} to '${targetProfile.name}' ($totalCount angles)")
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
        (angleMetricsCache[angleId] ?: angle.savedMetrics)?.let { profileMetricsCache[profileId] = it }
        persistFaceProfiles(updatedList)
        setActiveProfileIdPersisted(profileId)

        if (angleBitmapCache[angleId] == null) {
            viewModelScope.launch(Dispatchers.IO) {
                val loaded = NativeStorageHelper.loadBitmapFromFile(angle.filePath, 900) ?: return@launch
                val metrics = angleMetricsCache[angleId] ?: angle.savedMetrics ?: NativeFaceSwapEngine.detectSourceFaceMetrics(loaded)
                withContext(Dispatchers.Main) {
                    angleBitmapCache[angleId] = loaded
                    angleMetricsCache[angleId] = metrics
                    profileBitmapCache[profileId] = loaded
                    profileMetricsCache[profileId] = metrics
                }
            }
        }

        val targetId = selectedFaceId ?: detectedFaces.firstOrNull()?.id
        val applyAll = groupSwapApplyAll || detectedFaces.size <= 1
        detectedFaces = detectedFaces.map { face ->
            val shouldUpdate = if (applyAll) {
                face.assignedProfileId == profileId || face.id == targetId
            } else {
                face.id == targetId
            }
            if (shouldUpdate) {
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
        setActiveProfileIdPersisted(profileId)
        persistFaceProfiles(updated)
        showToast("Created profile '$clean' — add unlimited face angles")
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
        val fullPath = NativeStorageHelper.saveProfileAngleBitmap(
            ctx,
            profileId,
            editedBmp,
            "${angleId}_v${ts}.jpg",
            preferJpegWhenOpaque = true
        ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, editedBmp, "${angleId}_v${ts}.png") ?: return
        val cutoutPath = NativeStorageHelper.saveProfileAngleBitmap(
            ctx,
            profileId,
            cutoutBmp,
            "${angleId}_v${ts}_cutout.png",
            preferJpegWhenOpaque = false
        ) ?: NativeStorageHelper.saveBitmapToInternalFile(ctx, cutoutBmp, "${angleId}_v${ts}_cutout.png")
        val bucket = classifyFaceAngleBucket(metrics.yawDeg, metrics.pitchDeg)

        val updatedAngle = oldAngle.copy(
            filePath = fullPath,
            cutoutFilePath = cutoutPath,
            bucket = bucket,
            yawDeg = metrics.yawDeg,
            pitchDeg = metrics.pitchDeg,
            rollDeg = metrics.rollDeg,
            smileScore = metrics.smileScore,
            savedMetrics = metrics
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
                        targetRollDeg = face.rollDeg,
                        targetSmileScore = face.smileScore
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
        NativeStorageHelper.deleteProfileFolder(ctx, profileId)
        persistFaceProfiles(updated)

        val fallback = updated.firstOrNull()
        val fallbackId = fallback?.id ?: ""
        if (activeProfileId == profileId) {
            setActiveProfileIdPersisted(fallbackId)
        }
        detectedFaces = detectedFaces.map { face ->
            if (face.assignedProfileId == profileId) {
                if (fallback != null && fallback.angles.isNotEmpty()) {
                    val match = NativeFaceSwapEngine.findBestAngleForPose(
                        profile = fallback,
                        angleMetrics = angleMetricsCache,
                        targetYawDeg = face.yawDeg,
                        targetPitchDeg = face.pitchDeg,
                        targetRollDeg = face.rollDeg,
                        targetSmileScore = face.smileScore
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
        setActiveProfileIdPersisted(profileId)
        val profile = faceProfiles.find { it.id == profileId }
        val targetFaceId = selectedFaceId ?: detectedFaces.firstOrNull()?.id
        val applyAllFaces = groupSwapApplyAll || detectedFaces.size <= 1

        if (profile == null) {
            detectedFaces = detectedFaces.map { face ->
                if (applyAllFaces || face.id == targetFaceId) {
                    face.copy(
                        assignedProfileId = null,
                        assignedAngleId = null,
                        angleMatchScore = null,
                        angleMatchFlipped = false,
                        enabled = false
                    )
                } else face
            }
            lastScanMatchScore = 0
            return
        }

        if (profile.angles.isEmpty()) {
            detectedFaces = detectedFaces.map { face ->
                if (applyAllFaces || face.id == targetFaceId) {
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
                val cachedM = angleMetricsCache[angle.id] ?: angle.savedMetrics
                if (cachedM != null) {
                    hydratedMetrics[angle.id] = cachedM
                } else {
                    val bmp = angleBitmapCache[angle.id] ?: NativeStorageHelper.loadBitmapFromFile(angle.filePath, 900)
                    if (bmp != null) {
                        hydratedBitmaps[angle.id] = bmp
                        hydratedMetrics[angle.id] = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
                    }
                }
            }

            val mergedMetrics = angleMetricsCache.toMap() + hydratedMetrics
            val currentTarget = targetBitmap
            val currentFaces = if (currentTarget != null && detectedFaces.isEmpty()) {
                NativeFaceSwapEngine.detectFaces(currentTarget, profile.id)
            } else {
                detectedFaces
            }

            val effTargetId = selectedFaceId ?: currentFaces.firstOrNull()?.id
            val effApplyAll = groupSwapApplyAll || currentFaces.size <= 1
            var bestMatchScore = 0
            val matchedFaces = currentFaces.map { face ->
                if (effApplyAll || face.id == effTargetId) {
                    val match = NativeFaceSwapEngine.findBestAngleForPose(
                        profile = profile,
                        angleMetrics = mergedMetrics,
                        targetYawDeg = face.yawDeg,
                        targetPitchDeg = face.pitchDeg,
                        targetRollDeg = face.rollDeg,
                        targetSmileScore = face.smileScore
                    )
                    if (match.matchScore > bestMatchScore) bestMatchScore = match.matchScore
                    val chosenAngleId = match.angleId ?: profile.selectedAngleId
                    if (chosenAngleId != null && angleBitmapCache[chosenAngleId] == null && hydratedBitmaps[chosenAngleId] == null) {
                        profile.angles.find { it.id == chosenAngleId }?.let { variant ->
                            NativeStorageHelper.loadBitmapFromFile(variant.filePath, 900)?.let { loaded ->
                                hydratedBitmaps[chosenAngleId] = loaded
                            }
                        }
                    }
                    face.copy(
                        assignedProfileId = profile.id,
                        assignedAngleId = chosenAngleId,
                        angleMatchScore = match.matchScore,
                        angleMatchFlipped = match.shouldFlip,
                        enabled = true
                    )
                } else {
                    face
                }
            }

            val fallbackPrimaryId = matchedFaces.firstOrNull { it.assignedProfileId == profile.id }?.assignedAngleId
                ?: profile.selectedAngleId
                ?: profile.angles.first().id
            if (angleBitmapCache[fallbackPrimaryId] == null && hydratedBitmaps[fallbackPrimaryId] == null) {
                profile.angles.find { it.id == fallbackPrimaryId }?.let { variant ->
                    NativeStorageHelper.loadBitmapFromFile(variant.filePath, 900)?.let { loaded ->
                        hydratedBitmaps[fallbackPrimaryId] = loaded
                    }
                }
            }

            withContext(Dispatchers.Main) {
                hydratedBitmaps.forEach { (k, v) -> angleBitmapCache[k] = v }
                hydratedMetrics.forEach { (k, v) -> angleMetricsCache[k] = v }
                angleBitmapCache[fallbackPrimaryId]?.let { profileBitmapCache[profile.id] = it }
                angleMetricsCache[fallbackPrimaryId]?.let { profileMetricsCache[profile.id] = it }

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
        val metricsSnapshot = angleMetricsCache.toMap().toMutableMap()
        faceProfiles.forEach { p ->
            p.angles.forEach { a ->
                if (!metricsSnapshot.containsKey(a.id) && a.savedMetrics != null) {
                    metricsSnapshot[a.id] = a.savedMetrics
                }
            }
        }
        val missingAngleIds = mutableListOf<Pair<String, String>>()
        detectedFaces = detectedFaces.map { face ->
            val prof = faceProfiles.find { it.id == face.assignedProfileId } ?: fallbackProf
            val match = NativeFaceSwapEngine.findBestAngleForPose(
                profile = prof,
                angleMetrics = metricsSnapshot,
                targetYawDeg = face.yawDeg,
                targetPitchDeg = face.pitchDeg,
                targetRollDeg = face.rollDeg,
                targetSmileScore = face.smileScore
            )
            val chosenAngleId = match.angleId ?: prof.selectedAngleId
            if (chosenAngleId != null && angleBitmapCache[chosenAngleId] == null) {
                prof.angles.find { it.id == chosenAngleId }?.let { missingAngleIds.add(chosenAngleId to it.filePath) }
            }
            face.copy(
                assignedProfileId = prof.id,
                assignedAngleId = chosenAngleId,
                angleMatchScore = match.matchScore,
                angleMatchFlipped = match.shouldFlip
            )
        }
        if (missingAngleIds.isNotEmpty()) {
            viewModelScope.launch(Dispatchers.IO) {
                val loaded = mutableMapOf<String, Bitmap>()
                missingAngleIds.distinctBy { it.first }.forEach { (id, path) ->
                    NativeStorageHelper.loadBitmapFromFile(path, 900)?.let { loaded[id] = it }
                }
                if (loaded.isNotEmpty()) {
                    withContext(Dispatchers.Main) { angleBitmapCache.putAll(loaded) }
                }
            }
        }
        lastScanMatchScore = detectedFaces.mapNotNull { it.angleMatchScore }.maxOrNull() ?: 98
        showToast("Matched best face angles (${lastScanMatchScore}%) to target poses")
    }

    fun getSelectedOrPrimaryFace(): DetectedFaceData? {
        val selId = selectedFaceId
        return detectedFaces.find { it.id == selId } ?: detectedFaces.firstOrNull()
    }

    /**
     * Returns target direction label ("Left" or "Right") when target head yaw and current
     * source face yaw point in opposite horizontal directions such that flipping improves alignment.
     */
    fun getFlipSuggestionDirection(face: DetectedFaceData?): String? {
        if (face == null || face.assignedProfileId == null) return null
        val targetYaw = face.yawDeg
        if (kotlin.math.abs(targetYaw) < 5.5f) return null

        val profile = faceProfiles.find { it.id == face.assignedProfileId }
        val angleId = face.assignedAngleId ?: profile?.selectedAngleId ?: profile?.angles?.firstOrNull()?.id
        val variant = profile?.angles?.find { it.id == angleId }
        val rawSourceYaw = (angleId?.let { angleMetricsCache[it]?.yawDeg }
            ?: variant?.yawDeg
            ?: profileMetricsCache[face.assignedProfileId]?.yawDeg
            ?: 0f)
        if (kotlin.math.abs(rawSourceYaw) < 5.5f) return null

        val effectiveSourceYaw = if (face.angleMatchFlipped) -rawSourceYaw else rawSourceYaw
        if (targetYaw * effectiveSourceYaw >= 0f) return null

        val curDiff = kotlin.math.abs(targetYaw - effectiveSourceYaw)
        val flippedDiff = kotlin.math.abs(targetYaw - (-effectiveSourceYaw))
        if (flippedDiff + 4f >= curDiff) return null

        return if (targetYaw < 0f) "Left" else "Right"
    }

    fun toggleSelectedFaceFlip() {
        val target = getSelectedOrPrimaryFace() ?: return
        val nextFlip = !target.angleMatchFlipped
        detectedFaces = detectedFaces.map { f ->
            if (f.id == target.id) f.copy(angleMatchFlipped = nextFlip) else f
        }
        showToast(if (nextFlip) "Flipped face Left <-> Right" else "Restored face orientation")
    }

    fun selectTargetFace(faceId: String) {
        val face = detectedFaces.find { it.id == faceId } ?: return
        val prevId = selectedFaceId
        if (prevId != null && prevId != faceId) {
            perFaceAdjustments = perFaceAdjustments.toMutableMap().apply { put(prevId, _adjustments) }
        }
        selectedFaceId = faceId

        val globalBase = _adjustments
        val loaded = perFaceAdjustments[faceId]?.copy(
            showBackgroundLayer = globalBase.showBackgroundLayer,
            showFaceLayer = globalBase.showFaceLayer,
            showForeLayers = globalBase.showForeLayers,
            preserveTargetLayers = globalBase.preserveTargetLayers,
            showGeometricMesh = globalBase.showGeometricMesh,
            hiddenLayerIds = globalBase.hiddenLayerIds,
            autoMaskHair = globalBase.autoMaskHair,
            autoMaskAccessories = globalBase.autoMaskAccessories,
            autoMaskObjects = globalBase.autoMaskObjects
        ) ?: globalBase.copy(manualSkinPatch = null)

        _adjustments = loaded
        if (faceId !in perFaceAdjustments) {
            perFaceAdjustments = perFaceAdjustments.toMutableMap().apply { put(faceId, loaded) }
        }
        if (face.assignedProfileId != null) {
            setActiveProfileIdPersisted(face.assignedProfileId)
        }
        val angleId = face.assignedAngleId
        if (face.assignedProfileId != null && angleId != null && angleBitmapCache[angleId] == null) {
            val angleVariant = faceProfiles.find { it.id == face.assignedProfileId }?.angles?.find { it.id == angleId }
            if (angleVariant != null) {
                viewModelScope.launch(Dispatchers.IO) {
                    NativeStorageHelper.loadBitmapFromFile(angleVariant.filePath, 900)?.let { loaded ->
                        withContext(Dispatchers.Main) { angleBitmapCache[angleId] = loaded }
                    }
                }
            }
        }
        face.angleMatchScore?.let { lastScanMatchScore = it }
    }

    fun clearSelectedFaceSwap() {
        val targetId = selectedFaceId ?: detectedFaces.firstOrNull()?.id ?: return
        detectedFaces = detectedFaces.map { f ->
            if (f.id == targetId) {
                f.copy(
                    assignedProfileId = null,
                    assignedAngleId = null,
                    angleMatchScore = null,
                    angleMatchFlipped = false,
                    enabled = false
                )
            } else f
        }
        showToast("Kept original face")
    }

    fun syncAdjustmentsToAllFaces() {
        if (detectedFaces.isEmpty()) return
        val base = _adjustments
        val nextMap = perFaceAdjustments.toMutableMap()
        detectedFaces.forEach { f ->
            val existingPatch = nextMap[f.id]?.manualSkinPatch
            nextMap[f.id] = base.copy(manualSkinPatch = existingPatch)
        }
        perFaceAdjustments = nextMap
        showToast("Synced blend & expression to all faces")
    }

    fun toggleFaceEnabled(faceId: String) {
        val target = detectedFaces.find { it.id == faceId } ?: return
        if (!target.enabled && target.assignedProfileId == null && activeProfileId.isNotBlank()) {
            selectTargetFace(faceId)
            scanAndSelectProfileForSwap(activeProfileId, silentToast = true)
            return
        }
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

    fun updateActiveLayerLength(lengthScale: Float) {
        fittedLayers = fittedLayers.map { l ->
            if (l.assetId == selectedWardrobeId) {
                l.copy(lengthScale = lengthScale.coerceIn(0.70f, 1.45f))
            } else l
        }
    }

    fun updateActiveLayerRotation(rotationDeg: Float) {
        fittedLayers = fittedLayers.map { l ->
            if (l.assetId == selectedWardrobeId) {
                l.copy(rotation = rotationDeg.coerceIn(-45f, 45f))
            } else l
        }
    }

    fun nudgeActiveLayerOffset(dxImg: Float, dyImg: Float) {
        fittedLayers = fittedLayers.map { l ->
            if (l.assetId == selectedWardrobeId) {
                l.copy(offsetX = l.offsetX + dxImg, offsetY = l.offsetY + dyImg)
            } else l
        }
    }

    fun resetActiveLayerTransform() {
        val defaultScale = wardrobeAssets.find { it.id == selectedWardrobeId }?.defaultScale ?: 1.0f
        fittedLayers = fittedLayers.map { l ->
            if (l.assetId == selectedWardrobeId) {
                l.copy(scale = defaultScale, lengthScale = 1.0f, rotation = 0f, offsetX = 0f, offsetY = 0f)
            } else l
        }
    }

    fun addCustomSubCategory(category: WardrobeCategory, rawLabel: String): String? {
        val cleaned = rawLabel.trim().replace(Regex("\\s+"), " ")
        if (cleaned.isBlank()) return null
        val normalized = cleaned.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        val builtInMatch = WardrobeSubCategory.entries.find {
            it.parentCategory == category && it.label.equals(normalized, ignoreCase = true)
        }
        if (builtInMatch != null) return builtInMatch.label

        val existingForCat = customSubCategories[category].orEmpty()
        val existingMatch = existingForCat.find { it.equals(normalized, ignoreCase = true) }
        if (existingMatch != null) return existingMatch

        val nextList = existingForCat + normalized
        val nextMap = customSubCategories.toMutableMap().apply { put(category, nextList) }
        customSubCategories = nextMap
        persistCustomSubCategories(nextMap)
        showToast("Created '$normalized' in ${category.label}")
        return normalized
    }

    fun updateCutoutToolbarPrefs(next: CutoutToolbarPrefs) {
        val safeEnabled = if (next.enabledTools.isEmpty()) setOf(CutoutToolId.RESTORE, CutoutToolId.ERASE) else next.enabledTools
        val cleaned = next.copy(enabledTools = safeEnabled)
        cutoutToolbarPrefs = cleaned
        persistCutoutToolbarPrefs(cleaned)
    }

    fun addCustomWardrobeAsset(
        name: String,
        transparentBitmap: Bitmap,
        category: WardrobeCategory,
        anchorPoint: BodyAnchorPoint,
        fabricType: FabricType,
        defaultScale: Float,
        subCategory: WardrobeSubCategory = defaultSubCategoryFor(category, anchorPoint),
        customSubCategory: String? = null
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            val id = "custom-${System.currentTimeMillis()}"
            val path = NativeStorageHelper.saveBitmapToInternalFile(ctx, transparentBitmap, "$id.png")
            val trimmedCustomSub = customSubCategory?.trim()?.takeIf { it.isNotEmpty() }
            val item = WardrobeAssetItem(
                id = id,
                name = name.ifBlank { trimmedCustomSub ?: "Custom Costume" },
                category = category,
                anchorPoint = anchorPoint,
                subCategory = subCategory,
                customSubCategory = trimmedCustomSub,
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
                showToast("Saved '${item.name}' (${item.displaySubCategory})")
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

    private fun serializeSourceMetrics(m: SourceFaceMetrics): JSONObject {
        return JSONObject().apply {
            put("cropLeft", m.cropLeft.toDouble())
            put("cropTop", m.cropTop.toDouble())
            put("cropRight", m.cropRight.toDouble())
            put("cropBottom", m.cropBottom.toDouble())
            put("eyeMidXRatio", m.eyeMidXRatio.toDouble())
            put("eyeMidYRatio", m.eyeMidYRatio.toDouble())
            put("eyeDistRatio", m.eyeDistRatio.toDouble())
            put("rollDeg", m.rollDeg.toDouble())
            put("yawDeg", m.yawDeg.toDouble())
            put("pitchDeg", m.pitchDeg.toDouble())
            put("noseYRatio", m.noseYRatio.toDouble())
            put("mouthYRatio", m.mouthYRatio.toDouble())
            put("aspectRatio", m.aspectRatio.toDouble())
            put("smileScore", m.smileScore.toDouble())
            put("mouthWidthRatio", m.mouthWidthRatio.toDouble())
            put("mouthOpenRatio", m.mouthOpenRatio.toDouble())
            put("browHeightRatio", m.browHeightRatio.toDouble())
            val cArr = JSONArray()
            m.contourNorm.forEach { pt ->
                cArr.put(JSONArray().apply {
                    put(pt.x.toDouble())
                    put(pt.y.toDouble())
                })
            }
            put("contourNorm", cArr)
            val vArr = JSONArray()
            m.visualSignature.forEach { v -> vArr.put(v.toDouble()) }
            put("visualSignature", vArr)
        }
    }

    private fun parseSourceMetrics(o: JSONObject?): SourceFaceMetrics? {
        if (o == null) return null
        return try {
            val contour = mutableListOf<Point2D>()
            o.optJSONArray("contourNorm")?.let { cArr ->
                for (i in 0 until cArr.length()) {
                    val pair = cArr.optJSONArray(i)
                    if (pair != null && pair.length() >= 2) {
                        contour.add(Point2D(pair.optDouble(0, 0.5).toFloat(), pair.optDouble(1, 0.5).toFloat()))
                    }
                }
            }
            val sig = mutableListOf<Float>()
            o.optJSONArray("visualSignature")?.let { vArr ->
                for (i in 0 until vArr.length()) {
                    sig.add(vArr.optDouble(i, 0.0).toFloat())
                }
            }
            SourceFaceMetrics(
                cropLeft = o.optDouble("cropLeft", 0.25).toFloat(),
                cropTop = o.optDouble("cropTop", 0.16).toFloat(),
                cropRight = o.optDouble("cropRight", 0.75).toFloat(),
                cropBottom = o.optDouble("cropBottom", 0.68).toFloat(),
                eyeMidXRatio = o.optDouble("eyeMidXRatio", 0.5).toFloat(),
                eyeMidYRatio = o.optDouble("eyeMidYRatio", 0.36).toFloat(),
                eyeDistRatio = o.optDouble("eyeDistRatio", 0.45).toFloat(),
                rollDeg = o.optDouble("rollDeg", 0.0).toFloat(),
                yawDeg = o.optDouble("yawDeg", 0.0).toFloat(),
                pitchDeg = o.optDouble("pitchDeg", 0.0).toFloat(),
                noseYRatio = o.optDouble("noseYRatio", 0.56).toFloat(),
                mouthYRatio = o.optDouble("mouthYRatio", 0.74).toFloat(),
                aspectRatio = o.optDouble("aspectRatio", 0.86).toFloat(),
                contourNorm = contour,
                visualSignature = sig,
                smileScore = o.optDouble("smileScore", 0.5).toFloat(),
                mouthWidthRatio = o.optDouble("mouthWidthRatio", 0.38).toFloat(),
                mouthOpenRatio = o.optDouble("mouthOpenRatio", 0.04).toFloat(),
                browHeightRatio = o.optDouble("browHeightRatio", 0.25).toFloat()
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun persistFaceProfiles(list: List<FaceProfileItem>) {
        val arr = JSONArray()
        list.forEach { item ->
            val anglesArr = JSONArray()
            item.angles.forEach { angle ->
                val metrics = angleMetricsCache[angle.id] ?: angle.savedMetrics
                anglesArr.put(
                    JSONObject().apply {
                        put("id", angle.id)
                        put("filePath", angle.filePath)
                        put("cutoutFilePath", angle.cutoutFilePath ?: "")
                        put("bucket", angle.bucket.name)
                        put("yawDeg", angle.yawDeg.toDouble())
                        put("pitchDeg", angle.pitchDeg.toDouble())
                        put("rollDeg", angle.rollDeg.toDouble())
                        put("smileScore", (metrics?.smileScore ?: angle.smileScore).toDouble())
                        put("createdAt", angle.createdAt)
                        if (metrics != null) {
                            put("savedMetrics", serializeSourceMetrics(metrics))
                        }
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
        val json = arr.toString()
        prefs.edit().putString("custom_face_profiles_v2", json).commit()
        NativeStorageHelper.saveProfileDbJson(ctx, json)
        profileStorageStats = NativeStorageHelper.getProfileStorageStats(ctx)
    }

    private fun parseProfileDbV2Json(raw: String?): List<FaceProfileItem> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
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
                            val savedM = parseSourceMetrics(ao.optJSONObject("savedMetrics"))
                            FaceAngleVariant(
                                id = ao.getString("id"),
                                filePath = fPath,
                                cutoutFilePath = ao.optString("cutoutFilePath", "").takeIf { it.isNotBlank() },
                                bucket = bucket,
                                yawDeg = ao.optDouble("yawDeg", 0.0).toFloat(),
                                pitchDeg = ao.optDouble("pitchDeg", 0.0).toFloat(),
                                rollDeg = ao.optDouble("rollDeg", 0.0).toFloat(),
                                smileScore = ao.optDouble("smileScore", savedM?.smileScore?.toDouble() ?: 0.5).toFloat(),
                                createdAt = ao.optLong("createdAt", System.currentTimeMillis()),
                                savedMetrics = savedM
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

    private fun loadSavedFaceProfiles(): List<FaceProfileItem> {
        val fileList = parseProfileDbV2Json(NativeStorageHelper.loadProfileDbJson(ctx))
        val prefList = parseProfileDbV2Json(prefs.getString("custom_face_profiles_v2", null))
        if (fileList.isNotEmpty() || prefList.isNotEmpty()) {
            val fileAngles = fileList.sumOf { it.angles.size }
            val prefAngles = prefList.sumOf { it.angles.size }
            return when {
                fileList.size > prefList.size -> fileList
                prefList.size > fileList.size -> prefList
                fileAngles >= prefAngles && fileList.isNotEmpty() -> fileList
                else -> prefList
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
                put("customSubCategory", item.customSubCategory ?: "")
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
                    val customSub = o.optString("customSubCategory", "").takeIf { it.isNotBlank() }
                    WardrobeAssetItem(
                        id = o.getString("id"),
                        name = o.getString("name"),
                        category = cat,
                        anchorPoint = anchor,
                        subCategory = sub,
                        customSubCategory = customSub,
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

    private fun persistCustomSubCategories(map: Map<WardrobeCategory, List<String>>) {
        val obj = JSONObject()
        map.forEach { (cat, list) ->
            val arr = JSONArray()
            list.forEach { arr.put(it) }
            obj.put(cat.name, arr)
        }
        prefs.edit().putString("custom_subcategories_v1", obj.toString()).apply()
    }

    private fun loadSavedCustomSubCategories(): Map<WardrobeCategory, List<String>> {
        val raw = prefs.getString("custom_subcategories_v1", null) ?: return emptyMap()
        return try {
            val obj = JSONObject(raw)
            val result = mutableMapOf<WardrobeCategory, List<String>>()
            WardrobeCategory.entries.forEach { cat ->
                val arr = obj.optJSONArray(cat.name) ?: return@forEach
                val items = (0 until arr.length()).mapNotNull { idx ->
                    arr.optString(idx, "").trim().takeIf { it.isNotEmpty() }
                }
                if (items.isNotEmpty()) result[cat] = items
            }
            result
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun persistCutoutToolbarPrefs(p: CutoutToolbarPrefs) {
        val obj = JSONObject().apply {
            val orderArr = JSONArray()
            p.orderedTools.forEach { orderArr.put(it.name) }
            put("orderedTools", orderArr)
            val enabledArr = JSONArray()
            p.enabledTools.forEach { enabledArr.put(it.name) }
            put("enabledTools", enabledArr)
            put("compactLabels", p.compactLabels)
            put("largeButtons", p.largeButtons)
            put("longPressOpensSettings", p.longPressOpensSettings)
            put("tapActiveOpensSettings", p.tapActiveOpensSettings)
            put("showCompareButton", p.showCompareButton)
            put("showBackdropButton", p.showBackdropButton)
            put("showMagnifierLoupe", p.showMagnifierLoupe)
            put("defaultBrushSizePx", p.defaultBrushSizePx.toDouble())
            put("defaultBrushHardnessPct", p.defaultBrushHardnessPct.toDouble())
            put("defaultTolerance", p.defaultTolerance)
            put("defaultOverlayPct", p.defaultOverlayPct.toDouble())
        }
        prefs.edit().putString("cutout_toolbar_prefs_v1", obj.toString()).apply()
    }

    private fun loadCutoutToolbarPrefs(): CutoutToolbarPrefs {
        val raw = prefs.getString("cutout_toolbar_prefs_v1", null) ?: return CutoutToolbarPrefs()
        return try {
            val o = JSONObject(raw)
            val defaults = CutoutToolbarPrefs()
            val parsedOrder = mutableListOf<CutoutToolId>()
            o.optJSONArray("orderedTools")?.let { arr ->
                for (i in 0 until arr.length()) {
                    runCatching { CutoutToolId.valueOf(arr.getString(i)) }.getOrNull()?.let { id ->
                        if (id !in parsedOrder) parsedOrder.add(id)
                    }
                }
            }
            CutoutToolId.entries.forEach { id -> if (id !in parsedOrder) parsedOrder.add(id) }

            val parsedEnabled = mutableSetOf<CutoutToolId>()
            o.optJSONArray("enabledTools")?.let { arr ->
                for (i in 0 until arr.length()) {
                    runCatching { CutoutToolId.valueOf(arr.getString(i)) }.getOrNull()?.let { parsedEnabled.add(it) }
                }
            }
            CutoutToolbarPrefs(
                orderedTools = parsedOrder,
                enabledTools = if (parsedEnabled.isNotEmpty()) parsedEnabled else defaults.enabledTools,
                compactLabels = o.optBoolean("compactLabels", defaults.compactLabels),
                largeButtons = o.optBoolean("largeButtons", defaults.largeButtons),
                longPressOpensSettings = o.optBoolean("longPressOpensSettings", defaults.longPressOpensSettings),
                tapActiveOpensSettings = o.optBoolean("tapActiveOpensSettings", defaults.tapActiveOpensSettings),
                showCompareButton = o.optBoolean("showCompareButton", defaults.showCompareButton),
                showBackdropButton = o.optBoolean("showBackdropButton", defaults.showBackdropButton),
                showMagnifierLoupe = o.optBoolean("showMagnifierLoupe", defaults.showMagnifierLoupe),
                defaultBrushSizePx = o.optDouble("defaultBrushSizePx", defaults.defaultBrushSizePx.toDouble()).toFloat().coerceIn(6f, 130f),
                defaultBrushHardnessPct = o.optDouble("defaultBrushHardnessPct", defaults.defaultBrushHardnessPct.toDouble()).toFloat().coerceIn(0f, 100f),
                defaultTolerance = o.optInt("defaultTolerance", defaults.defaultTolerance).coerceIn(10, 75),
                defaultOverlayPct = o.optDouble("defaultOverlayPct", defaults.defaultOverlayPct.toDouble()).toFloat().coerceIn(0f, 85f)
            )
        } catch (_: Exception) {
            CutoutToolbarPrefs()
        }
    }

    private fun persistLiveFitCalibration(cfg: LiveCameraConfig) {
        val obj = JSONObject().apply {
            put("clothWidthScale", cfg.clothWidthScale.toDouble())
            put("clothLengthScale", cfg.clothLengthScale.toDouble())
            put("clothCollarOffset", cfg.clothCollarOffset.toDouble())
            put("clothFitHug", cfg.clothFitHug.toDouble())
            put("showBodyMeasurements", cfg.showBodyMeasurements)
        }
        prefs.edit().putString("live_fit_calibration_v1", obj.toString()).apply()
    }

    private fun loadSavedLiveFitCalibration(base: LiveCameraConfig): LiveCameraConfig {
        val raw = prefs.getString("live_fit_calibration_v1", null) ?: return base
        return try {
            val o = JSONObject(raw)
            base.copy(
                clothWidthScale = o.optDouble("clothWidthScale", base.clothWidthScale.toDouble()).toFloat().coerceIn(0.75f, 1.55f),
                clothLengthScale = o.optDouble("clothLengthScale", base.clothLengthScale.toDouble()).toFloat().coerceIn(0.75f, 1.40f),
                clothCollarOffset = o.optDouble("clothCollarOffset", base.clothCollarOffset.toDouble()).toFloat().coerceIn(-80f, 80f),
                clothFitHug = o.optDouble("clothFitHug", base.clothFitHug.toDouble()).toFloat().coerceIn(0f, 1f),
                showBodyMeasurements = o.optBoolean("showBodyMeasurements", base.showBodyMeasurements)
            )
        } catch (_: Exception) {
            base
        }
    }
}
