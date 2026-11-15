package com.facemorph.studio.viewmodel

import android.app.Application
import android.content.Context
import android.graphics.Bitmap
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
import com.facemorph.studio.model.FaceProfileItem
import com.facemorph.studio.model.FittedWardrobeLayer
import com.facemorph.studio.model.LiveCameraConfig
import com.facemorph.studio.model.Point2D
import com.facemorph.studio.model.SourceFaceMetrics
import com.facemorph.studio.model.StudioTab
import com.facemorph.studio.model.TargetSampleItem
import com.facemorph.studio.model.WardrobeAssetItem
import com.facemorph.studio.model.WardrobeCategory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class StudioViewModel(application: Application) : AndroidViewModel(application) {

    private val ctx: Context get() = getApplication<Application>().applicationContext
    private val prefs = ctx.getSharedPreferences("facemorph_native_prefs", Context.MODE_PRIVATE)

    var activeTab by mutableStateOf(StudioTab.FACE_STUDIO)
    var toastMessage by mutableStateOf<String?>(null)

    // User-added Face Profiles only (no dummy faces preloaded)
    var faceProfiles by mutableStateOf<List<FaceProfileItem>>(emptyList())
    var activeProfileId by mutableStateOf("")

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
    var splitCompareEnabled by mutableStateOf(false)
    var splitComparePercent by mutableFloatStateOf(50f)

    // Bitmap & Metrics Caches
    val profileBitmapCache = mutableStateMapOf<String, Bitmap>()
    val profileMetricsCache = mutableStateMapOf<String, SourceFaceMetrics>()
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

    // Live Camera AR Config
    var liveConfig by mutableStateOf(LiveCameraConfig())
    var showCustomAssetDialog by mutableStateOf(false)
    var customAssetNonce by mutableIntStateOf(0)

    init {
        loadBuiltInCaches()
    }

    private fun loadBuiltInCaches() {
        viewModelScope.launch(Dispatchers.IO) {
            val savedFaces = loadSavedFaceProfiles()
            val loadedFaceMaps = mutableMapOf<String, Bitmap>()
            val loadedMetricsMaps = mutableMapOf<String, SourceFaceMetrics>()
            savedFaces.forEach { p ->
                val bmp = p.customFilePath?.let { NativeStorageHelper.loadBitmapFromFile(it, 900) }
                if (bmp != null) {
                    loadedFaceMaps[p.id] = bmp
                    loadedMetricsMaps[p.id] = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
                }
            }

            val builtInWardrobe = listOf(
                WardrobeAssetItem(
                    id = "asset-blazer",
                    name = "Midnight Blazer",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    fabricType = FabricType.WOOL,
                    drawableResId = R.drawable.wardrobe_blazer,
                    defaultScale = 1.0f
                ),
                WardrobeAssetItem(
                    id = "asset-kimono",
                    name = "Silk Kimono",
                    category = WardrobeCategory.CLOTHING,
                    anchorPoint = BodyAnchorPoint.SHOULDERS,
                    fabricType = FabricType.SILK,
                    drawableResId = R.drawable.wardrobe_kimono,
                    defaultScale = 1.12f
                ),
                WardrobeAssetItem(
                    id = "asset-emerald",
                    name = "Emerald Pendant",
                    category = WardrobeCategory.JEWELRY,
                    anchorPoint = BodyAnchorPoint.NECK,
                    drawableResId = R.drawable.wardrobe_emerald_pendant,
                    defaultScale = 0.56f
                ),
                WardrobeAssetItem(
                    id = "asset-diamond",
                    name = "Gold Necklace",
                    category = WardrobeCategory.JEWELRY,
                    anchorPoint = BodyAnchorPoint.NECK,
                    drawableResId = R.drawable.wardrobe_gold_necklace,
                    defaultScale = 0.62f
                ),
                WardrobeAssetItem(
                    id = "asset-watch",
                    name = "Chronograph",
                    category = WardrobeCategory.JEWELRY,
                    anchorPoint = BodyAnchorPoint.WRIST,
                    drawableResId = R.drawable.wardrobe_watch,
                    defaultScale = 0.36f
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
                    else -> null
                }
                if (bmp != null) loadedWardrobeMaps[item.id] = bmp
            }

            val bgMap = mutableMapOf<String, Bitmap>()
            NativeStorageHelper.loadBitmapFromResource(ctx, R.drawable.bg_studio_loft, 960)?.let { bgMap["studio"] = it }
            NativeStorageHelper.loadBitmapFromResource(ctx, R.drawable.bg_cyberpunk_neon, 960)?.let { bgMap["neon"] = it }
            NativeStorageHelper.loadBitmapFromResource(ctx, R.drawable.bg_sunset_terrace, 960)?.let { bgMap["sunset"] = it }

            withContext(Dispatchers.Main) {
                val validFaces = savedFaces.filter { loadedFaceMaps.containsKey(it.id) }
                faceProfiles = validFaces
                profileBitmapCache.putAll(loadedFaceMaps)
                profileMetricsCache.putAll(loadedMetricsMaps)
                if (activeProfileId.isBlank() && validFaces.isNotEmpty()) {
                    activeProfileId = validFaces.first().id
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
        detectedFaces = emptyList()
        selectedFaceId = null
        bodySubjectFaceId = null
        bodyScan = null
    }

    fun rescanTargetFaces() {
        val bmp = targetBitmap ?: return
        viewModelScope.launch(Dispatchers.IO) {
            applyTargetBitmap(bmp)
            withContext(Dispatchers.Main) { showToast("Faces rescanned") }
        }
    }

    private suspend fun applyTargetBitmap(bmp: Bitmap) {
        val defaultProf = activeProfileId.takeIf { it.isNotBlank() }
        val faces = NativeFaceSwapEngine.detectFaces(bmp, defaultProf)
        val firstFace = faces.firstOrNull()
        val scan = NativeClothPhysicsEngine.scanBody(
            bmp.width.toFloat(),
            bmp.height.toFloat(),
            firstFace?.let { (it.boxLeft + it.boxRight) * 0.5f },
            firstFace?.boxBottom,
            firstFace?.let { it.boxRight - it.boxLeft },
            firstFace?.let { it.boxBottom - it.boxTop }
        )
        withContext(Dispatchers.Main) {
            targetBitmap = bmp
            detectedFaces = faces
            selectedFaceId = firstFace?.id
            bodySubjectFaceId = firstFace?.id
            bodyScan = scan
        }
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

    fun addCustomFaceFromUri(uri: Uri, name: String? = null, sourceLabel: String = "Gallery") {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromUri(ctx, uri, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not open face photo") }
                return@launch
            }
            saveAndSelectFaceBitmap(bmp, name, sourceLabel)
        }
    }

    fun addCustomFaceFromFile(filePath: String, name: String? = null, sourceLabel: String = "Camera") {
        viewModelScope.launch(Dispatchers.IO) {
            val bmp = NativeStorageHelper.loadBitmapFromFile(filePath, 900)
            if (bmp == null) {
                withContext(Dispatchers.Main) { showToast("Could not read captured face") }
                return@launch
            }
            saveAndSelectFaceBitmap(bmp, name, sourceLabel)
        }
    }

    fun addCustomFaceFromBitmap(bmp: Bitmap, name: String? = null, sourceLabel: String = "Camera") {
        viewModelScope.launch(Dispatchers.IO) {
            saveAndSelectFaceBitmap(bmp, name, sourceLabel)
        }
    }

    private suspend fun saveAndSelectFaceBitmap(bmp: Bitmap, name: String?, sourceLabel: String) {
        val metrics = NativeFaceSwapEngine.detectSourceFaceMetrics(bmp)
        val id = "profile-${System.currentTimeMillis()}"
        val path = NativeStorageHelper.saveBitmapToInternalFile(ctx, bmp, "$id.png")
        withContext(Dispatchers.Main) {
            val finalName = name?.takeIf { it.isNotBlank() } ?: "Face ${faceProfiles.size + 1}"
            val item = FaceProfileItem(id = id, name = finalName, customFilePath = path, tag = sourceLabel)
            val updatedList = listOf(item) + faceProfiles
            faceProfiles = updatedList
            persistFaceProfiles(updatedList)
            profileBitmapCache[id] = bmp
            profileMetricsCache[id] = metrics
            activeProfileId = id
            assignProfileToSelectedOrAll(id)
            showToast("Added '$finalName' from $sourceLabel")
        }
    }

    fun removeFaceProfile(profileId: String) {
        val removed = faceProfiles.find { it.id == profileId }
        val updated = faceProfiles.filterNot { it.id == profileId }
        faceProfiles = updated
        persistFaceProfiles(updated)
        profileBitmapCache.remove(profileId)
        profileMetricsCache.remove(profileId)
        NativeStorageHelper.deleteInternalFile(removed?.customFilePath)

        val fallbackId = updated.firstOrNull()?.id ?: ""
        if (activeProfileId == profileId) {
            activeProfileId = fallbackId
        }
        detectedFaces = detectedFaces.map { face ->
            if (face.assignedProfileId == profileId) {
                face.copy(assignedProfileId = fallbackId.takeIf { it.isNotBlank() })
            } else face
        }
    }

    fun assignProfileToSelectedOrAll(profileId: String) {
        activeProfileId = profileId
        detectedFaces = detectedFaces.map { face ->
            if (selectedFaceId == null || face.id == selectedFaceId) {
                face.copy(assignedProfileId = profileId.takeIf { it.isNotBlank() }, enabled = true)
            } else {
                face
            }
        }
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
        defaultScale: Float
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            val id = "custom-${System.currentTimeMillis()}"
            val path = NativeStorageHelper.saveBitmapToInternalFile(ctx, transparentBitmap, "$id.png")
            val item = WardrobeAssetItem(
                id = id,
                name = name.ifBlank { "Custom Costume" },
                category = category,
                anchorPoint = anchorPoint,
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
            val obj = JSONObject().apply {
                put("id", item.id)
                put("name", item.name)
                put("customFilePath", item.customFilePath ?: "")
                put("tag", item.tag)
            }
            arr.put(obj)
        }
        prefs.edit().putString("custom_face_profiles_v1", arr.toString()).apply()
    }

    private fun loadSavedFaceProfiles(): List<FaceProfileItem> {
        val raw = prefs.getString("custom_face_profiles_v1", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { idx ->
                val o = arr.getJSONObject(idx)
                val path = o.optString("customFilePath", "")
                if (path.isBlank()) null
                else FaceProfileItem(
                    id = o.getString("id"),
                    name = o.getString("name"),
                    customFilePath = path,
                    tag = o.optString("tag", "Custom")
                )
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
                else WardrobeAssetItem(
                    id = o.getString("id"),
                    name = o.getString("name"),
                    category = WardrobeCategory.valueOf(o.getString("category")),
                    anchorPoint = BodyAnchorPoint.valueOf(o.getString("anchorPoint")),
                    fabricType = FabricType.valueOf(o.getString("fabricType")),
                    customFilePath = path,
                    defaultScale = o.optDouble("defaultScale", 1.0).toFloat(),
                    isCustom = true
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
