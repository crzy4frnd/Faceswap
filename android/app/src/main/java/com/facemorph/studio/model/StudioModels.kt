package com.facemorph.studio.model

import android.graphics.Bitmap

enum class StudioTab(val label: String) {
    FACE_STUDIO("Face Swap"),
    BODY_PHYSICS("Body Studio"),
    LIVE_CAMERA("Live AR"),
    VAULT("Wardrobe")
}

data class Point2D(val x: Float, val y: Float)

data class FaceLandmarksData(
    val forehead: Point2D,
    val leftEye: Point2D,
    val rightEye: Point2D,
    val nose: Point2D,
    val lips: Point2D,
    val chin: Point2D
)

enum class FaceAngleBucket(val shortTag: String) {
    FRONT("Front"),
    LEFT_SLIGHT("Left Slight"),
    RIGHT_SLIGHT("Right Slight"),
    LEFT_3QUARTER("Left 3/4"),
    RIGHT_3QUARTER("Right 3/4"),
    LEFT_PROFILE("Left Profile"),
    RIGHT_PROFILE("Right Profile"),
    TILT_UP("Tilt Up"),
    TILT_DOWN("Tilt Down")
}

fun classifyFaceAngleBucket(yawDeg: Float, pitchDeg: Float): FaceAngleBucket {
    val absYaw = kotlin.math.abs(yawDeg)
    if (absYaw < 10f && pitchDeg > 13f) return FaceAngleBucket.TILT_UP
    if (absYaw < 10f && pitchDeg < -13f) return FaceAngleBucket.TILT_DOWN
    return when {
        absYaw <= 9f -> FaceAngleBucket.FRONT
        yawDeg > 9f && yawDeg <= 20f -> FaceAngleBucket.RIGHT_SLIGHT
        yawDeg < -9f && yawDeg >= -20f -> FaceAngleBucket.LEFT_SLIGHT
        yawDeg > 20f && yawDeg <= 34f -> FaceAngleBucket.RIGHT_3QUARTER
        yawDeg < -20f && yawDeg >= -34f -> FaceAngleBucket.LEFT_3QUARTER
        yawDeg > 34f -> FaceAngleBucket.RIGHT_PROFILE
        else -> FaceAngleBucket.LEFT_PROFILE
    }
}

data class SourceFaceMetrics(
    val cropLeft: Float,
    val cropTop: Float,
    val cropRight: Float,
    val cropBottom: Float,
    val eyeMidXRatio: Float,
    val eyeMidYRatio: Float,
    val eyeDistRatio: Float,
    val rollDeg: Float,
    val yawDeg: Float = 0f,
    val pitchDeg: Float = 0f,
    val noseYRatio: Float = 0.56f,
    val mouthYRatio: Float = 0.75f,
    val aspectRatio: Float = 0.86f,
    val contourNorm: List<Point2D> = emptyList(),
    val visualSignature: List<Float> = emptyList(),
    val smileScore: Float = 0.5f,
    val mouthWidthRatio: Float = 0.38f,
    val mouthOpenRatio: Float = 0.04f,
    val browHeightRatio: Float = 0.25f
)

data class DetectedFaceData(
    val id: String,
    val boxLeft: Float,
    val boxTop: Float,
    val boxRight: Float,
    val boxBottom: Float,
    val landmarks: FaceLandmarksData,
    val originalLandmarks: FaceLandmarksData,
    val assignedProfileId: String? = null,
    val assignedAngleId: String? = null,
    val angleMatchScore: Int? = null,
    val angleMatchFlipped: Boolean = false,
    val enabled: Boolean = true,
    val strength: Int = 100,
    val smileScore: Float = 0.5f,
    val yawDeg: Float = 0f,
    val pitchDeg: Float = 0f,
    val rollDeg: Float = 0f,
    val isLandmarksEdited: Boolean = false,
    val faceContour: List<Point2D> = emptyList(),
    val leftBrowTop: List<Point2D> = emptyList(),
    val rightBrowTop: List<Point2D> = emptyList(),
    val upperLipContour: List<Point2D> = emptyList(),
    val lowerLipContour: List<Point2D> = emptyList(),
    val innerMouthContour: List<Point2D> = emptyList()
)

