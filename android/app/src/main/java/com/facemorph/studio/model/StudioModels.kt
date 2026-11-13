package com.facemorph.studio.model

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

data class DetectedFaceData(
    val id: String,
    val boxLeft: Float,
    val boxTop: Float,
    val boxRight: Float,
    val boxBottom: Float,
    val landmarks: FaceLandmarksData,
    val originalLandmarks: FaceLandmarksData,
    val assignedProfileId: String? = null,
    val enabled: Boolean = true,
    val strength: Int = 92,
    val smileScore: Float = 0.5f,
    val isLandmarksEdited: Boolean = false
)

data class FaceProfileItem(
    val id: String,
    val name: String,
    val drawableResId: Int? = null,
    val customFilePath: String? = null,
    val tag: String = "Studio"
)

data class TargetSampleItem(
    val id: String,
    val title: String,
    val drawableResId: Int? = null,
    val customFilePath: String? = null
)

data class FaceAdjustments(
    val swapStrength: Int = 92,
    val skinToneMatch: Boolean = true,
    val featherRadius: Int = 24,
    val autoMaskHair: Boolean = true,
    val autoMaskAccessories: Boolean = true,
    val smartBlend: Boolean = true,
    val smartBlendIntensity: Int = 80,
    val showGeometricMesh: Boolean = false,
    val scale: Float = 1.0f,
    val rotation: Float = 0f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f
)

enum class WardrobeCategory(val label: String) {
    CLOTHING("Clothing"),
    JEWELRY("Jewelry"),
    ACCESSORY("Accessory")
}

enum class BodyAnchorPoint(val label: String) {
    SHOULDERS("Shoulders / Torso"),
    NECK("Neck / Collarbone"),
    HEAD("Head / Crown"),
    WRIST("Wrist / Bracelet"),
    WAIST("Waist / Belt")
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
    val fabricType: FabricType = FabricType.COTTON,
    val drawableResId: Int? = null,
    val customFilePath: String? = null,
    val defaultScale: Float = 1.0f,
    val isCustom: Boolean = false
)

data class FittedWardrobeLayer(
    val assetId: String,
    val visible: Boolean = true,
    val scale: Float = 1.0f,
    val rotation: Float = 0f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val shadowDepth: Int = 55
)

data class ClothPhysicsConfig(
    val enabled: Boolean = true,
    val preset: MotionPreset = MotionPreset.BREATHING,
    val fabricType: FabricType = FabricType.WOOL,
    val gravity: Float = 0.55f,
    val airResistance: Int = 65,
    val windStrength: Float = 1.5f,
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
    val rightWrist: Point2D
)

data class LiveCameraConfig(
    val removeBackground: Boolean = true,
    val activeBgId: String = "studio",
    val removeHairAndBlemishes: Boolean = true,
    val hairRemovalIntensity: Int = 75,
    val wearClothes: Boolean = true,
    val wearJewelry: Boolean = true,
    val selectedClothingId: String = "asset-blazer",
    val selectedJewelryId: String = "asset-emerald",
    val faceSwapEnabled: Boolean = true,
    val swapStrength: Int = 88,
    val showLandmarkMesh: Boolean = false,
    val useFrontCamera: Boolean = true
)