data class FaceAngleVariant(
    val id: String,
    val filePath: String,
    val cutoutFilePath: String? = null,
    val bucket: FaceAngleBucket = FaceAngleBucket.FRONT,
    val yawDeg: Float = 0f,
    val pitchDeg: Float = 0f,
    val rollDeg: Float = 0f,
    val smileScore: Float = 0.5f,
    val createdAt: Long = System.currentTimeMillis(),
    val savedMetrics: SourceFaceMetrics? = null
)

data class FaceAngleMatchResult(
    val profileId: String,
    val angleId: String?,
    val matchScore: Int,
    val shouldFlip: Boolean,
    val yawDelta: Float,
    val pitchDelta: Float,
    val rollDelta: Float
)

data class FaceProfileItem(
    val id: String,
    val name: String,
    val drawableResId: Int? = null,
    val customFilePath: String? = null,
    val angles: List<FaceAngleVariant> = emptyList(),
    val selectedAngleId: String? = null
)

data class TargetSampleItem(
    val id: String,
    val title: String,
    val drawableResId: Int? = null,
    val customFilePath: String? = null
)

data class SkinSamplePatch(
    val normX: Float,
    val normY: Float,
    val radiusRatio: Float = 0.032f,
    val sampledRed: Float,
    val sampledGreen: Float,
    val sampledBlue: Float
)

data class VirtualLightConfig(
    val enabled: Boolean = true,
    val directionDeg: Float = 305f,
    val elevationDeg: Float = 38f,
    val intensity: Float = 0.14f,
    val warmth: Float = 0.04f
)

enum class CutoutLayerKind(val label: String) {
    FOREHEAD("Forehead"),
    HAIR("Hair"),
    HAND_FINGER("Hand/Finger"),
    ACCESSORY("Jewelry/Veil"),
    OBJECT("Object")
}

data class CutoutObjectLayer(
    val id: String,
    val name: String,
    val kind: CutoutLayerKind,
    val zOrder: Int,
    val coveragePct: Int,
    val pixelCount: Int,
    val bitmap: Bitmap
)

data class LayerSegmentationSummary(
    val hasHairLayer: Boolean = false,
    val hasForeheadLayer: Boolean = false,
    val hasForegroundObjects: Boolean = false,
    val foregroundCoveragePct: Int = 0,
    val segmentWidth: Int = 0,
    val segmentHeight: Int = 0,
    val totalLayerCount: Int = 2,
    val objectLayerCount: Int = 0,
    val handObjectCount: Int = 0,
    val hairLayerCount: Int = 0,
    val decisionNote: String = "2 Base Layers"
)

data class SegmentedTargetLayers(
    val backgroundLayer: Bitmap,
    val foreLayer: Bitmap,
    val summary: LayerSegmentationSummary,
    val objectLayers: List<CutoutObjectLayer> = emptyList()
)

enum class ExpressionAlignMode(val label: String) {
    LOCK_EDGE("Lock Edge"),
    CONTOUR_CAGE("Contour")
}

data class FaceAdjustments(
    val swapStrength: Int = 100,
    val skinToneMatch: Boolean = true,
    val featherRadius: Int = 18,
    val brightness: Float = 0f,
    val contrast: Float = 10f,
    val saturation: Float = 6f,
    val warmth: Float = 0f,
    val autoMaskHair: Boolean = true,
    val autoMaskAccessories: Boolean = true,
    val autoMaskObjects: Boolean = true,
    val preserveTargetLayers: Boolean = true,
    val showBackgroundLayer: Boolean = true,
    val showFaceLayer: Boolean = true,
    val showForeLayers: Boolean = true,
    val hiddenLayerIds: Set<String> = emptySet(),
    val smartBlend: Boolean = true,
    val smartBlendIntensity: Int = 70,
    val showGeometricMesh: Boolean = false,
    val scale: Float = 1.0f,
    val rotation: Float = 0f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val manualSkinPatch: SkinSamplePatch? = null,
    val virtualLight: VirtualLightConfig = VirtualLightConfig(),
    val foreheadCutShift: Float = 0f,
    val foreheadSoftness: Float = 0.50f,
    val foreheadToneHarmonize: Int = 65,
    val skinTextureMatch: Int = 45,
    val expressionAlignEnabled: Boolean = false,
    val expressionMode: ExpressionAlignMode = ExpressionAlignMode.LOCK_EDGE,
    val expressionAlignStrength: Int = 72,
    val keepTargetMouthInterior: Boolean = false
)

enum class CutoutToolId(val defaultLabel: String, val hasSettings: Boolean) {
    AUTO("Auto", true),
    RESTORE("Restore", true),
    ERASE("Erase", true),
    MAGIC("Magic", true),
    PAN("Move", true)
}

data class CutoutToolbarPrefs(
    val orderedTools: List<CutoutToolId> = listOf(
        CutoutToolId.AUTO,
        CutoutToolId.RESTORE,
        CutoutToolId.ERASE,
        CutoutToolId.MAGIC,
        CutoutToolId.PAN
    ),
    val enabledTools: Set<CutoutToolId> = CutoutToolId.entries.toSet(),
    val compactLabels: Boolean = true,
    val largeButtons: Boolean = false,
    val longPressOpensSettings: Boolean = true,
    val tapActiveOpensSettings: Boolean = true,
    val showCompareButton: Boolean = true,
    val showBackdropButton: Boolean = true,
    val showMagnifierLoupe: Boolean = true,
    val defaultBrushSizePx: Float = 36f,
    val defaultBrushHardnessPct: Float = 70f,
    val defaultTolerance: Int = 35,
    val defaultOverlayPct: Float = 42f
)

data class SourceFaceScanResult(
    val faceDetected: Boolean,
    val metrics: SourceFaceMetrics
)

data class MultiAngleImportReport(
    val profileName: String,
    val totalSelected: Int,
    val addedCount: Int,
    val skippedDuplicateCount: Int,
    val skippedNoFaceCount: Int,
    val addedLabels: List<String>,
    val skippedReasons: List<String>
)

enum class WardrobeCategory(val label: String) {
    CLOTHING("Clothing"),
    JEWELRY("Jewelry"),
    ACCESSORY("Accessory")
}

enum class WardrobeSubCategory(
    val label: String,
    val parentCategory: WardrobeCategory
) {
    SUIT("Suit", WardrobeCategory.CLOTHING),
    SHIRT("Shirt", WardrobeCategory.CLOTHING),
    ETHNIC("Ethnic", WardrobeCategory.CLOTHING),
    JACKET("Jacket", WardrobeCategory.CLOTHING),
    NECKLACE("Necklace", WardrobeCategory.JEWELRY),
    EARRING("Earrings", WardrobeCategory.JEWELRY),
    WATCH("Watch", WardrobeCategory.JEWELRY),
    GLASSES("Glasses", WardrobeCategory.ACCESSORY),
    HEADWEAR("Headwear", WardrobeCategory.ACCESSORY)
}

fun defaultSubCategoryFor(
    category: WardrobeCategory,
    anchorPoint: BodyAnchorPoint
): WardrobeSubCategory {
    return when (category) {
        WardrobeCategory.CLOTHING -> WardrobeSubCategory.SUIT
        WardrobeCategory.JEWELRY -> when (anchorPoint) {
            BodyAnchorPoint.WRIST -> WardrobeSubCategory.WATCH
            BodyAnchorPoint.EARRINGS -> WardrobeSubCategory.EARRING
            else -> WardrobeSubCategory.NECKLACE
        }
        WardrobeCategory.ACCESSORY -> when (anchorPoint) {
            BodyAnchorPoint.WRIST -> WardrobeSubCategory.WATCH
            BodyAnchorPoint.NECK -> WardrobeSubCategory.NECKLACE
            BodyAnchorPoint.EARRINGS -> WardrobeSubCategory.EARRING
            else -> WardrobeSubCategory.GLASSES
        }
    }
}

enum class BodyAnchorPoint(val label: String) {
    SHOULDERS("Shoulders"),
    NECK("Neck"),
    EARRINGS("Earrings (Pair)"),
    HEAD("Head"),
    WRIST("Wrist"),
    WAIST("Waist")
}

enum class FabricType(
    val label: String,
    val damping: Float,
    val defaultGravity: Float,
    val stiffness: Int,
    val windSusceptibility: Float
) {
    SILK("Silk", 0.97f, 0.32f, 2, 1.8f),
    COTTON("Cotton", 0.94f, 0.50f, 4, 1.0f),
    WOOL("Wool", 0.90f, 0.65f, 6, 0.6f),
    LEATHER("Leather", 0.86f, 0.78f, 8, 0.35f)
}

enum class MotionPreset(val label: String) {
    BREATHING("Breathing"),
    WALKING("Walking"),
    BREEZE("Breeze"),
    DANCE("Dance"),
    STILL("Still")
}

data class WardrobeAssetItem(
    val id: String,
    val name: String,
    val category: WardrobeCategory,
    val anchorPoint: BodyAnchorPoint,
    val subCategory: WardrobeSubCategory = defaultSubCategoryFor(category, anchorPoint),
    val customSubCategory: String? = null,
    val fabricType: FabricType = FabricType.COTTON,
    val drawableResId: Int? = null,
    val customFilePath: String? = null,
    val defaultScale: Float = 1.0f,
    val isCustom: Boolean = false
) {
    val displaySubCategory: String
        get() = customSubCategory?.trim()?.takeIf { it.isNotEmpty() } ?: subCategory.label
}

data class FittedWardrobeLayer(
    val assetId: String,
    val visible: Boolean = true,
    val scale: Float = 1.0f,
    val rotation: Float = 0f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val shadowDepth: Int = 45,
    val lengthScale: Float = 1.0f
)

data class ClothPhysicsConfig(
    val enabled: Boolean = true,
    val preset: MotionPreset = MotionPreset.BREATHING,
    val fabricType: FabricType = FabricType.WOOL,
    val gravity: Float = 0.55f,
    val airResistance: Int = 65,
    val windStrength: Float = 1.2f,
    val windTurbulence: Float = 0.45f,
    val gustFrequency: Float = 1.0f,
    val airFanActive: Boolean = false,
    val damping: Float = 0.93f,
    val stiffness: Int = 4,
    val postureTilt: Float = 0f,
    val showWireframe: Boolean = false,
    val showStressHeatmap: Boolean = false,
    val isSimulating: Boolean = true
)

data class BodyScanResult(
    val shoulderWidthCm: Int,
    val chestCm: Int,
    val waistCm: Int,
    val neckCm: Int,
    val estimatedSize: String,
    val nose: Point2D,
    val throat: Point2D,
    val leftShoulder: Point2D,
    val rightShoulder: Point2D,
    val sternum: Point2D,
    val leftWaist: Point2D,
    val rightWaist: Point2D,
    val leftWrist: Point2D,
    val rightWrist: Point2D,
    val leftHip: Point2D = leftWaist,
    val rightHip: Point2D = rightWaist,
    val leftElbow: Point2D = Point2D(leftShoulder.x, (leftShoulder.y + leftWaist.y) * 0.5f),
    val rightElbow: Point2D = Point2D(rightShoulder.x, (rightShoulder.y + rightWaist.y) * 0.5f),
    val eyeMid: Point2D = Point2D(nose.x, nose.y - 22f),
    val faceWidthPx: Float = kotlin.math.max(40f, kotlin.math.abs(rightShoulder.x - leftShoulder.x) * 0.42f),
    val chestHalfWidthPx: Float = kotlin.math.max(30f, kotlin.math.abs(rightShoulder.x - leftShoulder.x) * 0.44f),
    val headRollDeg: Float = 0f,
    val torsoTiltDeg: Float = 0f,
    val hasSkeletonPose: Boolean = false,
    val hasHips: Boolean = false,
    val hasWrists: Boolean = false
)

data class LiveBodyMeasurementSummary(
    val shoulderCm: Int = 44,
    val chestCm: Int = 96,
    val waistCm: Int = 79,
    val torsoCm: Int = 52,
    val estimatedSize: String = "M",
    val poseConfidence: Float = 0f,
    val hasSkeletonPose: Boolean = false,
    val hasHips: Boolean = false,
    val hasWrists: Boolean = false
)

data class LiveCameraConfig(
    val removeBackground: Boolean = true,
    val activeBgId: String = "studio",
    val removeHairAndBlemishes: Boolean = true,
    val hairRemovalIntensity: Int = 55,
    val wearClothes: Boolean = true,
    val wearJewelry: Boolean = true,
    val selectedClothingId: String = "asset-blazer",
    val selectedJewelryId: String = "asset-emerald",
    val faceSwapEnabled: Boolean = false,
    val swapStrength: Int = 90,
    val showLandmarkMesh: Boolean = false,
    val showBodyMeasurements: Boolean = true,
    val useFrontCamera: Boolean = true,
    val clothWidthScale: Float = 1.0f,
    val clothLengthScale: Float = 1.0f,
    val clothCollarOffset: Float = 0f,
    val clothFitHug: Float = 0.45f,
    val faceMotionTrail: Boolean = true,
    val virtualLight: VirtualLightConfig = VirtualLightConfig()
)
